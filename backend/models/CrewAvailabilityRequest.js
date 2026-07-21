const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * One availability request per person per event per send.
 * Crew respond per day (per crew row) via a public magic-link page — no login required.
 */
const crewAvailabilityRequestSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  email: { type: String, required: true, lowercase: true, trim: true },
  name: { type: String, default: '' },

  // Crew rows (person-days) covered by this request
  rowIds: [{ type: mongoose.Schema.Types.ObjectId }],

  token: {
    type: String,
    required: true,
    unique: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },

  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sentAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },

  // Per-day responses (snapshot of what the crew member answered)
  responses: [{
    rowId: { type: mongoose.Schema.Types.ObjectId },
    date: String,
    role: String,
    status: { type: String, enum: ['accepted', 'declined'] }
  }],

  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

crewAvailabilityRequestSchema.index({ eventId: 1, email: 1 });

crewAvailabilityRequestSchema.methods.isActive = function() {
  if (this.revokedAt) return false;
  return this.expiresAt > new Date();
};

module.exports = mongoose.model('CrewAvailabilityRequest', crewAvailabilityRequestSchema);
