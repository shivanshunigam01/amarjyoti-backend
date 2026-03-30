const BillingRecord = require('../models/BillingRecord');
const Payment = require('../models/Payment');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { toISODate } = require('../utils/date');
const { computePaymentStatus } = require('../utils/payment');

async function ensureRecordExists(ro_no, branch) {
  const record = await BillingRecord.findOne({ ro_no, branch });
  if (!record) throw new AppError('Billing record not found', 404);
  return record;
}

async function getOrCreatePayment(ro_no, branch) {
  let payment = await Payment.findOne({ ro_no, branch });
  if (!payment) {
    payment = await Payment.create({ ro_no, branch });
  }
  return payment;
}

function formatPaymentResponse(record, payment) {
  const summary = computePaymentStatus(record.total_amt, payment.customer_amount_paid, payment.insurance_amount);
  return {
    id: payment._id,
    ro_no: payment.ro_no,
    // ── Flat totals / latest-payment fields (unchanged for compatibility) ──
    customer_payment_mode:  payment.customer_payment_mode,
    customer_amount_paid:   payment.customer_amount_paid,
    customer_payment_date:  toISODate(payment.customer_payment_date),
    customer_txn_id:        payment.customer_txn_id,
    insurance_applicable:   payment.insurance_applicable,
    insurance_company:      payment.insurance_company,
    insurance_amount:       payment.insurance_amount,
    insurance_payment_date: toISODate(payment.insurance_payment_date),
    insurance_reference_no: payment.insurance_reference_no,
    notes:           payment.notes,
    total_collected: summary.total_collected,
    balance:         summary.balance,
    status:          summary.status,
    branch:          payment.branch,
    // ── History arrays (new — empty array for legacy docs) ────────────────
    customer_payments: (payment.customer_payments || []).map((p) => ({
      mode:         p.mode        || '',
      amount_paid:  p.amount_paid || 0,
      payment_date: toISODate(p.payment_date),
      txn_id:       p.txn_id      || '',
    })),
    insurance_payments: (payment.insurance_payments || []).map((p) => ({
      company:      p.company      || '',
      amount:       p.amount       || 0,
      payment_date: toISODate(p.payment_date),
      reference_no: p.reference_no || '',
    })),
  };
}

exports.getPayment = catchAsync(async (req, res) => {
  const record = await ensureRecordExists(req.params.ro_no, req.user.branch);
  let payment = await Payment.findOne({ ...req.branchFilter, ro_no: req.params.ro_no });
  if (!payment) payment = await Payment.create({ ro_no: req.params.ro_no, branch: req.user.branch });

  res.status(200).json({
    success: true,
    payment: formatPaymentResponse(record, payment),
  });
});

exports.savePayment = catchAsync(async (req, res) => {
  const record  = await ensureRecordExists(req.params.ro_no, req.user.branch);
  const payment = await getOrCreatePayment(req.params.ro_no, req.user.branch);

  const newCustTotal = Number(req.body.customer_amount_paid || 0);
  const newInsTotal  = Number(req.body.insurance_amount     || 0);
  const custDelta    = newCustTotal - (payment.customer_amount_paid || 0);
  const insDelta     = newInsTotal  - (payment.insurance_amount     || 0);

  // Push a history entry only when the amount genuinely increases
  if (custDelta > 0) {
    payment.customer_payments.push({
      mode:         req.body.customer_payment_mode || '',
      amount_paid:  custDelta,
      payment_date: req.body.customer_payment_date
        ? new Date(req.body.customer_payment_date)
        : new Date(),
      txn_id: req.body.customer_txn_id || '',
    });
  }

  if (insDelta > 0 && req.body.insurance_applicable) {
    payment.insurance_payments.push({
      company:      req.body.insurance_company      || '',
      amount:       insDelta,
      payment_date: req.body.insurance_payment_date
        ? new Date(req.body.insurance_payment_date)
        : new Date(),
      reference_no: req.body.insurance_reference_no || '',
    });
  }

  // Update flat totals and metadata (backward-compatible fields)
  payment.customer_payment_mode  = req.body.customer_payment_mode || '';
  payment.customer_amount_paid   = newCustTotal;
  payment.customer_payment_date  = req.body.customer_payment_date || null;
  payment.customer_txn_id        = req.body.customer_txn_id       || '';

  payment.insurance_applicable   = Boolean(req.body.insurance_applicable);
  payment.insurance_company      = req.body.insurance_company      || '';
  payment.insurance_amount       = newInsTotal;
  payment.insurance_payment_date = req.body.insurance_payment_date || null;
  payment.insurance_reference_no = req.body.insurance_reference_no || '';
  payment.notes                  = req.body.notes                  || '';

  await payment.save();
  const response = formatPaymentResponse(record, payment);

  res.status(200).json({
    success: true,
    message: 'Payment saved successfully',
    payment: response,
    status:  response.status,
  });
});

