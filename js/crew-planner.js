(function() {
'use strict';

// Global variables
let currentTable = null;
let planningData = {
  dates: [],
  events: []
};
let cachedUsers = [];
let customRoles = [];
let defaultRoles = [
  "Lead Photographer",
  "Additional Photographer", 
  "Lead Videographer",
  "Additional Videographer",
  "Headshot Booth Photographer",
  "Assistant"
];

// Authentication check
const token = localStorage.getItem('token');
if (!token) {
  alert('Not logged in');
  window.location.href = '../index.html';
  return;
}

// Admin role check
function checkAdminRole() {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role !== 'admin') {
      alert('Access denied. Admin privileges required.');
      window.location.href = '../dashboard.html#events';
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error checking admin role:', err);
    return false;
  }
}

// Initialize page
function initPage() {
  if (!checkAdminRole()) return;
  
  loadUsers();
  loadCustomRoles();
  loadTables();
  attachEventListeners();
  
  // Try to restore from session storage
  restoreFromSessionStorage();
  
  renderTable();
}

// Load users for crew dropdown
async function loadUsers() {
  try {
    const response = await fetch(`${API_BASE}/api/users`, {
      headers: { Authorization: token }
    });
    
    if (response.ok) {
      const users = await response.json();
      cachedUsers = users.sort((a, b) => {
        const nameA = a.fullName || a.name || a.email || '';
        const nameB = b.fullName || b.name || b.email || '';
        return nameA.localeCompare(nameB);
      });
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

// Load custom roles from localStorage
function loadCustomRoles() {
  const stored = localStorage.getItem('crewPlannerCustomRoles');
  if (stored) {
    try {
      customRoles = JSON.parse(stored);
    } catch (error) {
      console.error('Error loading custom roles:', error);
      customRoles = [];
    }
  }
}

// Save custom roles to localStorage
function saveCustomRoles() {
  localStorage.setItem('crewPlannerCustomRoles', JSON.stringify(customRoles));
}

// Add custom role if it doesn't exist
function addCustomRole(role) {
  const trimmedRole = role.trim();
  if (trimmedRole && !defaultRoles.includes(trimmedRole) && !customRoles.includes(trimmedRole)) {
    customRoles.push(trimmedRole);
    saveCustomRoles();
    return true;
  }
  return false;
}

// Get all available roles (default + custom)
function getAllRoles() {
  return [...defaultRoles, ...customRoles];
}

// Create role dropdown HTML
function createRoleDropdown(selectedValue, changeHandler, eventName, crewIndex) {
  const allRoles = getAllRoles();
  let options = '<option value=""></option>';
  
  allRoles.forEach(role => {
    const selected = role === selectedValue ? 'selected' : '';
    options += `<option value="${escapeHtml(role)}" ${selected}>${escapeHtml(role)}</option>`;
  });
  
  options += '<option value="__custom__">Add Custom Role...</option>';
  
  return `
    <select onchange="${changeHandler}" data-event="${escapeHtml(eventName)}" data-crew-index="${crewIndex}">
      ${options}
    </select>
  `;
}

// Create crew dropdown HTML  
function createCrewDropdown(selectedValue, changeHandler, eventName, crewIndex) {
  let options = '<option value=""></option>';
  let foundSelected = !selectedValue; // Track if we found the selected value
  
  cachedUsers.forEach(user => {
    const displayName = user.fullName || user.name || user.email;
    const selected = displayName === selectedValue ? 'selected' : '';
    if (selected) foundSelected = true;
    options += `<option value="${escapeHtml(displayName)}" ${selected}>${escapeHtml(displayName)}</option>`;
  });
  
  // If selectedValue exists but wasn't found in users, add it as a custom option
  if (selectedValue && !foundSelected) {
    options += `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`;
  }
  
  options += '<option value="__custom__">Add Custom Name...</option>';
  
  return `
    <select onchange="${changeHandler}" data-event="${escapeHtml(eventName)}" data-crew-index="${crewIndex}">
      ${options}
    </select>
  `;
}

// Attach event listeners
function attachEventListeners() {
  // Table management
  document.getElementById('newTableBtn').addEventListener('click', showNewTableModal);
  document.getElementById('loadTableBtn').addEventListener('click', loadSelectedTable);
  document.getElementById('saveTableBtn').addEventListener('click', saveCurrentTable);
  document.getElementById('deleteTableBtn').addEventListener('click', deleteCurrentTable);
  
  // Planning controls
  document.getElementById('addDateBtn').addEventListener('click', addDate);
  document.getElementById('addEventBtn').addEventListener('click', showAddEventModal);
  
  // Modal actions
  window.closeModal = closeModal;
  window.createNewTable = createNewTable;
  window.addNewEvent = addNewEvent;
  window.hideCollisionWarning = hideCollisionWarning;
}

// Table Management Functions
async function loadTables() {
  try {
    const response = await fetch(`${API_BASE}/api/crew-planner`, {
      headers: { Authorization: token }
    });
    
    if (response.ok) {
      const tables = await response.json();
      populateTableSelect(tables);
    } else {
      console.error('Failed to load tables');
    }
  } catch (error) {
    console.error('Error loading tables:', error);
  }
}

function populateTableSelect(tables) {
  const select = document.getElementById('tableSelect');
  select.innerHTML = '<option value="">Select a table...</option>';
  
  tables.forEach(table => {
    const option = document.createElement('option');
    option.value = table._id;
    option.textContent = `${table.name} (${new Date(table.updatedAt).toLocaleDateString()})`;
    select.appendChild(option);
  });
}

async function loadSelectedTable() {
  const tableId = document.getElementById('tableSelect').value;
  if (!tableId) {
    alert('Please select a table to load');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/crew-planner/${tableId}`, {
      headers: { Authorization: token }
    });
    
    if (response.ok) {
      currentTable = await response.json();
      loadTableData(currentTable);
      updateUIState();
    } else {
      alert('Failed to load table');
    }
  } catch (error) {
    console.error('Error loading table:', error);
    alert('Error loading table');
  }
}

function loadTableData(table) {
  // Extract unique events from all dates
  const eventsSet = new Set();
  const datesData = [];
  
  table.dates.forEach(dateData => {
    datesData.push({
      date: dateData.date,
      events: dateData.events || []
    });
    
    dateData.events.forEach(event => {
      eventsSet.add(JSON.stringify({ name: event.name, location: event.location }));
    });
  });
  
  planningData.dates = datesData;
  planningData.events = Array.from(eventsSet).map(str => JSON.parse(str));
  
  // Extract and preserve custom roles from loaded data
  const allUsedRoles = new Set();
  datesData.forEach(dateData => {
    dateData.events.forEach(event => {
      event.crew.forEach(crewMember => {
        if (crewMember.role && crewMember.role.trim()) {
          allUsedRoles.add(crewMember.role.trim());
        }
      });
    });
  });
  
  // Add any new custom roles to our customRoles array
  allUsedRoles.forEach(role => {
    if (!defaultRoles.includes(role) && !customRoles.includes(role)) {
      customRoles.push(role);
    }
  });
  saveCustomRoles();
  
  // Save to session storage for auto-save functionality
  saveToSessionStorage();
  
  // Update UI
  document.getElementById('currentTableName').textContent = table.name;
  document.getElementById('currentTableDescription').textContent = table.description || 'No description';
  document.getElementById('currentTableInfo').style.display = 'block';
  
  updateSaveButtonState();
  renderTable();
}

async function saveCurrentTable() {
  if (!currentTable) {
    alert('No table loaded');
    return;
  }
  
  try {
    const tableData = {
      name: currentTable.name,
      description: currentTable.description,
      dates: planningData.dates
    };
    
    const response = await fetch(`${API_BASE}/api/crew-planner/${currentTable._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify(tableData)
    });
    
    if (response.ok) {
      currentTable = await response.json();
      
      // Clear session storage after successful save
      clearSessionStorage();
      
      alert('Table saved successfully');
    } else {
      alert('Failed to save table');
    }
  } catch (error) {
    console.error('Error saving table:', error);
    alert('Error saving table');
  }
}

async function deleteCurrentTable() {
  if (!currentTable) {
    alert('No table loaded');
    return;
  }
  
  if (!confirm(`Are you sure you want to delete the table "${currentTable.name}"? This action cannot be undone.`)) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/crew-planner/${currentTable._id}`, {
      method: 'DELETE',
      headers: { Authorization: token }
    });
    
    if (response.ok) {
      alert('Table deleted successfully');
      currentTable = null;
      planningData = { dates: [], events: [] };
      updateUIState();
      renderTable();
      loadTables();
    } else {
      alert('Failed to delete table');
    }
  } catch (error) {
    console.error('Error deleting table:', error);
    alert('Error deleting table');
  }
}

// Modal Functions
function showNewTableModal() {
  document.getElementById('newTableModal').classList.add('show');
  document.getElementById('tableName').focus();
}

function showAddEventModal() {
  if (!currentTable) {
    alert('Please load or create a table first');
    return;
  }
  document.getElementById('addEventModal').classList.add('show');
  document.getElementById('eventName').focus();
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('show');
  
  // Focus appropriate field
  if (modalId === 'newTableModal') {
    document.getElementById('tableName').focus();
  } else if (modalId === 'addEventModal') {
    document.getElementById('eventName').focus();
  }
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
  
  // Clear form fields only if not editing
  if (modalId === 'newTableModal') {
    document.getElementById('tableName').value = '';
    document.getElementById('tableDescription').value = '';
  } else if (modalId === 'addEventModal') {
    // Only clear if not in edit mode
    if (!document.getElementById('addEventModal').dataset.editingEvent) {
      document.getElementById('eventName').value = '';
      document.getElementById('eventLocation').value = '';
    }
  }
}

async function createNewTable() {
  const name = document.getElementById('tableName').value.trim();
  const description = document.getElementById('tableDescription').value.trim();
  
  if (!name) {
    alert('Please enter a table name');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/api/crew-planner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({ name, description })
    });
    
    if (response.ok) {
      currentTable = await response.json();
      planningData = { dates: [], events: [] };
      
      closeModal('newTableModal');
      updateUIState();
      renderTable();
      loadTables();
      
      // Update current table info
      document.getElementById('currentTableName').textContent = currentTable.name;
      document.getElementById('currentTableDescription').textContent = currentTable.description || 'No description';
      document.getElementById('currentTableInfo').style.display = 'block';
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to create table');
    }
  } catch (error) {
    console.error('Error creating table:', error);
    alert('Error creating table');
  }
}

function addNewEvent() {
  const name = document.getElementById('eventName').value.trim();
  const location = document.getElementById('eventLocation').value.trim();
  const editingEventName = document.getElementById('addEventModal').dataset.editingEvent;
  
  if (!name) {
    alert('Please enter an event name');
    return;
  }
  
  if (editingEventName) {
    // Editing existing event
    
    // Check if new name conflicts with another event (but allow keeping same name)
    const existingEvent = planningData.events.find(e => 
      e.name.toLowerCase() === name.toLowerCase() && e.name !== editingEventName
    );
    if (existingEvent) {
      alert('An event with this name already exists');
      return;
    }
    
    // Update event in planning data
    const eventToUpdate = planningData.events.find(e => e.name === editingEventName);
    if (eventToUpdate) {
      eventToUpdate.name = name;
      eventToUpdate.location = location;
    }
    
    // Update event names in all date data
    planningData.dates.forEach(dateData => {
      const eventData = dateData.events.find(e => e.name === editingEventName);
      if (eventData) {
        eventData.name = name;
        eventData.location = location;
      }
    });
    
    // Reset modal state
    delete document.getElementById('addEventModal').dataset.editingEvent;
    document.querySelector('#addEventModal .modal-header h3').textContent = 'Add New Event';
    document.querySelector('#addEventModal .btn-primary').textContent = 'Add Event';
    
  } else {
    // Adding new event
    
    // Check if event already exists
    const existingEvent = planningData.events.find(e => 
      e.name.toLowerCase() === name.toLowerCase()
    );
    
    if (existingEvent) {
      alert('An event with this name already exists');
      return;
    }
    
    // Add event to planning data
    planningData.events.push({ name, location });
  }
  
  // Save to session storage
  saveToSessionStorage();
  
  closeModal('addEventModal');
  renderTable();
}

// Planning Functions
function addDate() {
  if (!currentTable) {
    alert('Please load or create a table first');
    return;
  }
  
  const dateInput = document.getElementById('newDate');
  const date = dateInput.value;
  
  if (!date) {
    alert('Please select a date');
    return;
  }
  
  // Check if date already exists
  const existingDate = planningData.dates.find(d => d.date === date);
  if (existingDate) {
    alert('This date already exists in the table');
    return;
  }
  
  // Add date with empty events (no crew initially)
  const newDateData = {
    date: date,
    events: planningData.events.map(event => ({
      name: event.name,
      location: event.location,
      crew: []
    }))
  };
  
  planningData.dates.push(newDateData);
  planningData.dates.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Save to session storage
  saveToSessionStorage();
  
  dateInput.value = '';
  renderTable();
}

function deleteDate(date) {
  const displayDate = parseLocalDate(date);
  const formattedDate = formatDateWithDayName(displayDate);
  
  if (!confirm(`Are you sure you want to delete the date ${formattedDate}?`)) {
    return;
  }
  
  planningData.dates = planningData.dates.filter(d => d.date !== date);
  
  // Save to session storage
  saveToSessionStorage();
  
  renderTable();
}

function deleteEvent(eventName) {
  if (!confirm(`Are you sure you want to delete the event "${eventName}"?`)) {
    return;
  }
  
  // Remove event from events list
  planningData.events = planningData.events.filter(e => e.name !== eventName);
  
  // Remove event data from all dates
  planningData.dates.forEach(dateData => {
    dateData.events = dateData.events.filter(e => e.name !== eventName);
  });
  
  // Save to session storage
  saveToSessionStorage();
  
  renderTable();
}

// Rendering Functions
function renderTable() {
  const tableBody = document.getElementById('tableBody');
  const headerRow = document.getElementById('headerRow');
  
  // Clear existing content
  tableBody.innerHTML = '';
  
  // Clear any existing sub-header rows
  const existingSubHeaders = headerRow.parentNode.querySelectorAll('tr:not(#headerRow)');
  existingSubHeaders.forEach(row => row.remove());
  
  // Rebuild header
  buildTableHeader(headerRow);
  
  if (planningData.dates.length === 0) {
    const colCount = 1 + (planningData.events.length * 2); // 1 date column + 2 columns per event
    tableBody.innerHTML = `
      <tr class="empty-state">
        <td colspan="${colCount}" class="empty-message">
          Add dates and events to start planning crew assignments
        </td>
      </tr>
    `;
    return;
  }
  
  // Render date rows
  planningData.dates.forEach((dateData, dateIndex) => {
    renderDateRow(tableBody, dateData, dateIndex);
  });
  
  // Apply empty crew highlighting after render
  highlightEmptyCrewCells();
}

function highlightEmptyCrewCells() {
  // Find all crew cells (every second cell in event columns, starting from column 3)
  const table = document.querySelector('.crew-planner-page table');
  if (!table) return;
  
  const rows = table.querySelectorAll('tbody tr');
  
  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    let cellIndex = 1; // Start after date column
    
    planningData.events.forEach(() => {
      const roleCell = cells[cellIndex];
      const crewCell = cells[cellIndex + 1];
      
      if (crewCell) {
        // Check if this row has any actual crew data (not just empty add buttons)
        const roleSelect = roleCell?.querySelector('select');
        const crewSelect = crewCell.querySelector('select');
        const hasCrewData = roleSelect || crewSelect;
        
        // Only highlight if there's actual crew data but crew is empty
        if (hasCrewData && crewSelect) {
          const isEmpty = !crewSelect.value || crewSelect.value.trim() === '';
          
          // Apply or remove empty-crew class
          if (isEmpty) {
            crewCell.classList.add('empty-crew');
          } else {
            crewCell.classList.remove('empty-crew');
          }
        } else {
          // Remove highlighting from completely empty rows
          crewCell.classList.remove('empty-crew');
        }
      }
      
      cellIndex += 2; // Move to next event (skip role and crew cells)
    });
  });
}

function buildTableHeader(headerRow) {
  headerRow.innerHTML = `
    <th class="date-header">Date</th>
  `;
  
  planningData.events.forEach((event, index) => {
    const eventHeader = document.createElement('th');
    eventHeader.className = 'event-header';
    if (index > 0) eventHeader.classList.add('event-separator');
    eventHeader.colSpan = 2;
    eventHeader.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: bold;">${escapeHtml(event.name)}</div>
          <div style="font-size: 0.9em; color: #666;">${escapeHtml(event.location)}</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="action-btn edit-btn" onclick="editEvent('${escapeHtml(event.name)}')" title="Edit Event">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="action-btn delete-btn" onclick="deleteEvent('${escapeHtml(event.name)}')" title="Delete Event">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </div>
    `;
    headerRow.appendChild(eventHeader);
  });
  
  // Add sub-headers for Role and Crew
  if (planningData.events.length > 0) {
    const subHeaderRow = document.createElement('tr');
    subHeaderRow.innerHTML = `
      <th class="event-subheader"></th>
    `;
    
    planningData.events.forEach((event, index) => {
      const roleClass = index > 0 ? 'event-subheader event-separator' : 'event-subheader';
      subHeaderRow.innerHTML += `
        <th class="${roleClass}">Role</th>
        <th class="event-subheader">Crew</th>
      `;
    });
    
    headerRow.parentNode.insertBefore(subHeaderRow, headerRow.nextSibling);
  }
}

function renderDateRow(tableBody, dateData, dateIndex) {
  const row = document.createElement('tr');
  
  // Add date separator class for visual separation between dates
  if (dateIndex > 0) {
    row.classList.add('date-separator');
  }
  
  // Date cell with actions
  const dateCell = document.createElement('td');
  dateCell.className = 'date-cell';
  const displayDate = parseLocalDate(dateData.date);
  const formattedDate = formatDateWithDayName(displayDate);
  dateCell.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span>${formattedDate}</span>
      <div style="display: flex; gap: 4px;">
        <button class="action-btn edit-btn" onclick="editDate('${dateData.date}')" title="Edit Date">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button class="action-btn delete-btn" onclick="deleteDate('${dateData.date}')" title="Delete Date">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>
  `;
  row.appendChild(dateCell);
  
  // Find max crew count across all events for this date to determine how many rows we need
  let maxCrewCount = 0;
  dateData.events.forEach(event => {
    maxCrewCount = Math.max(maxCrewCount, event.crew.length);
  });
  
  // Allow zero crew rows - tables can start completely empty
  maxCrewCount = Math.max(maxCrewCount, 0);
  
  // If no crew exists anywhere, we still need to render one row to show the add buttons
  const needsEmptyRow = maxCrewCount === 0;
  if (needsEmptyRow) maxCrewCount = 1;
  
  // Render crew cells for each event - first row
  planningData.events.forEach((planningEvent, eventIndex) => {
    const eventData = dateData.events.find(e => e.name === planningEvent.name) || {
      name: planningEvent.name,
      location: planningEvent.location,
      crew: []
    };
    
    // Add role and crew cells
    const roleCell = document.createElement('td');
    const crewCell = document.createElement('td');
    roleCell.className = 'crew-cell';
    crewCell.className = 'crew-cell';
    
    // Add event separator class for visual separation
    if (eventIndex > 0) {
      roleCell.classList.add('event-separator');
    }
    
    // If no crew exists, show add button only
    if (eventData.crew.length === 0) {
      roleCell.innerHTML = '';
      crewCell.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center;">
          <button class="action-btn add-crew-btn" onclick="addCrewToDateEvent('${dateData.date}', '${planningEvent.name}')" title="Add Crew Row">
            <span class="material-symbols-outlined">add</span>
          </button>
        </div>
      `;
    } else {
      // Show first crew member with controls
      const crewMember = eventData.crew[0];
      const eventCrewCount = eventData.crew.length;
      
      roleCell.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px;">
          <div style="flex: 1;">
            ${createRoleDropdown(crewMember.role, `handleRoleChange('${dateData.date}', '${planningEvent.name}', 0, event)`, planningEvent.name, 0)}
          </div>
          <button class="action-btn delete-btn crew-delete-btn" onclick="deleteEventCrewRow('${dateData.date}', '${planningEvent.name}', 0)" title="Delete Crew Row">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      `;
      
      // Check if this is the last crew row for this event
      const isLastCrewRow = eventData.crew.length === 1;
      
      if (isLastCrewRow) {
        crewCell.innerHTML = `
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="flex: 1;">
              ${createCrewDropdown(crewMember.crewMember, `handleCrewChange('${dateData.date}', '${planningEvent.name}', 0, event)`, planningEvent.name, 0)}
            </div>
            <button class="action-btn add-crew-btn" onclick="addCrewToDateEvent('${dateData.date}', '${planningEvent.name}')" title="Add Crew Row">
              <span class="material-symbols-outlined">add</span>
            </button>
          </div>
        `;
      } else {
        crewCell.innerHTML = createCrewDropdown(crewMember.crewMember, `handleCrewChange('${dateData.date}', '${planningEvent.name}', 0, event)`, planningEvent.name, 0);
      }
    }
    
    row.appendChild(roleCell);
    row.appendChild(crewCell);
  });
  
  tableBody.appendChild(row);
  
  // Add additional crew rows if needed
  for (let crewIndex = 1; crewIndex < maxCrewCount; crewIndex++) {
    renderAdditionalCrewRow(tableBody, dateData, crewIndex);
  }
}

function renderAdditionalCrewRow(tableBody, dateData, crewIndex) {
  const row = document.createElement('tr');
  
  // Empty date cell
  row.innerHTML = `
    <td class="date-cell"></td>
  `;
  
  // Render crew cells for each event
  planningData.events.forEach((planningEvent, eventIndex) => {
    const eventData = dateData.events.find(e => e.name === planningEvent.name) || {
      name: planningEvent.name,
      location: planningEvent.location,
      crew: []
    };
    
    const roleCell = document.createElement('td');
    const crewCell = document.createElement('td');
    roleCell.className = 'crew-cell';
    crewCell.className = 'crew-cell';
    
    // Add event separator class for visual separation
    if (eventIndex > 0) {
      roleCell.classList.add('event-separator');
    }
    
    // Only show inputs if this event has crew at this index, otherwise show empty cells
    if (crewIndex < eventData.crew.length) {
      const crewMember = eventData.crew[crewIndex];
      
      roleCell.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px;">
          <div style="flex: 1;">
            ${createRoleDropdown(crewMember.role, `handleRoleChange('${dateData.date}', '${planningEvent.name}', ${crewIndex}, event)`, planningEvent.name, crewIndex)}
          </div>
          <button class="action-btn delete-btn crew-delete-btn" onclick="deleteEventCrewRow('${dateData.date}', '${planningEvent.name}', ${crewIndex})" title="Delete Crew Row">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      `;
      
      // Check if this is the last crew row for this event
      const isLastCrewRow = crewIndex === eventData.crew.length - 1;
      
      if (isLastCrewRow) {
        crewCell.innerHTML = `
          <div style="display: flex; align-items: center; gap: 4px;">
            <div style="flex: 1;">
              ${createCrewDropdown(crewMember.crewMember, `handleCrewChange('${dateData.date}', '${planningEvent.name}', ${crewIndex}, event)`, planningEvent.name, crewIndex)}
            </div>
            <button class="action-btn add-crew-btn" onclick="addCrewToDateEvent('${dateData.date}', '${planningEvent.name}')" title="Add Crew Row">
              <span class="material-symbols-outlined">add</span>
            </button>
          </div>
        `;
      } else {
        crewCell.innerHTML = createCrewDropdown(crewMember.crewMember, `handleCrewChange('${dateData.date}', '${planningEvent.name}', ${crewIndex}, event)`, planningEvent.name, crewIndex);
      }
    } else {
      // Empty cells for events that don't have crew at this index
      roleCell.innerHTML = '';
      crewCell.innerHTML = '';
    }
    
    row.appendChild(roleCell);
    row.appendChild(crewCell);
  });
  
  tableBody.appendChild(row);
}

