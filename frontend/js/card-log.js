(function() {
// Add an initialization flag to prevent duplicate initialization
if (window.__cardLogJsLoaded) {
  console.log('Card-log.js already loaded, skipping initialization');
  return;
}
window.__cardLogJsLoaded = true;

// Bottom Nav Placeholder

// 🔥 Global variables
let users = [];
let cameras = ["A7IV-A", "A7IV-B", "A7IV-C", "A7IV-D", "A7IV-E", "A7RV-A", "FX3-A", "A7IV", "A7RV", "A7III"];
let customCameras = []; // Track custom cameras separately
let isOwner = false;
let saveTimeout;
let currentEditingEntry = null; // Track which entry is being edited in modal
let currentEditingDate = null; // Track which date the entry belongs to
let eventListenersAttached = false;
let processingSocketEvent = false; // Flag to prevent multiple socket events processing at once
let lastEventTime = 0; // Track when the last event started processing
let isActivelyEditing = false; // Track if user is actively editing
let lastInputTime = 0; // Track when user last typed
let deferredUpdate = null; // Store deferred updates
let deferredUpdateTimeout = null; // Timeout for deferred updates

// Function to refresh owner status and update collaborative system
function refreshOwnerStatus(newOwnerStatus) {
  const oldOwnerStatus = isOwner;
  isOwner = newOwnerStatus;
  window.isOwner = isOwner; // Ensure window.isOwner is also set
  
  console.log(`[CARD-LOG] Owner status updated: ${oldOwnerStatus} → ${isOwner}`);
  
  // Update collaborative system if it exists
  if (window.cardLogCollaborationManager) {
    console.log('[CARD-LOG] Refreshing collaborative system access control');
    refreshAllRowAccessControl();
  }
  
  // Also broadcast owner status change to other systems that might need it
  if (window.isOwner !== oldOwnerStatus) {
    const event = new CustomEvent('ownerStatusChanged', { 
      detail: { isOwner: window.isOwner } 
    });
    window.dispatchEvent(event);
  }
}

// Add a fallback to reset the processing flag if it gets stuck
setInterval(() => {
  if (processingSocketEvent && Date.now() - lastEventTime > 5000) {
    console.warn('[CARD-LOG] Processing flag stuck for >5s, resetting');
    processingSocketEvent = false;
  }
}, 1000);

// Add Socket.IO real-time updates early in the file, after any variable declarations but before function definitions
// Socket.IO real-time updates
function setupSocketListeners() {
  if (!window.socket) {
    console.log('[CARD-LOG] Socket.IO not available - running in standalone mode');
    
    // Add manual save button when Socket.IO is not available
    addManualSaveButton();
    
    // Use more frequent auto-saves in standalone mode
    console.log('[CARD-LOG] Using enhanced auto-save for standalone mode');
    return;
  }
  
  console.log('[CARD-LOG] Setting up Socket.IO event listeners...');
  console.log('[CARD-LOG] Socket connected:', window.socket.connected);
  
  // --- Granular card log events ---
  window.socket.on('cardLogAdded', (data) => {
    if (processingSocketEvent) {
      console.log("Ignoring cardLogAdded event - already processing another event");
      return;
    }
    
    processingSocketEvent = true;
    
    try {
      const currentEventId = localStorage.getItem('eventId');
      if (!data || data.tableId !== currentEventId || !data.cardLog) {
        console.log("Ignoring cardLogAdded - not for current event or missing data");
        return;
      }
      
      console.log(`Received cardLogAdded for date: ${data.cardLog.date}`);
      
      // Only add if not already present - don't clear container
      if (!document.getElementById(`day-${data.cardLog.date}`)) {
        console.log("Adding new day section to UI");
        addDaySection(data.cardLog.date, data.cardLog.entries);
      } else {
        console.log("Day already exists in UI, ignoring");
      }
    } finally {
      // Use a timeout to prevent rapid event processing
      setTimeout(() => {
        processingSocketEvent = false;
      }, 100);
    }
  });
  
  window.socket.on('cardLogUpdated', (data) => {
    if (processingSocketEvent) {
      console.log("Ignoring cardLogUpdated event - already processing another event");
      return;
    }
    
    // Enhanced safety checks for race conditions
    const timeSinceLastInput = Date.now() - lastInputTime;
    const isRecentlyEditing = isActivelyEditing && timeSinceLastInput < 3000; // Increased timeout
    
    // Don't update UI if user is actively editing or recently finished editing
    if (isRecentlyEditing) {
      console.log(`[CARD-LOG] User is actively editing (last input ${timeSinceLastInput}ms ago), deferring update`);
      
      // Clear any existing deferred update and store the new one
      if (deferredUpdateTimeout) {
        clearTimeout(deferredUpdateTimeout);
      }
      
      deferredUpdate = data; // Store the update for later
      
      deferredUpdateTimeout = setTimeout(() => {
        if (!isActivelyEditing && deferredUpdate && Date.now() - lastInputTime > 2000) {
          console.log("[CARD-LOG] Applying deferred update after user finished editing");
          const storedData = deferredUpdate;
          deferredUpdate = null;
          deferredUpdateTimeout = null;
          
          // Process the stored update with safety checks
          if (storedData && storedData.cardLog) {
            processingSocketEvent = true;
            lastEventTime = Date.now();
            
            try {
              setTimeout(() => {
                applySmartDayUpdate(storedData.cardLog.date, storedData.cardLog.entries);
              }, 100); // Small delay to ensure DOM stability
            } catch (error) {
              console.error('[CARD-LOG] Error in deferred update:', error);
            } finally {
              setTimeout(() => {
                processingSocketEvent = false;
                console.log('[CARD-LOG] Deferred update applied using smart update');
              }, 200);
            }
          }
        } else {
          console.log("[CARD-LOG] Skipping deferred update - user still editing or no data");
          deferredUpdate = null;
          deferredUpdateTimeout = null;
        }
      }, 3000); // Increased timeout for better stability
      return;
    }
    
    processingSocketEvent = true;
    lastEventTime = Date.now();
    console.log('[CARD-LOG] Processing cardLogUpdated event, flag set to true');
    
    try {
      const currentEventId = localStorage.getItem('eventId');
      if (!data || data.tableId !== currentEventId || !data.cardLog) {
        console.log("Ignoring cardLogUpdated - not for current event or missing data", {
          hasData: !!data,
          tableIdMatch: data?.tableId === currentEventId,
          hasCardLog: !!data?.cardLog,
          currentEventId,
          dataTableId: data?.tableId
        });
        return;
      }
      
      console.log(`[CARD-LOG] Processing cardLogUpdated for date: ${data.cardLog.date}`, {
        entriesCount: data.cardLog.entries?.length || 0,
        entries: data.cardLog.entries
      });
      
      // Add small delay to prevent race conditions with DOM updates
      setTimeout(() => {
        try {
          applySmartDayUpdate(data.cardLog.date, data.cardLog.entries);
        } catch (updateError) {
          console.error('[CARD-LOG] Error in delayed smart update:', updateError);
        }
      }, 50);
      
    } catch (error) {
      console.error('[CARD-LOG] Error processing cardLogUpdated:', error);
    } finally {
      setTimeout(() => {
        processingSocketEvent = false;
        console.log('[CARD-LOG] Processing flag reset to false');
      }, 150); // Slightly longer delay
    }
  });
  
  window.socket.on('cardLogDeleted', (data) => {
    if (processingSocketEvent) return;
    processingSocketEvent = true;
    
    try {
      const currentEventId = localStorage.getItem('eventId');
      if (!data || data.tableId !== currentEventId || !data.cardLog) return;
      console.log(`Received cardLogDeleted for date: ${data.cardLog.date}`);
      
      // Remove the day section if it exists
      const dayDiv = document.getElementById(`day-${data.cardLog.date}`);
      if (dayDiv) {
        console.log("Removing day section from UI");
        dayDiv.remove();
      } else {
        console.log("Day doesn't exist in UI, ignoring delete");
      }
    } finally {
      setTimeout(() => {
        processingSocketEvent = false;
      }, 100);
    }
  });
  
  // Also listen for general table updates
  window.socket.on('tableUpdated', (data) => {
    if (processingSocketEvent) return;
    
    const currentEventId = localStorage.getItem('eventId');
    
    // Only reload if it's for the current table
    if (data && data.tableId && data.tableId !== currentEventId) {
      console.log('Update was for a different event, ignoring');
      return;
    }
    
    console.log('Table updated event received - NOT reloading entire card log to maintain state');
    // We no longer call loadCardLog() here to avoid resetting the UI
  });
}

// Utility and handler functions
async function saveToMongoDB() {
  try {
    // First, check for concurrent edits by fetching latest data
    if (!window.socket) {
      const hasConflicts = await checkForConcurrentEdits();
      if (hasConflicts) {
        const userChoice = await showConflictResolutionDialog();
        if (userChoice === 'cancel') {
          return false;
        } else if (userChoice === 'merge') {
          const success = await performMergedSave();
          return success;
        }
        // If 'overwrite', continue with normal save
      }
    }
    
    const tables = document.querySelectorAll('.day-table');
    
    // If no day tables exist, send an empty array explicitly
    if (tables.length === 0) {
      console.log("No days found in the UI, sending empty card log");
      const response = await fetch(`${API_BASE}/api/tables/${localStorage.getItem('eventId')}/cardlog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') },
        body: JSON.stringify({ cardLog: [] })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        alert(`Error saving changes: ${errorData.error || response.statusText}`);
        return false;
      }
      console.log("Empty card log saved successfully");
      return true;
    }
    
    const cardLog = Array.from(tables).map(dayTable => {
      const date = dayTable.querySelector('h3').textContent;
      const entries = Array.from(dayTable.querySelectorAll('tbody tr')).map(row => {
        const entry = {
          camera: row.querySelector('[data-field="camera"]').textContent || '',
          card1: row.querySelector('[data-field="card1"]').textContent || '',
          card2: row.querySelector('[data-field="card2"]').textContent || '',
          user: row.querySelector('[data-field="user"]').textContent || '',
          _id: row.getAttribute('data-id') || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          createdBy: row.getAttribute('data-created-by') || null,
          createdAt: row.getAttribute('data-created-at') || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        const category = row.getAttribute('data-category');
        const notes = row.getAttribute('data-notes');
        if (category) entry.category = category;
        if (notes) entry.notes = notes;
        return entry;
      });
      
      // Get the day ID from the DOM if it exists
      const dayId = dayTable.getAttribute('data-id');
      
      return { 
        date, 
        entries,
        _id: dayId || `day-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
    });

    // Validate card log data before saving
    const validationErrors = validateCardLogData(cardLog);
    if (validationErrors.length > 0) {
      console.warn('[CARD-LOG] Validation errors found:', validationErrors);
      const userWantsToContinue = confirm(`Found issues with card log data:\n${validationErrors.join('\n')}\n\nDo you want to save anyway?`);
      if (!userWantsToContinue) {
        return false;
      }
    }

    console.log("Saving card log with entries:", cardLog.map(log => `${log.date} (${log.entries.length} entries)`));
    const response = await fetch(`${API_BASE}/api/tables/${localStorage.getItem('eventId')}/cardlog`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') },
      body: JSON.stringify({ cardLog })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`Error saving card log: ${response.status} ${response.statusText}`, errorData);
      
      // Show error to user
      alert(`Error saving changes: ${errorData.error || response.statusText}`);
      return false;
    }
    
    console.log("Card log saved successfully");
    
    // Update the data-id attributes after saving
    cardLog.forEach(day => {
      const dayDiv = document.getElementById(`day-${day.date}`);
      if (dayDiv) {
        dayDiv.setAttribute('data-id', day._id);
        
        // Also update row IDs
        day.entries.forEach((entry, index) => {
          const rows = dayDiv.querySelectorAll('tbody tr');
          if (rows[index]) {
            rows[index].setAttribute('data-id', entry._id);
          }
        });
      }
    });
    
    return true;
  } catch (error) {
    console.error("Error saving card log:", error);
    alert(`Error saving changes: ${error.message || 'Unknown error'}`);
    return false;
  }
}

function debounceSave() {
  // Don't save if we're processing a Socket.IO event (only if Socket.IO is available)
  if (window.socket && processingSocketEvent) {
    console.log('[CARD-LOG] Skipping save - processing Socket.IO event');
    return;
  }
  
  clearTimeout(saveTimeout);
  
  // Use different delays based on Socket.IO availability
  let delay;
  if (!window.socket) {
    // Standalone mode - more frequent saves
    delay = isActivelyEditing ? 500 : 200;
  } else {
    // Socket.IO mode - conservative delays to avoid conflicts
    delay = isActivelyEditing ? 1000 : 300;
  }
  
  console.log(`[CARD-LOG] Debouncing save with ${delay}ms delay (actively editing: ${isActivelyEditing}, socket: ${!!window.socket})`);
  
  saveTimeout = setTimeout(() => {
    // Check conditions based on Socket.IO availability
    const shouldSkip = window.socket ? (processingSocketEvent || isActivelyEditing) : isActivelyEditing;
    
    if (!shouldSkip) {
      console.log('[CARD-LOG] Executing debounced save');
      saveToMongoDB().catch(error => {
        console.error('[CARD-LOG] Auto-save failed:', error);
        // Show user-friendly notification
        showSaveError('Auto-save failed. Please use the manual save button.');
      });
    } else {
      console.log('[CARD-LOG] Skipping save - conflict detected', {
        processingSocketEvent: window.socket ? processingSocketEvent : 'N/A',
        isActivelyEditing,
        hasSocket: !!window.socket
      });
      // Retry save in a bit if conditions are temporary
      if (window.socket && processingSocketEvent && !isActivelyEditing) {
        setTimeout(() => debounceSave(), 200);
      }
    }
  }, delay);
}

// Show save error notification
function showSaveError(message) {
  // Remove existing error if present
  const existingError = document.getElementById('save-error-notification');
  if (existingError) existingError.remove();
  
  const notification = document.createElement('div');
  notification.id = 'save-error-notification';
  notification.innerHTML = `
    <span class="material-symbols-outlined">error</span>
    ${message}
    <button onclick="this.parentElement.remove()">×</button>
  `;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #dc3545;
    color: white;
    padding: 10px 15px;
    border-radius: 6px;
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(220, 53, 69, 0.3);
  `;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 10 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 10000);
}

function openDateModal() {
  const modal = document.getElementById('date-modal');
  if (modal) {
    // Ensure modal is appended to body (not trapped in #page-container)
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // Set default date to today
    const dateInput = document.getElementById('new-date-input');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().split('T')[0];
    }
  }
}

function closeDateModal() {
  const modal = document.getElementById('date-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

function createNewDay() {
  const dateInput = document.getElementById('new-date-input');
  const date = dateInput.value;
  if (!date || document.getElementById(`day-${date}`)) return alert('Date missing or already exists');
  addDaySection(date);
  dateInput.value = '';
  closeDateModal();
  // Only save, do not reload the card log
  saveToMongoDB();
}

// Add event handlers to page elements
function setupEventListeners() {
  if (eventListenersAttached) {
    console.log('Event listeners already attached, skipping');
    return;
  }
  
  const addDayBtn = document.getElementById('add-day-btn');
  const cancelModalBtn = document.getElementById('cancel-modal');
  const submitDateBtn = document.getElementById('submit-date');
  const tableContainer = document.getElementById('table-container');
  
  // Modal button elements
  const cancelCardModalBtn = document.getElementById('cancel-card-modal');
  const saveCardEntryBtn = document.getElementById('save-card-entry');
  
  // Close modal buttons
  const closeDateModalBtn = document.getElementById('close-date-modal');
  const closeCardModalBtn = document.getElementById('close-card-modal');
  
  if (addDayBtn) addDayBtn.addEventListener('click', openDateModal);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeDateModal);
  if (submitDateBtn) submitDateBtn.addEventListener('click', createNewDay);
  if (closeDateModalBtn) closeDateModalBtn.addEventListener('click', closeDateModal);
  
  // Card entry modal listeners
  if (cancelCardModalBtn) cancelCardModalBtn.addEventListener('click', closeCardEntryModal);
  if (saveCardEntryBtn) saveCardEntryBtn.addEventListener('click', saveCardEntry);
  if (closeCardModalBtn) closeCardModalBtn.addEventListener('click', closeCardEntryModal);
  
  if (tableContainer) {
    tableContainer.addEventListener('click', async (e) => {
      // Handle add card button clicks (check for button or its children)
      const addCardBtn = e.target.closest('.add-card-btn');
      if (addCardBtn) {
        const date = addCardBtn.getAttribute('data-date');
        console.log(`[CARD-LOG] User clicked "Add Card" for date: ${date}`);
        
        // Extra validation to ensure date is valid
        if (!date || date === 'null' || date === 'undefined') {
          console.error('[CARD-LOG] Add Card button missing data-date attribute');
          alert('Error: Date information is missing. Please refresh the page and try again.');
          return;
        }
        
        openCardEntryModal(date);
      }
      
      // Handle row clicks for editing
      if (e.target.closest('.card-log-row') && !e.target.closest('button')) {
        const row = e.target.closest('.card-log-row');
        const dayTable = row.closest('.day-table');
        const date = dayTable ? dayTable.getAttribute('data-date') : null;
        
        // Validate date before proceeding
        if (!date || date === 'null' || date === 'undefined') {
          console.error('[CARD-LOG] Row click - missing or invalid data-date attribute');
          alert('Error: Date information is missing. Please refresh the page and try again.');
          return;
        }
        
        const entryCreatedBy = row.getAttribute('data-created-by');
        const currentUserId = getUserIdFromToken();
        
        // Check if user can edit this entry
        // Owners can edit any entry, non-owners can only edit entries they created
        const canEditEntry = isOwner || (entryCreatedBy && entryCreatedBy === currentUserId);
        
        if (canEditEntry) {
          const existingEntry = {
            _id: row.getAttribute('data-id'),
            camera: row.querySelector('[data-field="camera"]').textContent,
            card1: row.querySelector('[data-field="card1"]').textContent,
            card2: row.querySelector('[data-field="card2"]').textContent,
            user: row.querySelector('[data-field="user"]').textContent,
            createdBy: entryCreatedBy,
            createdAt: row.getAttribute('data-created-at'),
            category: row.getAttribute('data-category') || '',
            notes: row.getAttribute('data-notes') || ''
          };
          
          openCardEntryModal(date, existingEntry);
        } else {
          // Show access denied alert for non-owners trying to edit others' entries
          alert('Not authorized - You can only edit card entries you created');
        }
      }
      // Handle row delete button click
      if (e.target.classList.contains('row-delete-btn') || e.target.closest('.row-delete-btn')) {
        e.stopPropagation();
        const deleteBtn = e.target.closest('.row-delete-btn');
        const row = deleteBtn.closest('tr');
        
        if (!row) return;
        
        const entryCreatedBy = row.getAttribute('data-created-by');
        const currentUserId = getUserIdFromToken();
        
        if (!isOwner && entryCreatedBy !== currentUserId) {
          alert('Not authorized - You can only delete card entries you created');
          return;
        }
        
        const camera = row.querySelector('[data-field="camera"]')?.textContent || '';
        const user = row.querySelector('[data-field="user"]')?.textContent || '';
        let confirmMessage = 'Are you sure you want to delete this entry?';
        if (camera) {
          confirmMessage = `Delete entry for camera "${camera}"${user ? ` (${user})` : ''}?`;
        }
        
        showCardLogDeleteModal(confirmMessage, async function() {
          const tbody = row.closest('tbody');
          const date = tbody ? tbody.id.replace('tbody-', '') : null;
          row.remove();
          if (date) updateDayEntryCount(date);
          updateDateFilterOptions();
          try {
            await saveToMongoDB();
          } catch (error) {
            console.error('[CARD-LOG] Error deleting entry:', error);
            alert('Error deleting entry. Please refresh the page.');
          }
        });
      }
      
      // Handle day action toggle (three-dot menu)
      if (e.target.classList.contains('day-action-toggle') || e.target.closest('.day-action-toggle')) {
        e.stopPropagation();
        console.log('[CARD-LOG] Day action toggle clicked');
        const toggleBtn = e.target.closest('.day-action-toggle');
        const dayDiv = toggleBtn.closest('.day-table');
        
        if (!dayDiv) return;
        
        // Store reference to current day for delete action
        window.currentCardLogDay = dayDiv;
        console.log('[CARD-LOG] Stored current day:', dayDiv);
        
        // Show day action dropdown
        const dropdown = document.getElementById('cardLogDayActionDropdown');
        console.log('[CARD-LOG] Day dropdown element:', dropdown);
        if (dropdown) {
          // Close any other open dropdowns first
          closeAllCardLogActionDropdowns();
          
          // Position the dropdown
          const rect = toggleBtn.getBoundingClientRect();
          dropdown.style.top = `${rect.bottom + 4}px`;
          dropdown.style.left = `${rect.right - dropdown.offsetWidth}px`;
          dropdown.classList.add('show');
          console.log('[CARD-LOG] Day dropdown shown at:', { top: dropdown.style.top, left: dropdown.style.left });
        }
      }
    });
    
    // Handle row delete action from dropdown
    const deleteRowAction = document.getElementById('deleteCardRowAction');
    console.log('[CARD-LOG] Setting up deleteRowAction listener:', deleteRowAction);
    if (deleteRowAction) {
      deleteRowAction.addEventListener('click', function() {
        console.log('[CARD-LOG] Delete row action clicked');
        closeAllCardLogActionDropdowns();
        
        const row = window.currentCardLogRow;
        if (!row) {
          console.log('[CARD-LOG] No current row found');
          return;
        }
        
        const entryCreatedBy = row.getAttribute('data-created-by');
        const currentUserId = getUserIdFromToken();
        
        // Check if user can delete this entry (only owners or entry creators)
        if (!isOwner && entryCreatedBy !== currentUserId) {
          alert('Not authorized - You can only delete card entries you created');
          return;
        }
        
        // Extract row data for confirmation message
        const camera = row.querySelector('[data-field="camera"]')?.textContent || '';
        const user = row.querySelector('[data-field="user"]')?.textContent || '';
        
        // Create confirmation message with row details
        let confirmMessage = 'Are you sure you want to delete this entry?';
        if (camera) {
          confirmMessage = `Delete entry for camera "${camera}"${user ? ` (${user})` : ''}?`;
        }
        
        // Use custom modal instead of confirm
        showCardLogDeleteModal(confirmMessage, async function() {
          // Get the date before removing the row
          const tbody = row.closest('tbody');
          const date = tbody ? tbody.id.replace('tbody-', '') : null;
        
        // Remove from DOM and save
        row.remove();
          
          // Update entry count for this day
          if (date) {
            updateDayEntryCount(date);
          }
          
          // Update date filter options
          updateDateFilterOptions();
        
        // Get current data and save
        try {
          await saveToMongoDB();
          console.log('[CARD-LOG] Entry deleted successfully');
        } catch (error) {
          console.error('[CARD-LOG] Error deleting entry:', error);
          alert('Error deleting entry. Please refresh the page.');
        }
        });
      });
    }
    
    // Handle row edit action from dropdown
    const editRowAction = document.getElementById('editCardRowAction');
    if (editRowAction) {
      editRowAction.addEventListener('click', function() {
        closeAllCardLogActionDropdowns();
        
        const row = window.currentCardLogRow;
        if (!row) return;
        
        // Get the date from the tbody
        const tbody = row.closest('tbody');
        if (!tbody) return;
        
        const date = tbody.id.replace('tbody-', '');
        
        // Extract existing entry data from the row
        const existingEntry = {
          _id: row.getAttribute('data-id'),
          camera: row.querySelector('[data-field="camera"]')?.textContent || '',
          card1: row.querySelector('[data-field="card1"]')?.textContent || '',
          card2: row.querySelector('[data-field="card2"]')?.textContent || '',
          user: row.querySelector('[data-field="user"]')?.textContent || '',
          createdBy: row.getAttribute('data-created-by'),
          category: row.getAttribute('data-category') || '',
          notes: row.getAttribute('data-notes') || ''
        };
        
        // Check if user can edit this entry
        const currentUserId = getUserIdFromToken();
        const canEdit = isOwner || (existingEntry.createdBy === currentUserId);
        
        if (!canEdit) {
          alert('Not authorized - You can only edit card entries you created');
          return;
        }
        
        // Open the modal with existing data
        openCardEntryModal(date, existingEntry);
      });
    }
    
    // Handle day delete action from dropdown
    const deleteDayAction = document.getElementById('deleteCardDayAction');
    console.log('[CARD-LOG] Setting up deleteDayAction listener:', deleteDayAction);
    if (deleteDayAction) {
      deleteDayAction.addEventListener('click', function() {
        console.log('[CARD-LOG] Delete day action clicked');
        closeAllCardLogActionDropdowns();
        
        const dayDiv = window.currentCardLogDay;
        if (!dayDiv) {
          console.log('[CARD-LOG] No current day found');
          return;
        }
        
        // Check if user is authorized to delete days
        if (!isOwner) {
          alert('Not authorized - Only event owners can delete entire days');
          return;
        }
        
        const date = dayDiv.querySelector('h3')?.textContent || 'Unknown';
        
        // Use custom modal instead of confirm
        showCardLogDeleteModal(`Delete entire day "${date}" and all its entries?`, async function() {
          const dayId = dayDiv.getAttribute('data-id');
          
          // Remove from DOM
          dayDiv.remove();
          
          // Update date filter options
          updateDateFilterOptions();
          
          // Try to save
          const success = await saveToMongoDB();
          
          // If saving failed, recreate the day
          if (!success) {
            console.log(`Save failed, restoring deleted day: ${date}`);
            // Reload the entire card log to ensure consistency
            await loadCardLog();
            alert(`The day could not be deleted due for an error. The page has been refreshed.`);
          }
        });
      });
    }
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.row-action-dropdown') && 
          !e.target.closest('.row-delete-btn') && 
          !e.target.closest('.day-action-toggle')) {
        closeAllCardLogActionDropdowns();
      }
    });

    // Event listeners for old editable table system have been removed
    // The new system uses read-only tables with modal-based editing
  }
  
  eventListenersAttached = true;
}

// Validate card log data before saving
function validateCardLogData(cardLog) {
  const errors = [];
  
  cardLog.forEach((day, dayIndex) => {
    if (!day.date || day.date.trim() === '') {
      errors.push(`Day ${dayIndex + 1}: Missing date`);
    }
    
    if (!Array.isArray(day.entries)) {
      errors.push(`Day ${dayIndex + 1} (${day.date}): Invalid entries array`);
      return;
    }
    
    day.entries.forEach((entry, entryIndex) => {
      const rowNum = entryIndex + 1;
      
      // Check for completely empty rows
      const isEmpty = (!entry.camera || entry.camera.trim() === '') && 
                     (!entry.card1 || entry.card1.trim() === '') && 
                     (!entry.card2 || entry.card2.trim() === '') && 
                     (!entry.user || entry.user.trim() === '');
      
      if (isEmpty) {
        // Don't warn about empty rows - they might be newly added
        return;
      }
      
      // Check for partially filled rows (these need attention)
      const hasAnyData = (entry.camera && entry.camera.trim() !== '') || 
                        (entry.card1 && entry.card1.trim() !== '') || 
                        (entry.card2 && entry.card2.trim() !== '') || 
                        (entry.user && entry.user.trim() !== '');
      
      if (hasAnyData) {
        // Only warn about missing data if the row has some data (not a fresh empty row)
        // Note: Camera is now optional - users can save without selecting a camera
        if (!entry.user || entry.user.trim() === '') {
          errors.push(`${day.date} Row ${rowNum}: Missing user`);
        }
      }
    });
  });
  
  return errors;
}

// Add a manual save button for when Socket.IO is not available
function addManualSaveButton() {
  const existingButton = document.getElementById('manual-save-btn');
  if (existingButton) return; // Already added
  
  const addDayBtn = document.getElementById('add-day-btn');
  if (!addDayBtn) return;
  
  const saveBtn = document.createElement('button');
  saveBtn.id = 'manual-save-btn';
  saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Changes';
  saveBtn.className = 'manual-save-btn';
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Saving...';
    
    const success = await saveToMongoDB();
    
    if (success) {
      saveBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span> Saved!';
      setTimeout(() => {
        saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Changes';
        saveBtn.disabled = false;
      }, 2000);
    } else {
      saveBtn.innerHTML = '<span class="material-symbols-outlined">error</span> Save Failed';
      saveBtn.style.backgroundColor = '#dc3545';
      setTimeout(() => {
        saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Changes';
        saveBtn.style.backgroundColor = '';
        saveBtn.disabled = false;
      }, 3000);
    }
  };
  
  // Insert after the add day button
  addDayBtn.parentNode.insertBefore(saveBtn, addDayBtn.nextSibling);
  
  // Add styles for the save button
  if (!document.getElementById('manual-save-styles')) {
    const styles = document.createElement('style');
    styles.id = 'manual-save-styles';
    styles.textContent = `
      .manual-save-btn {
        background: #28a745;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        margin-left: 10px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
      }
      .manual-save-btn:hover:not(:disabled) {
        background: #218838;
        transform: translateY(-1px);
      }
      .manual-save-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none;
      }
    `;
    document.head.appendChild(styles);
  }
}

// Cleanup function for page navigation
function cleanupCardLogPage() {
  console.log('[CARD-LOG] Cleaning up card log page...');
  
  // Clear any pending save operations
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  
  // Clean up collaborative system if it exists
  if (window.cleanupCardLogCollaborativeSystem) {
    console.log('🧹 Cleaning up card log collaborative features...');
    window.cleanupCardLogCollaborativeSystem();
  }
  
  // Remove Socket.IO listeners specific to card log
  if (window.socket) {
    console.log('[CARD-LOG] Removing Socket.IO listeners...');
    window.socket.off('cardLogAdded');
    window.socket.off('cardLogUpdated');
    window.socket.off('cardLogDeleted');
    window.socket.off('tableUpdated');
    
    // Leave both table and event rooms
    const tableId = localStorage.getItem('eventId');
    if (tableId) {
      window.socket.emit('leaveTable', tableId);
      console.log(`[CARD-LOG] Left table room: table-${tableId}`);
      
      window.socket.emit('leaveEventRoom', {
        eventId: tableId,
        userId: getUserIdFromToken()
      });
      
      // Leave card-log-specific collaboration
      window.socket.emit('leaveCardLogCollaboration', {
        eventId: tableId,
        userId: getUserIdFromToken()
      });
      
      window.__cardLogEventRoomJoined = false;
      console.log(`[CARD-LOG] Left event room and card-log collaboration: event-${tableId}`);
    }
  }
  
  // Clear the table container
  const container = document.getElementById('table-container');
  if (container) {
    container.innerHTML = '';
  }
  
  // Reset flags
  eventListenersAttached = false;
  processingSocketEvent = false;
  isActivelyEditing = false;
  
  // Reset global data
  users = [];
  customCameras = [];
  
  console.log('[CARD-LOG] ✅ Card log page cleaned up');
}

// Load sidebar user info
function loadSidebarUser() {
  const userNameEl = document.getElementById('sidebarUserName');
  const avatarImg = document.getElementById('sidebarAvatarImg');
  const avatarIcon = document.getElementById('sidebarAvatarIcon');
  
  const userName = localStorage.getItem('fullName') || localStorage.getItem('userName') || 'User';
  if (userNameEl) userNameEl.textContent = userName;
  
  // Try to fetch user photo
  const token = localStorage.getItem('token');
  const userId = getUserIdFromToken();
  if (userId && token) {
    fetch(`${API_BASE}/api/users/${userId}`, {
      headers: { Authorization: token }
    })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('User not found');
      })
      .then(user => {
        if (user.profilePhoto) {
          if (avatarImg) {
            avatarImg.src = user.profilePhoto;
            avatarImg.style.display = 'block';
          }
          if (avatarIcon) avatarIcon.style.display = 'none';
        }
      })
      .catch(err => {
        console.log('Could not load user photo:', err);
      });
  }
}

// Setup sidebar navigation
function setupSidebarNav() {
  const sidebar = document.getElementById('cardLogSidebar');
  const overlay = document.getElementById('cardLogSidebarOverlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');

  if (mobileMenuBtn) {
    mobileMenuBtn.onclick = function() {
      if (sidebar) sidebar.classList.add('open');
      if (overlay) overlay.classList.add('visible');
      document.body.style.overflow = 'hidden';
    };
  }

  if (overlay) {
    overlay.onclick = function() {
      if (sidebar) sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      document.body.style.overflow = '';
    };
  }

  // Close sidebar when clicking nav items on mobile
  const navItems = sidebar?.querySelectorAll('.nav-item');
  navItems?.forEach(item => {
    item.addEventListener('click', function() {
      if (window.innerWidth <= 1024) {
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('visible');
        document.body.style.overflow = '';
      }
    });
  });
}

// Setup search functionality
function setupSearchFilter() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase();
      const dayTables = document.querySelectorAll('.day-table');
      
      dayTables.forEach(dayTable => {
        const rows = dayTable.querySelectorAll('tbody tr');
        let hasVisibleRows = false;
        
        rows.forEach(row => {
          const text = row.textContent.toLowerCase();
          if (text.includes(query) || query === '') {
            row.style.display = '';
            hasVisibleRows = true;
          } else {
            row.style.display = 'none';
          }
        });
        
        // Show/hide entire day based on whether it has visible rows
        if (query !== '') {
          dayTable.style.display = hasVisibleRows ? '' : 'none';
        } else {
          dayTable.style.display = '';
        }
      });
    });
  }
}

// Setup date filter dropdown
function setupDateFilter() {
  const dateFilterBtn = document.getElementById('dateFilterBtn');
  const dateFilterMenu = document.getElementById('dateFilterMenu');
  const dateFilterLabel = document.getElementById('dateFilterLabel');
  
  if (dateFilterBtn && dateFilterMenu) {
    dateFilterBtn.onclick = function(e) {
      e.stopPropagation();
      dateFilterMenu.classList.toggle('show');
    };
    
    // Close on outside click
    document.addEventListener('click', function() {
      dateFilterMenu.classList.remove('show');
    });
  }
}

// Update date filter options based on available days
function updateDateFilterOptions() {
  const dateFilterMenu = document.getElementById('dateFilterMenu');
  const dateFilterLabel = document.getElementById('dateFilterLabel');
  
  if (!dateFilterMenu) return;
  
  const dayTables = document.querySelectorAll('.day-table');
  const dates = Array.from(dayTables).map(dt => {
    const h3 = dt.querySelector('h3');
    return h3 ? h3.textContent : '';
  }).filter(Boolean);
  
  dateFilterMenu.innerHTML = `
    <button class="date-filter-option active" data-date="">All Dates</button>
    ${dates.map(date => `<button class="date-filter-option" data-date="${date}">${date}</button>`).join('')}
  `;
  
  // Add click handlers
  dateFilterMenu.querySelectorAll('.date-filter-option').forEach(option => {
    option.onclick = function(e) {
      e.stopPropagation();
      const selectedDate = this.getAttribute('data-date');
      
      // Update active state
      dateFilterMenu.querySelectorAll('.date-filter-option').forEach(o => o.classList.remove('active'));
      this.classList.add('active');
      
      // Update label
      if (dateFilterLabel) {
        dateFilterLabel.textContent = selectedDate || 'All Dates';
      }
      
      // Filter day tables
      dayTables.forEach(dayTable => {
        const h3 = dayTable.querySelector('h3');
        const tableDate = h3 ? h3.textContent : '';
        
        if (selectedDate === '' || tableDate === selectedDate) {
          dayTable.style.display = '';
        } else {
          dayTable.style.display = 'none';
        }
      });
      
      // Close menu
      dateFilterMenu.classList.remove('show');
    };
  });
}

window.initPage = async function(id) {
  const tableId = id || localStorage.getItem('eventId');
    if (!tableId) {
      alert('Event ID missing.');
      return;
    }
    // Removed redundant localStorage.setItem('eventId', tableId) to prevent overwriting with potentially stale data
    // The navigation system should already have set this correctly

    // Test Socket.IO connection immediately
    console.log('[CARD-LOG INIT] Testing Socket.IO connection...');
    console.log('[CARD-LOG INIT] window.socket exists:', !!window.socket);
    console.log('[CARD-LOG INIT] Socket connected:', window.socket?.connected);
    console.log('[CARD-LOG INIT] Current event ID:', tableId);

    // Setup sidebar and navigation
    loadSidebarUser();
    setupSidebarNav();
    setupSearchFilter();
    setupDateFilter();

    // Load event name
    try {
      const res = await fetch(`${API_BASE}/api/tables/${tableId}`, {
        headers: { Authorization: localStorage.getItem('token') }
      });
      const table = await res.json();
    const eventTitleEl = document.getElementById('eventTitle');
    if (eventTitleEl) eventTitleEl.textContent = table.title || 'Event';
    } catch (err) {
      console.error('Failed to load event name:', err);
    const eventTitleEl = document.getElementById('eventTitle');
    if (eventTitleEl) eventTitleEl.textContent = 'Error loading event';
    }

  await loadUsers();
  await loadCardLog();
  
  // Update date filter options after loading
  updateDateFilterOptions();

  // Join Socket.IO rooms for both table and event-specific features
  if (window.socket && window.socket.connected) {
    window.socket.emit('joinTable', tableId);
    console.log(`[CARD-LOG] Joined table room: table-${tableId}`);
    
    // Also join event room for collaborative features compatibility
    window.socket.emit('joinEventRoom', {
      eventId: tableId,
      userId: getUserIdFromToken(),
      userName: getCurrentUserName()
    });
    
    // Join card-log-specific collaboration
    window.socket.emit('joinCardLogCollaboration', {
      eventId: tableId,
      userId: getUserIdFromToken(),
      userName: getCurrentUserName()
    });
    
    window.__cardLogEventRoomJoined = true;
    console.log(`[CARD-LOG] Joined event room and card-log collaboration: event-${tableId}`);
  }

  // Set up Socket.IO event listeners after everything is loaded
  setupSocketListeners();

    // Inject hrefs with ?id=...
    const links = [
      { id: 'navGeneral', file: 'general.html' },
      { id: 'navCrew', file: 'crew.html' },
      { id: 'navTravel', file: 'travel-accommodation.html' },
      { id: 'navGear', file: 'gear.html' },
      { id: 'navCard', file: 'card-log.html' },
    { id: 'navSchedule', file: 'schedule.html' }
      ];
    links.forEach(({ id, file }) => {
      const el = document.getElementById(id);
      if (el) el.href = `${file}?id=${tableId}`;
    });

    if (window.lucide) lucide.createIcons();
  
  // Ensure modals are moved to body element BEFORE setting up event listeners
  // This fixes visibility issues in SPA setup
  const dateModal = document.getElementById('date-modal');
  const cardEntryModal = document.getElementById('card-entry-modal');
  const deleteModal = document.getElementById('cardLogDeleteModal');
  
  if (dateModal && dateModal.parentElement !== document.body) {
    console.log('[CARD-LOG] Moving date-modal to body element');
    document.body.appendChild(dateModal);
  }
  
  if (cardEntryModal && cardEntryModal.parentElement !== document.body) {
    console.log('[CARD-LOG] Moving card-entry-modal to body element');
    document.body.appendChild(cardEntryModal);
  }
  
  if (deleteModal && deleteModal.parentElement !== document.body) {
    console.log('[CARD-LOG] Moving delete-modal to body element');
    document.body.appendChild(deleteModal);
  }
  
  // Also move the action dropdowns to body
  const rowDropdown = document.getElementById('cardLogRowActionDropdown');
  const dayDropdown = document.getElementById('cardLogDayActionDropdown');
  
  if (rowDropdown && rowDropdown.parentElement !== document.body) {
    document.body.appendChild(rowDropdown);
  }
  
  if (dayDropdown && dayDropdown.parentElement !== document.body) {
    document.body.appendChild(dayDropdown);
  }
  
  // Set up event listeners AFTER modals are in place
  setupEventListeners();
  
  // Set up calculator modal and load saved cards-needed badge
  setupCalculatorModal();
  loadCardsNeededBadge();

  // Load collaborative system
  await loadCardLogCollaborativeSystem();
  
  // Fix any existing DOM structure issues for collaborative system compatibility
  fixExistingCardLogStructure();
  
  // Refresh access control for all rows to ensure owners can edit everything
  refreshAllRowAccessControl();
};

async function loadUsers() {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/api/users`, { headers: { Authorization: token } });
  if (!res.ok) return console.error('Failed to fetch users');
  const data = await res.json();
  users = data.map(u => u.name?.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function loadCardLog() {
  const token = localStorage.getItem('token');
  const eventId = localStorage.getItem('eventId');
  
  // Load custom cameras from localStorage first
  loadCustomCameras();
  
  const res = await fetch(`${API_BASE}/api/tables/${eventId}`, { headers: { Authorization: token } });
  if (!res.ok) return console.error('Failed to load table data');
  const table = await res.json();
  const userId = getUserIdFromToken();
  // Set owner status using the new refresh function
  const newOwnerStatus = Array.isArray(table.owners) && table.owners.includes(userId);
  refreshOwnerStatus(newOwnerStatus);
  
  // Extract any custom cameras from the loaded data
  if (table.cardLog && Array.isArray(table.cardLog)) {
    table.cardLog.forEach(dayData => {
      if (dayData.entries && Array.isArray(dayData.entries)) {
        dayData.entries.forEach(entry => {
          if (entry.camera && !cameras.includes(entry.camera)) {
            console.log(`[CARD-LOG] Found custom camera in data: ${entry.camera}`);
            if (!customCameras.includes(entry.camera)) {
              customCameras.push(entry.camera);
              cameras.push(entry.camera);
            }
          }
        });
      }
    });
    
    // Save any newly discovered custom cameras
    if (customCameras.length > 0) {
      localStorage.setItem(`customCameras_${eventId}`, JSON.stringify(customCameras));
    }
  }
  
  if (!table.cardLog || table.cardLog.length === 0) return;
  
  const container = document.getElementById('table-container');
  
  // Get existing days
  const existingDays = new Set(Array.from(document.querySelectorAll('.day-table')).map(div => {
    const dateHeader = div.querySelector('h3');
    return dateHeader ? dateHeader.textContent : null;
  }).filter(Boolean));
  
  console.log("Existing days in UI:", Array.from(existingDays));
  console.log("Days in database:", table.cardLog.map(day => day.date));
  
  // Don't clear container if we already have days, only add missing ones
  const shouldAddAll = existingDays.size === 0;
  
  if (shouldAddAll) {
    // No existing days, start fresh
    container.innerHTML = '';
    table.cardLog.forEach(day => addDaySection(day.date, day.entries));
  } else {
    // Only add days that aren't already shown
    table.cardLog.forEach(day => {
      if (!existingDays.has(day.date)) {
        console.log(`Adding missing day: ${day.date}`);
        addDaySection(day.date, day.entries);
      }
    });
  }
  
  // Fix any existing DOM structure issues for collaborative system compatibility
  fixExistingCardLogStructure();
  
  // Refresh access control for all rows to ensure owners can edit everything
  refreshAllRowAccessControl();
}

// Load custom cameras from localStorage
function loadCustomCameras() {
  try {
    const eventId = localStorage.getItem('eventId');
    const stored = localStorage.getItem(`customCameras_${eventId}`);
    if (stored) {
      customCameras = JSON.parse(stored);
      // Add custom cameras to the main cameras array if not already present
      customCameras.forEach(camera => {
        if (!cameras.includes(camera)) {
          cameras.push(camera);
        }
      });
      console.log(`[CARD-LOG] Loaded ${customCameras.length} custom cameras from localStorage`);
    }
  } catch (error) {
    console.error('[CARD-LOG] Error loading custom cameras:', error);
    customCameras = [];
  }
}

// Update all camera dropdowns with new cameras
function updateAllCameraDropdowns() {
  const allCameraSelects = document.querySelectorAll('.camera-select');
  allCameraSelects.forEach(select => {
    const currentValue = select.value;
    const isAddNewSelected = currentValue === 'add-new-camera';
    
    // Get all current options except "add-new-camera"
    const existingOptions = Array.from(select.options)
      .filter(option => option.value !== 'add-new-camera')
      .map(option => option.value);
    
    // Add any missing cameras
    cameras.forEach(camera => {
      if (!existingOptions.includes(camera) && camera) {
        const option = new Option(camera, camera);
        select.insertBefore(option, select.querySelector('[value="add-new-camera"]'));
      }
    });
    
    // Restore selection if it wasn't "add-new-camera"
    if (!isAddNewSelected && cameras.includes(currentValue)) {
      select.value = currentValue;
    }
  });
}

function getUserIdFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.id;
}