exports.updateCustomerPayment = catchAsync(async (req, res) => {
  const record = await ensureRecordExists(req.params.ro_no, req.user.branch);
  const payment = await getOrCreatePayment(req.params.ro_no, req.user.branch);

  payment.customer_payment_mode = req.body.payment_mode || '';
  payment.customer_amount_paid = Number(req.body.amount_paid || 0);
  payment.customer_payment_date = req.body.payment_date || null;
  payment.customer_txn_id = req.body.txn_id || '';
  await payment.save();

  const summary = computePaymentStatus(record.total_amt, payment.customer_amount_paid, payment.insurance_amount);

  res.status(200).json({
    success: true,
    message: 'Customer payment updated',
    customer_payment: {
      mode: payment.customer_payment_mode,
      amount_paid: payment.customer_amount_paid,
      payment_date: toISODate(payment.customer_payment_date),
      txn_id: payment.customer_txn_id,
    },
    total_collected: summary.total_collected,
    balance: summary.balance,
    status: summary.status,
  });
});

exports.clearCustomerPayment = catchAsync(async (req, res) => {
  await ensureRecordExists(req.params.ro_no, req.user.branch);
  const payment = await getOrCreatePayment(req.params.ro_no, req.user.branch);

  payment.customer_payment_mode = '';
  payment.customer_amount_paid = 0;
  payment.customer_payment_date = null;
  payment.customer_txn_id = '';
  await payment.save();

  res.status(200).json({
    success: true,
    message: `Customer payment cleared for ${req.params.ro_no}`,
  });
});

exports.updateInsurancePayment = catchAsync(async (req, res) => {
  const record = await ensureRecordExists(req.params.ro_no, req.user.branch);
  const payment = await getOrCreatePayment(req.params.ro_no, req.user.branch);

  payment.insurance_applicable = Boolean(req.body.applicable);
  payment.insurance_company = req.body.company || '';
  payment.insurance_amount = Number(req.body.amount || 0);
  payment.insurance_payment_date = req.body.payment_date || null;
  payment.insurance_reference_no = req.body.reference_no || '';
  await payment.save();

  const summary = computePaymentStatus(record.total_amt, payment.customer_amount_paid, payment.insurance_amount);

  res.status(200).json({
    success: true,
    message: 'Insurance payment updated',
    insurance_payment: {
      applicable: payment.insurance_applicable,
      company: payment.insurance_company,
      amount: payment.insurance_amount,
      payment_date: toISODate(payment.insurance_payment_date),
      reference_no: payment.insurance_reference_no,
    },
    total_collected: summary.total_collected,
    balance: summary.balance,
    status: summary.status,
  });
});

exports.clearInsurancePayment = catchAsync(async (req, res) => {
  await ensureRecordExists(req.params.ro_no, req.user.branch);
  const payment = await getOrCreatePayment(req.params.ro_no, req.user.branch);

  payment.insurance_applicable = false;
  payment.insurance_company = '';
  payment.insurance_amount = 0;
  payment.insurance_payment_date = null;
  payment.insurance_reference_no = '';
  await payment.save();

  res.status(200).json({
    success: true,
    message: `Insurance payment cleared for ${req.params.ro_no}`,
  });
});
