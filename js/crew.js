// CREW PAGE v4.0 - SAVE BUTTON + LOCALSTORAGE VERSION
(function() {
window.initPage = undefined;
window.token = window.token || localStorage.getItem('token');

// Get current table ID
function getCurrentTableId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id') || localStorage.getItem('eventId');
}

let tableId = getCurrentTableId();

// Guard for missing ID
if (!tableId) {
  console.warn('No table ID provided, redirecting to dashboard...');
  window.location.href = 'dashboard.html';
  return;
}

let tableData = null;
let cachedUsers = [];
let cachedRoles = [
  "Lead Photographer",
  "Additional Photographer",
  "Lead Videographer",
  "Additional Videographer",
  "Headshot Booth Photographer",
  "Assistant"
];
let isOwner = false;
let reloadTimeout = null;
let showMineOnly = false; // Filter to show only current user's shifts

// State management for unsaved changes
let hasUnsavedChanges = false;
let changedRows = new Set(); // Track which rows changed
let deletedRows = new Set(); // Track deleted rows
let autosaveTimeout = null; // Debounce autosave
let isSaving = false; // Track if currently saving
let isEditing = false; // Track if any field is currently being edited
let pendingRerender = false; // A render was requested while editing; flush after edit ends
let suppressSocketUntil = 0; // Timestamp to suppress socket events until (self-notification suppression)

// Suppress socket events for a short time after own saves
function suppressNextSocketEvent() {
  suppressSocketUntil = Date.now() + 3000; // 3 second suppression window
}

// Decide whether a remote-change socket event should trigger a reload right now.
// Re-checked both on arrival AND at fire time so an edit started during the
// debounce window can cancel a pending reload (prevents getting kicked out).
function shouldReloadFromRemote(data) {
  // Crew DOM not present (we navigated away) -> never act on a stale handler
  if (!document.getElementById('dateSections')) return false;
  const currentTableId = getCurrentTableId();
  if (data && data.tableId && data.tableId !== currentTableId) return false;
  // Skip if this is our own save bouncing back
  if (Date.now() < suppressSocketUntil) return false;
  // Don't reload if user has unsaved changes or is mid-edit
  if (hasUnsavedChanges || isEditing) return false;
  return true;
}

function handleRemoteChange(data, label) {
  if (!shouldReloadFromRemote(data)) {
    console.log(`Ignoring ${label} (suppressed / editing / unsaved / off-page)`);
    return;
  }
  console.log(`${label}: scheduling reload...`);
  tableId = getCurrentTableId();

  if (reloadTimeout) clearTimeout(reloadTimeout);
  reloadTimeout = setTimeout(() => {
    // Re-check at fire time: an edit may have started during the 800ms window
    if (shouldReloadFromRemote(data)) {
      loadTable();
    } else {
      console.log(`Skipping deferred reload for ${label} (state changed)`);
    }
  }, 800);
}

// Socket.IO real-time updates - bound exactly once per page session.
// Re-running this IIFE on SPA navigation would otherwise stack duplicate
// listeners (each with its own stale closure), so detach our prior handlers first.
if (window.socket) {
  if (window.__crewSocketHandlers) {
    window.socket.off('crewChanged', window.__crewSocketHandlers.crewChanged);
    window.socket.off('tableUpdated', window.__crewSocketHandlers.tableUpdated);
  }

  const onCrewChanged = (data) => handleRemoteChange(data, 'crewChanged');
  const onTableUpdated = (data) => handleRemoteChange(data, 'tableUpdated');

  window.socket.on('crewChanged', onCrewChanged);
  window.socket.on('tableUpdated', onTableUpdated);

  window.__crewSocketHandlers = { crewChanged: onCrewChanged, tableUpdated: onTableUpdated };
}

// Update save status UI
function updateSaveStatus(status = null) {
  const saveStatus = document.getElementById('saveStatus');
  
  if (!saveStatus) return;
  
  if (status === 'saving') {
    saveStatus.textContent = 'Saving...';
    saveStatus.className = 'saving';
  } else if (status === 'saved') {
    saveStatus.textContent = 'All changes saved';
    saveStatus.className = 'saved';
  } else if (hasUnsavedChanges) {
    saveStatus.textContent = 'Unsaved changes';
    saveStatus.className = 'unsaved';
  } else {
    saveStatus.textContent = 'All changes saved';
    saveStatus.className = 'saved';
  }
}

// Mark as changed
function markChanged(rowId) {
  changedRows.add(rowId);
  hasUnsavedChanges = true;
  updateSaveStatus();
  saveToLocalStorage();
  triggerAutosave();
}

// Trigger autosave with debouncing
function triggerAutosave() {
  // Clear any pending autosave
  if (autosaveTimeout) {
    clearTimeout(autosaveTimeout);
  }
  
  // Schedule autosave after 2.5 seconds of inactivity
  autosaveTimeout = setTimeout(() => {
    // Don't autosave if currently editing or already saving
    if (!isEditing && !isSaving && hasUnsavedChanges) {
      console.log('🔄 Autosaving...');
      saveAllChanges(true); // true = silent mode
    }
  }, 2500);
}

// Save to localStorage as backup (only changed/deleted row IDs, not entire table)
function saveToLocalStorage() {
  try {
    // Only store the rows that actually changed, not the entire table
    const changedRowData = {};
    for (const rowId of changedRows) {
      const row = tableData.rows.find(r => r._id === rowId);
      if (row) changedRowData[rowId] = row;
    }
    const backup = {
      changedRowData,
      changedRows: Array.from(changedRows),
      deletedRows: Array.from(deletedRows),
      timestamp: Date.now()
    };
    localStorage.setItem(`crew_backup_${tableId}`, JSON.stringify(backup));
  } catch (e) {
    console.warn('Failed to save to localStorage:', e);
  }
}

// Load from localStorage
function loadFromLocalStorage() {
  try {
    const backup = localStorage.getItem(`crew_backup_${tableId}`);
    if (backup) {
      const data = JSON.parse(backup);
      // Check if backup is less than 24 hours old
      if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Failed to load from localStorage:', e);
  }
  return null;
}

// Clear localStorage backup
function clearLocalStorage() {
  localStorage.removeItem(`crew_backup_${tableId}`);
}

function goBack() {
  window.location.href = `event.html?id=${tableId}`;
}

function calculateHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startDate = new Date(0, 0, 0, sh, sm);
  const endDate = new Date(0, 0, 0, eh, em);
  const diff = (endDate - startDate) / (1000 * 60 * 60);
  return Math.max(diff.toFixed(2), 0);
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [hour, minute] = timeStr.split(':').map(Number);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const adjustedHour = hour % 12 || 12;
  return `${adjustedHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

function formatDateLocal(dateStr) {
  if (!dateStr) return 'No Date';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function getUserIdFromToken() {
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.id;
}

async function loadTable() {
  const currentTableId = getCurrentTableId();
  if (currentTableId !== tableId) {
    console.log(`TableId changed from ${tableId} to ${currentTableId}`);
    tableId = currentTableId;
  }
  
  console.log(`Loading table data for tableId: ${tableId}`);
  
  const res = await fetch(`${API_BASE}/api/tables/${tableId}`, {
    headers: { Authorization: token }
  });

  if (!res.ok) {
    alert('Failed to load table. You might not have access.');
    return;
  }

  tableData = await res.json();
  const userId = getUserIdFromToken();
  isOwner = Array.isArray(tableData.owners) && tableData.owners.includes(userId);

  // Update UI based on ownership
    const addDateBtn = document.getElementById('addDateBtn');
  if (addDateBtn) {
    addDateBtn.style.display = isOwner ? 'inline-flex' : 'none';
  }
  
  // Hide save status for non-owners
  const saveStatus = document.getElementById('saveStatus');
  if (saveStatus) {
    saveStatus.style.display = isOwner ? 'block' : 'none';
  }
  
  // Hide cost calculator and export CSV for non-owners
  const crewCostCalcBtn = document.getElementById('crewCostCalcBtn');
  if (crewCostCalcBtn) {
    crewCostCalcBtn.style.display = isOwner ? 'inline-flex' : 'none';
  }
  
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.style.display = isOwner ? 'inline-flex' : 'none';
  }
  
  // Adjust layout for non-owners - make filter bar more compact
  const filterSortBar = document.querySelector('.filter-sort-bar');
  if (filterSortBar && !isOwner) {
    filterSortBar.classList.add('non-owner-layout');
  }

  if (!cachedUsers.length) await preloadUsers();
  
  const tableTitleEl = document.getElementById('tableTitle');
  if (tableTitleEl) tableTitleEl.textContent = tableData.title;
  
  restoreFilterState();
  renderTableSection();
  updateCrewCount();
}

async function preloadUsers() {
  const res = await fetch(`${API_BASE}/api/users`, {
    headers: { Authorization: token }
  });
  const users = await res.json();
  users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  cachedUsers = users;
}

// Helper function to get initials from name
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Helper function to get user photo URL
function getUserPhoto(name) {
  if (!name) return null;
  const lowerName = name.toLowerCase().trim();
  const user = cachedUsers.find(u => (u.name || '').toLowerCase().trim() === lowerName);
  return user?.profilePhoto || user?.photo || null;
}

// Find a cached user record by (case-insensitive) name
function findUserByName(name) {
  if (!name) return null;
  const lowerName = name.toLowerCase().trim();
  return cachedUsers.find(u => (u.name || '').toLowerCase().trim() === lowerName) || null;
}

// Availability workflow: tentative → requested → accepted/declined → confirmed
const AVAILABILITY_LABELS = {
  tentative: 'Tentative',
  requested: 'Requested',
  accepted: 'Accepted',
  declined: 'Declined',
  confirmed: 'Confirmed'
};

function availabilityBadgeHtml(row) {
  if (!row.name || !row.name.trim()) return '';
  const status = row.availabilityStatus || 'tentative';
  const label = AVAILABILITY_LABELS[status] || status;
  return `<span class="avail-badge avail-${status}" title="Availability: ${label}">${label}</span>`;
}

// Track currently selected row for action menu
let selectedRowId = null;

function renderTableSection() {
  const container = document.getElementById('dateSections');
  if (!container) return;

  // Never blow away a live input/dropdown the user is editing. Defer the
  // re-render until they finish (exitEdit will flush pendingRerender).
  if (isEditing) {
    pendingRerender = true;
    return;
  }

  container.innerHTML = '';

  const filterDropdown = document.getElementById('filterDate');
  const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || '';

  // Get unique dates, filtering out any undefined/null values
  let dates = [...new Set(tableData.rows.map(row => row.date).filter(d => d))];
  dates.sort((a, b) => new Date(a) - new Date(b));

  // Update date range display
  if (dates.length > 0) {
    const fromEl = document.getElementById('dateRangeFrom');
    const toEl = document.getElementById('dateRangeTo');
    if (fromEl) fromEl.textContent = formatDateLocal(dates[0]);
    if (toEl) toEl.textContent = formatDateLocal(dates[dates.length - 1]);
  }

  if (filterDropdown) {
    const savedFilterDate = localStorage.getItem(`crew_filter_date_${tableId}`) || '';
    const currentValue = filterDropdown.value;
    const valueToUse = savedFilterDate || currentValue;
    
    filterDropdown.innerHTML = `<option value="">Show All</option>` +
      dates.map(d => `<option value="${d}" ${d === valueToUse ? 'selected' : ''}>${formatDateLocal(d)}</option>`).join('');
    filterDropdown.value = valueToUse;
  }

  const selectedDate = filterDropdown?.value;
  if (selectedDate) {
    dates = dates.filter(d => d === selectedDate);
  }

  const visibleNames = new Set();

  dates.forEach(date => {
    // Count tasks for this date
    const dateRows = tableData.rows.filter(row => row.date === date && row.role !== '__placeholder__');
    const taskCount = dateRows.length;
    
    // Create date section with new dark theme structure
    const sectionBox = document.createElement('div');
    sectionBox.className = 'crew-date-section';

    // Date Section Header
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'date-section-header';
    sectionHeader.innerHTML = `
      <div class="date-section-title">
        <h3>${formatDateLocal(date)}</h3>
        <span class="date-task-count">· ${taskCount} Task${taskCount !== 1 ? 's' : ''}</span>
      </div>
      ${isOwner ? `
        <button class="date-section-menu" data-date="${date}" title="Date options">
          <span class="material-symbols-outlined">more_horiz</span>
        </button>
      ` : ''}
    `;
    
    // Add date menu click handler
    if (isOwner) {
      const dateMenuBtn = sectionHeader.querySelector('.date-section-menu');
      if (dateMenuBtn) {
        dateMenuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showDateActionMenu(date, e.currentTarget);
        });
      }
    }

    // Create table
    const table = document.createElement('table');
    table.className = 'crew-schedule-table';

    const thead = document.createElement('thead');
      thead.innerHTML = `
        <tr>
          <th>Name</th>
          <th>Start</th>
        <th></th>
          <th>End</th>
        <th>Hours</th>
          <th>Role</th>
          <th>Notes</th>
        <th></th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Get current user's name for "Show Mine" filter
    const currentUserName = localStorage.getItem('fullName') || '';

    const visibleRows = tableData.rows.filter(row => {
      if (row.date !== date || row.role === '__placeholder__') return false;
      
      // Filter by current user if "Show Mine" is active
      if (showMineOnly && currentUserName) {
        if (!row.name || row.name.toLowerCase() !== currentUserName.toLowerCase()) {
          return false;
        }
      }
      
      const text = [row.name, row.role, row.notes].join(' ').toLowerCase();
      return text.includes(searchQuery);
    });

    visibleRows.forEach(row => {
      const rowId = row._id;
      const tr = document.createElement('tr');
      tr.id = `row-${rowId}`;
      tr.setAttribute('data-id', rowId);
    
      // Drag and drop for owners
      if (isOwner) {
        tr.setAttribute('draggable', 'true');
        tr.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', rowId);
          tr.classList.add('dragging');
        });
        tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
        tr.addEventListener('dragover', (e) => e.preventDefault());
        tr.addEventListener('drop', (e) => {
          e.preventDefault();
          handleDrop(rowId, e.dataTransfer.getData('text/plain'));
        });
      }

      // Get user photo
      const photo = getUserPhoto(row.name);
      const initials = getInitials(row.name);
      
      // Build notes cell content
      let notesContent = '';
      if (row.locationBadge) {
        notesContent += `<span class="location-badge">${row.locationBadge}</span>`;
      }
      if (row.notes) {
        notesContent += `<span class="notes-text">${row.notes}</span>`;
      }

        tr.innerHTML = `
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="name">
          <div class="crew-name-cell">
            <div class="crew-avatar ${photo ? '' : 'initials'}">
              ${photo ? `<img src="${photo}" alt="${row.name || ''}">` : initials}
            </div>
            <span class="crew-member-name cell-display">${row.name || (isOwner ? 'Click to add' : '')}</span>
            ${availabilityBadgeHtml(row)}
          </div>
          </td>
        <td class="editable-cell time-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="startTime">
          <span class="cell-display">${formatTime(row.startTime) || '--'}</span>
          </td>
        <td class="time-arrow">
          <span class="material-symbols-outlined">arrow_forward</span>
          </td>
        <td class="editable-cell time-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="endTime">
          <span class="cell-display">${formatTime(row.endTime) || '--'}</span>
        </td>
        <td class="hours-cell">
          <span class="shift-hours total-hours-cell">
            <span class="material-symbols-outlined">schedule</span>
            ${row.totalHours || 0}
          </span>
        </td>
        <td class="editable-cell role-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="role">
          <span class="cell-display">${row.role || (isOwner ? 'Click to add' : '')}</span>
          </td>
        <td class="editable-cell notes-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="notes">
          <div class="cell-display">${notesContent || ''}</div>
          </td>
        <td class="action-cell">
        ${isOwner ? `
            <button class="row-action-btn" data-row-id="${rowId}" title="More options">
              <span class="material-symbols-outlined">more_horiz</span>
            </button>
        ` : ''}
        </td>
      `;
    
      tbody.appendChild(tr);
    
      // Add click handlers for inline editing (owners only)
      if (isOwner) {
        tr.querySelectorAll('.owner-editable').forEach(cell => {
          cell.addEventListener('click', (e) => {
            // Don't trigger if clicking action button
            if (e.target.closest('.row-action-btn')) return;
            makeEditable(cell, row);
          });
        });
        
        // Add row action menu handler
        const actionBtn = tr.querySelector('.row-action-btn');
        if (actionBtn) {
          actionBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
            showRowActionMenu(rowId, e.currentTarget);
              });
        }
      }
    
      if (row.name && row.name.trim()) {
        visibleNames.add(row.name.trim());
      }
    });

    table.appendChild(tbody);
    
    // Add row section for owners
    let addRowSection = '';
    if (isOwner) {
      addRowSection = `
        <div class="add-row-section">
          <button class="crew-add-row-btn" data-date="${date}">
            <span class="material-symbols-outlined">add</span>
            ADD ROW
          </button>
        </div>
      `;
    }

    sectionBox.appendChild(sectionHeader);
    sectionBox.appendChild(table);
    if (isOwner) {
      const addRowDiv = document.createElement('div');
      addRowDiv.innerHTML = addRowSection;
      sectionBox.appendChild(addRowDiv.firstElementChild);
      
      // Add click handler for add row button
      const addRowBtn = sectionBox.querySelector('.crew-add-row-btn');
      if (addRowBtn) {
        addRowBtn.addEventListener('click', () => addRow(date));
      }
    }
    
    container.appendChild(sectionBox);
  });

  // Update owner-only buttons visibility
  updateOwnerButtons();
}

