const mongoose = require('mongoose');

const eventKitItemSchema = new mongoose.Schema({
  brand: {
    type: String,
    required: true,
    trim: true
  },
  model: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  }
}, { _id: false });

const eventKitSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    required: true
  },
  listName: {
    type: String,
    required: true,
    default: 'Main List'
  },
  // One id per copy of a kit on a gear list (so two Headshot Booth Kits stay separate)
  instanceId: {
    type: String,
    required: true,
    trim: true
  },
  kitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Kit',
    default: null
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Snapshot of the kit's items at the moment it was added
  items: {
    type: [eventKitItemSchema],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true
});

eventKitSchema.index({ eventId: 1, listName: 1 });
eventKitSchema.index({ eventId: 1, instanceId: 1 }, { unique: true });

module.exports = mongoose.model('EventKit', eventKitSchema);
