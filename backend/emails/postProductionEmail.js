/**
 * Email templates: Post Production assignments and status updates.
 */

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roleLabel(role) {
  return role === 'owner' ? 'Owner' : 'Editor';
}

function buildPostProductionAssignedSubject(data) {
  const item = data.itemName || 'Deliverable';
  return `Post Production: Assigned as ${roleLabel(data.role)} — ${item}`;
}

function buildPostProductionAssignedEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const actorName = escapeHtml(data.actorName || 'Someone');
  const itemName = escapeHtml(data.itemName || 'Deliverable');
  const project = escapeHtml(data.project || 'Unknown project');
  const role = escapeHtml(roleLabel(data.role));
  const pageUrl = escapeHtml(data.pageUrl || '#');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Production Assignment</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f1f3;font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#333;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f1f3;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:2px solid #CC0007;">
              <div style="color:#CC0007;font-size:22px;font-weight:bold;">Lumetry Media</div>
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Post Production Assignment</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                <strong>${actorName}</strong> assigned you as <strong>${role}</strong> on:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:28px;">
                <tr style="background:#f8f9fa;">
                  <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;">Deliverable</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;width:120px;">Item</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #e9ecef;color:#333;">${itemName}</td>
                </tr>
                <tr>
                  <td style="padding:12px 16px;color:#666;font-size:13px;">Project</td>
                  <td style="padding:12px 16px;color:#333;">${project}</td>
                </tr>
              </table>
              <p style="margin:0 0 24px;text-align:center;">
                <a href="${pageUrl}" style="display:inline-block;background:#CC0007;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Open Post Production</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8f9fa;text-align:center;font-size:12px;color:#888;">
              LumDash · Lumetry Media
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPostProductionAssignedText(data) {
  return [
    `Hi ${data.recipientName || 'there'},`,
    '',
    `${data.actorName || 'Someone'} assigned you as ${roleLabel(data.role)} on Post Production:`,
    `Item: ${data.itemName || 'Deliverable'}`,
    `Project: ${data.project || 'Unknown project'}`,
    '',
    `Open: ${data.pageUrl || ''}`,
    '',
    '— Lumetry Media / LumDash'
  ].join('\n');
}

function buildPostProductionStatusChangedSubject(data) {
  const item = data.itemName || 'Deliverable';
  return `Post Production: Status updated — ${item}`;
}

function buildPostProductionStatusChangedEmail(data) {
  const recipientName = escapeHtml(data.recipientName || 'there');
  const actorName = escapeHtml(data.actorName || 'Someone');
  const itemName = escapeHtml(data.itemName || 'Deliverable');
  const project = escapeHtml(data.project || 'Unknown project');
  const pageUrl = escapeHtml(data.pageUrl || '#');
  const changeRows = (data.changes || []).map(c => `
                <tr>
                  <td style="padding:10px 16px;border-bottom:1px solid #e9ecef;color:#666;font-size:13px;">${escapeHtml(c.label)}</td>
                  <td style="padding:10px 16px;border-bottom:1px solid #e9ecef;color:#333;">${escapeHtml(c.fromLabel)} → <strong>${escapeHtml(c.toLabel)}</strong></td>
                </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Post Production Status Update</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f1f3;font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#333;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f1f3;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:28px 32px 20px;text-align:center;border-bottom:2px solid #CC0007;">
              <div style="color:#CC0007;font-size:22px;font-weight:bold;">Lumetry Media</div>
              <h1 style="margin:12px 0 0;font-size:20px;font-weight:600;color:#1a1a1a;">Status Updated</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px;font-size:15px;">Hi ${recipientName},</p>
              <p style="margin:0 0 24px;font-size:15px;color:#444;">
                <strong>${actorName}</strong> updated status on <strong>${itemName}</strong> (${project}):
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9ecef;border-radius:6px;overflow:hidden;margin-bottom:28px;">
                <tr style="background:#f8f9fa;">
                  <td colspan="2" style="padding:12px 16px;font-size:13px;font-weight:700;color:#CC0007;text-transform:uppercase;">Changes</td>
                </tr>
                ${changeRows}
              </table>
              <p style="margin:0 0 24px;text-align:center;">
                <a href="${pageUrl}" style="display:inline-block;background:#CC0007;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Open Post Production</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background:#f8f9fa;text-align:center;font-size:12px;color:#888;">
              LumDash · Lumetry Media
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPostProductionStatusChangedText(data) {
  const lines = [
    `Hi ${data.recipientName || 'there'},`,
    '',
    `${data.actorName || 'Someone'} updated status on "${data.itemName || 'Deliverable'}" (${data.project || 'Unknown project'}):`,
    ''
  ];
  (data.changes || []).forEach(c => {
    lines.push(`${c.label}: ${c.fromLabel} → ${c.toLabel}`);
  });
  lines.push('', `Open: ${data.pageUrl || ''}`, '', '— Lumetry Media / LumDash');
  return lines.join('\n');
}

module.exports = {
  buildPostProductionAssignedSubject,
  buildPostProductionAssignedEmail,
  buildPostProductionAssignedText,
  buildPostProductionStatusChangedSubject,
  buildPostProductionStatusChangedEmail,
  buildPostProductionStatusChangedText
};