// Dropdown change handlers
function handleRoleChange(date, eventName, crewIndex, event) {
  const select = event.target;
  const value = select.value;
  
  if (value === '__custom__') {
    const customRole = prompt('Enter custom role:');
    if (customRole && customRole.trim()) {
      addCustomRole(customRole.trim());
      updateCrewData(date, eventName, crewIndex, 'role', customRole.trim());
      renderTable(); // Re-render to show the new custom role in dropdowns
    } else {
      select.value = ''; // Reset if cancelled
    }
  } else {
    updateCrewData(date, eventName, crewIndex, 'role', value);
  }
}

function handleCrewChange(date, eventName, crewIndex, event) {
  const select = event.target;
  const value = select.value;
  
  if (value === '__custom__') {
    const customName = prompt('Enter custom crew member name:');
    if (customName && customName.trim()) {
      updateCrewData(date, eventName, crewIndex, 'crewMember', customName.trim());
      checkNameCollision(date, eventName, crewIndex, customName.trim());
      renderTable(); // Re-render to show the new custom name in dropdown
    } else {
      select.value = ''; // Reset if cancelled
    }
  } else {
    updateCrewData(date, eventName, crewIndex, 'crewMember', value);
    checkNameCollision(date, eventName, crewIndex, value);
  }
  
  // Update highlighting after crew change
  highlightEmptyCrewCells();
}