function getCurrentUserName() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return '';
    
    // Get user data from token
    const payload = JSON.parse(atob(token.split('.')[1]));
    
    // Use the users array to find a match
    const userId = payload.id;
    const userJWT = payload.fullName;
    
    // If the current user is in the users array, return that name
    // This ensures we use the same format as in the dropdown
    if (users.length > 0) {
      // Find the first user in the array with a matching name
      for (const user of users) {
        // Simple fuzzy matching - if the JWT name is a substring of the user name
        if (user && userJWT && 
            (user.toLowerCase().includes(userJWT.toLowerCase()) || 
             userJWT.toLowerCase().includes(user.toLowerCase()))) {
          return user;
        }
      }
    }
    
    // Fall back to JWT token's fullName
    return userJWT || '';
  } catch (err) {
    console.error('Error getting current user name:', err);
    return '';
  }
}

function addDaySection(date, entries = []) {
  const container = document.getElementById('table-container');
  
  // Remove loading skeleton if present
  const skeleton = container.querySelector('.loading-skeleton');
  if (skeleton) skeleton.remove();
  
  const dayDiv = document.createElement('div');
  
  // Generate a unique ID for this day if not already present
  const dayId = `day-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  dayDiv.className = 'day-table readonly-table';
  dayDiv.id = `day-${date}`;
  dayDiv.setAttribute('data-id', dayId);
  dayDiv.setAttribute('data-date', date);
  
  // Count entries for display
  const entryCount = Array.isArray(entries) ? entries.length : 0;
  
  dayDiv.innerHTML = `
    <div class="day-header">
      <div class="day-header-left">
        <h3>${date}</h3>
        <span class="day-count">(${entryCount})</span>
      </div>
      ${isOwner ? `<button class="day-action-toggle" data-date="${date}" title="Day Options"><span class="material-symbols-outlined">more_vert</span></button>` : ''}
    </div>
    <table>
      <colgroup>
        <col style="width: 25%;">
        <col style="width: 20%;">
        <col style="width: 20%;">
        <col style="width: 30%;">
        <col style="width: 5%;">
      </colgroup>
      <thead>
        <tr>
          <th>Camera</th>
          <th>Card 1</th>
          <th>Card 2</th>
          <th>User</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="tbody-${date}"></tbody>
    </table>
    <button class="add-card-btn" data-date="${date}"><span class="material-symbols-outlined">add</span> ADD CARD</button>
  `;
  
  // Insert in the correct position to maintain date order
  const existingDays = Array.from(container.querySelectorAll('.day-table'));
  let insertPosition = null;
  
  for (let i = 0; i < existingDays.length; i++) {
    const existingDate = existingDays[i].querySelector('h3').textContent;
    if (date < existingDate) {
      insertPosition = existingDays[i];
      break;
    }
  }
  
  if (insertPosition) {
    container.insertBefore(dayDiv, insertPosition);
    console.log(`Inserted day ${date} before ${insertPosition.querySelector('h3').textContent}`);
  } else {
    container.appendChild(dayDiv);
    console.log(`Appended day ${date} at the end`);
  }
  
  // Make sure entries is an array
  const entriesArray = Array.isArray(entries) ? entries : [];
  entriesArray.forEach(entry => addRow(date, entry));
  
  console.log(`Added day section for ${date} with ${entriesArray.length} entries`);
}

function addRow(date, entry = {}) {
  const tbody = document.getElementById(`tbody-${date}`);
  if (!tbody) {
    console.error(`Tbody not found for date: ${date}`);
    return;
  }
  
  console.log(`Adding row to date ${date}:`, entry);
  
  const row = document.createElement('tr');
  row.className = 'card-log-row';
  
  // Generate or use existing ID for this row
  const rowId = entry._id || `row-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  row.setAttribute('data-id', rowId);
  
  // Add row index for collaborative system
  const rowIndex = tbody.children.length;
  row.setAttribute('data-row-index', rowIndex);

  const currentUser = getCurrentUserName();
  const currentUserId = getUserIdFromToken();
  
  // Determine if current user can edit/delete this entry
  const entryCreatedBy = entry.createdBy;
  const canEdit = isOwner || (entryCreatedBy && entryCreatedBy === currentUserId);
  
  // Non-owners should only see delete button for entries they created
  const canDelete = isOwner || (entryCreatedBy && entryCreatedBy === currentUserId);
  
  // Store entry metadata
  row.setAttribute('data-user', entry.user || '');
  row.setAttribute('data-created-by', entryCreatedBy || '');
  row.setAttribute('data-created-at', entry.createdAt || '');
  row.setAttribute('data-category', entry.category || '');
  row.setAttribute('data-notes', entry.notes || '');

  // Apply category-based row color
  const category = (entry.category || '').toLowerCase();
  if (category === 'video') {
    row.classList.add('category-video');
  } else if (category === 'headshot') {
    row.classList.add('category-headshot');
  }

  const hasNotes = !!(entry.notes && entry.notes.trim());
  const notesIndicator = hasNotes ? '<span class="notes-dot" title="Has notes"></span>' : '';

  // Create non-editable display cells with dark theme styling
  row.innerHTML = `
    <td>
      ${notesIndicator}<span class="display-value" data-field="camera">${entry.camera || ''}</span>
    </td>
    <td><span class="display-value" data-field="card1">${entry.card1 || ''}</span></td>
    <td><span class="display-value" data-field="card2">${entry.card2 || ''}</span></td>
    <td>
      <span class="display-value" data-field="user">${entry.user || ''}</span>
    </td>
    <td style="text-align:center;">
      ${canDelete ? '<button class="row-delete-btn" title="Delete Entry"><span class="material-symbols-outlined">delete</span></button>' : ''}
    </td>
  `;
  
  tbody.appendChild(row);
  
  // Update row indices after adding this row
  updateRowIndices(date);
}