// Update owner-only buttons visibility
function updateOwnerButtons() {
  const crewListBtn = document.getElementById('crewListBtn');
  const crewCostCalcBtn = document.getElementById('crewCostCalcBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const addDateBtn = document.getElementById('addDateBtn');
  const saveStatus = document.getElementById('saveStatus');
  const requestAvailabilityBtn = document.getElementById('requestAvailabilityBtn');
  
  if (isOwner) {
    if (crewListBtn) crewListBtn.style.display = 'inline-flex';
    if (crewCostCalcBtn) crewCostCalcBtn.style.display = 'inline-flex';
    if (exportCsvBtn) exportCsvBtn.style.display = 'inline-flex';
    if (addDateBtn) addDateBtn.style.display = 'inline-flex';
    if (saveStatus) saveStatus.style.display = 'block';
    if (requestAvailabilityBtn) requestAvailabilityBtn.style.display = 'inline-flex';
  } else {
    if (crewListBtn) crewListBtn.style.display = 'none';
    if (crewCostCalcBtn) crewCostCalcBtn.style.display = 'none';
    if (exportCsvBtn) exportCsvBtn.style.display = 'none';
    if (addDateBtn) addDateBtn.style.display = 'none';
    if (saveStatus) saveStatus.style.display = 'none';
    if (requestAvailabilityBtn) requestAvailabilityBtn.style.display = 'none';
  }
}

// Show row action menu (three-dot menu)
function showRowActionMenu(rowId, button) {
  selectedRowId = rowId;
  
  const dropdown = document.getElementById('rowActionDropdown');
  if (!dropdown) return;
  
  // Hide if already showing
  if (dropdown.classList.contains('show')) {
    hideRowActionModal();
    return;
  }
  
  // Contextualize availability actions for this row's status
  const row = tableData?.rows?.find(r => r._id === rowId);
  const status = row?.availabilityStatus || 'tentative';
  const hasName = !!(row?.name && row.name.trim());
  
  const requestAction = document.getElementById('requestShiftAction');
  const commitAction = document.getElementById('commitShiftAction');
  const resetAction = document.getElementById('resetAvailabilityAction');
  
  if (requestAction) {
    requestAction.style.display = (hasName && status !== 'confirmed' && status !== 'accepted') ? '' : 'none';
    const label = requestAction.querySelector('span:last-child');
    if (label) label.textContent = (status === 'requested' || status === 'declined') ? 'Resend Request' : 'Send Request';
  }
  if (commitAction) {
    commitAction.style.display = (hasName && status !== 'confirmed') ? '' : 'none';
  }
  if (resetAction) {
    resetAction.style.display = (hasName && status !== 'tentative') ? '' : 'none';
  }
  
  // Position the dropdown near the button
  const rect = button.getBoundingClientRect();
  const menuHeight = 230; // up to 5 items incl. availability actions
  const menuWidth = 180;
  
  // Check if there's enough space below
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceRight = window.innerWidth - rect.right;
  
  if (spaceBelow < menuHeight) {
    // Show above
    dropdown.style.top = 'auto';
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      } else {
    // Show below
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.bottom = 'auto';
  }
  
  if (spaceRight < menuWidth) {
    // Align to right edge of button
    dropdown.style.left = 'auto';
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
  } else {
    // Align to left edge of button
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.right = 'auto';
  }
  
  dropdown.classList.add('show');
  
  // Close when clicking outside
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 10);
}

