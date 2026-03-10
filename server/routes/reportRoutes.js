const router = require('express').Router();
const auth = require('../middleware/auth');
const branchScope = require('../middleware/branchScope');
const { getReportSummary, exportPDF } = require('../controllers/reportController');

router.use(auth, branchScope);
router.get('/summary', getReportSummary);
router.get('/export', exportPDF);

module.exports = router;
