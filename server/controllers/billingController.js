const XLSX = require('xlsx');
const BillingRecord = require('../models/BillingRecord');
const Payment = require('../models/Payment');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { parseExcelDate, toISODate } = require('../utils/date');
const { computePaymentStatus } = require('../utils/payment');

function normalizeRow(row) {
  return {
    ro_no: String(row['RO No'] || row['RO NO'] || row.ro_no || '').trim(),
    bill_no: String(row['Bill No'] || row['BILL NO'] || row.bill_no || '').trim(),
    bill_date: parseExcelDate(row['Bill Date'] || row.bill_date),
    customer_name: String(row['Customer Name'] || row.customer_name || '').trim(),
    vin: String(row['VIN'] || row.vin || '').trim(),
    vehicle_reg_no: String(row['Vehicle Reg No'] || row.vehicle_reg_no || '').trim(),
    model: String(row['Model'] || row.model || '').trim(),
    ro_date: parseExcelDate(row['RO Date'] || row.ro_date),
    service_advisor: String(row['Service Advisor'] || row.service_advisor || '').trim(),
    total_amt: Number(row['Total Amt'] || row.total_amt || 0),
    ins_comp_name: String(row['Ins. Comp Name'] || row.ins_comp_name || 'No Insurance Claim').trim() || 'No Insurance Claim',
  };
}

// exports.uploadBilling = catchAsync(async (req, res) => {
//   if (!req.file) {
//     throw new AppError('Please upload an Excel or CSV file', 400);
//   }

//   const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
//   const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
//   const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

//   if (!rows.length) {
//     throw new AppError('Uploaded file is empty', 400);
//   }

//   const duplicates = [];
//   const errors = [];
//   const docsToInsert = [];
//   const branch = req.user.branch;

//   for (let index = 0; index < rows.length; index += 1) {
//     const rowNo = index + 2;
//     const item = normalizeRow(rows[index]);

//     if (!item.ro_no) {
//       errors.push({ row: rowNo, message: 'Missing RO No — skipped' });
//       continue;
//     }

//     if (!item.bill_no || !item.bill_date || !item.customer_name || Number.isNaN(item.total_amt)) {
//       errors.push({ row: rowNo, message: 'Missing required fields — skipped' });
//       continue;
//     }

//     docsToInsert.push({ ...item, branch });
//   }

//   const roNos = docsToInsert.map((doc) => doc.ro_no);
//   const existing = await BillingRecord.find({ branch, ro_no: { $in: roNos } }).select('ro_no');
//   const existingSet = new Set(existing.map((doc) => doc.ro_no));

//   const filteredDocs = docsToInsert.filter((doc) => {
//     if (existingSet.has(doc.ro_no)) {
//       duplicates.push({ ro_no: doc.ro_no, message: 'Duplicate — data unchanged' });
//       return false;
//     }
//     return true;
//   });

//   let imported = 0;
//   if (filteredDocs.length) {
//     await BillingRecord.insertMany(filteredDocs, { ordered: false });
//     imported = filteredDocs.length;
//   }

//   res.status(200).json({
//     success: true,
//     imported,
//     skipped: duplicates.length + errors.length,
//     duplicates,
//     errors,
//   });
// });

