const mongoose = require('mongoose');

// Audit trail: one row per scan (or manual return / undo), including scans that failed.
const gearScanLogSchema = new mongoose.Schema({
  // What was scanned or typed
  code: { type: String, default: '' },

  // What it resolved to (null when nothing matched)
  inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'GearInventory', default: null },
  reservedItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReservedGearItem', default: null },
  // 'manual' = reservedItemId is a ManualReservation (gear checked out with no event)
  lineType: { type: String, enum: ['event', 'manual'], default: 'event' },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', default: null },
  listName: { type: String, default: null },

  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  action: {
    type: String,
    enum: ['scan_out', 'scan_in', 'undo'],
    required: true
  },
  // 'scan' = scanner or typed code, 'manual' = button on a gear list line
  method: { type: String, enum: ['scan', 'manual'], default: 'scan' },

  // Outcome, e.g. ok, already_scanned, not_found, not_on_list, unavailable, not_out
  result: { type: String, required: true },
  // What an 'ok' scan did: marked | swapped | added | reopened | returned | undone | cleared
  effect: { type: String, default: null },

  quantity: { type: Number, default: 1 },
  message: { type: String, default: '' },

  // State needed to reverse this scan (line fields before the scan, swapped unit, etc.)
  previous: { type: mongoose.Schema.Types.Mixed, default: null },

  undoneAt: { type: Date, default: null },
  undoneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, {
  timestamps: true
});

gearScanLogSchema.index({ reservedItemId: 1, createdAt: -1 });
gearScanLogSchema.index({ inventoryId: 1, createdAt: -1 });
gearScanLogSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.model('GearScanLog', gearScanLogSchema);
