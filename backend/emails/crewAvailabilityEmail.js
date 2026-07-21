/**
 * Email template: crew availability request (per-day Accept/Decline).
 * Matches Lumetry Media / LumDash branding used in the other email templates.
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Format a crew-row date string ("YYYY-MM-DD") without timezone shifting */
function formatDay(dateStr) {
  if (!dateStr) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * @param {Object} data
 * @param {string} data.recipientName - Crew member receiving the email
 * @param {string} data.eventName
 * @param {string} [data.senderName] - Who sent the request
 * @param {Array<{date: string, role: string}>} data.days - Days being requested
 * @param {string} data.responseUrl - Public magic-link response page
 * @param {string} [data.acceptAllUrl] - Response page with all days pre-selected as accepted
 */
function buildCrewAvailabilitySubject(data) {
  const event = data.eventName || 'an event';
  const count = (data.days || []).length;
  return `Availability Request — ${event} (${count} day${count !== 1 ? 's' : ''})`;
}

function buildCrewAvailabilityEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const eventName = escapeHtml(data.eventName || 'an event');
  const senderName = data.senderName ? escapeHtml(data.senderName) : '';
  const responseUrl = escapeHtml(data.responseUrl || '#');
  const acceptAllUrl = data.acceptAllUrl ? escapeHtml(data.acceptAllUrl) : '';
  const days = data.days || [];

  const dayRows = days.map((day, i) => `
                <tr>
                  <td style="padding:12px 16px;${i < days.length - 1 ? 'border-bottom:1px solid #e9ecef;' : ''}color:#333;font-weight:600;">${escapeHtml(formatDay(day.date))}</td>
                  <td style="padding:12px 16px;${i < days.length - 1 ? 'border-bottom:1px solid #e9ecef;' : ''}color:#666;">${escapeHtml(day.role || '—')}</td>
                </tr>`).join('');

  const acceptAllLine = acceptAllUrl
    ? `
              <p style="margin:0 0 24px;font-size:13px;color:#888;text-align:center;">
                Available for everything? <a href="${acceptAllUrl}" style="color:#CC0007;font-weight:600;">Accept all days</a> in one step.
              </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Availability Request</title>
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
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Are you available?</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                ${senderName ? `<strong>${senderName}</strong> would like` : 'We would like'} to book you for
                <strong>${eventName}</strong> on the day${days.length !== 1 ? 's' : ''} below.
                Please confirm which days you're available.
              </p>

              <!-- Days table -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:12px;">
                <tr style="background:#f8f9fa;">
                  <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">Date</td>
                  <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">Role</td>
                </tr>
                ${dayRows}
              </table>

              <p style="margin:0 0 24px;font-size:13px;color:#888;">
                Call times aren't final yet — exact start and end times will be shared closer to the event.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="border-radius:8px;background:#CC0007;">
                    <a href="${responseUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">Respond to Request</a>
                  </td>
                </tr>
              </table>
              ${acceptAllLine}

              <p style="margin:0;font-size:13px;color:#888;">
                Or copy this link into your browser:<br>
                <a href="${responseUrl}" style="color:#CC0007;word-break:break-all;">${responseUrl}</a>
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
function buildCrewAvailabilityText(data) {
  const days = data.days || [];
  const lines = [
    `Hi ${data.recipientName || 'there'},`,
    '',
    `${data.senderName ? `${data.senderName} would like` : 'We would like'} to book you for ${data.eventName || 'an event'} on the following day${days.length !== 1 ? 's' : ''}:`,
    ''
  ];
  days.forEach(day => {
    lines.push(`  - ${formatDay(day.date)}${day.role ? ` — ${day.role}` : ''}`);
  });
  lines.push(
    '',
    "Call times aren't final yet — exact start and end times will be shared closer to the event.",
    '',
    `Respond here: ${data.responseUrl || ''}`,
    '',
    '— Lumetry Media / LumDash'
  );
  return lines.join('\n');
}

/** Sample data for preview / testing */
function getSampleCrewAvailabilityEmailData() {
  const appUrl = process.env.APP_URL || 'https://beta.lumdash.app';
  const token = 'sample-token';
  return {
    recipientName: 'Chris Angeles',
    eventName: 'Conference Direct - APM 2026',
    senderName: 'Germaine David',
    days: [
      { date: '2026-08-04', role: 'Additional Photographer' },
      { date: '2026-08-05', role: 'Additional Photographer' }
    ],
    responseUrl: `${appUrl}/crew-response.html?token=${token}`,
    acceptAllUrl: `${appUrl}/crew-response.html?token=${token}&preselect=accept`
  };
}

module.exports = {
  buildCrewAvailabilitySubject,
  buildCrewAvailabilityEmail,
  buildCrewAvailabilityText,
  getSampleCrewAvailabilityEmailData
};
