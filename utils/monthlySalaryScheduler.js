const SalarySlip = require('../models/SalarySlip');
const Employee = require('../models/Employee');
const ensureMonthlySalarySlips = require('./monthlySalarySlips');
const salaryController = require('../controllers/salaryController');
const { today } = require('./istDate');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

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

const sendPreviousMonthSalarySlips = async (now = new Date()) => {
  const monthYear = previousMonthKey(today(now));

  const activeEmployees = await Employee.find({ status: { $ne: 'Non Active' } })
    .select('_id email empId')
    .lean();
  if (!activeEmployees.length) return { monthYear, sent: 0, failed: 0 };

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

  await ensureMonthlySalarySlips.ensurePreviousMonth(now);

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
  let sent = 0;
  let failed = 0;

  for (const employeeSlips of groups.values()) {
    // One payslip per employee per month: an already-sent copy (including a manual send) wins.
    if (employeeSlips.some(slip => slip.emailStatus === 'Sent')) continue;

    // Prefer the newest copy so an edited payslip replaces the auto-generated one.
    const latest = employeeSlips.reduce((newest, slip) => (sentTime(slip) > sentTime(newest) ? slip : newest));

    try {
      await salaryController.sendSalarySlipRecord(latest);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error(`Auto salary slip email failed for ${latest.employeeEmail} (${monthYear}):`, error.message);
      try {
        latest.emailStatus = 'Failed';
        await latest.save();
      } catch (saveError) {
        console.error('Could not mark salary slip email as failed:', saveError.message);
      }
    }
  }

  if (sent || failed) console.log(`Auto payslip emails for ${monthYear}: ${sent} sent, ${failed} failed`);
  return { monthYear, sent, failed };
};

let sending = false;

const runIfDue = async (now = new Date()) => {
  if (today(now).day !== 1) return { skipped: 'not-first-day' };
  if (sending) return { skipped: 'already-running' };
  sending = true;
  try {
    return await sendPreviousMonthSalarySlips(now);
  } finally {
    sending = false;
  }
};

const start = (intervalMs = CHECK_INTERVAL_MS) => {
  const tick = () => runIfDue().catch(error => console.error('Monthly salary email scheduler error:', error.message));
  tick();
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
};

module.exports = { start, runIfDue, sendPreviousMonthSalarySlips, previousMonthKey };
