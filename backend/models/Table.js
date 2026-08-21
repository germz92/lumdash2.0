const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  label: String,
  checked: Boolean
}, { _id: false });

// Updated gear category schema to support the new structure
const gearCategorySchema = new mongoose.Schema({
  Cameras: [itemSchema],
  Lenses: [itemSchema],
  Lighting: [itemSchema],
  Support: [itemSchema],
  Accessories: [itemSchema]
}, { _id: false });

// New gear list schema with metadata
const gearListSchema = new mongoose.Schema({
  meta: {
    description: String,
    created: Date
  },
  categories: gearCategorySchema
}, { _id: false });

const programSchema = new mongoose.Schema({
  date: String,
  name: String,
  startTime: String,
  endTime: String,
  location: String,
  photographer: String,
  folder: String,
  notes: String,
  done: { type: Boolean, default: false },
  important: { type: Boolean, default: false },
  // Concurrency metadata for realtime field-level collaboration
  lastModified: Date,
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rev: { type: Number, default: 0 }
}, { _id: true });

// ✅ NEW: Separate crew row schema with ObjectId _id
const crewRowSchema = new mongoose.Schema({
  date: String,
  role: String,
  name: String,
  startTime: String,
  endTime: String,
  totalHours: Number,
  notes: String,
  // Link to the User account (set when name is picked from the user dropdown)
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Availability workflow: tentative → requested → accepted/declined → confirmed
  availabilityStatus: {
    type: String,
    enum: ['tentative', 'requested', 'accepted', 'declined', 'confirmed'],
    default: 'tentative'
  },
  availabilityRespondedAt: { type: Date, default: null }
}, { _id: true }); // ✅ Adds _id to each row for bulletproof tracking

