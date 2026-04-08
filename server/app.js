const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const scheduleRoutes = require('./routes/scheduleRoutes');


const app = express();

app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

app.use(helmet());
app.use(hpp());

/* CORS — allow all origins */
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/* Increase upload size limit */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api', limiter);

app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});


//kishan was here
app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/billing', require('./routes/billingRoutes'));
app.use('/api/v1/payments', require('./routes/paymentRoutes'));
app.use('/api/v1/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/v1/reports', require('./routes/reportRoutes'));
app.use('/api/v1/schedules', scheduleRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;