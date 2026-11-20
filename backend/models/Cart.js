const mongoose = require('mongoose');

// Helper function to normalize dates to UTC midnight
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

const cartItemSchema = new mongoose.Schema({
  inventoryId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'GearInventory', 
    required: true 
  },
  brand: String,
  model: String,
  serial: String, // null if no specific serial selected
  quantity: { 
    type: Number, 
    required: true, 
    min: 1 
  },
  specificSerialRequested: { 
    type: Boolean, 
    default: false 
  },
  // Kit membership — items from different kit instances must not merge
  kitInstanceId: {
    type: String,
    default: null,
    trim: true
  },
  kitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Kit',
    default: null
  },
  kitName: {
    type: String,
    default: null,
    trim: true
  }
}, { _id: true });

const cartSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  eventId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Table', 
    required: true 
  },
  checkOutDate: { 
    type: Date, 
    required: true,
    set: normalizeDate  // Normalize to UTC midnight on save
  },
  checkInDate: { 
    type: Date, 
    required: true,
    set: normalizeDate  // Normalize to UTC midnight on save
  },
  items: [cartItemSchema]
}, { 
  timestamps: true,
  // Ensure one cart per user per event
  index: { userId: 1, eventId: 1 }
});

// Compound unique index to ensure one cart per user per event
cartSchema.index({ userId: 1, eventId: 1 }, { unique: true });

// Method to add item to cart
// kitTag: optional { kitInstanceId, kitId, kitName } — items from different kits never merge
cartSchema.methods.addItem = function(inventoryItem, quantity = 1, specificSerial = null, kitTag = null) {
  const kitInstanceId = kitTag?.kitInstanceId || null;
  const kitId = kitTag?.kitId || null;
  const kitName = kitTag?.kitName || null;
  const sameKit = (item) => {
    const itemKit = item.kitInstanceId || null;
    return itemKit === kitInstanceId;
  };

  // Check if item already exists in cart (same unit + same kit instance)
  const existingItemIndex = this.items.findIndex(item => {
    if (!sameKit(item)) return false;
    if (specificSerial) {
      return item.inventoryId.toString() === inventoryItem._id.toString() &&
             item.serial === specificSerial;
    }
    return item.inventoryId.toString() === inventoryItem._id.toString() &&
           !item.specificSerialRequested;
  });

  if (existingItemIndex > -1) {
    this.items[existingItemIndex].quantity += quantity;
  } else {
    this.items.push({
      inventoryId: inventoryItem._id,
      brand: inventoryItem.label.split(' ')[0] || 'Unknown',
      model: inventoryItem.label.split(' ').slice(1).join(' ') || 'Unknown',
      serial: specificSerial,
      quantity: quantity,
      specificSerialRequested: !!specificSerial,
      kitInstanceId,
      kitId,
      kitName
    });
  }
};

// Method to remove item from cart
cartSchema.methods.removeItem = function(cartItemId) {
  this.items = this.items.filter(item => item._id.toString() !== cartItemId);
};

// Method to update item quantity
cartSchema.methods.updateItemQuantity = function(cartItemId, newQuantity) {
  const item = this.items.find(item => item._id.toString() === cartItemId);
  if (item) {
    if (newQuantity <= 0) {
      this.removeItem(cartItemId);
    } else {
      item.quantity = newQuantity;
    }
  }
};

// Method to clear cart
cartSchema.methods.clearCart = function() {
  this.items = [];
};

// Method to get total item count
cartSchema.methods.getTotalItems = function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
};

module.exports = mongoose.model('Cart', cartSchema); 