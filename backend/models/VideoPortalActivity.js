const mongoose = require('mongoose');

/**
 * VideoPortalActivity — audit trail for portal projects.
 * Covers team actions and client actions (opens, comments, approve / changes).
 */
const videoPortalActivitySchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'VideoProject', default: null, index: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },

  type: {
    type: String,
    required: true,
    enum: [
      'portal_opened',
      'project_viewed',
      'commented',
      'replied',
      'approved',
      'changes_requested',
      'version_uploaded',
      'delivered',
      'clients_notified',
      'due_set',
      'pp_linked',
      'thumbnail_updated',
      'digest_sent'
    ]
  },

  actorType: { type: String, enum: ['client', 'team', 'system'], default: 'team' },
  actorName: { type: String, default: '' },
  actorEmail: { type: String, default: '', lowercase: true, trim: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  message: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'videoportalactivities'
});

videoPortalActivitySchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('VideoPortalActivity', videoPortalActivitySchema);
