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
  let updatesItemId = null;
  let replyToUpdateId = null;
  let composeMentionIds = new Set();
  let mentionMenuState = null;
  let userPickerTarget = null;
  let projectSuggestTarget = null;
  let searchDebounce = null;
  const DRAFT_ID = '__draft__';
  let hasDraftRow = false;
  const VIEW_STORAGE_KEY = 'ppViewMode';
  const MOBILE_MQ = window.matchMedia('(max-width: 768px)');
  let viewMode = localStorage.getItem(VIEW_STORAGE_KEY)
    || (MOBILE_MQ.matches ? 'card' : 'table');
  const selectedIds = new Set();

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

  function avatarHtml(user, avatarOnly = false) {
    if (!user) {
      if (avatarOnly) {
        return '<span class="pp-editor-initials pp-avatar-only" aria-hidden="true">—</span>';
      }
      return '<span class="pp-editor-initials">—</span><span class="pp-editor-label">Unassigned</span>';
    }
    const label = esc(user.name || user.email);
    if (user.profilePhoto) {
      if (avatarOnly) {
        return `<img class="pp-editor-avatar pp-avatar-only" src="${esc(user.profilePhoto)}" alt="">`;
      }
      return `<img class="pp-editor-avatar" src="${esc(user.profilePhoto)}" alt=""><span class="pp-editor-label" title="${label}">${label}</span>`;
    }
    const initialsHtml = `<span class="pp-editor-initials${avatarOnly ? ' pp-avatar-only' : ''}">${esc(initials(user.name || user.email))}</span>`;
    if (avatarOnly) return initialsHtml;
    return `${initialsHtml}<span class="pp-editor-label" title="${label}">${label}</span>`;
  }

  function userPickerBtn(row, field, user, avatarOnly = false) {
    const name = user ? userDisplayName(user) : 'Unassigned';
    const title = esc(name);
    const compactCls = avatarOnly ? ' pp-editor-btn--avatar-only' : '';
    return `<button type="button" class="pp-editor-btn${compactCls}" data-user-picker="${row._id}" data-user-field="${field}" title="${title}" aria-label="${title}">${avatarHtml(user, avatarOnly)}</button>`;
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

  function formatUpdateDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function userDisplayName(user) {
    return user?.name || user?.email || '';
  }

  function renderMentionText(text) {
    let safe = esc(text);
    users.slice().sort((a, b) => userDisplayName(b).length - userDisplayName(a).length).forEach(u => {
      const name = esc(userDisplayName(u));
      if (!name) return;
      const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      safe = safe.replace(re, `<span class="pp-mention-tag">@${name}</span>`);
    });
    return safe;
  }

  function updatesButton(row) {
    if (row._id === DRAFT_ID) return '';
    const count = row.updateCount || 0;
    const badge = count > 0
      ? `<span class="pp-updates-badge">${count > 99 ? '99+' : count}</span>`
      : '';
    return `<div class="pp-updates-cell-inner"><button type="button" class="pp-updates-btn" data-updates="${esc(row._id)}" aria-label="Open updates (${count})">
      <span class="material-symbols-outlined">chat</span>${badge}
    </button></div>`;
  }

  function renderUpdateEntry(entry, { isReply = false, updateId = null } = {}) {
    const replyBtn = !isReply && updateId
      ? `<div class="pp-update-actions"><button type="button" class="pp-update-reply-btn" data-reply-to="${esc(updateId)}">Reply</button></div>`
      : '';
    const cls = isReply ? 'pp-update-reply' : 'pp-update-entry';
    return `
      <div class="${cls}">
        <div class="pp-update-meta">${esc(entry.authorName || 'Unknown')} · ${formatUpdateDate(entry.createdAt)}</div>
        <div class="pp-update-body">${renderMentionText(entry.text || '')}</div>
        ${replyBtn}
      </div>`;
  }

  function renderUpdatesFeed(updates) {
    if (!updates.length) {
      return '<p class="pp-updates-empty">No updates yet. Post the first update below.</p>';
    }
    const sorted = [...updates].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return sorted.map(u => {
      const replies = [...(u.replies || [])]
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(r => renderUpdateEntry(r, { isReply: true }))
        .join('');
      return `
        <article class="pp-update-thread" data-update-id="${esc(u._id)}">
          ${renderUpdateEntry(u, { updateId: u._id })}
          ${replies ? `<div class="pp-update-replies">${replies}</div>` : ''}
        </article>`;
    }).join('');
  }

  function countUpdates(updates) {
    return (updates || []).reduce((n, u) => n + 1 + (u.replies?.length || 0), 0);
  }

  function setUpdatesFeed(row) {
    const feed = document.getElementById('ppUpdatesFeed');
    const countEl = document.getElementById('ppUpdatesFeedCount');
    if (!feed) return;
    const updates = row?.updates || [];
    const total = row?.updateCount ?? countUpdates(updates);
    if (countEl) {
      countEl.textContent = total === 1 ? '1 update' : `${total} updates`;
    }
    feed.innerHTML = renderUpdatesFeed(updates);
    feed.scrollTop = feed.scrollHeight;
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
    const table = scope.closest?.('.post-production-table') || scope.querySelector?.('.post-production-table');
    const textareas = table
      ? table.querySelectorAll('textarea.pp-text-field')
      : scope.querySelectorAll('.pp-text-field');

  textareas.forEach(ta => {
      ta.style.height = 'auto';
      ta.style.minHeight = '38px';
      ta.style.height = `${Math.max(ta.scrollHeight, 38)}px`;
    });

    if (table) {
      table.querySelectorAll('tbody tr').forEach(row => {
        let maxHeight = 38;
        row.querySelectorAll('textarea.pp-text-field').forEach(ta => {
          maxHeight = Math.max(maxHeight, ta.scrollHeight, ta.offsetHeight);
        });
        row.querySelectorAll('textarea.pp-text-field').forEach(ta => {
          ta.style.height = `${maxHeight}px`;
          ta.style.minHeight = `${maxHeight}px`;
        });
      });
    }
  }

  function getItemProjectField(id, field) {
    return document.querySelector(`textarea[data-field="${field}"][data-id="${id}"]`);
  }

  function selectableItems() {
    return items.filter(r => r._id !== DRAFT_ID);
  }

  function isSelected(id) {
    return selectedIds.has(String(id));
  }

  function checkboxCell(id, disabled) {
    if (id === DRAFT_ID) return '<td class="pp-td-select" data-label=""></td>';
    const checked = isSelected(id) ? ' checked' : '';
    const dis = disabled ? ' disabled' : '';
    return `<td class="pp-td-select" data-label="">
      <input type="checkbox" class="pp-row-checkbox" data-select-id="${esc(id)}"${checked}${dis} aria-label="Select row">
    </td>`;
  }

  function cardCheckbox(id) {
    if (id === DRAFT_ID) return '';
    const checked = isSelected(id) ? ' checked' : '';
    return `<label class="pp-card-select-row">
      <input type="checkbox" class="pp-row-checkbox" data-select-id="${esc(id)}"${checked} aria-label="Select card">
    </label>`;
  }

  function updateBulkActionsUI() {
    const btn = document.getElementById('ppActionsBtn');
    const label = document.getElementById('ppActionsBtnLabel');
    const deleteItem = document.getElementById('ppActionDelete');
    const archiveBtn = document.getElementById('ppActionArchive');
    const archiveLabel = document.getElementById('ppActionArchiveLabel');
    const count = selectedIds.size;

    if (btn) btn.disabled = count === 0;
    if (label) label.textContent = count > 0 ? `Actions (${count})` : 'Actions';
    if (deleteItem) deleteItem.style.display = permissions.isAdmin ? '' : 'none';

    const onArchivedTab = statusFilter === 'archived';
    if (archiveBtn) {
      archiveBtn.dataset.action = onArchivedTab ? 'restore' : 'archive';
      const icon = archiveBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = onArchivedTab ? 'unarchive' : 'inventory_2';
    }
    if (archiveLabel) archiveLabel.textContent = onArchivedTab ? 'Restore' : 'Archive';

    const dupBtn = document.querySelector('#ppActionsMenu [data-action="duplicate"]');
    if (dupBtn) dupBtn.style.display = onArchivedTab ? 'none' : '';

    const selectAll = document.getElementById('ppSelectAll');
    const selectable = selectableItems();
    if (selectAll) {
      const allSelected = selectable.length > 0 && selectable.every(r => isSelected(r._id));
      const someSelected = selectable.some(r => isSelected(r._id));
      selectAll.checked = allSelected;
      selectAll.indeterminate = someSelected && !allSelected;
      selectAll.disabled = selectable.length === 0;
    }
  }

  function syncSelectionCheckboxes() {
    document.querySelectorAll('.pp-row-checkbox[data-select-id]').forEach(cb => {
      const id = cb.dataset.selectId;
      cb.checked = isSelected(id);
    });
    document.querySelectorAll('tr[data-id], .pp-card[data-id]').forEach(el => {
      const id = el.dataset.id;
      if (id && id !== DRAFT_ID) {
        el.classList.toggle('pp-row-selected', isSelected(id));
      }
    });
    updateBulkActionsUI();
  }

  function setSelected(id, on) {
    const key = String(id);
    if (on) selectedIds.add(key);
    else selectedIds.delete(key);
    syncSelectionCheckboxes();
  }

  function toggleSelectAll(on) {
    selectableItems().forEach(r => {
      if (on) selectedIds.add(String(r._id));
      else selectedIds.delete(String(r._id));
    });
    syncSelectionCheckboxes();
  }

  function hideActionsMenu() {
    const menu = document.getElementById('ppActionsMenu');
    const btn = document.getElementById('ppActionsBtn');
    if (menu) menu.classList.remove('show');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleActionsMenu() {
    const menu = document.getElementById('ppActionsMenu');
    const btn = document.getElementById('ppActionsBtn');
    if (!menu || !btn || btn.disabled) return;
    const open = menu.classList.toggle('show');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  async function runBulkAction(action) {
    const ids = [...selectedIds];
    if (!ids.length) return;

    const labels = {
      delete: 'delete',
      archive: 'archive',
      restore: 'restore',
      duplicate: 'duplicate'
    };
    const verb = labels[action] || action;
    const msg = action === 'delete'
      ? `Delete ${ids.length} item(s)? This cannot be undone.`
      : action === 'duplicate'
        ? `Duplicate ${ids.length} item(s)?`
        : action === 'restore'
          ? `Restore ${ids.length} item(s)?`
          : `Archive ${ids.length} item(s)?`;
    if (!confirm(msg)) return;

    hideActionsMenu();
    try {
      const res = await fetch(`${API_BASE}/api/post-production/bulk`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action, ids })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Bulk ${verb} failed`);
      if (action === 'duplicate' && data.skipped > 0) {
        alert(`Duplicated ${data.affected} item(s). ${data.skipped} skipped (no permission for that project).`);
      }
      selectedIds.clear();
      await loadData();
    } catch (err) {
      alert(err.message);
    }
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
    const isDraft = row._id === DRAFT_ID;

    return {
      editorUser,
      ownerUser,
      isDraft,
      dueClass: dueRowClass(row),
      itemInput: textField('item', row.item, row._id),
      projectInput: `<div class="project-cell"><textarea data-field="project" data-id="${row._id}" data-event-id="${row.eventId || ''}" class="pp-text-field pp-project-input" rows="1" autocomplete="off">${esc(row.project)}</textarea></div>`,
      editSelect: statusSelect('editStatus', EDIT_STATUSES, row.editStatus, row._id),
      qcSelect: statusSelect('qcStatus', QC_STATUSES, row.qcStatus, row._id),
      deliverySelect: statusSelect('deliveryStatus', DELIVERY_STATUSES, row.deliveryStatus, row._id),
      editorBtn: userPickerBtn(row, 'editorId', editorUser),
      ownerBtn: userPickerBtn(row, 'ownerId', ownerUser),
      tableEditorBtn: userPickerBtn(row, 'editorId', editorUser, true),
      tableOwnerBtn: userPickerBtn(row, 'ownerId', ownerUser, true),
      dueInput: `<div class="pp-date-input-wrap"><input type="date" data-field="dueDate" data-id="${row._id}" value="${formatDueDate(row.dueDate)}"></div>`,
      updatesBtn: updatesButton(row)
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
      const selectedCls = isSelected(row._id) ? ' pp-row-selected' : '';
      return `
        <tr class="${p.dueClass}${selectedCls}" data-id="${row._id}">
          ${checkboxCell(row._id)}
          ${td('Item', p.itemInput, 'pp-td-item')}
          ${td('Updates', p.updatesBtn, 'pp-td-updates')}
          ${td('Project', p.projectInput, 'pp-td-project')}
          ${td('Due Date', p.dueInput, 'pp-td-due')}
          ${td('Owner', p.tableOwnerBtn, 'pp-td-avatar')}
          ${td('Edit', p.editSelect, 'pp-td-status')}
          ${td('Editor', p.tableEditorBtn, 'pp-td-avatar')}
          ${td('QC', p.qcSelect, 'pp-td-status')}
          ${td('Delivery', p.deliverySelect, 'pp-td-status')}
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
      const selectedCls = isSelected(row._id) ? ' pp-row-selected' : '';
      return `
        <article class="pp-card ${p.dueClass}${selectedCls}" data-id="${row._id}">
          <div class="pp-card-top-bar">
            ${cardCheckbox(row._id)}
            <div class="pp-card-badges">${badge}</div>
          </div>
          <div class="pp-card-header">
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
          <div class="pp-card-footer">
            ${p.updatesBtn}
          </div>
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
        cards.setAttribute('aria-hidden', 'true');
      }
      if (empty) empty.style.display = 'block';
      return;
    }

    if (empty) empty.style.display = 'none';

    if (viewMode === 'card') {
      if (wrap) wrap.style.display = 'none';
      if (cards) {
        cards.removeAttribute('style');
        cards.setAttribute('aria-hidden', 'false');
        renderCardRows();
      }
    } else {
      if (wrap) wrap.style.display = '';
      if (cards) {
        cards.innerHTML = '';
        cards.setAttribute('aria-hidden', 'true');
      }
      renderTableRows();
    }
    updateViewToggleUI();
    syncStatusSelectStyles();
    syncSelectionCheckboxes();
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

    updateBulkActionsUI();
    renderLists();

    if (updatesItemId) {
      const openRow = items.find(i => i._id === updatesItemId);
      if (openRow) {
        setUpdatesFeed(openRow);
      } else {
        fetchItemWithUpdates(updatesItemId).then(setUpdatesFeed).catch(() => {});
      }
    }
  }

  async function fetchItemWithUpdates(itemId) {
    const res = await fetch(`${API_BASE}/api/post-production/${itemId}`, { headers: authHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to load updates');
    }
    return res.json();
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
      updates: [],
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

  function resetComposeState() {
    replyToUpdateId = null;
    composeMentionIds = new Set();
    const input = document.getElementById('ppUpdateInput');
    const label = document.getElementById('ppReplyingLabel');
    const saveBtn = document.getElementById('ppUpdateSave');
    if (input) input.value = '';
    if (label) {
      label.style.display = 'none';
      label.innerHTML = '';
    }
    if (saveBtn) saveBtn.textContent = 'Post update';
    hideMentionMenu();
  }

  function setReplyTarget(updateId, authorName) {
    replyToUpdateId = updateId;
    const label = document.getElementById('ppReplyingLabel');
    const saveBtn = document.getElementById('ppUpdateSave');
    if (label) {
      label.style.display = '';
      label.innerHTML = `Replying to ${esc(authorName || 'update')} <button type="button" id="ppCancelReply">Cancel</button>`;
      document.getElementById('ppCancelReply')?.addEventListener('click', () => {
        replyToUpdateId = null;
        if (label) label.style.display = 'none';
        if (saveBtn) saveBtn.textContent = 'Post update';
      });
    }
    if (saveBtn) saveBtn.textContent = 'Post reply';
    document.getElementById('ppUpdateInput')?.focus();
  }

  function ensureUpdatesPanelInBody() {
    const modal = document.getElementById('ppUpdatesModal');
    if (modal && modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
  }

  function onUpdatesModalKeydown(e) {
    if (e.key === 'Escape') closeUpdatesModal();
  }

  async function openUpdatesModal(itemId) {
    ensureUpdatesPanelInBody();
    updatesItemId = itemId;
    const modal = document.getElementById('ppUpdatesModal');
    const feed = document.getElementById('ppUpdatesFeed');
    const title = document.getElementById('ppUpdatesModalTitle');
    const sub = document.getElementById('ppUpdatesModalSub');
    const countEl = document.getElementById('ppUpdatesFeedCount');
    if (!modal || !feed) return;

    resetComposeState();
    if (title) title.textContent = 'Updates';
    if (sub) sub.textContent = '';
    if (countEl) countEl.textContent = 'Loading…';
    feed.innerHTML = '<p class="pp-updates-loading">Loading thread history…</p>';
    modal.style.display = 'flex';
    document.addEventListener('keydown', onUpdatesModalKeydown);

    try {
      const row = await fetchItemWithUpdates(itemId);
      const idx = items.findIndex(i => i._id === itemId);
      if (idx >= 0) items[idx] = row;
      else items.push(row);

      if (title) title.textContent = row.item ? `Updates — ${row.item}` : 'Updates';
      if (sub) sub.textContent = row.project ? `Project: ${row.project}` : '';
      setUpdatesFeed(row);
      document.getElementById('ppUpdateInput')?.focus();
    } catch (err) {
      feed.innerHTML = `<p class="pp-updates-empty">${esc(err.message || 'Failed to load updates')}</p>`;
    }
  }

  function closeUpdatesModal() {
    updatesItemId = null;
    resetComposeState();
    document.removeEventListener('keydown', onUpdatesModalKeydown);
    const modal = document.getElementById('ppUpdatesModal');
    if (modal) modal.style.display = 'none';
  }

  function hideMentionMenu() {
    const menu = document.getElementById('ppMentionMenu');
    if (menu) menu.style.display = 'none';
    mentionMenuState = null;
  }

  function showMentionMenu(textarea, query) {
    const menu = document.getElementById('ppMentionMenu');
    if (!menu) return;
    const q = String(query || '').trim().toLowerCase();
    const matches = users.filter(u => {
      const name = userDisplayName(u).toLowerCase();
      const email = (u.email || '').toLowerCase();
      return !q || name.includes(q) || email.includes(q);
    }).slice(0, 8);

    if (!matches.length) {
      hideMentionMenu();
      return;
    }

    const rect = textarea.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.minWidth = `${Math.max(rect.width, 220)}px`;

    menu.innerHTML = matches.map(u => `
      <button type="button" class="pp-mention-option" data-user-id="${esc(u._id)}" data-user-name="${esc(userDisplayName(u))}">
        ${avatarHtml(u)}
      </button>
    `).join('');

    mentionMenuState = { textarea, atIndex: textarea.selectionStart - query.length - 1 };
  }

  function insertMention(userId, userName) {
    if (!mentionMenuState?.textarea) return;
    const ta = mentionMenuState.textarea;
    const atIndex = mentionMenuState.atIndex;
    const before = ta.value.slice(0, atIndex);
    const after = ta.value.slice(ta.selectionStart);
    const mention = `@${userName} `;
    ta.value = `${before}${mention}${after}`;
    composeMentionIds.add(String(userId));
    const cursor = before.length + mention.length;
    ta.setSelectionRange(cursor, cursor);
    ta.focus();
    hideMentionMenu();
  }

  function handleMentionInput(textarea) {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const at = before.lastIndexOf('@');
    if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) {
      hideMentionMenu();
      return;
    }
    const query = before.slice(at + 1);
    if (/\s/.test(query)) {
      hideMentionMenu();
      return;
    }
    showMentionMenu(textarea, query);
  }

  async function submitUpdate() {
    const input = document.getElementById('ppUpdateInput');
    const text = input?.value?.trim();
    if (!text || !updatesItemId) return;
    try {
      const res = await fetch(`${API_BASE}/api/post-production/${updatesItemId}/updates`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          text,
          parentUpdateId: replyToUpdateId,
          mentionIds: [...composeMentionIds]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to post update');
      }
      const updated = await res.json();
      const idx = items.findIndex(i => i._id === updatesItemId);
      if (idx >= 0) items[idx] = updated;
      setUpdatesFeed(updated);
      resetComposeState();
      renderLists();
      updateBulkActionsUI();
    } catch (err) {
      alert(err.message);
    }
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
    ensureUpdatesPanelInBody();
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
      selectedIds.clear();
      hideActionsMenu();
      loadData().catch(err => console.error(err));
      updateDueSortUI();
    });

    document.getElementById('ppSelectAll')?.addEventListener('change', (e) => {
      toggleSelectAll(e.target.checked);
    });

    document.getElementById('ppActionsBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleActionsMenu();
    });

    document.getElementById('ppActionsMenu')?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      runBulkAction(item.dataset.action);
    });

    document.querySelector('#ppTable thead')?.addEventListener('click', (e) => {
      if (e.target.closest('.pp-col-select-th, .pp-row-checkbox')) return;
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
      const rowCb = e.target.closest('.pp-row-checkbox[data-select-id]');
      if (rowCb) {
        e.stopPropagation();
        if (rowCb.id === 'ppSelectAll') return;
        setSelected(rowCb.dataset.selectId, rowCb.checked);
        return;
      }

      const picker = e.target.closest('[data-user-picker]');
      if (picker) {
        showUserPickerMenu(picker, picker.dataset.userPicker, picker.dataset.userField);
        return;
      }
      const updatesBtn = e.target.closest('[data-updates]');
      if (updatesBtn) {
        openUpdatesModal(updatesBtn.dataset.updates);
        return;
      }
      const replyBtn = e.target.closest('[data-reply-to]');
      if (replyBtn && updatesItemId) {
        const updateId = replyBtn.dataset.replyTo;
        const row = items.find(i => i._id === updatesItemId);
        const update = (row?.updates || []).find(u => String(u._id) === String(updateId));
        setReplyTarget(updateId, update?.authorName);
        return;
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
      if (!e.target.closest('#ppMentionMenu') && !e.target.closest('#ppUpdateInput')) {
        hideMentionMenu();
      }
      if (!e.target.closest('#ppBulkActions')) {
        hideActionsMenu();
      }
    });

    document.getElementById('ppAddBtn')?.addEventListener('click', () => {
      insertDraftRow();
    });

    document.getElementById('ppUpdatesClose')?.addEventListener('click', closeUpdatesModal);
    document.getElementById('ppUpdatesModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'ppUpdatesModal') closeUpdatesModal();
    });
    document.getElementById('ppUpdateSave')?.addEventListener('click', () => {
      submitUpdate().catch(err => alert(err.message));
    });
    document.getElementById('ppUpdateInput')?.addEventListener('input', (e) => {
      handleMentionInput(e.target);
    });
    document.getElementById('ppUpdateInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitUpdate().catch(err => alert(err.message));
      }
    });
    document.getElementById('ppMentionMenu')?.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-user-id]');
      if (!opt) return;
      insertMention(opt.dataset.userId, opt.dataset.userName);
    });
    document.getElementById('ppUpdatesFeed')?.addEventListener('click', (e) => {
      const replyBtn = e.target.closest('[data-reply-to]');
      if (!replyBtn || !updatesItemId) return;
      const updateId = replyBtn.dataset.replyTo;
      const row = items.find(i => i._id === updatesItemId);
      const update = (row?.updates || []).find(u => String(u._id) === String(updateId));
      setReplyTarget(updateId, update?.authorName);
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

  function shouldOpenUpdatesFromUrl() {
    const hash = location.hash.replace('#', '') || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return false;
    return new URLSearchParams(hash.substring(qIndex + 1)).get('openUpdates') === '1';
  }

  window.initPage = async function() {
    try {
      await initDashboardSidebar();
      setupListeners();
      updateViewToggleUI();
      await loadData();

      const openUpdates = sessionStorage.getItem('openPostProductionUpdates') === '1'
        || shouldOpenUpdatesFromUrl();
      sessionStorage.removeItem('openPostProductionUpdates');

      const openId = sessionStorage.getItem('openPostProductionItemId')
        || getOpenItemIdFromUrl();
      if (openId) {
        sessionStorage.removeItem('openPostProductionItemId');
        scrollToItem(openId);
        if (openUpdates) openUpdatesModal(openId);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load Post Production');
    }
  };
})();
