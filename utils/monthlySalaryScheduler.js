const os = require('os');
const SalarySlip = require('../models/SalarySlip');
const Employee = require('../models/Employee');
const AutoRun = require('../models/SalarySlipAutoRun');
const ensureMonthlySalarySlips = require('./monthlySalarySlips');
const salaryController = require('../controllers/salaryController');
const { today } = require('./istDate');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// A pass with failures stays open so the next tick retries only the undelivered people;
// the bound stops a permanently bad address from re-running for the rest of the month.
const MAX_ATTEMPTS = 5;

// A claim older than this belongs to a process that died or slept mid-send, so it is
// safe to take over: anything already emailed is marked Sent and will be skipped.
const STALE_CLAIM_MS = 2 * 60 * 60 * 1000;

const RUNNER = `${os.hostname()}:${process.pid}`;

const previousMonthKey = ({ year, month }) =>
  month === 0 ? `${MONTHS[11]}/${year - 1}` : `${MONTHS[month - 1]}/${year}`;

const sentTime = slip => new Date(slip.updatedAt || slip.createdAt || 0).getTime() || 0;

const groupByEmployee = (slips, resolveEmployee) => {
  const groups = new Map();
  for (const slip of slips) {
    const employee = resolveEmployee(slip);
    if (!employee) continue;
    const key = String(employee._id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slip);
  }
  return groups;
};

const deliver = async (monthYear, now = new Date()) => {
  const prepared = await ensureMonthlySalarySlips.ensurePreviousMonth(now);

  const activeEmployees = await Employee.find({ status: { $ne: 'Non Active' } })
    .select('_id email empId')
    .lean();

  const summary = {
    monthYear,
    activeEmployees: activeEmployees.length,
    created: prepared.created,
    sent: 0,
    failed: 0,
    alreadySent: 0,
    lastError: null,
  };
  if (!activeEmployees.length) return summary;

  const byId = new Map();
  const byEmail = new Map();
  const byEmpId = new Map();
  for (const employee of activeEmployees) {
    byId.set(String(employee._id), employee);
    const email = String(employee.email || '').trim().toLowerCase();
    if (email) byEmail.set(email, employee);
    const empId = String(employee.empId || '').trim().toUpperCase();
    if (empId) byEmpId.set(empId, employee);
  }

  const slips = await SalarySlip.find({
    monthYear,
    hiddenAt: null,
    $or: [
      { employee: { $in: activeEmployees.map(employee => employee._id) } },
      { employeeEmail: { $in: [...byEmail.keys()] } },
      { employeeId: { $in: [...byEmpId.keys()] } },
    ],
  });

  const resolveEmployee = slip => {
    if (slip.employee && byId.has(String(slip.employee))) return byId.get(String(slip.employee));
    const email = String(slip.employeeEmail || '').trim().toLowerCase();
    if (byEmail.has(email)) return byEmail.get(email);
    const empId = String(slip.employeeId || '').trim().toUpperCase();
    return byEmpId.get(empId) || null;
  };

  const groups = groupByEmployee(slips, resolveEmployee);
  const failures = [];

  for (const employeeSlips of groups.values()) {
    // One payslip per employee per month: an already-sent copy (including a manual send) wins.
    if (employeeSlips.some(slip => slip.emailStatus === 'Sent')) {
      summary.alreadySent += 1;
      continue;
    }

    // Prefer the newest copy so an edited payslip replaces the auto-generated one.
    const latest = employeeSlips.reduce((newest, slip) => (sentTime(slip) > sentTime(newest) ? slip : newest));

    try {
      await salaryController.sendSalarySlipRecord(latest);
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      failures.push(`${latest.employeeEmail}: ${error.message}`);
      console.error(`Auto salary slip email failed for ${latest.employeeEmail} (${monthYear}):`, error.message);
      try {
        latest.emailStatus = 'Failed';
        await latest.save();
      } catch (saveError) {
        console.error('Could not mark salary slip email as failed:', saveError.message);
      }
    }
  }

  summary.lastError = failures.length ? failures.slice(0, 5).join(' | ') : null;
  console.log(
    `Auto payslip emails for ${monthYear}: ${summary.sent} sent, ${summary.failed} failed, `
    + `${summary.alreadySent} already delivered (${RUNNER})`
  );
  return summary;
};

const claimRun = async (monthYear, now) => {
  await AutoRun.updateOne(
    { monthYear },
    { $setOnInsert: { monthYear, attempts: 0 } },
    { upsert: true }
  );
  return AutoRun.findOneAndUpdate(
    {
      monthYear,
      finishedAt: null,
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ claimedAt: null }, { claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    { $set: { claimedAt: now, runner: RUNNER }, $inc: { attempts: 1 } },
    { new: true }
  );
};

const releaseRun = async (run, summary) => {
  const delivered = summary.failed === 0;
  await AutoRun.updateOne(
    { _id: run._id },
    {
      $set: {
        sent: summary.sent,
        failed: summary.failed,
        alreadySent: summary.alreadySent,
        activeEmployees: summary.activeEmployees,
        created: summary.created,
        lastError: summary.lastError,
        claimedAt: delivered ? run.claimedAt : null,
        finishedAt: delivered ? new Date() : null,
      },
    }
  );
};

const abandonRun = async (run, error) => {
  await AutoRun.updateOne(
    { _id: run._id },
    { $set: { claimedAt: null, lastError: error.message } }
  );
};

const skipReason = async monthYear => {
  const run = await AutoRun.findOne({ monthYear }).lean();
  if (!run) return 'no-run-record';
  if (run.finishedAt) return 'delivered';
  if (run.attempts >= MAX_ATTEMPTS) return 'attempts-exhausted';
  return 'in-progress';
};

let running = false;

const runIfDue = async (now = new Date()) => {
  const monthYear = previousMonthKey(today(now));
  if (running) return { monthYear, skipped: 'already-running' };
  running = true;
  try {
    const run = await claimRun(monthYear, now);
    if (!run) return { monthYear, skipped: await skipReason(monthYear) };
    try {
      const summary = await deliver(monthYear, now);
      await releaseRun(run, summary);
      return summary;
    } catch (error) {
      await abandonRun(run, error);
      console.error(`Auto payslip pass for ${monthYear} aborted:`, error.message);
      return { monthYear, skipped: 'aborted', error: error.message };
    }
  } finally {
    running = false;
  }
};

// HR escape hatch: re-scan the payroll month on demand. It ignores the ledger but keeps
// the per-employee "already Sent" guard, so nobody receives a duplicate payslip.
const runNow = (now = new Date()) => deliver(previousMonthKey(today(now)), now);

const start = (intervalMs = CHECK_INTERVAL_MS) => {
  const tick = () => runIfDue().catch(error => console.error('Monthly salary email scheduler error:', error.message));
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
};

module.exports = {
  start,
  runIfDue,
  runNow,
  previousMonthKey,
  CHECK_INTERVAL_MS,
  MAX_ATTEMPTS,
};
