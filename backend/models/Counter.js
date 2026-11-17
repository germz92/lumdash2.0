const mongoose = require('mongoose');

// Named sequences (e.g. the next gear asset tag number).
// Incremented atomically with findOneAndUpdate + $inc so two saves never get the same number.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model('Counter', counterSchema);