// Data Management Functions
function updateCrewData(date, eventName, crewIndex, field, value) {
  // Find the date data
  const dateData = planningData.dates.find(d => d.date === date);
  if (!dateData) return;
  
  // Find or create event data
  let eventData = dateData.events.find(e => e.name === eventName);
  if (!eventData) {
    eventData = {
      name: eventName,
      location: planningData.events.find(e => e.name === eventName)?.location || '',
      crew: []
    };
    dateData.events.push(eventData);
  }
  
  // Ensure crew array is long enough
  while (eventData.crew.length <= crewIndex) {
    eventData.crew.push({ role: '', crewMember: '' });
  }
  
  // Update the field
  eventData.crew[crewIndex][field] = value;
  
  // Only clean up completely empty crew entries at the end if both fields are empty
  // This allows for intentionally blank roles or crew members
  while (eventData.crew.length > 1) {
    const lastCrew = eventData.crew[eventData.crew.length - 1];
    if (lastCrew.role === '' && lastCrew.crewMember === '') {
      eventData.crew.pop();
    } else {
      break;
    }
  }
  
  // Save to session storage
  saveToSessionStorage();
}

function addCrewToDateEvent(date, eventName) {
  if (!currentTable) {
    alert('Please load or create a table first');
    return;
  }
  
  // Find the specific date
  const dateData = planningData.dates.find(d => d.date === date);
  if (!dateData) return;
  
  // Find or create event data for this specific date
  let eventData = dateData.events.find(e => e.name === eventName);
  if (!eventData) {
    eventData = {
      name: eventName,
      location: planningData.events.find(e => e.name === eventName)?.location || '',
      crew: []
    };
    dateData.events.push(eventData);
  }
  
  // Add empty crew member to this specific event on this specific date
  eventData.crew.push({ role: '', crewMember: '' });
  
  // Save to session storage
  saveToSessionStorage();
  
  renderTable();
}

