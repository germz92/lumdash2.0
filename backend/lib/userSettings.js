const {
  normalizeRole,
  getAllNotificationItems,
  getDefaultNotificationPrefs,
  getSettingsCatalog
} = require('../config/userSettingsCatalog');

function mergeNotificationPrefs(role, saved = {}) {
  const defaults = getDefaultNotificationPrefs(role);
  const merged = { ...defaults };

  Object.keys(saved || {}).forEach(key => {
    if (!merged[key]) return;
    const entry = saved[key] || {};
    if (typeof entry.toast === 'boolean') merged[key].toast = entry.toast;
    if (typeof entry.email === 'boolean') merged[key].email = entry.email;
  });

  return merged;
}

function getMergedSettings(user) {
  const role = normalizeRole(user?.role);
  const saved = user?.settings?.notifications || {};
  return {
    notifications: mergeNotificationPrefs(role, saved)
  };
}

function isNotificationChannelEnabled(user, type, channel) {
  if (!type || !channel) return true;
  const role = normalizeRole(user?.role);
  const items = getAllNotificationItems(role);
  const item = items.find(i => i.key === type);
  if (!item) return true;
  if (!item.channels[channel]) return false;
  const prefs = mergeNotificationPrefs(role, user?.settings?.notifications);
  const pref = prefs[type];
  if (!pref) return true;
  return pref[channel] !== false;
}

function sanitizeNotificationPatch(role, patch = {}) {
  const items = getAllNotificationItems(role);
  const allowedKeys = new Set(items.map(i => i.key));
  const sanitized = {};

  Object.entries(patch || {}).forEach(([key, value]) => {
    if (!allowedKeys.has(key) || !value || typeof value !== 'object') return;
    const item = items.find(i => i.key === key);
    const next = {};
    if (item.channels.toast && typeof value.toast === 'boolean') {
      next.toast = value.toast;
    }
    if (item.channels.email && typeof value.email === 'boolean') {
      next.email = value.email;
    }
    if (Object.keys(next).length) sanitized[key] = next;
  });

  return sanitized;
}

function buildSettingsResponse(user) {
  const role = normalizeRole(user.role);
  const settings = getMergedSettings(user);
  return {
    role,
    settings,
    catalog: getSettingsCatalog(role)
  };
}

module.exports = {
  mergeNotificationPrefs,
  getMergedSettings,
  isNotificationChannelEnabled,
  sanitizeNotificationPatch,
  buildSettingsResponse
};