// Modal functionality for adding/editing card entries
function openCardEntryModal(date, existingEntry = null) {
  // Validate date parameter
  if (!date || date === 'null' || date === 'undefined') {
    console.error('[CARD-LOG] Invalid date passed to openCardEntryModal:', date);
    alert('Error: No date selected. Please try again.');
    return;
  }
  
  console.log('[CARD-LOG] Opening card entry modal for date:', date);
  currentEditingDate = date;
  currentEditingEntry = existingEntry;
  
  const modal = document.getElementById('card-entry-modal');
  
  if (!modal) {
    console.error('[CARD-LOG] Card entry modal not found');
    return;
  }
  
  // Ensure modal is appended to body (not trapped in #page-container)
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  
  const title = document.getElementById('card-modal-title');
  const cameraHiddenInput = document.getElementById('card-camera-select');
  const card1Input = document.getElementById('card-card1-input');
  const card2Input = document.getElementById('card-card2-input');
  const userHiddenInput = document.getElementById('card-user-select');
  const categoryHiddenInput = document.getElementById('card-category-select');
  const notesInput = document.getElementById('card-notes-input');
  const saveButton = document.getElementById('save-card-entry');
  
  // Custom dropdown elements
  const cameraDropdownWrapper = document.getElementById('cameraDropdownWrapper');
  const cameraDropdownTrigger = document.getElementById('cameraDropdownTrigger');
  const cameraDropdownValue = document.getElementById('cameraDropdownValue');
  const cameraDropdownMenu = document.getElementById('cameraDropdownMenu');
  
  const userDropdownWrapper = document.getElementById('userDropdownWrapper');
  const userDropdownTrigger = document.getElementById('userDropdownTrigger');
  const userDropdownValue = document.getElementById('userDropdownValue');
  const userDropdownMenu = document.getElementById('userDropdownMenu');
  
  // Update modal title
  title.textContent = existingEntry ? 'Edit Card Entry' : 'Add Card Entry';
  saveButton.textContent = existingEntry ? 'Update Entry' : 'Save Entry';
  
  // Populate camera custom dropdown
  cameraDropdownMenu.innerHTML = '';
  cameras.forEach(camera => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'custom-dropdown-option';
    option.textContent = camera;
    option.setAttribute('data-value', camera);
    if (existingEntry && existingEntry.camera === camera) {
      option.classList.add('selected');
      cameraDropdownValue.textContent = camera;
      cameraDropdownValue.classList.remove('placeholder');
      cameraHiddenInput.value = camera;
    }
    option.onclick = function() {
      selectDropdownOption('camera', camera, camera);
    };
    cameraDropdownMenu.appendChild(option);
  });
  
  // Add "Add New Camera" option
  const addCameraBtn = document.createElement('button');
  addCameraBtn.type = 'button';
  addCameraBtn.className = 'custom-dropdown-option add-new';
  addCameraBtn.textContent = '➕ Add New Camera';
  addCameraBtn.onclick = function() {
    closeAllCardLogDropdowns();
    const newCamera = prompt('Enter new camera name:');
    if (newCamera && newCamera.trim()) {
      const trimmedCamera = newCamera.trim();
      if (!cameras.includes(trimmedCamera)) {
        cameras.push(trimmedCamera);
        customCameras.push(trimmedCamera);
        saveCustomCameras();
      }
      selectDropdownOption('camera', trimmedCamera, trimmedCamera);
    }
  };
  cameraDropdownMenu.appendChild(addCameraBtn);
  
  // Populate user custom dropdown
  userDropdownMenu.innerHTML = '';
  users.forEach(user => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'custom-dropdown-option';
    option.textContent = user;
    option.setAttribute('data-value', user);
    if (existingEntry && existingEntry.user === user) {
      option.classList.add('selected');
      userDropdownValue.textContent = user;
      userDropdownValue.classList.remove('placeholder');
      userHiddenInput.value = user;
    }
    option.onclick = function() {
      selectDropdownOption('user', user, user);
    };
    userDropdownMenu.appendChild(option);
  });
  
  // Add "Add New User" option for owners
  if (isOwner) {
    const addUserBtn = document.createElement('button');
    addUserBtn.type = 'button';
    addUserBtn.className = 'custom-dropdown-option add-new';
    addUserBtn.textContent = '➕ Add New User';
    addUserBtn.onclick = function() {
      closeAllCardLogDropdowns();
      const newUser = prompt('Enter new user name:');
      if (newUser && newUser.trim()) {
        const trimmedUser = newUser.trim();
        if (!users.includes(trimmedUser)) {
          users.push(trimmedUser);
          users.sort((a, b) => a.localeCompare(b));
        }
        selectDropdownOption('user', trimmedUser, trimmedUser);
      }
    };
    userDropdownMenu.appendChild(addUserBtn);
  }
  
  // Pre-populate fields for editing or set defaults for new entries
  const currentUser = getCurrentUserName();
  
  // Category dropdown elements
  const categoryDropdownValue = document.getElementById('categoryDropdownValue');
  
  if (existingEntry) {
    card1Input.value = existingEntry.card1 || '';
    card2Input.value = existingEntry.card2 || '';
    notesInput.value = existingEntry.notes || '';
    
    if (existingEntry.camera) {
      cameraDropdownValue.textContent = existingEntry.camera;
      cameraDropdownValue.classList.remove('placeholder');
      cameraHiddenInput.value = existingEntry.camera;
  } else {
      cameraDropdownValue.textContent = 'Select Camera';
      cameraDropdownValue.classList.add('placeholder');
      cameraHiddenInput.value = '';
    }
    
    if (existingEntry.user) {
      userDropdownValue.textContent = existingEntry.user;
      userDropdownValue.classList.remove('placeholder');
      userHiddenInput.value = existingEntry.user;
    } else {
      userDropdownValue.textContent = 'Select User';
      userDropdownValue.classList.add('placeholder');
      userHiddenInput.value = '';
    }
    
    if (existingEntry.category) {
      categoryDropdownValue.textContent = existingEntry.category;
      categoryDropdownValue.classList.remove('placeholder');
      categoryHiddenInput.value = existingEntry.category;
    } else {
      categoryDropdownValue.textContent = 'Select Category';
      categoryDropdownValue.classList.add('placeholder');
      categoryHiddenInput.value = '';
    }
  } else {
    card1Input.value = '';
    card2Input.value = '';
    notesInput.value = '';
    cameraDropdownValue.textContent = 'Select Camera';
    cameraDropdownValue.classList.add('placeholder');
    cameraHiddenInput.value = '';
    categoryDropdownValue.textContent = 'Select Category';
    categoryDropdownValue.classList.add('placeholder');
    categoryHiddenInput.value = '';
    
    // For new entries, always auto-select current user
    if (currentUser && users.includes(currentUser)) {
      userDropdownValue.textContent = currentUser;
      userDropdownValue.classList.remove('placeholder');
      userHiddenInput.value = currentUser;
    } else {
      userDropdownValue.textContent = 'Select User';
      userDropdownValue.classList.add('placeholder');
      userHiddenInput.value = '';
    }
  }
  
  // User selection permissions:
  // - Owners: Can always change user
  // - Non-owners: Can never change user (always locked to themselves)
  if (isOwner) {
    userDropdownTrigger.classList.remove('disabled');
    userDropdownTrigger.title = '';
  } else {
    userDropdownTrigger.classList.add('disabled');
    userDropdownTrigger.title = 'Non-owners can only log entries for themselves';
    // For non-owners, always set to current user regardless of existing entry
    if (currentUser && users.includes(currentUser)) {
      userDropdownValue.textContent = currentUser;
      userDropdownValue.classList.remove('placeholder');
      userHiddenInput.value = currentUser;
    }
  }
  
  // Setup dropdown toggle handlers
  setupCardLogDropdowns();
  
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}

