const router = require('express').Router();
const auth = require('../middleware/auth');
const branchScope = require('../middleware/branchScope');
const adminOnly = require('../middleware/adminOnly');
const {
  getPayment,
  savePayment,
  updateCustomerPayment,
  clearCustomerPayment,
  updateInsurancePayment,
  clearInsurancePayment,
} = require('../controllers/paymentController');

router.use(auth, branchScope);
router.get('/:ro_no', getPayment);
router.put('/:ro_no', savePayment);
router.put('/:ro_no/customer', updateCustomerPayment);
router.delete('/:ro_no/customer', adminOnly, clearCustomerPayment);
router.put('/:ro_no/insurance', updateInsurancePayment);
router.delete('/:ro_no/insurance', adminOnly, clearInsurancePayment);

module.exports = router;
