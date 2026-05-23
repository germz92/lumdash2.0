(function() {
  'use strict';

  const API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');

  const EDIT_STATUSES = [
    { value: '', label: '—' },
    { value: 'working', label: 'Working on it' },
    { value: 'stuck', label: 'Stuck' },
    { value: 'done', label: 'Done' }
  ];

  const QC_STATUSES = [
    { value: '', label: '—' },
    { value: 'needs_revision', label: 'Needs Revision' },
    { value: 'approved', label: 'Approved' }
  ];

  const DELIVERY_STATUSES = EDIT_STATUSES;

  let items = [];
  let users = [];
  let permissions = { isAdmin: false, canCreate: false };
  let searchQuery = '';
  let statusFilter = 'all';
  let sortField = 'dueDate';
  let sortOrder = 'asc';
  let notesItemId = null;
  let userPickerTarget = null;
  let projectSuggestTarget = null;
  let searchDebounce = null;
  const DRAFT_ID = '__draft__';
  let hasDraftRow = false;
  const VIEW_STORAGE_KEY = 'ppViewMode';
  const MOBILE_MQ = window.matchMedia('(max-width: 768px)');
  let viewMode = localStorage.getItem(VIEW_STORAGE_KEY)
    || (MOBILE_MQ.matches ? 'card' : 'table');

  function getToken() {
    return localStorage.getItem('token');
  }

  function authHeaders() {
    return { Authorization: getToken(), 'Content-Type': 'application/json' };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarHtml(user) {
    if (!user) {
      return '<span class="pp-editor-initials">—</span><span class="pp-editor-label">Unassigned</span>';
    }
    const label = esc(user.name || user.email);
    if (user.profilePhoto) {
      return `<img class="pp-editor-avatar" src="${esc(user.profilePhoto)}" alt=""><span class="pp-editor-label" title="${label}">${label}</span>`;
    }
    return `<span class="pp-editor-initials">${esc(initials(user.name || user.email))}</span><span class="pp-editor-label" title="${label}">${label}</span>`;
  }

  function statusSelectClass(value) {
    const map = {
      '': 'pp-st-empty',
      working: 'pp-st-working',
      stuck: 'pp-st-stuck',
      done: 'pp-st-done',
      needs_revision: 'pp-st-needs-revision',
      approved: 'pp-st-approved'
    };
    return map[value] || 'pp-st-empty';
  }

  function statusSelect(field, options, value, itemId) {
    const opts = options.map(o =>
      `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`
    ).join('');
    const statusCls = statusSelectClass(value);
    return `<select data-field="${field}" data-id="${itemId}" class="pp-status-select ${statusCls}">${opts}</select>`;
  }

  function syncStatusSelectStyles(root) {
    const scope = root || document;
    scope.querySelectorAll('.pp-status-select').forEach(sel => {
      const statusCls = statusSelectClass(sel.value);
      sel.className = `pp-status-select ${statusCls}`;
    });
  }

  function dueRowClass(row) {
    if (row.completed) return 'row-completed';
    if (!row.dueDate) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(row.dueDate);
    due.setHours(0, 0, 0, 0);
    const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'row-overdue';
    if (diff <= 3) return 'row-due-soon';
    return '';
  }

  function formatDueDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  }

  function formatNoteDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function td(label, content, cellClass) {
    const cls = cellClass ? ` class="${cellClass}"` : '';
    return `<td data-label="${esc(label)}"${cls}>${content}</td>`;
  }

  function textField(field, value, itemId, className = '') {
    const cls = ['pp-text-field', className].filter(Boolean).join(' ');
    return `<textarea data-field="${field}" data-id="${itemId}" class="${cls}" rows="1">${esc(value)}</textarea>`;
  }

  function syncTextareaHeights(root) {
    const scope = root || document;
    scope.querySelectorAll('.pp-text-field').forEach(ta => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.max(ta.scrollHeight, 32)}px`;
    });
  }

  function getItemProjectField(id, field) {
    return document.querySelector(`textarea[data-field="${field}"][data-id="${id}"]`);
  }

  function resolveRowUser(row, idField, nameField, photoField) {
    const idStr = row[idField] ? String(row[idField]) : '';
    const found = users.find(u => String(u._id) === idStr);
    if (found) return found;
    if (!idStr) return null;
    return { _id: idStr, name: row[nameField], profilePhoto: row[photoField] };
  }

  function getRowParts(row) {
    const editorUser = resolveRowUser(row, 'editorId', 'editorName', 'editorPhoto');
    const ownerUser = resolveRowUser(row, 'ownerId', 'ownerName', 'ownerPhoto');

    const latest = row.latestNote;
    const notesPreview = latest
      ? `<span class="pp-notes-preview" title="${esc(latest.text)}">${esc(latest.text)}</span>`
      : '<span class="pp-notes-empty">Add note...</span>';

    const isDraft = row._id === DRAFT_ID;
    const deleteBtn = permissions.isAdmin && !isDraft
      ? `<button type="button" class="pp-delete-btn" data-delete="${row._id}" title="Delete"><span class="material-symbols-outlined">delete</span></button>`
      : '';

    return {
      editorUser,
      ownerUser,
      notesPreview,
      deleteBtn,
      isDraft,
      dueClass: dueRowClass(row),
      itemInput: textField('item', row.item, row._id),
      projectInput: `<div class="project-cell"><textarea data-field="project" data-id="${row._id}" data-event-id="${row.eventId || ''}" class="pp-text-field pp-project-input" rows="1" autocomplete="off">${esc(row.project)}</textarea></div>`,
      editSelect: statusSelect('editStatus', EDIT_STATUSES, row.editStatus, row._id),
      qcSelect: statusSelect('qcStatus', QC_STATUSES, row.qcStatus, row._id),
      deliverySelect: statusSelect('deliveryStatus', DELIVERY_STATUSES, row.deliveryStatus, row._id),
      editorBtn: `<button type="button" class="pp-editor-btn" data-user-picker="${row._id}" data-user-field="editorId">${avatarHtml(editorUser)}</button>`,
      ownerBtn: `<button type="button" class="pp-editor-btn" data-user-picker="${row._id}" data-user-field="ownerId">${avatarHtml(ownerUser)}</button>`,
      dueInput: `<div class="pp-date-input-wrap"><input type="date" data-field="dueDate" data-id="${row._id}" value="${formatDueDate(row.dueDate)}"></div>`,
      notesCell: `<div class="pp-notes-cell" data-notes="${row._id}">${notesPreview}</div>`
    };
  }

  function dueBadgeHtml(row) {
    const cls = dueRowClass(row);
    if (cls === 'row-overdue') return '<span class="pp-card-badge pp-card-badge-overdue">Overdue</span>';
    if (cls === 'row-due-soon') return '<span class="pp-card-badge pp-card-badge-soon">Due soon</span>';
    if (cls === 'row-completed') return '<span class="pp-card-badge pp-card-badge-done">Completed</span>';
    return '';
  }

  function renderTableRows() {
    const tbody = document.getElementById('ppTableBody');
    if (!tbody) return;

    tbody.innerHTML = items.map(row => {
      const p = getRowParts(row);
      return `
        <tr class="${p.dueClass}" data-id="${row._id}">
          ${td('Item', p.itemInput)}
          ${td('Project', p.projectInput)}
          ${td('Edit', p.editSelect, 'pp-td-status')}
          ${td('Editor', p.editorBtn)}
          ${td('QC', p.qcSelect, 'pp-td-status')}
          ${td('Delivery', p.deliverySelect, 'pp-td-status')}
          ${td('Owner', p.ownerBtn)}
          ${td('Due Date', p.dueInput)}
          ${td('Notes', p.notesCell)}
          <td class="action-col" data-label="">${p.deleteBtn}</td>
        </tr>`;
    }).join('');

    document.querySelectorAll('th.sortable').forEach(th => {
      th.classList.toggle('sort-active', th.dataset.sort === sortField);
      const icon = th.querySelector('.sort-icon');
      if (icon) {
        icon.textContent = th.dataset.sort === sortField
          ? (sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward')
          : 'unfold_more';
      }
    });
  }

  function renderCardRows() {
    const container = document.getElementById('ppCardsContainer');
    if (!container) return;

    container.innerHTML = items.map(row => {
      const p = getRowParts(row);
      const badge = dueBadgeHtml(row);
      return `
        <article class="pp-card ${p.dueClass}" data-id="${row._id}">
          <div class="pp-card-header">
            <div class="pp-card-header-top">
              ${badge}
            </div>
            <div class="pp-card-field">
              <span class="pp-card-label">Item</span>
              ${p.itemInput}
            </div>
            <div class="pp-card-field">
              <span class="pp-card-label">Project</span>
              ${p.projectInput}
            </div>
            <div class="pp-card-field pp-card-field-due">
              <span class="pp-card-label">Due date</span>
              ${p.dueInput}
            </div>
          </div>
          <div class="pp-card-status-grid">
            <div class="pp-card-field">
              <span class="pp-card-label">Edit</span>
              ${p.editSelect}
            </div>
            <div class="pp-card-field">
              <span class="pp-card-label">QC</span>
              ${p.qcSelect}
            </div>
            <div class="pp-card-field">
              <span class="pp-card-label">Delivery</span>
              ${p.deliverySelect}
            </div>
          </div>
          <div class="pp-card-people-row">
            <div class="pp-card-field">
              <span class="pp-card-label">Editor</span>
              ${p.editorBtn}
            </div>
            <div class="pp-card-field">
              <span class="pp-card-label">Owner</span>
              ${p.ownerBtn}
            </div>
          </div>
          <div class="pp-card-notes-row">
            <span class="pp-card-label">Notes</span>
            ${p.notesCell}
          </div>
          ${p.deleteBtn ? `<div class="pp-card-footer">${p.deleteBtn}</div>` : ''}
        </article>`;
    }).join('');
  }

  function renderLists() {
    const loading = document.getElementById('ppLoading');
    const empty = document.getElementById('ppEmpty');
    const wrap = document.querySelector('.post-production-table-wrap');
    const cards = document.getElementById('ppCardsContainer');

    if (loading) loading.style.display = 'none';

    const hasRows = items.length > 0 || hasDraftRow;

    if (!hasRows) {
      if (wrap) wrap.style.display = 'none';
      if (cards) {
        cards.innerHTML = '';
        cards.style.display = 'none';
        cards.setAttribute('aria-hidden', 'true');
      }
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    if (viewMode === 'card') {
      if (wrap) wrap.style.display = 'none';
      if (cards) {
        cards.style.display = 'flex';
        cards.setAttribute('aria-hidden', 'false');
        renderCardRows();
      }
    } else {
      if (wrap) wrap.style.display = '';
      if (cards) {
        cards.innerHTML = '';
        cards.style.display = 'none';
        cards.setAttribute('aria-hidden', 'true');
      }
      renderTableRows();
    }
    updateViewToggleUI();
    syncStatusSelectStyles();
    requestAnimationFrame(() => {
      syncTextareaHeights(document.querySelector('.post-production-table-container'));
    });
  }

  function updateViewToggleUI() {
    const page = document.querySelector('.post-production-page');
    if (page) page.classList.toggle('card-view-mode', viewMode === 'card');

    document.querySelectorAll('#ppViewToggle .pp-view-btn').forEach(btn => {
      const active = btn.dataset.view === viewMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    updateDueSortUI();
  }

  function updateDueSortUI() {
    const icon = document.getElementById('ppDueSortIcon');
    const btn = document.getElementById('ppDueSortBtn');
    if (!icon || !btn) return;
    const isDueSort = sortField === 'dueDate';
    btn.classList.toggle('active', isDueSort);
    icon.textContent = isDueSort && sortOrder === 'desc' ? 'arrow_downward' : 'arrow_upward';
    btn.setAttribute(
      'aria-label',
      isDueSort
        ? `Sort by due date, ${sortOrder === 'asc' ? 'earliest first' : 'latest first'}`
        : 'Sort by due date'
    );
  }

  function toggleDueDateSort() {
    if (sortField === 'dueDate') {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = 'dueDate';
      sortOrder = 'asc';
    }
    loadData().catch(err => console.error(err));
  }

  function setViewMode(mode) {
    if (mode !== 'table' && mode !== 'card') return;
    viewMode = mode;
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
    renderLists();
  }

  async function loadData() {
    const loading = document.getElementById('ppLoading');
    if (loading) loading.style.display = 'flex';

    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (statusFilter !== 'all') params.set('filter', statusFilter);
    if (sortField) {
      params.set('sort', sortField);
      params.set('order', sortOrder);
    }

    const [itemsRes, usersRes] = await Promise.all([
      fetch(`${API_BASE}/api/post-production?${params}`, { headers: authHeaders() }),
      fetch(`${API_BASE}/api/users`, { headers: authHeaders() })
    ]);

    if (!itemsRes.ok) throw new Error('Failed to load items');
    const data = await itemsRes.json();
    items = data.items || [];
    hasDraftRow = false;
    permissions = data.permissions || permissions;

    if (usersRes.ok) {
      users = await usersRes.json();
    }

    const addBtn = document.getElementById('ppAddBtn');
    if (addBtn) addBtn.style.display = permissions.canCreate ? 'inline-flex' : 'none';

    renderLists();
  }

  async function patchItem(id, body) {
    const res = await fetch(`${API_BASE}/api/post-production/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Update failed');
    }
    return res.json();
  }

  async function createItem(body) {
    const res = await fetch(`${API_BASE}/api/post-production`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Create failed');
    }
    return res.json();
  }

  function insertDraftRow() {
    if (hasDraftRow) return;
    hasDraftRow = true;
    items.push({
      _id: DRAFT_ID,
      item: '',
      project: '',
      eventId: null,
      editStatus: '',
      qcStatus: '',
      deliveryStatus: '',
      editorId: null,
      ownerId: null,
      dueDate: null,
      notes: [],
      completed: false
    });
    renderLists();
    requestAnimationFrame(() => {
      getItemProjectField(DRAFT_ID, 'item')?.focus();
    });
  }

  function removeDraftRow() {
    hasDraftRow = false;
    items = items.filter(i => i._id !== DRAFT_ID);
    renderLists();
  }

  async function commitDraftRow() {
    const itemInput = getItemProjectField(DRAFT_ID, 'item');
    const projectInput = getItemProjectField(DRAFT_ID, 'project');
    if (!itemInput || !projectInput) {
      removeDraftRow();
      return;
    }

    const item = itemInput.value.trim();
    const project = projectInput.value.trim();
    const eventId = projectInput.dataset.eventId || null;

    if (!item && !project) {
      removeDraftRow();
      return;
    }

    try {
      await createItem({
        item,
        project,
        eventId: eventId || null,
        editStatus: '',
        qcStatus: '',
        deliveryStatus: ''
      });
      hasDraftRow = false;
      items = items.filter(i => i._id !== DRAFT_ID);
      await loadData();
    } catch (err) {
      alert(err.message);
    }
  }

  function showUserPickerMenu(anchor, itemId, userField) {
    const menu = document.getElementById('ppUserPickerMenu');
    if (!menu) return;
    userPickerTarget = { itemId, userField };

    const rect = anchor.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.minWidth = `${Math.max(rect.width, 200)}px`;

    menu.innerHTML = `
      <button type="button" class="pp-editor-option" data-user-id="">
        <span class="pp-editor-initials">—</span><span>Unassigned</span>
      </button>
      ${users.map(u => `
        <button type="button" class="pp-editor-option" data-user-id="${u._id}">
          ${avatarHtml(u)}
        </button>
      `).join('')}
    `;
  }

  function hideUserPickerMenu() {
    const menu = document.getElementById('ppUserPickerMenu');
    if (menu) menu.style.display = 'none';
    userPickerTarget = null;
  }

  async function showProjectSuggestions(input) {
    const box = document.getElementById('ppProjectSuggestions');
    if (!box) return;
    projectSuggestTarget = input;

    const q = input.value.trim();
    const res = await fetch(
      `${API_BASE}/api/post-production/project-suggestions?q=${encodeURIComponent(q)}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return;
    const list = await res.json();

    const rect = input.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.bottom + 4}px`;
    box.style.minWidth = `${rect.width}px`;

    if (!list.length && !q) {
      box.style.display = 'none';
      return;
    }

    box.innerHTML = list.map(s => `
      <button type="button" class="pp-suggestion-item" data-event-id="${s.eventId}" data-title="${esc(s.title)}">
        ${esc(s.title)}
      </button>
    `).join('') + (permissions.isAdmin && q
      ? `<button type="button" class="pp-suggestion-item" data-event-id="" data-title="${esc(q)}">Use "${esc(q)}"</button>`
      : '');
  }

  function hideProjectSuggestions() {
    const box = document.getElementById('ppProjectSuggestions');
    if (box) box.style.display = 'none';
    projectSuggestTarget = null;
  }

  function openNotesModal(itemId) {
    notesItemId = itemId;
    const row = items.find(i => i._id === itemId);
    const modal = document.getElementById('ppNotesModal');
    const history = document.getElementById('ppNotesHistory');
    if (!modal || !history) return;

    const notes = row?.notes || [];
    history.innerHTML = notes.length
      ? notes.map(n => `
          <div class="pp-note-entry">
            <div class="pp-note-meta">${esc(n.authorName || 'Unknown')} · ${formatNoteDate(n.createdAt)}</div>
            <div class="pp-note-text">${esc(n.text)}</div>
          </div>
        `).join('')
      : '<p class="pp-notes-empty" style="padding:12px 0;">No notes yet.</p>';

    document.getElementById('ppNoteInput').value = '';
    modal.style.display = 'flex';
  }

  function closeNotesModal() {
    notesItemId = null;
    const modal = document.getElementById('ppNotesModal');
    if (modal) modal.style.display = 'none';
  }

  async function initDashboardSidebar() {
    const layout = document.getElementById('postProductionPageLayout');
    if (layout && typeof window.injectDashboardSidebar === 'function') {
      await window.injectDashboardSidebar(layout, { position: 'prepend', activePage: 'post-production' });
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
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar?.classList.remove('show');
        overlay.classList.remove('show');
      });
    }
  }

  function setupListeners() {
    const listRoot = document.querySelector('.post-production-table-container');
    document.getElementById('ppSearch')?.addEventListener('input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadData().catch(err => console.error(err));
      }, 300);
    });

    document.getElementById('ppViewToggle')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.pp-view-btn');
      if (!btn?.dataset.view) return;
      setViewMode(btn.dataset.view);
    });

    document.getElementById('ppDueSortBtn')?.addEventListener('click', () => {
      toggleDueDateSort();
    });

    document.getElementById('ppFilterTabs')?.addEventListener('click', (e) => {
      const tab = e.target.closest('.status-tab');
      if (!tab) return;
      document.querySelectorAll('#ppFilterTabs .status-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      statusFilter = tab.dataset.filter || 'all';
      loadData().catch(err => console.error(err));
      updateDueSortUI();
    });

    document.querySelector('#ppTable thead')?.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const field = th.dataset.sort;
      if (sortField === field) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortOrder = 'asc';
      }
      loadData().catch(err => console.error(err));
      updateDueSortUI();
    });

    listRoot?.addEventListener('change', async (e) => {
      const el = e.target;
      const id = el.dataset.id;
      const field = el.dataset.field;
      if (!id || !field || id === DRAFT_ID) return;
      if (el.classList.contains('pp-status-select')) {
        el.className = `pp-status-select ${statusSelectClass(el.value)}`;
      }
      try {
        const body = {};
        if (field === 'dueDate') body.dueDate = el.value || null;
        else body[field] = el.value;
        await patchItem(id, body);
        await loadData();
      } catch (err) {
        alert(err.message);
      }
    });

    listRoot?.addEventListener('blur', async (e) => {
      const el = e.target;
      if (!el.matches('textarea[data-field="item"], textarea[data-field="project"]')) return;
      const id = el.dataset.id;
      const field = el.dataset.field;
      if (!id) return;
      if (id === DRAFT_ID) {
        await commitDraftRow();
        return;
      }
      try {
        const body = { [field]: el.value.trim() };
        if (field === 'project') {
          body.eventId = el.dataset.eventId || null;
        }
        await patchItem(id, body);
        await loadData();
      } catch (err) {
        alert(err.message);
      }
      hideProjectSuggestions();
    }, true);

    listRoot?.addEventListener('focus', (e) => {
      if (e.target.matches('.pp-project-input')) {
        showProjectSuggestions(e.target);
      }
    }, true);

    listRoot?.addEventListener('input', (e) => {
      if (e.target.matches('.pp-text-field')) {
        syncTextareaHeights(e.target.parentElement || listRoot);
      }
      if (e.target.matches('.pp-project-input')) {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => showProjectSuggestions(e.target), 200);
      }
    });

    listRoot?.addEventListener('click', (e) => {
      const picker = e.target.closest('[data-user-picker]');
      if (picker) {
        showUserPickerMenu(picker, picker.dataset.userPicker, picker.dataset.userField);
        return;
      }
      const notes = e.target.closest('[data-notes]');
      if (notes) {
        openNotesModal(notes.dataset.notes);
        return;
      }
      const del = e.target.closest('[data-delete]');
      if (del && confirm('Delete this item?')) {
        fetch(`${API_BASE}/api/post-production/${del.dataset.delete}`, {
          method: 'DELETE',
          headers: authHeaders()
        }).then(r => {
          if (!r.ok) throw new Error('Delete failed');
          loadData();
        }).catch(err => alert(err.message));
      }
    });

    document.getElementById('ppUserPickerMenu')?.addEventListener('click', async (e) => {
      const opt = e.target.closest('[data-user-id]');
      if (!opt || !userPickerTarget) return;
      try {
        const body = {};
        body[userPickerTarget.userField] = opt.dataset.userId || null;
        await patchItem(userPickerTarget.itemId, body);
        hideUserPickerMenu();
        await loadData();
      } catch (err) {
        alert(err.message);
      }
    });

    document.getElementById('ppProjectSuggestions')?.addEventListener('click', async (e) => {
      const opt = e.target.closest('.pp-suggestion-item');
      if (!opt || !projectSuggestTarget) return;
      const input = projectSuggestTarget;
      const tr = input.closest('tr');
      const id = input.dataset.id;
      input.value = opt.dataset.title;
      input.dataset.eventId = opt.dataset.eventId || '';
      hideProjectSuggestions();
      if (id === DRAFT_ID) return;
      if (id) {
        try {
          await patchItem(id, {
            project: opt.dataset.title,
            eventId: opt.dataset.eventId || null
          });
          await loadData();
        } catch (err) {
          alert(err.message);
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#ppUserPickerMenu') && !e.target.closest('[data-user-picker]')) {
        hideUserPickerMenu();
      }
      if (!e.target.closest('#ppProjectSuggestions') && !e.target.closest('.pp-project-input')) {
        hideProjectSuggestions();
      }
    });

    document.getElementById('ppAddBtn')?.addEventListener('click', () => {
      insertDraftRow();
    });

    document.getElementById('ppNotesClose')?.addEventListener('click', closeNotesModal);
    document.getElementById('ppNotesModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'ppNotesModal') closeNotesModal();
    });
    document.getElementById('ppNoteSave')?.addEventListener('click', async () => {
      const text = document.getElementById('ppNoteInput')?.value?.trim();
      if (!text || !notesItemId) return;
      try {
        const res = await fetch(`${API_BASE}/api/post-production/${notesItemId}/notes`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text })
        });
        if (!res.ok) throw new Error('Failed to save note');
        closeNotesModal();
        await loadData();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  function scrollToItem(itemId) {
    if (!itemId) return;
    const el = document.querySelector(`[data-id="${itemId}"]`)?.closest('tr, .pp-card');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('pp-highlight');
      setTimeout(() => el.classList.remove('pp-highlight'), 2500);
    }
  }

  function getOpenItemIdFromUrl() {
    const hash = location.hash.replace('#', '') || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return null;
    return new URLSearchParams(hash.substring(qIndex + 1)).get('itemId');
  }

  window.initPage = async function() {
    try {
      await initDashboardSidebar();
      setupListeners();
      updateViewToggleUI();
      await loadData();

      const openId = sessionStorage.getItem('openPostProductionItemId')
        || getOpenItemIdFromUrl();
      if (openId) {
        sessionStorage.removeItem('openPostProductionItemId');
        scrollToItem(openId);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load Post Production');
    }
  };
})();
