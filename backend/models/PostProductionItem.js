const mongoose = require('mongoose');

const postProductionReplySchema = new mongoose.Schema({
  text: { type: String, required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, default: '' },
  mentionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const postProductionUpdateSchema = new mongoose.Schema({
  text: { type: String, required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, default: '' },
  mentionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies: [postProductionReplySchema],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

/** @deprecated Legacy notes — migrated to updates on read */
const postProductionNoteSchema = new mongoose.Schema({
  text: { type: String, required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const postProductionItemSchema = new mongoose.Schema({
  item: { type: String, default: '', trim: true },
  project: { type: String, default: '', trim: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },
  editStatus: {
    type: String,
    enum: ['', 'working', 'stuck', 'done'],
    default: ''
  },
  qcStatus: {
    type: String,
    enum: ['', 'needs_revision', 'approved'],
    default: ''
  },
  deliveryStatus: {
    type: String,
    enum: ['', 'working', 'stuck', 'done'],
    default: ''
  },
  editorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  dueDate: { type: Date, default: null },
  updates: [postProductionUpdateSchema],
  notes: [postProductionNoteSchema],
  archived: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true,
  collection: 'postproductionitems'
});

postProductionItemSchema.index({ project: 1 });
postProductionItemSchema.index({ eventId: 1 });
postProductionItemSchema.index({ dueDate: 1 });
postProductionItemSchema.index({ editorId: 1 });
postProductionItemSchema.index({ ownerId: 1 });

module.exports = mongoose.model('PostProductionItem', postProductionItemSchema);