const tableSchema = new mongoose.Schema({
  title: String,
  owners: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  leads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Per-event leads
  sharedWith: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // Owner access requests (planners/admins requesting owner rights)
  ownerRequests: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      status: { type: String, enum: ['pending', 'approved', 'denied'], default: 'pending' },
      requestedAt: { type: Date, default: Date.now },
      resolvedAt: { type: Date, default: null }
    }
  ],
  
  // External app integration (for events created from other apps like Invoice App)
  externalSource: { type: String, default: null },  // e.g., 'invoice-app'
  externalId: { type: String, default: null },      // ID from the source app
  
  // ✅ Updated to use schema with _id
  rows: [crewRowSchema],
  
  general: {
    location: String,
    city: String,
    state: String,
    weather: String,
    start: String,
    end: String,
    client: String,
    company: String,
    attendees: Number,
    budget: String,
    summary: { type: String, default: "" },
    galleryUrl: { type: String, default: "" },
    contractUrl: { type: String, default: "" },
    invoiceUrl: { type: String, default: "" },
    contacts: [
      {
        name: String,
        number: String,
        email: String,
        role: String,
        company: String,
        isMain: { type: Boolean, default: false }
      }
    ],
    locations: [
      {
        name: String,
        address: String,
        event: String
      }
    ]
  },
  gear: {
    lists: {
      type: Map,
      of: gearListSchema, // Updated to use the new schema with metadata
      default: {}
    },
    checkOutDate: String,
    checkInDate: String,
    // New: Gear list management for the new system
    gearLists: [{
      name: {
        type: String,
        required: true,
        default: 'Main List'
      },
      displayName: {
        type: String,
        default: null
      },
      createdAt: {
        type: Date,
        default: Date.now
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      manualItems: [{
        text: {
          type: String,
          required: true
        },
        completed: {
          type: Boolean,
          default: false
        },
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }]
    }],
    currentList: {
      type: String,
      default: 'Main List'
    }
  },
  travel: [
    {
      date: String,
      time: String,  // Keep for backward compatibility
      depart: String,
      arrive: String,
      airline: String,
      name: String,
      fromTo: String,
      ref: String
    }
  ],
  accommodation: [
    {
      checkin: String,
      checkout: String,
      hotel: String,
      name: String,
      ref: String
    }
  ],
  cardLog: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      date: String,
      entries: [
        {
          _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
          camera: String,
          card1: String,
          card2: String,
          user: String,
          category: String,
          notes: String,
          createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          createdAt: { type: Date, default: Date.now },
          updatedAt: { type: Date, default: Date.now }
        }
      ]
    }
  ],
  // SD Card Calculator saved state
  sdCardCalculator: {
    numDays: { type: Number, default: 1 },
    camerasPerDay: [{ type: Number }],
    cardsNeeded: { type: Number, default: 0 },
    lastUpdated: { type: Date }
  },
  programSchedule: {
    type: [programSchema],
    default: []
  },
  // Shotlist - checklist of shots to capture
  shotlist: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      title: { type: String, required: true },
      description: { type: String, default: '' },
      priority: { type: String, enum: ['normal', 'high', 'critical'], default: 'normal' },
      category: { type: String, default: '' },
      completed: { type: Boolean, default: false },
      completedAt: { type: Date },
      createdAt: { type: Date, default: Date.now },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      updatedAt: { type: Date, default: Date.now }
    }
  ],
  
  // Multiple shotlists - simplified checklists
  shotlists: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      name: { type: String, required: true },
              items: [
        {
          _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
          title: { type: String, required: true },
          completed: { type: Boolean, default: false },
          completedAt: { type: Date },
          completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          completedByName: { type: String },
          createdAt: { type: Date, default: Date.now },
          createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          updatedAt: { type: Date, default: Date.now }
        }
      ],
      createdAt: { type: Date, default: Date.now },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      updatedAt: { type: Date, default: Date.now }
    }
  ],
  // Badges marked as "not required" for this event (e.g. flights, hotel, share, schedule, gear)
  badgesNotRequired: {
    flight: { type: Boolean, default: false },
    hotel: { type: Boolean, default: false },
    share: { type: Boolean, default: false },
    schedule: { type: Boolean, default: false },
    gear: { type: Boolean, default: false }
  },
  // Manual "requested" marks (no request system yet) — e.g. hotels awaiting booking info
  badgesRequested: {
    hotel: { type: Boolean, default: false }
  },
  archived: { type: Boolean, default: false },
  // Admin-only notes for this event/table (Google Keep style)
  adminNotes: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      title: { type: String, default: '' },
      content: { type: String, default: '' },
      pinned: { type: Boolean, default: false },
      color: { type: String, default: 'default' }, // default, red, orange, yellow, green, teal, blue, purple
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      createdByName: { type: String },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }
  ],
  // Crew cost calculator rates
  crewRates: { type: Object, default: {} },
  // Collaborative tasks/to-do list
  todos: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      task: { type: String, required: true },
      status: { type: String, enum: ['todo', 'in-progress', 'done'], default: 'todo' },
      dueDate: { type: Date },
      owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: { type: String, default: '' },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }
  ],
  executiveSummary: {
    accountManager: { type: String, default: '' },
    accountManagerEmail: { type: String, default: '' },
    projectManager: { type: String, default: '' },
    projectManagerEmail: { type: String, default: '' },
    clientContact: { type: String, default: '' },
    company: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    contractLink: { type: String, default: '' },
    signed: { type: String, enum: ['', 'Yes', 'No', 'Needs Revision'], default: '' },
    invoiceLink: { type: String, default: '' },
    paid: { type: String, enum: ['', 'Yes', 'No', 'Retainer Paid', 'Needs Revision'], default: '' },
    services: [{ type: String }],
    deliverables: [{
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      item: { type: String, default: '' },
      dueDate: { type: String, default: '' }
    }],
    notes: { type: String, default: '' },
    hideContractInvoiceFromExport: { type: Boolean, default: false }
  },
  // Event expenses (admin) — synced from crew/travel/accommodation with editable overrides
  expenses: {
    crew: [{
      sourceId: { type: String, default: '' },
      name: { type: String, default: '' },
      role: { type: String, default: '' },
      hours: { type: Number, default: 0 },
      rate: { type: Number, default: 0 },
      additionalCost: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      notes: { type: String, default: '' },
      imported: { type: Boolean, default: false }
    }],
    flights: [{
      sourceKey: { type: String, default: '' },
      sourceIndex: { type: Number, default: null },
      passengerName: { type: String, default: '' },
      date: { type: String, default: '' },
      airline: { type: String, default: '' },
      refNumber: { type: String, default: '' },
      cost: { type: Number, default: 0 },
      notes: { type: String, default: '' },
      imported: { type: Boolean, default: false }
    }],
    accommodation: [{
      sourceIndex: { type: Number, default: null },
      name: { type: String, default: '' },
      checkIn: { type: String, default: '' },
      checkOut: { type: String, default: '' },
      hotel: { type: String, default: '' },
      refNumber: { type: String, default: '' },
      cost: { type: Number, default: 0 },
      notes: { type: String, default: '' },
      imported: { type: Boolean, default: false }
    }],
    misc: [{
      item: { type: String, default: '' },
      description: { type: String, default: '' },
      cost: { type: Number, default: 0 },
      notes: { type: String, default: '' }
    }],
    reimbursements: [{
      sourceId: { type: String, default: '' },
      submittedBy: { type: String, default: '' },
      dateSubmitted: { type: String, default: '' },
      description: { type: String, default: '' },
      amount: { type: Number, default: 0 },
      imported: { type: Boolean, default: true }
    }]
  },
  // Event documents (PDFs, images) stored in Cloudinary
  documents: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
      originalName: { type: String, required: true },
      cloudinaryPublicId: { type: String, required: true },
      url: { type: String, required: true },
      fileType: { type: String, required: true },
      size: { type: Number, required: true },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      uploadedAt: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

// Add utility methods for date handling if needed
tableSchema.methods.getFormattedDate = function(dateStr) {
  if (!dateStr) return null;
  // Parse string to Date with timezone handling
  const date = new Date(dateStr);
  return date;
};

// Helper method to check if gear dates overlap
tableSchema.methods.doGearDatesOverlap = function(startDateStr1, endDateStr1, startDateStr2, endDateStr2) {
  // Create dates at midnight for accurate day comparison
  const normalizeDate = (dateStr) => {
    const date = new Date(dateStr);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  
  const start1 = normalizeDate(startDateStr1);
  const end1 = normalizeDate(endDateStr1);
  const start2 = normalizeDate(startDateStr2);
  const end2 = normalizeDate(endDateStr2);
  
  // Overlap if: (startA <= endB) && (endA >= startB)
  return start1 <= end2 && end1 >= start2;
};

module.exports = mongoose.model('Table', tableSchema);
