const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },

    empId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },

    department: {
      type: String,
      trim: true,
    },

    designation: {
      type: String,
      required: [true, "Designation is required"],
      trim: true,
    },

    salary: {
      type: Number,
      min: [0, "Salary cannot be negative"],
    },

    dateOfJoining: {
      type: Date,
    },

    dateOfExit: {
      type: Date,
      validate: {
        validator: function (value) {
          // Exit date must be after joining date
          if (!value || !this.dateOfJoining) return true;
          return value >= this.dateOfJoining;
        },
        message: "Exit date cannot be before joining date",
      },
    },

    dob: {
      type: Date,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    address: {
      type: String,
      trim: true,
    },

    phoneNumber: {
      type: String,
      trim: true,
    },

    fatherName: {
      type: String,
      trim: true,
    },

    emergencyContactNumber: {
      type: String,
      trim: true,
    },

    contactRelation: {
      type: String,
      trim: true,
    },

    bankName: {
      type: String,
      trim: true,
    },
    accountNumber: {
      type: String,
      trim: true,
    },

    ifscCode: {
      type: String,
      uppercase: true,
      trim: true,
    },

    maritalStatus: {
      type: String,
      enum: ["Single", "Married"],
    },

    adharNumber: {
      type: String,
      trim: true,
     // match: [/^\d{12}$/, "Aadhar must be 12 digits"],
    },

    panNumber: {
      type: String,
      uppercase: true,
      trim: true,
   //  match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format"],
    },
    uploadAssets: { type: mongoose.Schema.Types.Mixed, default: {} },
    photo: { type: String },
    adharCardDoc: { type: String }, // Mapped from idProof
    panCardDoc: { type: String },    // Mapped from addressProof
    educationProof: { type: String },
    experienceLetter: { type: String },
    bgVerification: { type: Boolean, default: false },
    onboardingStatus: { type: String, default: 'Pending' },
    status: {
      type: String,
      enum: ["Active", "Non Active"],
      default: "Active",
    }
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Employee", employeeSchema);