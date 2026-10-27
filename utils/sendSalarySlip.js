const deliverDocument = require('./deliverDocument');
const pdf = require('./pdfEngine');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const { formatINR, getNetPayWords } = require('./salarySlipFormatting');

const getAssetBase64 = (filename) => {
  const searchPaths = [
    path.join(__dirname, '../assets', filename),
    path.join(__dirname, '../public', filename),
    path.join(process.cwd(), 'assets', filename),
    path.join(process.cwd(), 'public', filename),
    path.join(__dirname, '../../frontend/public', filename),
    path.join(__dirname, '../../HRMS-frontend-21Sept/public', filename),
    path.join(process.cwd(), '../public', filename),
  ];

  for (const filePath of searchPaths) {
    if (fs.existsSync(filePath)) {
      try {
        const bitmap = fs.readFileSync(filePath);
        return `data:image/png;base64,${bitmap.toString('base64')}`;
      } catch (err) {}
    }
  }
  return "";
};

const sendSalarySlip = async (email, data) => {
  const transporter = { sendMail: options => deliverDocument(options, 'Salary Slip', data.employeeName, data._snapshotId) };
  try {
    const templatePath = path.join(__dirname, '../templates/salarySlip.ejs');

    const logoBase64 = getAssetBase64('blackLogo.png');
    const hrSignatureBase64 = getAssetBase64('hrSignature.png');

    const html = await ejs.renderFile(templatePath, {
      logo: logoBase64,
      hrSignature: hrSignatureBase64,
      companyName: 'VIRAL ADS MEDIA',
      payMonth: data.monthYear || '—',
      netPayWords: getNetPayWords(data.netPayable),
      employeeName: data.employeeName || '—',
      employeeId: data.employeeId || '—',
      designation: data.designation || '—',
      joiningDate: data.joiningDate || '—',
      panNumber: data.panNumber || '—',
      aadharNumber: data.aadharNumber || '—',
      bankAccount: data.bankAccount || '—',
      ifsc: data.ifsc || '—',
      phone: data.phone || '—',
      workingDays: data.workingDays || 30,
      lopDays: data.lopDays || 0,
      basicSalary: formatINR(data.basicSalary),
      allowance: formatINR(data.allowance),
      bonus: formatINR(data.bonus),
      lopAmount: formatINR(data.lopAmount),
      pfDeduction: formatINR(data.pfDeduction),
      otherDeduction: formatINR(data.otherDeduction),
      grossEarnings: formatINR(data.grossEarnings),
      totalDeductions: formatINR(data.totalDeductions),
      netPayable: formatINR(data.netPayable),
    });

    const pdfBuffer = data._pdfBuffer || await new Promise((resolve, reject) => {
      pdf.create(html, {
        format: 'A4',
        border: { top: '8mm', right: '10mm', bottom: '8mm', left: '10mm' },
        quality: '100',
        renderDelay: 1000,
        timeout: 30000,
      }).toBuffer((err, buffer) => (err ? reject(err) : resolve(buffer)));
    });



    const safeName = (data.employeeName || "Employee").replace(/[^a-zA-Z0-9]/g, '_');
    const safeMonth = (data.monthYear || "Period").replace(/[^a-zA-Z0-9]/g, '-');

    await transporter.sendMail({
      from: `"Viral Ads Media Payroll" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Payslip - ${data.monthYear || 'Current Period'} | ${data.employeeName || 'Employee'}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 22px; border-radius: 10px;">
          <h2 style="color: #f27022; margin-top: 0;">Salary Payslip - ${data.monthYear}</h2>
          <p>Dear <strong>${data.employeeName || 'Employee'}</strong>,</p>
          <p>Your official salary payslip for <strong>${data.monthYear || 'the period'}</strong> is attached to this email.</p>
          <div style="background: #fff8f5; border-left: 4px solid #f27022; padding: 12px 16px; margin: 18px 0; border-radius: 4px;">
            <strong>Net Pay Credited:</strong> ₹ ${formatINR(data.netPayable)}<br>
            <strong>Disbursed Period:</strong> ${data.monthYear}
          </div>
          <p>For any payroll or tax queries, feel free to contact the HR & Accounts department.</p>
          <p style="margin-top: 25px; border-top: 1px solid #eee; padding-top: 12px; font-size: 12px; color: #777;">
            Best Regards,<br>
            <strong>Viral Ads Media HR Team</strong><br>
            B-27, Budh Vihar Phase 1, New Delhi-110086
          </p>
        </div>
      `,
      attachments: [{
        filename: `Payslip_${safeName}_${safeMonth}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    return true;
  } catch (error) {
    console.error('Error in sendSalarySlip:', error);
    throw error;
  }
};

module.exports = sendSalarySlip;
