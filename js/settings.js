(function() {
  'use strict';

  const API_BASE = window.API_BASE || (window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://lumdash2-0.onrender.com');

  let settingsData = null;
  let saveTimer = null;
  let activeSection = 'notifications';
  let usersAdminReady = false;
  let invitesLoaded = false;

  function isAdmin() {
    return settingsData?.role === 'admin';
  }

  function setInvitesStatus(text, type = '') {
    const el = document.getElementById('settingsInvitesStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'settings-save-status' + (type ? ` ${type}` : '');
  }

  function switchSection(sectionId) {
    activeSection = sectionId;
    document.querySelectorAll('.settings-nav-item[data-section]').forEach(btn => {
      if (btn.classList.contains('disabled')) return;
      btn.classList.toggle('active', btn.dataset.section === sectionId);
    });
    document.querySelectorAll('.settings-section').forEach(section => {
      section.classList.toggle('active', section.dataset.section === sectionId);
    });
    if (sectionId === 'users' && isAdmin()) {
      if (!invitesLoaded) loadInvites().catch(err => console.error(err));
      if (!usersAdminReady) initUsersAdmin().catch(err => console.error(err));
    }
  }

  function setupSectionNav() {
    document.querySelectorAll('.settings-nav-item[data-section]:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.section) switchSection(btn.dataset.section);
      });
    });
  }

  function setupAdminNav() {
    if (!isAdmin()) return;
    document.querySelectorAll('.settings-admin-only').forEach(el => {
      el.style.display = el.classList.contains('settings-nav-item') ? 'flex' : '';
    });
    const form = document.getElementById('settingsInviteForm');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('inviteEmail')?.value.trim().toLowerCase();
      const role = document.getElementById('inviteRole')?.value || 'user';
      const expiresInDays = parseInt(document.getElementById('inviteExpiresDays')?.value, 10) || 7;
      const sendEmail = document.getElementById('inviteSendEmail')?.checked !== false;
      if (!email) return;
      try {
        setInvitesStatus('Creating…');
        const res = await fetch(`${API_BASE}/api/invites`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ email, role, expiresInDays, sendEmail })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create invite');
        form.reset();
        document.getElementById('inviteExpiresDays').value = '7';
        document.getElementById('inviteSendEmail').checked = true;
        setInvitesStatus('Invite created', 'saved');
        invitesLoaded = false;
        await loadInvites();
        if (data.invite?.inviteUrl) {
          try {
            await navigator.clipboard.writeText(data.invite.inviteUrl);
            setInvitesStatus('Invite created — link copied', 'saved');
          } catch (_) {}
        }
      } catch (err) {
        setInvitesStatus(err.message || 'Failed', 'error');
      }
    });
  }

  function inviteStatusBadge(status) {
    const map = {
      pending: 'Pending',
      used: 'Used',
      expired: 'Expired',
      revoked: 'Revoked'
    };
    return map[status] || status;
  }

  async function loadInvites() {
    const container = document.getElementById('settingsInvitesContent');
    if (!container) return;
    container.innerHTML = `<div class="settings-loading"><span class="material-symbols-outlined spinning">sync</span> Loading invites…</div>`;
    const res = await fetch(`${API_BASE}/api/invites`, { headers: authHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load invites');
    }
    const data = await res.json();
    invitesLoaded = true;
    const invites = data.invites || [];
    if (!invites.length) {
      container.innerHTML = '<p class="settings-section-desc">No invites yet. Create one above.</p>';
      return;
    }
    container.innerHTML = `
      <table class="settings-pref-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${invites.map(inv => `
            <tr data-invite-id="${esc(inv._id)}">
              <td>${esc(inv.email)}</td>
              <td>${esc(inv.role)}</td>
              <td><span class="settings-invite-badge settings-invite-badge-${esc(inv.status)}">${inviteStatusBadge(inv.status)}</span></td>
              <td>${inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '—'}</td>
              <td class="settings-invite-actions-cell">
                ${inv.status === 'pending' ? `<button type="button" class="settings-link-btn" data-copy-url="${esc(inv.inviteUrl)}">Copy link</button>
                <button type="button" class="settings-link-btn settings-link-danger" data-revoke="${esc(inv._id)}">Revoke</button>` : '—'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    container.querySelectorAll('[data-copy-url]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copyUrl);
          setInvitesStatus('Link copied', 'saved');
        } catch (_) {
          alert(btn.dataset.copyUrl);
        }
      });
    });
    container.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke this invite?')) return;
        const res = await fetch(`${API_BASE}/api/invites/${btn.dataset.revoke}`, {
          method: 'DELETE',
          headers: authHeaders()
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Failed to revoke');
          return;
        }
        invitesLoaded = false;
        loadInvites().catch(console.error);
      });
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src^="${src.split('?')[0]}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = `${src}?v=${Date.now()}`;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function loadStylesheet(href) {
    if (document.querySelector(`link[href^="${href.split('?')[0]}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  async function initUsersAdmin() {
    loadStylesheet('css/users.css');
    await loadScript('js/users.js');
    if (typeof window.initUsersAdminPanel === 'function') {
      window.initUsersAdminPanel({ embedded: true });
      usersAdminReady = true;
    }
  }

  function applyInitialSection() {
    const fromStorage = sessionStorage.getItem('settingsSection');
    sessionStorage.removeItem('settingsSection');
    const section = fromStorage === 'invites' ? 'users' : fromStorage;
    if (section && ['notifications', 'users'].includes(section)) {
      if (section === 'users') {
        if (isAdmin()) switchSection(section);
      } else {
        switchSection(section);
      }
    }
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  function authHeaders() {
    return {
      Authorization: getToken(),
      'Content-Type': 'application/json'
    };
  }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setSaveStatus(text, type = '') {
    const el = document.getElementById('settingsSaveStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'settings-save-status' + (type ? ` ${type}` : '');
  }

  function renderNotificationsSection() {
    const container = document.getElementById('settingsNotificationsContent');
    if (!container || !settingsData) return;

    const section = settingsData.catalog?.sections?.find(s => s.id === 'notifications');
    const prefs = settingsData.settings?.notifications || {};
    if (!section?.groups?.length) {
      container.innerHTML = '<p class="settings-section-desc">No notification options available for your role.</p>';
      return;
    }

    container.innerHTML = section.groups.map(group => {
      const rows = group.items.map(item => {
        const pref = prefs[item.key] || {};
        const toastCell = item.channels.toast
          ? `<input type="checkbox" data-pref-key="${esc(item.key)}" data-channel="toast" ${pref.toast !== false ? 'checked' : ''} aria-label="Toast for ${esc(item.label)}">`
          : '<span class="pref-unavailable">—</span>';
        const emailCell = item.channels.email
          ? `<input type="checkbox" data-pref-key="${esc(item.key)}" data-channel="email" ${pref.email !== false ? 'checked' : ''} aria-label="Email for ${esc(item.label)}">`
          : '<span class="pref-unavailable">—</span>';

        return `
          <tr>
            <td>
              <div class="settings-pref-label">${esc(item.label)}</div>
              <div class="settings-pref-desc">${esc(item.description)}</div>
            </td>
            <td class="pref-channel" data-label="Toast">${toastCell}</td>
            <td class="pref-channel" data-label="Email">${emailCell}</td>
          </tr>`;
      }).join('');

      return `
        <div class="settings-group">
          <h3 class="settings-group-title">${esc(group.title)}</h3>
          <table class="settings-pref-table">
            <thead>
              <tr>
                <th>Notification</th>
                <th class="pref-channel">Toast</th>
                <th class="pref-channel">Email</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join('');

    container.querySelectorAll('input[type="checkbox"][data-pref-key]').forEach(input => {
      input.addEventListener('change', onPrefChange);
    });
  }

  async function loadSettings() {
    const container = document.getElementById('settingsNotificationsContent');
    if (container) {
      container.innerHTML = `
        <div class="settings-loading">
          <span class="material-symbols-outlined spinning">sync</span>
          Loading preferences…
        </div>`;
    }

    const res = await fetch(`${API_BASE}/api/users/me/settings`, { headers: authHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load settings');
    }
    settingsData = await res.json();
    renderNotificationsSection();
    setupSectionNav();
    setupAdminNav();
    applyInitialSection();
  }

  function buildPatchFromCheckbox(input) {
    const key = input.dataset.prefKey;
    const channel = input.dataset.channel;
    if (!key || !channel) return null;
    return {
      notifications: {
        [key]: { [channel]: input.checked }
      }
    };
  }

  async function saveSettingsPatch(patch) {
    setSaveStatus('Saving…');
    const res = await fetch(`${API_BASE}/api/users/me/settings`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save settings');
    }
    settingsData = await res.json();
    if (window.notificationSystem?.refreshPreferences) {
      window.notificationSystem.refreshPreferences();
    }
    setSaveStatus('Saved', 'saved');
    setTimeout(() => setSaveStatus(''), 2000);
  }

  function onPrefChange(e) {
    const patch = buildPatchFromCheckbox(e.target);
    if (!patch) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSettingsPatch(patch).catch(err => {
        setSaveStatus(err.message || 'Save failed', 'error');
      });
    }, 250);
  }

  async function initDashboardSidebar() {
    const layout = document.getElementById('settingsPageLayout');
    if (layout && typeof window.injectDashboardSidebar === 'function') {
      await window.injectDashboardSidebar(layout, { position: 'prepend' });
    }
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.getElementById('dashboardSidebarOverlay');
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('show');
        if (overlay) overlay.classList.toggle('show');
      });
    }
    overlay?.addEventListener('click', () => {
      sidebar?.classList.remove('show');
      overlay?.classList.remove('show');
    });
  }

  function setupThemeControls() {
    const options = document.querySelectorAll('.settings-theme-option[data-theme]');
    if (!options.length || !window.LumDashTheme) return;

    const syncActive = () => {
      const current = window.LumDashTheme.get();
      options.forEach(btn => {
        const active = btn.dataset.theme === current;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    options.forEach(btn => {
      btn.addEventListener('click', () => {
        window.LumDashTheme.set(btn.dataset.theme);
        syncActive();
      });
    });

    syncActive();
    window.addEventListener('lumdash-theme-change', syncActive);
  }

  window.initPage = async function() {
    try {
      await initDashboardSidebar();
      setupThemeControls();
      await loadSettings();
    } catch (err) {
      console.error(err);
      const container = document.getElementById('settingsNotificationsContent');
      if (container) {
        container.innerHTML = `<p class="settings-section-desc">${esc(err.message || 'Failed to load settings')}</p>`;
      }
    }
  };
})();
