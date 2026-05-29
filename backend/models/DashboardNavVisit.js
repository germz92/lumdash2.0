const mongoose = require('mongoose');

const dashboardNavVisitSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  page: {
    type: String,
    required: true,
    enum: ['flights', 'reimbursements']
  },
  visitedAt: { type: Date, default: Date.now }
}, {
  collection: 'dashboardnavvisits'
});

dashboardNavVisitSchema.index({ userId: 1, page: 1 }, { unique: true });

module.exports = mongoose.model('DashboardNavVisit', dashboardNavVisitSchema);
