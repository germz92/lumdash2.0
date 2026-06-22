/**
 * LumDash theme — synchronous apply before CSS paint (load in <head> after meta theme-color).
 * Keep META_COLORS in sync with js/theme.js.
 * Default: dark when lumdash-theme is unset (no prefers-color-scheme).
 */
(function () {
  'use strict';
  var META = { light: '#f3f4f6', dark: '#121216' };
  var theme = localStorage.getItem('lumdash-theme') === 'light' ? 'light' : 'dark';
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META[theme]);
})();
