const mongoose = require('mongoose');

const personalTaskSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  task: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['todo', 'in-progress', 'done'],
    default: 'todo'
  },
  dueDate: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: ''
  }
}, { timestamps: true });

// Index for efficient querying by user
personalTaskSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('PersonalTask', personalTaskSchema);