exports.uploadBilling = catchAsync(async (req, res) => {
  if (!req.file) {
    throw new AppError('Please upload an Excel or CSV file', 400);
  }

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });

  if (!rows.length) {
    throw new AppError('Uploaded file is empty', 400);
  }

  const branch = req.user.branch;

  // ✅ HELPERS
  const cleanRO = (val) =>
    String(val || '')
      .toUpperCase()
      .trim();

  const parseDate = (val) => {
    if (!val) return new Date();

    if (val instanceof Date) return val;

    const parts = String(val).split('/');
    if (parts.length === 3) {
      return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }

    return new Date(val);
  };

  const parseNumber = (val) =>
    Number(String(val || '').replace(/,/g, '')) || 0;

  // 🔥 DEBUG (run once)
  console.log("BILLING HEADERS:", Object.keys(rows[0]));

  // ✅ NORMALIZE
  const normalizedDocs = rows.map((row, index) => {
    const roRaw = String(row['RO No'] || '').trim();
    const ro_no = cleanRO(roRaw);

    return {
      ro_no,
      bill_no: String(row['Bill No'] || 'UNKNOWN').trim(),
      bill_date: parseDate(row['Bill Date']),
      customer_name: String(row['Customer Name'] || 'Walk-in Customer')
        .trim()
        .toUpperCase(),
      vin: String(row['VIN'] || '').trim().toUpperCase(),
      vehicle_reg_no: String(row['Vehicle Reg No'] || '')
        .trim()
        .toUpperCase(),
      model: String(row['Model'] || '').trim(),
      ro_date: parseDate(row['RO Date']),
      service_advisor: String(row['Service Advisor'] || '').trim(),
      total_amt: parseNumber(row['Total Amt']),
      ins_comp_name:
        String(row['Ins. Comp Name'] || '').trim() ||
        'No Insurance Claim',
      branch,
    };
  });

  // 🔥 REMOVE EMPTY RO
  const validDocs = normalizedDocs.filter((doc, index) => {
    if (!doc.ro_no) {
      return false;
    }
    return true;
  });

  // 🔥 DUPLICATE CHECK
  const roNos = validDocs.map((d) => d.ro_no);

  const existing = await BillingRecord.find({
    branch,
    ro_no: { $in: roNos },
  }).select('ro_no');

  const existingSet = new Set(existing.map((d) => d.ro_no));

  const duplicates = [];
  const finalDocs = [];

  validDocs.forEach((doc, index) => {
    if (existingSet.has(doc.ro_no)) {
      duplicates.push({
        row: index + 2,
        ro_no: doc.ro_no,
        reason: 'Duplicate RO No already exists',
      });
    } else {
      finalDocs.push(doc);
    }
  });

  // 🚀 INSERT
  let inserted = 0;

  if (finalDocs.length) {
    await BillingRecord.insertMany(finalDocs, { ordered: false });
    inserted = finalDocs.length;
  }

  res.status(200).json({
    success: true,
    totalRows: rows.length,
    inserted,
    skippedDuplicates: duplicates.length,
    duplicates,
  });
});
exports.listRecords = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
    from_date,
    to_date,
    service_advisor,
    sort_by = 'bill_date',
    sort_order = 'desc',
  } = req.query;

  const filter = { ...req.branchFilter };

  if (search) {
    filter.$or = [
      { ro_no: { $regex: search, $options: 'i' } },
      { customer_name: { $regex: search, $options: 'i' } },
      { vehicle_reg_no: { $regex: search, $options: 'i' } },
    ];
  }

  if (service_advisor) {
    filter.service_advisor = { $regex: service_advisor, $options: 'i' };
  }

  if (from_date || to_date) {
    filter.bill_date = {};
    if (from_date) filter.bill_date.$gte = new Date(from_date);
    if (to_date) {
      const endDate = new Date(to_date);
      endDate.setHours(23, 59, 59, 999);
      filter.bill_date.$lte = endDate;
    }
  }

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  // Allow up to 2000 records per page so the BillsModal can load all data at once
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 2000);
  const skip = (safePage - 1) * safeLimit;
  const sort = { [sort_by]: sort_order === 'asc' ? 1 : -1 };

  const [records, total, payments] = await Promise.all([
    BillingRecord.find(filter).sort(sort).skip(skip).limit(safeLimit).lean(),
    BillingRecord.countDocuments(filter),
    Payment.find(req.branchFilter).lean(),
  ]);

  const paymentMap = new Map(payments.map((p) => [`${p.ro_no}__${p.branch}`, p]));

  let enriched = records.map((record) => {
    const payment = paymentMap.get(`${record.ro_no}__${record.branch}`);
    const summary = computePaymentStatus(record.total_amt, payment?.customer_amount_paid, payment?.insurance_amount);

    return {
      id: record._id,
      ro_no: record.ro_no,
      bill_no: record.bill_no,
      bill_date: toISODate(record.bill_date),
      customer_name: record.customer_name,
      vin: record.vin,
      vehicle_reg_no: record.vehicle_reg_no,
      model: record.model,
      ro_date: toISODate(record.ro_date),
      service_advisor: record.service_advisor,
      total_amt: record.total_amt,
      ins_comp_name: record.ins_comp_name,
      branch: record.branch,
      payment_status: summary.status,
      total_collected: summary.total_collected,
      balance: summary.balance,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    };
  });

  if (status) {
    enriched = enriched.filter((item) => item.payment_status === status);
  }

  res.status(200).json({
    success: true,
    data: enriched,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  });
});