function deleteEventCrewRow(date, eventName, crewIndex) {
  // Find the date data
  const dateData = planningData.dates.find(d => d.date === date);
  if (!dateData) return;
  
  // Find the specific event
  const eventData = dateData.events.find(e => e.name === eventName);
  if (!eventData || eventData.crew.length <= crewIndex) return;
  
  // Allow deleting all crew members - events can be completely empty
  
  // Remove the crew member at the specified index from this specific event
  eventData.crew.splice(crewIndex, 1);
  
  // Save to session storage
  saveToSessionStorage();
  
  renderTable();
}

function checkNameCollision(date, eventName, crewIndex, name) {
  // Don't check collision for empty names
  if (!name || name.trim() === '') {
    // Remove any existing warning class for this cell
    const selects = document.querySelectorAll(`select[data-event="${escapeHtml(eventName)}"][data-crew-index="${crewIndex}"]`);
    selects.forEach(select => {
      select.closest('.crew-cell').classList.remove('warning');
    });
    return;
  }
  
  const trimmedName = name.trim().toLowerCase();
  let hasCollision = false;
  
  // Check within the same date across all events
  const dateData = planningData.dates.find(d => d.date === date);
  if (dateData) {
    dateData.events.forEach(event => {
      event.crew.forEach((crew, index) => {
        if (crew.crewMember && crew.crewMember.toLowerCase() === trimmedName) {
          // Skip if it's the same cell being edited
          if (event.name === eventName && index === crewIndex) return;
          hasCollision = true;
        }
      });
    });
  }
  
  // Show warning if collision detected
  if (hasCollision) {
    const formattedDate = formatDateWithDayName(parseLocalDate(date));
    showCollisionWarning(`"${name}" is already assigned on ${formattedDate}`);
    
    // Add visual indicator to the cell
    const selects = document.querySelectorAll(`select[data-event="${escapeHtml(eventName)}"][data-crew-index="${crewIndex}"]`);
    selects.forEach(select => {
      select.closest('.crew-cell').classList.add('warning');
    });
  } else {
    // Remove warning class from this specific cell
    const selects = document.querySelectorAll(`select[data-event="${escapeHtml(eventName)}"][data-crew-index="${crewIndex}"]`);
    selects.forEach(select => {
      select.closest('.crew-cell').classList.remove('warning');
    });
  }
}

