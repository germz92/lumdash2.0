(function() {
  let tableId = null;
  let currentData = {};
  let editingSection = null;
  let cachedUsers = null;

  const API_BASE = window.API_BASE || 'http://localhost:3000';

  function getMapsUrl(text) {
    const encoded = encodeURIComponent(text);
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    return isApple
      ? `https://maps.apple.com/?q=${encoded}`
      : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  }

  function formatTime12h(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    if (isNaN(h)) return timeStr;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  async function fetchAllUsers() {
    if (cachedUsers) return cachedUsers;
    try {
      const res = await fetch(`${API_BASE}/api/users`, {
        headers: { Authorization: getToken() }
      });
      if (!res.ok) return [];
      const users = await res.json();
      users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      cachedUsers = users;
      return users;
    } catch (e) {
      return [];
    }
  }

  function setupUserAutocomplete(input, emailFieldKey) {
    const wrapper = input.parentElement;
    wrapper.style.position = 'relative';

    const dropdown = document.createElement('div');
    dropdown.className = 'suggestions-dropdown';
    wrapper.appendChild(dropdown);

    let selectedIndex = -1;

    function fillEmailField(email) {
      if (!emailFieldKey) return;
      const grid = input.closest('.exec-fields-grid') || input.closest('.section-body');
      if (!grid) return;
      const emailInput = grid.querySelector(`input[data-field="${emailFieldKey}"]`);
      if (emailInput) emailInput.value = email || '';
    }

    async function showSuggestions() {
      const users = await fetchAllUsers();
      const query = input.value.toLowerCase().trim();
      const filtered = query
        ? users.filter(u => (u.name || '').toLowerCase().includes(query))
        : users;

      if (filtered.length === 0) {
        dropdown.classList.remove('show');
        return;
      }

      dropdown.innerHTML = filtered.map(u => `
        <div class="suggestion-item" data-name="${(u.name || '').replace(/"/g, '&quot;')}" data-email="${(u.email || '').replace(/"/g, '&quot;')}">
          <span>${u.name || 'Unnamed'}</span>
          <span class="suggestion-email">${u.email || ''}</span>
        </div>
      `).join('');

      dropdown.classList.add('show');
      selectedIndex = -1;

      dropdown.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = item.dataset.name;
          fillEmailField(item.dataset.email);
          dropdown.classList.remove('show');
        });
      });
    }

    input.addEventListener('input', showSuggestions);
    input.addEventListener('focus', showSuggestions);

    input.addEventListener('blur', () => {
      setTimeout(() => dropdown.classList.remove('show'), 150);
    });

    input.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll('.suggestion-item');
      if (!dropdown.classList.contains('show') || items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        items.forEach((it, i) => it.classList.toggle('suggestion-active', i === selectedIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        items.forEach((it, i) => it.classList.toggle('suggestion-active', i === selectedIndex));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          input.value = items[selectedIndex].dataset.name;
          fillEmailField(items[selectedIndex].dataset.email);
          dropdown.classList.remove('show');
        }
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('show');
      }
    });
  }

  async function fetchData(id) {
    const res = await fetch(`${API_BASE}/api/tables/${id}/executive-summary`, {
      headers: { Authorization: getToken() }
    });
    if (!res.ok) throw new Error('Failed to load data');
    return res.json();
  }

  async function saveExecSummary(fields) {
    setSaveStatus('Saving...');
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/executive-summary`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getToken()
      },
      body: JSON.stringify(fields)
    });
    if (!res.ok) throw new Error('Failed to save');
    const result = await res.json();
    currentData.executiveSummary = result.executiveSummary;
    setSaveStatus('All changes saved');
    return result;
  }

  function setSaveStatus(text) {
    const el = document.getElementById('saveStatus');
    if (el) el.textContent = text;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return dateStr;
  }

  function statusBadge(value) {
    if (!value) return '—';
    let cls = '';
    switch (value) {
      case 'Yes': cls = 'yes'; break;
      case 'No': cls = 'no'; break;
      case 'Retainer Paid': cls = 'retainer'; break;
      case 'Needs Revision': cls = 'revision'; break;
    }
    return `<span class="status-badge ${cls}">${value}</span>`;
  }

  function renderLinkField(url) {
    if (!url) return '—';
    const display = url.length > 40 ? url.substring(0, 40) + '...' : url;
    return `<a href="${url}" target="_blank" rel="noopener">${display}</a>`;
  }

  // ---- Shared field rendering helpers ----
  function renderFieldsGrid(gridEl, fields, exec) {
    gridEl.innerHTML = fields.map(f => {
      let valueHtml;
      if (f.type === 'link') {
        valueHtml = renderLinkField(exec[f.key]);
      } else if (f.type === 'email') {
        const email = exec[f.key];
        valueHtml = email ? `<a href="mailto:${email}">${email}</a>` : '—';
      } else if (f.type === 'status') {
        valueHtml = statusBadge(exec[f.key]);
      } else {
        valueHtml = exec[f.key] || '—';
      }
      return `
        <div class="exec-field">
          <label>${f.label}</label>
          <span class="field-value ${(f.type === 'link' || f.type === 'email') ? 'field-link' : ''}" data-field="${f.key}">${valueHtml}</span>
        </div>`;
    }).join('');
  }

  function enterFieldsEdit(gridEl, fields, exec) {
    gridEl.innerHTML = fields.map(f => {
      let inputHtml;
      if (f.type === 'select') {
        const opts = f.options.map(o =>
          `<option value="${o}" ${exec[f.key] === o ? 'selected' : ''}>${o || '— Select —'}</option>`
        ).join('');
        inputHtml = `<select data-field="${f.key}">${opts}</select>`;
      } else {
        inputHtml = `<input type="text" data-field="${f.key}" value="${exec[f.key] || ''}" placeholder="${f.label}" autocomplete="off">`;
      }
      return `
        <div class="exec-field">
          <label>${f.label}</label>
          ${inputHtml}
        </div>`;
    }).join('');

    fields.filter(f => f.autocompleteUsers).forEach(f => {
      const input = gridEl.querySelector(`input[data-field="${f.key}"]`);
      if (input) setupUserAutocomplete(input, f.emailField);
    });
  }

  function collectFields(gridEl) {
    const data = {};
    gridEl.querySelectorAll('input, select').forEach(el => {
      data[el.dataset.field] = el.value;
    });
    return data;
  }

  // ---- Project Details ----
  const projectFields = [
    { key: 'accountManager', label: 'Account Manager' },
    { key: 'accountManagerEmail', label: 'Account Manager Email', type: 'email' },
    { key: 'projectManager', label: 'Project Manager' },
    { key: 'projectManagerEmail', label: 'Project Manager Email', type: 'email' },
    { key: 'contractLink', label: 'Contract Link', type: 'link' },
    { key: 'signed', label: 'Signed', type: 'status' },
    { key: 'invoiceLink', label: 'Invoice Link', type: 'link' },
    { key: 'paid', label: 'Paid', type: 'status' }
  ];

  const projectEditFields = [
    { key: 'accountManager', label: 'Account Manager', type: 'text', autocompleteUsers: true, emailField: 'accountManagerEmail' },
    { key: 'accountManagerEmail', label: 'Account Manager Email', type: 'text' },
    { key: 'projectManager', label: 'Project Manager', type: 'text', autocompleteUsers: true, emailField: 'projectManagerEmail' },
    { key: 'projectManagerEmail', label: 'Project Manager Email', type: 'text' },
    { key: 'contractLink', label: 'Contract Link', type: 'text' },
    { key: 'signed', label: 'Signed', type: 'select', options: ['', 'Yes', 'No', 'Needs Revision'] },
    { key: 'invoiceLink', label: 'Invoice Link', type: 'text' },
    { key: 'paid', label: 'Paid', type: 'select', options: ['', 'Yes', 'No', 'Retainer Paid', 'Needs Revision'] }
  ];

  function getProjectDetailsWithFallback() {
    const exec = { ...(currentData.executiveSummary || {}) };
    const general = currentData.general || {};
    if (!exec.contractLink && general.contractUrl) exec.contractLink = general.contractUrl;
    if (!exec.invoiceLink && general.invoiceUrl) exec.invoiceLink = general.invoiceUrl;
    return exec;
  }

  function renderProjectDetails() {
    const grid = document.getElementById('projectDetailsGrid');
    if (grid) renderFieldsGrid(grid, projectFields, getProjectDetailsWithFallback());
  }

  // ---- Client Info ----
  const clientFields = [
    { key: 'clientContact', label: 'Client Point of Contact' },
    { key: 'company', label: 'Company' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone Number' }
  ];

  const clientEditFields = [
    { key: 'clientContact', label: 'Client Point of Contact', type: 'text' },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    { key: 'phone', label: 'Phone Number', type: 'text' }
  ];

  function renderClientInfo() {
    const grid = document.getElementById('clientInfoGrid');
    if (grid) renderFieldsGrid(grid, clientFields, currentData.executiveSummary || {});
  }

  // ---- Overview ----
  function renderOverview() {
    const general = currentData.general || {};
    const loc = general.locations && general.locations.length > 0 ? general.locations[0] : {};

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val || '—';
    };

    set('overviewEventName', currentData.title);

    const locationName = loc.name || '';
    const addressVal = loc.address || '';

    const setMapLink = (id, text) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (text && text !== '—') {
        el.innerHTML = `<a href="${getMapsUrl(text)}" target="_blank" rel="noopener noreferrer" class="maps-link">${text} <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">open_in_new</span></a>`;
      } else {
        el.textContent = '—';
      }
    };

    set('overviewLocationName', locationName);
    setMapLink('overviewAddress', addressVal);

    const startStr = formatDate(general.start);
    const endStr = formatDate(general.end);
    const dateRange = startStr && endStr ? `${startStr} – ${endStr}` : startStr || endStr || '—';
    set('overviewEventDate', dateRange);
  }

  // ---- Crew ----
  function renderCrew() {
    const container = document.getElementById('crewByDate');
    if (!container) return;

    const rows = currentData.rows || [];
    if (rows.length === 0) {
      container.innerHTML = '';
      return;
    }

    const grouped = {};
    rows.forEach(r => {
      if (!r.name || r.name === 'TBD' || r.name.startsWith('__')) return;
      const date = r.date || 'Unassigned';
      if (!grouped[date]) grouped[date] = [];
      const role = (r.role && !r.role.startsWith('__')) ? `<span class="crew-role">${r.role}</span>` : '';
      grouped[date].push(`<span class="crew-member">${r.name}${role}</span>`);
    });

    const sortedDates = Object.keys(grouped).filter(d => grouped[d].length > 0).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return new Date(a) - new Date(b);
    });

    if (sortedDates.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = sortedDates.map(date => `
      <div class="crew-date-group">
        <div class="crew-date-label">${formatDate(date)}</div>
        <div class="crew-date-names">${grouped[date].join(', ')}</div>
      </div>
    `).join('');
  }

  // ---- Services ----
  function renderServices() {
    const list = document.getElementById('servicesList');
    if (!list) return;
    const services = (currentData.executiveSummary || {}).services || [];
    if (services.length === 0) {
      list.innerHTML = '<p class="empty-hint">No services added yet</p>';
      list.classList.remove('services-editing');
      return;
    }
    list.innerHTML = services.map(s => `
      <span class="service-tag">
        ${s}
        <button class="remove-service" data-service="${s}" title="Remove">
          <span class="material-symbols-outlined">close</span>
        </button>
      </span>
    `).join('');
  }

  function setupServicesEdit() {
    const editBtn = document.getElementById('editServicesBtn');
    const saveBtn = document.getElementById('saveServicesBtn');
    const editArea = document.getElementById('servicesEditArea');
    const list = document.getElementById('servicesList');
    const addBtn = document.getElementById('addServiceBtn');
    const dropdown = document.getElementById('serviceDropdown');

    editBtn.addEventListener('click', () => {
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
      editArea.style.display = 'block';
      list.classList.add('services-editing');
      bindServiceRemoveButtons();
    });

    saveBtn.addEventListener('click', async () => {
      const tags = list.querySelectorAll('.service-tag');
      const services = Array.from(tags).map(t => t.textContent.trim().replace(/close$/, '').trim());
      await saveExecSummary({ services });
      saveBtn.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      editArea.style.display = 'none';
      list.classList.remove('services-editing');
      renderServices();
    });

    addBtn.addEventListener('click', () => {
      const val = dropdown.value;
      if (!val) return;
      const existing = (currentData.executiveSummary || {}).services || [];
      if (existing.includes(val)) return;
      if (!currentData.executiveSummary) currentData.executiveSummary = {};
      if (!currentData.executiveSummary.services) currentData.executiveSummary.services = [];
      currentData.executiveSummary.services.push(val);
      renderServices();
      list.classList.add('services-editing');
      bindServiceRemoveButtons();
      dropdown.value = '';
    });
  }

  function bindServiceRemoveButtons() {
    document.querySelectorAll('.remove-service').forEach(btn => {
      btn.onclick = () => {
        const svc = btn.dataset.service;
        const services = (currentData.executiveSummary || {}).services || [];
        currentData.executiveSummary.services = services.filter(s => s !== svc);
        renderServices();
        const list = document.getElementById('servicesList');
        if (list) list.classList.add('services-editing');
        bindServiceRemoveButtons();
      };
    });
  }

  // ---- Travel & Accommodation (read-only) ----
  function transformFlightToRow(flight, passenger, isReturn) {
    const mainBooked = flight.bookedDetails || {};
    const returnBooked = flight.returnBookedDetails || {};
    const details = isReturn ? returnBooked : mainBooked;
    const fromCode = isReturn ? (flight.to?.code || '') : (flight.from?.code || '');
    const toCode = isReturn ? (flight.from?.code || '') : (flight.to?.code || '');
    const date = isReturn ? flight.returnDate : flight.departDate;
    return {
      date: date ? date.split('T')[0] : '',
      depart: details.departTime || '',
      arrive: details.arriveTime || '',
      name: passenger.name || '',
      airline: mainBooked.airline || '',
      fromTo: `${fromCode} → ${toCode}`,
      ref: mainBooked.confirmationCode || ''
    };
  }

  async function fetchBookedFlights() {
    if (!tableId) return [];
    try {
      const res = await fetch(`${API_BASE}/api/flights/booked?eventId=${encodeURIComponent(tableId)}`, {
        headers: { Authorization: getToken() }
      });
      if (!res.ok) return [];
      const flights = await res.json();
      const rows = [];
      flights.forEach(flight => {
        (flight.passengers || []).forEach(p => {
          rows.push(transformFlightToRow(flight, p, false));
          if (flight.tripType === 'roundtrip' && flight.returnBookedDetails) {
            rows.push(transformFlightToRow(flight, p, true));
          }
        });
      });
      return rows;
    } catch (e) {
      return [];
    }
  }

  async function renderTravel() {
    const container = document.getElementById('execTravelContent');
    if (!container) return;

    const bookedFlights = await fetchBookedFlights();
    const manualTravel = currentData.travel || [];
    const travel = [...bookedFlights, ...manualTravel].sort((a, b) => {
      return (a.date || '9999').localeCompare(b.date || '9999');
    });
    const accommodation = currentData.accommodation || [];

    if (travel.length === 0 && accommodation.length === 0) {
      container.innerHTML = '<p class="empty-hint">No travel or accommodation entries yet</p>';
      return;
    }

    let html = '';

    if (travel.length > 0) {
      html += `
        <div>
          <div class="exec-travel-section-label">
            <span class="material-symbols-outlined">flight</span> Travel
          </div>
          <div class="exec-travel-scroll">
            <table class="exec-travel-table">
              <thead>
                <tr><th>Date</th><th>Depart</th><th>Arrive</th><th>Name</th><th>Airline</th><th>From/To</th><th>Ref</th></tr>
              </thead>
              <tbody>
                ${travel.map(t => `
                  <tr>
                    <td>${formatDate(t.date)}</td>
                    <td>${formatTime12h(t.depart || t.time) || '—'}</td>
                    <td>${formatTime12h(t.arrive) || '—'}</td>
                    <td>${t.name || '—'}</td>
                    <td>${t.airline || '—'}</td>
                    <td>${t.fromTo || '—'}</td>
                    <td>${t.ref || '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    if (accommodation.length > 0) {
      html += `
        <div>
          <div class="exec-travel-section-label">
            <span class="material-symbols-outlined">hotel</span> Accommodation
          </div>
          <div class="exec-travel-scroll">
            <table class="exec-travel-table">
              <thead>
                <tr><th>Check-In</th><th>Check-Out</th><th>Name</th><th>Hotel</th><th>Ref</th></tr>
              </thead>
              <tbody>
                ${accommodation.map(a => {
                  const hotelVal = a.hotel || '';
                  const hotelCell = hotelVal
                    ? `<a href="${getMapsUrl(hotelVal)}" target="_blank" rel="noopener noreferrer" class="maps-link">${hotelVal} <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">open_in_new</span></a>`
                    : '—';
                  return `
                  <tr>
                    <td>${formatDate(a.checkin)}</td>
                    <td>${formatDate(a.checkout)}</td>
                    <td>${a.name || '—'}</td>
                    <td>${hotelCell}</td>
                    <td>${a.ref || '—'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    container.innerHTML = html;
  }

  // ---- Deliverables ----
  function renderDeliverables(editing) {
    const tbody = document.getElementById('deliverablesBody');
    const emptyEl = document.getElementById('deliverablesEmpty');
    const editActions = document.getElementById('deliverablesEditActions');
    if (!tbody) return;

    const deliverables = (currentData.executiveSummary || {}).deliverables || [];

    if (deliverables.length === 0 && !editing) {
      tbody.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (editActions) editActions.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    if (editing) {
      if (editActions) editActions.style.display = 'block';
      tbody.innerHTML = deliverables.map((d, i) => `
        <tr>
          <td><input type="text" value="${d.item || ''}" data-idx="${i}" data-key="item" placeholder="Deliverable item"></td>
          <td class="date-col"><input type="date" value="${d.dueDate || ''}" data-idx="${i}" data-key="dueDate"></td>
          <td class="action-col">
            <button class="delete-row-btn" data-idx="${i}" title="Remove">
              <span class="material-symbols-outlined">close</span>
            </button>
          </td>
        </tr>
      `).join('');

      const table = document.getElementById('deliverablesTable');
      const thead = table.querySelector('thead tr');
      if (!thead.querySelector('.action-col')) {
        const th = document.createElement('th');
        th.className = 'action-col';
        thead.appendChild(th);
      }

      tbody.querySelectorAll('.delete-row-btn').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.idx);
          deliverables.splice(idx, 1);
          renderDeliverables(true);
        };
      });
    } else {
      const table = document.getElementById('deliverablesTable');
      const actionTh = table.querySelector('thead .action-col');
      if (actionTh) actionTh.remove();

      tbody.innerHTML = deliverables.map(d => `
        <tr>
          <td>${d.item || '—'}</td>
          <td class="date-col">${formatDate(d.dueDate)}</td>
        </tr>
      `).join('');
      if (editActions) editActions.style.display = 'none';
    }
  }

  function collectDeliverables() {
    const tbody = document.getElementById('deliverablesBody');
    const rows = tbody.querySelectorAll('tr');
    return Array.from(rows).map(row => {
      const itemInput = row.querySelector('input[data-key="item"]');
      const dateInput = row.querySelector('input[data-key="dueDate"]');
      return {
        item: itemInput ? itemInput.value : '',
        dueDate: dateInput ? dateInput.value : ''
      };
    }).filter(d => d.item.trim());
  }

  function setupDeliverables() {
    const editBtn = document.getElementById('editDeliverablesBtn');
    const saveBtn = document.getElementById('saveDeliverablesBtn');
    const addBtn = document.getElementById('addDeliverableBtn');

    editBtn.addEventListener('click', () => {
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
      renderDeliverables(true);
    });

    saveBtn.addEventListener('click', async () => {
      const deliverables = collectDeliverables();
      await saveExecSummary({ deliverables });
      saveBtn.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      renderDeliverables(false);
    });

    addBtn.addEventListener('click', () => {
      if (!currentData.executiveSummary) currentData.executiveSummary = {};
      if (!currentData.executiveSummary.deliverables) currentData.executiveSummary.deliverables = [];
      currentData.executiveSummary.deliverables.push({ item: '', dueDate: '' });
      renderDeliverables(true);
    });
  }

  // ---- Notes ----
  let notesQuill = null;

  function renderNotes() {
    const display = document.getElementById('notesDisplay');
    const notes = (currentData.executiveSummary || {}).notes || '';
    if (display) {
      if (notes && notes !== '<p><br></p>') {
        display.innerHTML = notes;
      } else {
        display.innerHTML = '<p class="empty-hint">No notes added yet</p>';
      }
    }
  }

  async function loadQuillEditor() {
    if (typeof Quill !== 'undefined') return;

    if (!document.querySelector('link[href*="quill.snow.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.quilljs.com/1.3.7/quill.snow.css';
      document.head.appendChild(link);
    }

    return new Promise((resolve, reject) => {
      if (typeof Quill !== 'undefined') { resolve(); return; }
      const existing = document.querySelector('script[src*="quill.min.js"]');
      if (existing) { existing.remove(); }
      const script = document.createElement('script');
      script.src = 'https://cdn.quilljs.com/1.3.7/quill.min.js';
      script.onload = () => setTimeout(() => {
        if (typeof Quill !== 'undefined') resolve();
        else reject(new Error('Quill not defined'));
      }, 100);
      script.onerror = () => reject(new Error('Failed to load Quill'));
      document.head.appendChild(script);
    });
  }

  function setupNotes() {
    const editBtn = document.getElementById('editNotesBtn');
    const saveBtn = document.getElementById('saveNotesBtn');
    const display = document.getElementById('notesDisplay');
    const editorWrapper = document.getElementById('notesEditorWrapper');

    editBtn.addEventListener('click', async () => {
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
      display.style.display = 'none';
      editorWrapper.style.display = 'block';

      try {
        await loadQuillEditor();
        if (!notesQuill) {
          notesQuill = new Quill('#notesQuillEditor', {
            theme: 'snow',
            placeholder: 'Add notes...',
            modules: {
              toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['link'],
                ['clean']
              ]
            }
          });
        }
        const notes = (currentData.executiveSummary || {}).notes || '';
        notesQuill.root.innerHTML = notes || '';
        notesQuill.focus();
      } catch (err) {
        console.error('Failed to load Quill:', err);
        editorWrapper.innerHTML = `<textarea id="notesFallback" class="notes-editor" placeholder="Add notes...">${(currentData.executiveSummary || {}).notes || ''}</textarea>`;
      }
    });

    saveBtn.addEventListener('click', async () => {
      let notes;
      if (notesQuill) {
        notes = notesQuill.root.innerHTML;
        if (notes === '<p><br></p>') notes = '';
      } else {
        const fallback = document.getElementById('notesFallback');
        notes = fallback ? fallback.value : '';
      }
      await saveExecSummary({ notes });
      saveBtn.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      editorWrapper.style.display = 'none';
      display.style.display = 'block';
      renderNotes();
    });
  }

  // ---- Project Details Edit ----
  function setupProjectDetails() {
    const editBtn = document.getElementById('editProjectBtn');
    const saveBtn = document.getElementById('saveProjectBtn');
    const grid = document.getElementById('projectDetailsGrid');

    editBtn.addEventListener('click', () => {
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
      const exec = getProjectDetailsWithFallback();
      enterFieldsEdit(grid, projectEditFields, exec);

      const checkbox = document.createElement('div');
      checkbox.className = 'exec-export-toggle';
      checkbox.innerHTML = `
        <label class="exec-checkbox-label">
          <input type="checkbox" id="hideContractInvoiceExport" ${exec.hideContractInvoiceFromExport ? 'checked' : ''}>
          <span>Hide contract and invoice from export</span>
        </label>`;
      grid.appendChild(checkbox);
    });

    saveBtn.addEventListener('click', async () => {
      const data = collectFields(grid);
      const hideCheckbox = document.getElementById('hideContractInvoiceExport');
      if (hideCheckbox) data.hideContractInvoiceFromExport = hideCheckbox.checked;
      await saveExecSummary(data);
      saveBtn.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      renderProjectDetails();
    });
  }

  function setupClientInfo() {
    const editBtn = document.getElementById('editClientBtn');
    const saveBtn = document.getElementById('saveClientBtn');
    const grid = document.getElementById('clientInfoGrid');

    editBtn.addEventListener('click', () => {
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
      enterFieldsEdit(grid, clientEditFields, currentData.executiveSummary || {});
    });

    saveBtn.addEventListener('click', async () => {
      const data = collectFields(grid);
      await saveExecSummary(data);
      saveBtn.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      renderClientInfo();
    });
  }

  // ---- Export PDF ----
  async function loadHtml2Pdf() {
    if (window.html2pdf) return;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load html2pdf'));
      document.head.appendChild(script);
    });
  }

  function buildPdfContent() {
    const exec = getProjectDetailsWithFallback();
    const general = currentData.general || {};
    const title = currentData.title || 'Untitled Event';

    const loc = general.locations && general.locations.length > 0 ? general.locations[0] : {};
    const startStr = formatDate(general.start);
    const endStr = formatDate(general.end);
    const dateRange = startStr && endStr && startStr !== '—' && endStr !== '—' ? `${startStr} – ${endStr}` : startStr || endStr || '—';

    const crewHtml = (() => {
      const rows = currentData.rows || [];
      const grouped = {};
      rows.forEach(r => {
        if (!r.name || r.name === 'TBD' || r.name.startsWith('__')) return;
        const date = r.date || 'Unassigned';
        if (!grouped[date]) grouped[date] = [];
        const role = (r.role && !r.role.startsWith('__')) ? ` — ${r.role}` : '';
        grouped[date].push(`${r.name}${role}`);
      });
      const dates = Object.keys(grouped).filter(d => grouped[d].length > 0).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return new Date(a) - new Date(b);
      });
      if (dates.length === 0) return '<p style="color:#999;font-style:italic;">No crew assigned</p>';
      return dates.map(d => `
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px;">${formatDate(d)}</div>
          ${grouped[d].map(member => `<div style="padding:4px 0;font-size:13px;color:#333;border-bottom:1px solid #f0f0f0;">${member}</div>`).join('')}
        </div>
      `).join('');
    })();

    const servicesHtml = (() => {
      const services = exec.services || [];
      if (services.length === 0) return '<span style="color:#999;font-style:italic;">None</span>';
      return services.map(s => `<div style="padding:5px 0;font-size:13px;color:#333;border-bottom:1px solid #f0f0f0;">${s}</div>`).join('');
    })();

    const travelContainer = document.getElementById('execTravelContent');
    const travelHtml = (() => {
      if (!travelContainer || travelContainer.querySelector('.empty-hint')) return '<p style="color:#999;font-style:italic;">No travel entries</p>';
      let html = '';
      travelContainer.querySelectorAll('.exec-travel-section-label').forEach(label => {
        const table = label.nextElementSibling;
        if (!table) return;
        html += `<div style="margin-bottom:10px;"><div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px;">${label.textContent.trim()}</div>`;
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        table.querySelectorAll('tr').forEach((tr, i) => {
          const tag = i === 0 ? 'th' : 'td';
          const cells = tr.querySelectorAll('th, td');
          html += '<tr>';
          cells.forEach(cell => {
            const style = i === 0
              ? 'padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;color:#555;font-size:10px;text-transform:uppercase;'
              : 'padding:6px 8px;text-align:left;border-bottom:1px solid #eee;color:#333;';
            html += `<${tag} style="${style}">${cell.textContent.trim()}</${tag}>`;
          });
          html += '</tr>';
        });
        html += '</table></div>';
      });
      return html || '<p style="color:#999;font-style:italic;">No travel entries</p>';
    })();

    const deliverablesHtml = (() => {
      const deliverables = exec.deliverables || [];
      if (deliverables.length === 0) return '<p style="color:#999;font-style:italic;">No deliverables</p>';
      let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
      html += '<tr><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;color:#555;font-size:10px;text-transform:uppercase;">Item</th><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #ddd;font-weight:600;color:#555;font-size:10px;text-transform:uppercase;">Due Date</th></tr>';
      deliverables.forEach(d => {
        html += `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#333;">${d.item || '—'}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;color:#333;">${formatDate(d.dueDate)}</td></tr>`;
      });
      html += '</table>';
      return html;
    })();

    const notesHtml = exec.notes && exec.notes !== '<p><br></p>' ? exec.notes : '<p style="color:#999;font-style:italic;">No notes</p>';

    function field(label, value) {
      return `<div style="margin-bottom:10px;overflow:hidden;"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">${label}</div><div style="font-size:13px;color:#222;word-break:break-word;overflow-wrap:break-word;">${value || '—'}</div></div>`;
    }

    function statusBadgePdf(value) {
      if (!value) return '—';
      const colors = { 'Yes': '#16a34a', 'No': '#dc2626', 'Retainer Paid': '#ca8a04', 'Needs Revision': '#ea580c' };
      const bg = { 'Yes': '#dcfce7', 'No': '#fee2e2', 'Retainer Paid': '#fef9c3', 'Needs Revision': '#ffedd5' };
      return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:500;color:${colors[value] || '#333'};background:${bg[value] || '#f3f4f6'};">${value}</span>`;
    }

    function emailField(label, email) {
      if (!email) return field(label, '—');
      return `<div style="margin-bottom:10px;overflow:hidden;"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">${label}</div><div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;"><a href="mailto:${email}" style="color:#2563eb;text-decoration:none;word-break:break-all;">${email}</a></div></div>`;
    }

    function linkField(label, url) {
      if (!url) return field(label, '—');
      const display = url.length > 35 ? url.substring(0, 35) + '...' : url;
      return `<div style="margin-bottom:10px;overflow:hidden;"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">${label}</div><div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;"><a href="${url}" style="color:#2563eb;text-decoration:none;word-break:break-all;">${display}</a></div></div>`;
    }

    function section(title, icon, content) {
      return `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;page-break-inside:avoid;overflow:hidden;">
          <div style="padding:12px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:8px;">
            <span style="font-size:14px;font-weight:600;color:#111;">${title}</span>
          </div>
          <div style="padding:14px 16px;overflow:hidden;">${content}</div>
        </div>`;
    }

    return `
      <div id="pdf-render" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;padding:24px;max-width:800px;margin:0 auto;">
        <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e5e7eb;">
          <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 4px 0;">${title}</h1>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Executive Summary</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${section('Project Details', 'business_center', `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;">
              ${field('Account Manager', exec.accountManager)}
              ${emailField('Account Manager Email', exec.accountManagerEmail)}
              ${field('Project Manager', exec.projectManager)}
              ${emailField('Project Manager Email', exec.projectManagerEmail)}
              ${exec.hideContractInvoiceFromExport ? '' : `
              ${linkField('Contract Link', exec.contractLink)}
              <div style="margin-bottom:10px;"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">Signed</div><div style="font-size:13px;">${statusBadgePdf(exec.signed)}</div></div>
              ${linkField('Invoice Link', exec.invoiceLink)}
              <div style="margin-bottom:10px;"><div style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">Paid</div><div style="font-size:13px;">${statusBadgePdf(exec.paid)}</div></div>
              `}
            </div>
          `)}

          ${section('Client Info', 'person', `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;">
              ${field('Client Point of Contact', exec.clientContact)}
              ${field('Company', exec.company)}
              ${emailField('Email', exec.email)}
              ${field('Phone', exec.phone)}
            </div>
          `)}

          ${section('Overview', 'info', `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;">
              ${field('Event Name', title)}
              ${field('Location Name', loc.name)}
              ${field('Address', loc.address)}
              ${field('Event Date', dateRange)}
            </div>
          `)}

          ${section('Crew', 'group', crewHtml)}

          ${section('Services', 'design_services', servicesHtml)}

          ${section('Deliverables', 'task', deliverablesHtml)}
        </div>

        ${section('Travel & Accommodation', 'flight_takeoff', travelHtml)}

        ${section('Notes', 'sticky_note_2', `<div style="font-size:13px;color:#333;line-height:1.6;">${notesHtml}</div>`)}

        <div style="text-align:center;margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#aaa;">
          Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} • Lumetry Media
        </div>
      </div>
    `;
  }

  async function exportToPdf() {
    const btn = document.getElementById('exportPdfBtn');
    if (btn) {
      btn.disabled = true;
      btn.querySelector('span:last-child').textContent = 'Generating...';
    }

    try {
      await loadHtml2Pdf();

      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildPdfContent();
      document.body.appendChild(wrapper);

      const element = wrapper.firstElementChild;
      const eventTitle = (currentData.title || 'Executive-Summary').replace(/[^a-zA-Z0-9-_ ]/g, '');

      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `${eventTitle} - Executive Summary.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }).from(element).save();

      document.body.removeChild(wrapper);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.querySelector('span:last-child').textContent = 'Export PDF';
      }
    }
  }

  function setupExportPdf() {
    const btn = document.getElementById('exportPdfBtn');
    if (btn) btn.addEventListener('click', exportToPdf);
  }

  // ---- Copy for Email (Gmail-friendly) ----
  function buildEmailContent() {
    const exec = getProjectDetailsWithFallback();
    const general = currentData.general || {};
    const title = currentData.title || 'Untitled Event';

    const loc = general.locations && general.locations.length > 0 ? general.locations[0] : {};
    const startStr = formatDate(general.start);
    const endStr = formatDate(general.end);
    const dateRange = startStr && endStr && startStr !== '—' && endStr !== '—' ? `${startStr} – ${endStr}` : startStr || endStr || '—';

    const labelStyle = 'font-size:11px;font-weight:600;color:#888888;text-transform:uppercase;letter-spacing:0.03em;padding:4px 0 1px 0;';
    const valueStyle = 'font-size:13px;color:#222222;padding:0 0 8px 0;';
    const sectionTitleStyle = 'font-size:14px;font-weight:700;color:#111111;padding:10px 14px;border-bottom:1px solid #e5e7eb;background-color:#f9fafb;';
    const sectionWrap = 'border:1px solid #e5e7eb;border-radius:6px;margin-bottom:14px;border-collapse:separate;';

    function field(label, value) {
      return `<tr><td style="${labelStyle}">${label}</td></tr><tr><td style="${valueStyle}">${value || '—'}</td></tr>`;
    }

    function emailLink(label, email) {
      const val = email ? `<a href="mailto:${email}" style="color:#2563eb;text-decoration:none;">${email}</a>` : '—';
      return `<tr><td style="${labelStyle}">${label}</td></tr><tr><td style="${valueStyle}">${val}</td></tr>`;
    }

    function linkVal(label, url) {
      if (!url) return field(label, '—');
      const display = url.length > 50 ? url.substring(0, 50) + '...' : url;
      const val = `<a href="${url}" style="color:#2563eb;text-decoration:none;">${display}</a>`;
      return `<tr><td style="${labelStyle}">${label}</td></tr><tr><td style="${valueStyle}">${val}</td></tr>`;
    }

    function statusBadge(value) {
      if (!value) return '—';
      const colors = { 'Yes': '#16a34a', 'No': '#dc2626', 'Retainer Paid': '#ca8a04', 'Needs Revision': '#ea580c' };
      const bg = { 'Yes': '#dcfce7', 'No': '#fee2e2', 'Retainer Paid': '#fef9c3', 'Needs Revision': '#ffedd5' };
      return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:500;color:${colors[value] || '#333333'};background-color:${bg[value] || '#f3f4f6'};">${value}</span>`;
    }

    function sectionBlock(title, body) {
      return `<table width="100%" cellpadding="0" cellspacing="0" style="${sectionWrap}"><tr><td style="${sectionTitleStyle}">${title}</td></tr><tr><td style="padding:12px 14px;">${body}</td></tr></table>`;
    }

    // Project Details
    const projectBody = `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" valign="top" style="padding-right:12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${field('Account Manager', exec.accountManager)}
              ${emailLink('Account Manager Email', exec.accountManagerEmail)}
              ${field('Project Manager', exec.projectManager)}
              ${emailLink('Project Manager Email', exec.projectManagerEmail)}
            </table>
          </td>
          ${exec.hideContractInvoiceFromExport ? '' : `
          <td width="50%" valign="top" style="padding-left:12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${linkVal('Contract Link', exec.contractLink)}
              ${field('Signed', statusBadge(exec.signed))}
              ${linkVal('Invoice Link', exec.invoiceLink)}
              ${field('Paid', statusBadge(exec.paid))}
            </table>
          </td>
          `}
        </tr>
      </table>`;

    // Client Info
    const clientBody = `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" valign="top" style="padding-right:12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${field('Client Point of Contact', exec.clientContact)}
              ${field('Company', exec.company)}
            </table>
          </td>
          <td width="50%" valign="top" style="padding-left:12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${emailLink('Email', exec.email)}
              ${field('Phone', exec.phone)}
            </table>
          </td>
        </tr>
      </table>`;

    // Overview
    const overviewBody = `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="50%" valign="top" style="padding-right:12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${field('Event Name', title)}
              ${field('Location Name', loc.name)}
            </table>
          </td>
          <td width="50%" valign="top" style="padding-left:12px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${field('Address', loc.address)}
              ${field('Event Date', dateRange)}
            </table>
          </td>
        </tr>
      </table>`;

    // Crew
    const crewBody = (() => {
      const rows = currentData.rows || [];
      const grouped = {};
      rows.forEach(r => {
        if (!r.name || r.name === 'TBD' || r.name.startsWith('__')) return;
        const date = r.date || 'Unassigned';
        if (!grouped[date]) grouped[date] = [];
        const role = (r.role && !r.role.startsWith('__')) ? ` — ${r.role}` : '';
        grouped[date].push(`${r.name}${role}`);
      });
      const dates = Object.keys(grouped).filter(d => grouped[d].length > 0).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return new Date(a) - new Date(b);
      });
      if (dates.length === 0) return '<p style="color:#999999;font-style:italic;">No crew assigned</p>';
      return dates.map(d => `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr><td style="font-size:11px;font-weight:600;color:#888888;text-transform:uppercase;padding-bottom:4px;">${formatDate(d)}</td></tr>
          ${grouped[d].map(m => `<tr><td style="padding:4px 0;font-size:13px;color:#333333;border-bottom:1px solid #f0f0f0;">${m}</td></tr>`).join('')}
        </table>`).join('');
    })();

    // Services
    const servicesBody = (() => {
      const services = exec.services || [];
      if (services.length === 0) return '<p style="color:#999999;font-style:italic;">None</p>';
      return `<table width="100%" cellpadding="0" cellspacing="0">${services.map(s => `<tr><td style="padding:5px 0;font-size:13px;color:#333333;border-bottom:1px solid #f0f0f0;">${s}</td></tr>`).join('')}</table>`;
    })();

    // Travel & Accommodation
    const travelContainer = document.getElementById('execTravelContent');
    const travelBody = (() => {
      if (!travelContainer || travelContainer.querySelector('.empty-hint')) return '<p style="color:#999999;font-style:italic;">No travel entries</p>';
      let html = '';
      travelContainer.querySelectorAll('.exec-travel-section-label').forEach(label => {
        const table = label.nextElementSibling;
        if (!table) return;
        html += `<p style="font-size:11px;font-weight:600;color:#888888;text-transform:uppercase;margin:8px 0 4px 0;">${label.textContent.trim()}</p>`;
        html += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;margin-bottom:8px;">';
        table.querySelectorAll('tr').forEach((tr, i) => {
          const tag = i === 0 ? 'th' : 'td';
          const cells = tr.querySelectorAll('th, td');
          html += '<tr>';
          cells.forEach(cell => {
            const style = i === 0
              ? 'padding:6px 8px;text-align:left;border-bottom:2px solid #dddddd;font-weight:600;color:#555555;font-size:10px;text-transform:uppercase;'
              : 'padding:6px 8px;text-align:left;border-bottom:1px solid #eeeeee;color:#333333;';
            html += `<${tag} style="${style}">${cell.textContent.trim()}</${tag}>`;
          });
          html += '</tr>';
        });
        html += '</table>';
      });
      return html || '<p style="color:#999999;font-style:italic;">No travel entries</p>';
    })();

    // Deliverables
    const deliverablesBody = (() => {
      const deliverables = exec.deliverables || [];
      if (deliverables.length === 0) return '<p style="color:#999999;font-style:italic;">No deliverables</p>';
      let html = '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">';
      html += '<tr><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #dddddd;font-weight:600;color:#555555;font-size:10px;text-transform:uppercase;">Item</th><th style="padding:6px 8px;text-align:left;border-bottom:2px solid #dddddd;font-weight:600;color:#555555;font-size:10px;text-transform:uppercase;">Due Date</th></tr>';
      deliverables.forEach(d => {
        html += `<tr><td style="padding:6px 8px;border-bottom:1px solid #eeeeee;color:#333333;">${d.item || '—'}</td><td style="padding:6px 8px;border-bottom:1px solid #eeeeee;color:#333333;">${formatDate(d.dueDate)}</td></tr>`;
      });
      html += '</table>';
      return html;
    })();

    const notesBody = exec.notes && exec.notes !== '<p><br></p>'
      ? `<div style="font-size:13px;color:#333333;line-height:1.6;">${exec.notes}</div>`
      : '<p style="color:#999999;font-style:italic;">No notes</p>';

    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222222;max-width:800px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:18px;border-bottom:2px solid #e5e7eb;">
    <h1 style="font-size:22px;font-weight:700;color:#111111;margin:0 0 4px 0;">${title}</h1>
    <p style="font-size:12px;color:#888888;text-transform:uppercase;letter-spacing:0.05em;margin:0;">Executive Summary</p>
  </td></tr></table>

  <br/>

  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%" valign="top" style="padding-right:8px;">
      ${sectionBlock('Project Details', projectBody)}
      ${sectionBlock('Overview', overviewBody)}
    </td>
    <td width="50%" valign="top" style="padding-left:8px;">
      ${sectionBlock('Client Info', clientBody)}
      ${sectionBlock('Crew', crewBody)}
    </td>
  </tr></table>

  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%" valign="top" style="padding-right:8px;">
      ${sectionBlock('Services', servicesBody)}
    </td>
    <td width="50%" valign="top" style="padding-left:8px;">
      ${sectionBlock('Deliverables', deliverablesBody)}
    </td>
  </tr></table>

  ${sectionBlock('Travel &amp; Accommodation', travelBody)}

  ${sectionBlock('Notes', notesBody)}

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:12px;border-top:1px solid #e5e7eb;font-size:10px;color:#aaaaaa;">
    Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} &bull; Lumetry Media
  </td></tr></table>