// Custom dropdown helper functions for card log modal
function setupCardLogDropdowns() {
  const cameraDropdownTrigger = document.getElementById('cameraDropdownTrigger');
  const userDropdownTrigger = document.getElementById('userDropdownTrigger');
  
  if (!cameraDropdownTrigger || !userDropdownTrigger) {
    console.error('[CARD-LOG] Dropdown triggers not found');
    return;
  }
  
  // Move dropdown menus to body to escape overflow:hidden
  const cameraMenu = document.getElementById('cameraDropdownMenu');
  const userMenu = document.getElementById('userDropdownMenu');
  
  if (cameraMenu && cameraMenu.parentElement !== document.body) {
    document.body.appendChild(cameraMenu);
}
  if (userMenu && userMenu.parentElement !== document.body) {
    document.body.appendChild(userMenu);
  }
  const categoryMenu = document.getElementById('categoryDropdownMenu');
  if (categoryMenu && categoryMenu.parentElement !== document.body) {
    document.body.appendChild(categoryMenu);
  }
  
  // Remove any existing click handlers and add new ones
  cameraDropdownTrigger.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[CARD-LOG] Camera dropdown clicked');
    const wrapper = document.getElementById('cameraDropdownWrapper');
    const menu = document.getElementById('cameraDropdownMenu');
    const isOpen = wrapper.classList.contains('open');
    closeAllCardLogDropdowns();
    if (!isOpen) {
      wrapper.classList.add('open');
      openDropdownMenu(cameraDropdownTrigger, menu);
    }
  };
  
  userDropdownTrigger.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log('[CARD-LOG] User dropdown clicked');
    if (userDropdownTrigger.classList.contains('disabled')) return;
    
    const wrapper = document.getElementById('userDropdownWrapper');
    const menu = document.getElementById('userDropdownMenu');
    const isOpen = wrapper.classList.contains('open');
    closeAllCardLogDropdowns();
    if (!isOpen) {
      wrapper.classList.add('open');
      openDropdownMenu(userDropdownTrigger, menu);
    }
  };
  
  // Category dropdown
  const categoryDropdownTrigger = document.getElementById('categoryDropdownTrigger');
  if (categoryDropdownTrigger) {
    const catMenu = document.getElementById('categoryDropdownMenu');
    if (catMenu) {
      catMenu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = function() {
          selectDropdownOption('category', opt.getAttribute('data-value'), opt.textContent);
        };
      });
    }

    categoryDropdownTrigger.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = document.getElementById('categoryDropdownWrapper');
      const menu = document.getElementById('categoryDropdownMenu');
      const isOpen = wrapper.classList.contains('open');
      closeAllCardLogDropdowns();
      if (!isOpen) {
        wrapper.classList.add('open');
        openDropdownMenu(categoryDropdownTrigger, menu);
      }
    };
  }
  
  // Close dropdowns when clicking anywhere
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-dropdown-wrapper') && 
        !e.target.closest('.custom-dropdown-menu')) {
      closeAllCardLogDropdowns();
    }
  });
}

