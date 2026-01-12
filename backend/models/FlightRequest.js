const mongoose = require('mongoose');

// Schema for airport information
const airportSchema = new mongoose.Schema({
  code: { type: String, required: true },
  city: { type: String, default: '' },
  name: { type: String, default: '' }
}, { _id: false });

// Schema for passenger on a flight request
const flightPassengerSchema = new mongoose.Schema({
  passengerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Passenger',
    required: true 
  },
  name: { type: String, required: true }
}, { _id: false });

// Schema for booked flight details (when a request is confirmed)
const bookedFlightDetailsSchema = new mongoose.Schema({
  airline: { type: String, default: '' },
  flightNumber: { type: String, default: '' },
  confirmationCode: { type: String, default: '' },
  departTime: { type: String, default: '' },
  arriveTime: { type: String, default: '' },
  duration: { type: String, default: '' },
  bookedAt: { type: Date, default: Date.now },
  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: false });

// Main FlightRequest schema
const flightRequestSchema = new mongoose.Schema({
  // Event association (optional - can be linked to an event)
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    default: null
  },
  eventName: {
    type: String,
    default: ''
  },
  
  // Request creator
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Trip type
  tripType: {
    type: String,
    enum: ['roundtrip', 'oneway'],
    default: 'roundtrip'
  },
  
  // Route information
  from: {
    type: airportSchema,
    required: true
  },
  to: {
    type: airportSchema,
    required: true
  },
  
  // Dates
  departDate: {
    type: Date,
    required: true
  },
  returnDate: {
    type: Date,
    default: null
  },
  
  // Time preferences
  departTimePreference: {
    type: String,
    enum: ['any', 'morning', 'afternoon', 'evening', 'redeye'],
    default: 'any'
  },
  returnTimePreference: {
    type: String,
    enum: ['any', 'morning', 'afternoon', 'evening', 'redeye'],
    default: 'any'
  },
  
  // Passengers
  passengers: [flightPassengerSchema],
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'booked', 'cancelled'],
    default: 'pending'
  },
  
  // Booked flight details (filled when status = 'booked')
  bookedDetails: bookedFlightDetailsSchema,
  
  // Return flight booked details (for roundtrip)
  returnBookedDetails: bookedFlightDetailsSchema,
  
  // Notes
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
flightRequestSchema.index({ status: 1, createdAt: -1 });
flightRequestSchema.index({ eventId: 1 });
flightRequestSchema.index({ createdBy: 1 });
flightRequestSchema.index({ departDate: 1 });

module.exports = mongoose.model('FlightRequest', flightRequestSchema);

