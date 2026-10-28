const archive = require('../utils/documentArchive');
const errorStatus = require('../utils/errorStatus');
// Renamed the variable to match the actual service being used
const sendAppointmentLetter = require('../utils/appointmentEmailService');
const AppointmentLetter = require('../models/AppointmentLetter');

// STEP 1: Create the record in DB new 
const createAppointment = async (req, res) => {
    try {
        const { employeeName, fathersName, address, position, salary, joiningDate, hrName, phone,
            email } = req.body;

        const offerId = `HRMS/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;

        const appointment = await AppointmentLetter.create({
            offerId,
            employeeName,
            fathersName,
            address,
            position,
            salary: Number(salary),
            joiningDate: new Date(joiningDate),
            hrName,
            phone, 
            email
        });
        

    const snapshot = await archive.ensure('Appointment Letter', appointment);

        res.status(201).json({
            success: true,
            message: "Appointment details saved",
            id: appointment._id,
            documentId: snapshot._id, data: appointment
        });
    } catch (err) {
        res.status(errorStatus(err)).json({ success: false, message: err.message });
    }
};

// STEP 2: Send the Email with PDF
const sendEmail = async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;

        const appointment = await AppointmentLetter.findById(id);

        if (!appointment) {
            return res.status(404).json({ success: false, message: 'Appointment record not found' });
        }
        

        // Using the renamed function here
        await sendAppointmentLetter(email || appointment.email, await archive.emailData('Appointment Letter', appointment));

        res.json({
            success: true,
            message: `Appointment letter sent successfully to ${email}`
        });
    } catch (err) {
        res.status(errorStatus(err)).json({ success: false, message: err.message });
    }
};

module.exports = { createAppointment, sendEmail };