// Open and position dropdown menu
function openDropdownMenu(trigger, menu) {
  if (!trigger || !menu) {
    console.error('[CARD-LOG] openDropdownMenu: missing trigger or menu');
    return;
  }
  
  const rect = trigger.getBoundingClientRect();
  
  // Show the menu
  menu.style.display = 'block';
  menu.style.position = 'fixed';
  menu.style.zIndex = '999999';
  menu.style.width = rect.width + 'px';
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  
  console.log('[CARD-LOG] Dropdown menu opened:', {
    menuId: menu.id,
    children: menu.children.length,
    position: { left: menu.style.left, top: menu.style.top, width: menu.style.width }
  });
}

// Position the fixed dropdown menu relative to the trigger
function positionDropdownMenu(trigger, menu) {
  if (!trigger || !menu) {
    console.error('[CARD-LOG] positionDropdownMenu: missing trigger or menu', {trigger, menu});
    return;
  }
  
  const rect = trigger.getBoundingClientRect();
  const menuHeight = 250; // max-height from CSS
  const viewportHeight = window.innerHeight;
  
  console.log('[CARD-LOG] Positioning dropdown:', {
    triggerRect: rect,
    menuChildren: menu.children.length,
    menuDisplay: getComputedStyle(menu).display
  });
        
  // Check if there's room below
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  
  menu.style.width = rect.width + 'px';
  menu.style.left = rect.left + 'px';
  
  if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
    // Position below
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.bottom = 'auto';
      } else {
    // Position above
    menu.style.bottom = (viewportHeight - rect.top + 4) + 'px';
    menu.style.top = 'auto';
  }
  
  console.log('[CARD-LOG] Menu positioned:', {
    width: menu.style.width,
    left: menu.style.left,
    top: menu.style.top,
    bottom: menu.style.bottom
  });
}

function closeAllCardLogDropdowns() {
  document.getElementById('cameraDropdownWrapper')?.classList.remove('open');
  document.getElementById('userDropdownWrapper')?.classList.remove('open');
  document.getElementById('categoryDropdownWrapper')?.classList.remove('open');
  
  // Hide the menus
  const cameraMenu = document.getElementById('cameraDropdownMenu');
  const userMenu = document.getElementById('userDropdownMenu');
  const categoryMenu = document.getElementById('categoryDropdownMenu');
  if (cameraMenu) cameraMenu.style.display = 'none';
  if (userMenu) userMenu.style.display = 'none';
  if (categoryMenu) categoryMenu.style.display = 'none';
}

// Close all action dropdowns (row and day three-dot menus)
function closeAllCardLogActionDropdowns() {
  const rowDropdown = document.getElementById('cardLogRowActionDropdown');
  const dayDropdown = document.getElementById('cardLogDayActionDropdown');
  
  if (rowDropdown) rowDropdown.classList.remove('show');
  if (dayDropdown) dayDropdown.classList.remove('show');
}

// Delete confirmation modal functions
function showCardLogDeleteModal(message, onConfirm) {
  const modal = document.getElementById('cardLogDeleteModal');
  const messageEl = document.getElementById('cardLogDeleteModalMessage');
  const confirmBtn = document.getElementById('confirmCardLogDeleteBtn');
  
  if (messageEl) messageEl.textContent = message || 'Are you sure you want to delete this entry?';
  
  if (confirmBtn) {
    confirmBtn.onclick = function() {
      if (onConfirm) onConfirm();
      hideCardLogDeleteModal();
    };
  }
  
  if (modal) {
    // Ensure modal is in body
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.classList.add('show');
  }
  document.body.style.overflow = 'hidden';
}

function hideCardLogDeleteModal() {
  const modal = document.getElementById('cardLogDeleteModal');
  if (modal) modal.classList.remove('show');
  document.body.style.overflow = '';
}

// Expose to window for onclick handlers in HTML
window.showCardLogDeleteModal = showCardLogDeleteModal;
window.hideCardLogDeleteModal = hideCardLogDeleteModal;

// ========================================
// SD CARD CALCULATOR MODAL
// ========================================

async function openCalculatorModal() {
  const modal = document.getElementById('sdCardCalculatorModal');
  if (!modal) return;
  
  // Ensure modal is in body
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  
  // Load saved calculator data
  await loadCalculatorData();
}

function closeCalculatorModal() {
  const modal = document.getElementById('sdCardCalculatorModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

async function loadCalculatorData() {
  try {
    const eventId = localStorage.getItem('eventId');
    if (!eventId) {
      generateCamerasPerDay();
      return;
    }
    
    const response = await fetch(`${API_BASE}/api/tables/${eventId}/sd-calculator`, {
      headers: { Authorization: localStorage.getItem('token') }
    });
    
    if (!response.ok) {
      console.log('[SD-CALC] No saved data found, using defaults');
      generateCamerasPerDay();
      return;
    }
    
    const data = await response.json();
    const calcData = data.sdCardCalculator;
      
    if (calcData && calcData.numDays) {
      const numDaysInput = document.getElementById('calcNumDays');
      if (numDaysInput) {
        numDaysInput.value = calcData.numDays;
      }
      
      generateCamerasPerDay();
      
      if (Array.isArray(calcData.camerasPerDay)) {
        calcData.camerasPerDay.forEach((cameras, index) => {
          const input = document.getElementById(`dayCamera${index + 1}`);
          if (input) {
            input.value = cameras;
          }
        });
      }
      
      console.log('[SD-CALC] Loaded saved calculator data:', calcData);

      if (calcData.cardsNeeded > 0) {
        updateCardsNeededBadge(calcData.cardsNeeded);
      }
      if (Array.isArray(calcData.camerasPerDay) && calcData.camerasPerDay.some(c => c > 0)) {
        renderCalculatorResults(calcData.numDays, calcData.camerasPerDay);
      }
    } else {
      generateCamerasPerDay();
    }
  } catch (err) {
    console.error('[SD-CALC] Error loading calculator data:', err);
    generateCamerasPerDay();
  }
}

async function saveCalculatorData() {
  try {
    const eventId = localStorage.getItem('eventId');
    if (!eventId) return;
    
    const numDays = parseInt(document.getElementById('calcNumDays')?.value || 1);
    const camerasPerDay = [];
    
    for (let i = 1; i <= numDays; i++) {
      const cameras = parseInt(document.getElementById(`dayCamera${i}`)?.value || 0);
      camerasPerDay.push(cameras);
    }

    let prevCam = 0, prevExtra = 0, totalNew = 0;
    for (let i = 0; i < camerasPerDay.length; i++) {
      const need = camerasPerDay[i] * 2;
      const reuse = i === 0 ? 0 : prevCam + prevExtra;
      const fresh = Math.max(0, need - reuse);
      totalNew += fresh;
      prevExtra = reuse + fresh - need;
      prevCam = camerasPerDay[i];
    }
    const cardsNeeded = totalNew + numDays * 2;
    
    const response = await fetch(`${API_BASE}/api/tables/${eventId}/sd-calculator`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: localStorage.getItem('token')
      },
      body: JSON.stringify({ numDays, camerasPerDay, cardsNeeded })
    });
    
    if (response.ok) {
      console.log('[SD-CALC] Calculator data saved successfully, cardsNeeded:', cardsNeeded);
    } else {
      console.error('[SD-CALC] Failed to save calculator data');
    }
  } catch (err) {
    console.error('[SD-CALC] Error saving calculator data:', err);
  }
}

function generateCamerasPerDay() {
  const numDays = parseInt(document.getElementById('calcNumDays')?.value || 1);
  const container = document.getElementById('camerasPerDayContainer');
  if (!container) return;
  
  container.innerHTML = '';
  
  for (let i = 1; i <= numDays; i++) {
    const dayInput = document.createElement('div');
    dayInput.className = 'day-camera-input';
    dayInput.innerHTML = `
      <label>Day ${i}</label>
      <div class="day-stepper">
        <button type="button" class="day-stepper-btn" onclick="decrementDayCameras(${i})">
          <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <input type="number" id="dayCamera${i}" value="2" min="0" readonly>
        <button type="button" class="day-stepper-btn" onclick="incrementDayCameras(${i})">
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
    `;
    container.appendChild(dayInput);
  }
}

function incrementDayCameras(dayNum) {
  const input = document.getElementById(`dayCamera${dayNum}`);
  if (input) {
    input.value = parseInt(input.value || 0) + 1;
  }
}

function decrementDayCameras(dayNum) {
  const input = document.getElementById(`dayCamera${dayNum}`);
  if (input) {
    input.value = Math.max(0, parseInt(input.value || 0) - 1);
  }
}

function incrementCalcDays() {
  const input = document.getElementById('calcNumDays');
  if (input) {
    input.value = parseInt(input.value || 1) + 1;
    generateCamerasPerDay();
  }
}

function decrementCalcDays() {
  const input = document.getElementById('calcNumDays');
  if (input) {
    input.value = Math.max(1, parseInt(input.value || 1) - 1);
    generateCamerasPerDay();
  }
}

function renderCalculatorResults(numDays, camerasPerDayArr) {
  const resultsContainer = document.getElementById('calculatorResults');
  if (!resultsContainer) return 0;

  let tableRows = '';
  let prevCameras = 0, prevExtraCards = 0, totalNewCards = 0;

  for (let i = 0; i < numDays; i++) {
    const cameras = camerasPerDayArr[i] || 0;
    const cardsNeeded = cameras * 2;
    const reuseAvailable = i === 0 ? 0 : prevCameras + prevExtraCards;
    const newCards = Math.max(0, cardsNeeded - reuseAvailable);
    const extraCards = reuseAvailable + newCards - cardsNeeded;
    totalNewCards += newCards;

    tableRows += `
      <tr>
        <td>${i + 1}</td>
        <td>${cameras}</td>
        <td>${cardsNeeded}</td>
        <td>${reuseAvailable}</td>
        <td>${newCards}</td>
        <td>${extraCards}</td>
      </tr>
    `;
    prevCameras = cameras;
    prevExtraCards = extraCards;
  }

  const backupsNeeded = numDays * 2;
  const totalWithBackups = totalNewCards + backupsNeeded;

  resultsContainer.innerHTML = `
    <table class="calculator-results-table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Cameras</th>
          <th>Cards Needed</th>
          <th>Reuse</th>
          <th>New Cards</th>
          <th>Extra EOD</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    
    <div class="calculator-summary">
      <div class="summary-row">
        <span class="summary-label">Cards Needed</span>
        <span class="summary-value">${totalNewCards}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Backups (2/day)</span>
        <span class="summary-value">${backupsNeeded}</span>
      </div>
      <div class="summary-row total">
        <span class="summary-label">Cards Total</span>
        <span class="summary-value">${totalWithBackups}</span>
      </div>
    </div>
  `;

  return totalWithBackups;
}

function calculateSDCards() {
  const numDays = parseInt(document.getElementById('calcNumDays')?.value || 1);
  const camerasPerDay = [];
  for (let i = 1; i <= numDays; i++) {
    camerasPerDay.push(parseInt(document.getElementById(`dayCamera${i}`)?.value || 0));
  }

  const totalWithBackups = renderCalculatorResults(numDays, camerasPerDay);
  updateCardsNeededBadge(totalWithBackups);
  saveCalculatorData();
}

