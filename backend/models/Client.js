const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Client — a company/person we deliver videos to.
 * Each contact gets a personal magic-link token for the public video portal
 * (same pattern as CrewAvailabilityRequest — no client accounts/passwords).
 */
const clientContactSchema = new mongoose.Schema({
  name: { type: String, default: '', trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  token: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(32).toString('hex')
  },
  invitedAt: { type: Date, default: null },
  lastAccessAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

const clientFolderSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sortOrder: { type: Number, default: 0 }
}, { _id: true });

const clientBrandingSchema = new mongoose.Schema({
  displayName: { type: String, default: '', trim: true },
  logoUrl: { type: String, default: '' },
  logoPublicId: { type: String, default: '' },
  accentColor: { type: String, default: '#CC0007', trim: true }
}, { _id: false });

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  notes: { type: String, default: '' },
  contacts: [clientContactSchema],
  folders: { type: [clientFolderSchema], default: [] },
  branding: { type: clientBrandingSchema, default: () => ({}) },

  // One link for the whole client team — reviewers identify themselves by name.
  // Personal contact tokens above remain for tracked/revocable access.
  shareToken: {
    type: String,
    default: () => crypto.randomBytes(32).toString('hex')
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' },
  archived: { type: Boolean, default: false }
}, {
  timestamps: true,
  collection: 'portalclients'
});

clientSchema.index({ name: 1 });
clientSchema.index({ 'contacts.token': 1 });
clientSchema.index({ shareToken: 1 });

module.exports = mongoose.model('Client', clientSchema);
