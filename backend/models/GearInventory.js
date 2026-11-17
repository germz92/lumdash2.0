const mongoose = require('mongoose');
const Counter = require('./Counter');

// Helper function to normalize dates to UTC midnight
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

// Asset tags are what the printed QR / barcode labels encode, e.g. "LD-00123".
// Kept short and uppercase-alphanumeric so the QR code stays at its smallest grid
// and remains readable on small round stickers.
const ASSET_TAG_PREFIX = 'LD-';
const ASSET_TAG_COUNTER_ID = 'gearAssetTag';

function formatAssetTag(sequenceNumber) {
  return `${ASSET_TAG_PREFIX}${String(sequenceNumber).padStart(5, '0')}`;
}

// Simplified GearInventory schema designed for the current cart-to-gear system
const gearInventorySchema = new mongoose.Schema({
  // Basic item information
  label: { type: String, required: true }, // e.g., "Canon R5 Body #1"
  category: { type: String, required: true }, // e.g., "Camera"
  // Scannable ID printed on the item's label. Assigned automatically, never reused.
  assetTag: { type: String, trim: true, uppercase: true },
  serial: { 
    type: String,
    required: true,
    sparse: true,
    set: v => v === '' ? 'N/A' : v,
    validate: {
      validator: async function(value) {
        // Only enforce uniqueness for non-N/A values
        if (value === 'N/A') {
          return true; // Allow multiple N/A values
        }
        
        // For actual serial numbers, check for duplicates
        const count = await this.constructor.countDocuments({
          serial: value,
          _id: { $ne: this._id } // Exclude current document when updating
        });
        return count === 0;
      },
      message: 'Serial number already exists'
    }
  },
  quantity: { 
    type: Number, 
    default: 1,
    min: 1 
  },
  // Optical class for lenses (ultrawide, telephoto zoom, etc.)
  lensClass: {
    type: String,
    default: null,
    trim: true
  },
  
  // Current active reservations (the single source of truth)
  reservations: [{
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    quantity: { type: Number, required: true, min: 1 },
    checkOutDate: { type: Date, required: true, set: normalizeDate },
    checkInDate: { type: Date, required: true, set: normalizeDate },
    createdAt: { type: Date, default: Date.now }
  }],

  // Admin notes with timestamps, keyed by serial number
  notes: [{
    serial: { type: String, default: 'N/A' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // Historical data (only for completed/past reservations)
  history: [{
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    quantity: { type: Number, default: 1 },
    checkOutDate: { type: Date, set: normalizeDate },
    checkInDate: { type: Date, set: normalizeDate },
    returnedAt: Date,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

// Unique only among items that have a tag, so items created before asset tags
// existed (no tag yet) do not collide with each other.
gearInventorySchema.index(
  { assetTag: 1 },
  { unique: true, partialFilterExpression: { assetTag: { $type: 'string' } } }
);

// Pre-save hook for serial handling
gearInventorySchema.pre('save', function(next) {
  if (!this.serial || this.serial === '') {
    this.serial = 'N/A';
  }
  next();
});

// Give every new item an asset tag
gearInventorySchema.pre('save', async function() {
  if (this.isNew && !this.assetTag) {
    this.assetTag = await this.constructor.nextAssetTag();
  }
});

// Reserve the next unused asset tag
gearInventorySchema.statics.nextAssetTag = async function() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const counter = await Counter.findOneAndUpdate(
      { _id: ASSET_TAG_COUNTER_ID },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const tag = formatAssetTag(counter.seq);
    // Skip numbers already in use (e.g. if the counter was ever reset)
    const taken = await this.exists({ assetTag: tag });
    if (!taken) return tag;
  }
  throw new Error('Could not allocate an asset tag');
};

// Give an asset tag to every item that does not have one yet (oldest first).
// Safe to run repeatedly. Returns how many items were tagged.
gearInventorySchema.statics.assignMissingAssetTags = async function({ dryRun = false } = {}) {
  const missing = await this.find({
    $or: [{ assetTag: { $exists: false } }, { assetTag: null }, { assetTag: '' }]
  }).select('_id label serial').sort({ createdAt: 1, _id: 1 }).lean();

  if (dryRun) return { missing: missing.length, assigned: 0 };

  let assigned = 0;
  for (const item of missing) {
    const tag = await this.nextAssetTag();
    // updateOne (not save) so unrelated validation on old records cannot block tagging
    const result = await this.updateOne(
      { _id: item._id, $or: [{ assetTag: { $exists: false } }, { assetTag: null }, { assetTag: '' }] },
      { $set: { assetTag: tag } }
    );
    if (result.modifiedCount === 1) assigned++;
  }
  return { missing: missing.length, assigned };
};

// Method to get available quantity for given dates
gearInventorySchema.methods.getAvailableQuantity = async function(checkOutDate, checkInDate) {
  const normalizeDate = (dateStr) => {
    const date = new Date(dateStr);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  
  const reqStart = normalizeDate(checkOutDate);
  const reqEnd = normalizeDate(checkInDate);
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  
  let reservedQuantity = 0;
  
  // Check active reservations for date overlaps (excluding expired reservations)
  this.reservations.forEach(reservation => {
    const resStart = normalizeDate(reservation.checkOutDate);
    const resEnd = normalizeDate(reservation.checkInDate);
    
    // Skip expired reservations (automatically checked in)
    // Items are assumed to be returned exactly on their check-in date
    if (resEnd < now) {
      return; // This reservation has expired, don't count it
    }
    
    // Check for overlap: (startA <= endB) && (endA >= startB)
    if (reqStart <= resEnd && reqEnd >= resStart) {
      reservedQuantity += reservation.quantity;
    }
  });
  
  // Check manual reservations for date overlaps
  const ManualReservation = require('./ManualReservation');
  const manualReservations = await ManualReservation.find({
    inventoryId: this._id,
    // Only include reservations that overlap with our date range
    $or: [
      {
        $and: [
          { startDate: { $lte: reqEnd } },
          { endDate: { $gte: reqStart } }
        ]
      }
    ]
  });
  
  manualReservations.forEach(reservation => {
    const resStart = normalizeDate(reservation.startDate);
    const resEnd = normalizeDate(reservation.endDate);
    
    // Skip expired reservations
    if (resEnd < now) {
      return;
    }
    
    // Check for overlap: (startA <= endB) && (endA >= startB)
    if (reqStart <= resEnd && reqEnd >= resStart) {
      reservedQuantity += reservation.quantity;
    }
  });
  
  return Math.max(0, this.quantity - reservedQuantity);
};

// Method to reserve quantity
gearInventorySchema.methods.reserveQuantity = async function(eventId, userId, quantity, checkOutDate, checkInDate) {
  const availableQty = await this.getAvailableQuantity(checkOutDate, checkInDate);
  
  if (quantity > availableQty) {
    throw new Error(`Only ${availableQty} units available for the requested dates`);
  }
  
  // Add reservation (single source of truth) - dates will be normalized by setter
  this.reservations.push({
    eventId,
    userId,
    quantity,
    checkOutDate,
    checkInDate
  });
  
  console.log(`[RESERVE] Reserved ${quantity} units of ${this.label} for event ${eventId}`);
};

// Method to release quantity reservation
gearInventorySchema.methods.releaseQuantity = function(eventId, userId, quantity) {
  console.log(`[RELEASE] Releasing ${quantity} units of ${this.label} for event ${eventId}, user ${userId}`);
  
  const originalCount = this.reservations.length;
  
  // Find and remove matching reservations
  let remainingToRelease = quantity;
  const newReservations = [];
  
  for (const reservation of this.reservations) {
    if (remainingToRelease <= 0) {
      newReservations.push(reservation);
      continue;
    }
    
    // Match by event and user
    if (reservation.eventId.toString() === eventId.toString() && 
        reservation.userId.toString() === userId.toString()) {
      
      if (reservation.quantity <= remainingToRelease) {
        // Remove entire reservation
        remainingToRelease -= reservation.quantity;
        console.log(`[RELEASE] Removed reservation of ${reservation.quantity} units`);
      } else {
        // Reduce reservation quantity
        const newReservation = { ...reservation.toObject() };
        newReservation.quantity = reservation.quantity - remainingToRelease;
        newReservations.push(newReservation);
        console.log(`[RELEASE] Reduced reservation from ${reservation.quantity} to ${newReservation.quantity} units`);
        remainingToRelease = 0;
      }
    } else {
      newReservations.push(reservation);
    }
  }
  
  this.reservations = newReservations;
  console.log(`[RELEASE] Released ${quantity - remainingToRelease} units, ${remainingToRelease} remaining to release`);
  
  return quantity - remainingToRelease; // Return how much was actually released
};

// Method to move reservation to history (when item is actually returned)
gearInventorySchema.methods.moveToHistory = function(eventId, userId) {
  const reservationsToMove = this.reservations.filter(res => 
    res.eventId.toString() === eventId.toString() && 
    res.userId.toString() === userId.toString()
  );
  
  // Move to history - dates will be normalized by setter
  reservationsToMove.forEach(res => {
    this.history.push({
      eventId: res.eventId,
      userId: res.userId,
      quantity: res.quantity,
      checkOutDate: res.checkOutDate,
      checkInDate: res.checkInDate,
      returnedAt: new Date()
    });
  });
  
  // Remove from active reservations
  this.reservations = this.reservations.filter(res => 
    !(res.eventId.toString() === eventId.toString() && 
      res.userId.toString() === userId.toString())
  );
};

module.exports = mongoose.model('GearInventory', gearInventorySchema); 