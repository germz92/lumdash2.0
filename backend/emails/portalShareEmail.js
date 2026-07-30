/**
 * Email template: share the client team video portal (shared link + optional PIN).
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPortalShareSubject(data) {
  const name = data.clientName || 'your project';
  return data.isCopy
    ? `Copy: Video portal shared — ${name}`
    : `Your Lumetry Media Video Portal — ${name}`;
}

function buildPortalShareEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const clientName = escapeHtml(data.clientName || '');
  const senderName = data.senderName ? escapeHtml(data.senderName) : '';
  const portalUrl = escapeHtml(data.portalUrl || '#');
  const pin = data.portalPin ? escapeHtml(String(data.portalPin)) : '';
  const isCopy = !!data.isCopy;

  const pinBlock = pin
    ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="padding:16px 18px;background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;text-align:center;">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#666;margin-bottom:8px;">Portal PIN</div>
                    <div style="font-size:28px;font-weight:700;letter-spacing:0.2em;color:#1a1a1a;font-family:Consolas,Monaco,monospace;">${pin}</div>
                    <div style="font-size:12px;color:#888;margin-top:8px;">You'll be asked for this PIN when you open the portal.</div>
                  </td>
                </tr>
              </table>`
    : '';

  const copyNote = isCopy
    ? `<p style="margin:0 0 16px;font-size:13px;padding:10px 12px;background:#fff8e6;border:1px solid #f0e0a8;border-radius:6px;color:#6b5a1e;">
         This is a copy of the portal share email sent to ${clientName || 'the client'}.
       </p>`
    : '';

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
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:2px solid #CC0007;">
              <div style="color:#CC0007;font-size:22px;font-weight:bold;letter-spacing:0.02em;">Lumetry Media</div>
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Your Video Portal</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              ${copyNote}
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                ${senderName ? `<strong>${senderName}</strong> shared` : 'We shared'} a private video portal
                ${clientName ? ` for <strong>${clientName}</strong>` : ''}.
                Watch delivered videos and review works-in-progress — leave timestamped comments right on the video.
              </p>

              ${pinBlock}

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="border-radius:8px;background:#CC0007;">
                    <a href="${portalUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;">Open Your Portal</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#888;">
                ${pin
                  ? 'This is your team portal link. Keep the PIN private and only share it with people who should have access.'
                  : 'This is your team portal link — bookmark it for easy access.'}
              </p>
              <p style="margin:0;font-size:13px;color:#888;">
                Or copy this link into your browser:<br>
                <a href="${portalUrl}" style="color:#CC0007;word-break:break-all;">${portalUrl}</a>
              </p>
            </td>
          </tr>
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

function buildPortalShareText(data) {
  const lines = [
    `Hi ${data.recipientName || 'there'},`,
    '',
    data.isCopy
      ? `(Copy) Portal share for ${data.clientName || 'the client'}:`
      : null,
    `${data.senderName ? `${data.senderName} shared` : 'We shared'} a private video portal${data.clientName ? ` for ${data.clientName}` : ''}.`,
    'Watch delivered videos and review works-in-progress — leave timestamped comments right on the video.',
    '',
    data.portalPin ? `Portal PIN: ${data.portalPin}` : null,
    data.portalPin ? "You'll be asked for this PIN when you open the portal." : null,
    data.portalPin ? '' : null,
    `Open your portal: ${data.portalUrl || ''}`,
    '',
    '— Lumetry Media / LumDash'
  ].filter((line) => line !== null);
  return lines.join('\n');
}

module.exports = {
  buildPortalShareSubject,
  buildPortalShareEmail,
  buildPortalShareText
};
