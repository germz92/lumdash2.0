(function() {
  'use strict';

  const API_BASE = window.API_BASE || '';
  function getToken() { return `Bearer ${localStorage.getItem('token')}`; }

  const STATUS_LABELS = { in_review: 'In Review', delivered: 'Delivered', archived: 'Archived' };
  const DECISION_LABELS = { none: 'Awaiting approval', approved: 'Approved' };

  let clients = [];
  let projects = [];
  let statusFilter = 'in_review';
  let clientFilter = '';
  let clientSuggestIndex = -1;
  let searchQuery = '';
  let isAdmin = false;
  // Plain PINs known this session after set/random (needed to include in share emails)
  const knownPortalPins = Object.create(null);

  // Detail modal state
  let detail = null;            // current project detail payload
  let currentVersionId = null;  // selected version in the player
  let player = null;            // player.js instance for the Bunny iframe
  let composeTimecode = null;   // seconds for the next comment, or null when detached
  let composeTimecodeEnd = null;
  let composeTimecodeAttached = true; // default: stamp comments with the playhead
  let composePickingEnd = false; // lock start; playhead sets the end
  let hideResolved = false;
  let statusPollTimer = null;
  let annotate = null;
  let annotateTool = 'off';
  let compareMode = false;
  let compareVersionId = null;
  let comparePlayer = null;
  let teamUsers = [];
  let pendingMentions = []; // { userId, name } selected for compose
  let mentionQueryStart = -1;
  let viewingCommentId = null; // comment whose drawing is currently shown
  let playerListenersBound = false;
  let annotationWatchTimer = null;
  let cachedPlayerDuration = 0; // fallback when version.durationSeconds is missing

  function readTokenPayload() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return {};
      return JSON.parse(atob(token.split('.')[1])) || {};
    } catch { return {}; }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtTimecode(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtCommentTimecode(c) {
    if (c?.timecodeSeconds == null) return '';
    const start = fmtTimecode(c.timecodeSeconds);
    if (c.timecodeEndSeconds != null && c.timecodeEndSeconds > c.timecodeSeconds) {
      return `${start}–${fmtTimecode(c.timecodeEndSeconds)}`;
    }
    return start;
  }

  function authorInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function hasSeekTimecode(c) {
    if (c == null || c.timecodeSeconds == null || c.timecodeSeconds === '') return false;
    const n = Number(c.timecodeSeconds);
    return Number.isFinite(n) && n >= 0;
  }

  function versionDurationSeconds() {
    const fromMeta = Number(currentVersion()?.durationSeconds) || 0;
    if (fromMeta > 0) return fromMeta;
    return cachedPlayerDuration > 0 ? cachedPlayerDuration : 0;
  }

  function toast(msg, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:3000;
      padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;color:#fff;
      background:${type === 'error' ? '#c0392b' : '#1f7a3d'};box-shadow:0 4px 16px rgba(0,0,0,.4);`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: getToken(),
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // Player.js (controls the Bunny iframe: currentTime for timestamped comments)
  function ensurePlayerJs() {
    return new Promise((resolve) => {
      if (window.playerjs) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://cdn.embed.ly/player-0.1.0.min.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  function ensureAnnotateLib() {
    return new Promise((resolve) => {
      if (window.PortalAnnotate) return resolve(true);
      const script = document.createElement('script');
      script.src = `js/portal-annotate.js?v=${Date.now()}`;
      script.onload = () => resolve(!!window.PortalAnnotate);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  async function loadTeamUsers() {
    if (teamUsers.length) return teamUsers;
    try {
      teamUsers = await api('/api/users');
    } catch {
      teamUsers = [];
    }
    return teamUsers;
  }

  // ---- Data ----
  async function loadClients() {
    clients = await api('/api/portal-clients');
    const projSel = document.getElementById('projClient');
    const options = clients.filter(c => !c.archived)
      .map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('');
    syncClientFilterInput();
    if (projSel) {
      const prev = projSel.value;
      projSel.innerHTML = `<option value="" disabled selected>Select a client…</option>${options}`;
      if (prev && clients.some(c => c._id === prev && !c.archived)) projSel.value = prev;
      fillProjectFolderSelect(projSel.value);
      fillProjectAccessPicker(projSel.value);
    }
  }

  function activeClients() {
    return (clients || []).filter(c => !c.archived);
  }

  function syncClientFilterInput() {
    const input = document.getElementById('vpClientFilterInput');
    const clearBtn = document.getElementById('vpClientFilterClear');
    if (!input) return;
    if (clientFilter) {
      const c = clients.find(x => String(x._id) === String(clientFilter));
      input.value = c ? (c.name || '') : '';
    }
    if (clearBtn) clearBtn.hidden = !clientFilter;
  }

  function matchClients(query) {
    const q = (query || '').trim().toLowerCase();
    const list = activeClients();
    if (!q) return list.slice(0, 12);
    return list.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 12);
  }

  function hideClientSuggest() {
    const list = document.getElementById('vpClientSuggestList');
    const input = document.getElementById('vpClientFilterInput');
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    if (input) input.setAttribute('aria-expanded', 'false');
    clientSuggestIndex = -1;
  }

  function showClientSuggest(matches) {
    const list = document.getElementById('vpClientSuggestList');
    const input = document.getElementById('vpClientFilterInput');
    if (!list || !input) return;
    if (!matches.length) {
      list.innerHTML = '<div class="vp-client-suggest-empty">No matching clients</div>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      clientSuggestIndex = -1;
      return;
    }
    list.innerHTML = matches.map((c, i) =>
      `<button type="button" class="vp-client-suggest-item" role="option" data-id="${c._id}" data-index="${i}">${escapeHtml(c.name || 'Untitled')}</button>`
    ).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    clientSuggestIndex = -1;
    list.querySelectorAll('.vp-client-suggest-item').forEach(btn => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        selectClientFilter(btn.dataset.id, btn.textContent);
      });
    });
  }

  function highlightClientSuggest(index) {
    const list = document.getElementById('vpClientSuggestList');
    if (!list || list.hidden) return;
    const items = [...list.querySelectorAll('.vp-client-suggest-item')];
    if (!items.length) return;
    clientSuggestIndex = ((index % items.length) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('is-active', i === clientSuggestIndex));
    items[clientSuggestIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function setStatusFilter(status) {
    statusFilter = status || 'all';
    document.querySelectorAll('.vp-status-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.status === statusFilter);
    });
  }

  function showClientProjects(clientId) {
    const client = clients.find(c => String(c._id) === String(clientId));
    if (!client) return;
    closeClientsView();
    setStatusFilter('all');
    selectClientFilter(client._id, client.name);
  }

  function selectClientFilter(id, name) {
    clientFilter = id ? String(id) : '';
    const input = document.getElementById('vpClientFilterInput');
    const clearBtn = document.getElementById('vpClientFilterClear');
    if (input) input.value = name || '';
    if (clearBtn) clearBtn.hidden = !clientFilter;
    hideClientSuggest();
    renderGrid();
  }

  function clearClientFilter() {
    clientFilter = '';
    const input = document.getElementById('vpClientFilterInput');
    const clearBtn = document.getElementById('vpClientFilterClear');
    if (input) {
      input.value = '';
      input.focus();
    }
    if (clearBtn) clearBtn.hidden = true;
    hideClientSuggest();
    renderGrid();
  }

  function setupClientSuggest() {
    const wrap = document.getElementById('vpClientSuggest');
    const input = document.getElementById('vpClientFilterInput');
    const clearBtn = document.getElementById('vpClientFilterClear');
    if (!wrap || !input) return;

    input.addEventListener('focus', () => {
      showClientSuggest(matchClients(input.value));
    });

    input.addEventListener('input', () => {
      // Typing after a selection unlocks until a new pick (empty = all)
      if (clientFilter) {
        const selected = clients.find(c => String(c._id) === String(clientFilter));
        if (!selected || input.value !== (selected.name || '')) {
          clientFilter = '';
          if (clearBtn) clearBtn.hidden = true;
          renderGrid();
        }
      }
      if (!input.value.trim() && !clientFilter) {
        showClientSuggest(matchClients(''));
        return;
      }
      showClientSuggest(matchClients(input.value));
    });

    input.addEventListener('keydown', (e) => {
      const list = document.getElementById('vpClientSuggestList');
      const open = list && !list.hidden;
      const items = open ? [...list.querySelectorAll('.vp-client-suggest-item')] : [];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!open) showClientSuggest(matchClients(input.value));
        else highlightClientSuggest(clientSuggestIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (open) highlightClientSuggest(clientSuggestIndex - 1);
      } else if (e.key === 'Enter') {
        if (open && items.length) {
          e.preventDefault();
          const idx = clientSuggestIndex >= 0 ? clientSuggestIndex : 0;
          const item = items[idx];
          if (item) selectClientFilter(item.dataset.id, item.textContent);
        }
      } else if (e.key === 'Escape') {
        hideClientSuggest();
        if (clientFilter) syncClientFilterInput();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        hideClientSuggest();
        if (clientFilter) syncClientFilterInput();
        else if (input.value.trim()) {
          // No locked selection — clear partial text so filter stays "all"
          input.value = '';
        }
      }, 120);
    });

    clearBtn?.addEventListener('click', () => clearClientFilter());

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) hideClientSuggest();
    });
  }

  function fillProjectFolderSelect(clientId, selectedFolderId = '') {
    const sel = document.getElementById('projFolder');
    if (!sel) return;
    const client = clients.find(c => c._id === clientId);
    const folders = client ? sortedClientFolders(client) : [];
    sel.innerHTML = `<option value="">No folder</option>` +
      folders.map(f => `<option value="${f._id}">${escapeHtml(f.name)}</option>`).join('');
    if (selectedFolderId) sel.value = selectedFolderId;
  }

  function fillDetailFolderSelect() {
    const sel = document.getElementById('detailFolderSelect');
    if (!sel || !detail) return;
    const folders = detail.clientFolders || sortedClientFolders(clients.find(c => c._id === String(detail.clientId)) || {});
    sel.innerHTML = `<option value="">No folder</option>` +
      folders.map(f => `<option value="${f._id}">${escapeHtml(f.name)}</option>`).join('');
    sel.value = detail.folderId ? String(detail.folderId) : '';
  }

  async function loadProjects() {
    projects = await api('/api/video-projects');
    renderGrid();
  }

  // ---- Project grid ----
  function filteredProjects() {
    let items = projects;
    if (statusFilter !== 'all') items = items.filter(p => p.status === statusFilter);
    else items = items.filter(p => p.status !== 'archived');
    if (clientFilter) items = items.filter(p => (p.clientId || '').toString() === clientFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(p =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.clientName || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }
    return items;
  }

  function renderGrid() {
    const container = document.getElementById('vpContainer');
    const items = filteredProjects();

    if (items.length === 0) {
      container.innerHTML = `
        <div class="vp-empty">
          <span class="material-symbols-outlined">movie</span>
          No projects here yet. Create a client, then start a project and upload the first cut.
        </div>`;
      return;
    }

    container.innerHTML = `<div class="vp-grid">${items.map(p => {
      const thumb = (p.thumbnailUrl || p.latestVersion?.thumbnailUrl)
        ? `<img src="${escapeHtml(p.thumbnailUrl || p.latestVersion.thumbnailUrl)}" alt="" loading="lazy">`
        : `<span class="material-symbols-outlined">movie</span>`;
      const versionTag = p.latestVersion ? `<span class="vp-card-version-tag">v${p.latestVersion.versionNumber}</span>` : '';
      const commentTag = p.openCommentCount > 0
        ? `<span class="vp-card-comments-tag"><span class="material-symbols-outlined">chat</span>${p.openCommentCount}</span>`
        : '';
      const decision = p.reviewDecision?.status || 'none';
      const showApproved = decision === 'approved' && p.status === 'in_review';
      const statusBadge = showApproved
        ? `<span class="vp-status-badge approved">${DECISION_LABELS.approved}</span>`
        : `<span class="vp-status-badge ${p.status}">${STATUS_LABELS[p.status] || p.status}</span>`;
      const dueHint = p.feedbackDueAt && p.status === 'in_review' && decision !== 'approved'
        ? ` · Due ${fmtDate(p.feedbackDueAt)}`
        : '';
      return `
        <div class="vp-card" data-id="${p._id}">
          <div class="vp-card-thumb">${thumb}${versionTag}${commentTag}</div>
          <div class="vp-card-body">
            <div class="vp-card-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
            <div class="vp-card-meta">
              <span>${escapeHtml(p.clientName || '')}${p.category ? ` · ${escapeHtml(p.category)}` : ''}${dueHint}</span>
              ${statusBadge}
            </div>
            ${p.viewerNames?.length
              ? `<div class="vp-card-access">${escapeHtml(p.viewerNames.join(', '))}</div>`
              : `<div class="vp-card-access">Company preview only</div>`}
          </div>
        </div>`;
    }).join('')}</div>`;

    container.querySelectorAll('.vp-card').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
  }

  // ---- Clients page ----
  let editingClientId = null;
  let assigningClientId = null;
  let assigningPersonId = null;

  function clientIdOf(p) {
    return (p.clientId?._id || p.clientId || '').toString();
  }

  function orphanCategoriesForClient(clientId) {
    const folderNames = new Set(
      (clients.find(c => c._id === clientId)?.folders || []).map(f => (f.name || '').toLowerCase())
    );
    const cats = new Set();
    projects.filter(p => clientIdOf(p) === String(clientId)).forEach(p => {
      const cat = (p.category || '').trim();
      if (!p.folderId && cat && !folderNames.has(cat.toLowerCase())) cats.add(cat);
    });
    return [...cats].sort((a, b) => a.localeCompare(b));
  }

  function sortedClientFolders(c) {
    return [...(c.folders || [])].sort(
      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.name).localeCompare(String(b.name))
    );
  }

  function activePeople(client) {
    return (client?.contacts || []).filter(c => !c.revokedAt);
  }

  function personLabel(p) {
    return p.name || p.email || 'Person';
  }

  function renderAccessChips(container, people, selectedIds, { emptyText = 'No people on this client yet.' } = {}) {
    if (!container) return;
    const selected = new Set((selectedIds || []).map(String));
    if (!people.length) {
      container.innerHTML = `<span class="vp-access-empty">${escapeHtml(emptyText)}</span>`;
      return;
    }
    container.innerHTML = people.map(p => {
      const on = selected.has(String(p._id));
      return `<label class="vp-access-chip${on ? ' is-on' : ''}">
        <input type="checkbox" value="${p._id}" ${on ? 'checked' : ''}>
        <span>${escapeHtml(personLabel(p))}</span>
      </label>`;
    }).join('');
    container.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        input.closest('.vp-access-chip')?.classList.toggle('is-on', input.checked);
      });
    });
  }

  function selectedAccessIds(container) {
    if (!container) return [];
    return [...container.querySelectorAll('input[type="checkbox"]:checked')].map(el => el.value);
  }

  function assignableClientProjects(clientId) {
    return (projects || []).filter(p =>
      String(p.clientId) === String(clientId) && p.status !== 'archived'
    );
  }

  function personHasProject(project, personId) {
    return (project.viewerIds || []).some(id => String(id) === String(personId));
  }

  function personAssignCountLabel(clientId, personId) {
    const total = assignableClientProjects(clientId).length;
    const n = personProjectIds(clientId, personId).length;
    if (!total) return 'Assign videos';
    if (!n) return 'Assign videos';
    if (n === total) return 'All videos';
    return `${n} video${n === 1 ? '' : 's'}`;
  }

  function syncPersonAssignButton(clientId, personId) {
    const label = document.querySelector(`[data-action="assign-person-videos"][data-person="${personId}"] .vp-assign-btn-label`);
    if (label) label.textContent = personAssignCountLabel(clientId, personId);
  }

  function applyPersonProjectsLocally(clientId, personId, projectIds) {
    const wanted = new Set((projectIds || []).map(String));
    const pid = String(personId);
    assignableClientProjects(clientId).forEach(p => {
      const set = new Set((p.viewerIds || []).map(String));
      if (wanted.has(String(p._id))) set.add(pid);
      else set.delete(pid);
      p.viewerIds = [...set];
      if (detail && String(detail._id) === String(p._id)) {
        detail.viewerIds = p.viewerIds;
      }
    });
    syncPersonAssignButton(clientId, personId);
  }

  async function setPersonProjects(clientId, personId, projectIds) {
    await api(`/api/portal-clients/${clientId}/contacts/${personId}/projects`, {
      method: 'PUT',
      body: JSON.stringify({ projectIds })
    });
    applyPersonProjectsLocally(clientId, personId, projectIds);
  }

  function personProjectIds(clientId, personId) {
    return assignableClientProjects(clientId)
      .filter(p => personHasProject(p, personId))
      .map(p => String(p._id));
  }

  function selectedAssignProjectIds() {
    return [...document.querySelectorAll('#vpAssignList input[type="checkbox"]:checked')].map(el => el.value);
  }

  function setAssignModalChecks(on) {
    document.querySelectorAll('#vpAssignList input[type="checkbox"]').forEach(cb => {
      cb.checked = !!on;
    });
  }

  function openAssignVideosModal(clientId, personId) {
    const client = clients.find(c => String(c._id) === String(clientId));
    const person = client ? activePeople(client).find(p => String(p._id) === String(personId)) : null;
    if (!client || !person) return;
    assigningClientId = String(clientId);
    assigningPersonId = String(personId);

    const titleEl = document.getElementById('vpAssignTitle');
    const subEl = document.getElementById('vpAssignSub');
    const list = document.getElementById('vpAssignList');
    if (titleEl) titleEl.textContent = 'Assign videos';
    if (subEl) subEl.textContent = `Choose what ${personLabel(person)} sees on their portal link`;

    const items = assignableClientProjects(clientId);
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="vp-muted-line">No projects yet — create one, then assign it here.</div>';
    } else {
      list.innerHTML = items.map(p => {
        const on = personHasProject(p, personId);
        const status = STATUS_LABELS[p.status] || p.status || '';
        return `<label class="vp-assign-row">
          <input type="checkbox" value="${p._id}" ${on ? 'checked' : ''}>
          <span class="vp-assign-row-meta">
            <span class="vp-assign-row-title">${escapeHtml(p.title)}</span>
            <span class="vp-assign-row-status">${escapeHtml(status)}</span>
          </span>
        </label>`;
      }).join('');
    }
    showModal('vpAssignModal');
  }

  async function saveAssignVideosModal() {
    if (!assigningClientId || !assigningPersonId) return;
    const btn = document.getElementById('vpAssignSaveBtn');
    if (btn) btn.disabled = true;
    try {
      await setPersonProjects(assigningClientId, assigningPersonId, selectedAssignProjectIds());
      hideModal('vpAssignModal');
      toast('Video access saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function syncPreviewOnlyState() {
    const previewOnly = document.getElementById('projPreviewOnly');
    const label = document.getElementById('projPreviewOnlyLabel');
    label?.classList.toggle('is-on', !!previewOnly?.checked);
  }

  function wireProjectAccessPicker() {
    const list = document.getElementById('projAccessList');
    const previewOnly = document.getElementById('projPreviewOnly');
    list?.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked || !previewOnly) return;
        previewOnly.checked = false;
        syncPreviewOnlyState();
      });
    });
    if (previewOnly && !previewOnly.dataset.wired) {
      previewOnly.dataset.wired = '1';
      previewOnly.addEventListener('change', () => {
        if (previewOnly.checked) {
          list?.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.checked = false;
            input.closest('.vp-access-chip')?.classList.remove('is-on');
          });
        }
        syncPreviewOnlyState();
      });
    }
    syncPreviewOnlyState();
  }

  function fillProjectAccessPicker(clientId) {
    const wrap = document.getElementById('projAccessWrap');
    const list = document.getElementById('projAccessList');
    const previewOnly = document.getElementById('projPreviewOnly');
    const client = clients.find(c => String(c._id) === String(clientId));
    const people = client ? activePeople(client) : [];
    if (!wrap) return;
    if (!clientId || !people.length) {
      wrap.hidden = true;
      if (previewOnly) previewOnly.checked = false;
      syncPreviewOnlyState();
      if (list) list.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    if (previewOnly) previewOnly.checked = false;
    renderAccessChips(list, people, []);
    wireProjectAccessPicker();
  }

  function fillDetailAccessList() {
    const list = document.getElementById('detailAccessList');
    if (!list || !detail) return;
    const people = (detail.clientContacts || activePeople(clients.find(c => String(c._id) === String(detail.clientId)) || {})).filter(c => !c.revokedAt);
    renderAccessChips(list, people, detail.viewerIds || [], {
      emptyText: 'Add people on the client to share this video on their links.'
    });
    list.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.addEventListener('change', saveDetailAccess);
    });
  }

  async function saveDetailAccess() {
    if (!detail) return;
    const list = document.getElementById('detailAccessList');
    const viewerIds = selectedAccessIds(list);
    try {
      await api(`/api/video-projects/${detail._id}`, {
        method: 'PUT',
        body: JSON.stringify({ viewerIds })
      });
      detail.viewerIds = viewerIds;
      const people = detail.clientContacts || [];
      detail.viewerNames = viewerIds.map(id => {
        const p = people.find(c => String(c._id) === String(id));
        return p ? personLabel(p) : null;
      }).filter(Boolean);
      const card = projects.find(p => String(p._id) === String(detail._id));
      if (card) {
        card.viewerIds = viewerIds;
        card.viewerNames = detail.viewerNames;
      }
      renderGrid();
    } catch (err) {
      toast(err.message, 'error');
      fillDetailAccessList();
    }
  }

  async function refreshClientsUi({ keepModal = true } = {}) {
    await loadClients();
    renderClients();
    if (keepModal && editingClientId) {
      const still = clients.find(c => c._id === editingClientId);
      if (still) renderClientEditModal(still);
      else closeClientEdit();
    }
  }

  function renderClients() {
    const list = document.getElementById('clientsList');
    if (!list) return;
    if (clients.length === 0) {
      list.innerHTML = '<div class="vp-empty">No clients yet — add your first one above.</div>';
      return;
    }

    list.innerHTML = clients.map(c => {
      const branding = c.branding || {};
      const counts = c.projectCounts || {};
      const inReview = counts.in_review || 0;
      const delivered = counts.delivered || 0;
      const total = counts.total || 0;
      const name = branding.displayName || c.name || 'Client';
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

      let thumbInner;
      if (branding.logoUrl) {
        thumbInner = `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(name)}" loading="lazy">`;
      } else {
        thumbInner = `<span class="vp-client-card-initials">${escapeHtml(initials)}</span><span class="vp-client-card-logo-hint">Add logo</span>`;
      }

      const tags = [];
      if (inReview > 0) tags.push(`<span class="vp-client-card-tag review">${inReview} in review</span>`);
      if (c.archived) tags.push(`<span class="vp-client-card-tag archived">Archived</span>`);

      const stats = [];
      if (inReview) stats.push(`<span class="vp-client-stat review">${inReview} in review</span>`);
      if (delivered) stats.push(`<span class="vp-client-stat delivered">${delivered} delivered</span>`);
      if (!stats.length && total) stats.push(`<span class="vp-client-stat">${total} project${total !== 1 ? 's' : ''}</span>`);
      if (!total) stats.push(`<span class="vp-client-stat">No projects yet</span>`);

      return `
        <div class="vp-client-card${c.archived ? ' is-archived' : ''}" role="button" tabindex="0" data-open-client="${c._id}">
          <div class="vp-client-card-thumb${branding.logoUrl ? '' : ' is-empty'}">
            ${thumbInner}
            ${tags.join('')}
          </div>
          <div class="vp-client-card-body">
            <div class="vp-client-card-name">${escapeHtml(name)}</div>
            <div class="vp-client-card-meta">${total} project${total !== 1 ? 's' : ''}${c.archived ? ' · archived' : ''}</div>
            <div class="vp-client-card-stats">${stats.join('')}</div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-open-client]').forEach(card => {
      const open = () => openClientEdit(card.dataset.openClient);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function openClientEdit(clientId, { push = true } = {}) {
    const client = clients.find(c => String(c._id) === String(clientId));
    if (!client) {
      showClientsView();
      return;
    }
    if (detail) teardownDetail();
    editingClientId = String(client._id);
    renderClientEditModal(client);
    document.getElementById('vpHeader').style.display = 'none';
    document.getElementById('vpToolbar').style.display = 'none';
    document.getElementById('vpContainer').style.display = 'none';
    document.getElementById('vpDetailView').style.display = 'none';
    document.getElementById('vpClientsView').style.display = 'none';
    document.getElementById('vpClientEditView').style.display = 'flex';
    document.querySelector('.vp-main').scrollTop = 0;
    const already = getHashClientId() === String(clientId);
    if (push) syncPortalUrl({ clients: true, clientId, push: !already });
    else syncPortalUrl({ clients: true, clientId, push: false });
  }

  function hideClientEditView() {
    editingClientId = null;
    const view = document.getElementById('vpClientEditView');
    if (view) view.style.display = 'none';
    const body = document.getElementById('clientEditBody');
    if (body) body.innerHTML = '';
  }

  function closeClientEdit() {
    hideClientEditView();
    showClientsView();
  }

  function portalShareUrl(token, projectId) {
    if (!token) return '';
    let url = `${location.origin}/portal.html?token=${encodeURIComponent(token)}`;
    if (projectId) url += `&project=${encodeURIComponent(projectId)}`;
    return url;
  }

  async function copyPortalShareUrl(url, successMsg) {
    if (!url) {
      toast('No link available', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(successMsg || 'Link copied');
    } catch {
      toast('Could not copy link', 'error');
    }
  }

  function openPortalShareUrl(url) {
    if (!url) {
      toast('No link available', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function shareLinkRowHtml({ title, hint, url, copyToast, extraClass = '', warning = '' }) {
    const disabled = !url;
    return `
      <div class="vp-link-row${extraClass ? ` ${extraClass}` : ''}">
        <div class="vp-link-row-info">
          <div class="vp-link-row-title">${title}</div>
          ${warning ? `<div class="vp-link-warning">${warning}</div>` : ''}
          ${hint ? `<div class="vp-link-row-hint">${hint}</div>` : ''}
        </div>
        <div class="vp-link-row-actions">
          <button type="button" class="vp-btn secondary small" data-links-action="copy" data-url="${escapeHtml(url)}" data-toast="${escapeHtml(copyToast || 'Link copied')}" ${disabled ? 'disabled' : ''}>
            <span class="material-symbols-outlined">content_copy</span>
            <span>Copy</span>
          </button>
          <button type="button" class="vp-btn secondary small" data-links-action="open" data-url="${escapeHtml(url)}" ${disabled ? 'disabled' : ''}>
            <span class="material-symbols-outlined">open_in_new</span>
            <span>Open</span>
          </button>
        </div>
      </div>`;
  }

  function openPortalLinksModal({ clientId, projectId } = {}) {
    const client = clients.find(c => String(c._id) === String(clientId || detail?.clientId));
    const project = projectId && detail && String(detail._id) === String(projectId) ? detail : null;
    const people = client
      ? activePeople(client)
      : (project?.clientContacts || []).filter(c => !c.revokedAt);
    const viewerSet = new Set((project?.viewerIds || []).map(String));
    const companyToken = client?.shareToken || '';
    const masterUrl = portalShareUrl(companyToken, project?._id);

    const titleEl = document.getElementById('vpLinksModalTitle');
    const subEl = document.getElementById('vpLinksModalSub');
    const body = document.getElementById('vpLinksModalBody');
    if (!body) return;

    const clientName = client?.branding?.displayName || client?.name || project?.clientName || 'this client';
    if (titleEl) titleEl.textContent = project ? 'Share this video' : 'Share links';
    if (subEl) {
      subEl.textContent = project
        ? `${project.title} · ${clientName}`
        : `Portal links for ${clientName}`;
    }

    const masterWarning = project
      ? 'Do not send this to a client. Anyone with this link can see every video for this company — not just this one.'
      : 'Do not send this to a client. Anyone with this link can see every video for this company.';

    const peopleIntro = project
      ? 'Each person has a unique link that only shows videos assigned to them under Access. They enter their name when commenting, so they can forward their own link.'
      : 'Each person has a unique link that only shows videos assigned to them. They enter their name when commenting, so they can forward their own link.';

    const personRows = people.length
      ? people.map(p => {
          const assigned = !project || viewerSet.has(String(p._id));
          const url = portalShareUrl(p.token, assigned ? project?._id : undefined);
          const hint = !p.token
            ? 'No link yet — save this person again to generate one.'
            : project
              ? (assigned
                ? 'Can see this video. Their portal only includes videos assigned to them.'
                : 'Not assigned — they will not see this video. Add them under Access first.')
              : 'Only videos assigned to this person. Safe to send to them.';
          return shareLinkRowHtml({
            title: escapeHtml(personLabel(p)),
            hint,
            url,
            copyToast: assigned
              ? 'Person link copied'
              : 'Person link copied — they cannot see this video yet',
            extraClass: assigned ? '' : 'is-unassigned'
          });
        }).join('')
      : '<div class="vp-muted-line">No people yet — add them on the client to create per-person links.</div>';

    body.innerHTML = `
      <div class="vp-link-section">
        <div class="vp-link-section-label">Master — full company</div>
        ${shareLinkRowHtml({
          title: '<span class="material-symbols-outlined">warning</span> Master copy — full company gallery',
          warning: `Warning: ${masterWarning}`,
          hint: masterUrl
            ? (project
              ? 'Opens this video inside the full company gallery. Internal preview only.'
              : 'Opens the full company gallery. Internal preview only.')
            : 'This client does not have a company preview link yet.',
          url: masterUrl,
          copyToast: 'Master company link copied — this shows every video',
          extraClass: 'is-master'
        })}
      </div>
      <div class="vp-link-section">
        <div class="vp-link-section-label">Per person</div>
        <p class="vp-link-section-desc">${peopleIntro}</p>
        ${personRows}
      </div>`;

    showModal('vpLinksModal');
  }

  function renderClientEditModal(c) {
    const branding = c.branding || {};
    const accent = branding.accentColor || '#CC0007';
    const folders = sortedClientFolders(c);
    const orphans = orphanCategoriesForClient(c._id);
    const titleEl = document.getElementById('clientEditTitle');
    const subEl = document.getElementById('clientEditSub');
    const body = document.getElementById('clientEditBody');
    const archiveBtn = document.getElementById('clientEditArchiveBtn');
    const deleteBtn = document.getElementById('clientEditDeleteBtn');
    const viewProjectsBtn = document.getElementById('clientEditViewProjectsBtn');

    if (titleEl) titleEl.textContent = branding.displayName || c.name;
    if (subEl) {
      const n = c.projectCounts?.total || 0;
      subEl.textContent = `${n} project${n !== 1 ? 's' : ''}${c.archived ? ' · archived' : ''}`;
    }
    if (archiveBtn) {
      archiveBtn.title = c.archived ? 'Unarchive client' : 'Archive client (hides their portal)';
      archiveBtn.querySelector('.material-symbols-outlined').textContent = c.archived ? 'unarchive' : 'archive';
      archiveBtn.dataset.action = 'toggle-archive';
      archiveBtn.dataset.client = c._id;
    }
    if (deleteBtn) {
      deleteBtn.style.display = isAdmin ? 'inline-flex' : 'none';
      deleteBtn.dataset.action = 'delete-client';
      deleteBtn.dataset.client = c._id;
    }
    if (viewProjectsBtn) {
      viewProjectsBtn.dataset.client = c._id;
    }

    const people = activePeople(c).map(ct => `
      <div class="vp-contact-row" data-person="${ct._id}">
        <div class="vp-contact-info">
          <div class="vp-contact-name">${escapeHtml(ct.name || ct.email || 'Person')}</div>
        </div>
        <div class="vp-contact-email">${ct.email ? escapeHtml(ct.email) : 'No email'}</div>
        <span class="vp-contact-meta">${ct.invitedAt ? `Sent ${fmtDate(ct.invitedAt)}` : 'Not sent'}${ct.lastAccessAt ? ` · Last visit ${fmtDate(ct.lastAccessAt)}` : ''}</span>
        <div class="vp-contact-actions">
          <button type="button" class="vp-btn secondary small" data-action="assign-person-videos" data-person="${ct._id}" data-client="${c._id}" title="Choose which videos this person can see">
            <span class="material-symbols-outlined">movie</span>
            <span class="vp-assign-btn-label">${personAssignCountLabel(c._id, ct._id)}</span>
          </button>
          <button class="vp-icon-btn" title="Copy this person's portal link" data-action="copy-person-link" data-token="${escapeHtml(ct.token || '')}">
            <span class="material-symbols-outlined">content_copy</span>
          </button>
          <button class="vp-icon-btn" title="Open this person's portal" data-action="open-portal" data-token="${escapeHtml(ct.token || '')}">
            <span class="material-symbols-outlined">open_in_new</span>
          </button>
          ${ct.email ? `
          <button class="vp-icon-btn" title="Email this person their unique link" data-action="invite" data-client="${c._id}" data-contact="${ct._id}">
            <span class="material-symbols-outlined">forward_to_inbox</span>
          </button>` : ''}
          <button class="vp-icon-btn danger" title="Remove person" data-action="remove-contact" data-client="${c._id}" data-contact="${ct._id}">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>`).join('');

    const folderRows = folders.map((f, idx) => `
      <div class="vp-folder-row" data-folder-id="${f._id}">
        <input type="text" class="vp-folder-name" value="${escapeHtml(f.name)}" aria-label="Folder name">
        <div class="vp-folder-actions">
          <button type="button" class="vp-icon-btn" title="Move up" data-action="folder-up" data-client="${c._id}" data-folder="${f._id}" ${idx === 0 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">arrow_upward</span>
          </button>
          <button type="button" class="vp-icon-btn" title="Move down" data-action="folder-down" data-client="${c._id}" data-folder="${f._id}" ${idx === folders.length - 1 ? 'disabled' : ''}>
            <span class="material-symbols-outlined">arrow_downward</span>
          </button>
          <button type="button" class="vp-icon-btn danger" title="Delete folder" data-action="folder-delete" data-client="${c._id}" data-folder="${f._id}">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>`).join('');

    body.innerHTML = `
      <div class="vp-client-block vp-client-edit-layout" data-client="${c._id}">
        <div class="vp-client-edit-top">
          <section class="vp-client-panel vp-client-panel-branding">
            <div class="vp-client-section-title">Portal branding</div>
            <div class="vp-branding-row">
              <div class="vp-brand-logo${branding.logoUrl ? ' has-image' : ''}" data-action="pick-logo" data-client="${c._id}" title="${branding.logoUrl ? 'Change logo' : 'Upload logo'}">
                ${branding.logoUrl
                  ? `<img src="${escapeHtml(branding.logoUrl)}" alt="">
                     <span class="material-symbols-outlined vp-brand-logo-edit">photo_camera</span>`
                  : `<span class="material-symbols-outlined">add_photo_alternate</span>
                     <span class="vp-brand-logo-cta">Add logo</span>`}
              </div>
              <div class="vp-branding-fields">
                <label class="vp-field-label">Client name
                  <input type="text" class="vp-client-name-input" value="${escapeHtml(c.name)}" required>
                </label>
                <label class="vp-field-label">Display name
                  <input type="text" class="vp-brand-display" value="${escapeHtml(branding.displayName || '')}" placeholder="${escapeHtml(c.name)}">
                </label>
                <label class="vp-field-label">Accent
                  <input type="color" class="vp-brand-accent" value="${escapeHtml(accent)}">
                </label>
                <div class="vp-branding-actions">
                  <input type="file" class="vp-brand-logo-file" data-client="${c._id}" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
                  <button type="button" class="vp-btn secondary small" data-action="pick-logo" data-client="${c._id}">
                    <span class="material-symbols-outlined">upload</span>
                    <span>${branding.logoUrl ? 'Replace logo' : 'Upload logo'}</span>
                  </button>
                  ${branding.logoUrl ? `<button type="button" class="vp-btn secondary small" data-action="remove-logo" data-client="${c._id}">Remove logo</button>` : ''}
                  <button type="button" class="vp-btn primary small" data-action="save-branding" data-client="${c._id}">Save branding</button>
                </div>
              </div>
            </div>
          </section>

          ${c.shareToken ? `
          <section class="vp-client-panel vp-client-panel-preview">
            <div class="vp-client-section-title">Company preview</div>
            <div class="vp-share-row">
              <div class="vp-share-info">
                <div class="vp-share-title"><span class="material-symbols-outlined">visibility</span> Internal / full gallery</div>
                <div class="vp-share-hint">Sees every video for this company. Use Share links to copy or open the master preview and each person’s unique link. Do not send the master link to clients.</div>
              </div>
              <div class="vp-share-actions">
                <button type="button" class="vp-btn primary small" data-action="open-share-links" data-client="${c._id}">
                  <span class="material-symbols-outlined">ios_share</span>
                  <span>Share links</span>
                </button>
                <button type="button" class="vp-btn secondary small" data-action="reroll-share-link" data-client="${c._id}" title="Invalidate the current company link and create a new one">
                  <span class="material-symbols-outlined">autorenew</span>
                  <span>Reroll link</span>
                </button>
              </div>
            </div>
            <div class="vp-pin-box">
              <div class="vp-pin-head">
                <div class="vp-share-title"><span class="material-symbols-outlined">lock</span> PIN protect portal</div>
                <div class="vp-share-hint">${c.portalPinEnabled
                  ? 'PIN is on — visitors must enter it before seeing projects.'
                  : 'Optional. Require a 4–8 digit PIN before anyone can open this portal.'}</div>
              </div>
              <div class="vp-pin-row">
                <input type="text" class="vp-portal-pin-input" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="${c.portalPinEnabled ? 'New PIN (optional)' : '4–8 digit PIN'}" autocomplete="off">
                <button type="button" class="vp-btn secondary small" data-action="random-portal-pin" data-client="${c._id}" title="Generate a random 6-digit PIN">
                  <span class="material-symbols-outlined">casino</span>
                  <span>Random</span>
                </button>
                <button type="button" class="vp-btn primary small" data-action="save-portal-pin" data-client="${c._id}">
                  ${c.portalPinEnabled ? 'Update PIN' : 'Set PIN'}
                </button>
                ${c.portalPinEnabled ? `
                <button type="button" class="vp-btn secondary small" data-action="clear-portal-pin" data-client="${c._id}">
                  Remove PIN
                </button>` : ''}
              </div>
            </div>
          </section>` : ''}
        </div>

        <div class="vp-client-edit-cols">
          <section class="vp-client-panel vp-client-panel-people">
            <div class="vp-client-section-title">People</div>
            <p class="vp-share-hint vp-client-panel-intro">Each person gets a unique link. Use Assign videos to choose what they see.</p>
            ${people ? `
            <div class="vp-people-table">
              <div class="vp-people-head">
                <span>Name</span>
                <span>Email</span>
                <span>Status</span>
                <span></span>
              </div>
              ${people}
            </div>` : '<div class="vp-muted-line">No people yet — add Tanya, Jerry, etc.</div>'}
            <form class="vp-add-contact-form" data-client="${c._id}">
              <input type="text" name="name" placeholder="Name (e.g. Tanya)" required>
              <input type="email" name="email" placeholder="Email (optional)">
              <button type="submit" class="vp-btn secondary small">Add</button>
            </form>
          </section>

          <div class="vp-client-edit-side">
            <section class="vp-client-panel">
              <div class="vp-client-section-title">
                <span>Folders</span>
                ${orphans.length ? `<button type="button" class="vp-btn secondary small" data-action="convert-categories" data-client="${c._id}" title="Create folders from: ${escapeHtml(orphans.join(', '))}">Convert categories</button>` : ''}
              </div>
              <div class="vp-folder-list" data-client="${c._id}">
                ${folderRows || '<div class="vp-muted-line">No folders yet — add one to group the client gallery.</div>'}
              </div>
              <form class="vp-add-folder-form" data-client="${c._id}">
                <input type="text" name="name" placeholder="New folder name" required>
                <button type="submit" class="vp-btn secondary small">Add folder</button>
                <button type="button" class="vp-btn primary small" data-action="save-folders" data-client="${c._id}">Save folders</button>
              </form>
            </section>
          </div>
        </div>
      </div>`;

    wireClientEditModal(c._id);
  }

  function wireClientEditModal(clientId) {
    const body = document.getElementById('clientEditBody');
    if (!body) return;

    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleClientAction(btn));
    });

    body.querySelectorAll('.vp-add-contact-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) {
          toast('Name is required', 'error');
          return;
        }
        try {
          await api(`/api/portal-clients/${form.dataset.client}/contacts`, {
            method: 'POST',
            body: JSON.stringify({ name, email: form.elements.email.value.trim() })
          });
          await refreshClientsUi();
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('.vp-add-folder-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.elements.name.value.trim();
        if (!name) return;
        try {
          const client = clients.find(c => c._id === form.dataset.client);
          const folders = sortedClientFolders(client).map((f, i) => ({
            _id: f._id,
            name: f.name,
            sortOrder: i
          }));
          folders.push({ name, sortOrder: folders.length });
          await api(`/api/portal-clients/${form.dataset.client}`, {
            method: 'PUT',
            body: JSON.stringify({ folders })
          });
          await loadProjects();
          await refreshClientsUi();
          toast('Folder added');
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    body.querySelectorAll('.vp-brand-logo-file').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const form = new FormData();
          form.append('logo', file);
          await api(`/api/portal-clients/${input.dataset.client}/logo`, { method: 'POST', body: form });
          await refreshClientsUi();
          toast('Logo uploaded');
        } catch (err) { toast(err.message, 'error'); }
        input.value = '';
      });
    });
  }

  function collectFoldersFromDom(clientId) {
    const block = document.querySelector(`#clientEditBody .vp-client-block[data-client="${clientId}"]`)
      || document.querySelector(`.vp-client-block[data-client="${clientId}"]`);
    if (!block) return [];
    return [...block.querySelectorAll('.vp-folder-row')].map((row, i) => ({
      _id: row.dataset.folderId,
      name: (row.querySelector('.vp-folder-name')?.value || '').trim(),
      sortOrder: i
    })).filter(f => f.name);
  }

  async function saveClientFolders(clientId) {
    const folders = collectFoldersFromDom(clientId);
    await api(`/api/portal-clients/${clientId}`, {
      method: 'PUT',
      body: JSON.stringify({ folders })
    });
    await loadProjects();
    await refreshClientsUi();
  }

  async function handleClientAction(btn) {
    const action = btn.dataset.action;
    const clientId = btn.dataset.client || editingClientId;
    try {
      if (action === 'copy-share-link') {
        const url = `${location.origin}/portal.html?token=${btn.dataset.token}`;
        await navigator.clipboard.writeText(url);
        toast('Company preview link copied');
        return;
      }
      if (action === 'reroll-share-link') {
        if (!confirm('Generate a new company preview link? The current full-gallery URL will stop working. Person links (Tanya, Jerry, etc.) stay the same.')) return;
        btn.disabled = true;
        try {
          await api(`/api/portal-clients/${clientId}/share-token/reroll`, { method: 'POST' });
          await refreshClientsUi();
          toast('Company preview link replaced — copy the new one');
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (action === 'assign-person-videos') {
        openAssignVideosModal(clientId, btn.dataset.person);
        return;
      }
      if (action === 'copy-person-link') {
        if (!btn.dataset.token) {
          toast('This person does not have a portal link yet', 'error');
          return;
        }
        const url = `${location.origin}/portal.html?token=${btn.dataset.token}`;
        await navigator.clipboard.writeText(url);
        toast('Person link copied — they can share it; reviewers enter their name');
        return;
      }
      if (action === 'open-portal') {
        const url = `${location.origin}/portal.html?token=${btn.dataset.token}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (action === 'invite') {
        btn.disabled = true;
        await api(`/api/portal-clients/${clientId}/contacts/${btn.dataset.contact}/invite`, { method: 'POST' });
        toast('Invite email sent');
        await refreshClientsUi();
        return;
      }
      if (action === 'remove-contact') {
        if (!confirm('Remove this person? Their unique link will stop working, and they will be removed from video access.')) return;
        await api(`/api/portal-clients/${clientId}/contacts/${btn.dataset.contact}`, { method: 'DELETE' });
        await refreshClientsUi();
        return;
      }
      if (action === 'toggle-archive') {
        const client = clients.find(c => c._id === clientId);
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ archived: !client.archived })
        });
        await refreshClientsUi();
        return;
      }
      if (action === 'delete-client') {
        if (!confirm('Delete this client? This cannot be undone.')) return;
        await api(`/api/portal-clients/${clientId}`, { method: 'DELETE' });
        closeClientEdit();
        await loadClients();
        renderClients();
        return;
      }
      if (action === 'pick-logo') {
        const input = document.querySelector(`#clientEditBody .vp-brand-logo-file[data-client="${clientId}"]`);
        if (input) input.click();
        return;
      }
      if (action === 'remove-logo') {
        await api(`/api/portal-clients/${clientId}/logo`, { method: 'DELETE' });
        await refreshClientsUi();
        toast('Logo removed');
        return;
      }
      if (action === 'save-branding') {
        const block = document.querySelector(`#clientEditBody .vp-client-block[data-client="${clientId}"]`);
        const name = block?.querySelector('.vp-client-name-input')?.value?.trim() || '';
        const displayName = block?.querySelector('.vp-brand-display')?.value?.trim() || '';
        const accentColor = block?.querySelector('.vp-brand-accent')?.value || '#CC0007';
        if (!name) {
          toast('Client name is required', 'error');
          return;
        }
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, branding: { displayName, accentColor } })
        });
        await refreshClientsUi();
        toast('Branding saved');
        return;
      }
      if (action === 'save-portal-pin') {
        const block = document.querySelector(`#clientEditBody .vp-client-block[data-client="${clientId}"]`);
        const pin = block?.querySelector('.vp-portal-pin-input')?.value?.trim() || '';
        if (!/^\d{4,8}$/.test(pin)) {
          toast('PIN must be 4–8 digits', 'error');
          return;
        }
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ portalPin: pin })
        });
        knownPortalPins[clientId] = pin;
        await refreshClientsUi();
        toast(`Portal PIN saved: ${pin}`);
        return;
      }
      if (action === 'random-portal-pin') {
        const pin = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
        const block = document.querySelector(`#clientEditBody .vp-client-block[data-client="${clientId}"]`);
        const input = block?.querySelector('.vp-portal-pin-input');
        if (input) input.value = pin;
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ portalPin: pin })
        });
        knownPortalPins[clientId] = pin;
        await refreshClientsUi();
        // Re-fill after refresh so admin can copy it
        const refreshed = document.querySelector(`#clientEditBody .vp-client-block[data-client="${clientId}"] .vp-portal-pin-input`);
        if (refreshed) refreshed.value = pin;
        toast(`Random PIN set: ${pin}`);
        return;
      }
      if (action === 'clear-portal-pin') {
        if (!confirm('Remove PIN protection from this client portal?')) return;
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ clearPortalPin: true })
        });
        delete knownPortalPins[clientId];
        await refreshClientsUi();
        toast('Portal PIN removed');
        return;
      }
      if (action === 'open-share-links') {
        openPortalLinksModal({ clientId });
        return;
      }
      if (action === 'save-folders') {
        await saveClientFolders(clientId);
        toast('Folders saved');
        return;
      }
      if (action === 'folder-delete') {
        if (!confirm('Delete this folder? Projects in it move to Other.')) return;
        const folders = collectFoldersFromDom(clientId).filter(f => f._id !== btn.dataset.folder);
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ folders })
        });
        await loadProjects();
        await refreshClientsUi();
        return;
      }
      if (action === 'folder-up' || action === 'folder-down') {
        const folders = collectFoldersFromDom(clientId);
        const idx = folders.findIndex(f => f._id === btn.dataset.folder);
        if (idx < 0) return;
        const swap = action === 'folder-up' ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= folders.length) return;
        [folders[idx], folders[swap]] = [folders[swap], folders[idx]];
        folders.forEach((f, i) => { f.sortOrder = i; });
        await api(`/api/portal-clients/${clientId}`, {
          method: 'PUT',
          body: JSON.stringify({ folders })
        });
        await refreshClientsUi();
        return;
      }
      if (action === 'convert-categories') {
        btn.disabled = true;
        const result = await api(`/api/portal-clients/${clientId}/folders/from-categories`, { method: 'POST' });
        await loadProjects();
        await refreshClientsUi();
        toast(result.created ? `Created ${result.created} folder(s)` : 'Categories converted');
        return;
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function getHashParams() {
    const hash = (location.hash || '').replace(/^#/, '');
    const q = hash.indexOf('?');
    if (q < 0) return new URLSearchParams();
    try {
      return new URLSearchParams(hash.slice(q + 1));
    } catch {
      return new URLSearchParams();
    }
  }

  function getHashProjectId() {
    return getHashParams().get('projectId');
  }

  function getHashClientId() {
    return getHashParams().get('clientId');
  }

  function isClientsViewInUrl() {
    return getHashParams().get('view') === 'clients';
  }

  function syncPortalUrl({ projectId = null, clients = false, clientId = null, push = false } = {}) {
    let next = '#video-portal';
    if (projectId) next = `#video-portal?projectId=${encodeURIComponent(projectId)}`;
    else if (clientId) next = `#video-portal?view=clients&clientId=${encodeURIComponent(clientId)}`;
    else if (clients) next = `#video-portal?view=clients`;
    if (location.hash === next) return;
    const state = { page: 'video-portal', projectId: projectId || null, clients: !!clients, clientId: clientId || null };
    // Prefer replaceState so we don't stack duplicate list entries; use push when
    // opening a project/clients view so browser Back returns to the portal list
    // instead of the previous sidebar page.
    if (push) history.pushState(state, '', next);
    else history.replaceState(state, '', next);
  }

  function syncProjectInUrl(projectId, { push = false } = {}) {
    syncPortalUrl({ projectId: projectId || null, clients: false, push });
  }

  function closeClientsViewQuiet() {
    const el = document.getElementById('vpClientsView');
    if (el) el.style.display = 'none';
    hideClientEditView();
  }

  function showClientsView() {
    if (detail) closeDetailView();
    hideClientEditView();
    document.getElementById('vpHeader').style.display = 'none';
    document.getElementById('vpToolbar').style.display = 'none';
    document.getElementById('vpContainer').style.display = 'none';
    document.getElementById('vpDetailView').style.display = 'none';
    document.getElementById('vpClientsView').style.display = 'flex';
    document.querySelector('.vp-main').scrollTop = 0;
    const alreadyOnClientsList = isClientsViewInUrl() && !getHashClientId();
    syncPortalUrl({ clients: true, push: !alreadyOnClientsList });
    renderClients();
  }

  function closeClientsView() {
    closeClientsViewQuiet();
    document.getElementById('vpHeader').style.display = '';
    document.getElementById('vpToolbar').style.display = '';
    document.getElementById('vpContainer').style.display = '';
    // Stay on Video Portal — never history.back() (that leaves to the previous sidebar page)
    syncPortalUrl();
    renderGrid();
  }

  // ---- Detail modal ----
  async function openDetail(projectId) {
    closeClientsViewQuiet();
    try {
      detail = await api(`/api/video-projects/${projectId}`);
    } catch (err) {
      toast(err.message, 'error');
      syncProjectInUrl(null);
      return;
    }

    // Push a history entry for the project so Back returns to the portal list,
    // not the previous sidebar page (replaceState was overwriting the list entry).
    const alreadyOnProject = getHashProjectId() === String(detail._id);
    syncProjectInUrl(detail._id, { push: !alreadyOnProject });
    const versions = detail.versions || [];
    currentVersionId = versions.length ? versions[versions.length - 1]._id : null;
    composeTimecodeAttached = true;
    composePickingEnd = false;
    composeTimecode = 0;
    composeTimecodeEnd = null;
    viewingCommentId = null;

    document.getElementById('detailTitle').textContent = detail.title;
    document.getElementById('detailSub').textContent =
      `${detail.clientName}${detail.category ? ` · ${detail.category}` : ''} · ${STATUS_LABELS[detail.status] || detail.status}`;
    fillDetailFolderSelect();
    fillDetailAccessList();
    const renameBtn = document.getElementById('renameProjectBtn');
    if (renameBtn) renameBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('deleteProjectBtn').style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('masterUrlInput').value = detail.masterFileUrl || '';
    updateOpenMasterBtn();
    const allowDl = document.getElementById('allowDownloadCheck');
    if (allowDl) allowDl.checked = detail.allowClientDownload !== false;
    document.getElementById('deliverStatus').innerHTML = detail.status === 'delivered'
      ? `<span class="delivered">Delivered ${fmtDate(detail.deliveredAt)}</span>${detail.deliveredByName ? ` by ${escapeHtml(detail.deliveredByName)}` : ''}`
      : 'Not delivered yet — attach the master link and mark delivered when the client approves.';
    document.getElementById('deliverBtn').textContent = detail.status === 'delivered' ? 'Update Link' : 'Mark Delivered';

    compareMode = false;
    compareVersionId = null;
    updateCompareUi();
    pendingMentions = [];
    annotateTool = 'off';
    loadTeamUsers();

    const dueInput = document.getElementById('feedbackDueInput');
    if (dueInput) {
      dueInput.value = detail.feedbackDueAt
        ? new Date(detail.feedbackDueAt).toISOString().slice(0, 10)
        : '';
    }
    renderReviewDecision();
    renderActivity();
    renderThumbPreview();

    renderVersionBar();
    renderPlayer();
    renderComments();
    setSideTab('comments');
    resetCompose();
    showDetailView();
    pollProcessingVersions();
  }

  function toDirectDownloadUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (!/(^|\.)drive\.google\.com$/i.test(u.hostname)) return url;
      const fromPath = u.pathname.match(/\/file\/d\/([^/]+)/);
      const id = fromPath?.[1] || u.searchParams.get('id');
      if (!id) return url;
      // confirm=t skips Drive's "virus scan" interstitial for many large files
      return `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(id)}`;
    } catch {
      return url;
    }
  }

  function updateOpenMasterBtn() {
    const btn = document.getElementById('openMasterBtn');
    const input = document.getElementById('masterUrlInput');
    if (!btn || !input) return;
    const url = (input.value || detail?.masterFileUrl || '').trim();
    btn.style.display = url ? 'inline-flex' : 'none';
  }

  function showDetailView() {
    closeClientsViewQuiet();
    document.getElementById('vpHeader').style.display = 'none';
    document.getElementById('vpToolbar').style.display = 'none';
    document.getElementById('vpContainer').style.display = 'none';
    document.getElementById('vpClientsView').style.display = 'none';
    const clientEditView = document.getElementById('vpClientEditView');
    if (clientEditView) clientEditView.style.display = 'none';
    document.getElementById('vpDetailView').style.display = 'flex';
    document.querySelector('.vp-main').scrollTop = 0;
  }

  function teardownDetail() {
    clearInterval(statusPollTimer);
    if (annotate) { annotate.destroy(); annotate = null; }
    stopAnnotationWatch();
    const playerWrap = document.getElementById('playerWrap');
    const compareWrap = document.getElementById('comparePlayerWrap');
    if (playerWrap) playerWrap.innerHTML = '';
    if (compareWrap) compareWrap.innerHTML = '';
    player = null;
    comparePlayer = null;
    detail = null;
    compareMode = false;
    viewingCommentId = null;
    const detailView = document.getElementById('vpDetailView');
    if (detailView) detailView.style.display = 'none';
  }

  function closeDetailView() {
    teardownDetail();
    document.getElementById('vpHeader').style.display = '';
    document.getElementById('vpToolbar').style.display = '';
    document.getElementById('vpContainer').style.display = '';
    closeClientsViewQuiet();
    // Stay on Video Portal list — never history.back() (that leaves to the previous sidebar page)
    syncProjectInUrl(null);
    renderGrid();
  }

  function updateCompareUi() {
    const btn = document.getElementById('compareToggleBtn');
    const pane = document.getElementById('comparePane');
    const stack = document.getElementById('playerStack');
    const versions = detail?.versions || [];
    if (btn) btn.style.display = versions.length >= 2 ? 'inline-flex' : 'none';
    if (pane) pane.style.display = compareMode ? 'block' : 'none';
    if (stack) stack.classList.toggle('compare-on', compareMode);
    if (btn) {
      btn.classList.toggle('active', compareMode);
      btn.querySelector('span:last-child').textContent = compareMode ? 'Exit compare' : 'Compare';
    }
    if (compareMode) renderComparePlayer();
  }

  function renderComparePlayer() {
    const sel = document.getElementById('compareVersionSelect');
    const wrap = document.getElementById('comparePlayerWrap');
    if (!sel || !wrap || !detail) return;
    const versions = [...(detail.versions || [])].reverse();
    if (!compareVersionId) {
      compareVersionId = versions.find(v => v._id !== currentVersionId)?._id || versions[0]?._id || null;
    }
    sel.innerHTML = versions.map(v =>
      `<option value="${v._id}">v${v.versionNumber} — ${fmtDate(v.uploadedAt)}</option>`).join('');
    if (compareVersionId) sel.value = compareVersionId;
    const v = versions.find(x => x._id === compareVersionId) || versions.find(x => x._id === sel.value);
    comparePlayer = null;
    if (!v?.embedUrl) {
      wrap.innerHTML = '<div class="vp-player-placeholder">Version not ready</div>';
      return;
    }
    wrap.innerHTML = `<iframe src="${escapeHtml(v.embedUrl)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen id="vpCompareFrame"></iframe>`;
    ensurePlayerJs().then(ok => {
      if (!ok || !window.playerjs) return;
      try { comparePlayer = new window.playerjs.Player(document.getElementById('vpCompareFrame')); }
      catch { comparePlayer = null; }
    });
  }

  function renderThumbPreview() {
    const preview = document.getElementById('thumbPreview');
    const clearBtn = document.getElementById('thumbClearBtn');
    if (!preview) return;
    const url = detail?.thumbnailUrl || detail?.customThumbnailUrl || '';
    if (url) {
      preview.innerHTML = `<img src="${escapeHtml(url)}" alt="Thumbnail">`;
      if (clearBtn) clearBtn.style.display = detail?.customThumbnailUrl ? 'inline-flex' : 'none';
    } else {
      preview.innerHTML = '<span class="material-symbols-outlined">image</span>';
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }

  function renderReviewDecision() {
    const el = document.getElementById('reviewDecisionStatus');
    if (!el || !detail) return;
    const d = detail.reviewDecision || { status: 'none' };
    const status = d.status || 'none';
    el.className = `vp-review-status ${status}`;
    if (status === 'approved') {
      el.textContent = `Approved by ${d.decidedByName || 'client'}${d.versionNumber ? ` (v${d.versionNumber})` : ''} · ${fmtDate(d.decidedAt)}`;
    } else if (detail.feedbackDueAt) {
      el.textContent = `Awaiting client approval · feedback due ${fmtDate(detail.feedbackDueAt)}`;
    } else {
      el.textContent = 'Awaiting client approval';
    }
  }

  function renderActivity() {
    const list = document.getElementById('activityList');
    if (!list) return;
    const items = detail?.activity || [];
    if (items.length === 0) {
      list.innerHTML = '<div class="vp-empty" style="padding:16px 8px;">No activity yet.</div>';
      return;
    }
    list.innerHTML = items.map(a => `
      <div class="vp-activity-item">
        <div class="vp-activity-top">
          <span class="vp-activity-actor">${escapeHtml(a.actorName || a.actorType || 'Someone')}</span>
          <span>${fmtDate(a.createdAt)}</span>
        </div>
        <div class="vp-activity-msg">${escapeHtml(a.message || a.type)}</div>
      </div>`).join('');
  }

  function setSideTab(tab) {
    const isComments = tab !== 'activity';
    document.querySelectorAll('.vp-side-tab').forEach(btn => {
      const on = btn.dataset.sideTab === (isComments ? 'comments' : 'activity');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const commentsPanel = document.getElementById('commentsSidePanel');
    const activityPanel = document.getElementById('activitySidePanel');
    const hideResolved = document.getElementById('hideResolvedWrap');
    if (commentsPanel) commentsPanel.hidden = !isComments;
    if (activityPanel) activityPanel.hidden = isComments;
    if (hideResolved) hideResolved.style.visibility = isComments ? '' : 'hidden';
    if (!isComments) renderActivity();
  }

  async function uploadThumbnail(file) {
    if (!detail || !file) return;
    const form = new FormData();
    form.append('thumbnail', file);
    try {
      const res = await fetch(`${API_BASE}/api/video-projects/${detail._id}/thumbnail`, {
        method: 'POST',
        headers: { Authorization: getToken() },
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Thumbnail upload failed');
      detail.customThumbnailUrl = data.customThumbnailUrl || data.thumbnailUrl || '';
      detail.thumbnailUrl = data.thumbnailUrl || detail.customThumbnailUrl;
      renderThumbPreview();
      await loadProjects();
      toast('Thumbnail updated');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function setThumbnailFromCurrentFrame() {
    if (!detail) return;
    const btn = document.getElementById('thumbFromFrameBtn');
    const v = currentVersion();
    if (!v || (v.videoStatus && v.videoStatus !== 'ready') || !v.embedUrl) {
      toast('No ready video to capture a frame from', 'error');
      return;
    }
    if (!player) {
      toast('Start the video first, pause on the frame you want, then try again', 'error');
      return;
    }

    const run = async (rawTime) => {
      const timeSeconds = playerTimeFromEvent(rawTime);
      if (timeSeconds == null || Number.isNaN(Number(timeSeconds))) {
        toast('Could not read the current time from the player', 'error');
        return;
      }
      if (btn) btn.disabled = true;
      try {
        try { player.pause(); } catch { /* noop */ }
        const data = await api(`/api/video-projects/${detail._id}/thumbnail-from-frame`, {
          method: 'POST',
          body: JSON.stringify({
            versionId: currentVersionId,
            timeSeconds: Math.max(0, Number(timeSeconds) || 0)
          })
        });
        detail.customThumbnailUrl = data.customThumbnailUrl || data.thumbnailUrl || '';
        detail.thumbnailUrl = data.thumbnailUrl || detail.customThumbnailUrl;
        renderThumbPreview();
        await loadProjects();
        toast(`Thumbnail set at ${fmtTimecode(data.capturedAtSeconds ?? timeSeconds)}`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    try {
      player.getCurrentTime((t) => { run(t); });
    } catch {
      toast('Could not read the current time from the player', 'error');
    }
  }

  async function clearThumbnail() {
    if (!detail) return;
    try {
      const data = await api(`/api/video-projects/${detail._id}/thumbnail`, { method: 'DELETE' });
      detail.customThumbnailUrl = '';
      detail.thumbnailUrl = data.thumbnailUrl || null;
      renderThumbPreview();
      await loadProjects();
      toast('Custom thumbnail removed');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function currentVersion() {
    return (detail?.versions || []).find(v => v._id === currentVersionId) || null;
  }

  function renderVersionBar() {
    const sel = document.getElementById('versionSelect');
    const versions = [...(detail.versions || [])].reverse();
    sel.innerHTML = versions.length
      ? versions.map(v => `<option value="${v._id}">v${v.versionNumber} — ${fmtDate(v.uploadedAt)}${v.uploadedByName ? ` (${escapeHtml(v.uploadedByName)})` : ''}</option>`).join('')
      : '<option value="">No versions</option>';
    if (currentVersionId) sel.value = currentVersionId;

    const v = currentVersion();
    const statusEl = document.getElementById('versionStatus');
    if (!v) statusEl.textContent = '';
    else if (v.videoStatus === 'ready') statusEl.textContent = v.durationSeconds ? `${fmtTimecode(v.durationSeconds)} · ready` : 'ready';
    else if (v.videoStatus === 'error') statusEl.textContent = 'processing failed';
    else if (v.videoStatus === 'uploading') statusEl.textContent = 'uploading to video host…';
    else statusEl.textContent = 'processing — playback will appear shortly';

    const menuWrap = document.getElementById('versionMenuWrap');
    if (menuWrap) menuWrap.style.display = (isAdmin && v) ? 'block' : 'none';
    closeVersionMenu();

    updateUploadUi();
  }

  function closeVersionMenu() {
    const dropdown = document.getElementById('versionMenuDropdown');
    const btn = document.getElementById('versionMenuBtn');
    if (dropdown) dropdown.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleVersionMenu() {
    const dropdown = document.getElementById('versionMenuDropdown');
    const btn = document.getElementById('versionMenuBtn');
    if (!dropdown || !btn) return;
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function deleteCurrentVersion() {
    if (!isAdmin || !detail || !currentVersionId) return;
    const v = currentVersion();
    if (!v) return;
    closeVersionMenu();
    const ok = await showVpConfirm({
      title: `Delete version ${v.versionNumber}?`,
      message: 'This cannot be undone. It will remove this cut from Bunny and delete every comment on this version.',
      confirmText: 'Delete version',
      danger: true,
      icon: 'delete'
    });
    if (!ok) return;
    try {
      const result = await api(`/api/video-projects/${detail._id}/versions/${currentVersionId}`, {
        method: 'DELETE'
      });
      detail.versions = result.versions || [];
      detail.comments = (detail.comments || []).filter(c => String(c.versionId) !== String(currentVersionId));
      if (compareVersionId && String(compareVersionId) === String(currentVersionId)) {
        compareMode = false;
        compareVersionId = null;
        updateCompareUi();
      }
      const remaining = detail.versions || [];
      currentVersionId = remaining.length ? remaining[remaining.length - 1]._id : null;
      toast(`Version ${v.versionNumber} deleted`);
      renderVersionBar();
      renderPlayer();
      renderComments();
      renderActivity();
      await loadProjects();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function updateUploadUi() {
    const versions = detail?.versions || [];
    const hasVersion = versions.length > 0;
    const nextNum = hasVersion
      ? Math.max(...versions.map(v => Number(v.versionNumber) || 0)) + 1
      : 1;
    const label = document.getElementById('uploadBoxLabel');
    const btnLabel = document.getElementById('uploadVersionBtnLabel');
    const hint = document.getElementById('uploadBoxHint');
    const notes = document.getElementById('versionNotes');
    if (label) {
      label.textContent = hasVersion ? `Upload new version (v${nextNum})` : 'Upload first version';
    }
    if (btnLabel) {
      btnLabel.textContent = hasVersion ? `Upload v${nextNum}` : 'Upload version';
    }
    if (hint) {
      hint.textContent = hasVersion
        ? `Adds a new cut as v${nextNum}. The current version stays in the version menu for compare.`
        : 'Upload the first review cut for this project.';
    }
    if (notes) {
      notes.placeholder = hasVersion
        ? `What changed in v${nextNum}? (goes in the client email)`
        : 'What should the client know about this cut? (goes in the client email)';
    }
  }

  function renderPlayer() {
    const wrap = document.getElementById('playerWrap');
    const v = currentVersion();
    player = null;
    if (annotate) { annotate.destroy(); annotate = null; }

    if (!v) {
      wrap.innerHTML = '<div class="vp-player-placeholder" id="playerPlaceholder">No video uploaded yet — upload the first cut below.</div>';
      cachedPlayerDuration = 0;
      renderCommentMarkers();
      return;
    }
    if (!v.embedUrl) {
      wrap.innerHTML = `<div class="vp-player-placeholder" id="playerPlaceholder">${
        v.videoStatus === 'error' ? 'This version failed to process. Try re-uploading.'
        : v.videoStatus === 'uploading' ? 'Uploading to video host…'
        : 'Processing video… this usually takes a minute.'
      }</div>`;
      cachedPlayerDuration = 0;
      renderCommentMarkers();
      return;
    }

    wrap.innerHTML = `<iframe src="${escapeHtml(v.embedUrl)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen id="vpPlayerFrame"></iframe>`;
    playerListenersBound = false;
    viewingCommentId = null;
    cachedPlayerDuration = Number(v.durationSeconds) || 0;
    ensurePlayerJs().then(ok => {
      if (!ok || !window.playerjs) return;
      try {
        player = new window.playerjs.Player(document.getElementById('vpPlayerFrame'));
        bindPlayerAnnotationListeners(player);
      } catch { player = null; }
    });
    ensureAnnotateLib().then(ok => {
      if (!ok || !window.PortalAnnotate) return;
      annotate = window.PortalAnnotate.createOverlay(wrap);
      setAnnotateTool(annotateTool === 'view' ? 'off' : annotateTool);
    });
    updateCompareUi();
    renderCommentMarkers();
  }

  function bindPlayerAnnotationListeners(p) {
    if (!p || playerListenersBound) return;
    playerListenersBound = true;
    try {
      const refreshDuration = () => {
        try {
          p.getDuration((d) => {
            const n = Number(d) || 0;
            if (n > 0) {
              cachedPlayerDuration = n;
              renderCommentMarkers();
            }
          });
        } catch { /* noop */ }
      };
      p.on('ready', () => {
        refreshDuration();
        if (composeTimecodeAttached) captureComposeTimecode();
      });
      refreshDuration();
      if (composeTimecodeAttached) captureComposeTimecode();
      p.on('play', () => {
        // Point annotations clear on play; range annotations stay until watch loop clears them
        if (!viewingCommentId || !detail) return;
        const c = detail.comments.find(x => x._id === viewingCommentId);
        if (!c || c.timecodeSeconds == null) {
          clearAnnotationView();
          return;
        }
        const hasRange = c.timecodeEndSeconds != null && c.timecodeEndSeconds > c.timecodeSeconds;
        if (!hasRange) clearAnnotationView();
        else startAnnotationWatch();
      });
      p.on('timeupdate', (data) => {
        const t = playerTimeFromEvent(data);
        syncComposeTimecodeFromPlayhead(t);
        syncAnnotationVisibility(t);
      });
    } catch { /* player.js may not support all events on every embed */ }
  }

  function syncComposeTimecodeFromPlayhead(t) {
    if (!composeTimecodeAttached) return;
    if (t == null || Number.isNaN(Number(t))) return;
    const next = Math.floor(Number(t) || 0);

    if (composePickingEnd && composeTimecode != null) {
      if (next > composeTimecode) {
        if (composeTimecodeEnd === next) return;
        composeTimecodeEnd = next;
        updateComposeTcLabel();
      }
      return;
    }

    // Point mode: follow playhead. Range mode (end locked): leave start alone.
    if (composeTimecodeEnd != null) return;
    if (composeTimecode === next) return;
    composeTimecode = next;
    updateComposeTcLabel();
  }

  function captureComposeTimecode(cb) {
    composeTimecodeAttached = true;
    if (!player) {
      if (composeTimecode == null) composeTimecode = 0;
      updateComposeTcLabel();
      cb?.();
      return;
    }
    try {
      player.getCurrentTime((t) => {
        if (!composeTimecodeAttached) return;
        if (!composePickingEnd && composeTimecodeEnd == null) {
          composeTimecode = Math.floor(Number(t) || 0);
        } else if (composePickingEnd && composeTimecode != null) {
          const next = Math.floor(Number(t) || 0);
          if (next > composeTimecode) composeTimecodeEnd = next;
        }
        updateComposeTcLabel();
        cb?.();
      });
    } catch {
      if (composeTimecode == null) composeTimecode = 0;
      updateComposeTcLabel();
      cb?.();
    }
  }

  function clearComposeTimecode() {
    composeTimecodeAttached = false;
    composePickingEnd = false;
    composeTimecode = null;
    composeTimecodeEnd = null;
    updateComposeTcLabel();
  }

  function clearComposeEnd() {
    composePickingEnd = false;
    composeTimecodeEnd = null;
    updateComposeTcLabel();
    captureComposeTimecode();
  }

  function beginComposeEndPick() {
    if (!composeTimecodeAttached || composeTimecode == null) return;
    if (!player) {
      toast('Play the video first to set an end time', 'error');
      return;
    }
    // Freeze the current timestamp as the range start, then scrub to set the end
    composePickingEnd = true;
    composeTimecodeEnd = null;
    try {
      player.getCurrentTime((t) => {
        composeTimecode = Math.floor(Number(t) || 0);
        updateComposeTcLabel();
      });
    } catch {
      updateComposeTcLabel();
    }
  }

  function playerTimeFromEvent(data) {
    if (data == null) return null;
    if (typeof data === 'number') return data;
    if (typeof data === 'object' && data.seconds != null) return Number(data.seconds);
    return Number(data);
  }

  function syncAnnotationVisibility(time) {
    if (!viewingCommentId) return;
    const comments = detail?.comments || [];
    const c = comments.find(x => x._id === viewingCommentId);
    if (!c || c.timecodeSeconds == null) {
      clearAnnotationView();
      return;
    }
    if (time == null || Number.isNaN(Number(time))) return;
    const t = Number(time);
    const start = Number(c.timecodeSeconds);
    const hasRange = c.timecodeEndSeconds != null && c.timecodeEndSeconds > start;
    if (hasRange) {
      if (t < start - 0.25 || t > Number(c.timecodeEndSeconds) + 0.05) clearAnnotationView();
    } else if (Math.abs(t - start) > 0.45) {
      clearAnnotationView();
    }
  }

  function startAnnotationWatch() {
    stopAnnotationWatch();
    if (!viewingCommentId || !player) return;
    annotationWatchTimer = setInterval(() => {
      if (!viewingCommentId || !player) {
        stopAnnotationWatch();
        return;
      }
      try {
        player.getCurrentTime((t) => syncAnnotationVisibility(t));
      } catch {
        stopAnnotationWatch();
      }
    }, 200);
  }

  function stopAnnotationWatch() {
    if (annotationWatchTimer) {
      clearInterval(annotationWatchTimer);
      annotationWatchTimer = null;
    }
  }

  function setAnnotateTool(tool) {
    if (tool === 'pen' || tool === 'arrow') clearAnnotationView();
    annotateTool = tool;
    const pen = document.getElementById('annotatePenBtn');
    const arrow = document.getElementById('annotateArrowBtn');
    const hint = document.getElementById('annotateHint');
    if (pen) pen.classList.toggle('active', tool === 'pen');
    if (arrow) arrow.classList.toggle('active', tool === 'arrow');
    if (annotate) annotate.setMode(tool === 'pen' || tool === 'arrow' ? tool : 'off');
    if (hint) {
      hint.textContent = tool === 'pen' || tool === 'arrow'
        ? 'Drawing — attaches to your next comment'
        : '';
    }
    if ((tool === 'pen' || tool === 'arrow') && player) {
      try {
        player.pause();
        if (!composeTimecodeAttached || composeTimecode == null) {
          composeTimecodeEnd = null;
          captureComposeTimecode();
        }
      } catch { /* noop */ }
    }
  }

  function clearAnnotationView(opts = {}) {
    stopAnnotationWatch();
    if (!opts.keepSelection) viewingCommentId = null;
    if (annotateTool === 'view') annotateTool = 'off';
    if (annotate) {
      annotate.clear();
      annotate.setMode(annotateTool === 'pen' || annotateTool === 'arrow' ? annotateTool : 'off');
    }
    const pen = document.getElementById('annotatePenBtn');
    const arrow = document.getElementById('annotateArrowBtn');
    if (pen) pen.classList.toggle('active', annotateTool === 'pen');
    if (arrow) arrow.classList.toggle('active', annotateTool === 'arrow');
    updateActiveCommentHighlight();
  }

  function updateActiveCommentHighlight() {
    document.querySelectorAll('#commentsList .vp-comment').forEach(el => {
      el.classList.toggle('is-active', !!viewingCommentId && el.dataset.id === viewingCommentId);
    });
    document.querySelectorAll('#commentMarkerRail .vp-marker').forEach(el => {
      el.classList.toggle('is-active', !!viewingCommentId && el.dataset.id === viewingCommentId);
    });
  }

  function renderCommentMarkers() {
    const rail = document.getElementById('commentMarkerRail');
    if (!rail) return;

    const duration = versionDurationSeconds();
    const items = commentsForCurrentVersion().filter(hasSeekTimecode);

    if (!duration || items.length === 0) {
      rail.hidden = true;
      rail.innerHTML = '';
      return;
    }

    rail.hidden = false;
    const rangesHtml = items.map(c => {
      const start = Number(c.timecodeSeconds);
      const end = c.timecodeEndSeconds != null && c.timecodeEndSeconds > start
        ? Number(c.timecodeEndSeconds)
        : null;
      if (end == null) return '';
      const left = Math.min(100, Math.max(0, (start / duration) * 100));
      const width = Math.min(100 - left, Math.max(0.4, ((end - start) / duration) * 100));
      return `<div class="vp-marker-range-bar ${c.resolved ? 'resolved' : ''}" style="left:${left}%;width:${width}%;"></div>`;
    }).join('');

    const markersHtml = items.map(c => {
      const start = Number(c.timecodeSeconds);
      const left = Math.min(100, Math.max(0, (start / duration) * 100));
      const active = viewingCommentId && viewingCommentId === c._id;
      const tip = `${c.authorName || 'Comment'} · ${fmtCommentTimecode(c)}${c.text ? ` — ${String(c.text).slice(0, 80)}` : ''}`;
      return `<button type="button" class="vp-marker ${c.authorType || ''} ${c.resolved ? 'resolved' : ''}${active ? ' is-active' : ''}" data-id="${c._id}" style="left:${left}%;" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}">${escapeHtml(authorInitials(c.authorName))}</button>`;
    }).join('');

    rail.innerHTML = `<div class="vp-marker-track">${rangesHtml}${markersHtml}</div>`;

    rail.querySelectorAll('.vp-marker').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = detail?.comments?.find(x => x._id === btn.dataset.id);
        if (!c) return;
        jumpToComment(c);
        document.querySelector(`#commentsList .vp-comment[data-id="${c._id}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
  }

  function showCommentAnnotation(comment) {
    if (!annotate || !window.PortalAnnotate?.hasAnnotation(comment?.annotation)) {
      clearAnnotationView({ keepSelection: true });
      return;
    }
    viewingCommentId = comment._id;
    annotate.setData(comment.annotation);
    annotate.setMode('view');
    annotateTool = 'view';
    const pen = document.getElementById('annotatePenBtn');
    const arrow = document.getElementById('annotateArrowBtn');
    if (pen) pen.classList.remove('active');
    if (arrow) arrow.classList.remove('active');
    startAnnotationWatch();
    updateActiveCommentHighlight();
  }

  /** Seek to a comment's start and pause so drawings/range context are visible */
  function jumpToComment(comment) {
    if (!player || comment?.timecodeSeconds == null) {
      toast('Player not ready yet — try again in a moment.', 'error');
      return;
    }
    const start = Number(comment.timecodeSeconds);
    try {
      player.setCurrentTime(start);
      player.pause();
    } catch {
      toast('Could not seek the player', 'error');
      return;
    }
    viewingCommentId = comment._id;
    updateActiveCommentHighlight();
    if (window.PortalAnnotate?.hasAnnotation(comment.annotation)) {
      // Brief delay so the paused frame is on-screen before drawing
      setTimeout(() => showCommentAnnotation(comment), 120);
    } else {
      clearAnnotationView({ keepSelection: true });
    }
  }

  function seekTo(seconds) {
    if (player) {
      try {
        player.setCurrentTime(Number(seconds));
        player.pause();
        return;
      } catch { /* fall through */ }
    }
    toast('Player not ready yet — try again in a moment.', 'error');
  }

  function pollProcessingVersions() {
    clearInterval(statusPollTimer);
    const processing = (detail?.versions || []).filter(v =>
      v.videoStatus === 'processing' || v.videoStatus === 'uploading'
    );
    if (processing.length === 0) return;

    const projectId = detail._id;
    statusPollTimer = setInterval(async () => {
      if (!detail || detail._id !== projectId || document.getElementById('vpDetailView').style.display === 'none') {
        clearInterval(statusPollTimer);
        return;
      }
      for (const v of processing) {
        try {
          const updated = await api(`/api/video-projects/${projectId}/versions/${v.versionId || v._id}/status`);
          if (updated.videoStatus !== 'processing' && updated.videoStatus !== 'uploading') {
            clearInterval(statusPollTimer);
            const refreshed = await api(`/api/video-projects/${projectId}`);
            detail = refreshed;
            if (!currentVersion()) currentVersionId = updated._id;
            renderVersionBar();
            renderPlayer();
            return;
          }
        } catch { /* keep polling */ }
      }
    }, 6000);
  }

  // ---- Comments ----
  function commentsForCurrentVersion() {
    let items = (detail?.comments || []).filter(c => c.versionId === currentVersionId);
    if (hideResolved) items = items.filter(c => !c.resolved);
    items = [...items].sort((a, b) => {
      const ta = a.timecodeSeconds == null ? Number.MAX_SAFE_INTEGER : a.timecodeSeconds;
      const tb = b.timecodeSeconds == null ? Number.MAX_SAFE_INTEGER : b.timecodeSeconds;
      if (ta !== tb) return ta - tb;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    return items;
  }

  function renderComments() {
    const list = document.getElementById('commentsList');
    const items = commentsForCurrentVersion();
    renderCommentMarkers();

    if (items.length === 0) {
      list.innerHTML = '<div class="vp-empty" style="padding:30px 10px;">No comments on this version.</div>';
      return;
    }

    list.innerHTML = items.map(c => {
      const hasTc = c.timecodeSeconds != null;
      const active = viewingCommentId && viewingCommentId === c._id;
      return `
      <div class="vp-comment ${c.resolved ? 'resolved' : ''}${hasTc ? ' has-tc' : ''}${active ? ' is-active' : ''}" data-id="${c._id}"${hasTc ? ' data-seek="1"' : ''}>
        <button type="button" class="vp-comment-icon-btn vp-comment-resolve${c.resolved ? ' is-resolved' : ''}" data-resolve="${c._id}" data-resolved="${c.resolved ? '1' : ''}" title="${c.resolved ? 'Reopen' : 'Resolve'}" aria-label="${c.resolved ? 'Reopen' : 'Resolve'}">&#10003;</button>
        <div class="vp-comment-head">
          <span class="vp-comment-author ${c.authorType}">${escapeHtml(c.authorName)}</span>
          ${window.PortalAnnotate?.hasAnnotation(c.annotation) ? '<span class="vp-annotation-tag">Drawing</span>' : ''}
          <span class="vp-comment-date">${fmtDate(c.createdAt)}</span>
        </div>
        <div class="vp-comment-body">
          ${hasTc ? `<span class="vp-comment-tc">${fmtCommentTimecode(c)}</span>` : ''}
          <span class="vp-comment-text">${escapeHtml(c.text)}</span>
        </div>
        ${(c.mentions || []).length ? `<div class="vp-mention-chip">${(c.mentions || []).map(m => `@${escapeHtml(m.name)}`).join(' ')}</div>` : ''}
        ${(c.replies || []).map(r => `
          <div class="vp-reply">
            <div class="vp-comment-head">
              <span class="vp-comment-author ${r.authorType}">${escapeHtml(r.authorName)}</span>
              <span class="vp-comment-date">${fmtDate(r.createdAt)}</span>
            </div>
            <div class="vp-comment-text">${escapeHtml(r.text)}</div>
          </div>`).join('')}
        <div class="vp-comment-actions">
          <button type="button" class="vp-comment-icon-btn" data-reply="${c._id}" title="Reply" aria-label="Reply">&#8617;</button>
        </div>
        <form class="vp-reply-form" data-comment="${c._id}" style="display:none;">
          <input type="text" placeholder="Write a reply…" required>
          <button type="submit" class="vp-btn secondary small">Send</button>
        </form>
      </div>`;
    }).join('');

    list.querySelectorAll('.vp-comment[data-seek]').forEach(card => {
      card.addEventListener('click', () => {
        const c = detail.comments.find(x => x._id === card.dataset.id);
        if (c) jumpToComment(c);
      });
    });

    const stop = (el) => {
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('mousedown', (e) => e.stopPropagation());
    };
    list.querySelectorAll('.vp-comment-actions, .vp-comment-resolve, .vp-reply-form, .vp-reply').forEach(stop);

    list.querySelectorAll('[data-reply]').forEach(btn =>
      btn.addEventListener('click', () => {
        const form = list.querySelector(`.vp-reply-form[data-comment="${btn.dataset.reply}"]`);
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
        if (form.style.display === 'flex') form.querySelector('input').focus();
      }));

    list.querySelectorAll('[data-resolve]').forEach(btn =>
      btn.addEventListener('click', async () => {
        try {
          const updated = await api(`/api/video-comments/${btn.dataset.resolve}/resolve`, {
            method: 'PUT',
            body: JSON.stringify({ resolved: !btn.dataset.resolved })
          });
          const idx = detail.comments.findIndex(c => c._id === updated._id);
          if (idx >= 0) detail.comments[idx] = updated;
          renderComments();
        } catch (err) { toast(err.message, 'error'); }
      }));

    list.querySelectorAll('.vp-reply-form').forEach(form =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input');
        try {
          const updated = await api(`/api/video-comments/${form.dataset.comment}/replies`, {
            method: 'POST',
            body: JSON.stringify({ text: input.value.trim() })
          });
          const idx = detail.comments.findIndex(c => c._id === updated._id);
          if (idx >= 0) detail.comments[idx] = updated;
          renderComments();
        } catch (err) { toast(err.message, 'error'); }
      }));
  }

  function resetCompose() {
    composeTimecodeEnd = null;
    composePickingEnd = false;
    composeTimecodeAttached = true;
    pendingMentions = [];
    mentionQueryStart = -1;
    const textEl = document.getElementById('commentText');
    if (textEl) textEl.value = '';
    hideMentionMenu();
    captureComposeTimecode();
    if (annotate && annotateTool !== 'view') {
      annotate.clear();
      setAnnotateTool('off');
    }
  }

  function hideMentionMenu() {
    const menu = document.getElementById('mentionMenu');
    if (menu) menu.style.display = 'none';
  }

  function showMentionMenu(query) {
    const menu = document.getElementById('mentionMenu');
    if (!menu) return;
    const q = (query || '').toLowerCase();
    const matches = teamUsers
      .filter(u => !pendingMentions.some(m => m.userId === u._id))
      .filter(u => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { menu.style.display = 'none'; return; }
    menu.innerHTML = matches.map(u =>
      `<button type="button" class="vp-mention-item" data-id="${u._id}" data-name="${escapeHtml(u.name || u.email)}">${escapeHtml(u.name || u.email)}</button>`
    ).join('');
    menu.style.display = 'block';
    menu.querySelectorAll('.vp-mention-item').forEach(btn => {
      btn.addEventListener('click', () => insertMention(btn.dataset.id, btn.dataset.name));
    });
  }

  function insertMention(userId, name) {
    const ta = document.getElementById('commentText');
    if (!ta || mentionQueryStart < 0) return;
    const before = ta.value.slice(0, mentionQueryStart);
    const afterCursor = ta.value.slice(ta.selectionStart);
    const insert = `@${name} `;
    ta.value = before + insert + afterCursor;
    const caret = (before + insert).length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    if (!pendingMentions.some(m => m.userId === userId)) {
      pendingMentions.push({ userId, name });
    }
    mentionQueryStart = -1;
    hideMentionMenu();
  }

  function onCommentInput() {
    const ta = document.getElementById('commentText');
    if (!ta) return;
    const val = ta.value;
    const caret = ta.selectionStart;
    const upto = val.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at < 0 || (at > 0 && !/\s/.test(upto[at - 1] || ' '))) {
      mentionQueryStart = -1;
      hideMentionMenu();
      return;
    }
    const query = upto.slice(at + 1);
    if (/\s/.test(query)) {
      mentionQueryStart = -1;
      hideMentionMenu();
      return;
    }
    mentionQueryStart = at;
    showMentionMenu(query);
  }

  function updateComposeTcLabel() {
    const btn = document.getElementById('commentAtTimeBtn');
    const endBtn = document.getElementById('commentEndTimeBtn');
    const label = document.getElementById('commentTcLabel');
    const endLabel = document.getElementById('commentEndLabel');
    if (!btn || !label) return;
    if (composeTimecodeAttached && composeTimecode != null) {
      if (composeTimecodeEnd != null && composeTimecodeEnd > composeTimecode) {
        label.textContent = `${fmtTimecode(composeTimecode)}–${fmtTimecode(composeTimecodeEnd)}`;
      } else if (composePickingEnd) {
        label.textContent = `${fmtTimecode(composeTimecode)}–…`;
      } else {
        label.textContent = fmtTimecode(composeTimecode);
      }
      btn.classList.add('active');
      btn.title = 'Remove timestamp from this comment';
      if (endBtn) endBtn.style.display = 'inline-flex';
    } else {
      label.textContent = 'No time';
      btn.classList.remove('active');
      btn.title = 'Attach current playhead time';
      composePickingEnd = false;
      composeTimecodeEnd = null;
      if (endBtn) endBtn.style.display = 'none';
    }
    if (endBtn && endLabel) {
      const hasEnd = composePickingEnd || (composeTimecodeEnd != null && composeTimecode != null && composeTimecodeEnd > composeTimecode);
      endBtn.classList.toggle('active', hasEnd);
      endLabel.textContent = hasEnd ? 'Clear end' : 'Add end time';
      endBtn.title = hasEnd
        ? 'Remove end time and go back to a single timestamp'
        : 'Lock this time as the start, then scrub to set the end';
    }
  }

  // ---- Upload ----
  // Bunny TUS: finite chunks so onProgress fires during upload (Infinity = one request → 0% then 100%).
  const TUS_CHUNK_SIZE = 16 * 1024 * 1024;

  function setUploadProgress(pct, label) {
    const wrap = document.getElementById('uploadProgress');
    if (!wrap) return;
    wrap.style.display = 'block';
    const indeterminate = pct < 0;
    const clamped = indeterminate ? 0 : Math.max(0, Math.min(100, Math.round(pct)));
    const text = label || (indeterminate ? 'Working…' : `Uploading… ${clamped}%`);

    let labelEl = wrap.querySelector('.vp-progress-label');
    let track = wrap.querySelector('.vp-progress-track');
    let fill = wrap.querySelector('.vp-progress-fill');
    if (!labelEl || !track || !fill) {
      wrap.innerHTML = `
        <div class="vp-progress-label"></div>
        <div class="vp-progress-track">
          <div class="vp-progress-fill" style="width:0%"></div>
        </div>`;
      labelEl = wrap.querySelector('.vp-progress-label');
      track = wrap.querySelector('.vp-progress-track');
      fill = wrap.querySelector('.vp-progress-fill');
    }

    labelEl.textContent = text;
    track.classList.toggle('indeterminate', indeterminate);
    fill.style.width = indeterminate ? '40%' : `${clamped}%`;
  }

  function ensureTusClient() {
    return new Promise((resolve, reject) => {
      if (window.tus?.Upload) return resolve(window.tus);
      const existing = document.querySelector('script[data-tus-client]');
      if (existing) {
        existing.addEventListener('load', () => {
          if (window.tus?.Upload) resolve(window.tus);
          else reject(new Error('Upload library failed to initialize'));
        });
        existing.addEventListener('error', () => reject(new Error('Failed to load upload library')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js';
      script.async = true;
      script.dataset.tusClient = '1';
      script.onload = () => {
        if (window.tus?.Upload) resolve(window.tus);
        else reject(new Error('Upload library failed to initialize'));
      };
      script.onerror = () => reject(new Error('Failed to load upload library'));
      document.head.appendChild(script);
    });
  }

  async function tusUploadToBunny(file, tus) {
    if (!tus?.endpoint || !tus.signature || !tus.videoId || !tus.libraryId) {
      throw new Error('Upload credentials were incomplete');
    }
    const tusLib = await ensureTusClient();
    const fileSize = file.size || 0;
    setUploadProgress(0, 'Uploading to video host… 0%');

    const reportProgress = (bytesUploaded, bytesTotal) => {
      const total = bytesTotal > 0 ? bytesTotal : fileSize;
      if (!(total > 0)) {
        setUploadProgress(-1, 'Uploading to video host…');
        return;
      }
      const pct = Math.min(99, Math.round((bytesUploaded / total) * 100));
      setUploadProgress(pct, `Uploading to video host… ${pct}%`);
    };

    await new Promise((resolve, reject) => {
      const upload = new tusLib.Upload(file, {
        endpoint: tus.endpoint,
        chunkSize: TUS_CHUNK_SIZE,
        retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
        headers: {
          AuthorizationSignature: tus.AuthorizationSignature || tus.signature,
          AuthorizationExpire: String(tus.AuthorizationExpire || tus.expirationTime),
          VideoId: tus.VideoId || tus.videoId,
          LibraryId: String(tus.LibraryId || tus.libraryId)
        },
        metadata: {
          filename: file.name,
          filetype: file.type || 'video/mp4',
          title: file.name
        },
        onError: (err) => reject(err),
        onProgress: reportProgress,
        onChunkComplete: (chunkSize, bytesAccepted, bytesTotal) => {
          reportProgress(bytesAccepted, bytesTotal);
        },
        onSuccess: () => resolve()
      });

      upload.findPreviousUploads()
        .then((previous) => {
          if (previous?.length) upload.resumeFromPreviousUpload(previous[0]);
          upload.start();
        })
        .catch(() => upload.start());
    });
  }

  async function uploadVersion() {
    const fileInput = document.getElementById('versionFile');
    const file = fileInput.files[0];
    if (!file) { toast('Choose a video file first', 'error'); return; }
    if (!detail) return;

    const btn = document.getElementById('uploadVersionBtn');
    const notes = document.getElementById('versionNotes').value.trim();
    const notifyClient = !!document.getElementById('notifyClientCheck')?.checked;
    btn.disabled = true;
    setUploadProgress(-1, 'Preparing upload…');

    let versionId = null;
    try {
      const prepared = await api(`/api/video-projects/${detail._id}/versions/prepare`, {
        method: 'POST',
        body: JSON.stringify({ notes, notifyClient })
      });
      versionId = prepared.versionId;
      await tusUploadToBunny(file, prepared.tus || {});

      setUploadProgress(-1, 'Finishing upload…');
      await api(`/api/video-projects/${detail._id}/versions/${versionId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ notifyClient })
      });

      setUploadProgress(100, 'Upload complete — processing…');
      fileInput.value = '';
      document.getElementById('versionNotes').value = '';
      toast('Version uploaded');
      await openDetail(detail._id);
      await loadProjects();
    } catch (err) {
      const msg = err?.message || 'Upload failed';
      if (versionId) {
        try {
          await api(`/api/video-projects/${detail._id}/versions/${versionId}/fail`, {
            method: 'POST',
            body: JSON.stringify({})
          });
        } catch { /* best effort */ }
      }
      setUploadProgress(0, msg);
      toast(msg, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function pickReplaceVersionFile() {
    if (!isAdmin || !detail || !currentVersionId) return;
    closeVersionMenu();
    const input = document.getElementById('replaceVersionFile');
    if (!input) return;
    input.value = '';
    input.click();
  }

  async function replaceCurrentVersionFile(file) {
    if (!isAdmin || !detail || !currentVersionId || !file) return;
    const v = currentVersion();
    if (!v) return;

    const uploadBtn = document.getElementById('uploadVersionBtn');
    if (uploadBtn) uploadBtn.disabled = true;
    setUploadProgress(-1, `Preparing replace for v${v.versionNumber}…`);

    let started = false;
    try {
      const prepared = await api(
        `/api/video-projects/${detail._id}/versions/${currentVersionId}/replace/prepare`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      started = true;
      await tusUploadToBunny(file, prepared.tus || {});

      setUploadProgress(-1, 'Finishing replace…');
      await api(
        `/api/video-projects/${detail._id}/versions/${currentVersionId}/replace/complete`,
        { method: 'POST', body: JSON.stringify({}) }
      );

      setUploadProgress(100, 'Replace complete — processing…');
      toast(`Version ${v.versionNumber} file replaced`);
      await openDetail(detail._id);
      await loadProjects();
    } catch (err) {
      const msg = err?.message || 'Replace failed';
      if (started) {
        try {
          await api(
            `/api/video-projects/${detail._id}/versions/${currentVersionId}/replace/fail`,
            { method: 'POST', body: JSON.stringify({}) }
          );
        } catch { /* best effort */ }
      }
      setUploadProgress(0, msg);
      toast(msg, 'error');
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
      const input = document.getElementById('replaceVersionFile');
      if (input) input.value = '';
    }
  }

  // ---- Modals ----
  function showModal(id) { document.getElementById(id).style.display = 'flex'; }
  function hideModal(id) {
    document.getElementById(id).style.display = 'none';
  }

  function showVpConfirm({
    title = 'Confirm',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    danger = true,
    icon = 'warning'
  } = {}) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('vpConfirmModal');
      const titleEl = document.getElementById('vpConfirmTitle');
      const msgEl = document.getElementById('vpConfirmMessage');
      const okBtn = document.getElementById('vpConfirmOk');
      const cancelBtn = document.getElementById('vpConfirmCancel');
      const iconEl = document.getElementById('vpConfirmIcon');
      if (!overlay || !okBtn || !cancelBtn) {
        resolve(window.confirm([title, message].filter(Boolean).join('\n\n')));
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;
      okBtn.className = danger ? 'vp-btn danger' : 'vp-btn primary';
      if (iconEl) {
        iconEl.innerHTML = `<span class="material-symbols-outlined">${icon}</span>`;
        iconEl.style.display = icon ? 'flex' : 'none';
      }

      const finish = (value) => {
        overlay.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onOverlay = (e) => { if (e.target === overlay) finish(false); };
      const onKey = (e) => {
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter') finish(true);
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
      document.addEventListener('keydown', onKey);
      overlay.style.display = 'flex';
      okBtn.focus();
    });
  }

  // ---- Listeners ----
  function setupListeners() {
    document.getElementById('vpBackBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDetailView();
    });
    document.getElementById('vpClientsBackBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeClientsView();
    });
    document.getElementById('vpClientEditBackBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeClientEdit();
    });

    document.querySelectorAll('.vp-side-tab').forEach(btn => {
      btn.addEventListener('click', () => setSideTab(btn.dataset.sideTab));
    });

    // Keep in-page back/forward on the portal (project ↔ list) without leaving Video Portal
    if (window._vpPortalPopstate) {
      window.removeEventListener('popstate', window._vpPortalPopstate);
    }
    window._vpPortalPopstate = () => {
      if (window.currentPage && window.currentPage !== 'video-portal') return;
      const hashPage = (location.hash || '').replace(/^#/, '').split('?')[0];
      if (hashPage !== 'video-portal') return;

      const projectId = getHashProjectId();
      if (projectId) {
        if (!detail || String(detail._id) !== String(projectId)) openDetail(projectId);
        return;
      }
      const clientId = getHashClientId();
      if (clientId) {
        if (editingClientId !== String(clientId)) openClientEdit(clientId, { push: false });
        return;
      }
      if (isClientsViewInUrl()) {
        hideClientEditView();
        if (document.getElementById('vpClientsView')?.style.display === 'none') {
          // URL already has view=clients — show without pushing another history entry
          document.getElementById('vpHeader').style.display = 'none';
          document.getElementById('vpToolbar').style.display = 'none';
          document.getElementById('vpContainer').style.display = 'none';
          document.getElementById('vpDetailView').style.display = 'none';
          document.getElementById('vpClientsView').style.display = 'flex';
          renderClients();
        }
        return;
      }
      if (detail || document.getElementById('vpDetailView')?.style.display !== 'none'
          || document.getElementById('vpClientsView')?.style.display !== 'none'
          || document.getElementById('vpClientEditView')?.style.display !== 'none') {
        document.getElementById('vpDetailView').style.display = 'none';
        document.getElementById('vpClientsView').style.display = 'none';
        hideClientEditView();
        document.getElementById('vpHeader').style.display = '';
        document.getElementById('vpToolbar').style.display = '';
        document.getElementById('vpContainer').style.display = '';
        clearInterval(statusPollTimer);
        if (annotate) { annotate.destroy(); annotate = null; }
        stopAnnotationWatch();
        player = null;
        comparePlayer = null;
        detail = null;
        compareMode = false;
        viewingCommentId = null;
        renderGrid();
      }
    };
    window.addEventListener('popstate', window._vpPortalPopstate);

    document.getElementById('clientEditViewProjectsBtn')?.addEventListener('click', (e) => {
      const clientId = e.currentTarget.dataset.client;
      if (clientId) showClientProjects(clientId);
    });
    document.getElementById('clientEditArchiveBtn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.client) handleClientAction(btn);
    });
    document.getElementById('clientEditDeleteBtn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.client) handleClientAction(btn);
    });

    document.querySelectorAll('[data-close]').forEach(btn =>
      btn.addEventListener('click', () => hideModal(btn.dataset.close)));

    document.getElementById('vpAssignAllBtn')?.addEventListener('click', () => setAssignModalChecks(true));
    document.getElementById('vpAssignNoneBtn')?.addEventListener('click', () => setAssignModalChecks(false));
    document.getElementById('vpAssignSaveBtn')?.addEventListener('click', saveAssignVideosModal);

    document.getElementById('vpLinksModalBody')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-links-action]');
      if (!btn) return;
      const url = btn.dataset.url || '';
      if (btn.dataset.linksAction === 'copy') copyPortalShareUrl(url, btn.dataset.toast);
      if (btn.dataset.linksAction === 'open') openPortalShareUrl(url);
    });

    document.querySelectorAll('.vp-modal-overlay').forEach(overlay =>
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideModal(overlay.id);
      }));

    document.getElementById('vpSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderGrid();
    });

    document.querySelectorAll('.vp-status-tab').forEach(tab =>
      tab.addEventListener('click', () => {
        setStatusFilter(tab.dataset.status);
        renderGrid();
      }));

    setupClientSuggest();

    document.getElementById('manageClientsBtn').addEventListener('click', showClientsView);

    document.getElementById('newClientForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('newClientName');
      const name = input.value.trim();
      if (!name) return;
      try {
        await api('/api/portal-clients', { method: 'POST', body: JSON.stringify({ name }) });
        input.value = '';
        await loadClients();
        renderClients();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('newProjectBtn').addEventListener('click', () => {
      if (clients.filter(c => !c.archived).length === 0) {
        toast('Add a client first (Clients button)', 'error');
        return;
      }
      const clientId = document.getElementById('projClient')?.value;
      fillProjectAccessPicker(clientId);
      showModal('projectModal');
    });

    document.getElementById('newProjectForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const clientId = document.getElementById('projClient').value;
        const folderId = document.getElementById('projFolder').value || null;
        const client = clients.find(c => String(c._id) === String(clientId));
        const people = client ? activePeople(client) : [];
        const previewOnly = document.getElementById('projPreviewOnly')?.checked;
        let viewerIds = selectedAccessIds(document.getElementById('projAccessList'));
        if (people.length && !previewOnly && !viewerIds.length) {
          toast('Pick who can see this video, or choose Company preview only', 'error');
          return;
        }
        if (previewOnly) viewerIds = [];
        const project = await api('/api/video-projects', {
          method: 'POST',
          body: JSON.stringify({
            clientId,
            title: document.getElementById('projTitle').value.trim(),
            folderId,
            viewerIds
          })
        });
        document.getElementById('newProjectForm').reset();
        fillProjectFolderSelect('');
        fillProjectAccessPicker('');
        hideModal('projectModal');
        await loadProjects();
        openDetail(project._id);
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('projClient').addEventListener('change', (e) => {
      fillProjectFolderSelect(e.target.value);
      fillProjectAccessPicker(e.target.value);
    });

    document.getElementById('detailFolderSelect').addEventListener('change', async (e) => {
      if (!detail) return;
      const folderId = e.target.value || null;
      try {
        await api(`/api/video-projects/${detail._id}`, {
          method: 'PUT',
          body: JSON.stringify({ folderId })
        });
        await openDetail(detail._id);
        await loadProjects();
        toast('Folder updated');
      } catch (err) {
        toast(err.message, 'error');
        fillDetailFolderSelect();
      }
    });

    document.getElementById('versionSelect').addEventListener('change', (e) => {
      currentVersionId = e.target.value;
      composeTimecodeEnd = null;
      composePickingEnd = false;
      composeTimecodeAttached = true;
      composeTimecode = 0;
      updateComposeTcLabel();
      renderVersionBar();
      renderPlayer();
      renderComments();
    });

    document.getElementById('compareToggleBtn')?.addEventListener('click', () => {
      compareMode = !compareMode;
      updateCompareUi();
    });
    document.getElementById('compareVersionSelect')?.addEventListener('change', (e) => {
      compareVersionId = e.target.value;
      renderComparePlayer();
    });

    document.getElementById('annotatePenBtn')?.addEventListener('click', () => {
      setAnnotateTool(annotateTool === 'pen' ? 'off' : 'pen');
    });
    document.getElementById('annotateArrowBtn')?.addEventListener('click', () => {
      setAnnotateTool(annotateTool === 'arrow' ? 'off' : 'arrow');
    });
    document.getElementById('annotateClearBtn')?.addEventListener('click', () => {
      if (annotate) annotate.clear();
      setAnnotateTool('off');
    });

    document.getElementById('hideResolvedCheck').addEventListener('change', (e) => {
      hideResolved = e.target.checked;
      renderComments();
    });

    document.getElementById('commentAtTimeBtn').addEventListener('click', () => {
      if (composeTimecodeAttached) {
        clearComposeTimecode();
        return;
      }
      if (!player) {
        toast('Play the video first to capture a timecode', 'error');
        return;
      }
      composeTimecodeEnd = null;
      composePickingEnd = false;
      captureComposeTimecode();
    });

    document.getElementById('commentEndTimeBtn')?.addEventListener('click', () => {
      if (!composeTimecodeAttached || composeTimecode == null) return;
      if (composePickingEnd || composeTimecodeEnd != null) {
        clearComposeEnd();
        return;
      }
      beginComposeEndPick();
    });

    document.getElementById('commentText')?.addEventListener('input', onCommentInput);

    document.getElementById('sendCommentBtn').addEventListener('click', async () => {
      const text = document.getElementById('commentText').value.trim();
      if (!text || !detail || !currentVersionId) return;
      const annotation = annotate?.getData?.() || null;
      try {
        const comment = await api(`/api/video-projects/${detail._id}/comments`, {
          method: 'POST',
          body: JSON.stringify({
            versionId: currentVersionId,
            timecodeSeconds: composeTimecode,
            timecodeEndSeconds: composeTimecodeEnd,
            text,
            annotation,
            mentionUserIds: pendingMentions.map(m => m.userId)
          })
        });
        detail.comments.push(comment);
        resetCompose();
        renderComments();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('uploadVersionBtn').addEventListener('click', uploadVersion);

    document.getElementById('masterUrlInput')?.addEventListener('input', updateOpenMasterBtn);

    document.getElementById('openMasterBtn')?.addEventListener('click', () => {
      const url = (document.getElementById('masterUrlInput')?.value || detail?.masterFileUrl || '').trim();
      if (!url) {
        toast('Add a master file link first', 'error');
        return;
      }
      window.open(toDirectDownloadUrl(url), '_blank', 'noopener');
    });

    document.getElementById('deliverBtn').addEventListener('click', async () => {
      if (!detail) return;
      const masterFileUrl = document.getElementById('masterUrlInput').value.trim();
      const allowClientDownload = !!document.getElementById('allowDownloadCheck')?.checked;
      try {
        await api(`/api/video-projects/${detail._id}`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'delivered', masterFileUrl, allowClientDownload })
        });
        toast('Marked delivered');
        await loadProjects();
        openDetail(detail._id);
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('allowDownloadCheck')?.addEventListener('change', async (e) => {
      if (!detail) return;
      try {
        await api(`/api/video-projects/${detail._id}`, {
          method: 'PUT',
          body: JSON.stringify({ allowClientDownload: !!e.target.checked })
        });
        detail.allowClientDownload = !!e.target.checked;
        toast(e.target.checked ? 'Client can download master' : 'Client download hidden');
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('thumbPickBtn').addEventListener('click', () => {
      document.getElementById('thumbFile').click();
    });
    document.getElementById('thumbFromFrameBtn')?.addEventListener('click', setThumbnailFromCurrentFrame);
    document.getElementById('thumbFile').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) uploadThumbnail(file);
    });
    document.getElementById('thumbClearBtn').addEventListener('click', clearThumbnail);

    document.getElementById('saveDueBtn').addEventListener('click', async () => {
      if (!detail) return;
      const raw = document.getElementById('feedbackDueInput').value;
      try {
        const updated = await api(`/api/video-projects/${detail._id}`, {
          method: 'PUT',
          body: JSON.stringify({ feedbackDueAt: raw || null })
        });
        detail.feedbackDueAt = updated.feedbackDueAt;
        const refreshed = await api(`/api/video-projects/${detail._id}`);
        detail.activity = refreshed.activity;
        renderReviewDecision();
        renderActivity();
        await loadProjects();
        toast(raw ? 'Due date saved' : 'Due date cleared');
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('notifyClientsBtn').addEventListener('click', async () => {
      if (!detail) return;
      if (!confirm('Email assigned people that the latest version is ready for review?')) return;
      const btn = document.getElementById('notifyClientsBtn');
      btn.disabled = true;
      try {
        const notes = document.getElementById('versionNotes').value.trim();
        const result = await api(`/api/video-projects/${detail._id}/notify-clients`, {
          method: 'POST',
          body: JSON.stringify({ notes })
        });
        toast(`Notified ${result.sent} contact${result.sent !== 1 ? 's' : ''}`);
        const refreshed = await api(`/api/video-projects/${detail._id}`);
        detail.activity = refreshed.activity;
        renderActivity();
      } catch (err) { toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });

    document.getElementById('versionMenuBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleVersionMenu();
    });
    document.getElementById('replaceVersionBtn')?.addEventListener('click', pickReplaceVersionFile);
    document.getElementById('replaceVersionFile')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) replaceCurrentVersionFile(file);
    });
    document.getElementById('deleteVersionBtn')?.addEventListener('click', deleteCurrentVersion);
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('versionMenuWrap');
      if (wrap && !wrap.contains(e.target)) closeVersionMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeVersionMenu();
    });

    document.getElementById('openProjectClientBtn')?.addEventListener('click', () => {
      if (!detail?.clientId) return;
      openClientEdit(detail.clientId);
    });

    document.getElementById('projectShareBtn')?.addEventListener('click', () => {
      if (!detail) return;
      openPortalLinksModal({ clientId: detail.clientId, projectId: detail._id });
    });

    document.getElementById('deleteProjectBtn').addEventListener('click', async () => {
      if (!detail) return;
      if (!confirm('Delete this project, its videos, and all comments? This cannot be undone.')) return;
      try {
        await api(`/api/video-projects/${detail._id}`, { method: 'DELETE' });
        closeDetailView();
        toast('Project deleted');
        await loadProjects();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('renameProjectBtn')?.addEventListener('click', startRenameProject);
  }

  function startRenameProject() {
    if (!isAdmin || !detail) return;
    const titleEl = document.getElementById('detailTitle');
    const renameBtn = document.getElementById('renameProjectBtn');
    const row = titleEl?.parentElement;
    if (!titleEl || !row || row.querySelector('.vp-detail-title-input')) return;

    const current = detail.title || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vp-detail-title-input';
    input.value = current;
    input.maxLength = 200;
    input.setAttribute('aria-label', 'Project name');

    titleEl.style.display = 'none';
    if (renameBtn) renameBtn.style.display = 'none';
    row.insertBefore(input, titleEl);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const next = input.value.trim();
      input.remove();
      titleEl.style.display = '';
      if (renameBtn) renameBtn.style.display = isAdmin ? 'inline-flex' : 'none';

      if (!save || !next || next === current) {
        titleEl.textContent = current;
        return;
      }
      try {
        const updated = await api(`/api/video-projects/${detail._id}`, {
          method: 'PUT',
          body: JSON.stringify({ title: next })
        });
        detail.title = updated.title || next;
        titleEl.textContent = detail.title;
        const card = projects.find(p => String(p._id) === String(detail._id));
        if (card) card.title = detail.title;
        renderGrid();
        toast('Project renamed');
      } catch (err) {
        titleEl.textContent = current;
        toast(err.message, 'error');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function setupMobileMenu() {
    const menuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (menuBtn && sidebar) {
      menuBtn.onclick = () => {
        sidebar.classList.toggle('show');
        if (overlay) overlay.classList.toggle('show');
      };
    }
    if (overlay) {
      overlay.onclick = () => {
        if (sidebar) sidebar.classList.remove('show');
        overlay.classList.remove('show');
      };
    }
  }

  // ---- Init ----
  window.initPage = async function() {
    const payload = readTokenPayload();
    const role = String(payload.role || '').toLowerCase();
    isAdmin = role === 'admin' || role === 'production_manager';

    const layoutContainer = document.getElementById('vpPageLayout');
    if (layoutContainer && typeof window.injectDashboardSidebar === 'function') {
      await window.injectDashboardSidebar(layoutContainer, {
        position: 'prepend',
        activePage: 'video-portal'
      });
    } else if (typeof window.initDashboardSidebar === 'function') {
      window.initDashboardSidebar();
    }

    setupMobileMenu();
    setupListeners();
    ensurePlayerJs();

    try {
      await Promise.all([loadClients(), loadProjects()]);
    } catch (err) {
      document.getElementById('vpContainer').innerHTML =
        `<div class="vp-empty">Failed to load: ${escapeHtml(err.message)}</div>`;
    }

    const openId = getHashProjectId() || sessionStorage.getItem('openVideoProjectId');
    const openClientId = getHashClientId();
    if (openId) {
      sessionStorage.removeItem('openVideoProjectId');
      openDetail(openId);
    } else if (openClientId) {
      openClientEdit(openClientId, { push: false });
    } else if (isClientsViewInUrl()) {
      showClientsView();
    }
  };
})();
