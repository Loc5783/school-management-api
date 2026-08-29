const mongoose = require('mongoose');

const isValidObjectId = (value) => mongoose.isValidObjectId(value);

module.exports = { isValidObjectId };
