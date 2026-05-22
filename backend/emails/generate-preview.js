/**
 * Generate local HTML previews for reimbursement emails.
 * Run from backend/: node emails/generate-preview.js
 */
const fs = require('fs');
const path = require('path');
const {
  buildReimbursementSubmittedEmail,
  buildReimbursementSubmittedSubject,
  getSampleReimbursementEmailData
} = require('./reimbursementSubmittedEmail');
const {
  buildReimbursementApprovedEmail,
  buildReimbursementApprovedSubject,
  getSampleReimbursementApprovedEmailData
} = require('./reimbursementApprovedEmail');

const outDir = path.join(__dirname, 'preview');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const submittedSample = getSampleReimbursementEmailData();
const submittedHtml = buildReimbursementSubmittedEmail(submittedSample);
const submittedSubject = buildReimbursementSubmittedSubject(submittedSample);
const submittedFile = path.join(outDir, 'reimbursement-submitted-preview.html');
fs.writeFileSync(submittedFile, submittedHtml, 'utf8');
fs.writeFileSync(
  path.join(outDir, 'reimbursement-submitted-subject.txt'),
  submittedSubject,
  'utf8'
);

const approvedSample = getSampleReimbursementApprovedEmailData();
const approvedHtml = buildReimbursementApprovedEmail(approvedSample);
const approvedSubject = buildReimbursementApprovedSubject(approvedSample);
const approvedFile = path.join(outDir, 'reimbursement-approved-preview.html');
fs.writeFileSync(approvedFile, approvedHtml, 'utf8');
fs.writeFileSync(
  path.join(outDir, 'reimbursement-approved-subject.txt'),
  approvedSubject,
  'utf8'
);

console.log('Submitted preview:', submittedFile);
console.log('Submitted subject:', submittedSubject);
console.log('Approved preview:', approvedFile);
console.log('Approved subject:', approvedSubject);
console.log('Open the HTML files in a browser to review.');
