const PDFDocument = require('pdfkit');
const catchAsync = require('../utils/catchAsync');
const { buildBillingReport } = require('../utils/billingAggregate');

exports.getReportSummary = catchAsync(async (req, res) => {
  const report = await buildBillingReport(req.branchFilter, req.query);

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
  const report = await buildBillingReport(req.branchFilter, req.query);

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
        `${index + 1}. ${item.ro_no} | ${item.customer_name} | Bill: ${item.total_amt} | Collected: ${item.total_collected} | Balance: ${item.balance} | ${item.status}`,
      );
  });

  if (report.records.length > 40) {
    doc.moveDown(0.5).fontSize(9).text(`Only first 40 records shown in PDF out of ${report.records.length} total.`);
  }

  doc.end();
});