</div>`;
  }

  async function copyForEmail() {
    const btn = document.getElementById('copyEmailBtn');
    if (btn) {
      btn.disabled = true;
      btn.querySelector('span:last-child').textContent = 'Copying...';
    }

    try {
      const html = buildEmailContent();
      const blob = new Blob([html], { type: 'text/html' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blob })
      ]);

      if (btn) {
        btn.querySelector('.material-symbols-outlined').textContent = 'check';
        btn.querySelector('span:last-child').textContent = 'Copied!';
        setTimeout(() => {
          btn.querySelector('.material-symbols-outlined').textContent = 'content_copy';
          btn.querySelector('span:last-child').textContent = 'Copy for Email';
        }, 2000);
      }
    } catch (err) {
      console.error('Copy failed:', err);
      alert('Failed to copy. Please try again.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function setupCopyForEmail() {
    const btn = document.getElementById('copyEmailBtn');
    if (btn) btn.addEventListener('click', copyForEmail);
  }

  // ---- Init ----
  window.initPage = async function(id) {
    tableId = id;
    if (!tableId) return;

    try {
      currentData = await fetchData(tableId);

      const titleEl = document.getElementById('eventTitle');
      if (titleEl) titleEl.textContent = currentData.title || 'Untitled Event';

      renderProjectDetails();
      renderClientInfo();
      renderOverview();
      renderCrew();
      renderServices();
      await renderTravel();
      renderDeliverables(false);
      renderNotes();

      setupProjectDetails();
      setupClientInfo();
      setupServicesEdit();
      setupDeliverables();
      setupNotes();
      setupExportPdf();
      setupCopyForEmail();

      if (typeof window.populateSidebarEventInfo === 'function') {
        window.populateSidebarEventInfo();
      }
      if (typeof window.setupSidebarUser === 'function') {
        window.setupSidebarUser();
      }
    } catch (err) {
      console.error('Failed to load executive summary:', err);
    }
  };
})();
