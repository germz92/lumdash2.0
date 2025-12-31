const mongoose = require('mongoose');

const packageTemplateSchema = new mongoose.Schema({
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
  items: [{
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
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isGlobal: {
    type: Boolean,
    default: true // All packages are global as per requirements
  }
}, {
  timestamps: true
});

// Index for efficient searching
packageTemplateSchema.index({ name: 1 });
packageTemplateSchema.index({ createdBy: 1 });

module.exports = mongoose.model('PackageTemplate', packageTemplateSchema); 