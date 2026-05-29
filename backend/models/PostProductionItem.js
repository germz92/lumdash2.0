const mongoose = require('mongoose');

const postProductionLinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  label: { type: String, default: '' }
}, { _id: true });

const postProductionAttachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  originalName: { type: String, default: '' },
  fileType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  cloudinaryPublicId: { type: String, default: '' }
}, { _id: true });

const postProductionReplySchema = new mongoose.Schema({
  text: { type: String, default: '' },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, default: '' },
  mentionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  links: [postProductionLinkSchema],
  attachments: [postProductionAttachmentSchema],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const postProductionUpdateSchema = new mongoose.Schema({
  text: { type: String, default: '' },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  authorName: { type: String, default: '' },
  mentionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  links: [postProductionLinkSchema],
  attachments: [postProductionAttachmentSchema],
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
  /** @deprecated Use editorIds — kept for legacy queries and sort */
  editorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  editorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  collaboratorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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
postProductionItemSchema.index({ editorIds: 1 });
postProductionItemSchema.index({ collaboratorIds: 1 });
postProductionItemSchema.index({ ownerId: 1 });

module.exports = mongoose.model('PostProductionItem', postProductionItemSchema);
