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

// ─── PAYMENT SHEET UPLOAD ────────────────────────────────────────────────────
const uploadPaymentSheet = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError('Please upload payment sheet', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];

  // ── STEP 1: Read every row as a plain array to find the real header row ──
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Normalise a single cell value: lowercase, strip everything non-alphanumeric
  const normCell = (val) => String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // The header row must contain at least one RO-like cell AND one Amount-like cell.
  // "Ro Number" normalises to "ronumber" → matched by hint "rono".
  // "Mr_No"     normalises to "mrno"     → does NOT contain "ro", "rono", etc. ✓
  const RO_HINTS     = ['ronumber', 'rono', 'ro'];
  const AMOUNT_HINTS = ['amount', 'amt'];

  let headerRowIdx = -1;
  for (let i = 0; i < rawRows.length; i++) {
    const normed  = rawRows[i].map(normCell).filter(Boolean);
    const hasRO   = normed.some((c) => RO_HINTS.some((h) => c.includes(h)));
    const hasAmt  = normed.some((c) => AMOUNT_HINTS.some((h) => c.includes(h)));
    if (hasRO && hasAmt) { headerRowIdx = i; break; }
  }

  if (headerRowIdx === -1) {
    throw new AppError(
      'Could not detect header row. Ensure the sheet has RO Number and Amount columns.',
      400
    );
  }

  console.log('[uploadPaymentSheet] Detected header row index:', headerRowIdx);

  // ── STEP 2: Re-parse from the detected header row ──
  const allRows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw:    false,
    range:  headerRowIdx,   // this row becomes the header; rows below are data
  });

  // Drop rows where every value is blank (blank spacer rows in the sheet)
  const rows = allRows.filter((row) =>
    Object.values(row).some((v) => String(v || '').trim() !== '')
  );

  if (!rows.length) {
    throw new AppError('Uploaded file has no data rows after the header', 400);
  }

  // Log actual headers (excluding __EMPTY auto-generated keys)
  const finalHeaders = Object.keys(rows[0]).filter((k) => !k.startsWith('__EMPTY'));
  console.log('[uploadPaymentSheet] Final headers after parsing:', finalHeaders);

  // ── STEP 3: Helpers ──────────────────────────────────────────────────────
  const normalize = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /**
   * Return the value of the FIRST column whose normalised key contains any of
   * the supplied hints.  Skips XLSX auto-generated __EMPTY columns entirely.
   *
   * Example: hints ['ronumber','rono','ro'] matches key "Ro Number __________"
   *          (normalised → "ronumber") and skips "Mr_No __________" ("mrno").
   */
  const getValue = (row, hints) => {
    for (const key of Object.keys(row)) {
      if (key.startsWith('__EMPTY')) continue;
      const n = normalize(key);
      if (hints.some((h) => n.includes(h))) return row[key];
    }
    return '';
  };

  // Strip all non-alphanumeric characters and uppercase — matches the DB format
  // produced by uploadBilling (e.g. "R202601187" stays "R202601187").
  const cleanRO = (val) => String(val || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  const parseNumber = (val) => Number(String(val || '').replace(/[^0-9.]/g, '')) || 0;

  const cleanText = (val) => String(val || '').trim().toUpperCase();

  const branch = req.user.branch;

  // ── STEP 4: Collect all RO numbers for a single bulk DB query ────────────
  //   Use only specific hints to avoid false matches on columns like
  //   "Approval Date" (normalises to "approvaldate", which contains "ro").
  //   "ronumber" → matches "Ro Number __________"
  //   "rono"     → matches "RO No", "RO_NO", "ro_no", "rono", "ro number"
  //   "mrno" is intentionally excluded — that is a receipt/transaction ID.
  const RO_VALUE_HINTS = ['ronumber', 'rono'];

  const roList = rows
    .map((row) => cleanRO(getValue(row, RO_VALUE_HINTS)))
    .filter(Boolean);

  if (!roList.length) {
    throw new AppError('No valid RO numbers found in the uploaded file', 400);
  }

  // ── STEP 5: Fetch matching records (one DB round-trip) ───────────────────
  const records  = await BillingRecord.find({ branch, ro_no: { $in: roList } });
  const recordMap = new Map(records.map((r) => [r.ro_no, r]));

  // ── STEP 6: Build bulk-write operations ──────────────────────────────────
  const billingUpdates = [];
  const paymentUpdates = [];
  const notFound       = [];
  const processed      = [];

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i];
    const rowNo = headerRowIdx + i + 2;   // human-readable sheet row number

    const roRaw = getValue(row, RO_VALUE_HINTS);
    const ro_no = cleanRO(roRaw);

    if (!ro_no) {
      notFound.push({ row: rowNo, reason: 'RO missing / could not detect RO column' });
      continue;
    }

    // "Amount  __________" → normalised "amount".  Comes before "OEM Invoice Amount"
    // in column order so the first match is always the customer payment amount.
    const paid_amt = parseNumber(getValue(row, ['amount', 'amt', 'amountpaid', 'paidamt']));

    // "Payment Method __________" → normalised "paymentmethod"
    const payment_mode = cleanText(getValue(row, ['paymentmethod', 'paymentmode', 'method', 'mode']));

    if (paid_amt <= 0) {
      notFound.push({ row: rowNo, ro_no, reason: 'Invalid or zero payment amount' });
      continue;
    }

    const record = recordMap.get(ro_no);
    if (!record) {
      notFound.push({ row: rowNo, ro_no, reason: 'RO not found in database' });
      continue;
    }

    const newPaid   = Math.min((record.paid_amount || 0) + paid_amt, record.total_amt || 0);
    const remaining = Math.max((record.total_amt || 0) - newPaid, 0);

    billingUpdates.push({
      updateOne: {
        filter: { _id: record._id },
        update: {
          $set: {
            paid_amount:      newPaid,
            remaining_amount: remaining,
            payment_mode:     payment_mode || record.payment_mode || 'CASH',
          },
        },
      },
    });

    paymentUpdates.push({
      updateOne: {
        filter: { ro_no, branch },
        update: {
          $inc: { customer_amount_paid: paid_amt },
          $set: {
            customer_payment_mode: payment_mode || 'CASH',
            customer_payment_date: new Date(),
          },
        },
        upsert: true,
      },
    });

    processed.push({ row: rowNo, ro_no, paid_amt });
  }

  // ── STEP 7: Execute bulk writes ───────────────────────────────────────────
  if (billingUpdates.length) await BillingRecord.bulkWrite(billingUpdates);
  if (paymentUpdates.length) await Payment.bulkWrite(paymentUpdates);

  res.status(200).json({
    success:         true,
    totalRows:       rows.length,
    updated:         processed.length,
    notFound:        notFound.length,
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
