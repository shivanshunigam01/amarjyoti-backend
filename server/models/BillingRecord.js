const mongoose = require('mongoose');

const BillingRecordSchema = new mongoose.Schema(
  {
    ro_no: { type: String, required: true, trim: true },
    bill_no: { type: String, required: true, trim: true },
    bill_date: { type: Date, required: true },
    customer_name: { type: String, required: true, trim: true },
    vin: { type: String, default: '', trim: true },
    vehicle_reg_no: { type: String, default: '', trim: true },
    model: { type: String, default: '', trim: true },
    ro_date: { type: Date, default: null },
    service_advisor: { type: String, default: '', trim: true },
    total_amt: { type: Number, required: true, min: 0 },
    /** Portion of total_amt billed to insurance (optional; from upload or manual entry). */
    insurance_bill_amount: { type: Number, min: 0 },
    /** Portion of total_amt payable by customer (optional; from upload or manual entry). */
    customer_bill_amount: { type: Number, min: 0 },
    ins_comp_name: { type: String, default: 'No Insurance Claim', trim: true },
    branch: { type: String, enum: ['branch1', 'branch2'], required: true },
     paid_amount: { type: Number, default: 0 },
    remaining_amount: { type: Number, default: 0 },
    payment_mode: { type: String, default: '' },
  },
  { timestamps: true }
);

BillingRecordSchema.index({ ro_no: 1, branch: 1 }, { unique: true });
BillingRecordSchema.index({ branch: 1, bill_date: -1 });
BillingRecordSchema.index({ branch: 1, customer_name: 1 });
BillingRecordSchema.index({ branch: 1, vehicle_reg_no: 1 });
BillingRecordSchema.index({ branch: 1, service_advisor: 1 });

module.exports = mongoose.model('BillingRecord', BillingRecordSchema);
