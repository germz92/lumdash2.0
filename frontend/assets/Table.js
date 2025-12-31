const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
  title: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  rows: [
    {
      date: Date,
      role: String,
      name: String,
      startTime: String,
      endTime: String,
      totalHours: Number,
      notes: String
    }
  ],
  general: {
    location: String,
    weather: String,
    start: String,
    end: String,
    client: String, // ✅ Added client field
    attendees: Number,
    budget: String,
    contacts: [
      {
        name: String,
        number: String,
        email: String,
        role: String
      }
    ]
  },
  gear: {
    type: mongoose.Schema.Types.Mixed, // accepts object of arrays
    default: {}
  },
  travel: [
    {
      date: String,
      time: String,
      airline: String,
      name: String,
      ref: String
    }
  ],
  accommodation: [
    {
      date: String,
      time: String,
      hotel: String,
      name: String,
      ref: String
    }
  ],
  cardLog: [
    {
      date: String,
      entries: [
        {
          camera: String,
          card1: String,
          card2: String,
          user: String
        }
      ]
    }
  ],
  programSchedule: {
    type: Array,
    default: []
  },
}, { timestamps: true });

module.exports = mongoose.model('Table', tableSchema);
