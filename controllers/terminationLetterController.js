const archive = require('../utils/documentArchive');
const errorStatus = require('../utils/errorStatus');
const Termination = require('../models/TerminationLetter');
const sendTerminationLetter = require('../utils/terminationEmailService'); // or '../utils/sendTerminationLetter' depending on your filename

/**
 * Create a new termination record
 * @route   POST /api/termination-letters
 * @access  Private (admin/HR)
 */
const createTermination = async (req, res) => {
  try {
    const {
      employeeName,
      email,
      phoneNumber,
      designation,
      lastWorkingDate,
      reason,
      hrName,
      employeeId,
    } = req.body;

    // Basic validation
    if (!employeeName || !email || !designation || !lastWorkingDate || !reason || !hrName) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: employeeName, email, lastWorkingDate, reason, hrName',
      });
    }

    // Generate unique reference ID
    const refId = `TM/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;

    const terminationRecord = await Termination.create({
      employeeId: employeeId || undefined, // optional reference to Employee
      employeeName: employeeName.trim(),
      employeeEmail: email.trim().toLowerCase(),
      employeePhone: phoneNumber ? phoneNumber.trim() : undefined,
      designation: designation.trim(),
      lastWorkingDate: new Date(lastWorkingDate),
      reason: reason.trim(),
      hrName: hrName.trim(),
      noticeDate: new Date(),
    });

    const snapshot = await archive.ensure('Termination Letter', terminationRecord);

    return res.status(201).json({
      success: true,
      message: 'Termination record created successfully',
      refId,
      documentId: snapshot._id, data: terminationRecord,
    });
  } catch (err) {
    console.error('Create termination error:', err);
    return res.status(errorStatus(err)).json({
      success: false,
      message: 'Failed to create termination record',
      error: err.message,
    });
  }
};

/**
 * Send termination letter email to employee
 * @route   POST /api/termination-letters/:id/send
 * @access  Private (admin/HR)
 */
const sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email: emailFromBody } = req.body;

    // Find the termination record
    const terminationRecord = await Termination.findById(id);
    if (!terminationRecord) {
      return res.status(404).json({
        success: false,
        message: 'Termination record not found',
      });
    }

    // Use email from body if provided, otherwise fall back to stored employeeEmail
    const recipientEmail = emailFromBody?.trim() || terminationRecord.employeeEmail;

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'No recipient email available (neither in body nor in record)',
      });
    }

    // Send the email (with PDF if generation succeeds)
    await sendTerminationLetter(recipientEmail, await archive.emailData('Termination Letter', terminationRecord));

    // Update status only after successful send
    terminationRecord.emailStatus = 'Sent';
    await terminationRecord.save();

    return res.json({
      success: true,
      message: 'Termination letter sent successfully',
      sentTo: recipientEmail,
    });
  } catch (err) {
    console.error('Send termination email error:', err);

    return res.status(errorStatus(err)).json({
      success: false,
      message: 'Failed to send termination email',
      error: err.message,
    });
  }
};

module.exports = {
  createTermination,
  sendEmail,
};