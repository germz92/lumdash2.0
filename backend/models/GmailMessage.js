const mongoose = require('mongoose');

/** A Gmail thread from one user's inbox that matched a client or event contact. */
const gmailMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gmailId: { type: String, required: true },
  threadId: { type: String, default: '' },
  rfc822Id: { type: String, default: '' },
  fromEmail: { type: String, default: '', lowercase: true },
  fromName: { type: String, default: '' },
  subject: { type: String, default: '' },
  snippet: { type: String, default: '' },
  sentAt: { type: Date, default: null },
  eventIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Table' }]
}, { timestamps: true, collection: 'gmailmessages' });

gmailMessageSchema.index({ userId: 1, gmailId: 1 }, { unique: true });
gmailMessageSchema.index({ userId: 1, eventIds: 1, sentAt: -1 });

module.exports = mongoose.model('GmailMessage', gmailMessageSchema);