function handleOutsideClick(e) {
  const dropdown = document.getElementById('rowActionDropdown');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.row-action-btn')) {
    hideRowActionModal();
  }
}

// Track selected date for date actions
let selectedDate = null;

// Show date action menu
function showDateActionMenu(date, button) {
  selectedDate = date;
  
  const dropdown = document.getElementById('dateActionDropdown');
  if (!dropdown) return;
  
  // Hide if already showing
  if (dropdown.classList.contains('show')) {
    hideDateActionModal();
    return;
  }
  
  // Position the dropdown near the button
  const rect = button.getBoundingClientRect();
  const menuHeight = 50;
  const menuWidth = 150;
  
  // Check if there's enough space below
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceRight = window.innerWidth - rect.right;
  
  if (spaceBelow < menuHeight) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.bottom = 'auto';
  }
  
  if (spaceRight < menuWidth) {
    dropdown.style.left = 'auto';
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
  } else {
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.right = 'auto';
  }
  
  dropdown.classList.add('show');
  
  // Close when clicking outside
  setTimeout(() => {
    document.addEventListener('click', handleDateOutsideClick);
  }, 10);
}

function handleDateOutsideClick(e) {
  const dropdown = document.getElementById('dateActionDropdown');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.date-section-menu')) {
    hideDateActionModal();
  }
}

// Hide date action dropdown
function hideDateActionModal() {
  const dropdown = document.getElementById('dateActionDropdown');
  if (dropdown) dropdown.classList.remove('show');
  selectedDate = null;
  document.removeEventListener('click', handleDateOutsideClick);
}

// Hide row action dropdown
function hideRowActionModal() {
  const dropdown = document.getElementById('rowActionDropdown');
  if (dropdown) dropdown.classList.remove('show');
  selectedRowId = null;
  document.removeEventListener('click', handleOutsideClick);
}

// Setup action menu handlers
function setupActionMenuHandlers() {
  // Send/resend availability request action
  const requestAction = document.getElementById('requestShiftAction');
  if (requestAction && !requestAction._listenerAttached) {
    requestAction._listenerAttached = true;
    requestAction.onclick = (e) => {
      e.stopPropagation();
      const rowId = selectedRowId; // Capture before hiding
      hideRowActionModal();
      if (rowId) sendAvailabilityRequests([rowId]);
    };
  }
  
  // Commit (mark confirmed) action
  const commitAction = document.getElementById('commitShiftAction');
  if (commitAction && !commitAction._listenerAttached) {
    commitAction._listenerAttached = true;
    commitAction.onclick = (e) => {
      e.stopPropagation();
      const rowId = selectedRowId; // Capture before hiding
      hideRowActionModal();
      if (rowId) setRowAvailability(rowId, 'confirmed');
    };
  }
  
  // Reset to tentative action
  const resetAction = document.getElementById('resetAvailabilityAction');
  if (resetAction && !resetAction._listenerAttached) {
    resetAction._listenerAttached = true;
    resetAction.onclick = (e) => {
      e.stopPropagation();
      const rowId = selectedRowId; // Capture before hiding
      hideRowActionModal();
      if (rowId) setRowAvailability(rowId, 'tentative');
    };
  }
  
  // Duplicate shift action
  const duplicateAction = document.getElementById('duplicateShiftAction');
  if (duplicateAction && !duplicateAction._listenerAttached) {
    duplicateAction._listenerAttached = true;
    duplicateAction.onclick = (e) => {
      e.stopPropagation();
      const rowId = selectedRowId; // Capture before hiding
      hideRowActionModal();
      if (rowId) duplicateRow(rowId);
    };
  }
  
  // Delete shift action
  const deleteAction = document.getElementById('deleteShiftAction');
  if (deleteAction && !deleteAction._listenerAttached) {
    deleteAction._listenerAttached = true;
    deleteAction.onclick = (e) => {
      e.stopPropagation();
      const rowId = selectedRowId; // Capture before hiding
      hideRowActionModal();
      if (rowId) deleteRow(rowId);
    };
  }
  
  // Delete date action
  const deleteDateAction = document.getElementById('deleteDateAction');
  if (deleteDateAction && !deleteDateAction._listenerAttached) {
    deleteDateAction._listenerAttached = true;
    deleteDateAction.onclick = (e) => {
      e.stopPropagation();
      const date = selectedDate; // Capture before hiding
      hideDateActionModal();
      if (date) deleteDate(date);
    };
  }
}

// Open edit shift modal
function openEditShiftModal(rowId) {
  const row = tableData.rows.find(r => r._id === rowId);
  if (!row) return;
  
  // Populate name dropdown
  const nameSelect = document.getElementById('editShiftName');
  if (nameSelect) {
    nameSelect.innerHTML = `
      <option value="">-- Select Name --</option>
      ${cachedUsers.map(u => `<option value="${u.name}" ${u.name === row.name ? 'selected' : ''}>${u.name}</option>`).join('')}
    `;
  }
  
  // Populate role dropdown
  const roleSelect = document.getElementById('editShiftRole');
  if (roleSelect) {
    roleSelect.innerHTML = `
      <option value="">-- Select Role --</option>
      ${cachedRoles.map(r => `<option value="${r}" ${r === row.role ? 'selected' : ''}>${r}</option>`).join('')}
    `;
  }
  
  // Populate other fields
  document.getElementById('editShiftRowId').value = rowId;
  document.getElementById('editShiftStart').value = row.startTime || '';
  document.getElementById('editShiftEnd').value = row.endTime || '';
  document.getElementById('editShiftNotes').value = row.notes || '';
  document.getElementById('editShiftLocation').value = row.locationBadge || '';
  
  window.showEditShiftModal();
}

// Save shift from modal
async function saveShiftFromModal() {
  const rowId = document.getElementById('editShiftRowId').value;
  const row = tableData.rows.find(r => r._id === rowId);
  if (!row) return;
  
  const saveBtn = document.getElementById('saveShiftBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const newName = document.getElementById('editShiftName').value;
    if (newName !== row.name) {
      const matchedUser = findUserByName(newName);
      row.userId = matchedUser?._id || null;
      row.availabilityStatus = 'tentative';
      row.availabilityRespondedAt = null;
      row.__resetAvailability = true;
    }
    row.name = newName;
    row.role = document.getElementById('editShiftRole').value;
    row.startTime = document.getElementById('editShiftStart').value;
    row.endTime = document.getElementById('editShiftEnd').value;
    row.notes = document.getElementById('editShiftNotes').value;
    row.locationBadge = document.getElementById('editShiftLocation').value;
    row.totalHours = calculateHours(row.startTime, row.endTime);
    
    markChanged(rowId);
    window.hideEditShiftModal();
    renderTableSection();
    
  } catch (err) {
    console.error('Save shift error:', err);
    alert('Failed to save shift');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

// Duplicate a row
async function duplicateRow(rowId) {
  const row = tableData.rows.find(r => r._id === rowId);
  if (!row) return;
  
  try {
    const newRow = {
      date: row.date,
      name: row.name,
      role: row.role,
      startTime: row.startTime,
      endTime: row.endTime,
      totalHours: row.totalHours,
      notes: row.notes,
      locationBadge: row.locationBadge,
      userId: row.userId || null
    };
    
    suppressNextSocketEvent();
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/rows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify(newRow)
    });
    
    if (!response.ok) throw new Error('Failed to duplicate');
    
    const result = await response.json();
    const savedRow = result.row;
    
    if (savedRow && savedRow._id) {
      tableData.rows.push(savedRow);
      renderTableSection();
      updateCrewCount();
      showMessage('Shift duplicated!', 'success');
    } else {
      // Fallback: reload from server
      await loadTable();
      showMessage('Shift duplicated!', 'success');
    }
  } catch (err) {
    console.error('Duplicate error:', err);
    showMessage('Failed to duplicate shift', 'error');
  }
}

// ===== Crew availability workflow =====

// Manually set a row's availability (commit to confirmed, or reset to tentative)
async function setRowAvailability(rowId, status) {
  if (!isOwner) return;
  
  try {
    suppressNextSocketEvent(); // Don't reload from our own change
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/rows/${rowId}/availability`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({ status })
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed (${response.status})`);
    }
    
    // Update local data + re-render
    const row = tableData.rows.find(r => r._id === rowId);
    if (row) {
      row.availabilityStatus = status;
      if (status === 'tentative') row.availabilityRespondedAt = null;
    }
    renderTableSection();
    showMessage(status === 'confirmed' ? 'Crew member confirmed!' : 'Reset to tentative', 'success');
  } catch (err) {
    console.error('Failed to update availability:', err);
    showMessage(err.message || 'Failed to update availability', 'error');
  }
}

