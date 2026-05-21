require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sgMail = require('@sendgrid/mail');
const {
  buildReimbursementSubmittedSubject,
  buildReimbursementSubmittedEmail,
  buildReimbursementSubmittedText
} = require('../emails/reimbursementSubmittedEmail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const appUrl = (process.env.APP_URL || 'https://beta.lumdash.app').replace(/\/$/, '');
const data = {
  recipientName: 'Germaine David',
  submitterName: 'Test User (replace via resend-notifications for real name)',
  submitterEmail: null,
  eventName: 'Apartment Bling',
  totalAmount: 2199,
  dateSubmitted: new Date('2026-05-20'),
  description: 'Hisense 100" TV',
  itemCount: 1,
  reviewUrl: `${appUrl}/dashboard.html#reimbursements?reimbursementId=6a0880821c2ffc2de9ec8eba`
};

const to = 'germaine@lumetrymedia.com';

sgMail.send({
  to,
  from: process.env.SENDGRID_FROM_EMAIL,
  subject: buildReimbursementSubmittedSubject(data),
  html: buildReimbursementSubmittedEmail(data),
  text: buildReimbursementSubmittedText(data)
})
  .then(([res]) => {
    console.log('Sent to', to, 'status', res.statusCode);
  })
  .catch(err => {
    console.error('Failed:', err.response?.body || err.message);
    process.exit(1);
  });
