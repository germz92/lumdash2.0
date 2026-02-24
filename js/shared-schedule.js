// =====================================================
// Shared Schedule - View-Only Client Page
// =====================================================
(function () {
  'use strict';

  let scheduleData = [];
  let eventTitle = 'Program Schedule';
  let searchQuery = '';
  let filterDate = 'all';
  let currentView = 'table'; // Default to table view on desktop
  let allNotesVisible = false;

  // ---- Helpers ----

  function getShareToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  }

  function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTo12Hour(time) {
    if (!time) return '';
    const [hour, minute] = time.split(':').map(Number);
    const h = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    return `${h}:${minute.toString().padStart(2, '0')} ${ampm}`;
  }

  function matchesSearch(program) {
    if (filterDate !== 'all' && program.date !== filterDate) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (program.name || '').toLowerCase().includes(q) ||
      (program.location || '').toLowerCase().includes(q) ||
      (program.photographer || '').toLowerCase().includes(q) ||
      (program.notes || '').toLowerCase().includes(q) ||
      (program.folder || '').toLowerCase().includes(q)
    );
  }

  function calculateDuration(startTime, endTime) {
    if (!startTime || !endTime) return Infinity;
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    return (endHour * 60 + endMin) - (startHour * 60 + startMin);
  }

  function sortPrograms(programs) {
    return programs.sort((a, b) => {
      const aHasTime = a.startTime && a.startTime.trim() !== '';
      const bHasTime = b.startTime && b.startTime.trim() !== '';

      if (aHasTime && bHasTime) {
        const timeComparison = a.startTime.localeCompare(b.startTime);
        if (timeComparison === 0) {
          return calculateDuration(a.startTime, a.endTime) - calculateDuration(b.startTime, b.endTime);
        }
        return timeComparison;
      }
      if (aHasTime && !bHasTime) return -1;
      if (!aHasTime && bHasTime) return 1;
      return a.__index - b.__index;
    });
  }

  // ---- Data Loading ----

  async function loadSharedSchedule() {
    const shareToken = getShareToken();
    if (!shareToken) {
      showError();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/shared-schedule/${shareToken}`);
      if (!res.ok) {
        showError();
        return;
      }

      const data = await res.json();
      eventTitle = data.title || 'Program Schedule';
      scheduleData = data.programSchedule || [];

      document.getElementById('eventTitle').textContent = eventTitle;
      document.title = `${eventTitle} - Schedule`;

      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('scheduleContent').style.display = 'block';

      populateDateFilter();
      initializeView();
      render();
    } catch (err) {
      console.error('Error loading shared schedule:', err);
      showError();
    }
  }

  function showError() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'flex';
  }

  // ---- Date Filter ----

  function populateDateFilter() {
    const dropdown = document.getElementById('filterDateDropdown');
    if (!dropdown) return;

    const dates = [...new Set(scheduleData.map(p => p.date))].sort();
    dropdown.innerHTML = '<option value="all">All Dates</option>';
    dates.forEach(date => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = formatDate(date);
      dropdown.appendChild(option);
    });
  }

  // ---- View Toggle ----

  function initializeView() {
    // On mobile, always use card view
    if (window.innerWidth <= 768) {
      currentView = 'cards';
    }
    applyView();
  }

  function applyView() {
    const cardContainer = document.getElementById('programSections');
    const tableContainer = document.getElementById('scheduleTableView');
    const toggleText = document.getElementById('viewToggleText');
    const toggleBtn = document.getElementById('viewToggleBtn');
    const toggleIcon = toggleBtn ? toggleBtn.querySelector('.material-symbols-outlined') : null;

    if (!cardContainer || !tableContainer) return;

    if (currentView === 'table') {
      cardContainer.classList.add('hidden');
      cardContainer.style.display = 'none';
      tableContainer.classList.add('active');
      if (toggleText) toggleText.textContent = 'Card View';
      if (toggleIcon) toggleIcon.textContent = 'view_module';
      renderTableView();
    } else {
      cardContainer.classList.remove('hidden');
      cardContainer.style.display = '';
      tableContainer.classList.remove('active');
      if (toggleText) toggleText.textContent = 'Table View';
      if (toggleIcon) toggleIcon.textContent = 'table_chart';
      renderCardView();
    }
  }

  window.toggleView = function () {
    if (window.innerWidth <= 768) return;
    currentView = currentView === 'cards' ? 'table' : 'cards';
    applyView();
  };

  // ---- Render ----

  function render() {
    if (currentView === 'table' && window.innerWidth > 768) {
      renderTableView();
    } else {
      renderCardView();
    }
  }

  // ---- Notes Toggle (Card View) ----
  window.toggleSharedNotes = function (btn) {
    const entry = btn.closest('.program-entry');
    if (!entry) return;
    const notesField = entry.querySelector('.notes-field');
    if (!notesField) return;

    const isHidden = notesField.style.display === 'none' || notesField.style.display === '';
    notesField.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? 'Hide Notes' : 'Show Notes';
  };

  // ---- Card View Rendering ----

  function renderCardView() {
    const container = document.getElementById('programSections');
    if (!container) return;

    container.innerHTML = '';

    if (scheduleData.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#777;">No schedule entries yet.</div>';
      return;
    }

    const dates = [...new Set(scheduleData.map(p => p.date))].sort();

    dates.forEach(date => {
      const matchingPrograms = scheduleData
        .map((p, i) => ({ ...p, __index: i }))
        .filter(p => p.date === date && matchesSearch(p));

      const sorted = sortPrograms(matchingPrograms);
      if (sorted.length === 0) return;

      const section = document.createElement('div');
      section.className = 'date-section';
      section.setAttribute('data-date', date);

      const headerWrapper = document.createElement('div');
      headerWrapper.className = 'date-header';
      headerWrapper.innerHTML = `<div class="date-title">${formatDate(date)}</div>`;
      section.appendChild(headerWrapper);

      sorted.forEach(program => {
        const entry = document.createElement('div');
        entry.className = 'program-entry' + (program.done ? ' done-entry' : '');

        entry.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;" class="time-row">
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;" class="time-fields-container">
              <input type="time"
                class="time-input"
                style="width: 110px; min-width: 90px; text-align: left; font-size: 12px;"
                value="${program.startTime || ''}"
                readonly>
              <input type="time"
                class="time-input"
                style="width: 110px; min-width: 90px; text-align: left; font-size: 12px;"
                value="${program.endTime || ''}"
                readonly>
              <div style="display: ${program.folder ? 'flex' : 'none'}; align-items: center; gap: 2px;" class="folder-field-container">
                <span class="material-symbols-outlined folder-icon" style="font-size: 14px; color: #2563eb;">folder</span>
                <input type="text"
                  class="folder-input"
                  style="width: 70px; min-width: 50px; padding: 4px 8px; font-size: 12px;"
                  value="${program.folder || ''}"
                  readonly>
              </div>
            </div>
            <div class="right-actions" style="flex-shrink: 0; margin-left: auto;">
              ${program.done ? '<span class="material-symbols-outlined" style="color: #28a745; font-size: 20px;">check_circle</span>' : ''}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <input class="program-name" type="text"
              style="flex: 1;"
              value="${program.name || ''}"
              readonly>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
            <div style="display: flex; align-items: center; flex: 1;">
              <span class="material-symbols-outlined" style="margin-right: 4px; font-size: 18px;">location_on</span>
              <textarea style="flex: 1; resize: none;" placeholder="Location" readonly>${program.location || ''}</textarea>
            </div>
            <div style="display: flex; align-items: center; flex: 1;">
              <span class="material-symbols-outlined" style="margin-right: 4px; font-size: 18px;">photo_camera</span>
              <textarea style="flex: 1; resize: none;" placeholder="Photographer" readonly>${program.photographer || ''}</textarea>
            </div>
          </div>
          <div class="entry-actions">
            <button class="show-notes-btn" onclick="toggleSharedNotes(this)">Show Notes</button>
          </div>
          <div class="notes-field" style="display: ${allNotesVisible ? 'block' : 'none'};">
            <textarea class="auto-expand" placeholder="Notes" readonly>${program.notes || ''}</textarea>
          </div>
        `;

        section.appendChild(entry);
      });

      container.appendChild(section);
    });
  }

  // ---- Table View Rendering ----

  function renderTableView() {
    const tableContainer = document.getElementById('scheduleTableView');
    if (!tableContainer) return;

    tableContainer.innerHTML = '';

    if (scheduleData.length === 0) {
      tableContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#777;">No schedule entries yet.</div>';
      return;
    }

    const dates = [...new Set(scheduleData.map(p => p.date))].sort();

    dates.forEach(date => {
      const matchingPrograms = scheduleData
        .map((p, i) => ({ ...p, __index: i }))
        .filter(p => p.date === date && matchesSearch(p));

      const sorted = sortPrograms(matchingPrograms);
      if (sorted.length === 0) return;

      const section = document.createElement('div');
      section.className = 'schedule-table-section';
      section.setAttribute('data-date', date);

      const dateHeader = document.createElement('div');
      dateHeader.className = 'date-header';
      dateHeader.innerHTML = `<div>${formatDate(date)}</div>`;
      section.appendChild(dateHeader);

      const table = document.createElement('table');

      const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>Start Time</th>
          <th>End Time</th>
          <th>Program Name</th>
          <th>Location</th>
          <th>Photographer</th>
          <th>Notes</th>
          <th>Folder</th>
          <th>Done</th>
        </tr>
      `;
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      sorted.forEach(program => {
        const row = document.createElement('tr');
        row.className = program.done ? 'done-row' : '';

        row.innerHTML = `
          <td><span class="cell-display">${formatTo12Hour(program.startTime || '')}</span></td>
          <td><span class="cell-display">${formatTo12Hour(program.endTime || '')}</span></td>
          <td><span class="cell-display">${program.name || ''}</span></td>
          <td><span class="cell-display">${program.location || ''}</span></td>
          <td><span class="cell-display">${program.photographer || ''}</span></td>
          <td><span class="cell-display">${program.notes || ''}</span></td>
          <td><span class="cell-display">${program.folder || ''}</span></td>
          <td class="done-checkbox-cell">
            ${program.done
              ? '<span class="material-symbols-outlined" style="color: #28a745; font-size: 20px;">check_circle</span>'
              : '<span style="color: #ccc;">—</span>'}
          </td>
        `;

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      section.appendChild(table);
      tableContainer.appendChild(section);
    });
  }

  // ---- Event Listeners ----

  function setupEventListeners() {
    // Date filter
    const filterDropdown = document.getElementById('filterDateDropdown');
    if (filterDropdown) {
      filterDropdown.addEventListener('change', function (e) {
        filterDate = e.target.value;
        render();
      });
    }

    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', function (e) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          searchQuery = e.target.value.trim();
          render();
        }, 200);
      });
    }

    // Handle resize (switch to card view on mobile)
    window.addEventListener('resize', function () {
      if (window.innerWidth <= 768 && currentView === 'table') {
        currentView = 'cards';
        applyView();
      }
    });
  }

  // ---- Init ----

  document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    loadSharedSchedule();
  });
})();