// Send availability request emails for the given crew rows (grouped per person server-side)
async function sendAvailabilityRequests(rowIds, resultCallback = null) {
  if (!isOwner || !rowIds.length) return;
  
  // Flush pending edits first so the emails reflect current data
  if (hasUnsavedChanges) await saveAllChanges(true);
  
  try {
    showMessage('Sending availability request...', 'info');
    suppressNextSocketEvent(); // Don't reload from our own change
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/crew-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({ rowIds })
    });
    
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Failed (${response.status})`);
    }
    
    // Update local rows that are now "requested"
    const sentNames = new Set(
      (result.results || []).filter(r => r.sent).map(r => (r.name || '').toLowerCase().trim())
    );
    tableData.rows.forEach(row => {
      if (rowIds.includes(row._id) &&
          sentNames.has((row.name || '').toLowerCase().trim()) &&
          row.availabilityStatus !== 'confirmed') {
        row.availabilityStatus = 'requested';
      }
    });
    renderTableSection();
    
    const failed = (result.results || []).filter(r => !r.sent);
    const sentCount = (result.results || []).filter(r => r.sent).length;
    if (failed.length === 0) {
      showMessage(`Availability request${sentCount !== 1 ? 's' : ''} sent to ${sentCount} crew member${sentCount !== 1 ? 's' : ''}!`, 'success');
    } else if (sentCount > 0) {
      showMessage(`Sent to ${sentCount}, failed for: ${failed.map(f => f.name).join(', ')}`, 'error');
    } else {
      showMessage(`Failed to send: ${failed.map(f => `${f.name} (${f.error})`).join(', ')}`, 'error');
    }
    
    if (resultCallback) resultCallback(result.results || []);
  } catch (err) {
    console.error('Failed to send availability requests:', err);
    showMessage(err.message || 'Failed to send availability requests', 'error');
    if (resultCallback) resultCallback(null);
  }
}

// Bulk "Request Availability" modal — groups unconfirmed rows by person
function showRequestAvailabilityModal() {
  if (!isOwner) return;
  
  // Group requestable rows (named, not confirmed/accepted) by person
  const rows = (tableData.rows || []).filter(r =>
    r.role !== '__placeholder__' &&
    r.name && r.name.trim() &&
    r.availabilityStatus !== 'confirmed' &&
    r.availabilityStatus !== 'accepted'
  );
  
  if (rows.length === 0) {
    showMessage('No crew to request — everyone is already accepted or confirmed.', 'info');
    return;
  }
  
  const groups = new Map();
  rows.forEach(r => {
    const key = r.name.trim().toLowerCase();
    if (!groups.has(key)) {
      const user = findUserByName(r.name);
      groups.set(key, { name: r.name.trim(), email: user?.email || null, rows: [] });
    }
    groups.get(key).rows.push(r);
  });
  
  const people = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  
  let modal = document.getElementById('requestAvailabilityModal');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'requestAvailabilityModal';
  modal.className = 'dark-modal show';
  modal.innerHTML = `
    <div class="dark-modal-content" style="max-width:560px;width:94vw;max-height:88vh;display:flex;flex-direction:column;">
      <div class="modal-header-dark">
        <h3>Request Availability</h3>
        <button class="modal-close-btn" id="closeRequestAvailModalBtn">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="modal-body-dark" style="flex:1;overflow-y:auto;padding:16px 24px;">
        <p style="color:var(--text-secondary);font-size:0.85rem;margin:0 0 14px;">
          Each person gets one email listing their days with Accept / Decline links — no login needed.
          Days that are already accepted or confirmed are not included.
        </p>
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0 12px;color:var(--text-secondary);font-size:0.85rem;cursor:pointer;border-bottom:1px solid var(--border-default);margin-bottom:10px;">
          <input type="checkbox" id="reqAvailSelectAll" checked> Select all
        </label>
        <div id="reqAvailPeople">
          ${people.map((p, i) => {
            const sortedDates = p.rows.map(r => r.date).filter(Boolean).sort();
            const dayList = sortedDates.map(d => formatDateLocal(d)).join(', ');
            const alreadyRequested = p.rows.every(r => r.availabilityStatus === 'requested');
            return `
              <label style="display:flex;align-items:flex-start;gap:10px;padding:12px;margin-bottom:8px;background:var(--bg-tertiary);border-radius:8px;cursor:pointer;">
                <input type="checkbox" class="req-avail-person" data-index="${i}" ${p.email && !alreadyRequested ? 'checked' : ''} ${p.email ? '' : 'disabled'} style="margin-top:3px;">
                <span style="flex:1;">
                  <span style="display:block;font-weight:600;color:var(--text-primary);font-size:0.95rem;">
                    ${p.name}
                    ${alreadyRequested ? '<span style="color:#f59e0b;font-size:0.75rem;font-weight:500;"> · already requested</span>' : ''}
                  </span>
                  <span style="display:block;color:${p.email ? 'var(--text-secondary)' : '#ef4444'};font-size:0.8rem;margin-top:2px;">
                    ${p.email || 'No user account with email found — cannot send'}
                  </span>
                  <span style="display:block;color:var(--text-muted);font-size:0.8rem;margin-top:2px;">
                    ${p.rows.length} day${p.rows.length !== 1 ? 's' : ''}: ${dayList}
                  </span>
                </span>
              </label>`;
          }).join('')}
        </div>
      </div>
      <div class="modal-footer-dark">
        <button class="btn-secondary" id="cancelRequestAvailBtn">Cancel</button>
        <button class="btn-primary" id="sendRequestAvailBtn">Send Requests</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const close = () => modal.remove();
  document.getElementById('closeRequestAvailModalBtn').onclick = close;
  document.getElementById('cancelRequestAvailBtn').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  
  const selectAll = document.getElementById('reqAvailSelectAll');
  selectAll.onchange = () => {
    modal.querySelectorAll('.req-avail-person:not(:disabled)').forEach(cb => {
      cb.checked = selectAll.checked;
    });
  };
  
  const sendBtn = document.getElementById('sendRequestAvailBtn');
  sendBtn.onclick = async () => {
    const checkedIndexes = [...modal.querySelectorAll('.req-avail-person:checked')].map(cb => Number(cb.dataset.index));
    if (checkedIndexes.length === 0) {
      showMessage('Select at least one crew member.', 'error');
      return;
    }
    
    const rowIds = checkedIndexes.flatMap(i => people[i].rows.map(r => r._id));
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    
    await sendAvailabilityRequests(rowIds, () => close());
  };
}

// Create custom dropdown component
function createCustomDropdown(options, currentValue, placeholder, onSelect, onAddNew) {
  const container = document.createElement('div');
  container.className = 'custom-dropdown';
  
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-dropdown-trigger';
  trigger.innerHTML = `
    <span class="dropdown-value ${!currentValue ? 'placeholder' : ''}">${currentValue || placeholder}</span>
    <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
  `;
  
  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';
  
  // Search input for filtering
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'custom-dropdown-search';
  searchWrapper.innerHTML = `<input type="text" placeholder="Search..." autocomplete="off">`;
  
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'custom-dropdown-options';
  
  // Render options
  function renderOptions(filter = '') {
    const filtered = options.filter(opt => 
      opt.toLowerCase().includes(filter.toLowerCase())
    );
    
    if (filtered.length === 0 && filter) {
      optionsContainer.innerHTML = `<div class="custom-dropdown-empty">No results found</div>`;
    } else {
      optionsContainer.innerHTML = filtered.map(opt => `
        <button type="button" class="custom-dropdown-option ${opt === currentValue ? 'selected' : ''}" data-value="${opt}">
          ${opt}
        </button>
      `).join('');
      
      // Add "Add new" option
      if (onAddNew) {
        optionsContainer.innerHTML += `
          <button type="button" class="custom-dropdown-option add-new" data-value="__add_new__">
            <span class="material-symbols-outlined">add</span>
            Add new...
          </button>
        `;
      }
    }
  }
  
  renderOptions();
  
  menu.appendChild(searchWrapper);
  menu.appendChild(optionsContainer);
  container.appendChild(trigger);
  container.appendChild(menu);
  
  // Event handlers
  let isOpen = false;
  
  function openDropdown() {
    isOpen = true;
    container.classList.add('open');
    
    // Position the menu using fixed positioning
    const triggerRect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const menuHeight = Math.min(400, viewportHeight * 0.5);
    
    // Check if menu should open above or below
    const spaceBelow = viewportHeight - triggerRect.bottom - 10;
    const spaceAbove = triggerRect.top - 10;
    
    if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
      // Open below
      menu.style.top = `${triggerRect.bottom + 4}px`;
      menu.style.maxHeight = `${Math.min(menuHeight, spaceBelow)}px`;
    } else {
      // Open above
      menu.style.top = `${triggerRect.top - menuHeight - 4}px`;
      menu.style.maxHeight = `${Math.min(menuHeight, spaceAbove)}px`;
    }
    
    menu.style.left = `${triggerRect.left}px`;
    menu.style.width = `${Math.max(triggerRect.width, 200)}px`;
    
    const searchInput = searchWrapper.querySelector('input');
    searchInput.value = '';
    renderOptions();
    setTimeout(() => searchInput.focus(), 50);
  }
  
  function closeDropdown() {
    isOpen = false;
    container.classList.remove('open');
  }
  
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });
  
  // Search filtering
  const searchInput = searchWrapper.querySelector('input');
  searchInput.addEventListener('input', (e) => {
    renderOptions(e.target.value);
  });
  
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
    }
  });
  
  // Option selection
  optionsContainer.addEventListener('click', async (e) => {
    const option = e.target.closest('.custom-dropdown-option');
    if (!option) return;
    
    e.stopPropagation();
    const value = option.dataset.value;
    
    if (value === '__add_new__' && onAddNew) {
      closeDropdown();
      const newValue = await onAddNew();
      if (newValue) {
        trigger.querySelector('.dropdown-value').textContent = newValue;
        trigger.querySelector('.dropdown-value').classList.remove('placeholder');
        onSelect(newValue);
      }
    } else {
      trigger.querySelector('.dropdown-value').textContent = value;
      trigger.querySelector('.dropdown-value').classList.remove('placeholder');
      closeDropdown();
      onSelect(value);
    }
  });
  
  // Close on outside click
  function handleOutsideClick(e) {
    if (!container.contains(e.target)) {
      closeDropdown();
      document.removeEventListener('click', handleOutsideClick);
    }
  }
  
  container.addEventListener('click', () => {
    document.addEventListener('click', handleOutsideClick);
  });
  
  // Expose close method
  container.closeDropdown = closeDropdown;
  
  return container;
}