exports.getRecord = catchAsync(async (req, res) => {
  const record = await BillingRecord.findOne({ ...req.branchFilter, ro_no: req.params.ro_no }).lean();
  if (!record) throw new AppError('Billing record not found', 404);

  const payment = await Payment.findOne({ ...req.branchFilter, ro_no: req.params.ro_no }).lean();
  const summary = computePaymentStatus(record.total_amt, payment?.customer_amount_paid, payment?.insurance_amount);

  res.status(200).json({
    success: true,
    record: {
      id: record._id,
      ro_no: record.ro_no,
      bill_no: record.bill_no,
      bill_date: toISODate(record.bill_date),
      customer_name: record.customer_name,
      vin: record.vin,
      vehicle_reg_no: record.vehicle_reg_no,
      model: record.model,
      ro_date: toISODate(record.ro_date),
      service_advisor: record.service_advisor,
      total_amt: record.total_amt,
      ins_comp_name: record.ins_comp_name,
      branch: record.branch,
      created_at: record.createdAt,
    },
    payment: {
      customer_payment: {
        mode:         payment?.customer_payment_mode  || '',
        amount_paid:  payment?.customer_amount_paid   || 0,
        payment_date: toISODate(payment?.customer_payment_date),
        txn_id:       payment?.customer_txn_id        || '',
      },
      insurance_payment: {
        applicable:   payment?.insurance_applicable   || false,
        company:      payment?.insurance_company      || '',
        amount:       payment?.insurance_amount       || 0,
        payment_date: toISODate(payment?.insurance_payment_date),
        reference_no: payment?.insurance_reference_no || '',
      },
      // ── History arrays — legacy docs return [] ────────────────────────────
      customer_payments: (payment?.customer_payments || []).map((p) => ({
        mode:         p.mode        || '',
        amount_paid:  p.amount_paid || 0,
        payment_date: toISODate(p.payment_date),
        txn_id:       p.txn_id      || '',
        mr_no:        p.mr_no       || '',
      })),
      insurance_payments: (payment?.insurance_payments || []).map((p) => ({
        company:      p.company      || '',
        amount:       p.amount       || 0,
        payment_date: toISODate(p.payment_date),
        reference_no: p.reference_no || '',
        mr_no:        p.mr_no        || '',
      })),
      total_collected: summary.total_collected,
      balance:         summary.balance,
      status:          summary.status,
      notes:           payment?.notes || '',
    },
  });
});

exports.clearAll = catchAsync(async (req, res) => {
  const [deletedRecords, deletedPayments] = await Promise.all([
    BillingRecord.deleteMany(req.branchFilter),
    Payment.deleteMany(req.branchFilter),
  ]);

  res.status(200).json({
    success: true,
    message: `All records cleared for ${req.user.branch}`,
    deleted_records: deletedRecords.deletedCount,
    deleted_payments: deletedPayments.deletedCount,
  });
});
