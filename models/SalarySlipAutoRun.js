const mongoose = require('mongoose');

// One row per payroll month the auto-emailer attempts. Serves two jobs: the unique
// monthYear index is the cross-process claim (the server runs more than one backend
// copy) and the row itself is the audit trail HR reads instead of server logs.
const salarySlipAutoRunSchema = new mongoose.Schema({
  monthYear: { type: String, required: true, unique: true },
  attempts: { type: Number, default: 0 },
  sent: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  alreadySent: { type: Number, default: 0 },
  activeEmployees: { type: Number, default: 0 },
  created: { type: Number, default: 0 },
  claimedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  runner: { type: String, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SalarySlipAutoRun', salarySlipAutoRunSchema);
