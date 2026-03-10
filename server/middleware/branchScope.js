module.exports = function branchScope(req, res, next) {
  req.branchFilter = { branch: req.user.branch };
  next();
};
