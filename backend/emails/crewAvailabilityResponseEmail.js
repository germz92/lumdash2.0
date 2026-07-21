/**
 * Email template: crew member responded to an availability request (for the sender/owner).
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
 * @param {string} data.recipientName - Owner receiving the email
 * @param {string} data.crewName - Crew member who responded
 * @param {string} [data.crewEmail]
 * @param {string} data.eventName
 * @param {Array<{date: string, role: string, status: 'accepted'|'declined'}>} data.responses
 * @param {string} data.crewUrl - Deep link to the event's crew page
 */
function buildCrewAvailabilityResponseSubject(data) {
  const crew = data.crewName || 'A crew member';
  const responses = data.responses || [];
  const accepted = responses.filter(r => r.status === 'accepted').length;
  const declined = responses.filter(r => r.status === 'declined').length;
  let summary;
  if (accepted && declined) summary = `accepted ${accepted}, declined ${declined}`;
  else if (accepted) summary = `accepted ${accepted} day${accepted !== 1 ? 's' : ''}`;
  else summary = `declined ${declined} day${declined !== 1 ? 's' : ''}`;
  return `${crew} ${summary} — ${data.eventName || 'your event'}`;
}

function statusPill(status) {
  if (status === 'accepted') {
    return '<span style="display:inline-block;padding:3px 10px;border-radius:10px;background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Accepted</span>';
  }
  return '<span style="display:inline-block;padding:3px 10px;border-radius:10px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Declined</span>';
}

function buildCrewAvailabilityResponseEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const crewName = escapeHtml(data.crewName || 'A crew member');
  const crewEmail = data.crewEmail ? escapeHtml(data.crewEmail) : '';
  const eventName = escapeHtml(data.eventName || 'your event');
  const crewUrl = escapeHtml(data.crewUrl || '#');
  const responses = data.responses || [];

  const crewLine = crewEmail
    ? `${crewName} &lt;<a href="mailto:${crewEmail}" style="color:#CC0007;text-decoration:none;">${crewEmail}</a>&gt;`
    : crewName;

  const responseRows = responses.map((r, i) => `
                <tr>
                  <td style="padding:12px 16px;${i < responses.length - 1 ? 'border-bottom:1px solid #e9ecef;' : ''}color:#333;font-weight:600;">${escapeHtml(formatDay(r.date))}</td>
                  <td style="padding:12px 16px;${i < responses.length - 1 ? 'border-bottom:1px solid #e9ecef;' : ''}color:#666;">${escapeHtml(r.role || '—')}</td>
                  <td style="padding:12px 16px;${i < responses.length - 1 ? 'border-bottom:1px solid #e9ecef;' : ''}text-align:right;">${statusPill(r.status)}</td>
                </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crew Availability Response</title>
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
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Crew Availability Response</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                <strong>${crewLine}</strong> responded to your availability request for <strong>${eventName}</strong>:
              </p>

              <!-- Responses table -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:28px;">
                <tr style="background:#f8f9fa;">
                  <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">Date</td>
                  <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">Role</td>
                  <td style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;text-align:right;">Response</td>
                </tr>
                ${responseRows}
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:8px;background:#CC0007;">
                    <a href="${crewUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">View Crew Schedule</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#888;">
                Or copy this link into your browser:<br>
                <a href="${crewUrl}" style="color:#CC0007;word-break:break-all;">${crewUrl}</a>
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
function buildCrewAvailabilityResponseText(data) {
  const responses = data.responses || [];
  const lines = [
    `Hi ${data.recipientName || 'there'},`,
    '',
    `${data.crewName || 'A crew member'}${data.crewEmail ? ` <${data.crewEmail}>` : ''} responded to your availability request for ${data.eventName || 'your event'}:`,
    ''
  ];
  responses.forEach(r => {
    lines.push(`  - ${formatDay(r.date)}${r.role ? ` (${r.role})` : ''}: ${r.status === 'accepted' ? 'ACCEPTED' : 'DECLINED'}`);
  });
  lines.push('', `View crew schedule: ${data.crewUrl || ''}`, '', '— Lumetry Media / LumDash');
  return lines.join('\n');
}

/** Sample data for preview / testing */
function getSampleCrewAvailabilityResponseEmailData() {
  const appUrl = process.env.APP_URL || 'https://beta.lumdash.app';
  return {
    recipientName: 'Germaine David',
    crewName: 'Chris Angeles',
    crewEmail: 'chris@lumetrymedia.com',
    eventName: 'Conference Direct - APM 2026',
    responses: [
      { date: '2026-08-04', role: 'Additional Photographer', status: 'accepted' },
      { date: '2026-08-05', role: 'Additional Photographer', status: 'declined' }
    ],
    crewUrl: `${appUrl}/dashboard.html#crew?id=6a503a0490decac07cc34499`
  };
}

module.exports = {
  buildCrewAvailabilityResponseSubject,
  buildCrewAvailabilityResponseEmail,
  buildCrewAvailabilityResponseText,
  getSampleCrewAvailabilityResponseEmailData
};
