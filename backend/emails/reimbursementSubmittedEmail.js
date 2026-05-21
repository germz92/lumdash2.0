/**
 * Email template: new reimbursement request submitted (for admins / event owners).
 * Matches Lumetry Media / LumDash branding used in gear reservation emails.
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
 * @param {string} data.recipientName - Reviewer receiving the email
 * @param {string} data.submitterName
 * @param {string} [data.submitterEmail]
 * @param {string} data.eventName
 * @param {number} data.totalAmount
 * @param {Date|string} [data.dateSubmitted]
 * @param {string} [data.description]
 * @param {number} [data.itemCount]
 * @param {string} data.reviewUrl - Full URL to open the request in LumDash
 */
function buildReimbursementSubmittedSubject(data) {
  const event = data.eventName || 'Unknown event';
  const amount = formatCurrency(data.totalAmount);
  return `New Reimbursement Request — ${event} (${amount})`;
}

function buildReimbursementSubmittedEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const submitterName = escapeHtml(data.submitterName || 'Unknown');
  const submitterEmail = data.submitterEmail ? escapeHtml(data.submitterEmail) : '';
  const eventName = escapeHtml(data.eventName || 'Unknown event');
  const amount = formatCurrency(data.totalAmount);
  const dateSubmitted = escapeHtml(formatDate(data.dateSubmitted));
  const description = data.description
    ? escapeHtml(data.description)
    : '<span style="color:#888;">No description provided</span>';
  const itemCount = data.itemCount != null ? Number(data.itemCount) : null;
  const reviewUrl = escapeHtml(data.reviewUrl || '#');

  const submitterLine = submitterEmail
    ? `${submitterName} &lt;<a href="mailto:${submitterEmail}" style="color:#CC0007;text-decoration:none;">${submitterEmail}</a>&gt;`
    : submitterName;

  const itemCountRow = itemCount != null
    ? `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;width:140px;">Line items</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;font-weight:600;">${itemCount}</td>
        </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Reimbursement Request</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f1f3;font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#333;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f1f3;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:2px solid #CC0007;">
              <div style="color:#CC0007;font-size:22px;font-weight:bold;letter-spacing:0.02em;">Lumetry Media</div>
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">New Reimbursement Request</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                A new expense reimbursement has been submitted and is <strong style="color:#b45309;">pending your review</strong> in LumDash.
              </p>

              <!-- Status pill -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px 16px;text-align:center;">
                    <span style="font-size:13px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;">Status: Submitted</span>
                  </td>
                </tr>
              </table>

              <!-- Details table -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:28px;">
                <tr style="background:#f8f9fa;">
                  <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">Request summary</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;width:140px;">Submitted by</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;font-weight:600;">${submitterLine}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">Event</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;font-weight:600;">${eventName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">Amount</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#CC0007;font-size:18px;font-weight:700;">${amount}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">Date</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;font-weight:600;">${dateSubmitted}</td>
                </tr>
                ${itemCountRow}
                <tr>
                  <td style="padding:12px 16px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;vertical-align:top;">Description</td>
                  <td style="padding:12px 16px;color:#333;">${description}</td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:8px;background:#CC0007;">
                    <a href="${reviewUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">Review in LumDash</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#888;">
                Or copy this link into your browser:<br>
                <a href="${reviewUrl}" style="color:#CC0007;word-break:break-all;">${reviewUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#f8f9fa;border-top:1px solid #e9ecef;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#666;">Automated message from LumDash · Lumetry Media</p>
              <p style="margin:0;font-size:13px;color:#888;">
                Questions? <a href="mailto:info@lumetrymedia.com" style="color:#CC0007;text-decoration:none;">info@lumetrymedia.com</a>
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

/** Plain-text fallback for email clients that don't render HTML */
function buildReimbursementSubmittedText(data) {
  const lines = [
    `Hi ${data.recipientName || 'there'},`,
    '',
    'A new expense reimbursement has been submitted and is pending your review in LumDash.',
    '',
    'REQUEST SUMMARY',
    `Submitted by: ${data.submitterName || 'Unknown'}${data.submitterEmail ? ` <${data.submitterEmail}>` : ''}`,
    `Event: ${data.eventName || 'Unknown event'}`,
    `Amount: ${formatCurrency(data.totalAmount)}`,
    `Date: ${formatDate(data.dateSubmitted)}`,
  ];
  if (data.itemCount != null) lines.push(`Line items: ${data.itemCount}`);
  if (data.description) lines.push(`Description: ${data.description}`);
  lines.push('', `Review: ${data.reviewUrl || ''}`, '', '— Lumetry Media / LumDash');
  return lines.join('\n');
}

/** Sample data for preview / testing */
function getSampleReimbursementEmailData() {
  const appUrl = process.env.APP_URL || 'https://beta.lumdash.app';
  const requestId = '6a0923d1aefb52f450633079';
  return {
    recipientName: 'Germaine David',
    submitterName: 'Germaine David',
    submitterEmail: 'germaine@lumetrymedia.com',
    eventName: 'Conference Direct - APM 2026',
    totalAmount: 80,
    dateSubmitted: new Date('2026-05-21'),
    description: 'Travel and meals for conference setup',
    itemCount: 2,
    reviewUrl: `${appUrl}/dashboard.html#reimbursements?reimbursementId=${requestId}`
  };
}

module.exports = {
  escapeHtml,
  formatCurrency,
  formatDate,
  buildReimbursementSubmittedSubject,
  buildReimbursementSubmittedEmail,
  buildReimbursementSubmittedText,
  getSampleReimbursementEmailData
};
