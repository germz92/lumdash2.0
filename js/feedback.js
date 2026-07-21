(function() {
  'use strict';

  const API_BASE = window.API_BASE || '';
  function getToken() { return `Bearer ${localStorage.getItem('token')}`; }

  const STATUS_LABELS = {
    new: 'New',
    in_progress: 'In Progress',
    completed: 'Completed',
    declined: 'Declined'
  };

  let allItems = [];
  let currentType = 'all';
  let currentStatusFilter = 'all';
  let currentSearch = '';
  let mineOnly = false;
  let currentDetail = null;
  let isAdmin = false;
  let myUserId = '';

  // Form modal state
  let formType = 'bug';
  let formEditingId = null;
  let formScreenshotFile = null;

  function readTokenPayload() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return {};
      return JSON.parse(atob(token.split('.')[1])) || {};
    } catch {
      return {};
    }
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

  function typeBadge(type) {
    if (type === 'feature') {
      return `<span class="fb-type-badge feature"><span class="material-symbols-outlined">lightbulb</span>Feature</span>`;
    }
    return `<span class="fb-type-badge bug"><span class="material-symbols-outlined">bug_report</span>Bug</span>`;
  }

  function statusBadge(status) {
    return `<span class="fb-status ${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  function isOwn(item) {
    return (item.submittedBy || '').toString() === myUserId;
  }

  function canModify(item) {
    return isAdmin || (isOwn(item) && item.status === 'new');
  }

  // ---- Data ----
  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        headers: { Authorization: getToken() }
      });
      if (!res.ok) throw new Error('Failed to load');
      allItems = await res.json();
      applyFilters();
    } catch (err) {
      console.error(err);
      document.getElementById('fbContainer').innerHTML =
        '<div class="fb-empty">Failed to load feedback. Please refresh.</div>';
    }
  }

  function applyFilters() {
    let items = allItems;
    if (currentType !== 'all') items = items.filter(i => i.type === currentType);
    if (currentStatusFilter !== 'all') items = items.filter(i => i.status === currentStatusFilter);
    if (mineOnly) items = items.filter(isOwn);
    if (currentSearch.trim()) {
      const q = currentSearch.trim().toLowerCase();
      items = items.filter(i =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.submittedByName || '').toLowerCase().includes(q) ||
        (i.page || '').toLowerCase().includes(q)
      );
    }
    render(items);
  }

  // ---- Render ----
  function render(items) {
    const count = document.getElementById('fbCount');
    count.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

    const container = document.getElementById('fbContainer');
    if (items.length === 0) {
      container.innerHTML = `
        <div class="fb-empty">
          <span class="material-symbols-outlined">forum</span>
          No feedback found. Found a bug or have an idea? Hit "Submit Feedback".
        </div>`;
      return;
    }

    const rows = items.map(i => `
      <tr data-id="${i._id}">
        <td>${typeBadge(i.type)}</td>
        <td>
          <div class="fb-row-title">${escapeHtml(i.title)}</div>
          ${i.page ? `<div class="fb-row-page">${escapeHtml(i.page)}</div>` : ''}
        </td>
        <td>${escapeHtml(i.submittedByName || '—')}</td>
        <td style="white-space:nowrap;">${fmtDate(i.createdAt)}</td>
        <td>${statusBadge(i.status)}</td>
      </tr>`).join('');

    const cards = items.map(i => `
      <div class="fb-card" data-id="${i._id}">
        <div class="fb-card-top">${typeBadge(i.type)}${statusBadge(i.status)}</div>
        <div class="fb-card-title">${escapeHtml(i.title)}</div>
        <div class="fb-card-meta">${escapeHtml(i.submittedByName || '—')} · ${fmtDate(i.createdAt)}${i.page ? ` · ${escapeHtml(i.page)}` : ''}</div>
      </div>`).join('');

    container.innerHTML = `
      <table class="fb-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Title</th>
            <th>Submitted By</th>
            <th>Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="fb-cards">${cards}</div>`;

    container.querySelectorAll('[data-id]').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }

  // ---- Detail modal ----
  function openDetail(id) {
    const item = allItems.find(i => i._id === id || i._id?.toString() === id);
    if (!item) return;
    currentDetail = item;

    const body = document.getElementById('detailBody');
    body.innerHTML = `
      <div class="fb-detail-badges">${typeBadge(item.type)}${statusBadge(item.status)}</div>
      <div class="fb-detail-title">${escapeHtml(item.title)}</div>
      <div class="fb-detail-meta">
        Submitted by <strong>${escapeHtml(item.submittedByName || 'Unknown')}</strong> on ${fmtDate(item.createdAt)}
        ${item.page ? ` · ${escapeHtml(item.page)}` : ''}
      </div>
      ${item.description ? `
        <div class="fb-detail-section">
          <div class="fb-detail-label">Description</div>
          <div class="fb-detail-text">${escapeHtml(item.description)}</div>
        </div>` : ''}
      ${item.screenshotUrl ? `
        <div class="fb-detail-section fb-detail-screenshot">
          <div class="fb-detail-label">Screenshot</div>
          <a href="${escapeHtml(item.screenshotUrl)}" target="_blank" rel="noopener">
            <img src="${escapeHtml(item.screenshotUrl)}" alt="Screenshot">
          </a>
        </div>` : ''}
      ${item.adminNote ? `
        <div class="fb-detail-section">
          <div class="fb-detail-label">Note from the team</div>
          <div class="fb-admin-note-box">${escapeHtml(item.adminNote)}</div>
        </div>` : ''}
      ${item.updatedByName && item.statusChangedAt ? `
        <div class="fb-detail-meta" style="margin-bottom:0;">
          Status set by ${escapeHtml(item.updatedByName)} on ${fmtDate(item.statusChangedAt)}
        </div>` : ''}
      ${isAdmin ? `
        <div class="fb-admin-controls">
          <div class="fb-detail-label">Update status (admin)</div>
          <select id="adminStatusSelect">
            ${Object.entries(STATUS_LABELS).map(([value, label]) =>
              `<option value="${value}"${item.status === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
          <textarea id="adminNoteInput" rows="2" placeholder="Optional note to the submitter (e.g. 'Fixed in next update')">${escapeHtml(item.adminNote || '')}</textarea>
        </div>` : ''}`;

    const footer = document.getElementById('detailFooter');
    const buttons = [];
    if (canModify(item)) {
      buttons.push('<button class="fb-btn danger" id="detailDeleteBtn">Delete</button>');
      buttons.push('<button class="fb-btn secondary" id="detailEditBtn">Edit</button>');
    }
    if (isAdmin) {
      buttons.push('<button class="fb-btn primary" id="detailSaveBtn">Save Status</button>');
    }
    footer.innerHTML = buttons.join('');

    document.getElementById('detailDeleteBtn')?.addEventListener('click', () => deleteItem(item._id));
    document.getElementById('detailEditBtn')?.addEventListener('click', () => {
      closeDetail();
      openForm(item);
    });
    document.getElementById('detailSaveBtn')?.addEventListener('click', () => saveStatus(item._id));

    document.getElementById('fbDetailModal').classList.add('show');
  }

  function closeDetail() {
    document.getElementById('fbDetailModal').classList.remove('show');
    currentDetail = null;
  }

  async function saveStatus(id) {
    const status = document.getElementById('adminStatusSelect').value;
    const adminNote = document.getElementById('adminNoteInput').value.trim();
    const btn = document.getElementById('detailSaveBtn');
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/feedback/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: getToken() },
        body: JSON.stringify({ status, adminNote })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to update status');
        btn.disabled = false;
        return;
      }
      const updated = await res.json();
      const idx = allItems.findIndex(i => i._id === updated._id);
      if (idx !== -1) allItems[idx] = updated;
      closeDetail();
      applyFilters();
    } catch (err) {
      console.error(err);
      alert('Failed to update status');
      btn.disabled = false;
    }
  }

  async function deleteItem(id) {
    if (!confirm('Delete this feedback? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/feedback/${id}`, {
        method: 'DELETE',
        headers: { Authorization: getToken() }
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to delete');
        return;
      }
      allItems = allItems.filter(i => i._id !== id && i._id?.toString() !== id);
      closeDetail();
      applyFilters();
    } catch (err) {
      console.error(err);
      alert('Failed to delete');
    }
  }

  // ---- Submit / edit form ----
  function setFormType(type) {
    formType = type;
    document.querySelectorAll('#formTypePicker .fb-type-option').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.type === type);
    });
  }

  function resetScreenshot() {
    formScreenshotFile = null;
    document.getElementById('formScreenshot').value = '';
    document.getElementById('screenshotPreview').hidden = true;
    document.getElementById('screenshotBtnLabel').textContent = 'Attach a screenshot';
  }

  function openForm(editItem) {
    formEditingId = editItem ? editItem._id : null;
    document.getElementById('formTitle').textContent = editItem ? 'Edit Feedback' : 'Submit Feedback';
    document.getElementById('formSubmitBtn').textContent = editItem ? 'Save Changes' : 'Submit';
    setFormType(editItem ? editItem.type : 'bug');
    document.getElementById('formTitleInput').value = editItem ? editItem.title : '';
    document.getElementById('formDescInput').value = editItem ? (editItem.description || '') : '';
    document.getElementById('formPageSelect').value = editItem ? (editItem.page || '') : '';
    if (document.getElementById('formPageSelect').value !== (editItem ? (editItem.page || '') : '')) {
      document.getElementById('formPageSelect').value = '';
    }
    // Screenshots can only be attached on creation; keep edit simple
    document.getElementById('screenshotField').style.display = editItem ? 'none' : '';
    resetScreenshot();
    const errEl = document.getElementById('formError');
    errEl.hidden = true;
    document.getElementById('fbFormModal').classList.add('show');
    document.getElementById('formTitleInput').focus();
  }

  function closeForm() {
    document.getElementById('fbFormModal').classList.remove('show');
    formEditingId = null;
    resetScreenshot();
  }

  function showFormError(message) {
    const errEl = document.getElementById('formError');
    errEl.textContent = message;
    errEl.hidden = false;
  }

  async function submitForm() {
    const title = document.getElementById('formTitleInput').value.trim();
    const description = document.getElementById('formDescInput').value.trim();
    const page = document.getElementById('formPageSelect').value;

    if (!title) {
      showFormError('Please enter a title.');
      return;
    }

    const btn = document.getElementById('formSubmitBtn');
    btn.disabled = true;

    try {
      let res;
      if (formEditingId) {
        res = await fetch(`${API_BASE}/api/feedback/${formEditingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: getToken() },
          body: JSON.stringify({ type: formType, title, description, page })
        });
      } else {
        const formData = new FormData();
        formData.append('type', formType);
        formData.append('title', title);
        formData.append('description', description);
        formData.append('page', page);
        if (formScreenshotFile) formData.append('screenshot', formScreenshotFile);
        res = await fetch(`${API_BASE}/api/feedback`, {
          method: 'POST',
          headers: { Authorization: getToken() },
          body: formData
        });
      }

      if (!res.ok) {
        const err = await res.json();
        showFormError(err.error || 'Failed to save feedback.');
        btn.disabled = false;
        return;
      }

      const saved = await res.json();
      if (formEditingId) {
        const idx = allItems.findIndex(i => i._id === saved._id);
        if (idx !== -1) allItems[idx] = saved;
      } else {
        allItems.unshift(saved);
      }
      btn.disabled = false;
      closeForm();
      applyFilters();
    } catch (err) {
      console.error(err);
      showFormError('Network error — please try again.');
      btn.disabled = false;
    }
  }

  // ---- Listeners ----
  function setupListeners() {
    document.getElementById('newFeedbackBtn').addEventListener('click', () => openForm(null));

    // Detail modal
    document.getElementById('fbDetailModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDetail();
    });
    document.getElementById('detailClose').addEventListener('click', closeDetail);

    // Form modal
    document.getElementById('fbFormModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeForm();
    });
    document.getElementById('formClose').addEventListener('click', closeForm);
    document.getElementById('formCancelBtn').addEventListener('click', closeForm);
    document.getElementById('formSubmitBtn').addEventListener('click', submitForm);

    document.querySelectorAll('#formTypePicker .fb-type-option').forEach(btn => {
      btn.addEventListener('click', () => setFormType(btn.dataset.type));
    });

    // Screenshot picker
    const fileInput = document.getElementById('formScreenshot');
    document.getElementById('screenshotPickBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        showFormError('Screenshot must be under 8 MB.');
        fileInput.value = '';
        return;
      }
      formScreenshotFile = file;
      document.getElementById('screenshotBtnLabel').textContent = file.name;
      const preview = document.getElementById('screenshotPreview');
      document.getElementById('screenshotPreviewImg').src = URL.createObjectURL(file);
      preview.hidden = false;
    });
    document.getElementById('screenshotRemoveBtn').addEventListener('click', resetScreenshot);

    // Filters
    document.getElementById('fbSearch').addEventListener('input', (e) => {
      currentSearch = e.target.value;
      applyFilters();
    });

    document.querySelectorAll('.fb-type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.fb-type-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentType = tab.dataset.type;
        applyFilters();
      });
    });

    document.getElementById('filterStatus').addEventListener('change', (e) => {
      currentStatusFilter = e.target.value;
      applyFilters();
    });

    document.getElementById('mineToggle').addEventListener('click', () => {
      mineOnly = !mineOnly;
      document.getElementById('mineToggle').classList.toggle('active', mineOnly);
      applyFilters();
    });
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
    isAdmin = /^admin$/i.test(payload.role || '');
    myUserId = (payload.id || '').toString();

    const layoutContainer = document.getElementById('fbPageLayout');
    if (layoutContainer && typeof window.injectDashboardSidebar === 'function') {
      await window.injectDashboardSidebar(layoutContainer, {
        position: 'prepend',
        activePage: 'feedback'
      });
    } else if (typeof window.initDashboardSidebar === 'function') {
      window.initDashboardSidebar();
    }

    setupMobileMenu();
    setupListeners();
    await loadItems();

    const openId = sessionStorage.getItem('openFeedbackId');
    if (openId) {
      sessionStorage.removeItem('openFeedbackId');
      openDetail(openId);
    }
  };
})();
