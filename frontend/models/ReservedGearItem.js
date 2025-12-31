const mongoose = require('mongoose');

const reservedGearItemSchema = new mongoose.Schema({
  // Event and user association
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // List association
  listName: {
    type: String,
    required: true,
    default: 'Main List'
  },
  
  // Inventory item reference
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GearInventory',
    required: true
  },
  
  // Item details (cached for performance)
  brand: {
    type: String,
    required: true
  },
  model: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  
  // Reservation details
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  serial: {
    type: String,
    default: null // null if no specific serial requested
  },
  specificSerialRequested: {
    type: Boolean,
    default: false
  },
  
  // Packing status
  isPacked: {
    type: Boolean,
    default: false
  },
  packedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
reservedGearItemSchema.index({ eventId: 1, userId: 1 });
reservedGearItemSchema.index({ eventId: 1, listName: 1 });
reservedGearItemSchema.index({ inventoryId: 1 });

module.exports = mongoose.model('ReservedGearItem', reservedGearItemSchema); 