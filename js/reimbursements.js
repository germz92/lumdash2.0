(function() {
  'use strict';

  const API_BASE = window.API_BASE || '';
  function getToken() { return `Bearer ${localStorage.getItem('token')}`; }

  let allRequests = [];
  let filteredRequests = [];
  let currentStatus = 'all';
  let currentSearch = '';
  let currentEventFilter = '';
  let currentUserFilter = '';
  let currentDetail = null;
  let sortColumn = 'dateSubmitted';
  let sortDir = 'desc';
  let viewMode = 'table';
  const MOBILE_BREAKPOINT = 768;

  function fmtDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtCurrency(amount) {
    if (amount == null) return '$0.00';
    return '$' + Number(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function statusBadge(status) {
    const labels = { submitted: 'Pending', approved: 'Approved', rejected: 'Rejected' };
    return `<span class="reimb-status ${status}">${labels[status] || status}</span>`;
  }

  function categoryBadge(cat) {
    return `<span class="reimb-category-badge ${cat || 'misc'}">${cat || 'misc'}</span>`;
  }

  // ---- Fetch data ----
  async function loadRequests() {
    try {
      const res = await fetch(`${API_BASE}/api/reimbursements`, {
        headers: { Authorization: getToken() }
      });
      if (!res.ok) throw new Error('Failed to load');
      allRequests = await res.json();
      applyFilters();
    } catch (err) {
      console.error('Failed to load reimbursements:', err);
      document.getElementById('reimbContainer').innerHTML =
        '<div class="reimb-empty"><span class="material-symbols-outlined">error</span><p>Failed to load reimbursement requests</p></div>';
    }
  }

  async function loadFilters() {
    try {
      const res = await fetch(`${API_BASE}/api/reimbursements-filters`, {
        headers: { Authorization: getToken() }
      });
      if (!res.ok) return;
      const data = await res.json();

      const eventSel = document.getElementById('filterEvent');
      const userSel = document.getElementById('filterUser');

      (data.events || []).forEach(e => {
        const opt = document.createElement('option');
        opt.value = e;
        opt.textContent = e;
        eventSel.appendChild(opt);
      });

      (data.users || []).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = u;
        userSel.appendChild(opt);
      });
    } catch (err) {
      console.error('Failed to load filters:', err);
    }
  }

  // ---- Filter & render ----
  function applyFilters() {
    let list = allRequests;

    if (currentStatus !== 'all') {
      list = list.filter(r => r.status === currentStatus);
    }

    if (currentEventFilter) {
      list = list.filter(r => r.eventName === currentEventFilter);
    }

    if (currentUserFilter) {
      list = list.filter(r => r.userName === currentUserFilter);
    }

    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      list = list.filter(r =>
        (r.userName || '').toLowerCase().includes(q) ||
        (r.eventName || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.userEmail || '').toLowerCase().includes(q)
      );
    }

    // Client-side sort
    list.sort((a, b) => {
      let va, vb;
      switch (sortColumn) {
        case 'userName':
          va = (a.userName || '').toLowerCase();
          vb = (b.userName || '').toLowerCase();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'eventName':
          va = (a.eventName || '').toLowerCase();
          vb = (b.eventName || '').toLowerCase();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'totalAmount':
          va = a.totalAmount || 0;
          vb = b.totalAmount || 0;
          return sortDir === 'asc' ? va - vb : vb - va;
        case 'status':
          va = a.status || '';
          vb = b.status || '';
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'dateSubmitted':
        default:
          va = a.dateSubmitted ? new Date(a.dateSubmitted).getTime() : 0;
          vb = b.dateSubmitted ? new Date(b.dateSubmitted).getTime() : 0;
          return sortDir === 'asc' ? va - vb : vb - va;
      }
    });

    filteredRequests = list;
    render();
  }

  function sortIcon(col) {
    if (sortColumn !== col) return '<span class="sort-icon material-symbols-outlined">unfold_more</span>';
    const icon = sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward';
    return `<span class="sort-icon active material-symbols-outlined">${icon}</span>`;
  }

  function toggleSort(col) {
    if (sortColumn === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortColumn = col;
      sortDir = col === 'totalAmount' ? 'desc' : 'asc';
    }
    applyFilters();
  }

  function render() {
    const container = document.getElementById('reimbContainer');
    const countEl = document.getElementById('reimbCount');

    countEl.textContent = `${filteredRequests.length} request${filteredRequests.length !== 1 ? 's' : ''}`;

    if (filteredRequests.length === 0) {
      container.innerHTML = `
        <div class="reimb-empty">
          <span class="material-symbols-outlined">receipt_long</span>
          <p>No reimbursement requests found</p>
        </div>`;
      return;
    }

    if (viewMode === 'cards') {
      renderCards(container);
    } else {
      renderTable(container);
    }
  }

  function renderTable(container) {
    container.innerHTML = `
      <div class="reimb-table-wrap">
        <table class="reimb-table">
          <thead>
            <tr>
              <th data-sort="userName">User ${sortIcon('userName')}</th>
              <th data-sort="eventName">Event ${sortIcon('eventName')}</th>
              <th>Description</th>
              <th data-sort="totalAmount">Amount ${sortIcon('totalAmount')}</th>
              <th data-sort="status">Status ${sortIcon('status')}</th>
              <th data-sort="dateSubmitted">Date Submitted ${sortIcon('dateSubmitted')}</th>
            </tr>
          </thead>
          <tbody>
            ${filteredRequests.map(r => `
              <tr data-id="${r._id}">
                <td>${r.userName || '—'}</td>
                <td>${r.eventName || '—'}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${r.description || '—'}</td>
                <td class="amount-cell">${fmtCurrency(r.totalAmount)}</td>
                <td>${statusBadge(r.status)}</td>
                <td>${fmtDate(r.dateSubmitted)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

    container.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => toggleSort(th.dataset.sort));
    });

    container.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => openDetail(row.dataset.id));
    });
  }

  function renderCards(container) {
    container.innerHTML = `
      <div class="reimb-cards">
        ${filteredRequests.map(r => `
          <div class="reimb-card" data-id="${r._id}">
            <div class="reimb-card-top">
              <div class="reimb-card-user">${r.userName || '—'}</div>
              ${statusBadge(r.status)}
            </div>
            <div class="reimb-card-event">${r.eventName || '—'}</div>
            ${r.description ? `<div class="reimb-card-desc">${r.description}</div>` : ''}
            <div class="reimb-card-bottom">
              <span class="reimb-card-amount">${fmtCurrency(r.totalAmount)}</span>
              <span class="reimb-card-date">${fmtDate(r.dateSubmitted)}</span>
            </div>
          </div>
        `).join('')}
      </div>`;

    container.querySelectorAll('.reimb-card[data-id]').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
  }

  function setViewMode(mode) {
    viewMode = mode;
    document.querySelectorAll('.reimb-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
    render();
  }

  function checkResponsiveView() {
    const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
    const toggle = document.getElementById('viewToggle');
    if (isMobile) {
      if (viewMode !== 'cards') setViewMode('cards');
      if (toggle) toggle.style.display = 'none';
    } else {
      if (toggle) toggle.style.display = '';
    }
  }

  // ---- Detail modal ----
  async function openDetail(id) {
    const modal = document.getElementById('reimbModal');
    const body = document.getElementById('modalBody');
    const footer = document.getElementById('modalFooter');
    modal.classList.add('show');
    body.innerHTML = '<p style="text-align:center;padding:24px;color:var(--text-muted);">Loading...</p>';
    footer.innerHTML = '';

    try {
      const res = await fetch(`${API_BASE}/api/reimbursements/${id}`, {
        headers: { Authorization: getToken() }
      });
      if (!res.ok) throw new Error('Failed');
      currentDetail = await res.json();
      renderDetail();
    } catch (err) {
      body.innerHTML = '<p style="text-align:center;color:var(--accent-red);">Failed to load request</p>';
    }
  }

  function renderDetail() {
    const r = currentDetail;
    const body = document.getElementById('modalBody');
    const footer = document.getElementById('modalFooter');

    document.getElementById('modalTitle').textContent = `${r.userName}'s Reimbursement`;

    let itemsHtml = '';
    if (r.items && r.items.length > 0) {
      itemsHtml = `
        <div class="reimb-items-title">
          <span class="material-symbols-outlined" style="font-size:18px;">receipt</span>
          Line Items (${r.items.length})
        </div>
        <table class="reimb-items-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Notes</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            ${r.items.map(item => `
              <tr>
                <td>${fmtDate(item.date)}</td>
                <td>${categoryBadge(item.category)}</td>
                <td class="item-amount">${fmtCurrency(item.amount)}</td>
                <td style="max-width:180px;white-space:normal;word-break:break-word;">${item.notes || '—'}</td>
                <td>${item.attachmentUrl
                  ? `<a href="${item.attachmentUrl}" target="_blank" rel="noopener" class="reimb-receipt-link">${item.attachmentName || 'View'}</a>`
                  : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    }

    body.innerHTML = `
      <div class="reimb-info-grid">
        <div class="reimb-info-item">
          <span class="reimb-info-label">Submitted By</span>
          <span class="reimb-info-value">${r.userName || '—'}</span>
        </div>
        <div class="reimb-info-item">
          <span class="reimb-info-label">Email</span>
          <span class="reimb-info-value">${r.userEmail || '—'}</span>
        </div>
        <div class="reimb-info-item">
          <span class="reimb-info-label">Event</span>
          <span class="reimb-info-value">${r.eventName || '—'}</span>
        </div>
        <div class="reimb-info-item">
          <span class="reimb-info-label">Total Amount</span>
          <span class="reimb-info-value" style="font-size:1.1rem;font-weight:700;">${fmtCurrency(r.totalAmount)}</span>
        </div>
        <div class="reimb-info-item">
          <span class="reimb-info-label">Status</span>
          <span class="reimb-info-value">${statusBadge(r.status)}</span>
        </div>
        <div class="reimb-info-item">
          <span class="reimb-info-label">Date Submitted</span>
          <span class="reimb-info-value">${fmtDate(r.dateSubmitted)}</span>
        </div>
        <div class="reimb-info-item full-width">
          <span class="reimb-info-label">Description</span>
          <span class="reimb-info-value">${r.description || '—'}</span>
        </div>
      </div>
      ${itemsHtml}
      <div class="reimb-reject-area" id="rejectArea">
        <label>Reason for Rejection</label>
        <textarea id="rejectNotes" placeholder="Explain why this request is being rejected..."></textarea>
        <button class="reimb-btn reimb-btn-reject" id="confirmRejectBtn">Confirm Rejection</button>
      </div>`;

    // Footer
    if (r.status === 'submitted') {
      footer.innerHTML = `
        <div class="review-info"></div>
        <button class="reimb-btn reimb-btn-reject" id="rejectBtn">Reject</button>
        <button class="reimb-btn reimb-btn-approve" id="approveBtn">Approve</button>`;

      document.getElementById('approveBtn').addEventListener('click', () => approveRequest(r._id));
      document.getElementById('rejectBtn').addEventListener('click', () => {
        document.getElementById('rejectArea').classList.toggle('show');
      });
      document.getElementById('confirmRejectBtn').addEventListener('click', () => rejectRequest(r._id));
    } else if (r.status === 'approved' || r.status === 'rejected') {
      footer.innerHTML = `
        <div class="review-info">
          ${r.reviewedAt ? `Reviewed on ${fmtDate(r.reviewedAt)}` : ''}
          ${r.reviewNotes ? ` — "${r.reviewNotes}"` : ''}
        </div>`;
    } else {
      footer.innerHTML = '';
    }
  }

  async function approveRequest(id) {
    try {
      const res = await fetch(`${API_BASE}/api/reimbursements/${id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: getToken() },
        body: JSON.stringify({ reviewNotes: '' })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to approve');
        return;
      }
      closeModal();
      loadRequests();
    } catch (err) {
      console.error(err);
      alert('Failed to approve request');
    }
  }

  async function rejectRequest(id) {
    const notes = document.getElementById('rejectNotes').value.trim();
    if (!notes) {
      alert('Please provide a reason for rejection');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/reimbursements/${id}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: getToken() },
        body: JSON.stringify({ reviewNotes: notes })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to reject');
        return;
      }
      closeModal();
      loadRequests();
    } catch (err) {
      console.error(err);
      alert('Failed to reject request');
    }
  }

  function closeModal() {
    document.getElementById('reimbModal').classList.remove('show');
    currentDetail = null;
  }

  // ---- Event listeners ----
  function setupListeners() {
    document.getElementById('reimbModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('modalClose').addEventListener('click', closeModal);

    document.getElementById('reimbSearch').addEventListener('input', (e) => {
      currentSearch = e.target.value;
      applyFilters();
    });

    document.querySelectorAll('.reimb-status-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.reimb-status-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentStatus = tab.dataset.status;
        applyFilters();
      });
    });

    document.getElementById('filterEvent').addEventListener('change', (e) => {
      currentEventFilter = e.target.value;
      applyFilters();
    });

    document.getElementById('filterUser').addEventListener('change', (e) => {
      currentUserFilter = e.target.value;
      applyFilters();
    });

    document.querySelectorAll('.reimb-view-btn').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });

    window.addEventListener('resize', checkResponsiveView);
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
    // Inject dashboard sidebar
    const layoutContainer = document.getElementById('reimbPageLayout');

    if (layoutContainer && typeof window.injectDashboardSidebar === 'function') {
      await window.injectDashboardSidebar(layoutContainer, {
        position: 'prepend',
        activePage: 'reimbursements'
      });
    } else if (typeof window.initDashboardSidebar === 'function') {
      window.initDashboardSidebar();
    }

    setupMobileMenu();
    setupListeners();
    checkResponsiveView();
    await Promise.all([loadRequests(), loadFilters()]);
  };
})();
