const mongoose = require('mongoose');

/** A reusable person who can be added to more than one event. */
const savedContactSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  role: { type: String, default: '', trim: true, maxlength: 120 },
  company: { type: String, default: '', trim: true, maxlength: 160 },
  phone: { type: String, default: '', trim: true, maxlength: 40 },
  email: { type: String, default: '', trim: true, lowercase: true, maxlength: 160 }
}, { timestamps: true, collection: 'savedcontacts' });

savedContactSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } }
);
savedContactSchema.index({ name: 1 });

module.exports = mongoose.model('SavedContact', savedContactSchema);
