/**
 * Email template: video portal invite (magic link).
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

/**
 * @param {Object} data
 * @param {string} data.recipientName - Client contact receiving the email
 * @param {string} data.clientName - Client/company name
 * @param {string} [data.senderName] - Team member who sent the invite
 * @param {string} data.portalUrl - Personal magic-link portal URL
 */
function buildPortalInviteSubject(data) {
  return `Your Lumetry Media Video Portal — ${data.clientName || 'Welcome'}`;
}

function buildPortalInviteEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const clientName = escapeHtml(data.clientName || '');
  const senderName = data.senderName ? escapeHtml(data.senderName) : '';
  const portalUrl = escapeHtml(data.portalUrl || '#');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Video Portal</title>
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
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Your Video Portal</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                ${senderName ? `<strong>${senderName}</strong> has` : 'We have'} set up a private video portal for
                ${clientName ? `<strong>${clientName}</strong>` : 'you'}. This is where you'll find your delivered
                videos and review works-in-progress — you can watch each cut and leave timestamped comments
                right on the video.
              </p>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="border-radius:8px;background:#CC0007;">
                    <a href="${portalUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">Open Your Portal</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#888;">
                This link is personal to you — no account or password needed. Please don't forward it.
              </p>
              <p style="margin:0;font-size:13px;color:#888;">
                Or copy this link into your browser:<br>
                <a href="${portalUrl}" style="color:#CC0007;word-break:break-all;">${portalUrl}</a>
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

function buildPortalInviteText(data) {
  return [
    `Hi ${data.recipientName || 'there'},`,
    '',
    `${data.senderName ? `${data.senderName} has` : 'We have'} set up a private video portal for ${data.clientName || 'you'}.`,
    'This is where you\'ll find your delivered videos and review works-in-progress —',
    'you can watch each cut and leave timestamped comments right on the video.',
    '',
    `Open your portal: ${data.portalUrl || ''}`,
    '',
    "This link is personal to you — no account or password needed. Please don't forward it.",
    '',
    '— Lumetry Media / LumDash'
  ].join('\n');
}

module.exports = {
  buildPortalInviteSubject,
  buildPortalInviteEmail,
  buildPortalInviteText
};
