const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  ro_no: { type: String, required: true, index: true },
  branch: { type: String, required: true, index: true },
  deadline: { type: Date, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  notes: { type: String, default: '' },
  completed: { type: Boolean, default: false },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('Schedule', scheduleSchema);