const PDFDocument = require('pdfkit');
const BillingRecord = require('../models/BillingRecord');
const Payment = require('../models/Payment');
const catchAsync = require('../utils/catchAsync');
const { computePaymentStatus } = require('../utils/payment');
const { toISODate } = require('../utils/date');

async function buildReport(branchFilter, query) {
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
  const paymentMap = new Map(payments.map((p) => [p.ro_no, p]));

  const prepared = records.map((record) => {
    const payment = paymentMap.get(record.ro_no);
    const summary = computePaymentStatus(record.total_amt, payment?.customer_amount_paid, payment?.insurance_amount);
    return {
      ro_no: record.ro_no,
      bill_no: record.bill_no,
      bill_date: toISODate(record.bill_date),
      customer_name: record.customer_name,
      service_advisor: record.service_advisor,
      total_amt: record.total_amt,
      customer_collected: Number(payment?.customer_amount_paid || 0),
      insurance_collected: Number(payment?.insurance_amount || 0),
      total_collected: summary.total_collected,
      balance: summary.balance,
      status: summary.status,
    };
  }).filter((item) => (status ? item.status === status : true));

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

exports.getReportSummary = catchAsync(async (req, res) => {
  const report = await buildReport(req.branchFilter, req.query);

  res.status(200).json({
    success: true,
    report: {
      branch: req.user.branch,
      branchName: req.user.branchName,
      period: report.period,
      summary: report.summary,
      by_status: report.by_status,
      by_advisor: report.by_advisor,
      records: report.records,
    },
  });
});

exports.exportPDF = catchAsync(async (req, res) => {
  const report = await buildReport(req.branchFilter, req.query);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=billing-report.pdf');

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  doc.fontSize(18).text('Billing Collection Report', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Branch: ${req.user.branchName} (${req.user.branch})`);
  doc.text(`Period: ${report.period.from || 'All'} to ${report.period.to || 'All'}`);
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown();

  doc.fontSize(12).text('Summary', { underline: true });
  doc.fontSize(10)
    .text(`Total Records: ${report.summary.total_records}`)
    .text(`Total Billed: ${report.summary.total_billed}`)
    .text(`Customer Collected: ${report.summary.customer_collected}`)
    .text(`Insurance Collected: ${report.summary.insurance_collected}`)
    .text(`Total Collected: ${report.summary.total_collected}`)
    .text(`Total Balance: ${report.summary.total_balance}`)
    .text(`Collection Rate: ${report.summary.collection_rate_percent}%`);

  doc.moveDown();
  doc.fontSize(12).text('Records', { underline: true });
  doc.moveDown(0.5);

  report.records.slice(0, 40).forEach((item, index) => {
    doc
      .fontSize(9)
      .text(
        `${index + 1}. ${item.ro_no} | ${item.customer_name} | Bill: ${item.total_amt} | Collected: ${item.total_collected} | Balance: ${item.balance} | ${item.status}`
      );
  });

  if (report.records.length > 40) {
    doc.moveDown(0.5).fontSize(9).text(`Only first 40 records shown in PDF out of ${report.records.length} total records.`);
  }

  doc.end();
});