// Make a cell editable (inline editing) - NO AUTO-SAVE VERSION
function makeEditable(cell, row) {
  // Don't re-edit if already editing
  if (cell.classList.contains('editing')) return;
  
  const rowId = cell.getAttribute('data-row-id');
  const field = cell.getAttribute('data-field');
  const displaySpan = cell.querySelector('.cell-display');
  const currentValue = row[field] || '';
  
  cell.classList.add('editing');
  isEditing = true; // Mark that editing is in progress
  
  // Create appropriate input based on field type
  let input;
  let isCustomDropdown = false;
  
  if (field === 'name') {
    // Custom dropdown for name
    isCustomDropdown = true;
    const options = cachedUsers.map(u => u.name).filter(Boolean);
    
    input = createCustomDropdown(
      options,
      currentValue,
      '-- Select Name --',
      (value) => {
        if (value !== currentValue) {
          row[field] = value;
          // Link the row to the user account (for availability request emails)
          const matchedUser = findUserByName(value);
          row.userId = matchedUser?._id || null;
          // Reassigning resets the availability workflow
          row.availabilityStatus = 'tentative';
          row.availabilityRespondedAt = null;
          row.__resetAvailability = true;
          displaySpan.textContent = value;
          markChanged(rowId);
        }
        exitEdit();
      },
      async () => {
        const newValue = await showInputModal('Add New Name', 'Enter name...');
        if (newValue && !cachedUsers.some(u => u.name === newValue)) {
          cachedUsers.push({ name: newValue });
          cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
          return newValue;
        } else if (newValue) {
          showMessage('This name already exists', 'error');
        }
        return null;
      }
    );
  } else if (field === 'role') {
    // Custom dropdown for role
    isCustomDropdown = true;
    
    input = createCustomDropdown(
      cachedRoles,
      currentValue,
      '-- Select Role --',
      (value) => {
        if (value !== currentValue) {
          row[field] = value;
          displaySpan.textContent = value;
          markChanged(rowId);
        }
        exitEdit();
      },
      async () => {
        const newValue = await showInputModal('Add New Role', 'Enter role...');
        if (newValue && !cachedRoles.includes(newValue)) {
          cachedRoles.push(newValue);
          cachedRoles.sort();
          return newValue;
        } else if (newValue) {
          showMessage('This role already exists', 'error');
        }
        return null;
      }
    );
  } else if (field === 'startTime' || field === 'endTime') {
    // Time input
    input = document.createElement('input');
    input.type = 'time';
    input.value = currentValue;
  } else if (field === 'notes') {
    // Text input for notes
    input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
  }
  
  // Style the input to fit the cell
  if (!isCustomDropdown) {
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.className = 'inline-edit-input';
  }
  
  // Replace display with input
  displaySpan.style.display = 'none';
  cell.appendChild(input);
  
  if (!isCustomDropdown) {
    input.focus();
      } else {
    // Auto-open the dropdown
    setTimeout(() => {
      const trigger = input.querySelector('.custom-dropdown-trigger');
      if (trigger) trigger.click();
    }, 50);
  }
  
  // Exit edit mode function
  const exitEdit = () => {
    if (!input.parentNode) return; // Already removed
    input.remove();
    displaySpan.style.display = '';
    cell.classList.remove('editing');
    isEditing = false;

    // If a render was requested while we were editing, run it now that it's safe.
    if (pendingRerender) {
      pendingRerender = false;
      renderTableSection();
    }
  };
  
  // For custom dropdowns, handle click outside to exit
  if (isCustomDropdown) {
    const handleClickOutside = (e) => {
      if (!input.contains(e.target) && !e.target.closest('.input-modal')) {
        exitEdit();
        document.removeEventListener('click', handleClickOutside);
          }
    };
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
    return; // Skip the rest for custom dropdowns
  }
  
  // Get next editable cell for Tab navigation
  const getNextEditableCell = () => {
    const tr = cell.closest('tr');
    const cells = Array.from(tr.querySelectorAll('.owner-editable'));
    const currentIndex = cells.indexOf(cell);
    return cells[currentIndex + 1] || null;
  };
  
  const getPreviousEditableCell = () => {
    const tr = cell.closest('tr');
    const cells = Array.from(tr.querySelectorAll('.owner-editable'));
    const currentIndex = cells.indexOf(cell);
    return cells[currentIndex - 1] || null;
  };
  
  // Update local data only (no API calls)
  const updateValue = async (newValue) => {
    // Handle "add new" option
    if (newValue === '__add_new__') {
      
      // Fallback: handle it here if change event didn't fire
      if (field === 'name') {
        const customName = await showInputModal('Add New Name', 'Enter name...');
        if (customName && !cachedUsers.some(u => u.name === customName)) {
          cachedUsers.push({ name: customName });
          cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
          newValue = customName;
        } else if (customName && cachedUsers.some(u => u.name === customName)) {
          showMessage('This name already exists', 'error');
          return;
        } else {
          return;
        }
      } else if (field === 'role') {
        const customRole = await showInputModal('Add New Role', 'Enter role...');
        if (customRole && !cachedRoles.includes(customRole)) {
          cachedRoles.push(customRole);
        cachedRoles.sort();
          newValue = customRole;
        } else if (customRole && cachedRoles.includes(customRole)) {
          showMessage('This role already exists', 'error');
          return;
      } else {
          return;
        }
      }
    }
    
    // Only update if value changed
    if (newValue !== currentValue) {
    // Update local data
      row[field] = newValue;
    
      // Update display
    if (field === 'startTime' || field === 'endTime') {
        displaySpan.textContent = formatTime(newValue);
        // Recalculate hours
      row.totalHours = calculateHours(row.startTime, row.endTime);
      const tr = cell.closest('tr');
        const hoursCell = tr.querySelector('.total-hours-cell');
        if (hoursCell) {
          hoursCell.textContent = row.totalHours;
        }
      } else {
        displaySpan.textContent = newValue || (field === 'notes' ? '' : 'Click to add');
      }
      
      // Mark as changed
      markChanged(rowId);
    }
  };
  
  // Simple blur handler
  input.addEventListener('blur', () => {
    // Small delay to allow clicking other cells
    setTimeout(async () => {
      if (input.parentNode) {
        await updateValue(input.value);
        exitEdit();
      }
    }, 100);
  });
  
  // Handle keyboard navigation
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await updateValue(input.value);
      exitEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      await updateValue(input.value);
      exitEdit();
      
      // Move to next/previous field
      const targetCell = e.shiftKey ? getPreviousEditableCell() : getNextEditableCell();
      if (targetCell) {
        const targetRow = tableData.rows.find(r => r._id === targetCell.getAttribute('data-row-id'));
        if (targetRow) {
          setTimeout(() => makeEditable(targetCell, targetRow), 50);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Cancel without saving
      exitEdit();
    }
  });
}

// Bulk save all changes to the server using single atomic request
async function saveAllChanges(silent = false) {
  if (!hasUnsavedChanges) {
    if (!silent) {
      showMessage('No changes to save', 'info');
    }
    return;
  }
  
  // Prevent concurrent saves
  if (isSaving) {
    console.log('⏳ Already saving, skipping...');
    return;
  }
  
  isSaving = true;
  updateSaveStatus('saving');
  
  try {
    // Build bulk payload
    const updates = [];
    for (const rowId of changedRows) {
      if (deletedRows.has(rowId)) continue; // Skip rows marked for deletion
      const row = tableData.rows.find(r => r._id === rowId);
      if (row) {
        updates.push({
          rowId: rowId,
          data: {
            date: row.date,
            name: row.name,
            role: row.role,
            startTime: row.startTime,
            endTime: row.endTime,
            totalHours: row.totalHours,
            notes: row.notes,
            userId: row.userId || null,
            resetAvailability: row.__resetAvailability ? true : undefined
          }
        });
      }
    }
    
    const deletes = Array.from(deletedRows);
    
    const totalOps = updates.length + deletes.length;
    if (totalOps === 0) {
      console.log('⚠️ No changes to save');
      hasUnsavedChanges = false;
      updateSaveStatus();
      return;
    }
    
    console.log(`💾 Bulk saving: ${updates.length} updates, ${deletes.length} deletes`);
    suppressNextSocketEvent(); // Don't reload from our own save
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/crew-bulk`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({ updates, deletes })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bulk save failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ Bulk save complete: ${result.successCount} operations`);
    
    // Clear changed tracking
    changedRows.clear();
    deletedRows.clear();
    hasUnsavedChanges = false;
    tableData.rows.forEach(r => { delete r.__resetAvailability; });
    
    // Clear localStorage backup
    clearLocalStorage();
    
    // Update UI
    updateSaveStatus('saved');
    
    if (!silent) {
      showMessage(`All changes saved successfully`, 'success');
    }
    
  } catch (error) {
    console.error('❌ Failed to save changes:', error);
    if (!silent) {
      showMessage('Failed to save changes. Please try again.', 'error');
    }
    updateSaveStatus('unsaved');
  } finally {
    isSaving = false;
  }
}

