const BillingRecord = require('../models/BillingRecord');
const Payment = require('../models/Payment');
const { computePaymentStatus } = require('./payment');
const { toISODate } = require('./date');

/**
 * Same aggregation as the Report module: per-RO computePaymentStatus, then sum
 * total_billed, total_collected (capped), total_balance. Payment join uses
 * ro_no+branch so it matches billing list / dashboard behaviour.
 */
async function buildBillingReport(branchFilter, query = {}) {
  const { from_date, to_date, status, service_advisor } = query;
  const filter = { ...branchFilter };

  if (from_date || to_date) {
    filter.bill_date = {};
    if (from_date) filter.bill_date.$gte = new Date(from_date);
    if (to_date) {
      const endDate = new Date(to_date);
      endDate.setHours(23, 59, 59, 999);
      filter.bill_date.$lte = endDate;
    }
  }

  if (service_advisor) {
    filter.service_advisor = { $regex: service_advisor, $options: 'i' };
  }

  const records = await BillingRecord.find(filter).sort({ bill_date: -1 }).lean();
  const payments = await Payment.find({ ...branchFilter, ro_no: { $in: records.map((r) => r.ro_no) } }).lean();
  const paymentMap = new Map(payments.map((p) => [`${p.ro_no}__${p.branch}`, p]));

  const prepared = records
    .map((record) => {
      const payment = paymentMap.get(`${record.ro_no}__${record.branch}`);
      const summary = computePaymentStatus(
        record.total_amt,
        payment?.customer_amount_paid,
        payment?.insurance_amount,
      );
      return {
        ro_no: record.ro_no,
        bill_no: record.bill_no,
        bill_date: toISODate(record.bill_date),
        customer_name: record.customer_name,
        service_advisor: record.service_advisor,
        total_amt: record.total_amt,
        ins_comp_name: record.ins_comp_name,
        branch: record.branch,
        customer_collected: Number(payment?.customer_amount_paid || 0),
        insurance_collected: Number(payment?.insurance_amount || 0),
        total_collected: summary.total_collected,
        balance: summary.balance,
        status: summary.status,
      };
    })
    .filter((item) => (status ? item.status === status : true));

  const byAdvisorMap = new Map();
  const byStatus = {
    Pending: { count: 0, amount: 0 },
    Partial: { count: 0, amount: 0 },
    Completed: { count: 0, amount: 0 },
  };

  let total_billed = 0;
  let customer_collected = 0;
  let insurance_collected = 0;
  let total_collected = 0;
  let total_balance = 0;

  for (const item of prepared) {
    total_billed += item.total_amt;
    customer_collected += item.customer_collected;
    insurance_collected += item.insurance_collected;
    total_collected += item.total_collected;
    total_balance += item.balance;

    byStatus[item.status].count += 1;
    byStatus[item.status].amount += item.total_amt;

    const key = item.service_advisor || 'Unassigned';
    const existing = byAdvisorMap.get(key) || { name: key, total_billed: 0, collected: 0 };
    existing.total_billed += item.total_amt;
    existing.collected += item.total_collected;
    byAdvisorMap.set(key, existing);
  }

  return {
    summary: {
      total_records: prepared.length,
      total_billed,
      customer_collected,
      insurance_collected,
      total_collected,
      total_balance,
      collection_rate_percent: total_billed ? Number(((total_collected / total_billed) * 100).toFixed(2)) : 0,
    },
    by_status: byStatus,
    by_advisor: Array.from(byAdvisorMap.values()).sort((a, b) => b.total_billed - a.total_billed),
    records: prepared,
    period: {
      from: from_date || null,
      to: to_date || null,
    },
  };
}

module.exports = { buildBillingReport };
