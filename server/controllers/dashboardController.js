const catchAsync = require('../utils/catchAsync');
const { toISODate } = require('../utils/date');
const { computePaymentStatus } = require('../utils/payment');
const { buildBillingReport } = require('../utils/billingAggregate');
const BillingRecord = require('../models/BillingRecord');
const Payment = require('../models/Payment');

exports.getSummary = catchAsync(async (req, res) => {
  const report = await buildBillingReport(req.branchFilter, {});
  const items = report.records;

  let completed_amount = 0;
  let pending_count = 0;
  let partial_count = 0;
  let completed_count = 0;
  let outstanding_count = 0;
  let insurance_count = 0;
  let insurance_pending = 0;
  let customer_pending = 0;

  for (const item of items) {
    if (item.status === 'Pending') pending_count += 1;
    if (item.status === 'Partial') partial_count += 1;
    if (item.status === 'Completed') {
      completed_count += 1;
      completed_amount += item.total_amt;
    }
    if (item.status !== 'Completed') outstanding_count += 1;

    const hasInsurance = item.ins_comp_name && item.ins_comp_name !== 'No Insurance Claim';
    if (hasInsurance) insurance_count += 1;

    customer_pending += Math.max(item.total_amt - item.customer_collected - item.insurance_collected, 0);
    if (hasInsurance) {
      insurance_pending += Math.max(item.total_amt - item.insurance_collected - item.customer_collected, 0);
    }
  }

  const { summary } = report;

  res.status(200).json({
    success: true,
    branch: req.user.branch,
    branchName: req.user.branchName,
    kpis: {
      total_bills: items.length,
      total_billed_amount: summary.total_billed,
      total_collected: summary.total_collected,
      completed_amount,
      total_balance: summary.total_balance,
      collection_rate: summary.collection_rate_percent,
      pending_count,
      partial_count,
      completed_count,
      outstanding_count,
      insurance_count,
      insurance_pending,
      customer_pending,
    },
  });
});

exports.getRecent = catchAsync(async (req, res) => {
  const records = await BillingRecord.find(req.branchFilter).sort({ bill_date: -1 }).limit(5).lean();
  const payments = await Payment.find({ ...req.branchFilter, ro_no: { $in: records.map((r) => r.ro_no) } }).lean();
  const paymentMap = new Map(payments.map((p) => [`${p.ro_no}__${p.branch}`, p]));

  res.status(200).json({
    success: true,
    records: records.map((record) => {
      const payment = paymentMap.get(`${record.ro_no}__${record.branch}`);
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