function updateCardsNeededBadge(total) {
  const badge = document.getElementById('cardsNeededBadge');
  const countEl = document.getElementById('cardsNeededCount');
  if (badge && countEl) {
    if (total > 0) {
      countEl.textContent = total;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function loadCardsNeededBadge() {
  try {
    const eventId = localStorage.getItem('eventId');
    if (!eventId) return;
    const res = await fetch(`${API_BASE}/api/tables/${eventId}/sd-calculator`, {
      headers: { Authorization: localStorage.getItem('token') }
    });
    if (!res.ok) return;
    const data = await res.json();
    const saved = data.sdCardCalculator;
    if (!saved) return;

    let total = saved.cardsNeeded;
    if ((!total || total <= 0) && Array.isArray(saved.camerasPerDay) && saved.camerasPerDay.some(c => c > 0)) {
      let prevCam = 0, prevExtra = 0, totalNew = 0;
      for (let i = 0; i < saved.camerasPerDay.length; i++) {
        const need = saved.camerasPerDay[i] * 2;
        const reuse = i === 0 ? 0 : prevCam + prevExtra;
        const fresh = Math.max(0, need - reuse);
        totalNew += fresh;
        prevExtra = reuse + fresh - need;
        prevCam = saved.camerasPerDay[i];
      }
      total = totalNew + (saved.numDays || saved.camerasPerDay.length) * 2;
    }

    if (total > 0) {
      updateCardsNeededBadge(total);
    }
  } catch (e) {
    console.error('[SD-CALC] Error loading badge:', e);
  }
}

function clearCalculator() {
  document.getElementById('calcNumDays').value = 1;
  generateCamerasPerDay();
  document.getElementById('calculatorResults').innerHTML = '';
  updateCardsNeededBadge(0);
  saveCalculatorData();
}

function setupCalculatorModal() {
  // Open button
  const openBtn = document.getElementById('openCalculatorBtn');
  if (openBtn) {
    openBtn.addEventListener('click', openCalculatorModal);
  }
  
  // Close button
  const closeBtn = document.getElementById('closeCalculatorModal');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCalculatorModal);
  }
  
  // Increment/Decrement days
  const incrementDaysBtn = document.getElementById('incrementDaysBtn');
  const decrementDaysBtn = document.getElementById('decrementDaysBtn');
  
  if (incrementDaysBtn) {
    incrementDaysBtn.addEventListener('click', incrementCalcDays);
  }
  if (decrementDaysBtn) {
    decrementDaysBtn.addEventListener('click', decrementCalcDays);
  }
  
  // Calculate button
  const calculateBtn = document.getElementById('calculateBtn');
  if (calculateBtn) {
    calculateBtn.addEventListener('click', calculateSDCards);
  }
  
  // Clear button
  const clearBtn = document.getElementById('clearCalculatorBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearCalculator);
  }
  
  // Close on backdrop click
  const modal = document.getElementById('sdCardCalculatorModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeCalculatorModal();
      }
    });
  }
}

// Expose calculator functions to window for onclick handlers
window.incrementDayCameras = incrementDayCameras;
window.decrementDayCameras = decrementDayCameras;

function selectDropdownOption(type, value, displayText) {
  if (type === 'camera') {
    const hiddenInput = document.getElementById('card-camera-select');
    const displayValue = document.getElementById('cameraDropdownValue');
    const menu = document.getElementById('cameraDropdownMenu');
    
    hiddenInput.value = value;
    displayValue.textContent = displayText;
    displayValue.classList.remove('placeholder');
    
    // Update selected state
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
      opt.classList.remove('selected');
      if (opt.getAttribute('data-value') === value) {
        opt.classList.add('selected');
      }
    });
  } else if (type === 'user') {
    const hiddenInput = document.getElementById('card-user-select');
    const displayValue = document.getElementById('userDropdownValue');
    const menu = document.getElementById('userDropdownMenu');
    
    hiddenInput.value = value;
    displayValue.textContent = displayText;
    displayValue.classList.remove('placeholder');
    
    // Update selected state
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
      opt.classList.remove('selected');
      if (opt.getAttribute('data-value') === value) {
        opt.classList.add('selected');
      }
    });
  } else if (type === 'category') {
    const hiddenInput = document.getElementById('card-category-select');
    const displayValue = document.getElementById('categoryDropdownValue');
    const menu = document.getElementById('categoryDropdownMenu');

    hiddenInput.value = value;
    displayValue.textContent = displayText;
    displayValue.classList.remove('placeholder');

    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
      opt.classList.remove('selected');
      if (opt.getAttribute('data-value') === value) {
        opt.classList.add('selected');
      }
    });
  }
  
  closeAllCardLogDropdowns();
    }

function closeCardEntryModal() {
  const modal = document.getElementById('card-entry-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  closeAllCardLogDropdowns();
  currentEditingEntry = null;
  currentEditingDate = null;
}

async function saveCardEntry() {
  // Validate that we have a valid date before saving
  if (!currentEditingDate || currentEditingDate === 'null' || currentEditingDate === 'undefined') {
    console.error('[CARD-LOG] Cannot save entry - invalid currentEditingDate:', currentEditingDate);
    alert('Error: No date selected. Please close the modal and try again.');
    return;
  }
  
  console.log('[CARD-LOG] Saving card entry for date:', currentEditingDate);
  
  const cameraValue = document.getElementById('card-camera-select').value;
  const card1Input = document.getElementById('card-card1-input');
  const card2Input = document.getElementById('card-card2-input');
  const userValue = document.getElementById('card-user-select').value;
  const categoryValue = document.getElementById('card-category-select').value;
  const notesValue = document.getElementById('card-notes-input').value.trim();
  
  // Validate required fields
  if (!userValue) {
    alert('Please select a user');
    return;
  }
  
  // Create entry object
  const entryData = {
    camera: cameraValue,
    card1: card1Input.value.trim(),
    card2: card2Input.value.trim(),
    user: userValue,
    category: categoryValue || '',
    notes: notesValue || '',
    createdBy: getUserIdFromToken(),
    createdAt: currentEditingEntry ? currentEditingEntry.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Use existing ID if editing, otherwise generate new one
  if (currentEditingEntry) {
    entryData._id = currentEditingEntry._id;
  } else {
    entryData._id = `entry-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  try {
    // Update the data structure and save
    await addOrUpdateCardEntry(currentEditingDate, entryData);
    
    // Close modal
    closeCardEntryModal();
    
    console.log('[CARD-LOG] Card entry saved successfully');
  } catch (error) {
    console.error('[CARD-LOG] Error saving card entry:', error);
    alert('Error saving card entry. Please try again.');
  }
}

async function addOrUpdateCardEntry(date, entryData) {
  // Validate date parameter
  if (!date || date === 'null' || date === 'undefined') {
    console.error('[CARD-LOG] Invalid date passed to addOrUpdateCardEntry:', date);
    throw new Error('Invalid date: cannot save entry');
  }
  
  console.log('[CARD-LOG] Adding/updating entry for date:', date);
  
  // Get current card log from DOM
  const tables = document.querySelectorAll('.day-table');
  const cardLog = Array.from(tables).map(dayTable => {
    const dayDate = dayTable.querySelector('h3').textContent;
    const entries = Array.from(dayTable.querySelectorAll('tbody tr')).map(row => {
      const rowId = row.getAttribute('data-id');
      const camera = row.querySelector('[data-field="camera"]').textContent;
      const card1 = row.querySelector('[data-field="card1"]').textContent;
      const card2 = row.querySelector('[data-field="card2"]').textContent;
      const user = row.querySelector('[data-field="user"]').textContent;
      const createdBy = row.getAttribute('data-created-by');
      const createdAt = row.getAttribute('data-created-at');
      const categoryVal = row.getAttribute('data-category');
      const notesVal = row.getAttribute('data-notes');
      
      const entryObj = { _id: rowId, camera, card1, card2, user, createdBy, createdAt, updatedAt: new Date().toISOString() };
      if (categoryVal) entryObj.category = categoryVal;
      if (notesVal) entryObj.notes = notesVal;
      return entryObj;
    });
    
    const dayId = dayTable.getAttribute('data-id');
    return { 
      _id: dayId,
      date: dayDate, 
      entries
    };
  });
  
  // Find the day and update/add the entry
  let dayFound = false;
  cardLog.forEach(day => {
    if (day.date === date) {
      dayFound = true;
      
      if (currentEditingEntry) {
        // Update existing entry
        const entryIndex = day.entries.findIndex(e => e._id === currentEditingEntry._id);
        if (entryIndex !== -1) {
          day.entries[entryIndex] = entryData;
        }
      } else {
        // Add new entry
        day.entries.push(entryData);
      }
    }
  });
  
  // If day doesn't exist, create it
  if (!dayFound) {
    cardLog.push({
      _id: `day-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date,
      entries: [entryData]
    });
  }
  
  // Update the DOM immediately for better UX
  if (currentEditingEntry) {
    // Update existing row in DOM
    updateExistingRowInDOM(date, entryData);
  } else {
    // Add new row to DOM
    addNewRowToDOM(date, entryData);
  }
  
  // Save to backend
  const response = await fetch(`${API_BASE}/api/tables/${localStorage.getItem('eventId')}/cardlog`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: localStorage.getItem('token') },
    body: JSON.stringify({ cardLog })
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || response.statusText);
  }
  
  console.log('[CARD-LOG] Entry saved and DOM updated immediately');
}

// Helper function to add a new row to the DOM immediately
function addNewRowToDOM(date, entryData) {
  // Check if day section exists, create if not
  let dayDiv = document.getElementById(`day-${date}`);
  if (!dayDiv) {
    console.log(`[CARD-LOG] Day section doesn't exist for ${date}, creating it`);
    addDaySection(date, []); // Create empty day section first
    dayDiv = document.getElementById(`day-${date}`);
    
    if (!dayDiv) {
      console.error(`[CARD-LOG] Failed to create day section for ${date}`);
      return;
    }
  }
  
  // Add the row using existing addRow function
  addRow(date, entryData);
  console.log(`[CARD-LOG] Added new row to DOM for date ${date}`);
}

// Helper function to update an existing row in the DOM immediately
function updateExistingRowInDOM(date, entryData) {
  const dayDiv = document.getElementById(`day-${date}`);
  if (!dayDiv) {
    console.error(`[CARD-LOG] Day section not found for ${date}`);
    return;
  }
  
  // Find the specific row by its ID
  const row = dayDiv.querySelector(`tr[data-id="${entryData._id}"]`);
  if (!row) {
    console.error(`[CARD-LOG] Row not found for entry ${entryData._id}`);
    return;
  }
  
  // Update the row's display values
  row.querySelector('[data-field="camera"]').textContent = entryData.camera || '';
  row.querySelector('[data-field="card1"]').textContent = entryData.card1 || '';
  row.querySelector('[data-field="card2"]').textContent = entryData.card2 || '';
  row.querySelector('[data-field="user"]').textContent = entryData.user || '';

  // Update row attributes
  row.setAttribute('data-user', entryData.user || '');
  row.setAttribute('data-created-by', entryData.createdBy || '');
  row.setAttribute('data-created-at', entryData.createdAt || '');
  row.setAttribute('data-category', entryData.category || '');
  row.setAttribute('data-notes', entryData.notes || '');

  // Update category styling
  row.classList.remove('category-video', 'category-headshot');
  const updatedCategory = (entryData.category || '').toLowerCase();
  if (updatedCategory === 'video') row.classList.add('category-video');
  else if (updatedCategory === 'headshot') row.classList.add('category-headshot');

  // Update notes indicator
  const cameraCell = row.querySelector('td:first-child');
  const existingDot = cameraCell.querySelector('.notes-dot');
  if (entryData.notes && entryData.notes.trim()) {
    if (!existingDot) {
      const dot = document.createElement('span');
      dot.className = 'notes-dot';
      dot.title = 'Has notes';
      cameraCell.insertBefore(dot, cameraCell.firstChild);
    }
  } else if (existingDot) {
    existingDot.remove();
  }

  console.log(`[CARD-LOG] Updated existing row in DOM for date ${date}`);
}

window.saveToMongoDB = saveToMongoDB;
window.debounceSave = debounceSave;
window.openDateModal = openDateModal;
window.closeDateModal = closeDateModal;
window.createNewDay = createNewDay;
window.addDaySection = addDaySection;
window.addRow = addRow;
window.loadUsers = loadUsers;
window.loadCardLog = loadCardLog;
window.getUserIdFromToken = getUserIdFromToken;
window.getCurrentUserName = getCurrentUserName;
window.applySmartDayUpdate = applySmartDayUpdate;
window.canEditRow = canEditRow;
window.openCardEntryModal = openCardEntryModal;
window.closeCardEntryModal = closeCardEntryModal;
window.saveCardEntry = saveCardEntry;
window.setupCardLogDropdowns = setupCardLogDropdowns;
window.closeAllCardLogDropdowns = closeAllCardLogDropdowns;
window.selectDropdownOption = selectDropdownOption;
window.positionDropdownMenu = positionDropdownMenu;

// Add CSS for readonly rows
const style = document.createElement('style');
style.textContent = `
  .readonly-row {
    background-color: #f8f9fa;
    opacity: 0.8;
  }
  
  .readonly-row input,
  .readonly-row select {
    background-color: #e9ecef !important;
    cursor: not-allowed;
  }
  
  .readonly-row:hover {
    background-color: #f1f3f4;
  }
`;
document.head.appendChild(style);

// Add test function for debugging
window.testCardLogSave = function() {
  console.log('[TEST] Manually triggering card log save...');
  saveToMongoDB().then(result => {
    console.log('[TEST] Save result:', result);
  }).catch(error => {
    console.error('[TEST] Save error:', error);
  });
};

// Test smart update functionality
window.testSmartUpdate = function(date, testEntries) {
  console.log('[TEST] Testing smart update for date:', date);
  const mockEntries = testEntries || [
    { camera: 'A7IV-A', card1: 'Test1', card2: 'Test2', user: 'TestUser' },
    { camera: 'A7IV-B', card1: 'Test3', card2: 'Test4', user: 'TestUser2' }
  ];
  
  console.log('[TEST] Mock entries:', mockEntries);
  applySmartDayUpdate(date, mockEntries);
};

