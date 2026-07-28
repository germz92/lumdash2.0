const mongoose = require('mongoose');

/**
 * VideoComment — Frame.io-style feedback on a video version.
 * timecodeSeconds is null for general (non-timestamped) comments.
 * Authors are either team members (authorId) or client contacts (authorEmail).
 * annotation stores normalized drawing/arrow overlays for the paused frame.
 */
const commentReplySchema = new mongoose.Schema({
  text: { type: String, required: true },
  authorType: { type: String, enum: ['client', 'team'], required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  authorName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const mentionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: '' }
}, { _id: false });

const videoCommentSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoProject', required: true, index: true },
  versionId: { type: mongoose.Schema.Types.ObjectId, required: true },

  timecodeSeconds: { type: Number, default: null },
  // Optional range end (inclusive). Null = single-point comment at timecodeSeconds.
  timecodeEndSeconds: { type: Number, default: null },
  text: { type: String, required: true },

  // "Must fix" — surfaces above normal comments in review triage
  mustFix: { type: Boolean, default: false, index: true },

  // Drawing overlay on the paused frame (coords normalized 0–1)
  annotation: { type: mongoose.Schema.Types.Mixed, default: null },

  // Team @mentions (editors pinged on this comment)
  mentions: { type: [mentionSchema], default: [] },

  authorType: { type: String, enum: ['client', 'team'], required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  authorName: { type: String, default: '' },
  authorEmail: { type: String, default: '', lowercase: true, trim: true },

  resolved: { type: Boolean, default: false },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedByName: { type: String, default: '' },
  resolvedAt: { type: Date, default: null },

  replies: [commentReplySchema]
}, {
  timestamps: true,
  collection: 'videocomments'
});

videoCommentSchema.index({ projectId: 1, versionId: 1, createdAt: 1 });
videoCommentSchema.index({ mustFix: 1, resolved: 1, createdAt: -1 });

module.exports = mongoose.model('VideoComment', videoCommentSchema);
