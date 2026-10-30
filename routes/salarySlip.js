const express = require('express');
const { createSalarySlip, sendSalaryEmail } = require('../controllers/salaryController');
const { getAutoRunStatus, triggerAutoRun } = require('../controllers/salaryAutoRunController');

const router = express.Router();
// Import the salary slip controller functions


/**
 * @route   POST /api/salary-slips
 * @desc    Generate and save a new salary slip record
 * @access  Private (HR/Admin)
 */
router.post('/', createSalarySlip);

/**
 * @route   GET /api/salarySlip/auto-run
 * @desc    Per-month record of the automatic previous-month payslip emails
 * @access  Private (HR/Admin)
 */
router.get('/auto-run', getAutoRunStatus);

/**
 * @route   POST /api/salarySlip/auto-run/run
 * @desc    Force the automatic previous-month payslip pass now (already-sent staff are skipped)
 * @access  Private (HR/Admin)
 */
router.post('/auto-run/run', triggerAutoRun);

/**
 * @route   POST /api/salary-slips/:id/send
 * @desc    Generate PDF and email the salary slip to the employee
 * @access  Private (HR/Admin)
 */
router.post('/:id/send', sendSalaryEmail);

module.exports = router;