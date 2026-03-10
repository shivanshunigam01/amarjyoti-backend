const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { signToken } = require('../utils/token');

exports.login = catchAsync(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw new AppError('Username and password are required', 400);
  }

  const user = await User.findOne({ username: String(username).toLowerCase().trim() });

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid username or password', 401);
  }

  if (!user.isActive) {
    throw new AppError('User account is inactive', 401);
  }

  const token = signToken(user);

  res.status(200).json({
    success: true,
    token,
    user: {
      id: user._id,
      username: user.username,
      role: user.role,
      branch: user.branch,
      branchName: user.branchName,
      displayName: user.displayName,
    },
  });
});

exports.getMe = catchAsync(async (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      username: req.user.username,
      role: req.user.role,
      branch: req.user.branch,
      branchName: req.user.branchName,
      displayName: req.user.displayName,
    },
  });
});

exports.logout = catchAsync(async (req, res) => {
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});
