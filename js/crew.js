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

// State management for unsaved changes
let hasUnsavedChanges = false;
let changedRows = new Set(); // Track which rows changed
let deletedRows = new Set(); // Track deleted rows
let autosaveTimeout = null; // Debounce autosave
let isSaving = false; // Track if currently saving
let isEditing = false; // Track if any field is currently being edited

// Socket.IO real-time updates - disabled when there are unsaved changes
if (window.socket) {
  window.socket.on('crewChanged', (data) => {
    const currentTableId = getCurrentTableId();
    if (data && data.tableId && data.tableId !== currentTableId) {
      return;
    }
    // Don't reload if user has unsaved changes
    if (hasUnsavedChanges) {
      console.log('Crew data changed remotely, but you have unsaved changes. Save or discard first.');
      return;
    }
    console.log('Crew data changed, reloading...');
    tableId = currentTableId;
    
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => loadTable(), 500);
  });
  
  window.socket.on('tableUpdated', (data) => {
    const currentTableId = getCurrentTableId();
    if (data && data.tableId && data.tableId !== currentTableId) {
      return;
    }
    // Don't reload if user has unsaved changes
    if (hasUnsavedChanges) {
      console.log('Table updated remotely, but you have unsaved changes. Save or discard first.');
      return;
    }
    console.log('Table updated, reloading...');
    tableId = currentTableId;
    
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => loadTable(), 500);
  });
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

