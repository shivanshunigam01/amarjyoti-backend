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


const getValueByKey = (row, possibleKeys) => {
  const keys = Object.keys(row);

  for (const key of keys) {
    const normalizedKey = key
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    for (const possible of possibleKeys) {
      if (normalizedKey.includes(possible)) {
        return row[key];
      }
    }
  }

  return '';
};


// Add to billing routes

// 🔥 PAYMENT UPLOAD CONTROLLER (FIXED)
const uploadPaymentSheet = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError('Please upload payment sheet', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rows.length) {
    throw new AppError('Uploaded file is empty', 400);
  }

  const branch = req.user.branch;

  // 🔥 CLEANERS
  const cleanRO = (val) =>
    String(val || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .trim();

  const cleanText = (val) =>
    String(val || '').trim().toUpperCase();

  const parseNumber = (val) =>
    Number(String(val || '').replace(/,/g, '')) || 0;

  // 🔥 DYNAMIC KEY FINDER (MAIN FIX)
  const getValueByKey = (row, possibleKeys) => {
    const keys = Object.keys(row);

    for (const key of keys) {
      const normalizedKey = key
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

      for (const possible of possibleKeys) {
        if (normalizedKey.includes(possible)) {
          return row[key];
        }
      }
    }

    return '';
  };

  const updates = [];
  const notFound = [];
  const processed = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;

    // 🔥 FLEXIBLE COLUMN READ
    const roRaw = getValueByKey(row, ['rono', 'ronumber', 'ro']);
    const ro_no = cleanRO(roRaw);

    const paid_amt = parseNumber(
      getValueByKey(row, ['paidamount', 'amount', 'paymentamount'])
    );

    const payment_mode = cleanText(
      getValueByKey(row, ['paymentmode', 'mode'])
    );

    if (!ro_no) {
      notFound.push({
        row: rowNo,
        reason: 'RO No missing (header mismatch)',
      });
      continue;
    }

    // 🔥 FAST MATCH (NO REGEX NOW)
    const record = await BillingRecord.findOne({
      branch,
      ro_no,
    });

    if (!record) {
      notFound.push({
        row: rowNo,
        ro_no,
        reason: 'RO not found in billing data',
      });
      continue;
    }

    // 🔥 PAYMENT CALCULATION
    const newPaid = (record.paid_amount || 0) + paid_amt;
    const remaining = (record.total_amt || 0) - newPaid;

    updates.push({
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

    processed.push({
      row: rowNo,
      ro_no,
      paid_amt,
    });
  }

  // 🚀 BULK UPDATE
  if (updates.length) {
    await BillingRecord.bulkWrite(updates);
  }
  console.log(Object.keys(rows[0]));

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
