const router = require('express').Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const branchScope = require('../middleware/branchScope');
const adminOnly = require('../middleware/adminOnly');
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



// Add to billing routes
router.post('/upload-payments', auth, upload.single('file'), async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const results = [];
    const errors = [];
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const roNo = String(row['RO No'] || '').trim();
      const customerPayment = parseFloat(row['Customer Payment']) || 0;
      const insurancePayment = parseFloat(row['Insurance Payment']) || 0;

      if (!roNo) {
        errors.push({ row: i + 2, message: 'Missing RO No' });
        skipped++;
        continue;
      }

      if (customerPayment === 0 && insurancePayment === 0) {
        skipped++;
        continue;
      }

      // Find billing record
      const billing = await BillingRecord.findOne({ 
        ro_no: roNo, 
        branch: req.user.branch 
      });

      if (!billing) {
        errors.push({ row: i + 2, ro_no: roNo, message: 'RO not found in billing records' });
        skipped++;
        continue;
      }

      // Find or create payment
      let payment = await Payment.findOne({ ro_no: roNo, branch: req.user.branch });
      if (!payment) {
        payment = new Payment({ ro_no: roNo, branch: req.user.branch });
      }

      // Accumulate payments
      payment.customer_amount_paid = (payment.customer_amount_paid || 0) + customerPayment;
      if (insurancePayment > 0) {
        payment.insurance_applicable = true;
        payment.insurance_amount = (payment.insurance_amount || 0) + insurancePayment;
      }

      // Recalculate status
      const totalPaid = (payment.customer_amount_paid || 0) + (payment.insurance_amount || 0);
      if (totalPaid >= billing.total_amt) {
        payment.payment_status = 'Completed';
      } else if (totalPaid > 0) {
        payment.payment_status = 'Partial';
      } else {
        payment.payment_status = 'Pending';
      }

      payment.customer_payment_date = new Date().toISOString();
      await payment.save();

      results.push({
        ro_no: roNo,
        customer_added: customerPayment,
        insurance_added: insurancePayment,
        status: payment.payment_status,
      });
      updated++;
    }

    res.json({ success: true, updated, skipped, results, errors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


router.use(auth, branchScope);
router.post('/upload', upload.single('file'), uploadBilling);
router.get('/records', listRecords);
router.get('/records/:ro_no', getRecord);
router.delete('/records', adminOnly, clearAll);

module.exports = router;
