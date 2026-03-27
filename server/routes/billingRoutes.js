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

function normalizeRo(ro) {
  if (!ro) return '';

  let value = String(ro).trim();

  // अगर already R से शुरू है → ठीक है
  if (value.startsWith('R')) return value;

  // अगर numeric है → convert करो
  // Example: 2632026 → R202600326 (अगर logic चाहिए तो adjust करेंगे)
  // फिलहाल basic fix:
  return `R${value}`;
}

// Add to billing routes

// 🔥 PAYMENT UPLOAD CONTROLLER (FIXED)
exports.uploadPayments = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError('Please upload file', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const branch = req.user.branch;

  let updated = 0;
  let notFound = [];
  let errors = [];

  for (let i = 0; i < rows.length; i++) {
    try {
      const row = rows[i];

      // 🔥 CORRECT MAPPING
      let ro_no = normalizeRo(row['Ro Number']);

      if (!ro_no) {
        errors.push({ row: i + 2, reason: 'Missing RO Number' });
        continue;
      }

      // 🔍 FIND BILLING
      const billing = await BillingRecord.findOne({
        ro_no,
        branch,
      });

      if (!billing) {
        notFound.push({
          row: i + 2,
          ro_no,
          reason: 'RO not found in billing',
        });
        continue;
      }

      // 💰 PAYMENT VALUES
      const amount = Number(row['Amount'] || 0);
      const paymentMode = row['Payment Method'] || '';
      const paymentDate = row['value Date']
        ? new Date(row['value Date'])
        : null;

      // 🔥 UPSERT PAYMENT
      const payment = await Payment.findOneAndUpdate(
        { ro_no, branch },
        {
          ro_no,
          branch,
          $inc: { customer_amount_paid: amount },
          customer_payment_mode: paymentMode,
          customer_payment_date: paymentDate,
          customer_txn_id: row['Reference'] || '',
        },
        { new: true, upsert: true }
      );

      // 🔥 UPDATE BILLING
      const totalCollected =
        (payment.customer_amount_paid || 0) +
        (payment.insurance_amount || 0);

      billing.paid_amount = totalCollected;
      billing.remaining_amount =
        (billing.total_amt || 0) - totalCollected;

      await billing.save();

      updated++;
    } catch (err) {
      errors.push({
        row: i + 2,
        error: err.message,
      });
    }
  }
  console.log("Incoming RO:", row['Ro Number']);
console.log("Normalized:", ro_no);

  res.status(200).json({
    success: true,
    totalRows: rows.length,
    updated,
    notFound: notFound.length,
    notFoundDetails: notFound,
    errors,
  });
});

router.use(auth, branchScope);
router.post('/upload', upload.single('file'), uploadBilling);
router.get('/records', listRecords);
router.get('/records/:ro_no', getRecord);
router.delete('/records', adminOnly, clearAll);
router.post('/upload-payments', upload.single('file'), uploadPaymentSheet);

module.exports = router;
