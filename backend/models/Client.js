const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Client — a company we deliver videos to.
 * People (contacts) each get a unique share-style portal link, scoped to
 * projects they are assigned on. The company shareToken is a full preview.
 * Optional portalPinHash gates the whole portal behind a shared PIN.
 */
const clientContactSchema = new mongoose.Schema({
  name: { type: String, default: '', trim: true },
  email: { type: String, default: '', lowercase: true, trim: true },
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

  // Company preview link — sees every project. Reviewers identify themselves by name.
  // People (contacts) have their own tokens, scoped to assigned videos.
  shareToken: {
    type: String,
    default: () => crypto.randomBytes(32).toString('hex')
  },

  // Optional shared PIN (bcrypt). When set, portal APIs require X-Portal-Unlock.
  portalPinHash: { type: String, default: '' },

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
