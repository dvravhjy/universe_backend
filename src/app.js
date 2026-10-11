const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { corsOrigins, isTest } = require('./config/env');
const { notFound, errorHandler } = require('./middleware/common');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser clients (no Origin header) and whitelisted origins
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed by CORS'));
    },
  })
);
app.use(express.json({ limit: '100kb' }));
if (!isTest) app.use(morgan('combined'));

// Global rate limit + stricter limit on auth endpoints (brute-force protection)
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 100000 : 300, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? Number(process.env.TEST_AUTH_LIMIT || 100000) : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});
app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', system: 'UniServe' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/student', require('./routes/student'));
app.use('/api/registrar', require('./routes/registrar'));
app.use('/api/cashier', require('./routes/cashier'));
app.use('/api/department', require('./routes/department'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/notifications', require('./routes/notifications'));

// Single-service deployment: serve the built React app (frontend/dist) from the API server
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (!isTest && fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
