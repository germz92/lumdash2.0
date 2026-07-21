(function() {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const preselect = params.get('preselect'); // 'accept' pre-selects all unanswered days

  const card = document.getElementById('crCard');
  // selections: rowId -> 'accepted' | 'declined'
  const selections = {};
  let requestData = null;

  function apiBase() {
    return window.API_BASE || 'https://spa-lumdash-backend.onrender.com';
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDay(dateStr) {
    if (!dateStr) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr).trim());
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function showError(message) {
    card.innerHTML = `
      <div class="cr-title">Request unavailable</div>
      <div class="cr-subtitle">${escapeHtml(message)}</div>`;
  }

  function render() {
    const d = requestData;
    const firstName = (d.name || '').split(' ')[0];

    const dayCards = d.days.map(day => {
      const id = String(day.rowId);
      if (day.status === 'confirmed') {
        return `
          <div class="cr-day">
            <div class="cr-day-top">
              <span class="cr-day-date">${escapeHtml(formatDay(day.date))}</span>
              <span class="cr-day-role">${escapeHtml(day.role)}</span>
            </div>
            <div class="cr-locked">&#10003; Confirmed <small>— locked by the event owner</small></div>
          </div>`;
      }
      const sel = selections[id] || '';
      return `
        <div class="cr-day" data-row="${id}">
          <div class="cr-day-top">
            <span class="cr-day-date">${escapeHtml(formatDay(day.date))}</span>
            <span class="cr-day-role">${escapeHtml(day.role)}</span>
          </div>
          <div class="cr-choices">
            <button type="button" class="cr-choice accept${sel === 'accepted' ? ' selected' : ''}" data-status="accepted">Accept</button>
            <button type="button" class="cr-choice decline${sel === 'declined' ? ' selected' : ''}" data-status="declined">Decline</button>
          </div>
        </div>`;
    }).join('');

    const openDays = d.days.filter(day => day.status !== 'confirmed');

    card.innerHTML = `
      <div class="cr-title">Hi ${escapeHtml(firstName || 'there')},</div>
      <div class="cr-subtitle">Please confirm your availability for the day${d.days.length !== 1 ? 's' : ''} below. Exact call times will be shared closer to the event.</div>
      <div class="cr-event">${escapeHtml(d.eventName)}</div>
      <div class="cr-disclaimer">
        <span class="cr-disclaimer-icon">&#9992;&#65039;</span>
        <span>The dates below are <strong>event days only</strong>. If this event requires travel, please keep the day before and the day after open for travel.</span>
      </div>
      ${dayCards}
      ${openDays.length > 0 ? '<button class="cr-submit" id="crSubmit">Submit Availability</button>' : ''}
      <div class="cr-msg" id="crMsg"></div>`;

    card.querySelectorAll('.cr-day[data-row]').forEach(dayEl => {
      dayEl.querySelectorAll('.cr-choice').forEach(btn => {
        btn.addEventListener('click', () => {
          selections[dayEl.dataset.row] = btn.dataset.status;
          dayEl.querySelectorAll('.cr-choice').forEach(b => {
            b.classList.toggle('selected', b === btn);
          });
        });
      });
    });

    const submitBtn = document.getElementById('crSubmit');
    if (submitBtn) submitBtn.addEventListener('click', submit);
  }

  function showAcceptedDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'cr-modal-overlay';
    overlay.innerHTML = `
      <div class="cr-modal">
        <div class="cr-modal-emoji">&#127881;</div>
        <div class="cr-modal-title">See you there!</div>
        <div class="cr-modal-text">This event will automatically be added to your dashboard.</div>
        <button type="button" class="cr-modal-btn">Got it</button>
      </div>`;
    overlay.querySelector('.cr-modal-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  async function submit() {
    const msg = document.getElementById('crMsg');
    const btn = document.getElementById('crSubmit');

    const responses = Object.entries(selections).map(([rowId, status]) => ({ rowId, status }));
    if (responses.length === 0) {
      msg.className = 'cr-msg err';
      msg.textContent = 'Please choose Accept or Decline for at least one day.';
      return;
    }

    btn.disabled = true;
    msg.className = 'cr-msg';
    msg.textContent = 'Saving…';

    try {
      const res = await fetch(`${apiBase()}/api/crew-availability/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses })
      });
      const data = await res.json();
      if (!res.ok) {
        msg.className = 'cr-msg err';
        msg.textContent = data.error || 'Failed to save your response.';
        btn.disabled = false;
        return;
      }
      msg.className = 'cr-msg ok';
      msg.textContent = 'Thanks! Your availability has been sent to the event team.';
      btn.disabled = false;
      btn.textContent = 'Update Availability';
      if (responses.some(r => r.status === 'accepted')) {
        showAcceptedDialog();
      }
    } catch (err) {
      msg.className = 'cr-msg err';
      msg.textContent = 'Network error — please try again.';
      btn.disabled = false;
    }
  }

  async function load() {
    if (!token) {
      showError('This link is missing its token. Please use the link from your email.');
      return;
    }
    try {
      const res = await fetch(`${apiBase()}/api/crew-availability/${token}`);
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || 'This request could not be found.');
        return;
      }
      if (data.expired) {
        showError('This request has expired. Please ask the event owner to send a new one.');
        return;
      }
      requestData = data;

      // Pre-fill: existing answers first, then optional preselect=accept for the rest
      data.days.forEach(day => {
        const id = String(day.rowId);
        if (day.status === 'accepted' || day.status === 'declined') {
          selections[id] = day.status;
        } else if (preselect === 'accept' && day.status !== 'confirmed') {
          selections[id] = 'accepted';
        }
      });

      render();
    } catch (err) {
      showError('Could not load this request. Please check your connection and try again.');
    }
  }

  // Wait briefly for config.js to set API_BASE, then load
  let waited = 0;
  (function waitForConfig() {
    if (window.API_BASE || waited >= 2000) return load();
    waited += 100;
    setTimeout(waitForConfig, 100);
  })();
})();
