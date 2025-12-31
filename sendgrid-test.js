require('dotenv').config();
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const msg = {
  to: process.env.SENDGRID_FROM_EMAIL, // send to yourself for testing
  from: process.env.SENDGRID_FROM_EMAIL,
  subject: 'Test Email from SendGrid',
  text: 'This is a test email from your LumDash local setup.',
};

sgMail.send(msg)
  .then(() => console.log('Test email sent!'))
  .catch(error => console.error('SendGrid error:', error)); 