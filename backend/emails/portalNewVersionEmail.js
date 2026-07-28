/**
 * Email template: new video version ready for client review.
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
 * @param {string} data.recipientName
 * @param {string} data.projectTitle
 * @param {number} data.versionNumber
 * @param {string} [data.notes] - What changed in this cut
 * @param {string} data.reviewUrl - Magic-link URL straight to the project in the portal
 */
function buildPortalNewVersionSubject(data) {
  return `Ready for your review — ${data.projectTitle || 'your video'} (v${data.versionNumber || 1})`;
}

function buildPortalNewVersionEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const projectTitle = escapeHtml(data.projectTitle || 'your video');
  const versionNumber = Number(data.versionNumber) || 1;
  const notes = data.notes ? escapeHtml(data.notes) : '';
  const reviewUrl = escapeHtml(data.reviewUrl || '#');

  const notesBlock = notes
    ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:24px;">
                <tr style="background:#f8f9fa;">
                  <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;letter-spacing:0.04em;">What changed</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;color:#444;font-size:14px;white-space:pre-line;">${notes}</td>
                </tr>
              </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ready for Review</title>
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
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Ready for your review</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                A new cut of <strong>${projectTitle}</strong> (version ${versionNumber}) is ready for your review.
                Watch it in your portal and click anywhere on the video timeline to leave timestamped comments.
              </p>
              ${notesBlock}

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="border-radius:8px;background:#CC0007;">
                    <a href="${reviewUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">Review Video</a>
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

function buildPortalNewVersionText(data) {
  const lines = [
    `Hi ${data.recipientName || 'there'},`,
    '',
    `A new cut of ${data.projectTitle || 'your video'} (version ${data.versionNumber || 1}) is ready for your review.`,
    'Watch it in your portal and leave timestamped comments right on the video.',
    ''
  ];
  if (data.notes) {
    lines.push('What changed:', data.notes, '');
  }
  lines.push(`Review it here: ${data.reviewUrl || ''}`, '', '— Lumetry Media / LumDash');
  return lines.join('\n');
}

module.exports = {
  buildPortalNewVersionSubject,
  buildPortalNewVersionEmail,
  buildPortalNewVersionText
};
