const mongoose = require('mongoose');

const StudentCodeCounterSchema = new mongoose.Schema({
    year: { type: Number, required: true, unique: true },
    sequence: { type: Number, required: true, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('StudentCodeCounter', StudentCodeCounterSchema);