// Add Socket.IO connection test
window.testSocketConnection = function() {
  console.log('[TEST] Socket.IO connection test:');
  console.log('- window.socket exists:', !!window.socket);
  console.log('- Socket connected:', window.socket?.connected);
  console.log('- Current event ID:', localStorage.getItem('eventId'));
  
  if (window.socket && window.socket.connected) {
    console.log('[TEST] ✅ Socket.IO is connected and ready');
    
    // Test emitting a custom event
    window.socket.emit('test-event', { message: 'Frontend test', tableId: localStorage.getItem('eventId') });
    console.log('[TEST] Sent test event to server');
  } else {
    console.log('[TEST] ❌ Socket.IO is not connected');
  }
};

// Add test to verify event listeners are set up
window.testSocketListeners = function() {
  console.log('[TEST] Testing Socket.IO event listeners...');
  
  // Test if socket listeners are properly attached
  const hasListeners = window.socket && window.socket._callbacks;
  console.log('- Socket has listeners:', !!hasListeners);
  
  if (hasListeners) {
    const listeners = Object.keys(window.socket._callbacks);
    console.log('- Registered listeners:', listeners);
  }
};

// Add cleanup function to window for the app.js navigation system
window.cleanupCardLogPage = cleanupCardLogPage;

// Export the initPage function
window.initPage = window.initPage;

// Smart DOM update function that preserves input values and focus states
function applySmartDayUpdate(date, entries) {
  const dayDiv = document.getElementById(`day-${date}`);
  if (!dayDiv) {
    console.log(`[CARD-LOG] Day section doesn't exist for ${date}, creating new one`);
    addDaySection(date, entries);
    return;
  }
  
  console.log(`[CARD-LOG] Smart updating day section for ${date}`);
  
  // Safety check: if user is actively typing, defer the update
  if (isActivelyEditing) {
    console.log(`[CARD-LOG] User is actively editing, deferring smart update for ${date}`);
    setTimeout(() => {
      if (!isActivelyEditing) {
        console.log(`[CARD-LOG] Retrying deferred smart update for ${date}`);
        applySmartDayUpdate(date, entries);
      }
    }, 500);
    return;
  }
  
  try {
    // Preserve current input values and focus state
    const preservationData = preserveInputStates(dayDiv);
    
    // Get current rows with safety checks
    const tbody = dayDiv.querySelector('tbody');
    if (!tbody || !tbody.isConnected) {
      console.warn(`[CARD-LOG] Invalid tbody for day ${date}, recreating section`);
      addDaySection(date, entries);
      return;
    }
    
    const currentRows = Array.from(tbody.querySelectorAll('tr'));
    const targetEntries = Array.isArray(entries) ? entries : [];
    
    console.log(`[CARD-LOG] Current rows: ${currentRows.length}, Target entries: ${targetEntries.length}`);
    
    // Handle row count differences with safety checks
    if (targetEntries.length > currentRows.length) {
      // Add missing rows
      const rowsToAdd = targetEntries.length - currentRows.length;
      console.log(`[CARD-LOG] Adding ${rowsToAdd} new rows`);
      for (let i = 0; i < rowsToAdd; i++) {
        const rowIndex = currentRows.length + i;
        const entryData = targetEntries[rowIndex] || {};
        try {
          addRow(date, entryData);
        } catch (error) {
          console.error(`[CARD-LOG] Error adding row ${rowIndex}:`, error);
          break; // Stop adding rows if there's an error
        }
      }
    } else if (targetEntries.length < currentRows.length) {
      // Check if extra rows are empty (newly added by user) before removing
      const rowsToRemove = currentRows.length - targetEntries.length;
      console.log(`[CARD-LOG] Found ${rowsToRemove} extra rows - checking if they're newly added empty rows`);
      
      // Only remove rows that are completely empty and likely placeholder rows
      let removedCount = 0;
      for (let i = 0; i < rowsToRemove; i++) {
        const lastRow = tbody.querySelector('tr:last-child');
        if (lastRow && lastRow.isConnected) {
          // Check if this row has any user input or belongs to current user
          const cameraSelect = lastRow.querySelector('.camera-select');
          const card1Input = lastRow.querySelector('[data-field="card1"]');
          const card2Input = lastRow.querySelector('[data-field="card2"]');
          const userSelect = lastRow.querySelector('.user-select');
          
          const hasCamera = cameraSelect && cameraSelect.value && cameraSelect.value !== '';
          const hasCard1 = card1Input && card1Input.value && card1Input.value.trim() !== '';
          const hasCard2 = card2Input && card2Input.value && card2Input.value.trim() !== '';
          const rowUser = userSelect && userSelect.value && userSelect.value !== '';
          const isCurrentUser = rowUser && rowUser === getCurrentUserName();
          
          // Only remove if completely empty AND not belonging to current user
          // This preserves newly added rows that have auto-selected current user
          if (!hasCamera && !hasCard1 && !hasCard2 && !isCurrentUser) {
            console.log(`[CARD-LOG] Removing empty row ${i + 1} (not current user's row)`);
            lastRow.remove();
            removedCount++;
          } else {
            console.log(`[CARD-LOG] Preserving row ${i + 1} - has data or belongs to current user:`, {
              camera: hasCamera, card1: hasCard1, card2: hasCard2, isCurrentUser: isCurrentUser
            });
            // If we hit a row with data or current user's row, stop removing to preserve order
            break;
          }
        }
      }
      console.log(`[CARD-LOG] Removed ${removedCount} out of ${rowsToRemove} extra rows`);
    }
    
    // Update existing rows with new data (but preserve user input if they're actively editing)
    const updatedRows = tbody.querySelectorAll('tr');
    targetEntries.forEach((entry, index) => {
      if (updatedRows[index] && updatedRows[index].isConnected) {
        try {
          updateRowData(updatedRows[index], entry, preservationData);
        } catch (error) {
          console.warn(`[CARD-LOG] Error updating row ${index}:`, error);
          // Continue with other rows
        }
      }
    });
    
    // Update row indices to ensure they're correct after changes
    try {
      updateRowIndices(date);
    } catch (error) {
      console.warn(`[CARD-LOG] Error updating row indices for ${date}:`, error);
    }
    
    console.log(`[CARD-LOG] Smart update completed for ${date}`);
  } catch (error) {
    console.error(`[CARD-LOG] Critical error in applySmartDayUpdate for ${date}:`, error);
    // Fallback: recreate the entire day section
    console.log(`[CARD-LOG] Falling back to full recreation for ${date}`);
    try {
      const existingDay = document.getElementById(`day-${date}`);
      if (existingDay) {
        existingDay.remove();
      }
      addDaySection(date, entries);
    } catch (fallbackError) {
      console.error(`[CARD-LOG] Fallback recreation also failed for ${date}:`, fallbackError);
    }
  }
}

// Preserve input states before DOM manipulation
function preserveInputStates(dayDiv) {
  const preservationData = {
    focusedElement: null,
    inputValues: new Map(),
    selectionStates: new Map()
  };
  
  // Safety check: ensure dayDiv exists and is valid
  if (!dayDiv || !dayDiv.isConnected) {
    console.warn('[CARD-LOG] Invalid or disconnected dayDiv passed to preserveInputStates');
    return preservationData;
  }
  
  try {
    // Get currently focused element
    const activeElement = document.activeElement;
    if (activeElement && dayDiv.contains(activeElement)) {
      const closestTr = activeElement.closest('tr');
      const closestTd = activeElement.closest('td');
      const closestTbody = activeElement.closest('tbody');
      
      // Additional safety checks for DOM structure
      if (closestTr && closestTd && closestTbody) {
        const parentChildren = closestTbody.children;
        const rowChildren = closestTr.children;
        
        // Ensure parent elements exist and have children before accessing
        if (parentChildren && rowChildren && parentChildren.length > 0 && rowChildren.length > 0) {
          preservationData.focusedElement = {
            tagName: activeElement.tagName,
            type: activeElement.type,
            rowIndex: Array.from(parentChildren).indexOf(closestTr),
            cellIndex: Array.from(rowChildren).indexOf(closestTd),
            selectionStart: activeElement.selectionStart,
            selectionEnd: activeElement.selectionEnd
          };
          console.log('[CARD-LOG] Preserving focus state:', preservationData.focusedElement);
        }
      }
    }
    
    // Preserve all input values and selection states with safety checks
    const inputs = dayDiv.querySelectorAll('input, select');
    inputs.forEach((input, index) => {
      try {
        const row = input.closest('tr');
        const cell = input.closest('td');
        
        if (row && cell && row.parentNode && row.children && cell.parentNode) {
          // Additional safety checks for parent elements
          const parentChildren = row.parentNode.children;
          const rowChildren = row.children;
          
          if (parentChildren && rowChildren && parentChildren.length > 0 && rowChildren.length > 0) {
            const rowIndex = Array.from(parentChildren).indexOf(row);
            const cellIndex = Array.from(rowChildren).indexOf(cell);
            
            // Ensure indices are valid
            if (rowIndex >= 0 && cellIndex >= 0) {
              const key = `${rowIndex}-${cellIndex}`;
              
              preservationData.inputValues.set(key, {
                value: input.value || '',
                tagName: input.tagName,
                type: input.type
              });
              
              // Preserve selection state for inputs
              if (input.tagName === 'INPUT' && input.type === 'text') {
                preservationData.selectionStates.set(key, {
                  selectionStart: input.selectionStart || 0,
                  selectionEnd: input.selectionEnd || 0
                });
              }
            }
          }
        }
      } catch (inputError) {
        console.warn(`[CARD-LOG] Error preserving input state for element ${index}:`, inputError);
        // Continue processing other inputs even if one fails
      }
    });
  } catch (error) {
    console.error('[CARD-LOG] Error in preserveInputStates:', error);
    // Return partial data that we were able to preserve
  }
  
  return preservationData;
}

// Update a single row's data while preserving user input
function updateRowData(row, targetEntry, preservationData) {
  // Safety checks
  if (!row || !row.isConnected || !targetEntry) {
    console.warn('[CARD-LOG] Invalid row or entry data in updateRowData');
    return;
  }
  
  try {
    const cells = row.querySelectorAll('td');
    if (!cells || cells.length < 4) {
      console.warn('[CARD-LOG] Insufficient cells in row for updateRowData');
      return;
    }
    
    // Additional safety check for parent structure
    if (!row.parentNode || !row.parentNode.children) {
      console.warn('[CARD-LOG] Invalid parent structure in updateRowData');
      return;
    }
    
    const rowIndex = Array.from(row.parentNode.children).indexOf(row);
    
    // Update camera select (cell 0)
    const cameraSelect = cells[0]?.querySelector('select');
    if (cameraSelect && !isUserCurrentlyEditing(cameraSelect, preservationData)) {
      // Ensure the camera option exists in the dropdown before setting it
      if (targetEntry.camera) {
        let cameraOption = cameraSelect.querySelector(`option[value="${targetEntry.camera}"]`);
        if (!cameraOption && targetEntry.camera) {
          // Camera doesn't exist in dropdown, add it
          if (!cameras.includes(targetEntry.camera)) {
            cameras.push(targetEntry.camera);
            if (!customCameras.includes(targetEntry.camera)) {
              customCameras.push(targetEntry.camera);
              localStorage.setItem(`customCameras_${localStorage.getItem('eventId')}`, JSON.stringify(customCameras));
            }
          }
          // Add the option to this dropdown
          cameraOption = new Option(targetEntry.camera, targetEntry.camera);
          const addNewCameraOption = cameraSelect.querySelector('[value="add-new-camera"]');
          if (addNewCameraOption) {
            cameraSelect.insertBefore(cameraOption, addNewCameraOption);
          } else {
            cameraSelect.appendChild(cameraOption);
          }
        }
        
        if (cameraSelect.value !== targetEntry.camera) {
          console.log(`[CARD-LOG] Updating camera for row ${rowIndex}: ${cameraSelect.value} -> ${targetEntry.camera}`);
          cameraSelect.value = targetEntry.camera;
        }
      }
    }
    
    // Update card1 input (cell 1)
    const card1Input = cells[1]?.querySelector('input');
    if (card1Input && !isUserCurrentlyEditing(card1Input, preservationData)) {
      const targetCard1 = targetEntry.card1 || '';
      if (card1Input.value !== targetCard1) {
        console.log(`[CARD-LOG] Updating card1 for row ${rowIndex}: '${card1Input.value}' -> '${targetCard1}'`);
        card1Input.value = targetCard1;
      }
    }
    
    // Update card2 input (cell 2)  
    const card2Input = cells[2]?.querySelector('input');
    if (card2Input && !isUserCurrentlyEditing(card2Input, preservationData)) {
      const targetCard2 = targetEntry.card2 || '';
      if (card2Input.value !== targetCard2) {
        console.log(`[CARD-LOG] Updating card2 for row ${rowIndex}: '${card2Input.value}' -> '${targetCard2}'`);
        card2Input.value = targetCard2;
      }
    }
    
    // Update user select (cell 3)
    const userSelect = cells[3]?.querySelector('select');
    if (userSelect && !isUserCurrentlyEditing(userSelect, preservationData)) {
      if (targetEntry.user && userSelect.value !== targetEntry.user) {
        console.log(`[CARD-LOG] Updating user for row ${rowIndex}: ${userSelect.value} -> ${targetEntry.user}`);
        userSelect.value = targetEntry.user;
        
        // Update the row's data-user attribute and access control
        row.setAttribute('data-user', targetEntry.user);
        userSelect.setAttribute('data-original-value', targetEntry.user);
        updateRowAccessControl(row, targetEntry.user);
      }
    }
    
    // Update row ID
    if (targetEntry._id) {
      row.setAttribute('data-id', targetEntry._id);
    }
  } catch (error) {
    console.error('[CARD-LOG] Error in updateRowData:', error);
    // Continue execution despite errors to prevent cascading failures
  }
}

// Check if a specific element is currently being edited by the user
function isUserCurrentlyEditing(element, preservationData) {
  if (!preservationData?.focusedElement || !element) return false;
  
  try {
    const row = element.closest('tr');
    const cell = element.closest('td');
    if (!row || !cell || !row.parentNode || !row.children) return false;
    
    const parentChildren = row.parentNode.children;
    const rowChildren = row.children;
    
    if (!parentChildren || !rowChildren || parentChildren.length === 0 || rowChildren.length === 0) {
      return false;
    }
    
    const rowIndex = Array.from(parentChildren).indexOf(row);
    const cellIndex = Array.from(rowChildren).indexOf(cell);
    
    return (preservationData.focusedElement.rowIndex === rowIndex && 
            preservationData.focusedElement.cellIndex === cellIndex);
  } catch (error) {
    console.warn('[CARD-LOG] Error in isUserCurrentlyEditing check:', error);
    return false; // Default to not editing to allow updates
  }
}

