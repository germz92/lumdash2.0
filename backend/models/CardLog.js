const mongoose = require('mongoose');

const cardLogSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  logs: [
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
  ]
}, { timestamps: true });

module.exports = mongoose.model('CardLog', cardLogSchema);
