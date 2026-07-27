/**
 * Reusable event Share modal (owners / leads / shared-with management).
 * Same behavior as the share modal on the events page, packaged so any
 * event page can call it: window.ShareModal.open(tableId)
 *
 * Reuses the .share-* styles from theme-dark.css. IDs are prefixed "sm"
 * so it never collides with the events page's own share modal.
 */
(function() {
  'use strict';

  function apiBase() { return window.API_BASE || ''; }
  function authHeader() { return localStorage.getItem('token') || ''; }

  function getUserIdFromToken() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return (payload.id || '').toString();
    } catch {
      return null;
    }
  }

  function toast(message, type = 'info', duration = 4000) {
    if (typeof window.showToast === 'function' && document.getElementById('toastContainer')) {
      window.showToast(message, type, duration);
      return;
    }
    const el = document.createElement('div');
    const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
    el.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2147483647;
      padding: 13px 22px; border-radius: 8px; font-weight: 500; font-size: 0.9rem;
      background: #1f2023; color: #fff; border-left: 4px solid ${colors[type] || colors.info};
      box-shadow: 0 6px 24px rgba(0,0,0,0.4); max-width: 360px;`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Modal state ----
  let currentTableId = null;
  let allUsers = [];
  let selectedUsers = [];

  function buildModal() {
    let modal = document.getElementById('smShareModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'smShareModal';
    modal.className = 'dark-modal';
    modal.innerHTML = `
      <div class="dark-modal-content">
        <div class="modal-header-dark">
          <h3><span class="material-symbols-outlined" style="vertical-align: middle; margin-right: 8px; color: var(--brand-red);">group</span>Share Event</h3>
          <button class="modal-close-btn" id="smCloseBtn">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="modal-body-dark">
          <div class="share-section">
            <div class="share-section-header">
              <div class="share-section-icon owner"><span class="material-symbols-outlined">shield_person</span></div>
              <span class="share-section-title">Owners</span>
              <span class="share-section-count" id="smOwnerCount">0</span>
            </div>
            <div class="share-list"><ul id="smOwnerList"></ul></div>
          </div>
          <div class="share-section">
            <div class="share-section-header">
              <div class="share-section-icon lead"><span class="material-symbols-outlined">star</span></div>
              <span class="share-section-title">Leads</span>
              <span class="share-section-count" id="smLeadCount">0</span>
            </div>
            <div class="share-list"><ul id="smLeadList"></ul></div>
          </div>
          <div class="share-section">
            <div class="share-section-header">
              <div class="share-section-icon shared"><span class="material-symbols-outlined">people</span></div>
              <span class="share-section-title">Shared With</span>
              <span class="share-section-count" id="smSharedCount">0</span>
            </div>
            <div class="share-list"><ul id="smSharedList"></ul></div>
          </div>
        </div>
        <div class="share-add-section">
          <div class="form-group-dark">
            <label><span class="material-symbols-outlined">person_add</span> Add People</label>
            <div id="smDropdownContainer" class="share-user-dropdown">
              <button type="button" class="share-dropdown-trigger" id="smDropdownTrigger">
                <span class="dropdown-value placeholder">Select a person...</span>
                <span class="material-symbols-outlined dropdown-arrow">expand_less</span>
              </button>
              <div class="share-dropdown-menu" id="smDropdownMenu">
                <div class="share-dropdown-search">
                  <input type="text" id="smSearchInput" placeholder="Search by name or email..." autocomplete="off">
                </div>
                <div class="share-dropdown-options" id="smDropdownOptions"></div>
              </div>
            </div>
          </div>
          <div><div id="smSelectedUsers" class="selected-users"></div></div>
        </div>
        <div class="modal-footer-dark">
          <button class="btn-secondary" id="smCancelBtn">Cancel</button>
          <button class="btn-crew-share" id="smShareCrewBtn">
            <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">groups</span>
            Share with Crew
          </button>
          <button class="btn-primary" id="smShareBtn">
            <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">send</span>
            Share
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('smCloseBtn').onclick = close;
    document.getElementById('smCancelBtn').onclick = close;
    document.getElementById('smShareBtn').onclick = submitShare;
    document.getElementById('smShareCrewBtn').onclick = shareWithCrew;
    modal.onclick = (e) => { if (e.target === modal) close(); };

    return modal;
  }

  function close() {
    const modal = document.getElementById('smShareModal');
    if (modal) modal.classList.remove('show');
    document.body.style.overflow = '';
    selectedUsers = [];
    currentTableId = null;
  }

  async function shareRequest(email, extra = {}) {
    const res = await fetch(`${apiBase()}/api/tables/${currentTableId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({ email, makeOwner: false, makeLead: false, ...extra })
    });
    const result = await res.json();
    return { ok: res.ok, result };
  }

  // ---- Open + render ----
  async function open(tableId) {
    try {
      const res = await fetch(`${apiBase()}/api/tables/${tableId}`, {
        headers: { Authorization: authHeader() }
      });
      if (!res.ok) throw new Error('Failed to fetch event details');
      const table = await res.json();

      const userId = getUserIdFromToken();
      const isOwner = Array.isArray(table.owners) && table.owners.includes(userId);
      if (!isOwner) {
        toast('Not authorized. Only owners can share events.', 'error');
        return;
      }

      currentTableId = tableId;
      const modal = buildModal();
      modal.classList.add('show');
      document.body.style.overflow = 'hidden';

      const userRes = await fetch(`${apiBase()}/api/users`, {
        headers: { Authorization: authHeader() }
      });
      allUsers = await userRes.json();

      const owners = allUsers.filter(u => table.owners.includes(u._id));
      const leads = allUsers.filter(u => (table.leads || []).includes(u._id) && !table.owners.includes(u._id));
      const shared = allUsers.filter(u =>
        (table.sharedWith || []).includes(u._id) &&
        !(table.leads || []).includes(u._id) &&
        !table.owners.includes(u._id));

      const isLead = (user) => Array.isArray(table.leads) && table.leads.includes(user._id);
      const isOwnerUser = (user) => Array.isArray(table.owners) && table.owners.includes(user._id);

      function renderUser(user, isOwnerList) {
        const name = user.name || user.fullName || user.email;
        const email = escapeHtml(user.email);
        const isSelf = user._id === userId;

        let actions = '';
        if (!isOwnerUser(user)) {
          actions += `<button class="share-role-btn owner-btn" data-action="owner" data-email="${email}">Owner</button>`;
        }
        if (!isLead(user)) {
          actions += `<button class="share-role-btn lead-btn" data-action="lead" data-email="${email}">Lead</button>`;
        }
        if (!isSelf && (!isOwnerList || !isOwnerUser(user))) {
          actions += `<button class="share-remove-btn" data-action="remove" data-email="${email}" title="Remove from event"><span class="material-symbols-outlined">close</span></button>`;
        }

        return `
          <li>
            <div class="share-user-avatar">${getInitials(name)}</div>
            <div class="share-user-info">
              <div class="share-user-name">${escapeHtml(name)}${isSelf ? ' (you)' : ''}</div>
              <div class="share-user-email">${email}</div>
            </div>
            <div class="share-user-actions">${actions}</div>
          </li>`;
      }

      const emptyState = (msg) => `<li class="share-empty-item"><div class="share-empty">${msg}</div></li>`;

      document.getElementById('smOwnerList').innerHTML =
        owners.length ? owners.map(u => renderUser(u, true)).join('') : emptyState('No owners');
      document.getElementById('smLeadList').innerHTML =
        leads.length ? leads.map(u => renderUser(u, false)).join('') : emptyState('No leads assigned');
      document.getElementById('smSharedList').innerHTML =
        shared.length ? shared.map(u => renderUser(u, false)).join('') : emptyState('No users shared with');

      document.getElementById('smOwnerCount').textContent = owners.length;
      document.getElementById('smLeadCount').textContent = leads.length;
      document.getElementById('smSharedCount').textContent = shared.length;

      // Role / remove buttons
      modal.querySelectorAll('[data-action]').forEach(btn => {
        btn.onclick = async () => {
          const email = btn.getAttribute('data-email');
          const action = btn.getAttribute('data-action');
          const prompts = {
            owner: 'Make this user an owner? This gives them full control of the event, including deletion.',
            lead: 'Make this user a lead?',
            remove: 'Remove this user from the event?'
          };
          if (!confirm(prompts[action])) return;
          const extra = action === 'owner' ? { makeOwner: true }
            : action === 'lead' ? { makeLead: true }
            : { unshare: true };
          try {
            const { ok, result } = await shareRequest(email, extra);
            if (ok) {
              toast(action === 'remove' ? 'User removed from event' : 'Role updated successfully', 'success');
              await open(tableId);
            } else {
              toast(result.error || 'Error updating sharing', 'error');
            }
          } catch {
            toast('Failed to update. Please try again.', 'error');
          }
        };
      });

      selectedUsers = [];
      setupDropdown();
      renderSelectedUsers();
    } catch (err) {
      console.error('[SHARE_MODAL] Error opening share modal:', err);
      toast('Error opening share options. Please try again.', 'error');
    }
  }

  // ---- Add-people dropdown ----
  function setupDropdown() {
    const container = document.getElementById('smDropdownContainer');
    const trigger = document.getElementById('smDropdownTrigger');
    const menu = document.getElementById('smDropdownMenu');
    const searchInput = document.getElementById('smSearchInput');
    const options = document.getElementById('smDropdownOptions');
    let isOpen = false;

    function renderOptions(filter = '') {
      const filtered = allUsers.filter(user => {
        const name = (user.name || user.fullName || '').toLowerCase();
        const email = (user.email || '').toLowerCase();
        if (selectedUsers.some(s => s._id === user._id)) return false;
        return !filter || name.includes(filter.toLowerCase()) || email.includes(filter.toLowerCase());
      });

      if (!filtered.length) {
        options.innerHTML = '<div class="share-dropdown-empty">No users found</div>';
        return;
      }
      options.innerHTML = filtered.map(user => {
        const name = user.name || user.fullName || user.email;
        return `
          <button type="button" class="share-dropdown-option" data-user-id="${user._id}">
            <div class="option-avatar">${getInitials(name)}</div>
            <div class="option-info">
              <span class="option-name">${escapeHtml(name)}</span>
              <span class="option-email">${escapeHtml(user.email)}</span>
            </div>
          </button>`;
      }).join('');

      options.querySelectorAll('.share-dropdown-option').forEach(option => {
        option.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const user = allUsers.find(u => u._id === option.dataset.userId);
          if (user && !selectedUsers.some(s => s._id === user._id)) {
            selectedUsers.push(user);
            renderSelectedUsers();
          }
          searchInput.value = '';
          closeDropdown();
        };
      });
    }

    function openDropdown() {
      isOpen = true;
      container.classList.add('open');
      const triggerRect = trigger.getBoundingClientRect();
      const availableHeight = Math.min(280, triggerRect.top - 20);
      menu.style.cssText = `
        display: block !important;
        position: absolute !important;
        bottom: calc(100% + 4px) !important;
        left: 0 !important;
        right: 0 !important;
        max-height: ${availableHeight}px !important;
        z-index: 999999 !important;
        background: #1a1a1a !important;
        border: 1px solid #333 !important;
        border-radius: 8px !important;
        box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.6) !important;
        overflow: hidden !important;`;
      renderOptions(searchInput.value);
      setTimeout(() => searchInput.focus(), 50);
    }

    function closeDropdown() {
      isOpen = false;
      container.classList.remove('open');
      menu.style.cssText = 'display: none !important;';
    }

    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isOpen ? closeDropdown() : openDropdown();
    };
    searchInput.oninput = (e) => renderOptions(e.target.value);
    searchInput.onclick = (e) => e.stopPropagation();

    document.addEventListener('click', (e) => {
      if (isOpen && !container.contains(e.target) && !menu.contains(e.target)) closeDropdown();
    });

    closeDropdown();
  }

  function renderSelectedUsers() {
    const containerEl = document.getElementById('smSelectedUsers');
    const trigger = document.getElementById('smDropdownTrigger');
    if (!containerEl || !trigger) return;
    const valueSpan = trigger.querySelector('.dropdown-value');

    if (!selectedUsers.length) {
      containerEl.innerHTML = '';
      valueSpan.textContent = 'Select a person...';
      valueSpan.classList.add('placeholder');
      return;
    }

    containerEl.innerHTML = selectedUsers.map(user => {
      const name = user.name || user.fullName || user.email;
      return `
        <div class="selected-user-chip">
          <div class="chip-avatar">${getInitials(name)}</div>
          <span class="chip-name">${escapeHtml(name)}</span>
          <button type="button" class="chip-remove" data-user-id="${user._id}">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>`;
    }).join('');

    containerEl.querySelectorAll('.chip-remove').forEach(btn => {
      btn.onclick = () => {
        selectedUsers = selectedUsers.filter(u => u._id !== btn.dataset.userId);
        renderSelectedUsers();
      };
    });

    valueSpan.textContent = `${selectedUsers.length} selected`;
    valueSpan.classList.remove('placeholder');
  }

  // ---- Share actions ----
  async function submitShare() {
    if (!currentTableId) return;
    if (!selectedUsers.length) {
      toast('Please select at least one user to share with.', 'warning');
      return;
    }
    const tableId = currentTableId;
    try {
      let successCount = 0;
      const failed = [];
      for (const user of selectedUsers) {
        const { ok, result } = await shareRequest(user.email);
        if (ok) successCount++;
        else failed.push(`${user.name || user.email}: ${result.error || 'error'}`);
      }
      if (successCount > 0) toast(`Successfully shared with ${successCount} user(s).`, 'success', 5000);
      if (failed.length > 0) toast(`Failed to share with: ${failed.join(', ')}`, 'error', 5000);
      if (successCount > 0) await open(tableId);
    } catch (err) {
      console.error('[SHARE_MODAL] Share failed:', err);
      toast('Failed to share event. Please try again.', 'error');
    }
  }

  async function shareWithCrew() {
    if (!currentTableId) return;
    const tableId = currentTableId;
    const btn = document.getElementById('smShareCrewBtn');
    btn.disabled = true;
    try {
      const res = await fetch(`${apiBase()}/api/tables/${tableId}`, {
        headers: { Authorization: authHeader() }
      });
      if (!res.ok) throw new Error('Failed to fetch event data');
      const table = await res.json();

      const currentUserId = getUserIdFromToken();
      const existingIds = new Set([...(table.owners || []), ...(table.leads || []), ...(table.sharedWith || [])]);
      const crewNames = [...new Set(
        (table.rows || [])
          .filter(row => row.name && row.name.trim() && row.role !== '__placeholder__')
          .map(row => row.name.trim().toLowerCase())
      )];

      if (!crewNames.length) {
        toast('No crew members found on this event.', 'warning');
        return;
      }

      const usersToShare = allUsers.filter(user => {
        if (existingIds.has(user._id) || user._id === currentUserId) return false;
        const userName = (user.name || user.fullName || '').toLowerCase();
        return crewNames.includes(userName);
      });

      if (!usersToShare.length) {
        toast('All crew members are already shared with this event.', 'info');
        return;
      }

      if (!confirm(`Share this event with ${usersToShare.length} crew member(s)?`)) return;

      let successCount = 0;
      let failureCount = 0;
      for (const user of usersToShare) {
        const { ok } = await shareRequest(user.email);
        if (ok) successCount++;
        else failureCount++;
      }
      if (successCount > 0) toast(`Successfully shared with ${successCount} crew member(s).`, 'success', 5000);
      if (failureCount > 0) toast(`Failed to share with ${failureCount} member(s).`, 'error', 5000);
      if (successCount > 0) await open(tableId);
    } catch (err) {
      console.error('[SHARE_MODAL] Share with crew failed:', err);
      toast('Failed to share with crew. Please try again.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  window.ShareModal = { open, close };
})();
