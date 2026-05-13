const mongoose = require('mongoose');

// ── History entry sub-schemas (_id: false → lighter documents) ──────────────

const CustomerPaymentEntrySchema = new mongoose.Schema(
  {
    mode:         { type: String, default: '', trim: true },
    amount_paid:  { type: Number, default: 0,  min: 0 },
    payment_date: { type: Date,   default: null },
    txn_id:       { type: String, default: '', trim: true },
    mr_no:        { type: String, default: '', trim: true },
  },
  { _id: false }
);

const InsurancePaymentEntrySchema = new mongoose.Schema(
  {
    company:      { type: String, default: '', trim: true },
    amount:       { type: Number, default: 0,  min: 0 },
    payment_date: { type: Date,   default: null },
    reference_no: { type: String, default: '', trim: true },
    mr_no:        { type: String, default: '', trim: true },
  },
  { _id: false }
);

// ── Main Payment schema ───────────────────────────────────────────────────────

const PaymentSchema = new mongoose.Schema(
  {
    ro_no:  { type: String, required: true, trim: true },
    branch: { type: String, enum: ['branch1', 'branch2'], required: true },

    // ── Flat total/latest fields (kept for full backward compatibility) ───────
    customer_payment_mode:  { type: String, default: '', trim: true },
    customer_amount_paid:   { type: Number, default: 0,  min: 0 },
    customer_payment_date:  { type: Date,   default: null },
    customer_txn_id:        { type: String, default: '', trim: true },

    insurance_applicable:   { type: Boolean, default: false },
    insurance_company:      { type: String,  default: '', trim: true },
    insurance_amount:       { type: Number,  default: 0,  min: 0 },
    insurance_payment_date: { type: Date,    default: null },
    insurance_reference_no: { type: String,  default: '', trim: true },

    notes: { type: String, default: '', trim: true },

    // ── History arrays (new) — empty array for legacy documents ──────────────
    customer_payments:  { type: [CustomerPaymentEntrySchema],  default: [] },
    insurance_payments: { type: [InsurancePaymentEntrySchema], default: [] },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

PaymentSchema.index({ ro_no: 1, branch: 1 }, { unique: true });
PaymentSchema.index({ branch: 1, updatedAt: -1 });

PaymentSchema.virtual('total_collected').get(function totalCollected() {
  return Number(this.customer_amount_paid || 0) + Number(this.insurance_amount || 0);
});

module.exports = mongoose.model('Payment', PaymentSchema);
