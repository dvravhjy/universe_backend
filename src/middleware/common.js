const { validationResult } = require('express-validator');

// Wrap async route handlers so errors reach the error handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Return 400 with details when express-validator found problems
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
  }
  next();
}

function notFound(req, res) {
  res.status(404).json({ error: 'Route not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (process.env.NODE_ENV !== 'test') console.error(err);
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'A record with that value already exists' });
  }
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({ error: err.errors.map((e) => e.message).join(', ') });
  }
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
}

module.exports = { wrap, validate, notFound, errorHandler };
