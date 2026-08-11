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
    enum: ['user', 'admin', 'planner', 'production_manager'],
    default: 'user'
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordExpires: {
    type: Date
  },
  profilePhoto: {
    type: String,
    default: null
  },
  profilePhotoPublicId: {
    type: String,
    default: null
  },
  // Per-user archived events - stores event IDs that this user has archived
  archivedEvents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  }],
  // Extensible user preferences (notifications, appearance, etc.)
  settings: {
    notifications: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
