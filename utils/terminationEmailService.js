const deliverDocument = require('./deliverDocument');
const generateTerminationPDF = require('./terminationPdfGenerator');




/**
 * Sends a formal termination notice with PDF attachment
 * @param {string} to - Recipient email address
 * @param {Object} data - Employee and termination details
 */
const sendTerminationLetter = async (to, data) => {
  const transporter = { sendMail: options => deliverDocument(options, 'Termination Letter', data.employeeName, data._snapshotId) };
  const employeeName = data.employeeName || data.name;
  // Ensure we pass the designation and properly formatted date to the PDF generator
  const pdfBuffer = data._pdfBuffer || await generateTerminationPDF({ ...data, name: employeeName, email: data.email || data.employeeEmail, phoneNumber: data.phoneNumber || data.employeePhone });

  // Formatting date for the email body to match Viral Ads Media standards
  const formattedDate = data.lastWorkingDate ? new Date(data.lastWorkingDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }) : "Immediate Effect";

  // 2. Formal Email Template matching Viral Ads Media standards
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 8px;">
      <h2 style="color: #d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">Official Notice: Termination of Employment</h2>
      <p>Dear <strong>${employeeName}</strong>,</p>

      <p>This email serves as formal notification regarding the termination of your employment as <strong>${data.designation || 'Employee'}</strong> with <strong>Viral Ads Media</strong>, effective <strong>${formattedDate}</strong>.</p>

      <p>Please find the official <strong>Termination Letter</strong> attached to this email. This document outlines the details of your final settlement, property return requirements, and clearance formalities.</p>

      <div style="background: #fff5f5; padding: 15px; border-left: 4px solid #d9534f; margin: 20px 0;">
        <strong style="color: #d9534f;">Immediate Actions Required:</strong><br>
        1. Please review the attached document carefully.<br>
        2. Ensure all company property (laptop, access cards, etc.) is returned by your final date.<br>
        3. Complete all department-level clearance for final settlement processing.
      </div>

      <p>Should you have any questions regarding your final dues or the clearance process, please reply to this email or contact the HR department directly.</p>

      <p style="margin-top: 30px; border-top: 1px solid #eee; pt: 10px;">
        Regards,<br>
        <strong>HR Department</strong><br>
        <strong>Viral Ads Media</strong> | Digital Creative Agency<br>
        B-27, Budh Vihar Phase 1, Delhi-110086
      </p>
    </div>
  `;

  const mailOptions = {
    from: `"Viral Ads Media HR" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Official Notice: Termination of Employment | ${employeeName}`,
    html: emailHtml,
    attachments: [{
      // Formats filename as Termination_Letter_FirstName_LastName.pdf
      filename: `Termination_Letter_${String(employeeName).replace(/\s+/g, '_')}.pdf`,
      content: pdfBuffer,
    }],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    console.error("Email Error:", error);
    throw new Error("Failed to send termination email: " + error.message);
  }
};

module.exports = sendTerminationLetter;