const pdf = require('./pdfEngine');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const { toWords } = require('number-to-words');

const readAsset = (file) => {
  try {
    return `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '../assets', file)).toString('base64')}`;
  } catch (err) {
    console.warn(`Asset missing for FNF Statement: ${file}`);
    return '';
  }
};

const amount = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
};
const money = (value) => amount(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// A negative net folds into parentheses so a recovery never reads as a payable.
const signed = (value) => (amount(value) < 0 ? `(${money(Math.abs(amount(value)))})` : money(value));
const words = (value) => {
  const abs = Math.abs(amount(value));
  const rupees = Math.floor(abs + 1e-9);
  const paise = Math.round((abs - rupees) * 100);
  const parts = [];
  if (rupees) parts.push(toWords(rupees));
  if (paise) parts.push(`${toWords(paise)} paise`);
  if (!parts.length) return 'Zero';
  const spelled = parts.join(' and ');
  return spelled.charAt(0).toUpperCase() + spelled.slice(1);
};
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const tenure = (from, to) => {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '—';
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  let days = end.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(end.getFullYear(), end.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts = [years && `${years} yr`, months && `${months} mo`, days && `${days} d`].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Less than 1 month';
};
const text = (value, fallback = '—') => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

const statusClasses = { Draft: 'st-draft', Approved: 'st-approved', Disbursed: 'st-disbursed', Settled: 'st-settled' };

const generateFNFPDF = async (data) => {
  const employeeId = text(data.employeeId);
  const payableRows = [
    { label: 'Unpaid / pro-rated salary', amount: money(data.pendingSalary) },
    { label: 'Leave encashment', amount: money(data.leaveEncashment) },
    { label: 'Bonus / performance incentive', amount: money(data.incentive) },
    { label: 'Gratuity', amount: money(data.gratuity) },
  ];
  const deductionRows = [
    { label: 'Notice period recovery', amount: money(data.noticeRecovery) },
    { label: 'Other deductions / tax', amount: money(data.deductions) },
  ];
  const totalPayable = amount(data.pendingSalary) + amount(data.leaveEncashment) + amount(data.incentive) + amount(data.gratuity);
  const totalDeductions = amount(data.noticeRecovery) + amount(data.deductions);
  const net = Math.round((totalPayable - totalDeductions) * 100) / 100;
  const settled = data.status === 'Disbursed' || data.status === 'Settled';
  const lastWorking = new Date(data.lastWorkingDay);
  const refYear = Number.isNaN(lastWorking.getTime()) ? new Date().getFullYear() : lastWorking.getFullYear();

  const html = await ejs.renderFile(path.join(__dirname, '../templates/fnfStatement.ejs'), {
    logo: readAsset('blackLogo.png'),
    hrSignature: readAsset('hrSignature.png'),
    refNo: `VAM/FNF/${employeeId === '—' ? 'EMP' : employeeId}/${refYear}`,
    issueDate: date(new Date()),
    status: text(data.status, 'Draft'),
    statusClass: statusClasses[data.status] || 'st-draft',
    employeeName: text(data.employeeName),
    employeeId,
    designation: text(data.designation, 'Employee'),
    phone: text(data.phone),
    email: text(data.email),
    address: text(data.address),
    dateOfJoining: date(data.dateOfJoining),
    lastWorkingDay: date(data.lastWorkingDay),
    tenure: tenure(data.dateOfJoining, data.lastWorkingDay),
    payableRows,
    deductionRows,
    subTotalPayable: money(totalPayable),
    subTotalDeductions: money(totalDeductions),
    netLabel: net < 0 ? 'NET AMOUNT RECOVERABLE' : 'NET SETTLEMENT PAYABLE',
    netAmount: signed(net),
    netWords: words(net),
    bankAccount: text(data.bankAccount),
    ifsc: text(data.ifsc),
    paymentReference: text(data.paymentReference, settled ? '—' : 'Not generated yet'),
    disbursedOn: data.paidAt ? date(data.paidAt) : (settled ? '—' : 'On payroll processing'),
    clearance: [
      { label: 'Company laptop / IT assets', value: data.laptopReturned ? 'Returned' : 'Not cleared', css: data.laptopReturned ? 'yes' : 'no' },
      { label: 'ID card & access badge', value: data.idCardReturned ? 'Returned' : 'Not cleared', css: data.idCardReturned ? 'yes' : 'no' },
      { label: 'HR & department clearance', value: data.clearanceApproved ? 'Completed' : 'Pending', css: data.clearanceApproved ? 'yes' : 'no' },
    ],
    remarks: text(data.remarks, ''),
  });

  const options = {
    format: 'A4',
    border: { top: '10mm', right: '14mm', bottom: '18mm', left: '14mm' },
  };

  return new Promise((resolve, reject) => {
    pdf.create(html, options).toBuffer((err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
};

module.exports = generateFNFPDF;
