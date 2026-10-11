const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { User } = require('../models');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findByPk(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Account unavailable' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'You do not have permission to do this' });
  }
  next();
};

module.exports = { authenticate, requireRole };
