const mongoose = require('mongoose');

/**
 * Feedback — bug reports and feature requests submitted from the app.
 * Lifecycle: new → in_progress → completed / declined
 */
const feedbackSchema = new mongoose.Schema({
  type: { type: String, enum: ['bug', 'feature'], required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  page: { type: String, default: '' }, // which part of the app this concerns

  screenshotUrl: { type: String, default: '' },
  screenshotPublicId: { type: String, default: '' },

  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedByName: { type: String, default: '' },

  status: {
    type: String,
    enum: ['new', 'in_progress', 'completed', 'declined'],
    default: 'new'
  },
  adminNote: { type: String, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, default: '' },
  statusChangedAt: { type: Date, default: null }
}, {
  timestamps: true,
  collection: 'feedback'
});

feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ submittedBy: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
