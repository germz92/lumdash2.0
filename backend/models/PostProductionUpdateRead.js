const mongoose = require('mongoose');

const postProductionUpdateReadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'PostProductionItem', required: true },
  lastReadAt: { type: Date, default: Date.now }
}, {
  collection: 'postproductionupdatereads'
});

postProductionUpdateReadSchema.index({ userId: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model('PostProductionUpdateRead', postProductionUpdateReadSchema);
