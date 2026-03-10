const router = require('express').Router();
const { login, getMe, logout } = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/login', login);
router.get('/me', auth, getMe);
router.post('/logout', auth, logout);

module.exports = router;
