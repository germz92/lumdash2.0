/**
 * LumDash global theme — light / dark via html[data-theme]
 * Early paint: load theme-early.js in <head> after meta theme-color.
 * Default theme is dark when no lumdash-theme is stored (no prefers-color-scheme).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'lumdash-theme';
  const THEMES = ['light', 'dark'];
  const ASSET_VERSION = '2.0.0';
  const META_COLORS = { light: '#f3f4f6', dark: '#121216' };

  function normalizeTheme(value) {
    return THEMES.includes(value) ? value : 'dark';
  }

  function getTheme() {
    return normalizeTheme(document.documentElement.getAttribute('data-theme'));
  }

  function getStoredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeTheme(stored) : 'dark';
  }

  function cssHref(path) {
    const sep = path.includes('?') ? '&' : '?';
    return path + sep + 'v=' + ASSET_VERSION;
  }

  function applyTheme(theme) {
    const t = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_COLORS[t]);

    document.querySelectorAll('.settings-theme-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === t);
    });

    document.querySelectorAll('img.auth-logo').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (t === 'light') {
        img.src = src.replace('Logo - Dark BG.png', 'Logo - Light BG.png');
      } else {
        img.src = src.replace('Logo - Light BG.png', 'Logo - Dark BG.png');
      }
    });
  }

  function setTheme(theme) {
    const t = normalizeTheme(theme);
    localStorage.setItem(STORAGE_KEY, t);
    applyTheme(t);
    window.dispatchEvent(new CustomEvent('lumdash-theme-change', { detail: { theme: t } }));
  }

  function initTheme() {
    applyTheme(getStoredTheme());
  }

  window.LumDashTheme = {
    get: getTheme,
    getStored: getStoredTheme,
    set: setTheme,
    init: initTheme,
    cssHref,
    ASSET_VERSION,
    META_COLORS,
    THEMES
  };

  initTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  }
})();