// Add new name
function handleAddNewName(rowId) {
  const newName = prompt('Enter new name:');
  if (newName && !cachedUsers.some(u => u.name === newName)) {
    cachedUsers.push({ name: newName });
    cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
    
    const select = document.getElementById(`row-${rowId}-name`);
    if (select) {
      select.innerHTML = `
        <option value="">-- Select Name --</option>
        ${cachedUsers.map(u => `<option value="${u.name}" ${u.name === newName ? 'selected' : ''}>${u.name}</option>`).join('')}
        <option value="__add_new__">➕ Add new name</option>
      `;
      select.value = newName;
    }
    
    handleFieldChange(rowId, 'name', newName);
  } else {
    const select = document.getElementById(`row-${rowId}-name`);
    if (select) {
      const row = tableData.rows.find(r => r._id === rowId);
      select.value = row ? row.name : '';
    }
  }
}

// Add new role
function handleAddNewRole(rowId) {
  const newRole = prompt('Enter new role:');
  if (newRole && !cachedRoles.includes(newRole)) {
    cachedRoles.push(newRole);
    cachedRoles.sort();
    
    const select = document.getElementById(`row-${rowId}-role`);
    if (select) {
      select.innerHTML = `
        <option value="">-- Select Role --</option>
        ${cachedRoles.map(r => `<option value="${r}" ${r === newRole ? 'selected' : ''}>${r}</option>`).join('')}
        <option value="__add_new__">➕ Add new role</option>
      `;
      select.value = newRole;
    }
    
    handleFieldChange(rowId, 'role', newRole);
    } else {
    const select = document.getElementById(`row-${rowId}-role`);
    if (select) {
      const row = tableData.rows.find(r => r._id === rowId);
      select.value = row ? row.role : '';
    }
  }
}

// Add new row
async function addRow(date) {
  if (!isOwner) return;
  
  try {
    const newRow = {
      date,
      name: '',
      role: '',
      startTime: '',
      endTime: '',
      totalHours: 0,
      notes: ''
    };
    
    console.log('📝 Adding new row:', newRow);
    suppressNextSocketEvent(); // Don't reload from our own save
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/rows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify(newRow)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', response.status, errorText);
      throw new Error(`Failed to add row: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ Server response:', result);
    
    // Server now returns { row: {...} }
    const savedRow = result.row;
    
    if (savedRow && savedRow._id) {
      // Ensure date is set correctly
      if (!savedRow.date) {
        savedRow.date = date;
      }
      
      // Add to local data
      tableData.rows.push(savedRow);
      
      // Re-render immediately
      renderTableSection();
      updateCrewCount();
      showMessage('Row added successfully!', 'success');
    } else {
      console.error('❌ Invalid response format:', result);
      // Fallback: reload from server to stay in sync
      await loadTable();
      showMessage('Row added!', 'success');
    }
    
  } catch (error) {
    console.error('❌ Failed to add row:', error);
    showMessage('Failed to add row. Please try again.', 'error');
  }
}

// Delete row
async function deleteRow(rowId) {
  if (!isOwner) return;
  
  // Get row details for confirmation message
  const row = tableData.rows.find(r => r._id === rowId);
  const rowName = row && row.name ? row.name : 'this crew member';
  
  const confirmed = await showDeleteConfirmation(
    'Delete Crew Member',
    `Are you sure you want to delete ${rowName}? This will be saved automatically.`
  );
  
  if (!confirmed) return;
  
  console.log(`🗑️ Deleting row ${rowId}`);
  
  // Mark for deletion
  deletedRows.add(rowId);
  hasUnsavedChanges = true;
  
  // Remove from local display immediately
  const beforeLength = tableData.rows.length;
  tableData.rows = tableData.rows.filter(r => r._id !== rowId);
  const afterLength = tableData.rows.length;
  
  console.log(`✅ Removed from local data: ${beforeLength} → ${afterLength} rows`);
  
  // Update UI
  updateSaveStatus();
  saveToLocalStorage();
  renderTableSection();
  updateCrewCount();
  
  showMessage(`Deleting ${rowName || 'row'}...`, 'info');
  
  // Trigger autosave to persist the deletion
  triggerAutosave();
}

// Show date picker modal
function showDatePickerModal() {
  return new Promise((resolve) => {
    // Remove any existing modal
    const existingModal = document.querySelector('.date-picker-modal');
    if (existingModal) existingModal.remove();
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'date-picker-modal';
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    modal.innerHTML = `
      <div class="date-picker-content">
        <h3>
          <span class="material-symbols-outlined">event</span>
          Add New Date
        </h3>
        <input type="date" id="datePickerInput" class="date-picker-input" value="${today}" />
        <div class="date-picker-buttons">
          <button class="date-picker-cancel-btn" id="datePickerCancel">Cancel</button>
          <button class="date-picker-confirm-btn" id="datePickerConfirm">Add Date</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const dateInput = document.getElementById('datePickerInput');
    const cancelBtn = document.getElementById('datePickerCancel');
    const confirmBtn = document.getElementById('datePickerConfirm');
    
    // Focus the input field
    setTimeout(() => dateInput.focus(), 100);
    
    // Handle cancel
    const handleCancel = () => {
      modal.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => {
        modal.remove();
        resolve(null);
      }, 200);
    };
    
    // Handle confirm
    const handleConfirm = () => {
      const date = dateInput.value;
      if (date) {
        modal.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => {
          modal.remove();
          resolve(date);
        }, 200);
      } else {
        dateInput.focus();
      }
    };
    
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    
    // Enter key to confirm
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    });
    
    // Click outside to cancel
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
  });
}

// Add new date section
async function addDateSection() {
  if (!isOwner) return;
  
  const date = await showDatePickerModal();
  if (!date) return; // User cancelled
  
  const exists = tableData.rows.some(row => row.date === date);
  if (exists) {
    showMessage('This date already exists.', 'error');
    return;
  }
  
  try {
    showMessage('Adding date...', 'info');
    
    const newRow = {
      date,
      role: '__placeholder__',
      name: '',
      startTime: '',
      endTime: '',
      totalHours: 0,
      notes: ''
    };
    
    suppressNextSocketEvent();
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/rows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify(newRow)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to add date: ${response.status}`);
    }
    
    await loadTable();
    showMessage('Date added successfully!', 'success');
    
  } catch (error) {
    console.error('❌ Failed to add date:', error);
    showMessage('Failed to add date. Please try again.', 'error');
  }
}

// Delete entire date section
async function deleteDate(date) {
  if (!isOwner) return;
  
  // Count rows for this date
  const dateRows = tableData.rows.filter(row => row.date === date);
  const rowCount = dateRows.length;
  const formattedDate = formatDateLocal(date);
  
  const confirmed = await showDeleteConfirmation(
    'Delete Entire Date',
    `Are you sure you want to delete ${formattedDate} and all ${rowCount} crew member${rowCount !== 1 ? 's' : ''} assigned to this date? This will be saved automatically.`
  );
  
  if (!confirmed) return;
  
  console.log(`🗑️ Deleting date ${date} (${rowCount} rows)`);
  
  // Mark all rows for this date as deleted
  dateRows.forEach(row => {
    deletedRows.add(row._id);
  });
  
  hasUnsavedChanges = true;
  
  // Remove from local display immediately
  const beforeLength = tableData.rows.length;
  tableData.rows = tableData.rows.filter(row => row.date !== date);
  const afterLength = tableData.rows.length;
  
  console.log(`✅ Removed ${beforeLength - afterLength} rows from local data`);
  
  // Update UI
  updateSaveStatus();
  saveToLocalStorage();
  renderTableSection();
  updateCrewCount();
  
  showMessage(`Deleting ${formattedDate}...`, 'info');
  
  // Trigger autosave to persist the deletion
  triggerAutosave();
}

// Drag and drop for reordering
function handleDrop(targetId, draggedId) {
  if (targetId === draggedId) return;

  const rows = tableData.rows;
  const draggedIndex = rows.findIndex(r => r._id === draggedId);
  const targetIndex = rows.findIndex(r => r._id === targetId);

  if (draggedIndex === -1 || targetIndex === -1) return;

  if (rows[draggedIndex].date !== rows[targetIndex].date) {
    alert("You can only reorder within the same day.");
      return;
    }
    
  const [movedRow] = rows.splice(draggedIndex, 1);
  rows.splice(targetIndex, 0, movedRow);

  saveRowOrder();
  renderTableSection();
}

async function saveRowOrder() {
  try {
    console.log('🔄 Saving row order...');
    suppressNextSocketEvent();
    const response = await fetch(`${API_BASE}/api/tables/${tableId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
      body: JSON.stringify({ rows: tableData.rows })
      });
      
      if (!response.ok) {
      throw new Error(`Failed to save row order: ${response.status}`);
    }

    console.log('✅ Row order saved');
  } catch (error) {
    console.error('❌ Failed to save row order:', error);
    showMessage('Failed to save row order.', 'error');
  }
}

// Update crew count
function updateCrewCount() {
  // Crew count removed - now shown in crew list modal
}

// Filter functions
function saveFilterState() {
  const filterDate = document.getElementById('filterDate')?.value || '';
  const searchInput = document.getElementById('searchInput')?.value || '';
  
  localStorage.setItem(`crew_filter_date_${tableId}`, filterDate);
  localStorage.setItem(`crew_search_${tableId}`, searchInput);
}

