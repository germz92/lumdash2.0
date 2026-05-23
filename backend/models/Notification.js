const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Who receives this notification
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Notification type — extensible enum (add new strings as you add features)
  type: {
    type: String,
    required: true,
    enum: [
      'task_assigned',           // A task was assigned to you
      'task_updated',            // A task assigned to you was updated
      'flight_request',          // New flight request (for planners)
      'flight_booked',           // Your flight request was booked
      'owner_request',           // Planner requests owner rights
      'owner_request_approved',  // Owner approved the request
      'owner_request_denied',    // Owner denied the request
      'event_shared',            // You were added to an event
      'reimbursement_submitted', // New reimbursement request submitted (for admins)
      'post_production_assigned',    // Assigned as editor or owner on post production
      'post_production_status_changed', // Status updated on an item you own
      'general'                  // Catch-all for future types
    ]
  },

  // Human-readable content
  title: { type: String, required: true },
  message: { type: String, default: '' },

  // Read state
  read: { type: Boolean, default: false, index: true },

  // Where clicking the notification navigates to
  link: {
    page: { type: String, default: null },      // e.g. 'todos', 'flights', 'general'
    eventId: { type: String, default: null },    // event to navigate to
    params: { type: mongoose.Schema.Types.Mixed, default: null }  // extra params
  },

  // Who triggered the notification (e.g. "John assigned you a task")
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Related event (for filtering/grouping)
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    default: null
  },

  // Flexible metadata — different per type, avoids schema bloat
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true  // createdAt, updatedAt
});

// Compound index: "my unread notifications, newest first"
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
