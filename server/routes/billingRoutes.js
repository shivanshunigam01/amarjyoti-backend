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
  limits: { fileSize: 50 * 1024 * 1024 },   // 50 MB — covers large monthly sheets
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
  console.log('[upload-payments] ── REQUEST RECEIVED ──────────────────────────');
  console.log('[upload-payments] User      :', req.user?.username, '| branch:', req.user?.branch);
  console.log('[upload-payments] File      :', req.file ? `${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)` : 'MISSING');

  if (!req.file) {
    throw new AppError('Please upload payment sheet', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  console.log('[upload-payments] Sheet name:', workbook.SheetNames[0]);

  // ── STEP 1: Dynamically detect the header row ─────────────────────────────
  // Read all rows as raw arrays so we can scan for the real header line.
  const rawRows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const normCell = (val) => String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // A valid header row must contain at least one RO-like AND one Amount-like cell.
  const RO_HINTS     = ['ronumber', 'rono', 'ro'];
  const AMOUNT_HINTS = ['amount', 'amt'];

  let headerRowIdx = -1;
  for (let i = 0; i < rawRows.length; i++) {
    const normed = rawRows[i].map(normCell).filter(Boolean);
    const hasRO  = normed.some((c) => RO_HINTS.some((h) => c.includes(h)));
    const hasAmt = normed.some((c) => AMOUNT_HINTS.some((h) => c.includes(h)));
    if (hasRO && hasAmt) { headerRowIdx = i; break; }
  }

  console.log('[upload-payments] Total raw rows scanned :', rawRows.length);
  console.log('[upload-payments] Raw rows[0]            :', JSON.stringify(rawRows[0]));
  console.log('[upload-payments] Raw rows[1]            :', JSON.stringify(rawRows[1]));
  console.log('[upload-payments] Raw rows[2]            :', JSON.stringify(rawRows[2]));

  if (headerRowIdx === -1) {
    console.log('[upload-payments] ERROR: header row not found');
    throw new AppError(
      'Could not detect header row. Ensure the sheet has RO Number and Amount columns.',
      400
    );
  }

  console.log('[upload-payments] Header row index       :', headerRowIdx);

  // ── STEP 2: Re-parse from the detected header row, drop blank rows ─────────
  const allRows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw:    false,
    range:  headerRowIdx,
  });

  const rows = allRows.filter((row) =>
    Object.values(row).some((v) => String(v || '').trim() !== '')
  );

  if (!rows.length) {
    throw new AppError('Uploaded file has no data rows after the header', 400);
  }

  const finalHeaders = Object.keys(rows[0]).filter((k) => !k.startsWith('__EMPTY'));
  console.log('[upload-payments] Data rows after header      :', rows.length);
  console.log('[upload-payments] Parsed headers              :', finalHeaders);
  console.log('[upload-payments] First data row sample       :', JSON.stringify(rows[0]));

  // ── STEP 3: Helpers ───────────────────────────────────────────────────────
  const normalize = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /**
   * Scan columns in sheet order, skip __EMPTY keys.
   * Returns the value of the FIRST column whose normalised header contains
   * any of the supplied hint substrings.
   *
   * Why specific hints for RO: "Approval Date" → "approvaldate" contains "ro"
   * as a substring, so we only use 'ronumber' / 'rono' (not bare 'ro') for
   * value extraction to avoid that false match.
   *
   * Why "customerna" for customer name: covers both correct spelling
   * ("customername") and the actual sheet typo ("customernamne") while
   * deliberately NOT matching "customerphone".
   */
  const getValue = (row, hints) => {
    for (const key of Object.keys(row)) {
      if (key.startsWith('__EMPTY')) continue;
      const n = normalize(key);
      if (hints.some((h) => n.includes(h))) return row[key];
    }
    return '';
  };

  // RO: strip everything non-alphanumeric, uppercase → "R202601187"
  const cleanRO     = (val) => String(val || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const parseNumber = (val) => Number(String(val || '').replace(/[^0-9.]/g, '')) || 0;
  const cleanText   = (val) => String(val || '').trim().toUpperCase();
  const parseSheetDate = (val) => {
    if (!val) return new Date();
    if (val instanceof Date && !Number.isNaN(val.getTime())) return val;

    const raw = String(val).trim();
    if (!raw) return new Date();

    // Handles Excel serial dates if they come through as numbers.
    const asNum = Number(raw);
    if (!Number.isNaN(asNum) && asNum > 1000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const ms = asNum * 24 * 60 * 60 * 1000;
      return new Date(excelEpoch.getTime() + ms);
    }

    // Common dd/mm/yyyy or dd-mm-yyyy formats.
    const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]) - 1;
      let yy = Number(m[3]);
      if (yy < 100) yy += 2000;
      const d = new Date(yy, mm, dd);
      if (!Number.isNaN(d.getTime())) return d;
    }

    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
  };

  // Specific RO hints — avoids false match on "Approval Date" ("approvaldate" ⊃ "ro")
  const RO_VALUE_HINTS = ['ronumber', 'rono'];

  const branch = req.user.branch;

  // ── STEP 4: Build insurance company lookup from DB (no hardcoding) ─────────
  // Fetch all unique ins_comp_name values for this branch, normalise them, and
  // build a Map<normalised → original> used for fuzzy customer-name matching.
  const insNames = await BillingRecord.distinct('ins_comp_name', {
    branch,
    ins_comp_name: { $nin: ['', 'No Insurance Claim'] },
  });

  // Map: normalised name → original name (e.g. "bajajgeneralinsurance..." → "Bajaj General...")
  const insNameMap = new Map(insNames.map((n) => [normalize(n), n]));

  console.log('[upload-payments] Insurance companies in DB  :', insNames.length, insNames);

  /**
   * Returns the original insurance company name if customerName fuzzy-matches
   * any known insurer, otherwise null.
   *
   * Strategy: accept if either normalised string is a substring of the other.
   * This handles partial names (e.g. Excel has "Go Digit General Insurance"
   * while DB stores "Go Digit General Insurance Limited") without false
   * positives against ordinary customer names.
   */
  const matchInsurance = (customerName) => {
    const normCust = normalize(customerName);
    if (!normCust || normCust.length < 4) return null;

    for (const [normIns, origIns] of insNameMap) {
      if (normCust.includes(normIns) || normIns.includes(normCust)) {
        return origIns;
      }
    }
    return null;
  };

  // ── STEP 5: Collect ROs and fetch matching billing records ─────────────────
  const roList = rows
    .map((row) => cleanRO(getValue(row, RO_VALUE_HINTS)))
    .filter(Boolean);

  console.log('[upload-payments] RO list extracted (first 5) :', roList.slice(0, 5), '... total:', roList.length);

  if (!roList.length) {
    console.log('[upload-payments] ERROR: no valid ROs found');
    throw new AppError('No valid RO numbers found in the uploaded file', 400);
  }

  const records   = await BillingRecord.find({ branch, ro_no: { $in: roList } });
  const recordMap = new Map(records.map((r) => [r.ro_no, r]));
  console.log('[upload-payments] DB records matched          :', records.length, '/', roList.length);

  // ── STEP 6: Parse, classify, and aggregate per RO ─────────────────────────
  // Aggregating before bulk-write ensures that multiple Excel rows for the
  // same RO (e.g. partial payments) are summed correctly in one operation.
  //
  // acc shape per ro_no:
  //   record            — BillingRecord document from DB
  //   customerPaid      — total customer payment amount from this sheet
  //   customerMode      — latest non-empty customer payment method
  //   customerRef       — latest non-empty customer reference / txn id
  //   customerDate      — latest customer approval date
  //   customerEntries   — all customer history entries from this upload
  //   insurancePaid     — total insurance payment amount from this sheet
  //   insuranceMode     — latest non-empty insurance payment method
  //   insuranceRef      — latest non-empty insurance reference number
  //   insuranceDate     — latest insurance approval date
  //   insuranceCompany  — matched insurance company name from DB
  //   insuranceEntries  — all insurance history entries from this upload

  const perRO     = new Map();
  const notFound  = [];
  const processed = [];

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i];
    const rowNo = headerRowIdx + i + 2;

    // ── Extract columns ──────────────────────────────────────────────────
    const ro_no = cleanRO(getValue(row, RO_VALUE_HINTS));
    if (!ro_no) {
      notFound.push({ row: rowNo, reason: 'RO missing / could not detect RO column' });
      continue;
    }

    // "Amount  __________" → "amount". Column I appears before "OEM Invoice Amount"
    // (column O) in sheet order, so the first match is always the customer payment.
    const paid_amt = parseNumber(
      getValue(row, ['amount', 'amt', 'amountpaid', 'paidamt'])
    );

    if (paid_amt <= 0) {
      notFound.push({ row: rowNo, ro_no, reason: 'Invalid or zero payment amount' });
      continue;
    }

    // "Payment Method __________" → "paymentmethod"
    // NOTE: 'mode' removed — "model_no" normalises to "modelno" which
    // contains "mode" as a substring, causing a false column match.
    const payment_mode = cleanText(
      getValue(row, ['paymentmethod', 'paymentmode', 'method'])
    );

    // "Reference __________" → "reference" (matched before "Ac Reference" in column order)
    const reference = String(
      getValue(row, ['reference', 'refno', 'txnid', 'utr', 'acreference']) || ''
    ).trim();

    const approvalDateRaw = getValue(row, ['approvaldate', 'approvaldt', 'approvedate']);
    const approvalDate = parseSheetDate(approvalDateRaw);

    const mrNo = String(
      getValue(row, ['mrno', 'mrnumber', 'mr_no']) || ''
    ).trim();

    // "Customer namne __________" → normalised "customernamne", hint "customerna"
    // covers both correct spelling and the typo without matching "customerphone"
    const customerName = String(
      getValue(row, ['customerna', 'customernam', 'customername']) || ''
    ).trim();

    const record = recordMap.get(ro_no);
    if (!record) {
      notFound.push({ row: rowNo, ro_no, reason: 'RO not found in database' });
      continue;
    }

    console.log(`[upload-payments] Row ${rowNo}: ro_no=${ro_no} | amt=${paid_amt} | mode="${payment_mode}" | ref="${reference}" | mr_no="${mrNo}" | approval_date="${approvalDate.toISOString()}" | custName="${customerName}" | dbMatch=${!!record}`);

    // ── Classify payment type ────────────────────────────────────────────
    let paymentType      = 'CUSTOMER';
    let matchedInsCompany = null;

    if (payment_mode === 'CASH') {
      paymentType = 'CASH';
    } else {
      matchedInsCompany = matchInsurance(customerName);
      if (matchedInsCompany) paymentType = 'INSURANCE';
    }
    console.log(`[upload-payments] Row ${rowNo}: classified as ${paymentType}${matchedInsCompany ? ` (ins: ${matchedInsCompany})` : ''}`);

    console.log(
      `[uploadPaymentSheet] Row ${rowNo} | ro_no: ${ro_no} | type: ${paymentType}` +
      (matchedInsCompany ? ` | matched ins: "${matchedInsCompany}"` : '') +
      ` | amount: ${paid_amt} | mode: ${payment_mode}`
    );

    // ── Accumulate into per-RO aggregator ────────────────────────────────
    if (!perRO.has(ro_no)) {
      perRO.set(ro_no, {
        record,
        customerPaid: 0, customerMode: '', customerRef: '', customerDate: null, customerEntries: [],
        insurancePaid: 0, insuranceMode: '', insuranceRef: '', insuranceDate: null, insuranceCompany: '', insuranceEntries: [],
      });
    }

    const acc = perRO.get(ro_no);

    if (paymentType === 'INSURANCE') {
      acc.insurancePaid    += paid_amt;
      acc.insuranceMode     = payment_mode  || acc.insuranceMode;
      acc.insuranceRef      = reference     || acc.insuranceRef;
      acc.insuranceCompany  = matchedInsCompany;
      acc.insuranceDate     = approvalDate;
      acc.insuranceEntries.push({
        company:      matchedInsCompany || '',
        amount:       paid_amt,
        payment_date: approvalDate,
        reference_no: reference || '',
        mr_no:        mrNo || '',
      });
    } else {
      // CASH and CUSTOMER both go to customer fields
      acc.customerPaid += paid_amt;
      acc.customerMode  = payment_mode || acc.customerMode;
      acc.customerRef   = reference    || acc.customerRef;
      acc.customerDate  = approvalDate;
      acc.customerEntries.push({
        mode:         payment_mode || 'CASH',
        amount_paid:  paid_amt,
        payment_date: approvalDate,
        txn_id:       reference || '',
        mr_no:        mrNo || '',
      });
    }

    processed.push({ row: rowNo, ro_no, paid_amt, type: paymentType });
  }

  // ── STEP 7: Build bulk-write operations from aggregated data ──────────────
  const billingUpdates = [];
  const paymentUpdates = [];

  for (const [ro_no, acc] of perRO) {
    const { record } = acc;
    const totalNew   = acc.customerPaid + acc.insurancePaid;

    // BillingRecord: recalculate paid_amount and remaining_amount.
    // We read record.paid_amount once before the loop, so this correctly
    // adds the entire batch for this RO on top of the existing DB value.
    const newPaid   = Math.min((record.paid_amount || 0) + totalNew, record.total_amt || 0);
    const remaining = Math.max((record.total_amt || 0) - newPaid, 0);
    const dominantMode = acc.customerMode || acc.insuranceMode || record.payment_mode || 'CASH';

    billingUpdates.push({
      updateOne: {
        filter: { _id: record._id },
        update: {
          $set: {
            paid_amount:      newPaid,
            remaining_amount: remaining,
            payment_mode:     dominantMode,
          },
        },
      },
    });

    // Payment: $inc running totals, $set latest metadata, $push history entry.
    // MongoDB supports all three operators in a single update document.
    const incOp  = {};
    const setOp  = {};
    const pushOp = {};
    if (acc.customerPaid > 0) {
      incOp.customer_amount_paid  = acc.customerPaid;
      setOp.customer_payment_mode = acc.customerMode || 'CASH';
      setOp.customer_payment_date = acc.customerDate || new Date();
      if (acc.customerRef) setOp.customer_txn_id = acc.customerRef;

      // Append one history entry per payment row from sheet.
      pushOp.customer_payments = {
        $each: acc.customerEntries,
      };
    }

    if (acc.insurancePaid > 0) {
      incOp.insurance_amount          = acc.insurancePaid;
      setOp.insurance_applicable      = true;
      setOp.insurance_company         = acc.insuranceCompany;
      setOp.insurance_payment_date    = acc.insuranceDate || new Date();
      if (acc.insuranceRef) setOp.insurance_reference_no = acc.insuranceRef;

      pushOp.insurance_payments = {
        $each: acc.insuranceEntries,
      };
    }

    const updateDoc = { $set: setOp };
    if (Object.keys(incOp).length)  updateDoc.$inc  = incOp;
    if (Object.keys(pushOp).length) updateDoc.$push = pushOp;

    paymentUpdates.push({
      updateOne: {
        filter: { ro_no, branch },
        update:  updateDoc,
        upsert:  true,
      },
    });
  }

  // ── STEP 8: Execute bulk writes ───────────────────────────────────────────
  console.log('[upload-payments] ── BULK WRITE SUMMARY ──────────────────────');
  console.log('[upload-payments] Billing updates :', billingUpdates.length);
  console.log('[upload-payments] Payment updates :', paymentUpdates.length);
  console.log('[upload-payments] Processed       :', processed.length);
  console.log('[upload-payments] Not found       :', notFound.length);
  if (notFound.length) console.log('[upload-payments] Not found details:', JSON.stringify(notFound));

  if (billingUpdates.length) await BillingRecord.bulkWrite(billingUpdates);
  if (paymentUpdates.length) await Payment.bulkWrite(paymentUpdates);

  console.log('[upload-payments] ── DONE ──────────────────────────────────────');

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
