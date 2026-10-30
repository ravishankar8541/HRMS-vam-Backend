const AutoRun = require('../models/SalarySlipAutoRun');
const scheduler = require('../utils/monthlySalaryScheduler');
const { today, TIME_ZONE } = require('../utils/istDate');

const describe = run => ({
  monthYear: run.monthYear,
  attempts: run.attempts,
  sent: run.sent,
  failed: run.failed,
  alreadySent: run.alreadySent,
  activeEmployees: run.activeEmployees,
  created: run.created,
  claimedAt: run.claimedAt,
  finishedAt: run.finishedAt,
  lastError: run.lastError,
  runner: run.runner,
  state: run.finishedAt
    ? 'Delivered'
    : run.attempts >= scheduler.MAX_ATTEMPTS
      ? 'Retries exhausted'
      : run.claimedAt
        ? 'In progress'
        : 'Waiting',
});

const getAutoRunStatus = async (req, res) => {
  try {
    const targetMonthYear = scheduler.previousMonthKey(today());
    const runs = await AutoRun.find().sort({ createdAt: -1 }).limit(12).lean();
    const lastRun = runs.find(run => run.monthYear === targetMonthYear);
    return res.json({
      success: true,
      targetMonthYear,
      timeZone: TIME_ZONE,
      checkIntervalMs: scheduler.CHECK_INTERVAL_MS,
      maxAttempts: scheduler.MAX_ATTEMPTS,
      lastRun: lastRun ? describe(lastRun) : null,
      history: runs.map(describe),
    });
  } catch (error) {
    console.error('Auto payslip status error:', error);
    return res.status(500).json({ success: false, message: 'Could not read the auto payslip log' });
  }
};

const triggerAutoRun = async (req, res) => {
  try {
    const summary = await scheduler.runNow();
    return res.json({
      success: true,
      ...summary,
      message: `${summary.sent} sent, ${summary.failed} failed, ${summary.alreadySent} already delivered`,
    });
  } catch (error) {
    console.error('Manual payslip run error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getAutoRunStatus, triggerAutoRun };
