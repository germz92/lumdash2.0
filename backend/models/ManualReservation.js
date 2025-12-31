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
  
  // Reservation dates
  startDate: {
    type: Date,
    required: true,
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
  }
}, {
  timestamps: true
});

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