function restoreFilterState() {
  const savedFilterDate = localStorage.getItem(`crew_filter_date_${tableId}`) || '';
  const savedSearch = localStorage.getItem(`crew_search_${tableId}`) || '';
  
  const filterDateEl = document.getElementById('filterDate');
  const searchInputEl = document.getElementById('searchInput');
  
  if (filterDateEl) filterDateEl.value = savedFilterDate;
  if (searchInputEl) searchInputEl.value = savedSearch;
}

// Show message to user
function showMessage(message, type = 'info') {
  const messageEl = document.createElement('div');
  messageEl.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 14px 24px;
    border-radius: 8px;
    font-weight: 500;
    font-size: 14px;
    z-index: 10001;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    transition: all 0.3s ease;
    ${type === 'success' ? 'background: #065f46; color: #d1fae5; border: 1px solid #10b981;' : 
      type === 'error' ? 'background: #7f1d1d; color: #fecaca; border: 1px solid #ef4444;' :
      'background: #1e293b; color: #e2e8f0; border: 1px solid #475569;'}
  `;
  messageEl.textContent = message;
  
  document.body.appendChild(messageEl);
  
  setTimeout(() => {
    messageEl.style.opacity = '0';
    messageEl.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      if (messageEl.parentNode) {
        messageEl.parentNode.removeChild(messageEl);
      }
    }, 300);
  }, 3000);
}

// Show custom confirmation modal
// Show input modal for adding new items
function showInputModal(title, placeholder, defaultValue = '') {
  return new Promise((resolve) => {
    // Remove any existing modal
    const existingModal = document.querySelector('.input-modal');
    if (existingModal) existingModal.remove();
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'input-modal';
    modal.innerHTML = `
      <div class="input-modal-content">
        <h3>
          <span class="material-symbols-outlined">add_circle</span>
          ${title}
        </h3>
        <input type="text" id="inputModalField" class="input-modal-field" placeholder="${placeholder}" value="${defaultValue}" />
        <div class="input-modal-buttons">
          <button class="input-cancel-btn" id="inputModalCancel">Cancel</button>
          <button class="input-confirm-btn" id="inputModalConfirm">Add</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const inputField = document.getElementById('inputModalField');
    const cancelBtn = document.getElementById('inputModalCancel');
    const confirmBtn = document.getElementById('inputModalConfirm');
    
    // Focus the input field
    setTimeout(() => {
      inputField.focus();
      inputField.select();
    }, 100);
    
    // Handle cancel
    const handleCancel = () => {
      modal.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => {
        modal.remove();
        resolve(null);
      }, 200);
    };
    
    // Handle confirm
    const handleConfirm = () => {
      const value = inputField.value.trim();
      if (value) {
        modal.style.animation = 'fadeOut 0.2s ease';
        setTimeout(() => {
          modal.remove();
          resolve(value);
        }, 200);
      } else {
        inputField.focus();
      }
    };
    
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    
    // Enter key to confirm
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    });
    
    // Click outside to cancel
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
  });
}

