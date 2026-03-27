// controllers/scheduleController.js
const Schedule = require('../models/Schedule');
const Billing = require('../models/BillingRecord');
const Payment = require('../models/Payment');

// GET /api/v1/schedules
exports.getSchedules = async (req, res) => {
  try {
    const filter = { branch: req.user.branch };
    const schedules = await Schedule.find(filter).sort({ deadline: 1 }).lean();

    // Enrich with billing + payment data
    const enriched = await Promise.all(schedules.map(async (s) => {
      const billing = await Billing.findOne({ ro_no: s.ro_no, branch: s.branch }).lean();
      const payment = await Payment.findOne({ ro_no: s.ro_no, branch: s.branch }).lean();

      const totalAmt = billing?.total_amt || 0;
      const customerPaid = payment?.customer_amount_paid || 0;
      const insurancePaid = payment?.insurance_amount || 0;
      const pendingAmount = totalAmt - customerPaid - insurancePaid;

      return {
        id: s._id,
        ro_no: s.ro_no,
        branch: s.branch,
        customer_name: billing?.customer_name || 'Unknown',
        total_amt: totalAmt,
        pending_amount: Math.max(0, pendingAmount),
        deadline: s.deadline,
        priority: s.priority,
        notes: s.notes,
        completed: s.completed,
        created_by: s.created_by,
        created_at: s.createdAt,
      };
    }));

    res.json({ success: true, schedules: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/v1/schedules
exports.createSchedule = async (req, res) => {
  try {
    const { ro_no, deadline, notes, priority } = req.body;

    // Verify the billing record exists
    const billing = await Billing.findOne({ ro_no, branch: req.user.branch });
    if (!billing) {
      return res.status(404).json({ success: false, error: 'Billing record not found' });
    }

    // Check for duplicate schedule
    const existing = await Schedule.findOne({ ro_no, branch: req.user.branch });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Schedule already exists for this RO' });
    }

    const schedule = await Schedule.create({
      ro_no,
      branch: req.user.branch,
      deadline: new Date(deadline),
      notes: notes || '',
      priority: priority || 'medium',
      created_by: req.user.id,
    });

    res.status(201).json({ success: true, schedule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// PUT /api/v1/schedules/:id
exports.updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    if (req.body.deadline) updates.deadline = new Date(req.body.deadline);
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.priority) updates.priority = req.body.priority;
    if (req.body.completed !== undefined) updates.completed = req.body.completed;

    const schedule = await Schedule.findOneAndUpdate(
      { _id: id, branch: req.user.branch },
      { $set: updates },
      { new: true }
    );

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    res.json({ success: true, schedule });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /api/v1/schedules/:id
exports.deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findOneAndDelete({ _id: id, branch: req.user.branch });

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    res.json({ success: true, message: 'Schedule deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};