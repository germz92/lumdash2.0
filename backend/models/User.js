const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  fullName: {  // 🔥 changed from username
    type: String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  // Per-user archived events - stores event IDs that this user has archived
  archivedEvents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