function showDeleteConfirmation(title, message) {
  return new Promise((resolve) => {
    // Remove any existing modal
    const existingModal = document.querySelector('.delete-confirmation-modal');
    if (existingModal) existingModal.remove();
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'delete-confirmation-modal';
    modal.innerHTML = `
      <div class="delete-confirmation-content">
        <h3>
          <span class="material-symbols-outlined">warning</span>
          ${title}
        </h3>
        <p>${message}</p>
        <div class="delete-confirmation-buttons">
          <button class="delete-cancel-btn" id="deleteModalCancel">Cancel</button>
          <button class="delete-confirm-btn" id="deleteModalConfirm">Delete</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus the cancel button by default for safety
    const cancelBtn = document.getElementById('deleteModalCancel');
    const confirmBtn = document.getElementById('deleteModalConfirm');
    
    setTimeout(() => cancelBtn.focus(), 100);
    
    // Handle cancel
    const handleCancel = () => {
      modal.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => {
        modal.remove();
        resolve(false);
      }, 200);
    };
    
    // Handle confirm
    const handleConfirm = () => {
      modal.style.animation = 'fadeOut 0.2s ease';
      setTimeout(() => {
        modal.remove();
        resolve(true);
      }, 200);
    };
    
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    });
    
    // Handle keyboard shortcuts
    document.addEventListener('keydown', function escapeHandler(e) {
      if (e.key === 'Escape') {
        handleCancel();
        document.removeEventListener('keydown', escapeHandler);
      } else if (e.key === 'Enter' && e.target === confirmBtn) {
        handleConfirm();
        document.removeEventListener('keydown', escapeHandler);
      }
    });
  });
}

// Crew List Modal
function showCrewListModal() {
  const uniqueCrewNames = Array.from(new Set((tableData.rows || []).map(row => row.name).filter(Boolean)));
  const crewArr = uniqueCrewNames.map(name => {
    const user = cachedUsers.find(u => u.name === name);
    return { name, email: user ? user.email : null };
  });
  
  if (crewArr.length === 0) {
    showMessage('No crew found.', 'info');
    return;
  }
  
  let modal = document.getElementById('crewListModal');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'crewListModal';
  modal.className = 'dark-modal show';
  modal.innerHTML = `
    <div class="dark-modal-content" style="max-width:500px;width:92vw;">
      <div class="modal-header-dark">
        <h3>Crew List</h3>
        <span style="background:var(--bg-tertiary);color:var(--text-secondary);padding:4px 12px;border-radius:20px;font-size:0.85rem;font-weight:500;">
          ${crewArr.length} member${crewArr.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div class="modal-body-dark" style="max-height:400px;overflow-y:auto;padding:16px 24px;">
        <ul style="list-style:none;padding:0;margin:0;">
          ${crewArr.map(({name, email}) => `
            <li style="padding:14px;margin-bottom:8px;background:var(--bg-tertiary);border-radius:8px;border-left:3px solid var(--brand-red);">
              <div style="font-weight:600;color:var(--text-primary);font-size:0.95rem;margin-bottom:4px;">${name}</div>
              ${email ? `<a href="mailto:${email}" style="color:var(--text-secondary);text-decoration:none;font-size:0.85rem;">
                ${email}
              </a>` : '<span style="color:var(--text-muted);font-size:0.85rem;">No email</span>'}
            </li>
          `).join('')}
        </ul>
      </div>
      <div class="modal-footer-dark">
        <button class="btn-secondary" id="closeCrewListModalBtn">Close</button>
        <button class="btn-primary" id="emailEveryoneBtn">Email Everyone</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const closeBtn = document.getElementById('closeCrewListModalBtn');
  closeBtn.onclick = () => modal.remove();
  
  const emailBtn = document.getElementById('emailEveryoneBtn');
  emailBtn.onclick = () => {
    const allEmails = crewArr.filter(c => c.email).map(c => c.email).join(',');
    if (allEmails) {
      const mailto = `mailto:${allEmails}`;
      window.location.href = mailto;
      showMessage('Opening email client...', 'success');
    } else {
      showMessage('No emails found for crew.', 'error');
    }
  };
  
  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

// Export CSV
function exportCrewCsv() {
  if (!tableData || !Array.isArray(tableData.rows)) return;
  
  const header = ['Name', 'Start', 'End', 'Total', 'Role', 'Notes', 'Date'];
  const rows = tableData.rows.filter(row => row.role !== '__placeholder__');
  const csvRows = [header.join(',')];
  
  rows.forEach(row => {
    const values = [
      row.name || '',
      row.startTime || '',
      row.endTime || '',
      row.totalHours || '',
      row.role || '',
      row.notes ? '"' + String(row.notes).replace(/"/g, '""') + '"' : '',
      row.date || ''
    ];
    csvRows.push(values.map(v => {
      v = String(v);
      return v.includes(',') ? '"' + v + '"' : v;
    }).join(','));
  });
  
  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'crew.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Crew Cost Calculator
function showCrewCostCalcModal() {
  if (!isOwner) {
    showMessage('Access denied. Only event owners can view the crew cost calculator.', 'error');
    return;
  }
  
  const rows = (tableData.rows || []).filter(row => row.role !== '__placeholder__' && row.name && row.role);
  if (!rows.length) {
    showMessage('No crew data available.', 'info');
    return;
  }
  
  const crewMap = {};
  rows.forEach(row => {
    const key = row.name + '||' + row.role;
    if (!crewMap[key]) {
      crewMap[key] = { name: row.name, role: row.role, totalHours: 0 };
    }
    crewMap[key].totalHours += parseFloat(row.totalHours) || 0;
  });
  
  let modal = document.getElementById('crewCostCalcModal');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'crewCostCalcModal';
  modal.className = 'dark-modal show';
  
  modal.innerHTML = `
    <div class="dark-modal-content" style="max-width:700px;width:96vw;max-height:90vh;">
      <div class="modal-header-dark">
        <h3>Crew Cost Calculator</h3>
        <button class="modal-close-btn" id="closeCrewCostCalcModalBtn">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="modal-body-dark" style="flex:1;overflow-y:auto;padding:16px 24px;">
        <table class="cost-calc-table" style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <thead>
            <tr style="background:var(--bg-tertiary);border-bottom:1px solid var(--border-default);">
              <th style="padding:12px;text-align:left;color:var(--text-secondary);font-weight:500;">Name</th>
              <th style="padding:12px;text-align:left;color:var(--text-secondary);font-weight:500;">Role</th>
              <th style="padding:12px;text-align:right;color:var(--text-secondary);font-weight:500;">Hours</th>
              <th style="padding:12px;text-align:right;color:var(--text-secondary);font-weight:500;">Rate</th>
              <th style="padding:12px;text-align:right;color:var(--text-secondary);font-weight:500;">Cost</th>
            </tr>
          </thead>
          <tbody id="crewCostCalcTableBody">
          </tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;padding:16px 0;border-top:1px solid var(--border-default);margin-top:16px;">
          <div style="font-size:1.1rem;color:var(--text-primary);">
            <strong>Total: <span style="color:var(--brand-red);">$<span id="crewCostCalcTotal">0.00</span></span></strong>
      </div>
      </div>
      </div>
      <div class="modal-footer-dark" id="crewCostCalcFooter">
        <button class="btn-secondary" id="closeCostCalcBtn">Close</button>
      </div>
    </div>
  `;
  document.getElementById('crewCostCalcModalContainer').appendChild(modal);

  const crewRates = {};
  Object.values(crewMap).forEach(crew => {
    const key = crew.name + '||' + crew.role;
    crewRates[key] = (tableData.crewRates && tableData.crewRates[key] !== undefined) ? String(tableData.crewRates[key]) : '';
  });

  function renderTable(focusedKey, caretPos) {
    const tbody = document.getElementById('crewCostCalcTableBody');
    let total = 0;
    tbody.innerHTML = Object.values(crewMap).map(crew => {
      const key = crew.name + '||' + crew.role;
      const rate = parseFloat(crewRates[key]);
      const validRate = isNaN(rate) ? 0 : rate;
      const cost = validRate * crew.totalHours;
      total += cost;
      return `<tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:12px;color:var(--text-primary);">${crew.name}</td>
        <td style="padding:12px;color:var(--text-secondary);">${crew.role}</td>
        <td style="padding:12px;text-align:right;color:var(--text-primary);">${crew.totalHours.toFixed(2)}</td>
        <td style="padding:12px;text-align:right;">
          <input type="text" inputmode="decimal" data-key="${key}" value="${crewRates[key]}" 
            style="width:80px;padding:6px 8px;font-size:0.9rem;background:var(--bg-tertiary);border:1px solid var(--border-default);border-radius:6px;color:var(--text-primary);text-align:right;"
            placeholder="0.00">
        </td>
        <td style="padding:12px;text-align:right;color:var(--brand-red);font-weight:500;">$${cost.toFixed(2)}</td>
      </tr>`;
    }).join('');
    document.getElementById('crewCostCalcTotal').textContent = total.toFixed(2);
    
    if (focusedKey) {
      const input = tbody.querySelector(`input[data-key='${focusedKey}']`);
      if (input) {
        input.focus();
        if (typeof caretPos === 'number') {
          input.setSelectionRange(caretPos, caretPos);
        }
      }
    }
  }
  renderTable();

  modal.addEventListener('input', function(e) {
    if (e.target && e.target.matches('input[data-key]')) {
      const key = e.target.getAttribute('data-key');
      crewRates[key] = e.target.value;
      const caretPos = e.target.selectionStart;
      renderTable(key, caretPos);
    }
  });

  if (isOwner) {
    const footer = document.getElementById('crewCostCalcFooter');
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Rates';
    saveBtn.className = 'btn-primary';
    saveBtn.id = 'saveCrewRatesBtn';
    footer.appendChild(saveBtn);
    
    saveBtn.onclick = async function() {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      try {
        const res = await fetch(`${API_BASE}/api/tables/${tableId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token
          },
          body: JSON.stringify({ crewRates })
        });
        if (res.ok) {
          saveBtn.textContent = 'Saved!';
          tableData.crewRates = JSON.parse(JSON.stringify(crewRates));
          setTimeout(() => { saveBtn.textContent = 'Save Rates'; saveBtn.disabled = false; }, 1200);
        } else {
          const err = await res.text();
          saveBtn.textContent = 'Error';
          showMessage('Failed to save rates: ' + err, 'error');
          saveBtn.disabled = false;
        }
      } catch (err) {
        saveBtn.textContent = 'Error';
        showMessage('Failed to save rates: ' + err.message, 'error');
        saveBtn.disabled = false;
      }
    };
  }

  document.getElementById('closeCrewCostCalcModalBtn').onclick = () => modal.remove();
  document.getElementById('closeCostCalcBtn').onclick = () => modal.remove();
  
  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
}

// Attach event listeners
function attachEventListeners() {
  const addDateBtn = document.getElementById('addDateBtn');
  if (addDateBtn) {
    addDateBtn.onclick = () => addDateSection();
  }
  
  // Confirm add date button
  const confirmAddDateBtn = document.getElementById('confirmAddDateBtn');
  if (confirmAddDateBtn) {
    confirmAddDateBtn.onclick = async () => {
      const dateInput = document.getElementById('addDateInput');
      const date = dateInput?.value;
      if (date) {
        window.hideAddDateModal();
        await addDateWithValue(date);
      }
    };
  }
  
  const filterDate = document.getElementById('filterDate');
  if (filterDate) {
    filterDate.onchange = () => {
      saveFilterState();
      renderTableSection();
    };
  }
  
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.oninput = () => {
      saveFilterState();
      renderTableSection();
    };
  }
  
  // Show All / Show Mine filter buttons
  const showAllBtn = document.getElementById('showAllBtn');
  const showMineBtn = document.getElementById('showMineBtn');
  
  if (showAllBtn) {
    showAllBtn.onclick = () => {
      showMineOnly = false;
      showAllBtn.classList.add('active');
      if (showMineBtn) showMineBtn.classList.remove('active');
      renderTableSection();
    };
  }
  
  if (showMineBtn) {
    showMineBtn.onclick = () => {
      showMineOnly = true;
      showMineBtn.classList.add('active');
      if (showAllBtn) showAllBtn.classList.remove('active');
      renderTableSection();
    };
  }
  
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.onclick = exportCrewCsv;
  
    const costCalcBtn = document.getElementById('crewCostCalcBtn');
    if (costCalcBtn) costCalcBtn.onclick = showCrewCostCalcModal;
  
  const crewListBtn = document.getElementById('crewListBtn');
  if (crewListBtn) crewListBtn.onclick = showCrewListModal;
  
  const requestAvailabilityBtn = document.getElementById('requestAvailabilityBtn');
  if (requestAvailabilityBtn) requestAvailabilityBtn.onclick = showRequestAvailabilityModal;
  
  // Setup action menu handlers
  setupActionMenuHandlers();
  
  // Save shift button
  const saveShiftBtn = document.getElementById('saveShiftBtn');
  if (saveShiftBtn) saveShiftBtn.onclick = saveShiftFromModal;
  
  // Mobile menu button
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('crewSidebar');
  const overlay = document.getElementById('crewSidebarOverlay');
  
  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.onclick = () => {
      sidebar.classList.toggle('open');
      overlay?.classList.toggle('show');
    };
  }
  
  if (overlay) {
    overlay.onclick = () => {
      sidebar?.classList.remove('open');
      overlay.classList.remove('show');
    };
  }
  
  // Load user info for sidebar
  loadSidebarUser();
}

// Load user info for sidebar
async function loadSidebarUser() {
  try {
    const nameEl = document.getElementById('sidebarUserName');
    const avatarImg = document.getElementById('sidebarAvatarImg');
    const avatarIcon = document.getElementById('sidebarAvatarIcon');
    
    // First, set name from localStorage for instant display
    let userName = localStorage.getItem('fullName');
    
    if (!userName) {
      // Fallback to token
      const tokenStr = localStorage.getItem('token');
      if (tokenStr) {
        const payload = JSON.parse(atob(tokenStr.split('.')[1]));
        userName = payload.fullName || payload.name || payload.email || 'User';
      }
    }
    
    if (nameEl && userName) nameEl.textContent = userName;
    
    // Try to fetch user photo (optional - may not be implemented)
    try {
      const userId = getUserIdFromToken();
      if (userId) {
        const res = await fetch(`${API_BASE}/api/users/${userId}`, {
          headers: { Authorization: token }
        });
        
        if (res.ok) {
          const user = await res.json();
          
          // Update name if we got a better one from API
          if (nameEl && user.name) nameEl.textContent = user.name;
          
          if (user.photo && avatarImg) {
            avatarImg.src = user.photo;
            avatarImg.style.display = 'block';
            if (avatarIcon) avatarIcon.style.display = 'none';
          }
        }
        // Silently ignore 404 - endpoint may not be implemented
      }
    } catch (photoErr) {
      // Photo fetch failed - not critical, just use default avatar
    }
  } catch (err) {
    console.error('Failed to load user:', err);
  }
}

// Add date with specific value
async function addDateWithValue(date) {
  if (!isOwner) return;
  
  const exists = tableData.rows.some(row => row.date === date);
  if (exists) {
    showMessage('This date already exists.', 'error');
    return;
  }
  
  try {
    showMessage('Adding date...', 'info');
    
    const newRow = {
      date,
      role: '__placeholder__',
      name: '',
      startTime: '',
      endTime: '',
      totalHours: 0,
      notes: ''
    };
    
    suppressNextSocketEvent();
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/rows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify(newRow)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to add date: ${response.status}`);
    }
    
    await loadTable();
    showMessage('Date added successfully!', 'success');
    
  } catch (error) {
    console.error('❌ Failed to add date:', error);
    showMessage('Failed to add date. Please try again.', 'error');
  }
}

// Initialize page
function initPage(id) {
  // Update tableId if provided
  if (id) {
    tableId = id;
    localStorage.setItem('eventId', id);
  }
  
  loadTable().then(() => {
    attachEventListeners();
    document.body.classList.add('crew-page');
  });
}

// Export functions to window
window.initPage = initPage;
window.addDateSection = addDateSection;
window.addRow = addRow;
window.deleteRow = deleteRow;
window.deleteDate = deleteDate;
window.makeEditable = makeEditable;
window.exportCrewCsv = exportCrewCsv;
window.showCrewListModal = showCrewListModal;
window.showCrewCostCalcModal = showCrewCostCalcModal;
window.hideRowActionModal = hideRowActionModal;
window.openEditShiftModal = openEditShiftModal;
window.duplicateRow = duplicateRow;
window.showRequestAvailabilityModal = showRequestAvailabilityModal;
window.setRowAvailability = setRowAvailability;
window.sendAvailabilityRequests = sendAvailabilityRequests;

})();
