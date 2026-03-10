const BillingRecord = require('../models/BillingRecord');
const Payment = require('../models/Payment');
const catchAsync = require('../utils/catchAsync');
const { computePaymentStatus } = require('../utils/payment');
const { toISODate } = require('../utils/date');

exports.getSummary = catchAsync(async (req, res) => {
  const [records, payments] = await Promise.all([
    BillingRecord.find(req.branchFilter).lean(),
    Payment.find(req.branchFilter).lean(),
  ]);

  const paymentMap = new Map(payments.map((p) => [p.ro_no, p]));

  let total_billed_amount = 0;
  let total_collected = 0;
  let total_balance = 0;
  let pending_count = 0;
  let partial_count = 0;
  let completed_count = 0;
  let insurance_pending = 0;
  let customer_pending = 0;

  for (const record of records) {
    const payment = paymentMap.get(record.ro_no);
    const summary = computePaymentStatus(record.total_amt, payment?.customer_amount_paid, payment?.insurance_amount);
    total_billed_amount += record.total_amt;
    total_collected += summary.total_collected;
    total_balance += summary.balance;

    if (summary.status === 'Pending') pending_count += 1;
    if (summary.status === 'Partial') partial_count += 1;
    if (summary.status === 'Completed') completed_count += 1;

    const customerPaid = Number(payment?.customer_amount_paid || 0);
    const insurancePaid = Number(payment?.insurance_amount || 0);
    customer_pending += Math.max(record.total_amt - customerPaid - insurancePaid, 0);
    if (record.ins_comp_name && record.ins_comp_name !== 'No Insurance Claim') {
      insurance_pending += Math.max(record.total_amt - insurancePaid - customerPaid, 0);
    }
  }

  res.status(200).json({
    success: true,
    branch: req.user.branch,
    branchName: req.user.branchName,
    kpis: {
      total_bills: records.length,
      total_billed_amount,
      total_collected,
      total_balance,
      collection_rate: total_billed_amount ? Number(((total_collected / total_billed_amount) * 100).toFixed(2)) : 0,
      pending_count,
      partial_count,
      completed_count,
      insurance_pending,
      customer_pending,
    },
  });
});

exports.getRecent = catchAsync(async (req, res) => {
  const records = await BillingRecord.find(req.branchFilter).sort({ bill_date: -1 }).limit(5).lean();
  const payments = await Payment.find({ ...req.branchFilter, ro_no: { $in: records.map((r) => r.ro_no) } }).lean();
  const paymentMap = new Map(payments.map((p) => [p.ro_no, p]));

  res.status(200).json({
    success: true,
    records: records.map((record) => {
      const payment = paymentMap.get(record.ro_no);
      const summary = computePaymentStatus(record.total_amt, payment?.customer_amount_paid, payment?.insurance_amount);
      return {
        ro_no: record.ro_no,
        customer_name: record.customer_name,
        total_amt: record.total_amt,
        status: summary.status,
        bill_date: toISODate(record.bill_date),
      };
    }),
  });
});
