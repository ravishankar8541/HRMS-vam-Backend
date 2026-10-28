require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const cors = require('cors');
const dbConnection = require('../config/db');

// Route Imports
const employeeRoute = require('../routes/employee');
const auth = require('../routes/auth');
const offerLetterRoutes = require('../routes/offerLetter');
const appointmentLetter = require('../routes/appointmentLetter');
const incrementRoutes = require('../routes/incrementLetter');
const terminationLetter = require('../routes/terminationLetter');
const onboardingRoutes = require('../routes/onboarding');
const salaryRoutes = require('../routes/salarySlip');
const fnfRoutes = require('../routes/fnf');
const documentRoutes = require('../routes/documentRoutes');

const PORT = process.env.PORT || 5000;

// CORS Middleware
app.use(cors({
  exposedHeaders: ['X-Document-Id'],
  origin: (origin, callback) => {
    const allowed = [
      'https://hrms.viraladsmedia.com',
      'http://hrms.viraladsmedia.com',
      ...(process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(v => v.trim())
    ];
    callback(null, !origin || allowed.includes(origin));
  }
}));

app.use(express.json({ limit: '1mb' }));

// Roll back newly uploaded assets when validation/database writes fail.
app.use((req, res, next) => {
  res.once('finish', () => {
    if (res.statusCode < 400) return;
    const { cloudinary } = require('../config/cloudinary');
    for (const files of Object.values(req.files || {})) {
      for (const file of files) {
        if (file.filename) {
          cloudinary.uploader.destroy(file.filename, {
            resource_type: file.resourceType || 'image',
            type: 'authenticated'
          }).catch(() => {});
        }
      }
    }
  });
  next();
});

// Static Files
const { authenticate, staffOnly } = require('../middleware/auth');
app.use('/uploads', authenticate, staffOnly, express.static(path.join(__dirname, '../uploads')));

// Routes Integration
app.use('/api/employee', authenticate, staffOnly, employeeRoute);
app.use('/api/auth', auth);
app.use('/api/offer-letters', authenticate, staffOnly, offerLetterRoutes);
app.use('/api/appointment-letters', authenticate, staffOnly, appointmentLetter);
app.use('/api/increment-letters', authenticate, staffOnly, incrementRoutes);
app.use('/api/termination-letters', authenticate, staffOnly, terminationLetter);
app.use('/api/onboarding', authenticate, staffOnly, onboardingRoutes);
app.use('/api/salarySlip', authenticate, staffOnly, salaryRoutes);
app.use('/api/fnf', authenticate, staffOnly, fnfRoutes);
app.use('/api/documents', authenticate, documentRoutes);
app.use('/api/offboarding', authenticate, staffOnly, require('../routes/offboarding'));

app.get('/health', (req, res) => {
  res.json({ status: 'active', timestamp: new Date() });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (['ValidationError', 'CastError', 'MulterError'].includes(err.name) ? 400 : 500);
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Server request failed' : err.message
  });
});

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

let startup = null;

const startServer = () => {
  if (!startup) {
    startup = (async () => {
      await dbConnection();
      const server = app.listen(PORT, () => console.log(`Server listening on ${PORT} (Node ${process.version})`));
      require('../utils/monthlySalaryScheduler').start();
      return server;
    })().catch(error => {
      startup = null;
      throw error;
    });
  }
  return startup;
};

// cPanel/Passenger loads the entry file with require(), so require.main !== module there.
const runningUnderPassenger = Boolean(process.env.PASSENGER_APP_ENV || process.env.PASSENGER_BASE_URI);

if (require.main === module || runningUnderPassenger) {
  startServer().catch(error => {
    console.error('Server startup failed:', error);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;