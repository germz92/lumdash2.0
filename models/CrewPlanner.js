const mongoose = require('mongoose');

const CrewPlannerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Structure: dates array containing date and events data
  dates: [{
    date: {
      type: String,
      required: true
    },
    events: [{
      name: {
        type: String,
        required: true
      },
      location: {
        type: String,
        default: ''
      },
      // Array of crew assignments for this event on this date
      crew: [{
        role: {
          type: String,
          default: ''
        },
        crewMember: {
          type: String,
          default: ''
        }
      }]
    }]
  }]
});

// Update the updatedAt field before saving
CrewPlannerSchema.pre('save', function() {
  this.updatedAt = new Date();
});

// Index for efficient queries
CrewPlannerSchema.index({ createdBy: 1, createdAt: -1 });
CrewPlannerSchema.index({ name: 1 });

module.exports = mongoose.model('CrewPlanner', CrewPlannerSchema);
