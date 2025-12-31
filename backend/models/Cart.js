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
cartSchema.methods.addItem = function(inventoryItem, quantity = 1, specificSerial = null) {
  // Check if item already exists in cart
  const existingItemIndex = this.items.findIndex(item => {
    if (specificSerial) {
      // If specific serial requested, match exactly
      return item.inventoryId.toString() === inventoryItem._id.toString() && 
             item.serial === specificSerial;
    } else {
      // If no specific serial, match inventory ID and no specific serial requested
      return item.inventoryId.toString() === inventoryItem._id.toString() && 
             !item.specificSerialRequested;
    }
  });

  if (existingItemIndex > -1) {
    // Update quantity of existing item
    this.items[existingItemIndex].quantity += quantity;
  } else {
    // Add new item to cart
    this.items.push({
      inventoryId: inventoryItem._id,
      brand: inventoryItem.label.split(' ')[0] || 'Unknown', // Extract brand from label
      model: inventoryItem.label.split(' ').slice(1).join(' ') || 'Unknown', // Extract model
      serial: specificSerial,
      quantity: quantity,
      specificSerialRequested: !!specificSerial
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