// Load collaborative card log system
async function loadCardLogCollaborativeSystem() {
  return new Promise((resolve) => {
    if (window.__collaborativeCardLogLoaded) {
      console.log('✅ Card log collaborative system already loaded');
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = `${API_BASE}/js/card-log-collaborative.js?v=${Date.now()}`;
    script.onload = () => {
      console.log('✅ Card log collaborative system loaded');
      window.__collaborativeCardLogLoaded = true;
      
      // Initialize the collaborative system
      if (window.loadCardLogCollaborativeSystem) {
        window.loadCardLogCollaborativeSystem();
      }
      
      resolve();
    };
    script.onerror = () => {
      console.error('❌ Failed to load card log collaborative system');
      resolve(); // Don't reject, continue without collaborative features
    };
    document.head.appendChild(script);
  });
}

// Check if current user can edit a specific row
function canEditRow(rowUser) {
  if (isOwner) return true; // Owners can edit all rows
  
  const currentUser = getCurrentUserName();
  return rowUser === currentUser; // Non-owners can only edit their own rows
}

// Update access control for a specific row based on user ownership
function updateRowAccessControl(row, rowUser) {
  const canEdit = canEditRow(rowUser);
  
  // Debug logging
  console.log(`[ACCESS] Row user: "${rowUser}", Current user: "${getCurrentUserName()}", Is owner: ${isOwner}, Can edit: ${canEdit}`);
  
  // Update input fields - owners can always edit
  const inputs = row.querySelectorAll('input');
  inputs.forEach(input => {
    input.readOnly = !canEdit;
    input.setAttribute('data-original-value', input.value);
  });
  
  // Update select fields - owners can always edit
  const selects = row.querySelectorAll('select');
  selects.forEach(select => {
    if (select.classList.contains('camera-select')) {
      select.disabled = !canEdit;
      
      // Add/remove "Add New Camera" option based on edit permission
      const addCameraOption = select.querySelector('[value="add-new-camera"]');
      if (canEdit && !addCameraOption) {
        const option = new Option('➕ Add New Camera', 'add-new-camera');
        select.appendChild(option);
      } else if (!canEdit && addCameraOption) {
        addCameraOption.remove();
      }
    } else if (select.classList.contains('user-select')) {
      // User select is controlled by owner status, not row ownership
      select.disabled = !isOwner;
    }
    
    select.setAttribute('data-original-value', select.value);
  });
  
  // Update action toggle button - owners can delete any row, others can only delete their own rows
  const actionToggle = row.querySelector('.row-delete-btn');
  if (!actionToggle && (isOwner || canEdit)) {
    // Add action toggle button if it doesn't exist
    const lastCell = row.querySelector('td:last-child');
    if (lastCell) {
      lastCell.innerHTML = '<button class="row-delete-btn" title="Delete Entry"><span class="material-symbols-outlined">delete</span></button>';
    }
  }
  
  // Update visual styling - owners should NEVER see readonly styling
  if (isOwner || canEdit) {
    // Owners can edit everything, clear any readonly styling
    row.classList.remove('readonly-row');
    row.title = '';
    console.log(`[ACCESS] Removed readonly styling for ${isOwner ? 'owner' : 'row owner'}`);
  } else {
    // Non-owners editing someone else's row
    row.classList.add('readonly-row');
    row.title = `This row belongs to ${rowUser} and cannot be edited`;
    console.log(`[ACCESS] Applied readonly styling - not owner and not row owner`);
  }
}

// Utility function to fix existing DOM structure for collaborative system compatibility
function fixExistingCardLogStructure() {
  console.log('[FIX] Checking and fixing existing card log DOM structure...');
  
  // Fix missing data-date attributes on day sections
  const daySections = document.querySelectorAll('.day-table');
  daySections.forEach(dayDiv => {
    const h3 = dayDiv.querySelector('h3');
    if (h3 && !dayDiv.hasAttribute('data-date')) {
      const date = h3.textContent.trim();
      dayDiv.setAttribute('data-date', date);
      console.log(`[FIX] Added data-date="${date}" to day section`);
    }
  });
  
  // Fix row indices to ensure they're sequential and correct
  daySections.forEach(dayDiv => {
    const tbody = dayDiv.querySelector('tbody');
    if (tbody) {
      const rows = tbody.querySelectorAll('.card-log-row');
      rows.forEach((row, index) => {
        const currentIndex = row.getAttribute('data-row-index');
        if (currentIndex !== index.toString()) {
          row.setAttribute('data-row-index', index);
          console.log(`[FIX] Updated row index from ${currentIndex} to ${index}`);
        }
      });
    }
  });
  
  console.log('[FIX] DOM structure fix completed');
}

// Helper function to update row indices for a specific date
function updateRowIndices(date) {
  const tbody = document.getElementById(`tbody-${date}`);
  if (!tbody) return;
  
  const rows = tbody.querySelectorAll('.card-log-row');
  rows.forEach((row, index) => {
    row.setAttribute('data-row-index', index);
  });
  
  // Also update the day count display
  const dayTable = tbody.closest('.day-table');
  if (dayTable) {
    const countSpan = dayTable.querySelector('.day-count');
    if (countSpan) {
      countSpan.textContent = `(${rows.length})`;
    }
  }
}

// Debug helper to test field identification
window.testFieldIdentification = function() {
  console.log('[TEST] Testing field identification...');
  
  const allInputs = document.querySelectorAll('.day-table input, .day-table select');
  console.log(`[TEST] Found ${allInputs.length} input/select elements`);
  
  allInputs.forEach((input, index) => {
    const row = input.closest('.card-log-row');
    const daySection = input.closest('[data-date]');
    
    if (row && daySection) {
      const date = daySection.getAttribute('data-date');
      const rowIndex = row.getAttribute('data-row-index');
      const fieldName = input.getAttribute('data-field') || input.name || input.className.split(' ')[0];
      
      console.log(`[TEST] Field ${index + 1}: date=${date}, rowIndex=${rowIndex}, field=${fieldName}`);
    } else {
      console.warn(`[TEST] Field ${index + 1}: FAILED - row=${!!row}, daySection=${!!daySection}`);
      console.warn('[TEST] Element:', input);
    }
  });
};

// Debug helper to test access control
window.testAccessControl = function() {
  console.log('[TEST] Testing access control...');
  console.log(`[TEST] Current user is owner: ${isOwner}`);
  console.log(`[TEST] Current user name: "${getCurrentUserName()}"`);
  
  const allRows = document.querySelectorAll('.card-log-row');
  console.log(`[TEST] Found ${allRows.length} rows`);
  
  allRows.forEach((row, index) => {
    const rowUser = row.getAttribute('data-user') || '';
    const canEdit = canEditRow(rowUser);
    const isReadonly = row.classList.contains('readonly-row');
    
    const inputs = row.querySelectorAll('input');
    const selects = row.querySelectorAll('select');
    const readonlyInputs = Array.from(inputs).filter(input => input.readOnly).length;
    const disabledSelects = Array.from(selects).filter(select => select.disabled).length;
    
    console.log(`[TEST] Row ${index + 1}: user="${rowUser}", canEdit=${canEdit}, readonly=${isReadonly}, readonlyInputs=${readonlyInputs}/${inputs.length}, disabledSelects=${disabledSelects}/${selects.length}`);
  });
};

// Helper to force refresh collaborative system (useful for deployment cache issues)
window.forceRefreshCollaborativeSystem = function() {
  console.log('[DEPLOY] Force refreshing collaborative system for deployment...');
  
  // Refresh owner status
  refreshOwnerStatus(isOwner);
  
  // Refresh collaborative system if loaded
  if (window.cardLogCollaborationManager) {
    // Force re-check owner status in collaborative system
    window.cardLogCollaborationManager.canEditRow = function(rowUser) {
      if (!rowUser) return true;
      if (window.isOwner || isOwner) return true; // Check both variables
      const currentUser = this.getCurrentUserName();
      return rowUser === currentUser;
    };
    console.log('[DEPLOY] Collaborative system access control updated');
  }
  
  // Clear any access denied notifications
  document.querySelectorAll('.access-denied-notification').forEach(notification => {
    notification.remove();
  });
  
  console.log('[DEPLOY] Collaborative system refresh complete');
};

// Refresh access control for all existing rows (useful when user permissions change)
function refreshAllRowAccessControl() {
  console.log('[ACCESS] Refreshing access control for all rows...');
  
  const allRows = document.querySelectorAll('.card-log-row');
  allRows.forEach(row => {
    const rowUser = row.getAttribute('data-user') || '';
    updateRowAccessControl(row, rowUser);
    
    // Re-add event listeners for owners on rows they can now edit
    if (isOwner) {
      const cameraSelect = row.querySelector('.camera-select');
      if (cameraSelect && !cameraSelect.hasAttribute('data-listeners-added')) {
        // Mark that we've added listeners to prevent duplicates
        cameraSelect.setAttribute('data-listeners-added', 'true');
        
        cameraSelect.addEventListener('change', function () {
          if (this.value === 'add-new-camera') {
            const newCamera = prompt('Enter new camera name:');
            if (newCamera && newCamera.trim()) {
              const trimmedCamera = newCamera.trim();
              
              // Check if camera already exists
              if (!cameras.includes(trimmedCamera) && !customCameras.includes(trimmedCamera)) {
                customCameras.push(trimmedCamera);
                cameras.push(trimmedCamera);
                
                // Save custom cameras to localStorage for persistence
                localStorage.setItem(`customCameras_${localStorage.getItem('eventId')}`, JSON.stringify(customCameras));
                
                // Add to current dropdown
                const option = new Option(trimmedCamera, trimmedCamera, true, true);
                this.insertBefore(option, this.querySelector('[value="add-new-camera"]'));
                
                // Update all other camera dropdowns to include the new camera
                updateAllCameraDropdowns();
                
                // Trigger save to persist the change
                debounceSave();
                
                console.log(`[CARD-LOG] Added new camera: ${trimmedCamera}`);
              } else {
                alert('Camera already exists!');
                this.value = '';
              }
            } else {
              this.value = '';
            }
          }
        });
      }
    }
  });
  
  // Additional check: If user is owner, ensure no restrictions remain
  if (isOwner) {
    console.log('[ACCESS] Double-checking: clearing any remaining owner restrictions...');
    allRows.forEach(row => {
      row.classList.remove('readonly-row');
      row.title = '';
    });
  }
  
  console.log(`[ACCESS] Refreshed access control for ${allRows.length} rows`);
}

// Enhanced backup system for collaborative editing
function createCardLogBackup() {
  try {
    const eventId = localStorage.getItem('eventId');
    if (!eventId) return;
    
    // Get current card log data from the DOM
    const cardLogData = extractCardLogFromDOM();
    
    if (cardLogData && cardLogData.length > 0) {
      const backup = {
        timestamp: Date.now(),
        eventId: eventId,
        data: cardLogData,
        version: 'v2.0'
      };
      
      // Store in localStorage with rotation (keep last 5 backups)
      const backupKey = `cardlog_backup_${eventId}`;
      const existingBackups = JSON.parse(localStorage.getItem(backupKey) || '[]');
      
      // Add new backup
      existingBackups.unshift(backup);
      
      // Keep only last 5 backups
      if (existingBackups.length > 5) {
        existingBackups.splice(5);
      }
      
      localStorage.setItem(backupKey, JSON.stringify(existingBackups));
      console.log(`💾 Card log backup created: ${cardLogData.length} entries`);
    }
  } catch (error) {
    console.error('❌ Failed to create card log backup:', error);
  }
}

function extractCardLogFromDOM() {
  const cardLogData = [];
  
  document.querySelectorAll('.day-section').forEach(daySection => {
    const date = daySection.getAttribute('data-date');
    if (!date) return;
    
    const entries = [];
    daySection.querySelectorAll('.card-log-row').forEach(row => {
      const entry = {
        _id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        camera: row.querySelector('[data-field="camera"]')?.value || '',
        card1: row.querySelector('[data-field="card1"]')?.value || '',
        card2: row.querySelector('[data-field="card2"]')?.value || '',
        user: row.querySelector('[data-field="user"]')?.value || ''
      };
      
      // Only add non-empty entries
      if (entry.camera || entry.card1 || entry.card2 || entry.user) {
        entries.push(entry);
      }
    });
    
    if (entries.length > 0) {
      cardLogData.push({
        _id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        date: date,
        entries: entries
      });
    }
  });
  
  return cardLogData;
}

function recoverFromBackup() {
  const eventId = localStorage.getItem('eventId');
  if (!eventId) return null;
  
  const backupKey = `cardlog_backup_${eventId}`;
  const backups = JSON.parse(localStorage.getItem(backupKey) || '[]');
  
  if (backups.length === 0) return null;
  
  // Show recovery UI
  const recoveryModal = document.createElement('div');
  recoveryModal.innerHTML = `
    <div class="recovery-modal" style="
      position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
      background: rgba(0,0,0,0.8); z-index: 100000; 
      display: flex; align-items: center; justify-content: center;
    ">
      <div class="recovery-content" style="
        background: white; padding: 30px; border-radius: 10px; 
        max-width: 500px; width: 90%;
      ">
        <h3>🔄 Data Recovery Available</h3>
        <p>Found ${backups.length} backup(s) for this event:</p>
        <div class="backup-list">
          ${backups.map((backup, index) => `
            <div class="backup-item" style="
              border: 1px solid #ddd; padding: 10px; margin: 5px 0; 
              border-radius: 5px; cursor: pointer;
            " onclick="restoreBackup(${index})">
              <strong>Backup ${index + 1}</strong><br>
              <small>${new Date(backup.timestamp).toLocaleString()}</small><br>
              <small>${backup.data.length} days of data</small>
            </div>
          `).join('')}
        </div>
        <div style="margin-top: 20px; text-align: right;">
          <button onclick="this.closest('.recovery-modal').remove()" 
                  style="margin-right: 10px; padding: 8px 16px;">Cancel</button>
          <button onclick="restoreBackup(0)" 
                  style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px;">
            Restore Latest
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(recoveryModal);
  
  window.restoreBackup = function(backupIndex) {
    const backup = backups[backupIndex];
    if (backup && backup.data) {
      // Restore the data
      localStorage.setItem('cardlog_recovery_data', JSON.stringify(backup.data));
      location.reload();
    }
  };
}

// Auto-backup every 30 seconds during editing
let autoBackupInterval = setInterval(() => {
  if (document.querySelector('.card-log-row')) {
    createCardLogBackup();
  }
}, 30000);
})();
