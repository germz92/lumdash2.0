const mongoose = require('mongoose');

const hotelGuestSchema = new mongoose.Schema({
  passengerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Passenger',
    required: true
  },
  name: { type: String, required: true }
}, { _id: false });

const bookedHotelDetailsSchema = new mongoose.Schema({
  hotelName: { type: String, default: '' },
  confirmationCode: { type: String, default: '' },
  address: { type: String, default: '' },
  roomType: { type: String, default: '' },
  checkInTime: { type: String, default: '' },
  checkOutTime: { type: String, default: '' },
  numberOfRooms: { type: Number, default: 1, min: 0 },
  bookedAt: { type: Date, default: Date.now },
  bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: false });

const ROOM_PREFERENCES = ['any', 'king', 'queen', 'double', 'two_beds', 'suite', 'connecting'];

const hotelRequestSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    default: null
  },
  eventName: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  city: { type: String, required: true },
  state: { type: String, default: '' },
  area: { type: String, default: '' },
  preferredHotel: { type: String, default: '' },
  checkInDate: { type: Date, required: true },
  checkOutDate: { type: Date, required: true },
  roomPreference: {
    type: String,
    enum: ROOM_PREFERENCES,
    default: 'any'
  },
  guests: [hotelGuestSchema],
  status: {
    type: String,
    enum: ['pending', 'booked', 'cancelled', 'change_requested'],
    default: 'pending'
  },
  bookedDetails: bookedHotelDetailsSchema,
  changeDetails: {
    originalHotelId: { type: mongoose.Schema.Types.ObjectId, ref: 'HotelRequest' },
    changeReason: { type: String, default: '' },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedAt: { type: Date },
    requestedChanges: {
      checkInDate: { type: Date, default: null },
      checkOutDate: { type: Date, default: null },
      roomPreference: { type: String, default: null },
      preferredHotel: { type: String, default: null },
      notes: { type: String, default: null },
      cancelStay: { type: Boolean, default: false }
    }
  },
  notes: { type: String, default: '' },
  /** Total booking cost (USD) — imported into event expenses */
  cost: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

hotelRequestSchema.index({ status: 1, createdAt: -1 });
hotelRequestSchema.index({ eventId: 1 });
hotelRequestSchema.index({ createdBy: 1 });
hotelRequestSchema.index({ checkInDate: 1 });

module.exports = mongoose.model('HotelRequest', hotelRequestSchema);
module.exports.ROOM_PREFERENCES = ROOM_PREFERENCES;
