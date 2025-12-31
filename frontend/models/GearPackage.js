const mongoose = require('mongoose');

// Define the schema for gear packages (individual reserved items)
const gearPackageSchema = new mongoose.Schema({
  // For saved packages (collections of items)
  name: String,
  description: String,
  categories: {
    type: Map,
    of: [Object]
  },
  inventoryIds: [String],
  
  // For individual reserved items
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GearInventory'
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },
  userId: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    default: 1
  },
  serial: String, // Specific serial if requested
  specificSerialRequested: {
    type: Boolean,
    default: false
  },
  packed: {
    type: Boolean,
    default: false
  },
  reservedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries
gearPackageSchema.index({ userId: 1, eventId: 1 });
gearPackageSchema.index({ inventoryId: 1, eventId: 1 });

// Create and export the model
module.exports = mongoose.model('GearPackage', gearPackageSchema); 