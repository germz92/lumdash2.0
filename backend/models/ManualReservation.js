const mongoose = require('mongoose');

const manualReservationSchema = new mongoose.Schema({
  // Person making the reservation
  personName: {
    type: String,
    required: true,
    trim: true
  },
  personEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  
  // Reservation dates. The aliases give a manual reservation the same date names as an
  // event gear line, so the scan check-out / check-in code can treat both alike.
  startDate: {
    type: Date,
    required: true,
    alias: 'checkOutDate',
    set: function(value) {
      if (!value) return value;
      const date = new Date(value);
      date.setUTCHours(0, 0, 0, 0);
      return date;
    }
  },
  endDate: {
    type: Date,
    required: true,
    alias: 'checkInDate',
    set: function(value) {
      if (!value) return value;
      const date = new Date(value);
      date.setUTCHours(0, 0, 0, 0);
      return date;
    }
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
  
  // Admin who created the reservation
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Notes (optional)
  notes: {
    type: String,
    default: ''
  },

  // Scan check-out / check-in state - same fields and meaning as on ReservedGearItem
  isPacked: { type: Boolean, default: false },
  packedAt: { type: Date, default: null },
  packedMethod: { type: String, enum: ['manual', 'scan', null], default: null },
  packedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  scannedOutQty: { type: Number, default: 0, min: 0 },
  returnedQty: { type: Number, default: 0, min: 0 },
  returnedAt: { type: Date, default: null },
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  returnMethod: { type: String, enum: ['scan', 'manual', 'auto', null], default: null }
}, {
  timestamps: true
});

// Small index covering only reservations that have been scanned out
manualReservationSchema.index(
  { scannedOutQty: 1 },
  { partialFilterExpression: { scannedOutQty: { $gt: 0 } } }
);

// Overdue = scanned out, not all scanned back in, and past the due date (same grace
// period as event gear: flagged from the morning after the due day)
const OVERDUE_GRACE_MS = 36 * 60 * 60 * 1000;
manualReservationSchema.virtual('isOverdue').get(function() {
  const stillOut = (this.scannedOutQty || 0) - (this.returnedQty || 0);
  if (stillOut <= 0 || !this.endDate) return false;
  return Date.now() > new Date(this.endDate).getTime() + OVERDUE_GRACE_MS;
});
manualReservationSchema.set('toJSON', { virtuals: true });

// Indexes for efficient queries
manualReservationSchema.index({ inventoryId: 1 });
manualReservationSchema.index({ startDate: 1, endDate: 1 });
manualReservationSchema.index({ personName: 1 });

// Virtual for checking if reservation is active
manualReservationSchema.virtual('isActive').get(function() {
  const now = new Date();
  return this.startDate <= now && this.endDate >= now;
});

// Virtual for checking if reservation is upcoming
manualReservationSchema.virtual('isUpcoming').get(function() {
  const now = new Date();
  return this.startDate > now;
});

// Virtual for checking if reservation is past
manualReservationSchema.virtual('isPast').get(function() {
  const now = new Date();
  return this.endDate < now;
});

module.exports = mongoose.model('ManualReservation', manualReservationSchema); 