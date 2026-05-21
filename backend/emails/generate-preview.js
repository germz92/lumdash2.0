/**
 * Generate a local HTML preview of the reimbursement submitted email.
 * Run: node emails/generate-preview.js
 */
const fs = require('fs');
const path = require('path');
const {
  buildReimbursementSubmittedEmail,
  buildReimbursementSubmittedSubject,
  getSampleReimbursementEmailData
} = require('./reimbursementSubmittedEmail');

const sample = getSampleReimbursementEmailData();
const html = buildReimbursementSubmittedEmail(sample);
const subject = buildReimbursementSubmittedSubject(sample);

const outDir = path.join(__dirname, 'preview');
const outFile = path.join(outDir, 'reimbursement-submitted-preview.html');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(outFile, html, 'utf8');
fs.writeFileSync(
  path.join(outDir, 'reimbursement-submitted-subject.txt'),
  subject,
  'utf8'
);
console.log('Preview written to:', outFile);
console.log('Subject:', subject);
console.log('Open the file in a browser to review the template.');
