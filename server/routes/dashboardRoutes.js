const router = require('express').Router();
const auth = require('../middleware/auth');
const branchScope = require('../middleware/branchScope');
const { getSummary, getRecent } = require('../controllers/dashboardController');

router.use(auth, branchScope);
router.get('/summary', getSummary);
router.get('/recent', getRecent);

module.exports = router;