// Save to localStorage as backup
function saveToLocalStorage() {
  try {
    const backup = {
      tableData: tableData,
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

function renderTableSection() {
  const container = document.getElementById('dateSections');
  container.innerHTML = '';

  const filterDropdown = document.getElementById('filterDate');
  const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || '';

  // Get unique dates, filtering out any undefined/null values
  let dates = [...new Set(tableData.rows.map(row => row.date).filter(d => d))];
  dates.sort((a, b) => new Date(a) - new Date(b));

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

  // Always show oldest first (already sorted above)

  const visibleNames = new Set();

  dates.forEach(date => {
    const sectionBox = document.createElement('div');
    sectionBox.className = 'date-section';

    const headerWrapper = document.createElement('div');
    headerWrapper.style.display = 'flex';
    headerWrapper.style.alignItems = 'center';
    headerWrapper.style.justifyContent = 'space-between';
    headerWrapper.style.marginBottom = '8px';

      const header = document.createElement('h2');
      header.textContent = formatDateLocal(date);
      headerWrapper.appendChild(header);

    if (isOwner) {
      const deleteDateBtn = document.createElement('button');
      deleteDateBtn.className = 'delete-date-btn';
      deleteDateBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
      deleteDateBtn.title = 'Delete Date';
      deleteDateBtn.onclick = () => deleteDate(date);
      headerWrapper.appendChild(deleteDateBtn);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';

    const table = document.createElement('table');
    // Let CSS handle table layout and width for responsive behavior
    // Column widths are defined in styles.css using nth-child selectors

    const thead = document.createElement('thead');
    if (isOwner) {
      thead.innerHTML = `
        <tr>
          <th>Name</th>
          <th>Start</th>
          <th>End</th>
          <th>Total</th>
          <th>Role</th>
          <th>Notes</th>
          <th>Action</th>
        </tr>`;
    } else {
      thead.innerHTML = `
        <tr>
          <th>Name</th>
          <th>Start</th>
          <th>End</th>
          <th>Total</th>
          <th>Role</th>
          <th>Notes</th>
        </tr>`;
    }
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    const visibleRows = tableData.rows.filter(row => {
      if (row.date !== date || row.role === '__placeholder__') return false;
      const text = [row.name, row.role, row.notes].join(' ').toLowerCase();
      return text.includes(searchQuery);
    });

    visibleRows.forEach(row => {
      const rowId = row._id;
      const prefix = `row-${rowId}`;
      const tr = document.createElement('tr');
      tr.id = prefix;
      tr.setAttribute('data-id', rowId);
    
      if (isOwner) {
        tr.setAttribute('draggable', 'true');
    
        tr.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', rowId);
          tr.classList.add('dragging');
        });
    
        tr.addEventListener('dragend', () => {
          tr.classList.remove('dragging');
        });
    
        tr.addEventListener('dragover', (e) => e.preventDefault());
    
        tr.addEventListener('drop', (e) => {
          e.preventDefault();
          const draggedId = e.dataTransfer.getData('text/plain');
          handleDrop(rowId, draggedId);
        });
      }
      
      // Show as regular table for everyone (inline editing for owners)
        tr.innerHTML = `
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="name">
          <span class="cell-display">${row.name || (isOwner ? 'Click to add' : '')}</span>
          </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="startTime">
          <span class="cell-display">${formatTime(row.startTime)}</span>
          </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="endTime">
          <span class="cell-display">${formatTime(row.endTime)}</span>
          </td>
        <td class="total-hours-cell">${row.totalHours || 0}</td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="role">
          <span class="cell-display">${row.role || (isOwner ? 'Click to add' : '')}</span>
          </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-row-id="${rowId}" data-field="notes">
          <span class="cell-display">${row.notes || ''}</span>
          </td>
        ${isOwner ? `
          <td class="actions-cell" style="text-align: center;">
            <div class="icon-buttons">
              <button class="delete-row-btn" onclick="deleteRow('${rowId}')" title="Delete"><span class="material-symbols-outlined">delete</span></button>
            </div>
          </td>
        ` : ''}
      `;
    
      tbody.appendChild(tr);
    
      // Add click handlers for inline editing (owners only)
      if (isOwner) {
        tr.querySelectorAll('.owner-editable').forEach(cell => {
          cell.addEventListener('click', () => makeEditable(cell, row));
        });
      }
      
      // Add click-to-expand for notes on mobile (non-owners and owners when not editing)
      if (window.innerWidth <= 768) {
        const notesCell = tr.querySelector('td:nth-child(6) .cell-display');
        if (notesCell && notesCell.textContent.trim()) {
          // Use setTimeout to ensure CSS is applied before checking dimensions
          setTimeout(() => {
            // Check if content is truncated (scrollHeight will be greater if clamped)
            const isOverflowing = notesCell.scrollHeight > notesCell.clientHeight + 2; // +2px threshold
            
            if (isOverflowing) {
              notesCell.classList.add('notes-truncated');
              
              notesCell.addEventListener('click', (e) => {
                // Only toggle if not in edit mode
                if (!notesCell.closest('td').querySelector('.inline-edit-input')) {
                  e.stopPropagation();
                  notesCell.classList.toggle('notes-truncated');
                  notesCell.classList.toggle('notes-expanded');
                }
              });
            }
          }, 50);
        }
      }
    
      if (row.name && row.name.trim()) {
        visibleNames.add(row.name.trim());
      }
    });

    // Add row button for owners
    if (isOwner) {
      const actionRow = document.createElement('tr');
      const actionTd = document.createElement('td');
      actionTd.colSpan = 7;
      const btnContainer = document.createElement('div');
      btnContainer.className = 'add-row-btn-container';
      const addBtn = document.createElement('button');
      addBtn.className = 'add-row-btn';
      addBtn.textContent = 'Add Row';
      addBtn.onclick = () => addRow(date);
      btnContainer.appendChild(addBtn);
      actionTd.appendChild(btnContainer);
      actionRow.appendChild(actionTd);
      tbody.appendChild(actionRow);
    }

    table.appendChild(tbody);
    wrapper.appendChild(table);
    sectionBox.appendChild(headerWrapper);
    sectionBox.appendChild(wrapper);
    container.appendChild(sectionBox);
  });

  // Crew List button for owners only
  const btnContainer = document.getElementById('crewListBtnContainer');
  if (btnContainer) {
  if (isOwner) {
    let crewListBtn = document.getElementById('crewListBtn');
    if (!crewListBtn) {
      crewListBtn = document.createElement('button');
      crewListBtn.id = 'crewListBtn';
      crewListBtn.textContent = 'Crew List';
        crewListBtn.title = 'View all crew members';
      crewListBtn.onclick = showCrewListModal;
        btnContainer.innerHTML = '';
        btnContainer.appendChild(crewListBtn);
      }
      } else {
      // Hide for non-owners
      btnContainer.innerHTML = '';
      btnContainer.style.display = 'none';
    }
  }
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
  
  if (field === 'name') {
    // Dropdown for name
    input = document.createElement('select');
    input.innerHTML = `
      <option value="">-- Select Name --</option>
      ${cachedUsers.map(u => `<option value="${u.name}" ${u.name === currentValue ? 'selected' : ''}>${u.name}</option>`).join('')}
      <option value="__add_new__">+ Add new name</option>
    `;
  } else if (field === 'role') {
    // Dropdown for role
    input = document.createElement('select');
    input.innerHTML = `
      <option value="">-- Select Role --</option>
      ${cachedRoles.map(r => `<option value="${r}" ${r === currentValue ? 'selected' : ''}>${r}</option>`).join('')}
      <option value="__add_new__">+ Add new role</option>
    `;
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
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.className = 'inline-edit-input';
  
  // Replace display with input
  displaySpan.style.display = 'none';
  cell.appendChild(input);
  input.focus();
  
  // Track if we've already handled "add new" to prevent double modal
  let addNewHandled = false;
  
  // For dropdowns, immediately show modal if "Add new" is selected
  if (field === 'name' || field === 'role') {
    input.addEventListener('change', async (e) => {
      if (e.target.value === '__add_new__') {
        addNewHandled = true; // Mark as handled
        
        // Immediately show the modal
        const title = field === 'name' ? 'Add New Name' : 'Add New Role';
        const placeholder = field === 'name' ? 'Enter name...' : 'Enter role...';
        
        const newValue = await showInputModal(title, placeholder);
        
        if (newValue) {
          let valueToSet = null;
          
          if (field === 'name') {
            if (!cachedUsers.some(u => u.name === newValue)) {
              cachedUsers.push({ name: newValue });
        cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
              
              // Rebuild dropdown with new option
              input.innerHTML = `
                <option value="">-- Select Name --</option>
                ${cachedUsers.map(u => `<option value="${u.name}" ${u.name === newValue ? 'selected' : ''}>${u.name}</option>`).join('')}
                <option value="__add_new__">+ Add new name</option>
              `;
              input.value = newValue;
              valueToSet = newValue;
      } else {
              showMessage('This name already exists', 'error');
              input.value = currentValue;
            }
          } else if (field === 'role') {
            if (!cachedRoles.includes(newValue)) {
              cachedRoles.push(newValue);
              cachedRoles.sort();
              
              // Rebuild dropdown with new option
              input.innerHTML = `
                <option value="">-- Select Role --</option>
                ${cachedRoles.map(r => `<option value="${r}" ${r === newValue ? 'selected' : ''}>${r}</option>`).join('')}
                <option value="__add_new__">+ Add new role</option>
              `;
              input.value = newValue;
              valueToSet = newValue;
            } else {
              showMessage('This role already exists', 'error');
              input.value = currentValue;
            }
          }
          
          // Actually save the value to the row data
          if (valueToSet && valueToSet !== currentValue) {
            row[field] = valueToSet;
            displaySpan.textContent = valueToSet;
            markChanged(rowId);
          }
        } else {
          // User cancelled, reset to previous value
          input.value = currentValue;
        }
      }
    });
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
    // Skip if "add new" was already handled by change event
    if (newValue === '__add_new__') {
      if (addNewHandled) {
        console.log('⏭️ Skipping __add_new__ (already handled by change event)');
        return; // Already handled by the change event
      }
      
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
  
  // Exit edit mode and restore cell
  const exitEdit = () => {
    if (!input.parentNode) return; // Already removed
    input.remove();
    displaySpan.style.display = '';
    cell.classList.remove('editing');
    isEditing = false; // Mark that editing is done
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

// Bulk save all changes to the server
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
    console.log(`💾 Saving changes: ${changedRows.size} modified, ${deletedRows.size} deleted`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Step 1: Handle all updates in parallel (safe - different rows)
    const updatePromises = [];
    for (const rowId of changedRows) {
      // Skip if this row is also being deleted
      if (deletedRows.has(rowId)) {
        console.log(`⏭️ Skipping save for ${rowId} (marked for deletion)`);
        continue;
      }
      
      const row = tableData.rows.find(r => r._id === rowId);
      if (row) {
        console.log(`📝 Updating row ${rowId}`);
        updatePromises.push(
          fetch(`${API_BASE}/api/tables/${tableId}/rows/${rowId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: token
            },
            body: JSON.stringify(row)
          }).then(res => {
            if (res.ok) {
              console.log(`✅ Update ${rowId} succeeded`);
              successCount++;
            } else {
              console.error(`❌ Update ${rowId} failed:`, res.status);
              failCount++;
            }
            return res;
          })
        );
      }
    }
    
    // Wait for all updates to complete
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
    
    // Step 2: Handle deletes SEQUENTIALLY to avoid version conflicts
    for (const rowId of deletedRows) {
      console.log(`🗑️ Deleting row ${rowId}`);
      try {
        const response = await fetch(`${API_BASE}/api/tables/${tableId}/rows-by-id/${rowId}`, {
          method: 'DELETE',
          headers: { Authorization: token }
        });
        
        if (response.ok) {
          console.log(`✅ Delete ${rowId} succeeded`);
          successCount++;
    } else {
          const errorText = await response.text();
          console.error(`❌ Delete ${rowId} failed:`, response.status, errorText);
          failCount++;
        }
      } catch (error) {
        console.error(`❌ Delete ${rowId} error:`, error);
        failCount++;
      }
    }
    
    // Check if we had any operations
    if (successCount === 0 && failCount === 0) {
      console.log('⚠️ No changes to save');
      hasUnsavedChanges = false;
      updateSaveStatus();
    return;
  }
  
    if (failCount === 0) {
      console.log(`✅ All ${successCount} changes saved successfully`);
      
      // Clear changed tracking
      changedRows.clear();
      deletedRows.clear();
      hasUnsavedChanges = false;
      
      // Clear localStorage backup
      clearLocalStorage();
      
      // Update UI
      updateSaveStatus('saved');
      
      if (!silent) {
        showMessage(`All ${successCount} changes saved successfully`, 'success');
      }
      
      // Don't reload the page for autosave - keeps user in place
      // Real-time updates will come through sockets when needed
    } else {
      throw new Error(`${failCount} of ${successCount + failCount} operations failed`);
    }
    
  } catch (error) {
    console.error('❌ Failed to save changes:', error);
    if (!silent) {
      showMessage('Failed to save some changes. Please try again.', 'error');
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
    
    // Handle different response formats
    const savedRow = result.row || result;
    
    if (savedRow && savedRow._id) {
      // Ensure date is set correctly
      if (!savedRow.date) {
        savedRow.date = date;
        console.log('⚠️ Date was missing from server response, using original date:', date);
      }
      
      // Add to local data
      tableData.rows.push(savedRow);
      console.log('✅ Row added to local data:', savedRow);
      
      // Re-render immediately
      renderTableSection();
      updateCrewCount();
      showMessage('Row added successfully!', 'success');
    } else {
      console.error('❌ Invalid response format:', result);
      throw new Error('Invalid response from server');
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
  
  // Mark for deletion (will be saved with Save Changes button)
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
  
  showMessage(`${rowName || 'Row'} will be deleted shortly (autosaving...)`, 'info');
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
  
  showMessage(`Date ${formattedDate} will be deleted shortly (autosaving...)`, 'info');
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
    padding: 12px 20px;
    border-radius: 6px;
    font-weight: 500;
    z-index: 10001;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: opacity 0.3s ease;
    ${type === 'success' ? 'background: #d4edda; color: #155724; border: 1px solid #c3e6cb;' : 
      type === 'error' ? 'background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb;' :
      'background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb;'}
  `;
  messageEl.textContent = message;
  
  document.body.appendChild(messageEl);
  
  setTimeout(() => {
    messageEl.style.opacity = '0';
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
    alert('No crew found.');
    return;
  }
  
  let modal = document.getElementById('crewListModal');
  if (modal) modal.remove();
  
  modal = document.createElement('div');
  modal.id = 'crewListModal';
  modal.className = 'modal-backdrop';
  modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:500px;width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:32px;display:flex;flex-direction:column;gap:20px;animation:slideUp 0.3s ease;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #f8f9fa;padding-bottom:16px;">
        <h3 style='color:#2c3e50;margin:0;font-size:1.5rem;font-weight:700;display:flex;align-items:center;gap:10px;'>
          Crew List
        </h3>
        <span style='background:#e9ecef;color:#6c757d;padding:6px 12px;border-radius:20px;font-size:0.85rem;font-weight:600;'>
          ${crewArr.length} member${crewArr.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style='max-height:400px;overflow-y:auto;'>
        <ul style='list-style:none;padding:0;margin:0;'>
          ${crewArr.map(({name, email}) => `
            <li style='padding:14px;margin-bottom:8px;background:#f8f9fa;border-radius:10px;border-left:4px solid #CC0007;transition:all 0.2s ease;'>
              <div style='font-weight:600;color:#2c3e50;font-size:1rem;margin-bottom:4px;'>${name}</div>
              ${email ? `<a href='mailto:${email}' style='color:#6c757d;text-decoration:none;font-size:0.9rem;'>
                ${email}
              </a>` : '<span style="color:#adb5bd;font-size:0.85rem;">No email</span>'}
            </li>
          `).join('')}
        </ul>
      </div>
      <div style='display:flex;gap:12px;margin-top:8px;'>
        <button id='emailEveryoneBtn' style='flex:1;background:linear-gradient(135deg,#CC0007,#a30006);color:#fff;border:none;border-radius:10px;padding:12px 20px;font-weight:600;font-size:15px;cursor:pointer;transition:all 0.3s ease;box-shadow:0 4px 12px rgba(204,0,7,0.2);'>
          Email Everyone
        </button>
        <button id='closeCrewListModalBtn' style='flex:1;background:#6c757d;color:#fff;border:none;border-radius:10px;padding:12px 20px;font-weight:600;font-size:15px;cursor:pointer;transition:all 0.3s ease;'>
          Close
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  // Add hover effects
  const emailBtn = document.getElementById('emailEveryoneBtn');
  emailBtn.onmouseover = () => emailBtn.style.transform = 'translateY(-2px)';
  emailBtn.onmouseout = () => emailBtn.style.transform = 'translateY(0)';
  
  const closeBtn = document.getElementById('closeCrewListModalBtn');
  closeBtn.onmouseover = () => closeBtn.style.background = '#5a6268';
  closeBtn.onmouseout = () => closeBtn.style.background = '#6c757d';
  
  closeBtn.onclick = () => {
    modal.style.animation = 'fadeOut 0.2s ease';
    setTimeout(() => modal.remove(), 200);
  };
  
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
      closeBtn.click();
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
    alert('Access denied. Only event owners can view the crew cost calculator.');
    return;
  }
  
  const rows = (tableData.rows || []).filter(row => row.role !== '__placeholder__' && row.name && row.role);
  if (!rows.length) {
    alert('No crew data available.');
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
  modal.className = 'crew-cost-calc-modal';
  modal.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(34,41,47,0.18);display:flex;align-items:center;justify-content:center;z-index:10000;';
  
  modal.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:700px;width:96vw;max-height:96vh;height:96vh;box-shadow:0 12px 40px rgba(204,0,7,0.13),0 2px 8px rgba(0,0,0,0.08);padding:38px 32px 28px 32px;display:flex;flex-direction:column;gap:18px;align-items:center;">
      <h3 style='color:#CC0007;margin:0 0 8px 0;'>Crew Cost Calculator</h3>
      <div style='width:100%;flex:1 1 auto;overflow-x:auto;overflow-y:auto;min-height:0;'>
        <table style='width:100%;border-collapse:collapse;font-size:1rem;'>
          <thead>
            <tr style='background:#f5f5f5;'>
              <th style='padding:8px 10px;text-align:left;'>Name</th>
              <th style='padding:8px 10px;text-align:left;'>Role</th>
              <th style='padding:8px 10px;text-align:right;'>Total Hours</th>
              <th style='padding:8px 10px;text-align:right;'>Hourly Rate</th>
              <th style='padding:8px 10px;text-align:right;'>Cost</th>
            </tr>
          </thead>
          <tbody id='crewCostCalcTableBody'>
          </tbody>
        </table>
      </div>
      <div style='width:100%;text-align:right;font-size:1.1rem;margin-top:10px;'>
        <strong>Total Project Cost: $<span id='crewCostCalcTotal'>0.00</span></strong>
      </div>
      <button id='closeCrewCostCalcModalBtn' style='background:#6c757d;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:600;font-size:16px;box-shadow:0 2px 8px rgba(204,0,7,0.08);cursor:pointer;margin-top:10px;'>Close</button>
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
      return `<tr>
        <td style='padding:7px 10px;'>${crew.name}</td>
        <td style='padding:7px 10px;'>${crew.role}</td>
        <td style='padding:7px 10px;text-align:right;'>${crew.totalHours.toFixed(2)}</td>
        <td style='padding:7px 10px;text-align:right;'>
          <input type='text' inputmode='decimal' data-key='${key}' value='${crewRates[key]}' style='width:90px;padding:3px 6px;font-size:1rem;border:1px solid #bbb;border-radius:5px;text-align:right;'>
        </td>
        <td style='padding:7px 10px;text-align:right;'>$${cost.toFixed(2)}</td>
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
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Rates';
    saveBtn.style = 'background:#CC0007;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-weight:600;font-size:16px;box-shadow:0 2px 8px rgba(204,0,7,0.08);cursor:pointer;margin-top:10px;';
    saveBtn.id = 'saveCrewRatesBtn';
    modal.querySelector('div').appendChild(saveBtn);
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
          alert('Failed to save rates: ' + err);
          saveBtn.disabled = false;
        }
      } catch (err) {
        saveBtn.textContent = 'Error';
        alert('Failed to save rates: ' + err.message);
        saveBtn.disabled = false;
      }
    };
  }

  document.getElementById('closeCrewCostCalcModalBtn').onclick = () => modal.remove();
}

// Attach event listeners
function attachEventListeners() {
  const addDateBtn = document.getElementById('addDateBtn');
  if (addDateBtn) addDateBtn.onclick = addDateSection;
  
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
  
    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.onclick = exportCrewCsv;
  
    const costCalcBtn = document.getElementById('crewCostCalcBtn');
    if (costCalcBtn) costCalcBtn.onclick = showCrewCostCalcModal;
  
  // No longer need save button or keyboard shortcut with autosave
  // Removed: Save changes button
  // Removed: Ctrl+S keyboard shortcut
  // Removed: beforeunload warning (autosave handles it)
}

// Initialize page
function initPage(id) {
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

})();