function showCollisionWarning(message) {
  const warning = document.getElementById('collisionWarning');
  const messageSpan = document.getElementById('collisionMessage');
  
  messageSpan.textContent = message;
  warning.style.display = 'flex';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    hideCollisionWarning();
  }, 5000);
}

function hideCollisionWarning() {
  document.getElementById('collisionWarning').style.display = 'none';
}

// Session Storage Management
function saveToSessionStorage() {
  if (!currentTable) return;
  
  const sessionData = {
    tableId: currentTable._id,
    tableName: currentTable.name,
    tableDescription: currentTable.description,
    planningData: planningData,
    lastSaved: Date.now()
  };
  
  sessionStorage.setItem('crewPlannerWorkingData', JSON.stringify(sessionData));
  updateSaveButtonState();
}

function restoreFromSessionStorage() {
  const stored = sessionStorage.getItem('crewPlannerWorkingData');
  if (!stored) return false;
  
  try {
    const sessionData = JSON.parse(stored);
    
    // Set up the current table data
    currentTable = {
      _id: sessionData.tableId,
      name: sessionData.tableName,
      description: sessionData.tableDescription
    };
    
    planningData = sessionData.planningData || { dates: [], events: [] };
    
    // Update UI
    document.getElementById('currentTableName').textContent = currentTable.name;
    document.getElementById('currentTableDescription').textContent = currentTable.description || 'No description';
    document.getElementById('currentTableInfo').style.display = 'block';
    
    // Select the table in the dropdown
    const tableSelect = document.getElementById('tableSelect');
    if (tableSelect) {
      tableSelect.value = currentTable._id;
    }
    
    updateSaveButtonState();
    return true;
  } catch (error) {
    console.error('Error restoring from session storage:', error);
    return false;
  }
}

