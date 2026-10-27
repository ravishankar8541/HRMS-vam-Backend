const archive = require('../utils/documentArchive');
const errorStatus = require('../utils/errorStatus');
const IncrementLetter = require('../models/IncrementLetter');
const Employee = require('../models/Employee');
const mongoose = require('mongoose');
const sendIncrementLetter = require('../utils/incrementEmailService');

// The letter can be linked directly, or matched by the employee's registered email / employee ID.
const resolveEmployee = async (record) => {
  if (mongoose.isValidObjectId(record.employee)) {
    const linked = await Employee.findById(record.employee);
    if (linked) return linked;
  }
  const email = String(record.emailId || '').trim().toLowerCase();
  if (email) {
    const byEmail = await Employee.findOne({ email });
    if (byEmail) return byEmail;
  }
  const empId = String(record.employeeId || '').trim().toUpperCase();
  if (empId && empId !== 'N/A') {
    const byId = await Employee.findOne({ empId });
    if (byId) return byId;
  }
  return null;
};

exports.createIncrement = async (req, res) => {
  try {
    const {
      employeeName,
      fathersName,
      address,
      phoneNumber,
      emailId,
      employeeId,
      department,
      position,
      currentSalary,
      newSalary,
      incrementPercentage,
      effectiveDate,
      hrName,
      performanceRemarks,
      reasonForIncrement
    } = req.body;

    if (!employeeName || !emailId || !position || !currentSalary || !newSalary || !effectiveDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: employeeName, emailId, position, currentSalary, newSalary, effectiveDate'
      });
    }

    const calculatedPercentage = incrementPercentage || 
      (((Number(newSalary) - Number(currentSalary)) / Number(currentSalary)) * 100).toFixed(2);

    const incrementId = `INC/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;

    const record = await IncrementLetter.create({
      incrementId,
      employeeName: employeeName.trim(),
      fathersName: fathersName ? fathersName.trim() : 'N/A',
      address: address ? address.trim() : 'N/A',
      phoneNumber: phoneNumber ? phoneNumber.trim() : 'N/A',
      emailId: emailId.trim().toLowerCase(),
      employeeId: employeeId || 'N/A',
      department: department || 'Technology',
      position: position.trim(),
      currentSalary: Number(currentSalary),
      newSalary: Number(newSalary),
      incrementPercentage: Number(calculatedPercentage),
      effectiveDate: new Date(effectiveDate),
      hrName: hrName ? hrName.trim() : 'HR Manager',
      performanceRemarks: performanceRemarks || '',
      reasonForIncrement: reasonForIncrement || 'Performance appraisal'
    });

    const snapshot = await archive.ensure('Increment Letter', record);

    return res.status(201).json({
      success: true,
      message: 'Increment letter generated successfully',
      incrementId,
      documentId: snapshot._id, data: record
    });
  } catch (error) {
    console.error('Create Increment Error:', error);
    return res.status(errorStatus(error)).json({ success: false, message: error.message });
  }
};

exports.sendEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    const record = await IncrementLetter.findById(id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Increment letter record not found' });
    }

    const recipient = (email || record.emailId).trim();
    await sendIncrementLetter(recipient, await archive.emailData('Increment Letter', record));

    record.emailStatus = 'Sent';

    let employee = null;
    try {
      employee = await resolveEmployee(record);
      if (employee && !record.employee) record.employee = employee._id;
    } catch (error) {
      console.error('Resolve employee after increment email error:', error);
    }
    await record.save();

    let salaryUpdated = false;
    if (employee && Number.isFinite(Number(record.newSalary))) {
      try {
        // Never let an older letter overwrite a newer increment that was already applied.
        const newer = await IncrementLetter.exists({
          _id: { $ne: record._id },
          emailStatus: 'Sent',
          effectiveDate: { $gt: record.effectiveDate },
          $or: [{ emailId: record.emailId }, ...(record.employee ? [{ employee: record.employee }] : [])],
        });
        if (!newer) {
          employee.salary = Number(record.newSalary);
          await employee.save();
          salaryUpdated = true;
        }
      } catch (error) {
        console.error('Salary sync after increment email error:', error);
      }
    }

    return res.json({
      success: true,
      message: `Increment letter sent successfully to ${recipient}`,
      salaryUpdated,
      employeeMatched: Boolean(employee)
    });
  } catch (error) {
    console.error('Send Increment Email Error:', error);
    return res.status(errorStatus(error)).json({ success: false, message: error.message });
  }
};