const mongoose = require('mongoose');
const crypto = require('crypto');

const inviteSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  role: {
    type: String,
    enum: ['user', 'planner', 'admin', 'production_manager'],
    default: 'user'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  usedAt: { type: Date, default: null },
  usedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

inviteSchema.index({ email: 1, usedAt: 1, revokedAt: 1 });
inviteSchema.index({ expiresAt: 1 });

inviteSchema.methods.isActive = function() {
  if (this.usedAt || this.revokedAt) return false;
  return this.expiresAt > new Date();
};

module.exports = mongoose.model('Invite', inviteSchema);
