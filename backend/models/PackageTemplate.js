const mongoose = require('mongoose');
const { isLensCategory, normalizeLensClass } = require('../constants/lensClasses');

const packageTemplateItemSchema = new mongoose.Schema({
  matchType: {
    type: String,
    enum: ['model', 'class'],
    default: 'model'
  },
  lensClass: {
    type: String,
    trim: true,
    default: null
  },
  brand: {
    type: String,
    trim: true,
    default: ''
  },
  model: {
    type: String,
    trim: true,
    default: ''
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

packageTemplateItemSchema.pre('validate', function(next) {
  const matchType = this.matchType || 'model';
  this.matchType = matchType;

  if (matchType === 'class') {
    const resolvedClass = normalizeLensClass(this.lensClass);
    if (!resolvedClass) {
      return next(new Error('Class template items require a valid lens class'));
    }
    this.lensClass = resolvedClass;
    if (!isLensCategory(this.category)) {
      this.category = 'Lenses';
    }
    this.brand = this.brand || '';
    this.model = this.model || '';
    return next();
  }

  if (!this.brand || !this.model) {
    return next(new Error('Model template items require brand and model'));
  }
  next();
});

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
  items: [packageTemplateItemSchema],
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
