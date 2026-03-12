// routes/scheduleRoutes.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/scheduleController');

router.use(authenticate);

router.get('/', ctrl.getSchedules);
router.post('/', ctrl.createSchedule);        // staff only
router.put('/:id', ctrl.updateSchedule);       // staff + admin
router.delete('/:id', ctrl.deleteSchedule);    // staff only

module.exports = router;