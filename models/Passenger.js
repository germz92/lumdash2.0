const mongoose = require('mongoose');

// Passenger schema for flight booking
const passengerSchema = new mongoose.Schema({
  // Name fields
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  middleName: {
    type: String,
    default: '',
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  
  // Personal information
  dateOfBirth: {
    type: Date,
    default: null
  },
  gender: {
    type: String,
    enum: ['', 'male', 'female', 'other'],
    default: ''
  },
  
  // Travel document info
  knownTravelerNumber: {
    type: String,
    default: '',
    trim: true
  },
  passportNumber: {
    type: String,
    default: '',
    trim: true
  },
  passportExpiration: {
    type: Date,
    default: null
  },
  
  // Loyalty programs (can have multiple)
  rewardsNumbers: [{
    airline: { type: String, default: '' },
    number: { type: String, default: '' }
  }],
  
  // Simple rewards field for backward compatibility
  rewards: {
    type: String,
    default: '',
    trim: true
  },
  
  // Additional notes
  notes: {
    type: String,
    default: ''
  },
  
  // Contact info (optional)
  email: {
    type: String,
    default: '',
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    default: '',
    trim: true
  },
  
  // Link to user account (if passenger is also a user)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Created by (the user who added this passenger)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Active status
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual for full name
passengerSchema.virtual('fullName').get(function() {
  const parts = [this.firstName];
  if (this.middleName) parts.push(this.middleName);
  parts.push(this.lastName);
  return parts.join(' ');
});

// Ensure virtuals are included in JSON
passengerSchema.set('toJSON', { virtuals: true });
passengerSchema.set('toObject', { virtuals: true });

// Indexes
passengerSchema.index({ lastName: 1, firstName: 1 });
passengerSchema.index({ createdBy: 1 });
passengerSchema.index({ isActive: 1 });

module.exports = mongoose.model('Passenger', passengerSchema);

