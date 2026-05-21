(function() {
  'use strict';

  const API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');

  let tableId = null;
  let expensesData = { crew: [], flights: [], accommodation: [], misc: [], reimbursements: [] };
  let hasUnsavedChanges = false;
  let canEdit = false;

  function getToken() {
    return localStorage.getItem('token');
  }

  function authHeaders() {
    return { Authorization: getToken(), 'Content-Type': 'application/json' };
  }

  function fmtCurrency(n) {
    const v = parseFloat(n) || 0;
    return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtDateSubmitted(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).includes('T') ? iso : `${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function parseNum(v) {
    const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function markUnsaved() {
    hasUnsavedChanges = true;
    const el = document.getElementById('saveStatus');
    if (el) {
      el.textContent = 'Unsaved changes';
      el.className = 'expenses-save-status unsaved';
    }
  }

  function markSaved() {
    hasUnsavedChanges = false;
    const el = document.getElementById('saveStatus');
    if (el) {
      el.textContent = 'All changes saved';
      el.className = 'expenses-save-status saved';
    }
  }

  function markSaving() {
    const el = document.getElementById('saveStatus');
    if (el) {
      el.textContent = 'Saving...';
      el.className = 'expenses-save-status saving';
    }
  }

  function recalcCrewRow(row) {
    const hours = Math.round(parseNum(row.hours) * 100) / 100;
    const rate = parseNum(row.rate);
    const additionalCost = parseNum(row.additionalCost);
    const labor = Math.round(hours * rate * 100) / 100;
    row.hours = hours;
    row.rate = rate;
    row.additionalCost = additionalCost;
    row.total = Math.round((labor + additionalCost) * 100) / 100;
    return row;
  }

  function computeTotals() {
    expensesData.crew.forEach(recalcCrewRow);

    const crewTotal = expensesData.crew.reduce((s, r) => s + parseNum(r.total), 0);
    const flightsTotal = expensesData.flights.reduce((s, r) => s + parseNum(r.cost), 0);
    const accommodationTotal = expensesData.accommodation.reduce((s, r) => s + parseNum(r.cost), 0);
    const miscTotal = expensesData.misc.reduce((s, r) => s + parseNum(r.cost), 0);
    const reimbursementsTotal = (expensesData.reimbursements || []).reduce((s, r) => s + parseNum(r.amount), 0);
    const grand = crewTotal + flightsTotal + accommodationTotal + miscTotal + reimbursementsTotal;

    document.getElementById('crewSectionTotal').textContent = fmtCurrency(crewTotal);
    document.getElementById('flightsSectionTotal').textContent = fmtCurrency(flightsTotal);
    document.getElementById('accommodationSectionTotal').textContent = fmtCurrency(accommodationTotal);
    document.getElementById('reimbursementsSectionTotal').textContent = fmtCurrency(reimbursementsTotal);
    document.getElementById('miscSectionTotal').textContent = fmtCurrency(miscTotal);
    document.getElementById('grandTotal').textContent = fmtCurrency(grand);
  }

  function deleteBtnHtml() {
    return `<button type="button" class="expenses-delete-row" title="Remove row"><span class="material-symbols-outlined">delete</span></button>`;
  }

  function actionCellHtml(row) {
    if (row && row.imported) return '<td class="action-col"></td>';
    return `<td class="action-col">${deleteBtnHtml()}</td>`;
  }

  /** Read-only for imported rows except fields listed in editableWhenImported */
  function expenseCell(field, value, row, editableWhenImported) {
    const imported = !!row.imported;
    const canEdit = !imported || editableWhenImported.includes(field);
    const v = value == null || value === '' ? '' : String(value);

    if (!canEdit) {
      const text = v || '—';
      return `<span class="expenses-readonly" data-field="${field}">${escAttr(text)}</span>`;
    }

    const isNum = ['hours', 'rate', 'additionalCost', 'cost', 'amount'].includes(field);
    if (isNum) {
      return `<input type="text" inputmode="decimal" data-field="${field}" class="num-input" value="${escAttr(v)}">`;
    }
    if (field === 'date' || field === 'checkIn' || field === 'checkOut') {
      return `<input type="${/^\d{4}-\d{2}-\d{2}$/.test(v) ? 'date' : 'text'}" data-field="${field}" value="${escAttr(v)}">`;
    }
    return `<input type="text" data-field="${field}" value="${escAttr(v)}">`;
  }

  function rowImportedAttrs(row) {
    const attrs = [row.imported ? 'data-imported="true"' : 'data-imported="false"'];
    if (row.sourceKey) attrs.push(`data-source-key="${escAttr(row.sourceKey)}"`);
    if (row.sourceId) attrs.push(`data-source-id="${escAttr(row.sourceId)}"`);
    if (row.sourceIndex != null && row.sourceIndex !== '') {
      attrs.push(`data-source-index="${row.sourceIndex}"`);
    }
    return attrs.join(' ');
  }

  function renderCrew() {
    const tbody = document.getElementById('crewTableBody');
    const crewEditable = ['rate', 'additionalCost', 'notes'];
    tbody.innerHTML = expensesData.crew.map((row, i) => `
      <tr data-section="crew" data-index="${i}" ${rowImportedAttrs(row)}>
        <td>${expenseCell('name', row.name, row, crewEditable)}</td>
        <td>${expenseCell('role', row.role, row, crewEditable)}</td>
        <td>${expenseCell('hours', row.hours, row, crewEditable)}</td>
        <td>${expenseCell('rate', row.rate, row, crewEditable)}</td>
        <td>${expenseCell('additionalCost', row.additionalCost ?? 0, row, crewEditable)}</td>
        <td class="computed-cell" data-field="total">${fmtCurrency(row.total)}</td>
        <td>${expenseCell('notes', row.notes, row, crewEditable)}</td>
        ${actionCellHtml(row)}
      </tr>
    `).join('');
  }

  function renderFlightCostCell(row) {
    if (row.imported) {
      return `<td><span class="expenses-readonly expenses-amount" data-field="cost">${escAttr(fmtCurrency(row.cost))}</span></td>`;
    }
    return `<td>${expenseCell('cost', row.cost, row, ['cost'])}</td>`;
  }

  function renderFlights() {
    const tbody = document.getElementById('flightsTableBody');
    const flightEditable = ['notes'];
    tbody.innerHTML = expensesData.flights.map((row, i) => `
      <tr data-section="flights" data-index="${i}" ${rowImportedAttrs(row)}>
        <td>${expenseCell('passengerName', row.passengerName, row, flightEditable)}</td>
        <td>${expenseCell('date', row.date, row, flightEditable)}</td>
        <td>${expenseCell('airline', row.airline, row, flightEditable)}</td>
        <td>${expenseCell('refNumber', row.refNumber, row, flightEditable)}</td>
        ${renderFlightCostCell(row)}
        <td>${expenseCell('notes', row.notes, row, flightEditable)}</td>
        ${actionCellHtml(row)}
      </tr>
    `).join('');
  }

  function renderAccommodation() {
    const tbody = document.getElementById('accommodationTableBody');
    const accEditable = ['cost', 'notes'];
    tbody.innerHTML = expensesData.accommodation.map((row, i) => `
      <tr data-section="accommodation" data-index="${i}" ${rowImportedAttrs(row)}>
        <td>${expenseCell('name', row.name, row, accEditable)}</td>
        <td>${expenseCell('checkIn', row.checkIn, row, accEditable)}</td>
        <td>${expenseCell('checkOut', row.checkOut, row, accEditable)}</td>
        <td>${expenseCell('hotel', row.hotel, row, accEditable)}</td>
        <td>${expenseCell('refNumber', row.refNumber, row, accEditable)}</td>
        <td>${expenseCell('cost', row.cost, row, accEditable)}</td>
        <td>${expenseCell('notes', row.notes, row, accEditable)}</td>
        ${actionCellHtml(row)}
      </tr>
    `).join('');
  }

  function renderReimbursements() {
    const tbody = document.getElementById('reimbursementsTableBody');
    const rows = expensesData.reimbursements || [];
    if (!rows.length) {
      tbody.innerHTML = `
        <tr class="expenses-empty-row">
          <td colspan="5">No approved reimbursements for this event. Use Refresh from Sources after approvals.</td>
        </tr>`;
      return;
    }
    tbody.innerHTML = rows.map((row, i) => `
      <tr data-section="reimbursements" data-index="${i}" ${rowImportedAttrs(row)}>
        <td>${expenseCell('submittedBy', row.submittedBy, row, [])}</td>
        <td>${expenseCell('dateSubmitted', fmtDateSubmitted(row.dateSubmitted), row, [])}</td>
        <td class="expenses-desc-cell">${expenseCell('description', row.description, row, [])}</td>
        <td><span class="expenses-readonly expenses-amount" data-field="amount">${escAttr(fmtCurrency(row.amount))}</span></td>
        ${actionCellHtml(row)}
      </tr>
    `).join('');
  }

  function renderMisc() {
    const tbody = document.getElementById('miscTableBody');
    tbody.innerHTML = expensesData.misc.map((row, i) => `
      <tr data-section="misc" data-index="${i}">
        <td><input type="text" data-field="item" value="${escAttr(row.item)}"></td>
        <td><input type="text" data-field="description" value="${escAttr(row.description)}"></td>
        <td><input type="text" inputmode="decimal" data-field="cost" class="num-input" value="${escAttr(row.cost)}"></td>
        <td><input type="text" data-field="notes" value="${escAttr(row.notes)}"></td>
        <td class="action-col">${deleteBtnHtml()}</td>
      </tr>
    `).join('');
  }

  function renderAll() {
    renderCrew();
    renderFlights();
    renderAccommodation();
    renderReimbursements();
    renderMisc();
    computeTotals();
  }

  function collectFromDom() {
    function readSection(section, editableFields) {
      const rows = document.querySelectorAll(`tr[data-section="${section}"]`);
      return Array.from(rows).map(tr => {
        const index = parseInt(tr.dataset.index, 10);
        const base = { ...(expensesData[section][index] || {}) };
        editableFields.forEach(f => {
          const input = tr.querySelector(`input[data-field="${f}"]`);
          if (input) base[f] = input.value;
        });
        base.imported = tr.dataset.imported === 'true';
        if (tr.dataset.sourceId) base.sourceId = tr.dataset.sourceId;
        if (tr.dataset.sourceKey) base.sourceKey = tr.dataset.sourceKey;
        if (tr.dataset.sourceIndex !== undefined && tr.dataset.sourceIndex !== '') {
          base.sourceIndex = parseInt(tr.dataset.sourceIndex, 10);
        }
        return base;
      });
    }

    expensesData.crew = readSection('crew', ['rate', 'additionalCost', 'notes']).map(r => {
      recalcCrewRow(r);
      return r;
    });
    expensesData.flights = Array.from(document.querySelectorAll('tr[data-section="flights"]')).map(tr => {
      const index = parseInt(tr.dataset.index, 10);
      const base = { ...(expensesData.flights[index] || {}) };
      const notesInput = tr.querySelector('input[data-field="notes"]');
      if (notesInput) base.notes = notesInput.value;
      if (tr.dataset.imported !== 'true') {
        const costInput = tr.querySelector('input[data-field="cost"]');
        if (costInput) base.cost = costInput.value;
      }
      base.imported = tr.dataset.imported === 'true';
      if (tr.dataset.sourceKey) base.sourceKey = tr.dataset.sourceKey;
      if (tr.dataset.sourceIndex !== undefined && tr.dataset.sourceIndex !== '') {
        base.sourceIndex = parseInt(tr.dataset.sourceIndex, 10);
      }
      return base;
    });
    expensesData.accommodation = readSection('accommodation', ['cost', 'notes']);
    expensesData.reimbursements = readSection('reimbursements', []);
    expensesData.misc = readSection('misc', ['item', 'description', 'cost', 'notes']);
  }

  function onTableInput(e) {
    const tr = e.target.closest('tr[data-section]');
    if (!tr) return;
    const section = tr.dataset.section;
    const index = parseInt(tr.dataset.index, 10);
    const field = e.target.dataset.field;
    if (!field || !expensesData[section] || !expensesData[section][index]) return;

    expensesData[section][index][field] = e.target.value;

    if (section === 'crew' && (field === 'hours' || field === 'rate' || field === 'additionalCost')) {
      recalcCrewRow(expensesData.crew[index]);
      const totalCell = tr.querySelector('[data-field="total"]');
      if (totalCell) totalCell.textContent = fmtCurrency(expensesData.crew[index].total);
    }

    markUnsaved();
    computeTotals();
  }

  function onDeleteRow(btn) {
    const tr = btn.closest('tr[data-section]');
    if (!tr) return;
    if (tr.dataset.imported === 'true') return;
    const section = tr.dataset.section;
    const index = parseInt(tr.dataset.index, 10);
    if (expensesData[section]?.[index]?.imported) return;
    expensesData[section].splice(index, 1);
    markUnsaved();
    renderAll();
  }

  function addRow(section) {
    collectFromDom();
    if (section === 'crew') {
      expensesData.crew.push({
        name: '', role: '', hours: 0, rate: 0, additionalCost: 0, total: 0, notes: '', imported: false
      });
    } else if (section === 'flights') {
      expensesData.flights.push({
        passengerName: '', date: '', airline: '', refNumber: '', cost: 0, notes: '', imported: false
      });
    } else if (section === 'accommodation') {
      expensesData.accommodation.push({
        name: '', checkIn: '', checkOut: '', hotel: '', refNumber: '', cost: 0, notes: '', imported: false
      });
    } else if (section === 'misc') {
      expensesData.misc.push({ item: '', description: '', cost: 0, notes: '' });
    }
    markUnsaved();
    renderAll();
  }

  async function checkPermissions(id) {
    const token = getToken();
    if (!token) return false;
    let userId, userRole;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.id || payload._id || payload.userId;
      userRole = payload.role;
    } catch {
      return false;
    }
    const res = await fetch(`${API_BASE}/api/tables/${id}`, { headers: { Authorization: token } });
    if (!res.ok) return false;
    const table = await res.json();
    const isAdmin = userRole === 'admin';
    const isOwner = table.owners && table.owners.includes(userId);
    return isAdmin || isOwner;
  }

  async function loadExpenses(id) {
    const res = await fetch(`${API_BASE}/api/tables/${id}/expenses`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load expenses');
    const data = await res.json();
    expensesData = data.expenses || expensesData;
    if (!Array.isArray(expensesData.reimbursements)) expensesData.reimbursements = [];
    const subtitle = document.getElementById('expensesEventSubtitle');
    if (subtitle && data.title) subtitle.textContent = data.title;
    renderAll();
    markSaved();
  }

  async function saveExpenses() {
    collectFromDom();
    markSaving();
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/expenses`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ expenses: expensesData })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      markSaved();
    } catch (err) {
      alert(err.message || 'Failed to save expenses');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function syncFromSources() {
    if (!confirm('Refresh crew, flights, accommodation, and approved reimbursements from their sources? Manual rows in those sections will be updated; misc items are kept.')) {
      return;
    }
    collectFromDom();
    markSaving();
    try {
      await fetch(`${API_BASE}/api/tables/${tableId}/expenses`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ expenses: expensesData })
      });
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/expenses/sync`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      expensesData = data.expenses;
      renderAll();
      markUnsaved();
    } catch (err) {
      alert(err.message || 'Failed to sync');
    }
  }

  function setupSidebar() {
    const sidebar = document.getElementById('expensesSidebar');
    const overlay = document.getElementById('expensesSidebarOverlay');
    const menuBtn = document.getElementById('mobileMenuBtn');

    if (menuBtn) {
      menuBtn.onclick = () => {
        sidebar?.classList.add('open');
        overlay?.classList.add('visible', 'show');
        document.body.style.overflow = 'hidden';
      };
    }
    if (overlay) {
      overlay.onclick = () => {
        sidebar?.classList.remove('open');
        overlay.classList.remove('visible', 'show');
        document.body.style.overflow = '';
      };
    }
    sidebar?.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 1024) {
          sidebar?.classList.remove('open');
          overlay?.classList.remove('visible', 'show');
          document.body.style.overflow = '';
        }
      });
    });
  }

  function loadSidebarUser() {
    const token = getToken();
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const nameEl = document.getElementById('sidebarUserName');
      if (nameEl) nameEl.textContent = payload.fullName || payload.email || 'User';
    } catch (_) { /* ignore */ }
  }

  function setupListeners() {
    const content = document.getElementById('expensesContent');
    content.addEventListener('input', onTableInput);
    content.addEventListener('click', (e) => {
      const del = e.target.closest('.expenses-delete-row');
      if (del) onDeleteRow(del);
    });

    document.querySelectorAll('.expenses-add-row').forEach(btn => {
      btn.addEventListener('click', () => addRow(btn.dataset.section));
    });

    document.getElementById('saveBtn')?.addEventListener('click', saveExpenses);
    document.getElementById('syncBtn')?.addEventListener('click', syncFromSources);
  }

  function showAccessDenied() {
    document.getElementById('expensesContent').style.display = 'none';
    document.getElementById('accessDenied').style.display = 'flex';
    document.querySelector('.expenses-header-actions')?.style.setProperty('display', 'none');
  }

  window.initPage = async function(eventId) {
    tableId = eventId || localStorage.getItem('eventId');
    if (!tableId) {
      alert('Event ID missing.');
      return;
    }
    localStorage.setItem('eventId', tableId);

    setupSidebar();
    loadSidebarUser();

    if (typeof window.populateSidebarEventInfo === 'function') {
      await window.populateSidebarEventInfo(tableId);
    }

    canEdit = await checkPermissions(tableId);
    if (!canEdit) {
      showAccessDenied();
      return;
    }

    setupListeners();
    try {
      await loadExpenses(tableId);
    } catch (err) {
      console.error(err);
      alert('Failed to load expenses');
    }
  };
})();
