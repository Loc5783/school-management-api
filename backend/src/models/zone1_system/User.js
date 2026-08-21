const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'principal', 'teacher', 'accountant', 'chef', 'guard', 'parent'],
        required: true
    },
    profile: {
        fullName: {
            type: String,
            required: true
        },
        phone: String,
        email: String,
        address: String
    },
    employeeInfo: {
        employeeId: String,
        hireDate: Date,
        baseSalary: Number,
        position: String
    },
    parentInfo: {
        studentIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Student'
        }]
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'locked'],
        default: 'active'
    },
    lastLogin: Date
}, {
    timestamps: true
});

module.exports = mongoose.model('User', UserSchema);