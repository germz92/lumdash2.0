const mongoose = require('mongoose');

/** A personal "reviewed" flag. One user's mark does not change anyone else's card. */
const activityMarkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },
  itemKey: { type: String, required: true, maxlength: 300 },
  markedAt: { type: Date, default: Date.now }
}, { timestamps: true, collection: 'activitymarks' });

activityMarkSchema.index({ userId: 1, itemKey: 1 }, { unique: true });

module.exports = mongoose.model('ActivityMark', activityMarkSchema);
