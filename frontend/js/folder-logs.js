(function() {
window.initPage = undefined;
    const token = localStorage.getItem('token');
    const params = new URLSearchParams(window.location.search);
    let tableId = params.get('id') || localStorage.getItem('eventId');

    // Use a function to get the current table ID to ensure it's always current
    function getCurrentTableId() {
      const params = new URLSearchParams(window.location.search);
      return params.get('id') || localStorage.getItem('eventId');
    }

    // Add guard for missing ID
    if (!tableId) {
      console.warn('No table ID provided, redirecting to dashboard...');
      window.location.href = 'dashboard.html';
      return;
    }

    let isOwner = false;
    let editMode = false;
    let deferredUpdate = false;
    let pageInitialized = false;

    // Initialize back button
    const backToEventBtn = document.getElementById('backToEventBtn');
    if (backToEventBtn) {
      backToEventBtn.addEventListener('click', function() {
        // Navigate back to dashboard with the general page loaded for this event using hash only
        window.location.href = 'dashboard.html#general';
      });
    }

    function getUserIdFromToken() {
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.id;
    }

    function formatDateReadable(dateStr) {
      if (!dateStr) return '';
      const [year, month, day] = dateStr.split('-');
      return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
    }

    function autoResizeTextarea(el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    function populateTable(rows) {
      console.log('populateTable called with editMode:', editMode);
      const table = document.getElementById('folderLogTable')?.querySelector("tbody");
      if (!table) return;
      table.innerHTML = '';

      rows.forEach(item => {
        const row = document.createElement("tr");

        if (!editMode) {
          console.log('Not in edit mode, showing readonly view');
          row.innerHTML = `
            <td class="date"><span class="readonly-span">${formatDateReadable(item.date)}</span></td>
            <td class="text"><span class="readonly-span">${item.description || ''}</span></td>
            <td class="text"><span class="readonly-span">${item.folderName || ''}</span></td>
            <td class="action"></td>
          `;
        } else {
          console.log('In edit mode, showing editable view with delete button');
          row.innerHTML = `
            <td class="date"><input type="date" value="${item.date || ''}"></td>
            <td class="text"><textarea>${item.description || ''}</textarea></td>
            <td class="text"><textarea>${item.folderName || ''}</textarea></td>
            <td class="action"><button type="button" class="delete-btn" onclick="window.removeRow(this)" style="visibility: visible !important; display: inline-block !important; opacity: 1 !important;"><span class="material-symbols-outlined">delete</span></button></td>
          `;
        }

        table.appendChild(row);
      });

      table.querySelectorAll('textarea').forEach(autoResizeTextarea);
    }

    function collectTableData() {
      const table = document.getElementById('folderLogTable')?.querySelectorAll("tbody tr");
      if (!table) return [];
      return Array.from(table).map(row => {
        const inputs = row.querySelectorAll('input, textarea');
        return {
          date: inputs[0]?.value || '',
          description: inputs[1]?.value || '',
          folderName: inputs[2]?.value || ''
        };
      });
    }

    function addRow(tableId) {
      console.log('addRow called for folderLogTable, editMode:', editMode);
      // Don't allow adding rows if not in edit mode or not an owner
      if (!editMode || !isOwner) {
        console.log('Cannot add row: editMode is', editMode, 'isOwner is', isOwner);
        return;
      }
      const table = document.getElementById('folderLogTable')?.querySelector("tbody");
      console.log('table element:', table);
      if (!table) {
        console.log('No table/tbody found for folderLogTable');
        return;
      }
      const row = document.createElement("tr");

      row.innerHTML = `
        <td class="date"><input type="date"></td>
        <td class="text"><textarea></textarea></td>
        <td class="text"><textarea></textarea></td>
        <td class="action"><button class="delete-btn" onclick="window.removeRow(this)"><span class="material-symbols-outlined">delete</span></button></td>
      `;

      table.appendChild(row);
      row.querySelectorAll('textarea').forEach(autoResizeTextarea);
      console.log('Row appended to folderLogTable');
    }

    function removeRow(button) {
      console.log('removeRow called', button);
      const row = button.closest('tr');
      console.log('row to remove:', row);
      if (row) {
        row.remove();
        console.log('row removed');
      }
    }

    async function loadData() {
      // Always ensure we're using the current tableId
      const currentTableId = getCurrentTableId();
      if (currentTableId !== tableId) {
        console.log(`TableId changed from ${tableId} to ${currentTableId}`);
        tableId = currentTableId;
      }
      
      console.log('Fetching folder logs data for tableId:', tableId);
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/folder-logs`, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      populateTable(data.folders);
    }

    async function saveData() {
      // Always ensure we're using the current tableId
      const currentTableId = getCurrentTableId();
      if (currentTableId !== tableId) {
        console.log(`TableId changed from ${tableId} to ${currentTableId}`);
        tableId = currentTableId;
      }
      
      const folderRows = collectTableData();
      await fetch(`${API_BASE}/api/tables/${tableId}/folder-logs`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ folders: folderRows })
      });
      editMode = false;
      const editModeBtn = document.getElementById('editModeBtn');
      const saveBtn = document.getElementById('saveBtn');
      if (editModeBtn) editModeBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.style.display = 'none';
      
      // Check if there was a deferred update while in edit mode
      if (deferredUpdate) {
        console.log('Applying deferred update after saving');
        deferredUpdate = false;
        await loadData();
      } else {
        await loadData();
      }
    }

    function enterEditMode() {
      console.log('[FOLDER-LOGS] enterEditMode called', { isOwner, editMode, pageInitialized });
      
      // Wait for page initialization if not ready
      if (!pageInitialized) {
        console.log('[FOLDER-LOGS] Page not initialized yet, waiting...');
        alert('Please wait for the page to finish loading before editing.');
        return;
      }
      
      console.log('[FOLDER-LOGS] Current user permissions - isOwner:', isOwner);
      console.log('[FOLDER-LOGS] Token available:', !!token);
      
      // Get fresh user ID and check ownership again
      const userId = getUserIdFromToken();
      console.log('[FOLDER-LOGS] Current userId from token:', userId);
      
      if (!isOwner) {
        console.log('[FOLDER-LOGS] User is not an owner, cannot enter edit mode');
        console.log('[FOLDER-LOGS] Debug info - userId:', userId, 'isOwner:', isOwner);
        alert('You do not have permission to edit this folder log. Only table owners can edit.');
        return;
      }
      
      editMode = true;
      console.log('[FOLDER-LOGS] Edit mode set to:', editMode);
      
      const editModeBtn = document.getElementById('editModeBtn');
      const saveBtn = document.getElementById('saveBtn');
      
      if (editModeBtn) {
        editModeBtn.style.display = 'none';
        console.log('[FOLDER-LOGS] Edit button hidden');
      } else {
        console.log('[FOLDER-LOGS] Edit button not found!');
      }
      
      if (saveBtn) {
        saveBtn.style.display = 'inline-block';
        console.log('[FOLDER-LOGS] Save button shown');
      } else {
        console.log('[FOLDER-LOGS] Save button not found!');
      }
      
      loadData();
    }

    // Expose functions on window
    window.addRow = addRow;
    window.removeRow = removeRow;
    window.saveData = saveData;
    window.enterEditMode = enterEditMode;

    // Debug functions for testing Socket.IO
    window.testSocketConnection = function() {
      if (window.socket) {
        console.log('Socket.IO connection status:', window.socket.connected);
        console.log('Socket.IO ID:', window.socket.id);
        return window.socket.connected;
      } else {
        console.log('Socket.IO not available');
        return false;
      }
    };

    window.testSocketListeners = function() {
      if (window.socket) {
        console.log('Testing Socket.IO event listeners...');
        console.log('Current tableId:', tableId);
        console.log('Edit mode:', editMode);
        console.log('Deferred update:', deferredUpdate);
        
        // Test emitting a fake event to see if listeners work
        console.log('Emitting test folderLogsChanged event...');
        window.socket.emit('test', { message: 'Testing from folder-logs page' });
        
        return true;
      } else {
        console.log('Socket.IO not available for testing');
        return false;
      }
    };

    // Test function for edit button
    window.testEditButton = function() {
      console.log('[FOLDER-LOGS] Testing edit button functionality...');
      console.log('[FOLDER-LOGS] isOwner:', isOwner);
      console.log('[FOLDER-LOGS] editMode:', editMode);
      console.log('[FOLDER-LOGS] pageInitialized:', pageInitialized);
      
      const editBtn = document.getElementById('editModeBtn');
      const saveBtn = document.getElementById('saveBtn');
      
      console.log('[FOLDER-LOGS] Edit button element:', editBtn);
      console.log('[FOLDER-LOGS] Save button element:', saveBtn);
      
      if (editBtn) {
        console.log('[FOLDER-LOGS] Edit button display:', editBtn.style.display);
        console.log('[FOLDER-LOGS] Edit button onclick:', editBtn.onclick);
      }
      
      // Try calling enterEditMode directly
      console.log('[FOLDER-LOGS] Calling enterEditMode directly...');
      enterEditMode();
    };

    // Debug function to check current state
    window.debugFolderLogsState = function() {
      console.log('[FOLDER-LOGS] === CURRENT STATE DEBUG ===');
      console.log('[FOLDER-LOGS] pageInitialized:', pageInitialized);
      console.log('[FOLDER-LOGS] isOwner:', isOwner);
      console.log('[FOLDER-LOGS] editMode:', editMode);
      console.log('[FOLDER-LOGS] tableId:', tableId);
      console.log('[FOLDER-LOGS] token available:', !!token);
      
      const userId = getUserIdFromToken();
      console.log('[FOLDER-LOGS] Current userId from token:', userId);
      
      const editBtn = document.getElementById('editModeBtn');
      const saveBtn = document.getElementById('saveBtn');
      console.log('[FOLDER-LOGS] Edit button found:', !!editBtn);
      console.log('[FOLDER-LOGS] Save button found:', !!saveBtn);
      
      if (editBtn) {
        console.log('[FOLDER-LOGS] Edit button display style:', editBtn.style.display);
        console.log('[FOLDER-LOGS] Edit button visible:', editBtn.offsetParent !== null);
      }
      
      console.log('[FOLDER-LOGS] === END STATE DEBUG ===');
    };

    // Manual initialization function for troubleshooting
    window.manualInitFolderLogs = function() {
      console.log('[FOLDER-LOGS] Manual initialization called');
      if (window.initPage) {
        window.initPage();
      } else {
        console.error('[FOLDER-LOGS] initPage function not available');
      }
    };

    // Setup Socket.IO listeners after page initialization
    function setupSocketListeners() {
      console.log('[FOLDER-LOGS] Setting up Socket.IO listeners...');
      if (window.socket) {
        // Listen for folder logs specific updates
        window.socket.on('folderLogsChanged', (data) => {
          // Always get the most current tableId
          const currentTableId = getCurrentTableId();
          
          console.log('[FOLDER-LOGS] Folder logs data changed, checking if relevant...');
          // Only reload if it's for the current table
          if (data && data.tableId && data.tableId !== currentTableId) {
            console.log('[FOLDER-LOGS] Update was for a different table, ignoring');
            return;
          }
          console.log('[FOLDER-LOGS] Reloading folder logs data for current table');
          tableId = currentTableId; // Update the tableId
          
          // Don't reload if user is actively editing to avoid disrupting their work
          if (!editMode) {
            loadData();
          } else {
            console.log('[FOLDER-LOGS] User is in edit mode, deferring reload');
            deferredUpdate = true;
          }
        });
        
        // Also listen for general table updates
        window.socket.on('tableUpdated', (data) => {
          // Always get the most current tableId
          const currentTableId = getCurrentTableId();
          
          console.log('[FOLDER-LOGS] Table updated, checking if relevant...');
          // Only reload if it's for the current table
          if (data && data.tableId && data.tableId !== currentTableId) {
            console.log('[FOLDER-LOGS] Update was for a different table, ignoring');
            return;
          }
          console.log('[FOLDER-LOGS] Reloading folder logs data for current table');
          tableId = currentTableId; // Update the tableId
          
          // Don't reload if user is actively editing to avoid disrupting their work
          if (!editMode) {
            loadData();
          } else {
            console.log('[FOLDER-LOGS] User is in edit mode, deferring reload');
            deferredUpdate = true;
          }
        });
        
        // Log connection status changes
        window.socket.on('connect', () => {
          console.log('[FOLDER-LOGS] Socket.IO connected - Folder logs page will receive live updates');
        });
        
        window.socket.on('disconnect', () => {
          console.log('[FOLDER-LOGS] Socket.IO disconnected - Folder logs page live updates paused');
        });
        
        console.log('[FOLDER-LOGS] Socket.IO listeners set up successfully');
      } else {
        console.log('[FOLDER-LOGS] Socket.IO not available, skipping listener setup');
      }
    }

    // Add click handler for delete buttons
    document.addEventListener('click', function(e) {
      // Check if the clicked element is a delete button or a child of a delete button
      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        console.log('Delete button clicked');
        window.removeRow(deleteBtn);
      }
    });

    window.initPage = async function(id) {
      console.log('[FOLDER-LOGS] initPage called with id:', id);
      const tableIdToUse = id || tableId;
      
      // Initialize Lucide icons for the back button
      if (window.lucide) {
        lucide.createIcons();
      }
      
      try {
        const res = await fetch(`${API_BASE}/api/tables/${tableIdToUse}`, {
          headers: { Authorization: token }
        });

        if (!res.ok) {
          throw new Error(`Failed to load table: ${res.status}`);
        }

        const table = await res.json();
        const eventTitleEl = document.getElementById('eventTitle');
        if (eventTitleEl) eventTitleEl.textContent = table.title;
        
        const userId = getUserIdFromToken();
        console.log('[FOLDER-LOGS] Raw table data:', table);
        console.log('[FOLDER-LOGS] Table owners:', table.owners);
        console.log('[FOLDER-LOGS] Table owners type:', typeof table.owners);
        console.log('[FOLDER-LOGS] User ID from token:', userId);
        console.log('[FOLDER-LOGS] User ID type:', typeof userId);
        
        // More robust ownership check
        let ownershipCheck = false;
        if (Array.isArray(table.owners)) {
          // Convert both to strings for comparison
          const ownerIds = table.owners.map(id => String(id));
          const userIdStr = String(userId);
          ownershipCheck = ownerIds.includes(userIdStr);
          console.log('[FOLDER-LOGS] Owner IDs (as strings):', ownerIds);
          console.log('[FOLDER-LOGS] User ID (as string):', userIdStr);
          console.log('[FOLDER-LOGS] Ownership check result:', ownershipCheck);
        } else {
          console.log('[FOLDER-LOGS] Table owners is not an array:', table.owners);
        }
        
        isOwner = ownershipCheck;
        console.log('[FOLDER-LOGS] Final isOwner value:', isOwner);
        
        // Hide edit button for non-owners
        const editModeBtn = document.getElementById('editModeBtn');
        if (!isOwner && editModeBtn) {
          editModeBtn.style.display = 'none';
          console.log('[FOLDER-LOGS] Edit button hidden for non-owner');
        } else if (editModeBtn) {
          console.log('[FOLDER-LOGS] Edit button visible for owner');
        } else {
          console.log('[FOLDER-LOGS] Edit button not found in DOM!');
        }
        
        // Hide add row buttons for non-owners
        const addRowButtons = document.querySelectorAll('.add-btn');
        if (!isOwner && addRowButtons) {
          addRowButtons.forEach(btn => {
            btn.style.display = 'none';
          });
          console.log('[FOLDER-LOGS] Add row buttons hidden for non-owner');
        }
        
        await loadData();
        
        // Setup Socket.IO listeners after page is initialized
        setupSocketListeners();
        
        // Mark page as initialized
        pageInitialized = true;
        console.log('[FOLDER-LOGS] Page initialization complete - pageInitialized set to true');
      } catch (error) {
        console.error('[FOLDER-LOGS] Error initializing folder logs page:', error);
        alert('Failed to load folder logs information. Please try again.');
      }
    };

    // Call initPage on DOMContentLoaded to ensure isOwner is set before user interaction
    document.addEventListener('DOMContentLoaded', function() {
      console.log('[FOLDER-LOGS] DOMContentLoaded event fired');
      console.log('[FOLDER-LOGS] Calling initPage from DOMContentLoaded');
      window.initPage();
    });

    // Also ensure initialization happens if DOM is already loaded
    if (document.readyState === 'loading') {
      console.log('[FOLDER-LOGS] Document still loading, waiting for DOMContentLoaded');
    } else {
      console.log('[FOLDER-LOGS] Document already loaded, calling initPage immediately');
      // Use setTimeout to ensure this runs after the current execution context
      setTimeout(() => {
        console.log('[FOLDER-LOGS] Calling initPage from immediate timeout');
        window.initPage();
      }, 0);
    }
})(); 