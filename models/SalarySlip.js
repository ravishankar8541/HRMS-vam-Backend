const mongoose = require('mongoose');

const salarySlipSchema = new mongoose.Schema({
  // Link to the Employee document (optional)
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: false
  },

  // Snapshots for document integrity
  employeeId: {
    type: String,
    required: true,
    trim: true // e.g., "VAM-A5FC"
  },
  employeeName: {
    type: String,
    required: true,
    trim: true
  },
  employeeEmail: {
    type: String,
    required: true,
    lowercase: true
  },
  designation: {
    type: String,
    required: true
  },
  phone: {
  type: String
},

ifsc: {
  type: String
},


  // Compliance & Banking
  panNumber: { type: String, uppercase: true },
  aadharNumber: { type: String },
  bankAccount: { type: String },
  joiningDate: { type: String },

  // Attendance Data
  monthYear: {
    type: String,
    required: true // e.g., "JAN/2026"
  },
  workingDays: {
    type: Number,
    default: 30
  },
  lopDays: {
    type: Number,
    default: 0
  },

  // Financial components (stored as received + calculated snapshots)
  basicSalary: {
    type: Number,
    required: true
  },
  allowance: {
    type: Number,
    default: 0
  },
  bonus: {
    type: Number,
    default: 0
  },
  pfDeduction: {          // renamed from pf for clarity
    type: Number,
    default: 0
  },
  otherDeduction: {
    type: Number,
    default: 0
  },

  // Calculated snapshots (for integrity & PDF/email consistency)
  lopAmount: {
    type: Number,
    default: 0
  },
  grossEarnings: {
    type: Number,
    required: true
  },
  totalDeductions: {
    type: Number,
    default: 0
  },
  netPayable: {
    type: Number,
    required: true
  },

  // Status Tracking
  emailStatus: {
    type: String,
    enum: ['Sent', 'Pending', 'Failed'],
    default: 'Pending'
  },
  generatedBy: {
    type: String
  },
  // Set when HR removes an auto-prepared payslip from the vault.
  hiddenAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for fast lookup
salarySlipSchema.index({ employeeEmail: 1, monthYear: 1 });
salarySlipSchema.index({ employeeId: 1 });

module.exports = mongoose.model('SalarySlip', salarySlipSchema);