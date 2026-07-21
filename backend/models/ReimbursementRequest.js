const mongoose = require('mongoose');

const reimbursementItemSchema = new mongoose.Schema({
  date: Date,
  category: { type: String, enum: ['meals', 'travel', 'misc'], default: 'misc' },
  amount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  attachmentUrl: String,
  attachmentPublicId: String,
  attachmentName: String
});

const reimbursementRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: String,
  userEmail: String,
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table' },
  eventName: String,
  description: { type: String, default: '' },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected'],
    default: 'draft'
  },
  dateSubmitted: Date,
  /** Set atomically when reviewer alerts (in-app + email) are sent — prevents duplicate webhook/change-stream delivery */
  submissionNotifiedAt: Date,
  totalAmount: { type: Number, default: 0 },
  items: [reimbursementItemSchema],
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedByName: { type: String, default: '' },
  reviewedAt: Date,
  reviewNotes: { type: String, default: '' }
}, {
  timestamps: true,
  collection: 'reimbursementrequests'
});

module.exports = mongoose.model('ReimbursementRequest', reimbursementRequestSchema);
