/**
 * Email template: reimbursement request approved (sent to submitter).
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '$0.00';
  return '$' + Number(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * @param {Object} data
 * @param {string} data.submitterName
 * @param {string} data.eventName
 * @param {number} data.totalAmount
 * @param {Date|string} [data.dateSubmitted]
 * @param {string} [data.description]
 */
function buildReimbursementApprovedSubject(data) {
  const event = data.eventName || 'your event';
  const amount = formatCurrency(data.totalAmount);
  return `Reimbursement Approved — ${event} (${amount})`;
}

function buildReimbursementApprovedEmail(data) {
  const submitterName = escapeHtml(data.submitterName || 'there');
  const eventName = escapeHtml(data.eventName || 'your event');
  const amount = formatCurrency(data.totalAmount);
  const dateSubmitted = escapeHtml(formatDate(data.dateSubmitted));
  const description = data.description
    ? escapeHtml(data.description)
    : '';

  const descriptionRow = description
    ? `
        <tr>
          <td style="padding:12px 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;">Description</td>
          <td style="padding:12px 16px;color:#333;">${description}</td>
        </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reimbursement Approved</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f1f3;font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#333;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f1f3;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:2px solid #CC0007;">
              <div style="color:#CC0007;font-size:22px;font-weight:bold;letter-spacing:0.02em;">Lumetry Media</div>
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Reimbursement Approved</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${submitterName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                Good news — your reimbursement request for <strong>${eventName}</strong> has been <strong style="color:#15803d;">approved</strong>.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#dcfce7;border:1px solid #86efac;border-radius:6px;padding:14px 18px;text-align:center;">
                    <span style="font-size:13px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.06em;">Status: Approved</span>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:28px;">
                <tr style="background:#f8f9fa;">
                  <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">Request summary</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;width:140px;">Event</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;font-weight:600;">${eventName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">Amount</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#CC0007;font-size:18px;font-weight:700;">${amount}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">Submitted</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;font-weight:600;">${dateSubmitted}</td>
                </tr>
                ${descriptionRow}
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr>
                  <td style="background:#f8f9fa;border-left:4px solid #CC0007;border-radius:4px;padding:16px 18px;">
                    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#333;">What happens next</p>
                    <p style="margin:0;font-size:14px;color:#444;">
                      Your reimbursement will be processed via <strong>direct deposit</strong>. Please allow
                      <strong>1–3 business days</strong> for the payment to appear in your account.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:14px;color:#666;">
                If you have questions about your payment, reply to this email or contact
                <a href="mailto:info@lumetrymedia.com" style="color:#CC0007;text-decoration:none;">info@lumetrymedia.com</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8f9fa;border-top:1px solid #e9ecef;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#666;">Automated message from LumDash · Lumetry Media</p>
              <p style="margin:0;font-size:13px;color:#888;">
                <a href="mailto:info@lumetrymedia.com" style="color:#CC0007;text-decoration:none;">info@lumetrymedia.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildReimbursementApprovedText(data) {
  const lines = [
    `Hi ${data.submitterName || 'there'},`,
    '',
    `Good news — your reimbursement request for ${data.eventName || 'your event'} has been approved.`,
    '',
    'REQUEST SUMMARY',
    `Event: ${data.eventName || 'your event'}`,
    `Amount: ${formatCurrency(data.totalAmount)}`,
    `Submitted: ${formatDate(data.dateSubmitted)}`,
  ];
  if (data.description) lines.push(`Description: ${data.description}`);
  lines.push(
    '',
    'WHAT HAPPENS NEXT',
    'Your reimbursement will be processed via direct deposit. Please allow 1-3 business days for the payment to appear in your account.',
    '',
    'Questions? Contact info@lumetrymedia.com',
    '',
    '— Lumetry Media / LumDash'
  );
  return lines.join('\n');
}

function getSampleReimbursementApprovedEmailData() {
  return {
    submitterName: 'Catrina Manchor',
    eventName: 'Conference Direct - APM 2026',
    totalAmount: 108,
    dateSubmitted: new Date('2026-05-21'),
    description: 'Work pants and breakfast'
  };
}

module.exports = {
  buildReimbursementApprovedSubject,
  buildReimbursementApprovedEmail,
  buildReimbursementApprovedText,
  getSampleReimbursementApprovedEmailData
};
