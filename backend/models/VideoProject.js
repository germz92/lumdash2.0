const mongoose = require('mongoose');

/**
 * VideoProject — one deliverable for a client (e.g. "Highlight Reel — APM 2026").
 * Review versions are hosted on Bunny Stream; the delivered master stays in
 * Google Drive (masterFileUrl). Lifecycle: in_review → delivered → archived.
 *
 * reviewDecision tracks whether the client approved the current cut
 * (reset when a new version is uploaded). Feedback lives in comments.
 */
const videoVersionSchema = new mongoose.Schema({
  versionNumber: { type: Number, required: true },
  bunnyVideoId: { type: String, default: '' },
  // Mirrors Bunny transcoding: uploading → processing → ready / error
  videoStatus: {
    type: String,
    enum: ['uploading', 'processing', 'ready', 'error'],
    default: 'processing'
  },
  durationSeconds: { type: Number, default: 0 },
  notes: { type: String, default: '' }, // "what changed in this cut"
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  uploadedByName: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: true });

const reviewDecisionSchema = new mongoose.Schema({
  status: {
    type: String,
    // changes_requested kept for legacy records; new decisions are approve-only
    enum: ['none', 'approved', 'changes_requested'],
    default: 'none'
  },
  note: { type: String, default: '' },
  versionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  versionNumber: { type: Number, default: null },
  decidedByName: { type: String, default: '' },
  decidedByEmail: { type: String, default: '', lowercase: true, trim: true },
  decidedAt: { type: Date, default: null }
}, { _id: false });

const videoProjectSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },
  postProductionItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PostProductionItem',
    default: null,
    index: true
  },

  title: { type: String, required: true, trim: true },
  // Free-text legacy label; kept in sync with folder name when folderId is set
  category: { type: String, default: '', trim: true },
  folderId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

  status: {
    type: String,
    enum: ['in_review', 'delivered', 'archived'],
    default: 'in_review',
    index: true
  },

  reviewDecision: { type: reviewDecisionSchema, default: () => ({}) },

  // When client feedback is due (team sets this; reminder emailed once)
  feedbackDueAt: { type: Date, default: null, index: true },
  feedbackReminderSentAt: { type: Date, default: null },

  versions: [videoVersionSchema],

  // Custom gallery/player cover (Cloudinary). When set, overrides Bunny's auto thumbnail.
  customThumbnailUrl: { type: String, default: '' },
  customThumbnailPublicId: { type: String, default: '' },

  // Delivered master (Google Drive or similar) — shown in the client's Delivered gallery
  masterFileUrl: { type: String, default: '' },
  // When false, master link is hidden from the client portal even if delivered
  allowClientDownload: { type: Boolean, default: true },
  deliveredAt: { type: Date, default: null },
  deliveredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  deliveredByName: { type: String, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdByName: { type: String, default: '' }
}, {
  timestamps: true,
  collection: 'videoprojects'
});

videoProjectSchema.index({ clientId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('VideoProject', videoProjectSchema);
