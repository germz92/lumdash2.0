/**
 * GearScanner - shared scan panel for the gear list and the scan station.
 *
 * Handheld barcode / QR scanners behave like a keyboard: they "type" the code very
 * quickly and then press Enter. This panel listens for that anywhere on the page
 * (unless the cursor is in some other text box), sends each code to the page's
 * onScan handler, and shows the answer as a large green / amber / red banner with
 * a beep, so the operator does not have to read the screen for every item.
 *
 * Usage:
 *   const scanner = GearScanner.create({
 *     container: document.getElementById('scanPanel'),
 *     onScan: async (code, quantity) => outcome,   // outcome: { level, title, detail, ... }
 *     onUndo: async (outcome) => outcome            // optional
 *   });
 *   scanner.start();
 *
 * An outcome is what the scan API returns: level ('ok' | 'warn' | 'error'), title,
 * detail, warnings[], canUndo. The page may add buttons to the banner with
 * actions: [{ label, onClick, code? }] - onClick returns the next outcome to show.
 */
(function () {
  'use strict';

  const STYLE_ID = 'gear-scanner-styles';
  const MUTE_STORAGE_KEY = 'lumdashScanMuted';
  const MAX_RECENT = 20;

  // A scanner types a whole code in a few milliseconds per character
  const SCANNER_KEY_GAP_MS = 35;
  // If a fast burst stops without Enter (scanner set up with no suffix), send it after this pause
  const BURST_IDLE_MS = 150;
  const BURST_MIN_LENGTH = 4;
  // The same code twice within this time is one pull of the trigger read twice
  const DOUBLE_READ_MS = 300;

  const CSS = `
    .gscan {
      --gscan-ok: var(--accent-green, #22c55e);
      --gscan-warn: var(--accent-yellow, #eab308);
      --gscan-error: var(--accent-red, #ef4444);
      font-family: var(--font-family, inherit);
      color: var(--text-primary, #fff);
      background: var(--bg-secondary, #18181c);
      border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      border-radius: var(--radius-lg, 12px);
      padding: 16px;
      box-sizing: border-box;
    }
    .gscan *, .gscan *::before, .gscan *::after { box-sizing: border-box; }

    /* The host pages style every <button> and <input>; start the panel's own from a clean slate */
    .gscan button[class^="gscan-"] {
      margin: 0;
      width: auto;
      max-width: none;
      min-width: 0;
      height: auto;
      line-height: normal;
      text-transform: none;
      letter-spacing: normal;
      box-shadow: none;
      font-family: inherit;
      transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .gscan input.gscan-input {
      margin: 0;
      height: auto;
      min-width: 0;
      box-shadow: none;
    }

    .gscan-top {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .gscan button.gscan-state {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 999px;
      border: none;
      background: var(--bg-tertiary, #1e1e24);
      color: var(--text-secondary, rgba(255, 255, 255, 0.75));
      font-family: inherit;
      cursor: default;
    }
    .gscan-state-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--text-tertiary, rgba(255, 255, 255, 0.5));
      flex: 0 0 auto;
    }
    .gscan[data-state="ready"] button.gscan-state { color: var(--gscan-ok); }
    .gscan[data-state="ready"] .gscan-state-dot {
      background: var(--gscan-ok);
      animation: gscan-pulse 1.6s ease-in-out infinite;
    }
    .gscan[data-state="busy"] .gscan-state-dot { background: var(--accent-blue, #3b82f6); }
    .gscan[data-state="paused"] button.gscan-state {
      color: #1a1a1a;
      background: var(--gscan-warn);
      cursor: pointer;
    }
    .gscan[data-state="paused"] .gscan-state-dot { background: #1a1a1a; }
    .gscan-title {
      font-size: 15px;
      font-weight: 700;
      margin-right: auto;
    }
    .gscan button.gscan-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      background: transparent;
      color: var(--text-secondary, rgba(255, 255, 255, 0.75));
      cursor: pointer;
    }
    .gscan button.gscan-icon-btn:hover { background: var(--bg-tertiary, #1e1e24); color: var(--text-primary, #fff); }
    .gscan-icon-btn .material-symbols-outlined { font-size: 20px; }

    .gscan-entry {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    .gscan-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .gscan-field-code { flex: 1 1 auto; }
    .gscan-field-qty { flex: 0 0 84px; }
    .gscan-field label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
    }
    .gscan input.gscan-input {
      width: 100%;
      padding: 10px 12px;
      font-size: 16px;
      font-family: inherit;
      color: var(--text-primary, #fff);
      background: var(--bg-tertiary, #1e1e24);
      border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      border-radius: var(--radius-md, 8px);
    }
    .gscan input.gscan-input:focus {
      outline: none;
      border-color: var(--gscan-ok);
      box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
    }
    .gscan input.gscan-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.5px; }
    .gscan button.gscan-submit {
      align-self: flex-end;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      color: var(--text-primary, #fff);
      background: var(--bg-tertiary, #1e1e24);
      border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
      white-space: nowrap;
    }
    .gscan button.gscan-submit:hover { background: var(--bg-elevated, #252530); }
    .gscan-hint {
      margin: 8px 0 0 0;
      font-size: 12px;
      color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
    }

    .gscan-result {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-top: 12px;
      padding: 14px 16px;
      border-radius: var(--radius-md, 8px);
      border: 2px solid transparent;
      background: var(--bg-tertiary, #1e1e24);
      min-height: 72px;
    }
    .gscan-result[data-level="idle"] { color: var(--text-tertiary, rgba(255, 255, 255, 0.5)); align-items: center; }
    .gscan-result[data-level="ok"] { border-color: var(--gscan-ok); background: rgba(34, 197, 94, 0.14); }
    .gscan-result[data-level="warn"] { border-color: var(--gscan-warn); background: rgba(234, 179, 8, 0.16); }
    .gscan-result[data-level="error"] { border-color: var(--gscan-error); background: rgba(239, 68, 68, 0.16); }
    .gscan-result.gscan-flash { animation: gscan-flash 0.35s ease-out; }
    .gscan-result-icon { font-size: 34px !important; flex: 0 0 auto; line-height: 1; }
    .gscan-result[data-level="ok"] .gscan-result-icon { color: var(--gscan-ok); }
    .gscan-result[data-level="warn"] .gscan-result-icon { color: var(--gscan-warn); }
    .gscan-result[data-level="error"] .gscan-result-icon { color: var(--gscan-error); }
    .gscan-result-body { flex: 1 1 auto; min-width: 0; }
    .gscan-result-title { font-size: 19px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
    .gscan-result-detail { font-size: 14px; margin-top: 3px; color: var(--text-secondary, rgba(255, 255, 255, 0.75)); overflow-wrap: anywhere; }
    .gscan-result-warnings { margin: 6px 0 0 0; padding: 0; list-style: none; font-size: 13px; }
    .gscan-result-warnings li { display: flex; gap: 6px; align-items: flex-start; margin-top: 3px; }
    .gscan-result-warnings .material-symbols-outlined { font-size: 16px; color: var(--gscan-warn); margin-top: 1px; }
    .gscan-result-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .gscan button.gscan-action {
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      color: var(--text-primary, #fff);
      background: var(--bg-secondary, #18181c);
      border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
    }
    .gscan button.gscan-action:hover { background: var(--bg-elevated, #252530); }
    .gscan button.gscan-action:disabled { opacity: 0.5; cursor: default; }

    .gscan-recent { margin-top: 14px; }
    .gscan-recent-head {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
      margin-bottom: 6px;
    }
    .gscan-recent-list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 220px;
      overflow-y: auto;
    }
    .gscan-recent-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 0;
      border-top: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      font-size: 13px;
    }
    .gscan-recent-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .gscan-recent-item[data-level="ok"] .gscan-recent-dot { background: var(--gscan-ok); }
    .gscan-recent-item[data-level="warn"] .gscan-recent-dot { background: var(--gscan-warn); }
    .gscan-recent-item[data-level="error"] .gscan-recent-dot { background: var(--gscan-error); }
    .gscan-recent-text { flex: 1 1 auto; min-width: 0; }
    .gscan-recent-title { font-weight: 600; overflow-wrap: anywhere; }
    .gscan-recent-detail { color: var(--text-tertiary, rgba(255, 255, 255, 0.5)); overflow-wrap: anywhere; }
    .gscan-recent-item.gscan-undone .gscan-recent-title { text-decoration: line-through; opacity: 0.6; }
    .gscan-recent-time { color: var(--text-tertiary, rgba(255, 255, 255, 0.5)); font-size: 12px; flex: 0 0 auto; }
    .gscan button.gscan-undo {
      flex: 0 0 auto;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      color: var(--text-secondary, rgba(255, 255, 255, 0.75));
      background: transparent;
      border: 1px solid var(--border-default, rgba(255, 255, 255, 0.1));
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
    }
    .gscan button.gscan-undo:hover { color: var(--text-primary, #fff); background: var(--bg-tertiary, #1e1e24); }
    .gscan button.gscan-undo:disabled { opacity: 0.5; cursor: default; }

    /* Scan station: read from across the bench */
    .gscan-large { padding: 24px; }
    .gscan.gscan-large input.gscan-input { font-size: 22px; padding: 14px 16px; }
    .gscan.gscan-large button.gscan-submit { font-size: 17px; padding: 14px 22px; }
    .gscan-large .gscan-field-qty { flex-basis: 110px; }
    .gscan-large .gscan-result { min-height: 150px; padding: 24px; gap: 20px; align-items: center; }
    .gscan-large .gscan-result-icon { font-size: 72px !important; }
    .gscan-large .gscan-result-title { font-size: 34px; }
    .gscan-large .gscan-result-detail { font-size: 19px; margin-top: 6px; }
    .gscan-large .gscan-result-warnings { font-size: 16px; }
    .gscan.gscan-large button.gscan-action { font-size: 17px; padding: 12px 20px; }
    .gscan-large .gscan-recent-item { font-size: 15px; padding: 10px 0; }
    .gscan-large .gscan-recent-list { max-height: 320px; }

    /* Wide: entry and result on the left, recent scans beside them (keeps the panel short) */
    @media (min-width: 1100px) {
      .gscan-wide {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
        column-gap: 24px;
        align-items: start;
      }
      .gscan-wide > * { grid-column: 1; }
      .gscan-wide > .gscan-recent { grid-column: 2; grid-row: 1 / span 4; margin-top: 0; }
      .gscan-wide .gscan-recent-list { max-height: 200px; }
    }

    @keyframes gscan-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    @keyframes gscan-flash { 0% { transform: scale(1.015); filter: brightness(1.5); } 100% { transform: scale(1); filter: none; } }
    @media (prefers-reduced-motion: reduce) {
      .gscan-result.gscan-flash, .gscan[data-state="ready"] .gscan-state-dot { animation: none; }
    }
    @media (max-width: 520px) {
      .gscan-entry { flex-wrap: wrap; }
      .gscan-field-code { flex-basis: 100%; }
    }
  `;

  const ICONS = { ok: 'check_circle', warn: 'warning', error: 'cancel', idle: 'barcode_scanner' };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name, className) {
    const node = el('span', 'material-symbols-outlined' + (className ? ' ' + className : ''), name);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  /** True when the key press is going into a text box, dropdown or editor */
  function isEditable(target) {
    if (!target || !target.closest) return false;
    const field = target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (!field) return false;
    if (field.tagName === 'INPUT') {
      // Checkboxes, radios and buttons do not take typed text
      const type = (field.getAttribute('type') || 'text').toLowerCase();
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image'].includes(type);
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Sound: short tones made in the browser, no audio files needed
  // ---------------------------------------------------------------------

  let audioContext = null;

  function getAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      if (!audioContext) audioContext = new AudioCtor();
      // Browsers keep sound off until the user has clicked or pressed a key
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return audioContext;
    } catch (error) {
      return null;
    }
  }

  function tone(ctx, { frequency, start, duration, type = 'sine', volume = 0.2 }) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const t0 = ctx.currentTime + start;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(t0);
    oscillator.stop(t0 + duration + 0.02);
  }

  /** ok = one high beep, warn = two mid beeps, error = a long low buzz */
  function playSound(level) {
    const ctx = getAudio();
    if (!ctx) return;
    try {
      if (level === 'ok') {
        tone(ctx, { frequency: 1320, start: 0, duration: 0.12 });
      } else if (level === 'warn') {
        tone(ctx, { frequency: 660, start: 0, duration: 0.12 });
        tone(ctx, { frequency: 660, start: 0.18, duration: 0.12 });
      } else {
        tone(ctx, { frequency: 180, start: 0, duration: 0.45, type: 'square', volume: 0.16 });
      }
    } catch (error) { /* sound is a nicety - never let it break a scan */ }
  }

  // ---------------------------------------------------------------------
  // Scanner panel
  // ---------------------------------------------------------------------

  function create(options) {
    const config = Object.assign({
      container: null,
      onScan: null,          // async (code, quantity) => outcome
      onUndo: null,          // async (outcome) => outcome
      isBlocked: null,       // () => true while a dialog is open and scans should wait
      title: 'Scan',
      hint: 'Scan a label, or type its asset tag or serial number and press Enter.',
      idleText: 'Waiting for the first scan',
      showQuantity: true,
      large: false,          // big type for the scan station
      wide: false            // recent scans beside the entry on wide screens
    }, options || {});

    if (!config.container) throw new Error('GearScanner: a container element is required');
    if (typeof config.onScan !== 'function') throw new Error('GearScanner: an onScan handler is required');

    injectStyles();

    let active = false;
    let paused = false;
    let pending = 0;
    let queue = Promise.resolve();
    let lastSubmit = { code: '', at: 0 };
    let burst = { count: 0, lastAt: 0, timer: null };
    let muted = false;
    try { muted = localStorage.getItem(MUTE_STORAGE_KEY) === '1'; } catch (error) { /* storage blocked */ }
    const recent = [];

    // ---- Build the panel ----
    const root = el('div', 'gscan' + (config.large ? ' gscan-large' : '') + (config.wide ? ' gscan-wide' : ''));
    root.dataset.state = 'stopped';

    const top = el('div', 'gscan-top');
    const titleEl = el('div', 'gscan-title', config.title);
    const stateBtn = el('button', 'gscan-state');
    stateBtn.type = 'button';
    stateBtn.appendChild(el('span', 'gscan-state-dot'));
    const stateText = el('span', 'gscan-state-text', '');
    stateBtn.appendChild(stateText);
    const muteBtn = el('button', 'gscan-icon-btn');
    muteBtn.type = 'button';
    top.append(titleEl, stateBtn, muteBtn);

    const entry = el('div', 'gscan-entry');
    const uid = 'gscan-' + Math.random().toString(36).slice(2, 8);

    const codeField = el('div', 'gscan-field gscan-field-code');
    const codeLabel = el('label', null, 'Code');
    codeLabel.htmlFor = uid + '-code';
    const codeInput = el('input', 'gscan-input gscan-code');
    codeInput.id = uid + '-code';
    codeInput.type = 'text';
    codeInput.placeholder = 'Scan or type a code';
    codeInput.autocomplete = 'off';
    codeInput.spellcheck = false;
    codeInput.setAttribute('autocapitalize', 'off');
    codeInput.setAttribute('autocorrect', 'off');
    codeInput.setAttribute('enterkeyhint', 'done');
    codeField.append(codeLabel, codeInput);

    const qtyField = el('div', 'gscan-field gscan-field-qty');
    const qtyLabel = el('label', null, 'Qty');
    qtyLabel.htmlFor = uid + '-qty';
    const qtyInput = el('input', 'gscan-input gscan-qty');
    qtyInput.id = uid + '-qty';
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.step = '1';
    qtyInput.value = '1';
    qtyInput.title = 'For items counted in bulk (batteries, cables): how many this scan stands for';
    qtyField.append(qtyLabel, qtyInput);
    if (!config.showQuantity) qtyField.style.display = 'none';

    const submitBtn = el('button', 'gscan-submit', 'Enter');
    submitBtn.type = 'button';
    entry.append(codeField, qtyField, submitBtn);

    const hintEl = el('p', 'gscan-hint', config.hint);

    const result = el('div', 'gscan-result');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'assertive');

    const recentWrap = el('div', 'gscan-recent');
    recentWrap.style.display = 'none';
    recentWrap.appendChild(el('div', 'gscan-recent-head', 'Recent scans'));
    const recentList = el('ul', 'gscan-recent-list');
    recentWrap.appendChild(recentList);

    root.append(top, entry, hintEl, result, recentWrap);
    config.container.appendChild(root);

    // ---- State indicator ----
    function blocked() {
      try {
        return typeof config.isBlocked === 'function' && !!config.isBlocked();
      } catch (error) {
        return false;
      }
    }

    function refreshState() {
      let state, text;
      if (!active) {
        state = 'stopped'; text = 'Off';
      } else if (paused) {
        state = 'paused'; text = 'Paused - click to resume';
      } else if (!document.hasFocus()) {
        // Scans go to whichever window is in front - make it obvious when that is not this one
        state = 'paused'; text = 'Click here to scan';
      } else if (pending > 0) {
        state = 'busy'; text = 'Working...';
      } else {
        state = 'ready'; text = 'Ready to scan';
      }
      root.dataset.state = state;
      stateText.textContent = text;
    }

    function refreshMute() {
      muteBtn.replaceChildren(icon(muted ? 'volume_off' : 'volume_up'));
      muteBtn.title = muted ? 'Sound is off - click to turn on' : 'Sound is on - click to turn off';
      muteBtn.setAttribute('aria-label', muteBtn.title);
      muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }

    // ---- Result banner ----
    function renderIdle() {
      result.dataset.level = 'idle';
      result.replaceChildren(icon(ICONS.idle, 'gscan-result-icon'), el('div', 'gscan-result-body', config.idleText));
    }

    function showResult(outcome, { sound = true } = {}) {
      const level = ['ok', 'warn', 'error'].includes(outcome && outcome.level) ? outcome.level : 'error';
      result.dataset.level = level;

      const body = el('div', 'gscan-result-body');
      body.appendChild(el('div', 'gscan-result-title', (outcome && outcome.title) || 'Scan failed'));
      if (outcome && outcome.detail) body.appendChild(el('div', 'gscan-result-detail', outcome.detail));

      const warnings = (outcome && Array.isArray(outcome.warnings)) ? outcome.warnings.filter(Boolean) : [];
      if (warnings.length > 0) {
        const list = el('ul', 'gscan-result-warnings');
        warnings.forEach(text => {
          const item = el('li');
          item.append(icon('warning'), el('span', null, text));
          list.appendChild(item);
        });
        body.appendChild(list);
      }

      const actions = (outcome && Array.isArray(outcome.actions)) ? outcome.actions : [];
      if (actions.length > 0) {
        const row = el('div', 'gscan-result-actions');
        actions.forEach(action => {
          const button = el('button', 'gscan-action', action.label);
          button.type = 'button';
          button.addEventListener('click', async () => {
            row.querySelectorAll('button').forEach(b => { b.disabled = true; });
            await runTask(async () => {
              const next = await action.onClick();
              // An action that stands in for a scan (e.g. "Add to this list") is listed like one
              if (next && action.code) addRecent(action.code, next);
              return next;
            });
            focusInput();
          });
          row.appendChild(button);
        });
        body.appendChild(row);
      }

      result.replaceChildren(icon(ICONS[level], 'gscan-result-icon'), body);

      // Restart the flash so two identical results in a row are still visibly two events
      result.classList.remove('gscan-flash');
      void result.offsetWidth;
      result.classList.add('gscan-flash');

      if (sound && !muted) playSound(level);
    }

    // ---- Recent scans ----
    function renderRecent() {
      recentWrap.style.display = recent.length > 0 ? '' : 'none';
      recentList.replaceChildren(...recent.map(entryData => {
        const item = el('li', 'gscan-recent-item' + (entryData.undone ? ' gscan-undone' : ''));
        item.dataset.level = entryData.level;
        item.appendChild(el('span', 'gscan-recent-dot'));

        const text = el('div', 'gscan-recent-text');
        text.appendChild(el('div', 'gscan-recent-title', entryData.title));
        if (entryData.detail) text.appendChild(el('div', 'gscan-recent-detail', entryData.detail));
        item.appendChild(text);

        if (entryData.canUndo && !entryData.undone && typeof config.onUndo === 'function') {
          const undo = el('button', 'gscan-undo', 'Undo');
          undo.type = 'button';
          undo.addEventListener('click', () => undoEntry(entryData, undo));
          item.appendChild(undo);
        }
        item.appendChild(el('span', 'gscan-recent-time', entryData.time));
        return item;
      }));
    }

    function addRecent(code, outcome) {
      recent.unshift({
        code,
        outcome,
        level: ['ok', 'warn', 'error'].includes(outcome && outcome.level) ? outcome.level : 'error',
        title: (outcome && outcome.title) || 'Scan failed',
        detail: [code, outcome && outcome.detail].filter(Boolean).join(' - '),
        canUndo: !!(outcome && outcome.canUndo),
        undone: false,
        time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      });
      if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
      renderRecent();
    }

    async function undoEntry(entryData, button) {
      button.disabled = true;
      await runTask(async () => {
        const outcome = await config.onUndo(entryData.outcome);
        if (outcome && outcome.level !== 'error') {
          entryData.undone = true;
        }
        return outcome;
      });
      renderRecent();
    }

    // ---- Sending scans ----

    /** Run one request at a time, in the order the scans arrived, and show its outcome */
    function runTask(task) {
      pending++;
      refreshState();
      const run = queue.then(async () => {
        let outcome;
        try {
          outcome = await task();
        } catch (error) {
          console.error('GearScanner: request failed', error);
          outcome = {
            level: 'error',
            title: 'Could not reach the server',
            detail: 'Nothing was recorded. Check the connection and scan again.'
          };
        }
        if (outcome) showResult(outcome);
        return outcome;
      }).finally(() => {
        pending--;
        refreshState();
      });
      queue = run.catch(() => {});
      return run;
    }

    function readQuantity() {
      if (!config.showQuantity) return 1;
      const value = parseInt(qtyInput.value, 10);
      return Number.isFinite(value) && value >= 1 ? value : 1;
    }

    function submit(rawCode) {
      const code = String(rawCode == null ? '' : rawCode).trim();
      clearBurst();
      codeInput.value = '';
      if (!code || !active) return Promise.resolve(null);

      const now = Date.now();
      if (code === lastSubmit.code && now - lastSubmit.at < DOUBLE_READ_MS) return Promise.resolve(null);
      lastSubmit = { code, at: now };

      const quantity = readQuantity();
      qtyInput.value = '1';
      if (!isEditable(document.activeElement) || root.contains(document.activeElement)) focusInput();

      return runTask(async () => {
        const outcome = await config.onScan(code, quantity);
        if (outcome) addRecent(code, outcome);
        return outcome;
      });
    }

    function focusInput() {
      try { codeInput.focus({ preventScroll: true }); } catch (error) { codeInput.focus(); }
    }

    // ---- Keyboard: catching what the scanner types ----
    function clearBurst() {
      if (burst.timer) clearTimeout(burst.timer);
      burst = { count: 0, lastAt: 0, timer: null };
    }

    /** Track how fast characters arrive so a scanner with no Enter suffix still works */
    function noteCharacter() {
      const now = performance.now();
      burst.count = (burst.lastAt && now - burst.lastAt <= SCANNER_KEY_GAP_MS) ? burst.count + 1 : 1;
      burst.lastAt = now;
      if (burst.timer) clearTimeout(burst.timer);
      burst.timer = setTimeout(() => {
        // Only send on its own when the whole box was filled in one scanner-speed burst
        const value = codeInput.value.trim();
        if (burst.count >= BURST_MIN_LENGTH && value.length === burst.count) submit(value);
        else burst.count = 0;
      }, BURST_IDLE_MS);
    }

    function wasFastBurst() {
      return burst.count >= BURST_MIN_LENGTH && performance.now() - burst.lastAt <= BURST_IDLE_MS;
    }

    function onKeyDown(event) {
      if (!active || paused || blocked()) return;
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target;
      const inCode = target === codeInput;
      const inQty = target === qtyInput;
      const key = event.key;
      const isCharacter = key && key.length === 1;

      // Unlock sound on the first key press of the session
      if (!muted) getAudio();

      if (inCode) {
        if (key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          submit(codeInput.value);
        } else if (key === 'Tab' && codeInput.value.trim() && wasFastBurst()) {
          // Scanner set up to finish with Tab instead of Enter
          event.preventDefault();
          event.stopPropagation();
          submit(codeInput.value);
        } else if (key === 'Escape') {
          codeInput.value = '';
          clearBurst();
        } else if (isCharacter) {
          noteCharacter();
        }
        return;
      }

      if (inQty) {
        if (key === 'Enter') {
          // Quantity typed, now ready for the scan it applies to
          event.preventDefault();
          event.stopPropagation();
          focusInput();
        } else if (isCharacter && !/[0-9]/.test(key)) {
          // A scan arriving while the cursor is in the quantity box belongs in the code box
          event.preventDefault();
          codeInput.value += key;
          focusInput();
          noteCharacter();
        }
        return;
      }

      // Typing into some other field on the page is left alone
      if (isEditable(target)) return;

      if (isCharacter) {
        // A leading space is never part of a code - let it tick a focused checkbox as usual
        if (key === ' ' && !codeInput.value) return;
        event.preventDefault();
        event.stopPropagation();
        codeInput.value += key;
        focusInput();
        noteCharacter();
      } else if (key === 'Enter' && codeInput.value.trim()) {
        // Never let the scanner's Enter "click" whatever button happens to have focus
        event.preventDefault();
        event.stopPropagation();
        submit(codeInput.value);
      }
    }

    function onWindowFocusChange() {
      // hasFocus() updates just after the event fires
      setTimeout(refreshState, 0);
    }

    // ---- Wiring ----
    submitBtn.addEventListener('click', () => {
      submit(codeInput.value);
      focusInput();
    });
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0'); } catch (error) { /* storage blocked */ }
      refreshMute();
      if (!muted) playSound('ok');
      focusInput();
    });
    stateBtn.addEventListener('click', () => {
      if (!active) return;
      paused = false;
      focusInput();
      refreshState();
    });
    qtyInput.addEventListener('focus', () => qtyInput.select());

    refreshMute();
    renderIdle();
    refreshState();

    // ---- Public API ----
    return {
      element: root,

      /** Begin listening for scans */
      start() {
        if (active) return;
        active = true;
        paused = false;
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('focus', onWindowFocusChange);
        window.addEventListener('blur', onWindowFocusChange);
        if (!muted) getAudio();
        focusInput();
        refreshState();
      },

      /** Stop listening (scan mode switched off) */
      stop() {
        if (!active) return;
        active = false;
        clearBurst();
        codeInput.value = '';
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('focus', onWindowFocusChange);
        window.removeEventListener('blur', onWindowFocusChange);
        refreshState();
      },

      /** Ignore scans for a while, e.g. while a dialog is open */
      pause() { paused = true; refreshState(); },
      resume() { paused = false; refreshState(); if (active) focusInput(); },

      isActive() { return active; },
      focus: focusInput,

      /** Send a code as if it had been scanned */
      submit,

      /** Show a result that did not come from a scan (e.g. "Marked returned") */
      showResult,

      /** Take the banner down again, e.g. when a question shown in it is cancelled */
      clearResult: renderIdle,

      /** Forget the banner and the recent list, e.g. after switching list or mode */
      reset() {
        recent.length = 0;
        renderRecent();
        renderIdle();
        lastSubmit = { code: '', at: 0 };
      },

      setTitle(text) { titleEl.textContent = text; },
      setHint(text) { hintEl.textContent = text; },
      setIdleText(text) {
        config.idleText = text;
        if (result.dataset.level === 'idle') renderIdle();
      },
      setShowQuantity(show) {
        config.showQuantity = !!show;
        qtyField.style.display = show ? '' : 'none';
      },

      destroy() {
        this.stop();
        root.remove();
      }
    };
  }

  window.GearScanner = { create };
})();
