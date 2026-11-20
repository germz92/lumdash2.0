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
  },
  // How the line was packed: ticked by hand, or scanned out with a barcode / QR scanner.
  // isPacked stays the single "is it packed" flag so progress counts keep working.
  packedMethod: {
    type: String,
    enum: ['manual', 'scan', null],
    default: null
  },
  packedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Units of this line confirmed by scanning out (0..quantity)
  scannedOutQty: {
    type: Number,
    default: 0,
    min: 0
  },

  // Check-in (return) status
  returnedQty: {
    type: Number,
    default: 0,
    min: 0
  },
  returnedAt: {
    type: Date,
    default: null // set once everything that went out is back
  },
  returnedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // 'auto' = closed out because the same unit was scanned out for a later event
  returnMethod: {
    type: String,
    enum: ['scan', 'manual', 'auto', null],
    default: null
  },

  // Kit membership — one instanceId per copy of a kit on this list
  kitInstanceId: {
    type: String,
    default: null,
    trim: true
  },
  kitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Kit',
    default: null
  },
  kitName: {
    type: String,
    default: null,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
reservedGearItemSchema.index({ eventId: 1, userId: 1 });
reservedGearItemSchema.index({ eventId: 1, listName: 1 });
reservedGearItemSchema.index({ inventoryId: 1 });
reservedGearItemSchema.index({ inventoryId: 1, checkOutDate: 1, checkInDate: 1 }); // NEW - for availability queries
// Small index covering only lines that have been scanned out (for "what is still out" lookups)
reservedGearItemSchema.index(
  { scannedOutQty: 1 },
  { partialFilterExpression: { scannedOutQty: { $gt: 0 } } }
);
reservedGearItemSchema.index(
  { eventId: 1, kitInstanceId: 1 },
  { partialFilterExpression: { kitInstanceId: { $type: 'string' } } }
);

// Check-in dates are stored as UTC midnight of the due day. Gear only counts as
// overdue from the morning AFTER the due day in US time zones (36h after that
// UTC midnight), so nothing is flagged while it is still being returned on the day.
const OVERDUE_GRACE_MS = 36 * 60 * 60 * 1000;
reservedGearItemSchema.statics.OVERDUE_GRACE_MS = OVERDUE_GRACE_MS;

// Overdue = scanned out, not all scanned back in, and past the check-in date.
// Included in API responses so every screen applies the same rule.
reservedGearItemSchema.virtual('isOverdue').get(function() {
  const stillOut = (this.scannedOutQty || 0) - (this.returnedQty || 0);
  if (stillOut <= 0 || !this.checkInDate) return false;
  return Date.now() > new Date(this.checkInDate).getTime() + OVERDUE_GRACE_MS;
});
reservedGearItemSchema.set('toJSON', { virtuals: true });

// STATIC METHOD: Check availability for an inventory item across all reservations
reservedGearItemSchema.statics.getAvailableQuantity = async function(inventoryId, checkOutDate, checkInDate, excludeEventId = null) {
  const { utcDay, utcDayAfter, reservedQtyForRequest, stillHoldingMongo } = require('../services/reservationHold');

  const reqStart = utcDay(checkOutDate);
  const reqEnd = utcDay(checkInDate);
  const now = utcDay(new Date());
  const packedByEndOfReq = utcDayAfter(reqEnd);
  const stillHolding = stillHoldingMongo();

  const GearInventory = require('./GearInventory');
  const inventoryItem = await GearInventory.findById(inventoryId);
  if (!inventoryItem) {
    throw new Error('Inventory item not found');
  }

  // Normal date overlap, plus anything still physically held that packed early
  const eventQuery = {
    inventoryId,
    checkInDate: { $gte: now },
    $or: [
      { checkOutDate: { $lte: reqEnd }, checkInDate: { $gte: reqStart } },
      { packedAt: { $ne: null, $lt: packedByEndOfReq }, ...stillHolding }
    ]
  };
  if (excludeEventId) {
    eventQuery.eventId = { $ne: excludeEventId };
  }

  const ManualReservation = require('./ManualReservation');
  const [eventLines, manualLines] = await Promise.all([
    this.find(eventQuery),
    ManualReservation.find({
      inventoryId,
      endDate: { $gte: now },
      $or: [
        { startDate: { $lte: reqEnd }, endDate: { $gte: reqStart } },
        { packedAt: { $ne: null, $lt: packedByEndOfReq }, ...stillHolding }
      ]
    })
  ]);

  let reservedQuantity = 0;
  for (const line of eventLines) reservedQuantity += reservedQtyForRequest(line, reqStart, reqEnd);
  for (const line of manualLines) reservedQuantity += reservedQtyForRequest(line, reqStart, reqEnd);

  return Math.max(0, inventoryItem.quantity - reservedQuantity);
};

module.exports = mongoose.model('ReservedGearItem', reservedGearItemSchema); 