/**
 * One-off: send reimbursement notification emails for a request ID.
 * Usage: node scripts/test-reimbursement-email.js [requestId]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const {
  buildReimbursementSubmittedSubject,
  buildReimbursementSubmittedEmail,
  buildReimbursementSubmittedText
} = require('../emails/reimbursementSubmittedEmail');

const requestId = process.argv[2] || '6a0880821c2ffc2de9ec8eba';

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const User = require('../models/User');
  const ReimbursementRequest = require('../models/ReimbursementRequest');

  const request = await ReimbursementRequest.findById(requestId).lean();
  if (!request) {
    console.error('Request not found:', requestId);
    process.exit(1);
  }

  console.log('Request:', request.eventName, request.totalAmount, request.status);

  const admins = await User.find({ role: 'admin' })
    .select('_id email fullName')
    .lean();

  let submitterName = request.userName;
  let submitterEmail = request.userEmail;
  if (request.userId) {
    const sub = await User.findById(request.userId).select('fullName email').lean();
    submitterName = submitterName || sub?.fullName || sub?.email;
    submitterEmail = submitterEmail || sub?.email;
  }

  const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
  const reviewUrl = `${appUrl}/dashboard.html#reimbursements?reimbursementId=${requestId}`;

  const baseData = {
    submitterName: submitterName || 'Someone',
    submitterEmail: submitterEmail || null,
    eventName: request.eventName || 'Unknown event',
    totalAmount: request.totalAmount,
    dateSubmitted: request.dateSubmitted || request.createdAt,
    description: request.description || '',
    itemCount: Array.isArray(request.items) ? request.items.length : null,
    reviewUrl
  };

  console.log('Sending to', admins.length, 'admins...\n');

  for (const reviewer of admins) {
    const to = reviewer.email?.trim().toLowerCase();
    if (!to) continue;
    const data = { ...baseData, recipientName: reviewer.fullName || reviewer.email };
    try {
      const [res] = await sgMail.send({
        to,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: buildReimbursementSubmittedSubject(data),
        html: buildReimbursementSubmittedEmail(data),
        text: buildReimbursementSubmittedText(data)
      });
      console.log('OK', to, res?.statusCode || '');
    } catch (err) {
      console.error('FAIL', to, err.response?.body || err.message);
    }
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
