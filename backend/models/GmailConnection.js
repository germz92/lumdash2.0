const mongoose = require('mongoose');

/** One mailbox per LumDash user. Tokens stay on the server. */
const gmailConnectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  email: { type: String, default: '', lowercase: true, trim: true },
  refreshTokenEnc: { type: String, default: '' },
  accessTokenEnc: { type: String, default: '' },
  accessTokenExpiresAt: { type: Date, default: null },
  connectedAt: { type: Date, default: null },
  lastSyncAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  syncVersion: { type: Number, default: 0 }
}, { timestamps: true, collection: 'gmailconnections' });

module.exports = mongoose.model('GmailConnection', gmailConnectionSchema);
