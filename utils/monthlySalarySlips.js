const SalarySlip = require('../models/SalarySlip');
const Employee = require('../models/Employee');
const { today } = require('./istDate');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = (year, month) => `${MONTHS[month]}/${year}`;

const withinEmployment = (employee, year, month) => {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  const joined = employee.dateOfJoining ? new Date(employee.dateOfJoining) : null;
  if (joined && Number.isFinite(joined.getTime()) && joined > end) return false;
  const exited = employee.dateOfExit ? new Date(employee.dateOfExit) : null;
  if (exited && Number.isFinite(exited.getTime()) && exited < start) return false;
  return true;
};

const buildRecord = (employee, monthYear) => {
  const basic = Math.round(Number(employee.salary || 0) * 100) / 100;
  return {
    employee: employee._id,
    employeeId: employee.empId || `VAM-${String(employee._id).slice(-4).toUpperCase()}`,
    employeeName: employee.name,
    employeeEmail: String(employee.email || '').trim().toLowerCase(),
    designation: employee.designation || 'Staff',
    phone: employee.phoneNumber,
    ifsc: employee.ifscCode,
    panNumber: employee.panNumber,
    aadharNumber: employee.adharNumber,
    bankAccount: employee.accountNumber,
    joiningDate: employee.dateOfJoining ? new Date(employee.dateOfJoining).toISOString().slice(0, 10) : '',
    monthYear,
    workingDays: 30,
    lopDays: 0,
    basicSalary: basic,
    allowance: 0,
    bonus: 0,
    pfDeduction: 0,
    otherDeduction: 0,
    lopAmount: 0,
    grossEarnings: basic,
    totalDeductions: 0,
    netPayable: basic,
    emailStatus: 'Pending',
  };
};

const monthEntry = (year, month) => ({ year, month, monthYear: monthKey(year, month) });

const run = async (monthList) => {
  if (!monthList.length) return { created: 0 };

  const employees = await Employee.find({ salary: { $gt: 0 } })
    .select('name email empId designation dateOfJoining dateOfExit salary panNumber adharNumber accountNumber ifscCode phoneNumber')
    .lean();
  if (!employees.length) return { created: 0 };

  // Hidden rows are included so a payslip deleted from the vault is not recreated.
  const existing = await SalarySlip.find({ monthYear: { $in: monthList.map(entry => entry.monthYear) } })
    .select('employeeEmail monthYear')
    .lean();
  const taken = new Set(existing.map(s => `${String(s.employeeEmail || '').toLowerCase()}|${s.monthYear}`));

  const records = [];
  for (const employee of employees) {
    const email = String(employee.email || '').trim().toLowerCase();
    if (!email) continue;
    for (const { year, month, monthYear } of monthList) {
      const key = `${email}|${monthYear}`;
      if (taken.has(key) || !withinEmployment(employee, year, month)) continue;
      taken.add(key);
      records.push(buildRecord(employee, monthYear));
    }
  }

  if (records.length) await SalarySlip.insertMany(records, { ordered: false });
  return { created: records.length };
};

const currentYearMonths = now => {
  const { year, month } = today(now);
  return Array.from({ length: month + 1 }, (_, index) => monthEntry(year, index));
};

const previousMonth = now => {
  const { year, month } = today(now);
  return month === 0 ? [monthEntry(year - 1, 11)] : [monthEntry(year, month - 1)];
};

let inFlight = null;
let previousInFlight = null;

// One vault load at a time should prepare records; concurrent loads share the same work.
module.exports = (now = new Date()) => {
  if (!inFlight) inFlight = run(currentYearMonths(now)).finally(() => { inFlight = null; });
  return inFlight;
};

// Payroll email only needs last month; do not prepare the running month early.
module.exports.ensurePreviousMonth = (now = new Date()) => {
  if (!previousInFlight) previousInFlight = run(previousMonth(now)).finally(() => { previousInFlight = null; });
  return previousInFlight;
};
