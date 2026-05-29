const mongoose = require('mongoose');

const postProductionAssignmentSeenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'PostProductionItem', required: true },
  seenAt: { type: Date, default: Date.now }
}, {
  collection: 'postproductionassignmentseen'
});

postProductionAssignmentSeenSchema.index({ userId: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model('PostProductionAssignmentSeen', postProductionAssignmentSeenSchema);
