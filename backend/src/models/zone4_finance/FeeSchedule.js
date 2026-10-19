const mongoose = require('mongoose');

const FeeScheduleSchema = new mongoose.Schema({
    period: { type: String, required: true },
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null },
    classroomName: { type: String, default: '' },
    tuitionBase: { type: Number, required: true, min: 0 },
    mealFee: { type: Number, default: 0, min: 0 },
    busFee: { type: Number, default: 0, min: 0 },
    extraFee: { type: Number, default: 0, min: 0 },
    additionalItems: [{ name: { type: String, required: true }, amount: { type: Number, required: true, min: 0 } }],
    discount: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, required: true },
    note: { type: String, default: '', maxlength: 1000 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

FeeScheduleSchema.index({ period: 1, classroomId: 1 }, { unique: true });

module.exports = mongoose.model('FeeSchedule', FeeScheduleSchema);