function clearSessionStorage() {
  sessionStorage.removeItem('crewPlannerWorkingData');
  updateSaveButtonState();
}

function hasUnsavedChanges() {
  const stored = sessionStorage.getItem('crewPlannerWorkingData');
  return !!stored;
}

function updateSaveButtonState() {
  const saveBtn = document.getElementById('saveTableBtn');
  if (saveBtn) {
    const hasChanges = hasUnsavedChanges();
    saveBtn.disabled = !currentTable || !hasChanges;
    
    if (hasChanges && currentTable) {
      saveBtn.textContent = 'Save *';
      saveBtn.style.fontWeight = 'bold';
    } else {
      saveBtn.textContent = 'Save';
      saveBtn.style.fontWeight = 'normal';
    }
  }
}

// Utility Functions
function parseLocalDate(dateString) {
  // Parse YYYY-MM-DD as local date to avoid timezone issues
  const dateParts = dateString.split('-');
  return new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
}

function formatDateWithDayName(date) {
  // Format date as "Wed, Oct 1"
  const options = { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  };
  return date.toLocaleDateString('en-US', options);
}

function updateUIState() {
  const hasTable = currentTable !== null;
  document.getElementById('deleteTableBtn').disabled = !hasTable;
  
  if (!hasTable) {
    document.getElementById('currentTableInfo').style.display = 'none';
  }
  
  // Save button state is now managed by updateSaveButtonState()
  updateSaveButtonState();
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Global function exports for onclick handlers
// Edit Functions
function editDate(currentDate) {
  const newDate = prompt('Enter new date (YYYY-MM-DD):', currentDate);
  if (!newDate || newDate === currentDate) return;
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    alert('Please enter date in YYYY-MM-DD format');
    return;
  }
  
  // Check if date already exists
  if (planningData.dates.some(d => d.date === newDate)) {
    alert('This date already exists');
    return;
  }
  
  // Update the date
  const dateData = planningData.dates.find(d => d.date === currentDate);
  if (dateData) {
    dateData.date = newDate;
    
    // Re-sort dates
    planningData.dates.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Save to session storage
    saveToSessionStorage();
    
    renderTable();
  }
}

function editEvent(currentEventName) {
  const event = planningData.events.find(e => e.name === currentEventName);
  if (!event) return;
  
  // Pre-populate modal with current values
  document.getElementById('eventName').value = event.name;
  document.getElementById('eventLocation').value = event.location;
  
  // Store the original name for updating
  document.getElementById('addEventModal').dataset.editingEvent = currentEventName;
  
  // Change modal title and button text
  document.querySelector('#addEventModal .modal-header h3').textContent = 'Edit Event';
  document.querySelector('#addEventModal .btn-primary').textContent = 'Update Event';
  
  openModal('addEventModal');
}

window.deleteDate = deleteDate;
window.deleteEvent = deleteEvent;
window.editDate = editDate;
window.editEvent = editEvent;
window.addCrewToDateEvent = addCrewToDateEvent;
window.deleteEventCrewRow = deleteEventCrewRow;
window.updateCrewData = updateCrewData;
window.checkNameCollision = checkNameCollision;
window.handleRoleChange = handleRoleChange;
window.handleCrewChange = handleCrewChange;
window.openModal = openModal;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

})();
