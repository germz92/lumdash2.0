const mongoose = require('mongoose');

const kitItemSchema = new mongoose.Schema({
  brand: {
    type: String,
    required: true,
    trim: true
  },
  model: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  }
}, { _id: false });

kitItemSchema.pre('validate', function(next) {
  if (!this.brand || !this.model) {
    return next(new Error('Kit items require brand and model'));
  }
  if (!this.category) {
    return next(new Error('Kit items require a category'));
  }
  next();
});

const kitSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  items: {
    type: [kitItemSchema],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

kitSchema.index({ name: 1 });
kitSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Kit', kitSchema);
