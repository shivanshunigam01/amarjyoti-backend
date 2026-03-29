const router = require('express').Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const branchScope = require('../middleware/branchScope');
const adminOnly = require('../middleware/adminOnly');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const {
  uploadBilling,
  listRecords,
  getRecord,
  clearAll,
} = require('../controllers/billingController');
const XLSX = require('xlsx');
const BillingRecord = require("../models/BillingRecord");
const Payment = require("../models/Payment");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [ 
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    if (allowed.includes(file.mimetype) || /\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      return cb(null, true);
    }
    return cb(new Error('Only .xlsx, .xls and .csv files are allowed'));
  },
});



// const getValueByKey = (row, possibleKeys) => {
//   const keys = Object.keys(row);

//   for (const key of keys) {
//     const normalizedKey = key
//       .toLowerCase()
//       .replace(/[^a-z0-9]/g, '');

//     for (const possible of possibleKeys) {
//       if (normalizedKey.includes(possible)) {
//         return row[key];
//       }
//     }
//   }

//   return '';
// };

const cleanRO = (val) =>
  String(val || '')
    .toUpperCase()
    .trim();

// Add to billing routes

// 🔥 PAYMENT UPLOAD CONTROLLER (FIXED)
const uploadPaymentSheet = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError('Please upload payment sheet', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
    range: 1,
  });

  console.log("FIXED HEADERS:", Object.keys(rows[0]));
  if (!rows.length) {
    throw new AppError('Uploaded file is empty', 400);
  }

  const branch = req.user.branch;

  // 🔥 HELPER FUNCTIONS
  const normalize = (str) =>
    String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const getValue = (row, keys) => {
    const map = {};
    Object.keys(row).forEach((k) => {
      map[normalize(k)] = k;
    });

    for (const key of keys) {
      const norm = normalize(key);
      if (map[norm]) return row[map[norm]];
    }

    return '';
  };

  const cleanRO = (val) =>
    String(val || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  const parseNumber = (val) =>
    Number(String(val || '').replace(/,/g, '')) || 0;

  const cleanText = (val) =>
    String(val || '').trim().toUpperCase();

  console.log("HEADERS:", Object.keys(rows[0]));

  // 🚀 STEP 1: COLLECT ALL RO
  const roList = rows.map((row) =>
    cleanRO(getValue(row, ['ro no', 'ro_no', 'rono', 'ro']))
  ).filter(Boolean);

  // 🚀 STEP 2: FETCH ALL RECORDS (ONE QUERY ONLY)
  const records = await BillingRecord.find({
    branch,
    ro_no: { $in: roList },
  });

  const recordMap = new Map(records.map(r => [r.ro_no, r]));

  // RESULT ARRAYS
  const billingUpdates = [];
  const paymentUpdates = [];
  const notFound = [];
  const processed = [];

  // 🚀 MAIN LOOP
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;

    const roRaw = getValue(row, ['ro no', 'ro_no', 'rono', 'ro']);
    const ro_no = cleanRO(roRaw);

    if (!ro_no) {
      notFound.push({
        row: rowNo,
        reason: 'RO missing / header mismatch',
      });
      continue;
    }

    const paid_amt = parseNumber(
      getValue(row, ['customer payment', 'amount paid', 'payment'])
    );

    const payment_mode = cleanText(
      getValue(row, ['payment mode', 'mode'])
    );

    // ❌ SKIP ZERO PAYMENT
    if (paid_amt <= 0) {
      notFound.push({
        row: rowNo,
        ro_no,
        reason: 'Invalid or zero payment',
      });
      continue;
    }

    const record = recordMap.get(ro_no);

    if (!record) {
      notFound.push({
        row: rowNo,
        ro_no,
        reason: 'RO not found',
      });
      continue;
    }

    // ✅ CALCULATION
    const newPaid = Math.min(
      (record.paid_amount || 0) + paid_amt,
      record.total_amt || 0
    );

    const remaining = (record.total_amt || 0) - newPaid;

    // ✅ BILLING UPDATE
    billingUpdates.push({
      updateOne: {
        filter: { _id: record._id },
        update: {
          $set: {
            paid_amount: newPaid,
            remaining_amount: remaining < 0 ? 0 : remaining,
            payment_mode: payment_mode || record.payment_mode,
          },
        },
      },
    });

    // ✅ PAYMENT UPSERT
    paymentUpdates.push({
      updateOne: {
        filter: { ro_no, branch },
        update: {
          $inc: {
            customer_amount_paid: paid_amt,
          },
          $set: {
            customer_payment_mode: payment_mode || 'CASH',
            customer_payment_date: new Date(),
          },
        },
        upsert: true,
      },
    });

    processed.push({
      row: rowNo,
      ro_no,
      paid_amt,
    });
  }

  // 🚀 BULK EXECUTION
  if (billingUpdates.length) {
    await BillingRecord.bulkWrite(billingUpdates);
  }

  if (paymentUpdates.length) {
    await Payment.bulkWrite(paymentUpdates);
  }

  res.status(200).json({
    success: true,
    totalRows: rows.length,
    updated: processed.length,
    notFound: notFound.length,
    notFoundDetails: notFound,
  });
});
router.use(auth, branchScope);
router.post('/upload', upload.single('file'), uploadBilling);
router.get('/records', listRecords);
router.get('/records/:ro_no', getRecord);
router.delete('/records', adminOnly, clearAll);
router.post('/upload-payments', upload.single('file'), uploadPaymentSheet);

module.exports = router;
