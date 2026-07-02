(function() {
  'use strict';

  const API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');

  const EDIT_STATUSES = [
    { value: '', label: '—' },
    { value: 'working', label: 'Working on it' },
    { value: 'awaiting_client', label: 'Awaiting Client' },
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
  let composePendingLinks = [];
  let composePendingAttachments = [];
  let composeUploading = false;
  let entryEditState = null;
  let mentionMenuState = null;
  let userPickerTarget = null;
  let projectSuggestTarget = null;
  let versionMenuTarget = null;
  let versionPressTimer = null;
  let suppressVersionClick = false;
  const VERSION_LONGPRESS_MS = 450;
  let searchDebounce = null;
  const DRAFT_ID = '__draft__';
  let hasDraftRow = false;
  const VIEW_STORAGE_KEY = 'ppViewMode';
  const MOBILE_MQ = window.matchMedia('(max-width: 768px)');
  let viewMode = localStorage.getItem(VIEW_STORAGE_KEY)
    || (MOBILE_MQ.matches ? 'card' : 'table');
  const selectedIds = new Set();
  const PORTAL_IDS = ['ppUpdatesModal', 'ppMentionMenu', 'ppUserPickerMenu', 'ppProjectSuggestions', 'ppVersionMenu'];
  let commitDraftInFlight = false;
  let submitUpdateInFlight = false;

  function resetPageListeners() {
    window.__ppListenerAbort?.abort();
    window.__ppListenerAbort = new AbortController();
    return window.__ppListenerAbort.signal;
  }

  function on(target, type, handler, options) {
    if (!target) return;
    const signal = window.__ppListenerAbort?.signal;
    let opts = options;
    if (signal) {
      opts = typeof options === 'boolean'
        ? { capture: options, signal }
        : { ...(options || {}), signal };
    }
    target.addEventListener(type, handler, opts);
  }

  /** Remove duplicate portal nodes from a prior SPA visit; keep the live copy on body. */
  function cleanupStalePortals() {
    const container = document.getElementById('page-container');
    PORTAL_IDS.forEach(id => {
      const all = [...document.querySelectorAll(`#${id}`)];
      if (all.length <= 1) return;

      const inPage = container
        ? all.filter(el => container.contains(el))
        : [];

      if (inPage.length > 0) {
        // Fresh page inject: drop orphaned copies left on body from the last visit
        all.filter(el => !container.contains(el)).forEach(el => el.remove());
      } else {
        // Only body-mounted copies — drop extras, keep the last one
        all.slice(0, -1).forEach(el => el.remove());
      }
    });
  }

  function isFocusMovingWithinDraftRow(el, relatedTarget) {
    if (!relatedTarget || !el) return false;
    const row = el.closest('tr, .pp-card');
    return !!(row && row.contains(relatedTarget));
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  function authHeaders(json = true) {
    const h = { Authorization: getToken() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function decodeTokenPayload() {
    try {
      const t = getToken();
      if (!t) return {};
      return JSON.parse(atob(t.split('.')[1])) || {};
    } catch {
      return {};
    }
  }

  function currentUserId() {
    const p = decodeTokenPayload();
    return String(p.userId || p.id || p.sub || '');
  }

  function currentUserIsAdmin() {
    return decodeTokenPayload().role === 'admin';
  }

  function canManageUpdateEntry(entry) {
    const uid = currentUserId();
    const authorId = String(entry?.authorId || '');
    return currentUserIsAdmin() || (!!uid && !!authorId && uid === authorId);
  }

  function extractMentionIdsFromText(text) {
    const ids = [];
    const t = String(text || '');
    users.forEach(u => {
      const name = userDisplayName(u);
      if (!name) return;
      const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`);
      if (re.test(t)) ids.push(String(u._id));
    });
    return ids;
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

  function resolveRowUsers(row, idsField) {
    const ids = (row[idsField] || []).map(id => String(id));
    if (!ids.length && idsField === 'editorIds' && row.editorId) {
      ids.push(String(row.editorId));
    }
    return ids.map(idStr => {
      const found = users.find(u => String(u._id) === idStr);
      if (found) return found;
      const fromApi = (row.editors || row.collaborators || []).find(u => String(u._id) === idStr);
      if (fromApi) {
        return { _id: idStr, name: fromApi.name, profilePhoto: fromApi.profilePhoto };
      }
      return { _id: idStr, name: 'Unknown', profilePhoto: null };
    });
  }

  function singleAvatarChip(user) {
    if (!user) return '<span class="pp-editor-initials pp-stack-avatar">—</span>';
    if (user.profilePhoto) {
      return `<img class="pp-editor-avatar pp-stack-avatar" src="${esc(user.profilePhoto)}" alt="">`;
    }
    return `<span class="pp-editor-initials pp-stack-avatar">${esc(initials(userDisplayName(user)))}</span>`;
  }

  function assigneesNamesTitle(userList) {
    return userList.map(u => userDisplayName(u)).filter(Boolean).join(', ');
  }

  function assigneesLabelHtml(userList, maxShow) {
    const names = assigneesNamesTitle(userList);
    if (userList.length === 1) {
      return `<span class="pp-editor-label" title="${esc(names)}">${esc(userDisplayName(userList[0]))}</span>`;
    }
    if (userList.length <= maxShow) {
      return `<span class="pp-editor-label" title="${esc(names)}">${esc(names)}</span>`;
    }
    const hidden = userList.length - 1;
    return `<span class="pp-editor-label" title="${esc(names)}">${esc(userDisplayName(userList[0]))}<span class="pp-assignees-more-label"> +${hidden}</span></span>`;
  }

  function avatarsStackHtml(userList, avatarOnly = false) {
    if (!userList.length) {
      return avatarHtml(null, avatarOnly);
    }
    const maxShow = avatarOnly ? 2 : 3;
    const shown = userList.slice(0, maxShow);
    const extra = userList.length - shown.length;
    const hiddenNames = assigneesNamesTitle(userList.slice(maxShow));
    const chips = shown.map(u => singleAvatarChip(u)).join('');
    const extraBadge = extra > 0
      ? `<span class="pp-avatar-more" title="${esc(hiddenNames)}">+${extra}</span>`
      : '';
    const stackTitle = esc(assigneesNamesTitle(userList));
    if (avatarOnly) {
      return `<span class="pp-avatars-stack pp-avatars-stack--compact" title="${stackTitle}">${chips}${extraBadge}</span>`;
    }
    return `<span class="pp-avatars-stack" title="${stackTitle}">${chips}${extraBadge}</span>${assigneesLabelHtml(userList, maxShow)}`;
  }

  function usersPickerBtn(row, field, userList, avatarOnly = false) {
    const label = field === 'editorIds' ? 'Editors' : 'Collaborators';
    const title = userList.length
      ? userList.map(userDisplayName).join(', ')
      : `Assign ${label.toLowerCase()}`;
    const compactCls = avatarOnly ? ' pp-editor-btn--avatar-only' : '';
    return `<button type="button" class="pp-editor-btn${compactCls}" data-user-picker="${row._id}" data-user-field="${field}" data-user-multi="1" title="${esc(title)}" aria-label="${esc(title)}">${avatarsStackHtml(userList, avatarOnly)}</button>`;
  }

  function statusSelectClass(value) {
    const map = {
      '': 'pp-st-empty',
      working: 'pp-st-working',
      awaiting_client: 'pp-st-awaiting-client',
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

  function dueDaysDiff(row) {
    if (!row.dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(row.dueDate);
    due.setHours(0, 0, 0, 0);
    if (Number.isNaN(due.getTime())) return null;
    return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  }

  // Monday.com-style due indicator shown next to the date.
  // The pie drains as the deadline nears (filled = remaining time / 7 days).
  //   overdue -> exclamation, due today -> solid circle, 7+ days / no date -> nothing.
  function dueIndicatorHtml(row) {
    if (row.completed) {
      return '<span class="pp-due-ind pp-due-done" data-tip="Completed">'
        + '<span class="material-symbols-outlined">check</span></span>';
    }
    const diff = dueDaysDiff(row);
    if (diff === null) return '';
    if (diff < 0) {
      const n = Math.abs(diff);
      return `<span class="pp-due-ind pp-due-overdue" data-tip="Overdue by ${n} Day${n === 1 ? '' : 's'}">!</span>`;
    }
    if (diff === 0) {
      return '<span class="pp-due-ind pp-due-today" data-tip="Due Today"></span>';
    }
    if (diff >= 7) return '';
    const deg = Math.round((diff / 7) * 360);
    return `<span class="pp-due-ind pp-due-pie" style="--pp-pie-deg:${deg}deg" data-tip="${diff} Day${diff === 1 ? '' : 's'} Left"></span>`;
  }

  // Floating tooltip for the due-date indicator (position: fixed so the table's
  // scroll container never clips it).
  let dueTipEl = null;
  function ensureDueTip() {
    if (dueTipEl && document.body.contains(dueTipEl)) return dueTipEl;
    dueTipEl = document.createElement('div');
    dueTipEl.className = 'pp-due-tip';
    dueTipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(dueTipEl);
    return dueTipEl;
  }
  function showDueTip(anchor) {
    const text = anchor.getAttribute('data-tip');
    if (!text) return;
    const tip = ensureDueTip();
    tip.textContent = text;
    tip.classList.remove('visible');
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let left = a.left + a.width / 2 - t.width / 2;
    left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
    let top = a.top - t.height - 8;
    if (top < 6) top = a.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.add('visible');
  }
  function hideDueTip() {
    if (dueTipEl) dueTipEl.classList.remove('visible');
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

  function linkifyEscapedHtml(safe) {
    return safe.replace(
      /(https?:\/\/[^\s<]+[^\s<.,:;"')\]}>])/gi,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="pp-update-link">$1</a>'
    );
  }

  function renderMessageText(text) {
    let safe = esc(text);
    safe = linkifyEscapedHtml(safe);
    users.slice().sort((a, b) => userDisplayName(b).length - userDisplayName(a).length).forEach(u => {
      const name = esc(userDisplayName(u));
      if (!name) return;
      const re = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      safe = safe.replace(re, `<span class="pp-mention-tag">@${name}</span>`);
    });
    return safe;
  }

  function isImageFileType(fileType) {
    return /^image\//i.test(fileType || '');
  }

  function renderAttachmentHtml(a) {
    const name = esc(a.originalName || 'Attachment');
    const url = esc(a.url || '#');
    if (isImageFileType(a.fileType)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="pp-update-attachment pp-update-attachment-image">
        <img src="${url}" alt="${name}" loading="lazy">
      </a>`;
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="pp-update-attachment pp-update-attachment-file">
      <span class="material-symbols-outlined">description</span>
      <span class="pp-update-attachment-name">${name}</span>
    </a>`;
  }

  function renderUpdateExtras(entry) {
    const links = entry.links || [];
    const attachments = entry.attachments || [];
    let html = '';
    if (links.length) {
      html += `<div class="pp-update-links">${links.map(l => {
        const url = esc(l.url || '');
        const label = esc(l.label || l.url || 'Link');
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="pp-update-link-chip">
          <span class="material-symbols-outlined">link</span>
          <span>${label}</span>
        </a>`;
      }).join('')}</div>`;
    }
    if (attachments.length) {
      html += `<div class="pp-update-attachments">${attachments.map(renderAttachmentHtml).join('')}</div>`;
    }
    return html;
  }

  function renderUpdateBody(entry) {
    const text = String(entry.text || '').trim();
    let html = '';
    if (text) {
      html += `<div class="pp-update-body">${renderMessageText(text)}</div>`;
    }
    html += renderUpdateExtras(entry);
    if (!html) {
      html = '<div class="pp-update-body pp-update-body-muted">Shared an update</div>';
    }
    return html;
  }

  function updatesButton(row) {
    if (row._id === DRAFT_ID) return '';
    const count = row.unreadUpdateCount || 0;
    const badge = count > 0
      ? `<span class="pp-updates-badge">${count > 99 ? '99+' : count}</span>`
      : '';
    const ariaLabel = count > 0
      ? `Open updates (${count} unread)`
      : 'Open updates';
    return `<div class="pp-updates-cell-inner"><button type="button" class="pp-updates-btn" data-updates="${esc(row._id)}" aria-label="${ariaLabel}">
      <span class="material-symbols-outlined">chat</span>${badge}
    </button></div>`;
  }

  function getRowVersions(row) {
    return Array.isArray(row?.versions) ? row.versions : [];
  }

  function latestVersionOf(row) {
    return getRowVersions(row)[0] || null;
  }

  function versionButton(row) {
    if (row._id === DRAFT_ID) return '<span class="pp-version-empty" aria-hidden="true">—</span>';
    const versions = getRowVersions(row);
    const latest = versions[0] || null;
    const count = versions.length;
    const title = latest
      ? `${latest.name || 'Latest version'}${latest.addedByName ? ` · ${latest.addedByName}` : ''}${latest.createdAt ? ` · ${formatUpdateDate(latest.createdAt)}` : ''}\nClick to open · long-press to edit`
      : 'Add a version link';
    const cls = latest ? 'pp-version-btn has-link' : 'pp-version-btn';
    const icon = latest ? 'link' : 'add_link';
    const badge = count > 1 ? `<span class="pp-version-count">${count > 99 ? '99+' : count}</span>` : '';
    return `<div class="pp-version-cell-inner"><button type="button" class="${cls}" data-version="${esc(row._id)}" title="${esc(title)}" aria-label="${esc(title)}">
      <span class="material-symbols-outlined">${icon}</span>${badge}
    </button></div>`;
  }

  function renderUpdateEntry(entry, { isReply = false, updateId = null } = {}) {
    const baseCls = isReply ? 'pp-update-reply' : 'pp-update-entry';
    if (entry.deleted) {
      return `
        <div class="${baseCls} pp-update-deleted" data-entry-id="${esc(entry._id)}">
          <div class="pp-update-body pp-update-body-muted">This ${isReply ? 'reply' : 'update'} was deleted</div>
        </div>`;
    }
    const cls = baseCls;
    const entryId = esc(entry._id);
    const parentId = esc(updateId || '');
    const replyFlag = isReply ? '1' : '0';
    const edited = entry.editedAt
      ? '<span class="pp-update-edited">(edited)</span>'
      : '';
    const replyBtn = (!isReply && updateId)
      ? `<button type="button" class="pp-update-reply-btn" data-reply-to="${entryId}">Reply</button>`
      : '';
    const manageBtns = canManageUpdateEntry(entry)
      ? `<div class="pp-update-icon-actions">
          <button type="button" class="pp-update-icon-btn" data-edit-entry="${entryId}" data-parent-id="${parentId}" data-is-reply="${replyFlag}" title="Edit" aria-label="Edit">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button type="button" class="pp-update-icon-btn pp-update-icon-danger" data-delete-entry="${entryId}" data-parent-id="${parentId}" data-is-reply="${replyFlag}" title="Delete" aria-label="Delete">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>`
      : '';
    const actionsHtml = (replyBtn || manageBtns)
      ? `<div class="pp-update-actions">${replyBtn}${manageBtns}</div>`
      : '';
    return `
      <div class="${cls}" data-entry-id="${entryId}" data-parent-id="${parentId}" data-is-reply="${replyFlag}">
        <div class="pp-update-meta">${esc(entry.authorName || 'Unknown')} · ${formatUpdateDate(entry.createdAt)} ${edited}</div>
        <div class="pp-update-content" data-entry-text="${esc(entry.text || '')}">${renderUpdateBody(entry)}</div>
        ${actionsHtml}
      </div>`;
  }

  function renderUpdatesFeed(updates) {
    if (!updates.length) {
      return '<p class="pp-updates-empty">No updates yet. Post the first update above.</p>';
    }
    const sorted = [...updates].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted.map(u => {
      const replies = [...(u.replies || [])]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(r => renderUpdateEntry(r, { isReply: true, updateId: u._id }))
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
    entryEditState = null;
    const updates = row?.updates || [];
    const total = row?.updateCount ?? countUpdates(updates);
    if (countEl) {
      countEl.textContent = total === 1 ? '1 update' : `${total} updates`;
    }
    feed.innerHTML = renderUpdatesFeed(updates);
    feed.scrollTop = 0;
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
    const editorUsers = resolveRowUsers(row, 'editorIds');
    const collaboratorUsers = resolveRowUsers(row, 'collaboratorIds');
    const ownerUser = resolveRowUser(row, 'ownerId', 'ownerName', 'ownerPhoto');
    const isDraft = row._id === DRAFT_ID;
    const dueIndicator = dueIndicatorHtml(row);

    return {
      editorUsers,
      collaboratorUsers,
      ownerUser,
      isDraft,
      itemInput: textField('item', row.item, row._id),
      projectInput: `<div class="project-cell"><textarea data-field="project" data-id="${row._id}" data-event-id="${row.eventId || ''}" class="pp-text-field pp-project-input" rows="1" autocomplete="off">${esc(row.project)}</textarea></div>`,
      editSelect: statusSelect('editStatus', EDIT_STATUSES, row.editStatus, row._id),
      qcSelect: statusSelect('qcStatus', QC_STATUSES, row.qcStatus, row._id),
      deliverySelect: statusSelect('deliveryStatus', DELIVERY_STATUSES, row.deliveryStatus, row._id),
      editorsBtn: usersPickerBtn(row, 'editorIds', editorUsers),
      collaboratorsBtn: usersPickerBtn(row, 'collaboratorIds', collaboratorUsers),
      ownerBtn: userPickerBtn(row, 'ownerId', ownerUser),
      tableEditorsBtn: usersPickerBtn(row, 'editorIds', editorUsers, true),
      tableCollaboratorsBtn: usersPickerBtn(row, 'collaboratorIds', collaboratorUsers, true),
      tableOwnerBtn: userPickerBtn(row, 'ownerId', ownerUser, true),
      dueInput: `<div class="pp-date-input-wrap${dueIndicator ? ' has-due-ind' : ''}">${dueIndicator}<input type="date" data-field="dueDate" data-id="${row._id}" value="${formatDueDate(row.dueDate)}"></div>`,
      updatesBtn: updatesButton(row),
      versionBtn: versionButton(row)
    };
  }

  function renderTableRows() {
    const tbody = document.getElementById('ppTableBody');
    if (!tbody) return;

    tbody.innerHTML = items.map(row => {
      const p = getRowParts(row);
      const selectedCls = isSelected(row._id) ? ' pp-row-selected' : '';
      return `
        <tr class="${selectedCls}" data-id="${row._id}">
          ${checkboxCell(row._id)}
          ${td('Item', p.itemInput, 'pp-td-item')}
          ${td('Updates', p.updatesBtn, 'pp-td-updates')}
          ${td('Project', p.projectInput, 'pp-td-project')}
          ${td('Due Date', p.dueInput, 'pp-td-due')}
          ${td('Owner', p.tableOwnerBtn, 'pp-td-avatar')}
          ${td('Edit', p.editSelect, 'pp-td-status')}
          ${td('Editors', p.tableEditorsBtn, 'pp-td-avatar')}
          ${td('Collaborators', p.tableCollaboratorsBtn, 'pp-td-avatar')}
          ${td('QC', p.qcSelect, 'pp-td-status')}
          ${td('Delivery', p.deliverySelect, 'pp-td-status')}
          ${td('Latest Version', p.versionBtn, 'pp-td-version')}
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
      const selectedCls = isSelected(row._id) ? ' pp-row-selected' : '';
      return `
        <article class="pp-card${selectedCls}" data-id="${row._id}">
          <div class="pp-card-top-bar">
            ${cardCheckbox(row._id)}
            <div class="pp-card-badges"></div>
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
              <span class="pp-card-label">Editors</span>
              ${p.editorsBtn}
            </div>
            <div class="pp-card-field">
              <span class="pp-card-label">Collaborators</span>
              ${p.collaboratorsBtn}
            </div>
          </div>
          <div class="pp-card-footer">
            <div class="pp-card-field pp-card-footer-owner">
              <span class="pp-card-label">Owner</span>
              ${p.ownerBtn}
            </div>
            <div class="pp-card-field pp-card-footer-version">
              <span class="pp-card-label">Latest Version</span>
              ${p.versionBtn}
            </div>
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

  async function markUpdatesRead(itemId) {
    const res = await fetch(`${API_BASE}/api/post-production/${itemId}/updates/mark-read`, {
      method: 'POST',
      headers: authHeaders()
    });
    if (!res.ok) return;
    const idx = items.findIndex(i => i._id === itemId);
    if (idx >= 0) items[idx].unreadUpdateCount = 0;
    renderLists();
    if (typeof window.refreshPostProductionSidebarDot === 'function') {
      window.refreshPostProductionSidebarDot();
    }
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
      editorIds: [],
      collaboratorIds: [],
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
    if (commitDraftInFlight || !hasDraftRow) return;

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

    commitDraftInFlight = true;
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
    } finally {
      commitDraftInFlight = false;
    }
  }

  function getRowAssigneeIds(row, userField) {
    const ids = new Set((row?.[userField] || []).map(String));
    if (userField === 'editorIds' && row?.editorId) ids.add(String(row.editorId));
    return ids;
  }

  function showUserPickerMenu(anchor, itemId, userField, isMulti = false) {
    const menu = document.getElementById('ppUserPickerMenu');
    if (!menu) return;
    userPickerTarget = { itemId, userField, isMulti };

    const rect = anchor.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.minWidth = `${Math.max(rect.width, 220)}px`;

    if (isMulti) {
      const row = items.find(i => i._id === itemId);
      const selected = getRowAssigneeIds(row, userField);
      const fieldLabel = userField === 'editorIds' ? 'editors' : 'collaborators';
      menu.innerHTML = `
        <div class="pp-editor-menu-hint">Click to add or remove ${fieldLabel}</div>
        ${users.map(u => {
          const checked = selected.has(String(u._id));
          return `
            <button type="button" class="pp-editor-option pp-editor-option--multi${checked ? ' is-selected' : ''}" data-user-id="${u._id}">
              ${avatarHtml(u)}
              ${checked ? '<span class="material-symbols-outlined pp-option-check">check</span>' : ''}
            </button>`;
        }).join('')}
      `;
      return;
    }

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

  function versionHistoryHtml(row) {
    const versions = getRowVersions(row);
    if (!versions.length) {
      return '<p class="pp-version-history-empty">No versions yet. Add the first link above.</p>';
    }
    return versions.map(v => {
      const url = esc(v.url || '#');
      const name = esc(v.name || 'Untitled version');
      const meta = `${v.addedByName ? esc(v.addedByName) + ' · ' : ''}${v.createdAt ? esc(formatUpdateDate(v.createdAt)) : ''}`;
      const desc = v.description
        ? `<div class="pp-version-item-desc">${esc(v.description)}</div>`
        : '';
      const removable = v._id && v._id !== 'legacy'
        ? `<button type="button" class="pp-version-item-remove" data-version-remove="${esc(v._id)}" title="Remove" aria-label="Remove version"><span class="material-symbols-outlined">delete</span></button>`
        : '';
      return `
        <li class="pp-version-item">
          <a class="pp-version-item-main" href="${url}" target="_blank" rel="noopener noreferrer">
            <span class="pp-version-item-name">${name}</span>
            <span class="pp-version-item-meta">${meta}</span>
            ${desc}
          </a>
          ${removable}
        </li>`;
    }).join('');
  }

  function renderVersionMenu(row) {
    const menu = document.getElementById('ppVersionMenu');
    if (!menu) return;
    menu.innerHTML = `
      <div class="pp-version-menu-inner">
        <div class="pp-version-menu-header">Version history</div>
        <form class="pp-version-add" data-version-add-form>
          <input type="url" class="pp-version-input" data-version-field="url" placeholder="https://… (required)" autocomplete="off" required>
          <input type="text" class="pp-version-input" data-version-field="name" placeholder="Name (optional)" autocomplete="off">
          <textarea class="pp-version-textarea" data-version-field="description" rows="2" placeholder="Description (optional)"></textarea>
          <button type="submit" class="pp-version-save">Add version</button>
        </form>
        <ul class="pp-version-history">${versionHistoryHtml(row)}</ul>
      </div>`;
  }

  function showVersionMenu(anchor, itemId) {
    const menu = document.getElementById('ppVersionMenu');
    if (!menu) return;
    const row = items.find(i => i._id === itemId);
    if (!row || row._id === DRAFT_ID) return;
    versionMenuTarget = { itemId };

    renderVersionMenu(row);

    const rect = anchor.getBoundingClientRect();
    const menuWidth = 320;
    const menuMaxHeight = 360;
    menu.style.display = 'block';

    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - menuWidth - 12);
    }
    menu.style.left = `${left}px`;
    menu.style.width = `${menuWidth}px`;

    // Flip above the anchor if there isn't room below
    if (rect.bottom + menuMaxHeight > window.innerHeight - 12 && rect.top > menuMaxHeight) {
      menu.style.top = 'auto';
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = `${rect.bottom + 4}px`;
    }

    menu.querySelector('[data-version-field="url"]')?.focus();
  }

  function hideVersionMenu() {
    const menu = document.getElementById('ppVersionMenu');
    if (menu) menu.style.display = 'none';
    versionMenuTarget = null;
  }

  function refreshVersionMenuIfOpen() {
    const menu = document.getElementById('ppVersionMenu');
    if (!menu || menu.style.display === 'none' || !versionMenuTarget) return;
    const row = items.find(i => i._id === versionMenuTarget.itemId);
    if (row) renderVersionMenu(row);
    else hideVersionMenu();
  }

  async function addVersionFromMenu() {
    if (!versionMenuTarget) return;
    const menu = document.getElementById('ppVersionMenu');
    if (!menu) return;
    const url = (menu.querySelector('[data-version-field="url"]')?.value || '').trim();
    const name = (menu.querySelector('[data-version-field="name"]')?.value || '').trim();
    const description = (menu.querySelector('[data-version-field="description"]')?.value || '').trim();
    if (!url) return;
    try {
      const res = await fetch(`${API_BASE}/api/post-production/${versionMenuTarget.itemId}/versions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ url, name, description })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add version');
      }
      const updated = await res.json();
      const idx = items.findIndex(i => i._id === updated._id);
      if (idx >= 0) items[idx] = updated;
      renderLists();
      refreshVersionMenuIfOpen();
    } catch (err) {
      alert(err.message);
    }
  }

  async function removeVersionFromMenu(versionId) {
    if (!versionMenuTarget || !versionId) return;
    try {
      const res = await fetch(`${API_BASE}/api/post-production/${versionMenuTarget.itemId}/versions/${versionId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to remove version');
      }
      const updated = await res.json();
      const idx = items.findIndex(i => i._id === updated._id);
      if (idx >= 0) items[idx] = updated;
      renderLists();
      refreshVersionMenuIfOpen();
    } catch (err) {
      alert(err.message);
    }
  }

  function clearReplyTarget() {
    replyToUpdateId = null;
    const context = document.getElementById('ppReplyContext');
    const input = document.getElementById('ppUpdateInput');
    const saveBtn = document.getElementById('ppUpdateSave');
    if (context) {
      context.hidden = true;
      context.innerHTML = '';
    }
    if (input) input.placeholder = 'Write an update… Use @ to mention someone';
    if (saveBtn) saveBtn.textContent = 'Post update';
  }

  function hideLinkForm() {
    const form = document.getElementById('ppLinkForm');
    if (form) {
      form.hidden = true;
      form.classList.remove('is-open');
    }
    const urlInput = document.getElementById('ppLinkUrl');
    const labelInput = document.getElementById('ppLinkLabel');
    if (urlInput) urlInput.value = '';
    if (labelInput) labelInput.value = '';
  }

  function showLinkForm() {
    const form = document.getElementById('ppLinkForm');
    if (form) {
      form.hidden = false;
      form.classList.add('is-open');
      document.getElementById('ppLinkUrl')?.focus();
    }
  }

  function renderComposePending() {
    const box = document.getElementById('ppComposePending');
    if (!box) return;
    const hasItems = composePendingLinks.length || composePendingAttachments.length;
    if (!hasItems) {
      box.hidden = true;
      box.classList.remove('is-open');
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.classList.add('is-open');
    const linkItems = composePendingLinks.map((l, i) => `
      <div class="pp-compose-pending-item">
        <span class="material-symbols-outlined">link</span>
        <span class="pp-compose-pending-label">${esc(l.label || l.url)}</span>
        <button type="button" class="pp-compose-pending-remove" data-remove-link="${i}" aria-label="Remove link">&times;</button>
      </div>`).join('');
    const fileItems = composePendingAttachments.map((a, i) => `
      <div class="pp-compose-pending-item">
        <span class="material-symbols-outlined">${isImageFileType(a.fileType) ? 'image' : 'description'}</span>
        <span class="pp-compose-pending-label">${esc(a.originalName || 'File')}</span>
        <button type="button" class="pp-compose-pending-remove" data-remove-attachment="${i}" aria-label="Remove attachment">&times;</button>
      </div>`).join('');
    box.innerHTML = linkItems + fileItems;
  }

  function resetComposeState() {
    composeMentionIds = new Set();
    composePendingLinks = [];
    composePendingAttachments = [];
    composeUploading = false;
    entryEditState = null;
    const input = document.getElementById('ppUpdateInput');
    if (input) input.value = '';
    clearReplyTarget();
    hideMentionMenu();
    hideLinkForm();
    renderComposePending();
    updateComposeSubmitState();
  }

  function updateComposeSubmitState() {
    const input = document.getElementById('ppUpdateInput');
    const saveBtn = document.getElementById('ppUpdateSave');
    const text = input?.value?.trim() || '';
    const canPost = !composeUploading && (
      text || composePendingLinks.length || composePendingAttachments.length
    );
    if (saveBtn) saveBtn.disabled = submitUpdateInFlight || !canPost;
  }

  function addComposeLink() {
    const urlInput = document.getElementById('ppLinkUrl');
    const labelInput = document.getElementById('ppLinkLabel');
    const raw = urlInput?.value?.trim();
    if (!raw) return;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        alert('Please enter a valid http or https link.');
        return;
      }
      if (composePendingLinks.length >= 10) {
        alert('Maximum 10 links per update.');
        return;
      }
      composePendingLinks.push({
        url: parsed.href,
        label: labelInput?.value?.trim() || ''
      });
      hideLinkForm();
      renderComposePending();
      updateComposeSubmitState();
    } catch (_) {
      alert('Please enter a valid URL.');
    }
  }

  async function uploadComposeAttachment(file) {
    if (!updatesItemId || !file) return;
    if (composePendingAttachments.length >= 10) {
      alert('Maximum 10 attachments per update.');
      return;
    }
    composeUploading = true;
    updateComposeSubmitState();
    const attachBtn = document.getElementById('ppAttachBtn');
    if (attachBtn) attachBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/post-production/${updatesItemId}/updates/attachments`, {
        method: 'POST',
        headers: { Authorization: getToken() },
        body: formData
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload file');
      }
      const data = await res.json();
      if (data.attachment) {
        composePendingAttachments.push(data.attachment);
        renderComposePending();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      composeUploading = false;
      if (attachBtn) attachBtn.disabled = false;
      const fileInput = document.getElementById('ppAttachInput');
      if (fileInput) fileInput.value = '';
      updateComposeSubmitState();
    }
  }

  function setReplyTarget(update) {
    if (!update?._id) return;
    replyToUpdateId = update._id;
    const context = document.getElementById('ppReplyContext');
    const input = document.getElementById('ppUpdateInput');
    const saveBtn = document.getElementById('ppUpdateSave');
    const preview = renderMentionText(String(update.text || '').trim());
    if (context) {
      context.hidden = false;
      context.innerHTML = `
        <div class="pp-reply-context-inner">
          <div class="pp-reply-context-header">
            <span class="pp-reply-context-label">Replying to ${esc(update.authorName || 'Unknown')}</span>
            <span class="pp-reply-context-meta">${formatUpdateDate(update.createdAt)}</span>
            <button type="button" class="pp-reply-context-cancel" id="ppCancelReply">Cancel</button>
          </div>
          <div class="pp-reply-context-preview">${preview || '<span class="pp-reply-context-empty">No message text</span>'}</div>
        </div>`;
      document.getElementById('ppCancelReply')?.addEventListener('click', clearReplyTarget);
    }
    if (input) input.placeholder = 'Write a reply… Use @ to mention someone';
    if (saveBtn) saveBtn.textContent = 'Post reply';
    input?.focus();
  }

  function ensureUpdatesPanelInBody() {
    cleanupStalePortals();
    PORTAL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentElement !== document.body) {
        document.body.appendChild(el);
      }
    });
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
      updateComposeSubmitState();
      document.getElementById('ppUpdateInput')?.focus();
    } catch (err) {
      feed.innerHTML = `<p class="pp-updates-empty">${esc(err.message || 'Failed to load updates')}</p>`;
    }
  }

  function closeUpdatesModal() {
    const itemId = updatesItemId;
    updatesItemId = null;
    resetComposeState();
    document.removeEventListener('keydown', onUpdatesModalKeydown);
    const modal = document.getElementById('ppUpdatesModal');
    if (modal) modal.style.display = 'none';
    if (itemId) markUpdatesRead(itemId);
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
    const text = input?.value?.trim() || '';
    if (!updatesItemId || composeUploading || submitUpdateInFlight) return;
    if (!text && !composePendingLinks.length && !composePendingAttachments.length) return;

    submitUpdateInFlight = true;
    const saveBtn = document.getElementById('ppUpdateSave');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/post-production/${updatesItemId}/updates`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          text,
          links: composePendingLinks,
          attachments: composePendingAttachments,
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
      loadData().catch(err => console.error(err));
      if (typeof window.refreshPostProductionSidebarDot === 'function') {
        window.refreshPostProductionSidebarDot();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      submitUpdateInFlight = false;
      if (saveBtn) saveBtn.disabled = false;
      updateComposeSubmitState();
    }
  }

  function entryEditUrl(entryId, parentId, isReply) {
    return isReply
      ? `${API_BASE}/api/post-production/${updatesItemId}/updates/${parentId}/replies/${entryId}`
      : `${API_BASE}/api/post-production/${updatesItemId}/updates/${entryId}`;
  }

  function applyUpdatedItem(updated) {
    const idx = items.findIndex(i => i._id === updatesItemId);
    if (idx >= 0) items[idx] = updated;
    setUpdatesFeed(updated);
    renderLists();
    updateBulkActionsUI();
  }

  function findModelEntry(entryId, parentId, isReply) {
    const row = items.find(i => i._id === updatesItemId);
    const updates = row?.updates || [];
    if (isReply) {
      const parent = updates.find(u => String(u._id) === String(parentId));
      return (parent?.replies || []).find(r => String(r._id) === String(entryId)) || null;
    }
    return updates.find(u => String(u._id) === String(entryId)) || null;
  }

  function renderEditPending() {
    if (!entryEditState) return;
    const box = entryEditState.form?.querySelector('.pp-update-edit-pending');
    if (!box) return;
    const links = entryEditState.links || [];
    const attachments = entryEditState.attachments || [];
    if (!links.length && !attachments.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    const linkItems = links.map((l, i) => `
      <div class="pp-compose-pending-item">
        <span class="material-symbols-outlined">link</span>
        <span class="pp-compose-pending-label">${esc(l.label || l.url)}</span>
        <button type="button" class="pp-compose-pending-remove" data-edit-remove-link="${i}" aria-label="Remove link">&times;</button>
      </div>`).join('');
    const fileItems = attachments.map((a, i) => `
      <div class="pp-compose-pending-item">
        <span class="material-symbols-outlined">${isImageFileType(a.fileType) ? 'image' : 'description'}</span>
        <span class="pp-compose-pending-label">${esc(a.originalName || 'File')}</span>
        <button type="button" class="pp-compose-pending-remove" data-edit-remove-attachment="${i}" aria-label="Remove attachment">&times;</button>
      </div>`).join('');
    box.innerHTML = linkItems + fileItems;
  }

  function updateEditSaveState() {
    if (!entryEditState) return;
    const saveBtn = entryEditState.form?.querySelector('.pp-update-edit-save');
    if (!saveBtn) return;
    const ta = entryEditState.form.querySelector('.pp-update-edit-input');
    const text = String(ta?.value || '').trim();
    const hasContent = text || (entryEditState.links || []).length || (entryEditState.attachments || []).length;
    saveBtn.disabled = entryEditState.uploading || entryEditState.saving || !hasContent;
  }

  function startEntryEdit(entryEl) {
    if (!entryEl || entryEl.querySelector('.pp-update-edit-form')) return;
    if (entryEditState) cancelEntryEdit(entryEditState.entryEl);
    const contentEl = entryEl.querySelector('.pp-update-content');
    if (!contentEl) return;
    const entryId = entryEl.dataset.entryId;
    const parentId = entryEl.dataset.parentId;
    const isReply = entryEl.dataset.isReply === '1';
    const modelEntry = findModelEntry(entryId, parentId, isReply);
    const currentText = contentEl.dataset.entryText || '';

    const form = document.createElement('div');
    form.className = 'pp-update-edit-form';
    form.innerHTML = `
      <textarea class="pp-update-edit-input" rows="3">${esc(currentText)}</textarea>
      <div class="pp-update-edit-pending" hidden></div>
      <div class="pp-update-edit-linkrow" hidden>
        <input type="url" class="pp-update-edit-linkurl" placeholder="https://…">
        <input type="text" class="pp-update-edit-linklabel" placeholder="Label (optional)">
        <button type="button" class="pp-update-edit-linkadd">Add</button>
        <button type="button" class="pp-update-edit-linkcancel">Cancel</button>
      </div>
      <div class="pp-update-edit-toolbar">
        <div class="pp-update-edit-tools">
          <button type="button" class="pp-update-edit-attach pp-update-edit-tool" title="Attach file" aria-label="Attach file"><span class="material-symbols-outlined">attach_file</span></button>
          <button type="button" class="pp-update-edit-addlink pp-update-edit-tool" title="Add link" aria-label="Add link"><span class="material-symbols-outlined">link</span></button>
          <input type="file" class="pp-update-edit-fileinput" accept="image/*,application/pdf" hidden>
        </div>
        <div class="pp-update-edit-actions">
          <button type="button" class="pp-update-edit-save">Save</button>
          <button type="button" class="pp-update-edit-cancel">Cancel</button>
        </div>
      </div>`;
    contentEl.style.display = 'none';
    contentEl.insertAdjacentElement('afterend', form);

    entryEditState = {
      entryEl,
      form,
      entryId,
      parentId,
      isReply,
      links: (modelEntry?.links || []).map(l => ({ url: l.url, label: l.label || '' })),
      attachments: (modelEntry?.attachments || []).map(a => ({ ...a })),
      uploading: false,
      saving: false
    };
    renderEditPending();
    updateEditSaveState();

    const ta = form.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function cancelEntryEdit(entryEl) {
    const el = entryEl || entryEditState?.entryEl;
    if (!el) return;
    el.querySelector('.pp-update-edit-form')?.remove();
    const contentEl = el.querySelector('.pp-update-content');
    if (contentEl) contentEl.style.display = '';
    if (entryEditState && entryEditState.entryEl === el) entryEditState = null;
  }

  function toggleEditLinkRow(show) {
    const row = entryEditState?.form?.querySelector('.pp-update-edit-linkrow');
    if (!row) return;
    row.hidden = !show;
    if (show) row.querySelector('.pp-update-edit-linkurl')?.focus();
  }

  function addEditLink() {
    if (!entryEditState) return;
    const row = entryEditState.form.querySelector('.pp-update-edit-linkrow');
    const urlInput = row?.querySelector('.pp-update-edit-linkurl');
    const labelInput = row?.querySelector('.pp-update-edit-linklabel');
    const raw = urlInput?.value?.trim();
    if (!raw) return;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        alert('Please enter a valid http or https link.');
        return;
      }
      if (entryEditState.links.length >= 10) {
        alert('Maximum 10 links per update.');
        return;
      }
      entryEditState.links.push({ url: parsed.href, label: labelInput?.value?.trim() || '' });
      if (urlInput) urlInput.value = '';
      if (labelInput) labelInput.value = '';
      toggleEditLinkRow(false);
      renderEditPending();
      updateEditSaveState();
    } catch (_) {
      alert('Please enter a valid URL.');
    }
  }

  async function uploadEditAttachment(file) {
    if (!entryEditState || !updatesItemId || !file) return;
    if (entryEditState.attachments.length >= 10) {
      alert('Maximum 10 attachments per update.');
      return;
    }
    entryEditState.uploading = true;
    updateEditSaveState();
    const attachBtn = entryEditState.form.querySelector('.pp-update-edit-attach');
    if (attachBtn) attachBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/api/post-production/${updatesItemId}/updates/attachments`, {
        method: 'POST',
        headers: { Authorization: getToken() },
        body: formData
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload file');
      }
      const data = await res.json();
      if (data.attachment && entryEditState) {
        entryEditState.attachments.push(data.attachment);
        renderEditPending();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      if (entryEditState) entryEditState.uploading = false;
      if (attachBtn) attachBtn.disabled = false;
      updateEditSaveState();
    }
  }

  async function saveEntryEdit(entryEl) {
    if (!entryEditState || !updatesItemId) return;
    if (entryEditState.uploading) return;
    const { entryId, parentId, isReply, form } = entryEditState;
    const ta = form.querySelector('.pp-update-edit-input');
    const text = String(ta?.value || '').trim();
    if (!text && !entryEditState.links.length && !entryEditState.attachments.length) {
      alert('Add a message, link, or attachment.');
      return;
    }
    entryEditState.saving = true;
    updateEditSaveState();
    try {
      const res = await fetch(entryEditUrl(entryId, parentId, isReply), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          text,
          mentionIds: extractMentionIdsFromText(text),
          links: entryEditState.links,
          attachments: entryEditState.attachments
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save changes');
      }
      entryEditState = null;
      applyUpdatedItem(await res.json());
    } catch (err) {
      if (entryEditState) entryEditState.saving = false;
      updateEditSaveState();
      alert(err.message);
    }
  }

  async function deleteEntry(entryEl) {
    if (!entryEl || !updatesItemId) return;
    const entryId = entryEl.dataset.entryId;
    const parentId = entryEl.dataset.parentId;
    const isReply = entryEl.dataset.isReply === '1';
    if (!confirm(`Delete this ${isReply ? 'reply' : 'update'}? This can't be undone.`)) return;
    try {
      const res = await fetch(entryEditUrl(entryId, parentId, isReply), {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete');
      }
      applyUpdatedItem(await res.json());
      loadData().catch(err => console.error(err));
      if (typeof window.refreshPostProductionSidebarDot === 'function') {
        window.refreshPostProductionSidebarDot();
      }
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
    resetPageListeners();
    cleanupStalePortals();
    ensureUpdatesPanelInBody();

    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadData().catch(err => console.error(err));
        if (typeof window.refreshPostProductionSidebarDot === 'function') {
          window.refreshPostProductionSidebarDot();
        }
      }
    });
    const listRoot = document.querySelector('.post-production-table-container');
    on(document.getElementById('ppSearch'), 'input', (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = e.target.value.trim();
        loadData().catch(err => console.error(err));
      }, 300);
    });

    on(document.getElementById('ppViewToggle'), 'click', (e) => {
      const btn = e.target.closest('.pp-view-btn');
      if (!btn?.dataset.view) return;
      setViewMode(btn.dataset.view);
    });

    on(document.getElementById('ppDueSortBtn'), 'click', () => {
      toggleDueDateSort();
    });

    on(document.getElementById('ppFilterTabs'), 'click', (e) => {
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

    on(document.getElementById('ppSelectAll'), 'change', (e) => {
      toggleSelectAll(e.target.checked);
    });

    on(document.getElementById('ppActionsBtn'), 'click', (e) => {
      e.stopPropagation();
      toggleActionsMenu();
    });

    on(document.getElementById('ppActionsMenu'), 'click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      runBulkAction(item.dataset.action);
    });

    on(document.querySelector('#ppTable thead'), 'click', (e) => {
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

    on(listRoot, 'change', async (e) => {
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

    on(listRoot, 'blur', async (e) => {
      const el = e.target;
      if (!el.matches('textarea[data-field="item"], textarea[data-field="project"]')) return;
      const id = el.dataset.id;
      const field = el.dataset.field;
      if (!id) return;
      if (id === DRAFT_ID) {
        if (isFocusMovingWithinDraftRow(el, e.relatedTarget)) return;
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

    on(listRoot, 'focus', (e) => {
      if (e.target.matches('.pp-project-input')) {
        showProjectSuggestions(e.target);
      }
    }, true);

    on(listRoot, 'input', (e) => {
      if (e.target.matches('.pp-text-field')) {
        syncTextareaHeights(e.target.parentElement || listRoot);
      }
      if (e.target.matches('.pp-project-input')) {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => showProjectSuggestions(e.target), 200);
      }
    });

    on(listRoot, 'click', (e) => {
      const rowCb = e.target.closest('.pp-row-checkbox[data-select-id]');
      if (rowCb) {
        e.stopPropagation();
        if (rowCb.id === 'ppSelectAll') return;
        setSelected(rowCb.dataset.selectId, rowCb.checked);
        return;
      }

      const picker = e.target.closest('[data-user-picker]');
      if (picker) {
        showUserPickerMenu(
          picker,
          picker.dataset.userPicker,
          picker.dataset.userField,
          picker.dataset.userMulti === '1'
        );
        return;
      }
      const versionBtn = e.target.closest('[data-version]');
      if (versionBtn) {
        e.stopPropagation();
        if (suppressVersionClick) {
          suppressVersionClick = false;
          return;
        }
        const row = items.find(i => i._id === versionBtn.dataset.version);
        const latest = latestVersionOf(row);
        if (latest?.url) {
          window.open(latest.url, '_blank', 'noopener');
        } else {
          showVersionMenu(versionBtn, versionBtn.dataset.version);
        }
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
        setReplyTarget(update);
        return;
      }
    });

    on(document.getElementById('ppUserPickerMenu'), 'click', async (e) => {
      const opt = e.target.closest('[data-user-id]');
      if (!opt || !userPickerTarget) return;
      try {
        if (userPickerTarget.isMulti) {
          const row = items.find(i => i._id === userPickerTarget.itemId);
          const uid = String(opt.dataset.userId);
          let ids = [...getRowAssigneeIds(row, userPickerTarget.userField)];
          if (ids.includes(uid)) {
            ids = ids.filter(id => id !== uid);
          } else {
            ids.push(uid);
          }
          await patchItem(userPickerTarget.itemId, { [userPickerTarget.userField]: ids });
          await loadData();
          const anchor = document.querySelector(
            `[data-user-picker="${userPickerTarget.itemId}"][data-user-field="${userPickerTarget.userField}"]`
          );
          if (anchor) {
            showUserPickerMenu(anchor, userPickerTarget.itemId, userPickerTarget.userField, true);
          }
        } else {
          const body = {};
          body[userPickerTarget.userField] = opt.dataset.userId || null;
          await patchItem(userPickerTarget.itemId, body);
          hideUserPickerMenu();
          await loadData();
        }
      } catch (err) {
        alert(err.message);
      }
    });

    on(document.getElementById('ppProjectSuggestions'), 'click', async (e) => {
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

    // Long-press a version button to open the editor; quick tap opens the latest link
    on(listRoot, 'pointerdown', (e) => {
      const btn = e.target.closest('[data-version]');
      if (!btn) return;
      suppressVersionClick = false;
      clearTimeout(versionPressTimer);
      versionPressTimer = setTimeout(() => {
        suppressVersionClick = true;
        showVersionMenu(btn, btn.dataset.version);
      }, VERSION_LONGPRESS_MS);
    });
    const cancelVersionPress = () => clearTimeout(versionPressTimer);
    on(listRoot, 'pointerup', cancelVersionPress);
    on(listRoot, 'pointerleave', cancelVersionPress);
    on(listRoot, 'pointercancel', cancelVersionPress);

    on(listRoot, 'contextmenu', (e) => {
      const btn = e.target.closest('[data-version]');
      if (!btn) return;
      e.preventDefault();
      clearTimeout(versionPressTimer);
      suppressVersionClick = true;
      showVersionMenu(btn, btn.dataset.version);
    });

    // Hover tooltip for the due-date indicator ("6 Days Left", "Overdue by 2 Days", ...)
    on(document, 'mouseover', (e) => {
      const ind = e.target.closest?.('.pp-due-ind');
      if (ind) showDueTip(ind);
    });
    on(document, 'mouseout', (e) => {
      const ind = e.target.closest?.('.pp-due-ind');
      if (ind && !ind.contains(e.relatedTarget)) hideDueTip();
    });
    on(document, 'scroll', hideDueTip, true);

    on(document.getElementById('ppVersionMenu'), 'submit', (e) => {
      if (e.target.closest('[data-version-add-form]')) {
        e.preventDefault();
        addVersionFromMenu();
      }
    });

    on(document.getElementById('ppVersionMenu'), 'click', (e) => {
      const removeBtn = e.target.closest('[data-version-remove]');
      if (removeBtn) {
        e.preventDefault();
        removeVersionFromMenu(removeBtn.dataset.versionRemove);
      }
    });

    on(document.getElementById('ppVersionMenu'), 'keydown', (e) => {
      if (e.key === 'Escape') hideVersionMenu();
    });

    on(document, 'click', (e) => {
      if (!e.target.closest('#ppUserPickerMenu') && !e.target.closest('[data-user-picker]')) {
        hideUserPickerMenu();
      }
      if (!e.target.closest('#ppProjectSuggestions') && !e.target.closest('.pp-project-input')) {
        hideProjectSuggestions();
      }
      if (!e.target.closest('#ppVersionMenu') && !e.target.closest('[data-version]')) {
        hideVersionMenu();
      }
      if (!e.target.closest('#ppMentionMenu') && !e.target.closest('#ppUpdateInput')) {
        hideMentionMenu();
      }
      if (!e.target.closest('#ppBulkActions')) {
        hideActionsMenu();
      }
    });

    on(document.getElementById('ppAddBtn'), 'click', () => {
      insertDraftRow();
    });

    on(document.getElementById('ppUpdatesClose'), 'click', closeUpdatesModal);
    on(document.getElementById('ppUpdatesModal'), 'click', (e) => {
      if (e.target.id === 'ppUpdatesModal') closeUpdatesModal();
    });
    on(document.getElementById('ppUpdateSave'), 'click', () => {
      submitUpdate().catch(err => alert(err.message));
    });
    on(document.getElementById('ppUpdateInput'), 'input', (e) => {
      handleMentionInput(e.target);
      updateComposeSubmitState();
    });
    on(document.getElementById('ppAttachBtn'), 'click', () => {
      document.getElementById('ppAttachInput')?.click();
    });
    on(document.getElementById('ppAttachInput'), 'change', (e) => {
      const file = e.target.files?.[0];
      if (file) uploadComposeAttachment(file);
    });
    on(document.getElementById('ppAddLinkBtn'), 'click', () => {
      const form = document.getElementById('ppLinkForm');
      if (!form?.classList.contains('is-open')) showLinkForm();
      else hideLinkForm();
    });
    on(document.getElementById('ppLinkAdd'), 'click', addComposeLink);
    on(document.getElementById('ppLinkCancel'), 'click', hideLinkForm);
    on(document.getElementById('ppLinkUrl'), 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addComposeLink();
      }
    });
    on(document.getElementById('ppComposePending'), 'click', (e) => {
      const linkIdx = e.target.closest('[data-remove-link]')?.dataset.removeLink;
      if (linkIdx != null) {
        composePendingLinks.splice(Number(linkIdx), 1);
        renderComposePending();
        updateComposeSubmitState();
        return;
      }
      const attIdx = e.target.closest('[data-remove-attachment]')?.dataset.removeAttachment;
      if (attIdx != null) {
        composePendingAttachments.splice(Number(attIdx), 1);
        renderComposePending();
        updateComposeSubmitState();
      }
    });
    on(document.getElementById('ppUpdateInput'), 'keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitUpdate().catch(err => alert(err.message));
      }
    });
    on(document.getElementById('ppMentionMenu'), 'click', (e) => {
      const opt = e.target.closest('[data-user-id]');
      if (!opt) return;
      insertMention(opt.dataset.userId, opt.dataset.userName);
    });
    on(document.getElementById('ppUpdatesFeed'), 'click', (e) => {
      if (!updatesItemId) return;

      const replyBtn = e.target.closest('[data-reply-to]');
      if (replyBtn) {
        const updateId = replyBtn.dataset.replyTo;
        const row = items.find(i => i._id === updatesItemId);
        const update = (row?.updates || []).find(u => String(u._id) === String(updateId));
        setReplyTarget(update);
        return;
      }

      const editBtn = e.target.closest('[data-edit-entry]');
      if (editBtn) {
        startEntryEdit(editBtn.closest('[data-entry-id]'));
        return;
      }

      const deleteBtn = e.target.closest('[data-delete-entry]');
      if (deleteBtn) {
        deleteEntry(deleteBtn.closest('[data-entry-id]')).catch(err => alert(err.message));
        return;
      }

      const removeLink = e.target.closest('[data-edit-remove-link]');
      if (removeLink && entryEditState) {
        entryEditState.links.splice(Number(removeLink.dataset.editRemoveLink), 1);
        renderEditPending();
        updateEditSaveState();
        return;
      }

      const removeAtt = e.target.closest('[data-edit-remove-attachment]');
      if (removeAtt && entryEditState) {
        entryEditState.attachments.splice(Number(removeAtt.dataset.editRemoveAttachment), 1);
        renderEditPending();
        updateEditSaveState();
        return;
      }

      if (e.target.closest('.pp-update-edit-attach')) {
        entryEditState?.form.querySelector('.pp-update-edit-fileinput')?.click();
        return;
      }

      if (e.target.closest('.pp-update-edit-addlink')) {
        const row = entryEditState?.form.querySelector('.pp-update-edit-linkrow');
        toggleEditLinkRow(row?.hidden);
        return;
      }

      if (e.target.closest('.pp-update-edit-linkadd')) {
        addEditLink();
        return;
      }

      if (e.target.closest('.pp-update-edit-linkcancel')) {
        toggleEditLinkRow(false);
        return;
      }

      if (e.target.closest('.pp-update-edit-save')) {
        saveEntryEdit(e.target.closest('[data-entry-id]')).catch(err => alert(err.message));
        return;
      }

      if (e.target.closest('.pp-update-edit-cancel')) {
        cancelEntryEdit(e.target.closest('[data-entry-id]'));
      }
    });

    on(document.getElementById('ppUpdatesFeed'), 'change', (e) => {
      if (e.target.classList.contains('pp-update-edit-fileinput')) {
        const file = e.target.files?.[0];
        if (file) uploadEditAttachment(file);
        e.target.value = '';
      }
    });

    on(document.getElementById('ppUpdatesFeed'), 'input', (e) => {
      if (e.target.classList.contains('pp-update-edit-input')) updateEditSaveState();
    });

    on(document.getElementById('ppUpdatesFeed'), 'keydown', (e) => {
      if (e.target.classList.contains('pp-update-edit-linkurl') && e.key === 'Enter') {
        e.preventDefault();
        addEditLink();
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

  function shouldOpenUpdatesFromUrl() {
    const hash = location.hash.replace('#', '') || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return false;
    return new URLSearchParams(hash.substring(qIndex + 1)).get('openUpdates') === '1';
  }

  window.initPage = async function() {
    try {
      document.removeEventListener('keydown', onUpdatesModalKeydown);
      updatesItemId = null;
      replyToUpdateId = null;
      hasDraftRow = false;
      commitDraftInFlight = false;
      submitUpdateInFlight = false;
      resetComposeState();

      await initDashboardSidebar();
      if (typeof window.markPostProductionVisited === 'function') {
        await window.markPostProductionVisited();
      }
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
