const mongoose = require('mongoose');

// Helper function to normalize dates to UTC midnight
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

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
  
  // RESERVATION DATES (NEW - Critical for availability validation)
  checkOutDate: {
    type: Date,
    required: true,
    set: normalizeDate
  },
  checkInDate: {
    type: Date,
    required: true,
    set: normalizeDate,
    validate: {
      validator: function(value) {
        // checkInDate must be after checkOutDate
        return !this.checkOutDate || value >= this.checkOutDate;
      },
      message: 'Check-in date must be after check-out date'
    }
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
reservedGearItemSchema.index({ inventoryId: 1, checkOutDate: 1, checkInDate: 1 }); // NEW - for availability queries

// STATIC METHOD: Check availability for an inventory item across all reservations
reservedGearItemSchema.statics.getAvailableQuantity = async function(inventoryId, checkOutDate, checkInDate, excludeEventId = null) {
  const normalizeDate = (dateStr) => {
    const date = new Date(dateStr);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  
  const reqStart = normalizeDate(checkOutDate);
  const reqEnd = normalizeDate(checkInDate);
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  
  // Get the base inventory item
  const GearInventory = require('./GearInventory');
  const inventoryItem = await GearInventory.findById(inventoryId);
  if (!inventoryItem) {
    throw new Error('Inventory item not found');
  }
  
  let reservedQuantity = 0;
  
  // Check ReservedGearItem reservations for date overlaps
  const query = {
    inventoryId: inventoryId,
    // Only include reservations that overlap with our date range
    $and: [
      { checkOutDate: { $lte: reqEnd } },
      { checkInDate: { $gte: reqStart } },
      { checkInDate: { $gte: now } } // Exclude expired reservations
    ]
  };
  
  // Exclude current event if specified (for updates)
  if (excludeEventId) {
    query.eventId = { $ne: excludeEventId };
  }
  
  const overlappingReservations = await this.find(query);
  
  overlappingReservations.forEach(reservation => {
    reservedQuantity += reservation.quantity;
  });
  
  // Also check manual reservations
  const ManualReservation = require('./ManualReservation');
  const manualReservations = await ManualReservation.find({
    inventoryId: inventoryId,
    $and: [
      { startDate: { $lte: reqEnd } },
      { endDate: { $gte: reqStart } },
      { endDate: { $gte: now } } // Exclude expired reservations
    ]
  });
  
  manualReservations.forEach(reservation => {
    reservedQuantity += reservation.quantity;
  });
  
  return Math.max(0, inventoryItem.quantity - reservedQuantity);
};

module.exports = mongoose.model('ReservedGearItem', reservedGearItemSchema); 