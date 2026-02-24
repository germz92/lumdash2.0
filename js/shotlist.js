// ===== SHOTLIST FUNCTIONALITY v4.0 - EDIT_ITEMS =====
// Added ability for owners and leads to edit existing shot list items
// Click on text to enter edit mode, Save/Cancel buttons appear, keyboard shortcuts (Enter/Escape)

// Use IIFE to prevent variable conflicts and create a clean scope
(function() {
  
// Get API base URL
const API_BASE = window.API_BASE || 'https://spa-lumdash-backend.onrender.com';
  
// Prevent multiple script loading conflicts
if (window.shotlistModule) {
  console.log('🎯 SHOTLIST: Module already loaded, cleaning up...');
  if (window.cleanupShotlist) {
    window.cleanupShotlist();
  }
}

// Reset module completely
window.shotlistModule = {
  shotlists: [],
  currentUserRole: null,
  isUserEditing: false,
  isInitialized: false
};

// Direct references to module variables to avoid sync issues
let shotlists = window.shotlistModule.shotlists;
let currentUserRole = window.shotlistModule.currentUserRole;
let isUserEditing = window.shotlistModule.isUserEditing;
let isInitialized = window.shotlistModule.isInitialized;
let selectedListId = null; // Track which list is currently selected

// Save list selection to sessionStorage
function saveListSelection() {
  const tableId = getCurrentTableId();
  if (!tableId) {
    debugLog('No table ID available for saving list selection');
    return;
  }
  
  const settings = {
    selectedListId: selectedListId
  };
  
  debugLog('Saving list selection:', { selectedListId, tableId });
  sessionStorage.setItem(`shotlist_${tableId}_settings`, JSON.stringify(settings));
}

// Restore list selection from sessionStorage  
function restoreListSelection() {
  const tableId = getCurrentTableId();
  if (!tableId) {
    debugLog('No table ID available for restoring list selection');
    return;
  }
  
  const settingsJson = sessionStorage.getItem(`shotlist_${tableId}_settings`);
  if (!settingsJson) {
    debugLog('No saved list selection found for table:', tableId);
    return;
  }
  
  try {
    const settings = JSON.parse(settingsJson);
    debugLog('Restoring list selection:', settings);
    
    if (settings.selectedListId) {
      // Check if the saved list still exists
      const listExists = shotlists.some(list => 
        (list._id && list._id === settings.selectedListId) ||
        `temp-list-${shotlists.indexOf(list)}` === settings.selectedListId
      );
      
      if (listExists) {
        selectedListId = settings.selectedListId;
        debugLog('Successfully restored list selection:', selectedListId);
      } else {
        debugLog('Saved list no longer exists, using default selection');
      }
    }
  } catch (err) {
    console.error('Error restoring list selection:', err);
  }
}

// Helper to sync local variables with module
const syncToModule = () => {
  window.shotlistModule.shotlists = shotlists;
  window.shotlistModule.currentUserRole = currentUserRole;
  window.shotlistModule.isUserEditing = isUserEditing;
  window.shotlistModule.isInitialized = isInitialized;
};

// Debug logging with prefix
const debugLog = (message, data = null) => {
  console.log(`🎯 SHOTLIST: ${message}`, data || '');
};

// Initialize shotlist page
async function initializeShotlist() {
  debugLog('Starting initialization...');
  
  try {
    // Setup event listeners
    setupEventListeners();
    debugLog('Event listeners set up');
    
    // Setup list event delegation
    setupListEventDelegation();
    debugLog('List event delegation set up');

    // Load initial data (this will also determine user role)
    await loadShotlists();
    debugLog('Initial data loaded');

    // Setup socket listeners
    setupSocketListeners();
    debugLog('Socket listeners set up');

    isInitialized = true;
    syncToModule();
    debugLog('Initialization complete');

  } catch (error) {
    console.error('🎯 SHOTLIST: Initialization failed:', error);
  }
}

// Get user role for permission checking based on table data
function getUserRole(tableData) {
  try {
    const userId = localStorage.getItem('userId');
    if (!userId || !tableData) {
      currentUserRole = 'viewer';
      syncToModule();
      return 'viewer';
    }

    const isOwner = Array.isArray(tableData.owners) && tableData.owners.includes(userId);
    const isLead = Array.isArray(tableData.leads) && tableData.leads.includes(userId);
    
    let role = 'viewer';
    if (isOwner) {
      role = 'owner';
    } else if (isLead) {
      role = 'lead';
    }
    
    currentUserRole = role;
    syncToModule();
    debugLog('User role determined', { userId, role, isOwner, isLead });
    return role;
  } catch (error) {
    console.error('🎯 SHOTLIST: Error getting user role:', error);
    currentUserRole = 'viewer';
    syncToModule();
    return 'viewer';
  }
}

// Check if user can edit lists and delete items (owners and leads)
function canUserEdit() {
  return currentUserRole === 'owner' || currentUserRole === 'lead';
}

// Check if user can toggle checkboxes (all authenticated users)
function canUserToggleItems() {
  return currentUserRole === 'owner' || currentUserRole === 'lead' || currentUserRole === 'viewer';
}

// Setup event listeners
function setupEventListeners() {
  debugLog('Setting up event listeners...');

  // Add new list - use event delegation to avoid issues with re-rendering
  document.addEventListener('click', (e) => {
    if (e.target.id === 'add-list-btn' || e.target.closest('#add-list-btn')) {
      e.preventDefault();
      e.stopPropagation();
      handleAddList();
    }
  });
  
  document.addEventListener('keypress', (e) => {
    if (e.target.id === 'new-list-input' && e.key === 'Enter') {
      e.preventDefault();
      handleAddList();
    }
  });
  
  document.addEventListener('focus', (e) => {
    if (e.target.id === 'new-list-input') {
      isUserEditing = true;
      syncToModule();
      debugLog('User started editing list input');
    }
  }, true);
  
  document.addEventListener('blur', (e) => {
    if (e.target.id === 'new-list-input') {
      setTimeout(() => {
        isUserEditing = false;
        syncToModule();
        debugLog('User stopped editing list input');
      }, 100);
    }
  }, true);
  
  // List selector dropdown is now handled in setupListEventDelegation
}

// Setup socket listeners
function setupSocketListeners() {
  debugLog('Setting up socket listeners...');
  
  if (typeof socket !== 'undefined' && socket) {
    // Remove any existing listeners to prevent duplicates
    socket.off('shotlistsUpdated', handleShotlistsUpdate);
    
    // Add the listener
    socket.on('shotlistsUpdated', handleShotlistsUpdate);
    
    // Join table-specific room for targeted updates
    const tableId = getCurrentTableId();
    if (tableId) {
      socket.emit('joinTable', tableId);
      console.log('🎯 SHOTLIST: Joined socket room for table:', tableId);
    }
    
    console.log('🎯 SHOTLIST: Socket listeners registered');
    debugLog('Socket listeners registered');
  } else {
    console.warn('🎯 SHOTLIST: Socket not available - real-time updates disabled');
    debugLog('Socket not available');
  }
}

// Handle socket updates
function handleShotlistsUpdate(data) {
  console.log('🎯 SHOTLIST: Received real-time update from socket', data);
  debugLog('Received shotlists update from socket', data);
  debugLog('Socket shotlists data:', data.shotlists);
  
  // Skip update if it's from the same table (to avoid infinite loops)
  const currentTableId = getCurrentTableId();
  if (data.tableId && data.tableId !== currentTableId) {
    console.log('🎯 SHOTLIST: Update for different table, ignoring');
    return;
  }
  
  if (isUserEditing) {
    console.log('🎯 SHOTLIST: User is editing, deferring update for 100ms');
    debugLog('User is editing, deferring update');
    setTimeout(() => handleShotlistsUpdate(data), 100);
    return;
  }
  
  // Check if we actually have new data
  if (!data.shotlists || !Array.isArray(data.shotlists)) {
    console.warn('🎯 SHOTLIST: Invalid shotlists data received');
    return;
  }
  
// Socket update data validated
  
  // Preserve currently selected list
  const currentSelectedListId = selectedListId;
  
  // Validate and ensure IDs are preserved
  const updatedShotlists = data.shotlists.map(list => {
    if (!list._id) {
      debugLog('WARNING: List missing _id, generating new one:', list);
      list._id = generateId();
    }
    
    // Ensure items have IDs too
    if (list.items) {
      list.items = list.items.map(item => {
        if (!item._id) {
          debugLog('WARNING: Item missing _id, generating new one:', item);
          item._id = generateId();
        }
        return item;
      });
    }
    
    return list;
  });
  
  // Check if the data has actually changed to avoid unnecessary re-renders
  const dataChanged = JSON.stringify(shotlists) !== JSON.stringify(updatedShotlists);
  
  if (!dataChanged) {
    console.log('🎯 SHOTLIST: Socket data identical to local data, skipping update');
    return;
  }

  console.log('🎯 SHOTLIST: Applying real-time update with', updatedShotlists.length, 'lists');
  shotlists = updatedShotlists;
  
  // Restore selected list if it still exists
  if (currentSelectedListId) {
    const listStillExists = shotlists.some(list => 
      (list._id && list._id === currentSelectedListId) || 
      `temp-list-${shotlists.indexOf(list)}` === currentSelectedListId
    );
    if (listStillExists) {
      selectedListId = currentSelectedListId;
    } else if (shotlists.length > 0) {
      selectedListId = shotlists[0]._id || `temp-list-0`;
    }
  }
  
  syncToModule();
  renderShotlists();
  console.log('🎯 SHOTLIST: Real-time update applied successfully');
}

// Load shotlists from server
async function loadShotlists() {
  debugLog('Loading shotlists from server...');
  
  try {
    const tableId = getCurrentTableId();
    if (!tableId) {
      debugLog('No table ID available');
      return;
    }

    const response = await fetch(`${API_BASE}/api/tables/${tableId}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load table: ${response.status}`);
    }

    const tableData = await response.json();
    shotlists = tableData.shotlists || [];
    
    // Determine user role based on table data
    getUserRole(tableData);
    
    // Restore saved list selection before rendering
    restoreListSelection();
    
    // Important: sync after updating shotlists
    syncToModule();
    debugLog('Shotlists loaded', shotlists);
    
    renderShotlists();
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to load shotlists:', error);
    shotlists = [];
    // Set default role when we can't load table data
    currentUserRole = 'viewer';
    syncToModule();
    renderShotlists();
  }
}

// Get current table ID
function getCurrentTableId() {
  try {
    const tableId = localStorage.getItem('currentTable');
    debugLog('Current table ID', tableId);
    return tableId;
  } catch (error) {
    console.error('🎯 SHOTLIST: Error getting table ID:', error);
    return null;
  }
}

// Handle adding new list
async function handleAddList() {
  const input = document.getElementById('new-list-input');
  const listName = input.value.trim();
  
  if (!listName) {
    debugLog('Empty list name provided');
    return;
  }
  
  if (!canUserEdit()) {
    debugLog('User cannot edit');
    return;
  }
  
  debugLog('Adding new list', listName);
  
  try {
    const newList = {
      name: listName,
      items: [],
      createdAt: new Date().toISOString(),
      createdBy: localStorage.getItem('userId') || 'unknown'
    };
    
    shotlists.push(newList);
    syncToModule();
    
    // Select the newly created list
    const newListIndex = shotlists.length - 1;
    selectedListId = newList._id || `temp-list-${newListIndex}`;
    saveListSelection(); // Save the new selection
    
    input.value = '';
    
    // Render immediately for responsive UI (optimistic update)
    renderShotlists();
    
    // Then save to server
    await saveShotlists();
    debugLog('List added successfully');
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to add list:', error);
  }
}

// Handle adding item to list
async function handleAddItem(listId, input) {
  if (!canUserEdit()) {
    debugLog('User cannot edit - only owners can add items');
    return;
  }
  
  const title = input.value.trim();
  
  if (!title) {
    debugLog('Empty item title provided');
    return;
  }
  
  debugLog('Adding item to list', { listId, title });
  
  try {
    // Try to find by ID first, then by index if it's a temp ID
    let list = shotlists.find(l => l._id === listId);
    
    if (!list && listId.startsWith('temp-list-')) {
      const tempIndex = parseInt(listId.replace('temp-list-', ''));
      if (!isNaN(tempIndex) && tempIndex < shotlists.length) {
        list = shotlists[tempIndex];
      }
    }
    
    if (!list) {
      debugLog('List not found', listId);
      return;
    }
    
    const newItem = {
      title: title,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: localStorage.getItem('userId') || 'unknown'
    };
    
    list.items.push(newItem);
    
    // Clear input immediately and mark it as cleared
    input.value = '';
    input.dataset.shouldClear = 'true';
    
    // Render immediately for responsive UI (optimistic update)
    renderShotlists();
    
    await saveShotlists();
    debugLog('Item added successfully');
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to add item:', error);
  }
}

// Toggle item completion
async function toggleItemCompletion(listId, itemId) {
  if (!canUserToggleItems()) {
    debugLog('User cannot toggle items');
    return;
  }
  
  debugLog('Toggling item completion', { listId, itemId });
  
  try {
    // Try to find by ID first, then by index if it's a temp ID
    let list = shotlists.find(l => l._id === listId);
    
    if (!list && listId.startsWith('temp-list-')) {
      const tempIndex = parseInt(listId.replace('temp-list-', ''));
      if (!isNaN(tempIndex) && tempIndex < shotlists.length) {
        list = shotlists[tempIndex];
      }
    }
    
    if (!list) {
      debugLog('List not found', listId);
      return;
    }
    
    // Try to find by ID first, then by index if it's a temp ID
    let item = list.items.find(i => i._id === itemId);
    
    if (!item && itemId.startsWith('temp-item-')) {
      const tempIndex = parseInt(itemId.replace('temp-item-', ''));
      if (!isNaN(tempIndex) && tempIndex < list.items.length) {
        item = list.items[tempIndex];
      }
    }
    
    if (!item) {
      debugLog('Item not found', itemId);
      return;
    }
    
    item.completed = !item.completed;
    
    if (item.completed) {
      // Item was just checked off - save completion info
      item.completedAt = new Date().toISOString();
      item.completedBy = localStorage.getItem('userId') || 'unknown';
      item.completedByName = localStorage.getItem('fullName') || 'Unknown User';
      console.log('🎯 SHOTLIST: Item completed by:', item.completedByName);
      console.log('🎯 SHOTLIST: User ID:', item.completedBy);
      console.log('🎯 SHOTLIST: Completed at:', item.completedAt);
      console.log('🎯 SHOTLIST: Full item data:', item);
      debugLog('Item completed by:', item.completedByName);
    } else {
      // Item was unchecked - clear completion info
      item.completedAt = null;
      item.completedBy = null;
      item.completedByName = null;
      console.log('🎯 SHOTLIST: Item unchecked, completion info cleared');
      debugLog('Item unchecked, completion info cleared');
    }
    
    // Render immediately for responsive UI (optimistic update)
    renderShotlists();
    
    // Then save to server
    await saveShotlists();
    debugLog('Item completion toggled successfully');
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to toggle item:', error);
  }
}

// Edit item
async function editItem(listId, itemId, newTitle) {
  if (!canUserEdit()) {
    debugLog('User cannot edit');
    return;
  }
  
  if (!newTitle || !newTitle.trim()) {
    debugLog('Empty item title provided');
    return;
  }
  
  debugLog('Editing item', { listId, itemId, newTitle });
  
  try {
    // Try to find by ID first, then by index if it's a temp ID
    let list = shotlists.find(l => l._id === listId);
    
    if (!list && listId.startsWith('temp-list-')) {
      const tempIndex = parseInt(listId.replace('temp-list-', ''));
      if (!isNaN(tempIndex) && tempIndex < shotlists.length) {
        list = shotlists[tempIndex];
      }
    }
    
    if (!list) {
      debugLog('List not found', listId);
      return;
    }
    
    // Try to find by ID first, then by index if it's a temp ID
    let item = list.items.find(i => i._id === itemId);
    
    if (!item && itemId.startsWith('temp-item-')) {
      const tempIndex = parseInt(itemId.replace('temp-item-', ''));
      if (!isNaN(tempIndex) && tempIndex < list.items.length) {
        item = list.items[tempIndex];
      }
    }
    
    if (!item) {
      debugLog('Item not found', itemId);
      return;
    }
    
    item.title = newTitle.trim();
    
    // Render immediately for responsive UI (optimistic update)
    renderShotlists();
    
    await saveShotlists();
    debugLog('Item edited successfully');
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to edit item:', error);
  }
}

// Delete item
async function deleteItem(listId, itemId) {
  if (!canUserEdit()) {
    debugLog('User cannot edit');
    return;
  }
  
  debugLog('Deleting item', { listId, itemId });
  
  try {
    // Try to find by ID first, then by index if it's a temp ID
    let list = shotlists.find(l => l._id === listId);
    
    if (!list && listId.startsWith('temp-list-')) {
      const tempIndex = parseInt(listId.replace('temp-list-', ''));
      if (!isNaN(tempIndex) && tempIndex < shotlists.length) {
        list = shotlists[tempIndex];
      }
    }
    
    if (!list) {
      debugLog('List not found', listId);
      return;
    }
    
    // If it's a temp item ID, delete by index instead
    if (itemId.startsWith('temp-item-')) {
      const tempIndex = parseInt(itemId.replace('temp-item-', ''));
      if (!isNaN(tempIndex) && tempIndex < list.items.length) {
        list.items.splice(tempIndex, 1);
      }
    } else {
      list.items = list.items.filter(i => i._id !== itemId);
    }
    
    await saveShotlists();
    debugLog('Item deleted successfully');
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to delete item:', error);
  }
}

// Delete entire list
async function deleteList(listId) {
  if (!canUserEdit()) {
    debugLog('User cannot edit');
    return;
  }
  
  debugLog('Deleting list', listId);
  
  try {
    // If it's a temp list ID, delete by index instead
    if (listId.startsWith('temp-list-')) {
      const tempIndex = parseInt(listId.replace('temp-list-', ''));
      if (!isNaN(tempIndex) && tempIndex < shotlists.length) {
        shotlists.splice(tempIndex, 1);
      }
    } else {
      shotlists = shotlists.filter(l => l._id !== listId);
    }
    
    // If we deleted the currently selected list, select another one
    if (selectedListId === listId) {
      selectedListId = shotlists.length > 0 ? 
        (shotlists[0]._id || `temp-list-0`) : null;
      saveListSelection(); // Save the new selection
    }
    
    syncToModule();
    await saveShotlists();
    debugLog('List deleted successfully');
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to delete list:', error);
  }
}

// Save shotlists to server
async function saveShotlists() {
  debugLog('Saving shotlists to server...');
  debugLog('Shotlists data being sent:', shotlists);
  console.log('🎯 SHOTLIST: Current user role:', currentUserRole);
  console.log('🎯 SHOTLIST: Attempting to save shotlists...');
  
  // Show loading state
  const loadingIndicator = showLoadingState();
  
  try {
    const tableId = getCurrentTableId();
    if (!tableId) {
      debugLog('No table ID available for saving');
      return;
    }

    console.log('🎯 SHOTLIST: Making PUT request to:', `${API_BASE}/api/tables/${tableId}/shotlists`);
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/shotlists`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ shotlists })
    });

    console.log('🎯 SHOTLIST: Server response status:', response.status);
    console.log('🎯 SHOTLIST: Server response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('🎯 SHOTLIST: Server error response:', errorText);
      throw new Error(`Failed to save shotlists: ${response.status} - ${errorText}`);
    }

    const responseData = await response.json();
    console.log('🎯 SHOTLIST: Server response data:', responseData);
    debugLog('Shotlists saved successfully');
    hideLoadingState(loadingIndicator);
    // Don't re-render here - let the socket update handle it to preserve optimistic updates
    
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to save shotlists:', error);
    console.error('🎯 SHOTLIST: Error details:', error.message);
    
    // Show user-friendly error message based on error type
    if (error.message.includes('403')) {
      alert('You don\'t have permission to modify this shotlist. Only table owners can edit.');
    } else if (error.message.includes('401')) {
      alert('Your session has expired. Please log in again.');
      window.location.href = '/login.html';
    } else if (error.message.includes('Network')) {
      alert('Network error. Please check your connection and try again.');
    } else {
      alert('Failed to save changes. Please try again.');
    }
    
    // Reload the shotlists to revert any local changes and sync with server
    console.log('🎯 SHOTLIST: Reloading shotlists to sync with server...');
    try {
      await loadShotlists();
         } catch (reloadError) {
       console.error('🎯 SHOTLIST: Failed to reload shotlists:', reloadError);
     }
     
         hideLoadingState(loadingIndicator);
    throw error;
  }
}

// Render all shotlists
function renderShotlists() {
  debugLog('Rendering shotlists...', shotlists);
  
  const container = document.getElementById('lists-container');
  const emptyState = document.getElementById('empty-state');
  const listControls = document.getElementById('list-controls');
  const listSelectorSection = document.getElementById('list-selector-section');
  
  if (!container) {
    debugLog('Lists container not found');
    return;
  }
  
  // Show/hide controls based on permissions
  if (listControls) {
    listControls.style.display = canUserEdit() ? 'flex' : 'none';
  }
  
  // Update list selector dropdown
  updateListSelector();
  
  // Show/hide list selector based on whether there are lists
  if (listSelectorSection) {
    listSelectorSection.style.display = shotlists.length > 0 ? 'block' : 'none';
  }
  
  // Show/hide empty state
  if (shotlists.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.innerHTML = '';
    selectedListId = null;
    updateProgressSummary(); // Update progress even when empty
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  
  // If no list is selected, select the first one
  if (!selectedListId && shotlists.length > 0) {
    selectedListId = shotlists[0]._id || `temp-list-0`;
    saveListSelection(); // Save the default selection
  }
  
  // Find the selected list
  const selectedList = shotlists.find(list => {
    const listId = list._id || `temp-list-${shotlists.indexOf(list)}`;
    return listId === selectedListId;
  });
  
  if (!selectedList && shotlists.length > 0) {
    // If selected list no longer exists, select the first one
    selectedListId = shotlists[0]._id || `temp-list-0`;
    saveListSelection(); // Save the fallback selection
    const selector = document.getElementById('list-selector');
    if (selector) selector.value = selectedListId;
    renderShotlists();
    return;
  }
  
  // Preserve input values before re-render (but not if they should be cleared)
  const inputValues = {};
  container.querySelectorAll('.shot-input').forEach(input => {
    if (input.value.trim() && !input.dataset.shouldClear) {
      const listId = input.dataset.listId;
      inputValues[listId] = input.value;
    }
  });
  
  // Remove all existing event listeners by cloning container
  const newContainer = container.cloneNode(false);
  container.parentNode.replaceChild(newContainer, container);
  
  // Render only the selected list
  if (selectedList) {
    const selectedIndex = shotlists.indexOf(selectedList);
    newContainer.innerHTML = renderShotlist(selectedList, selectedIndex);
    
    // Restore input values after re-render
    newContainer.querySelectorAll('.shot-input').forEach(input => {
      const listId = input.dataset.listId;
      if (inputValues[listId]) {
        input.value = inputValues[listId];
      }
      // Clean up the shouldClear flag
      delete input.dataset.shouldClear;
    });
    
    // Attach event listeners for the selected list
    attachListEventListeners(selectedList._id);
  } else {
    newContainer.innerHTML = '';
  }
  
  // Update the overall progress summary
  updateProgressSummary();
  
  debugLog('Shotlists rendered successfully');
}

// Update the overall progress summary in the header
function updateProgressSummary() {
  const progressSummary = document.getElementById('progressSummary');
  if (!progressSummary) return;
  
  const progressText = progressSummary.querySelector('.progress-text');
  if (!progressText) return;
  
  // Calculate totals across all shotlists
  let totalItems = 0;
  let completedItems = 0;
  
  shotlists.forEach(list => {
    if (list.items && Array.isArray(list.items)) {
      totalItems += list.items.length;
      completedItems += list.items.filter(item => item.completed).length;
    }
  });
  
  progressText.textContent = `${completedItems} / ${totalItems} completed`;
  debugLog('Progress summary updated:', completedItems, '/', totalItems);
}

// Update the list selector dropdown
function updateListSelector() {
  const selector = document.getElementById('list-selector');
  if (!selector) return;
  
  // Clear existing options except the default
  selector.innerHTML = '<option value="">Choose a list...</option>';
  
  // Add options for each list
  shotlists.forEach((list, index) => {
    const listId = list._id || `temp-list-${index}`;
    const option = document.createElement('option');
    option.value = listId;
    option.textContent = list.name;
    if (listId === selectedListId) {
      option.selected = true;
    }
    selector.appendChild(option);
  });
  
  debugLog('List selector updated with', shotlists.length, 'options');
}

// Render a single shotlist
function renderShotlist(list, listIndex) {
  const completedCount = list.items.filter(item => item.completed).length;
  const totalCount = list.items.length;
  const progressText = `${completedCount}/${totalCount}`;
  
  const canEdit = canUserEdit();
  const listId = list._id || `temp-list-${listIndex}`;
  
  return `
    <div class="shot-list" data-list-id="${listId}" data-list-index="${listIndex}">
      <div class="list-header">
        <h3 class="list-title">${escapeHtml(list.name)}</h3>
        <div class="list-info">
          <span class="list-progress">${progressText}</span>
          ${canEdit ? `
            <div class="list-actions">
              <button class="btn-icon list-action-btn" title="More options" data-list-id="${listId}">
                <span class="material-symbols-outlined">more_horiz</span>
              </button>
            </div>
          ` : ''}
        </div>
      </div>
      
      <div class="list-content">
        ${list.items.map((item, itemIndex) => renderShotItem(item, itemIndex)).join('')}
        
        ${canEdit ? `
          <div class="add-shot-section">
            <div class="add-shot-input">
              <input type="text" class="shot-input" placeholder="Add new shot..." data-list-id="${listId}" data-list-index="${listIndex}">
              <button class="add-shot-btn" data-list-id="${listId}" data-list-index="${listIndex}">
                <span class="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Render a single shot item
function renderShotItem(item, itemIndex) {
  const canEdit = canUserEdit(); // Owners and leads can edit items
  const canToggle = canUserToggleItems(); // All users can toggle checkboxes
  const itemId = item._id || `temp-item-${itemIndex}`;
  
  // Format completion info if item is completed (show only username, no date)
  let completionInfo = '';
  if (item.completed && item.completedByName) {
    console.log('🎯 SHOTLIST: Rendering completion info for:', item.title);
    console.log('🎯 SHOTLIST: Completed by:', item.completedByName);
    completionInfo = `
      <div class="completion-info">
        <span class="completed-by">✓ ${escapeHtml(item.completedByName)}</span>
      </div>
    `;
  } else if (item.completed) {
    console.log('🎯 SHOTLIST: Item is completed but no completedByName:', item);
  }
  
  return `
    <div class="shot-item ${item.completed ? 'completed' : ''}" data-item-id="${itemId}" data-item-index="${itemIndex}">
      ${canToggle ? `<input type="checkbox" class="shot-checkbox" ${item.completed ? 'checked' : ''}>` : ''}
      <div class="shot-content" ${canEdit ? 'style="cursor: pointer;"' : ''}>
        <div class="shot-title ${canEdit ? 'editable-text' : ''}" contenteditable="false" data-original-title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        ${completionInfo}
      </div>
      ${canEdit ? `
        <div class="shot-actions">
          <button class="btn-icon save-item-btn" title="Save" style="display: none;">
            <span class="material-symbols-outlined">check</span>
          </button>
          <button class="btn-icon cancel-item-btn" title="Cancel" style="display: none;">
            <span class="material-symbols-outlined">close</span>
          </button>
          <button class="btn-icon item-action-btn" title="More options" data-item-id="${itemId}">
            <span class="material-symbols-outlined">more_horiz</span>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

// Global event delegation for all list interactions
function setupListEventDelegation() {
  // Remove any existing delegation listeners
  document.removeEventListener('click', handleListClicks);
  document.removeEventListener('keypress', handleListKeypress);
  document.removeEventListener('keydown', handleListKeydown);
  document.removeEventListener('change', handleListChanges);
  document.removeEventListener('focus', handleListFocus, true);
  document.removeEventListener('blur', handleListBlur, true);
  
  // Add fresh delegation listeners
  document.addEventListener('click', handleListClicks);
  document.addEventListener('keypress', handleListKeypress);
  document.addEventListener('keydown', handleListKeydown);
  document.addEventListener('change', handleListChanges);
  document.addEventListener('focus', handleListFocus, true);
  document.addEventListener('blur', handleListBlur, true);
}

function handleListClicks(e) {
  debugLog('Click detected on:', e.target);
  
  // List action button (3-dot menu)
  if (e.target.closest('.list-action-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.target.closest('.list-action-btn');
    const listId = btn.dataset.listId;
    if (listId) {
      showListActionMenu(listId, btn);
    }
    return;
  }
  
  // Item action button (3-dot menu)
  if (e.target.closest('.item-action-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.target.closest('.item-action-btn');
    const itemId = btn.dataset.itemId;
    if (itemId) {
      showItemActionMenu(itemId, btn);
    }
    return;
  }
  
  // Delete list button (legacy - keep for backwards compatibility)
  if (e.target.closest('.delete-list-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const listElement = e.target.closest('.shot-list');
    if (listElement) {
      debugLog('Deleting list with ID:', listElement.dataset.listId);
      deleteList(listElement.dataset.listId);
    }
    return;
  }
  
  // Add shot button - check both the button and the span inside
  const addShotBtn = e.target.closest('.add-shot-btn');
  if (addShotBtn) {
    e.preventDefault();
    e.stopPropagation();
    debugLog('Add shot button clicked');
    
    // Find the actual list container (.shot-list), not just any element with data-list-id
    const listElement = addShotBtn.closest('.shot-list');
    debugLog('Found list element:', listElement);
    
    if (listElement) {
      const shotInput = listElement.querySelector('.shot-input');
      debugLog('Found shot input:', shotInput);
      debugLog('Shot input value:', shotInput?.value);
      
      if (shotInput) {
        const listId = listElement.dataset.listId;
        debugLog('Using list ID:', listId);
        handleAddItem(listId, shotInput);
      } else {
        debugLog('ERROR: Could not find shot input element');
      }
    } else {
      debugLog('ERROR: Could not find list element');
    }
    return;
  }
  
  // Click on shot title to edit (only if not already editing and not clicking on buttons)
  if (e.target.classList.contains('shot-title') || e.target.closest('.shot-content')) {
    // Don't enter edit mode if clicking on action buttons or if already editing
    if (e.target.closest('.shot-actions') || e.target.closest('.shot-checkbox')) {
      return;
    }
    
    const itemElement = e.target.closest('[data-item-id]');
    if (itemElement) {
      const titleElement = itemElement.querySelector('.shot-title');
      
      // Only enter edit mode if not already editing and user can edit
      if (titleElement && titleElement.classList.contains('editable-text') && 
          titleElement.contentEditable !== 'true') {
        debugLog('Clicking on text to enter edit mode for item:', itemElement.dataset.itemId);
        enterItemEditMode(itemElement);
      }
    }
    return;
  }
  
  // Save item button
  if (e.target.closest('.save-item-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const itemElement = e.target.closest('[data-item-id]');
    const listElement = e.target.closest('.shot-list');
    if (itemElement && listElement) {
      debugLog('Saving edited item:', itemElement.dataset.itemId);
      saveItemEdit(listElement.dataset.listId, itemElement);
    }
    return;
  }
  
  // Cancel item button
  if (e.target.closest('.cancel-item-btn')) {
    e.preventDefault();
    e.stopPropagation();
    const itemElement = e.target.closest('[data-item-id]');
    if (itemElement) {
      debugLog('Cancelling edit for item:', itemElement.dataset.itemId);
      cancelItemEdit(itemElement);
    }
    return;
  }
  
  // Delete item button
  if (e.target.closest('.shot-actions .btn-icon.delete')) {
    e.preventDefault();
    e.stopPropagation();
    const itemElement = e.target.closest('[data-item-id]');
    const listElement = e.target.closest('.shot-list');
    if (itemElement && listElement) {
      debugLog('Deleting item:', itemElement.dataset.itemId, 'from list:', listElement.dataset.listId);
      deleteItem(listElement.dataset.listId, itemElement.dataset.itemId);
    }
    return;
  }
}

// Enter edit mode for an item
function enterItemEditMode(itemElement) {
  const titleElement = itemElement.querySelector('.shot-title');
  const saveBtn = itemElement.querySelector('.save-item-btn');
  const cancelBtn = itemElement.querySelector('.cancel-item-btn');
  const deleteBtn = itemElement.querySelector('.delete');
  
  if (titleElement) {
    titleElement.contentEditable = 'true';
    titleElement.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleElement);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  
  if (saveBtn) saveBtn.style.display = 'inline-block';
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  if (deleteBtn) deleteBtn.style.display = 'none';
  
  isUserEditing = true;
  syncToModule();
}

// Save item edit
function saveItemEdit(listId, itemElement) {
  const titleElement = itemElement.querySelector('.shot-title');
  const newTitle = titleElement ? titleElement.textContent.trim() : '';
  
  if (!newTitle) {
    alert('Item title cannot be empty');
    return;
  }
  
  const itemId = itemElement.dataset.itemId;
  exitItemEditMode(itemElement);
  editItem(listId, itemId, newTitle);
}

// Cancel item edit
function cancelItemEdit(itemElement) {
  const titleElement = itemElement.querySelector('.shot-title');
  const originalTitle = titleElement ? titleElement.dataset.originalTitle : '';
  
  if (titleElement) {
    titleElement.textContent = originalTitle;
  }
  
  exitItemEditMode(itemElement);
}

// Exit edit mode for an item
function exitItemEditMode(itemElement) {
  const titleElement = itemElement.querySelector('.shot-title');
  const saveBtn = itemElement.querySelector('.save-item-btn');
  const cancelBtn = itemElement.querySelector('.cancel-item-btn');
  const deleteBtn = itemElement.querySelector('.delete');
  
  if (titleElement) {
    titleElement.contentEditable = 'false';
    titleElement.blur();
  }
  
  if (saveBtn) saveBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'inline-block';
  
  isUserEditing = false;
  syncToModule();
}

function handleListKeypress(e) {
  // Handle Enter on shot input
  if (e.target.classList.contains('shot-input') && e.key === 'Enter') {
    e.preventDefault();
    debugLog('Enter key pressed on shot input');
    const listElement = e.target.closest('.shot-list');
    if (listElement) {
      debugLog('Found list element for Enter key:', listElement.dataset.listId);
      handleAddItem(listElement.dataset.listId, e.target);
    } else {
      debugLog('ERROR: Could not find list element for Enter key');
    }
  }
  
  // Handle Enter to save when editing an item title
  if (e.target.classList.contains('shot-title') && e.key === 'Enter') {
    e.preventDefault();
    debugLog('Enter key pressed on editable item title');
    const itemElement = e.target.closest('[data-item-id]');
    const listElement = e.target.closest('.shot-list');
    if (itemElement && listElement) {
      saveItemEdit(listElement.dataset.listId, itemElement);
    }
  }
}

function handleListKeydown(e) {
  // Handle Escape to cancel when editing an item title
  if (e.target.classList.contains('shot-title') && e.key === 'Escape') {
    e.preventDefault();
    debugLog('Escape key pressed on editable item title');
    const itemElement = e.target.closest('[data-item-id]');
    if (itemElement) {
      cancelItemEdit(itemElement);
    }
  }
}

function handleListChanges(e) {
  // Handle list selector dropdown
  if (e.target.id === 'list-selector') {
    selectedListId = e.target.value;
    debugLog('List selection changed:', selectedListId);
    saveListSelection(); // Save the selection
    renderShotlists();
    return;
  }
  
  // Handle shot checkboxes
  if (e.target.classList.contains('shot-checkbox')) {
    const itemElement = e.target.closest('[data-item-id]');
    const listElement = e.target.closest('.shot-list');
    if (itemElement && listElement) {
      toggleItemCompletion(listElement.dataset.listId, itemElement.dataset.itemId);
    }
  }
}

function handleListFocus(e) {
  if (e.target.classList.contains('shot-input')) {
    isUserEditing = true;
    syncToModule();
  }
}

function handleListBlur(e) {
  if (e.target.classList.contains('shot-input')) {
    setTimeout(() => {
      isUserEditing = false;
      syncToModule();
    }, 100);
  }
}

// Simplified function - no longer needs to attach individual listeners
function attachListEventListeners(listId) {
  // Event delegation handles everything now
  debugLog('Event delegation active for list:', listId);
}

// Generate unique ID compatible with MongoDB ObjectId format
function generateId() {
  // Generate a 24-character hex string (MongoDB ObjectId format)
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const randomHex = 'xxxxxxxxxxxx'.replace(/[x]/g, () => {
    return (Math.random() * 16 | 0).toString(16);
  });
  return (timestamp + randomHex).padStart(24, '0').slice(0, 24);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show loading state
function showLoadingState() {
  const indicator = document.createElement('div');
  indicator.className = 'loading-indicator';
  indicator.innerHTML = `
    <div class="loading-spinner">
      <span class="material-symbols-outlined">sync</span>
      Saving...
    </div>
  `;
  indicator.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 1rem 2rem;
    border-radius: 0.5rem;
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  `;
  indicator.querySelector('.material-symbols-outlined').style.cssText = `
    animation: spin 1s linear infinite;
  `;
  
  // Add spin animation
  if (!document.getElementById('shotlist-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'shotlist-spinner-style';
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(indicator);
  return indicator;
}

// Hide loading state
function hideLoadingState(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
}

// Test functions for debugging
function testShotlistData() {
  debugLog('Creating test shotlist data...');
  
  shotlists = [
    {
      _id: 'test-list-1',
      name: 'Wedding Day Shots',
      items: [
        {
          _id: 'item-1',
          title: 'Bride getting ready',
          completed: true,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          completedBy: 'test-user-id',
          completedByName: 'John Photographer'
        },
        {
          _id: 'item-2',
          title: 'Ceremony entrance',
          completed: false,
          createdAt: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString()
    }
  ];
  
  renderShotlists();
  debugLog('Test data created and rendered');
}

function testShotlistSave() {
  debugLog('Testing shotlist save...');
  saveShotlists().then(() => {
    debugLog('Save test completed');
  }).catch(error => {
    debugLog('Save test failed', error);
  });
}

// Page cleanup function
function cleanupShotlist() {
  debugLog('Cleaning up shotlist page...');
  
  // Remove socket listeners
  if (typeof socket !== 'undefined' && socket) {
    socket.off('shotlistsUpdated', handleShotlistsUpdate);
  }
  
  // Remove event delegation listeners
  document.removeEventListener('click', handleListClicks);
  document.removeEventListener('keypress', handleListKeypress);
  document.removeEventListener('keydown', handleListKeydown);
  document.removeEventListener('change', handleListChanges);
  document.removeEventListener('focus', handleListFocus, true);
  document.removeEventListener('blur', handleListBlur, true);
  
  // Reset state
  shotlists = [];
  currentUserRole = null;
  isUserEditing = false;
  isInitialized = false;
  syncToModule();
  
  debugLog('Shotlist page cleaned up');
}

// ========================================
// DARK THEME SUPPORT
// ========================================

// Check if dark theme is active
function isDarkThemeShotlist() {
  return !!document.querySelector('.shotlist-page.dark-theme');
}

// Initialize dark theme elements
function initDarkThemeShotlist() {
  debugLog('Initializing dark theme shotlist');
  
  // Load sidebar user info
  loadShotlistSidebarUser();
  
  // Setup sidebar navigation
  setupShotlistSidebarNav();
  
  // Setup mobile menu
  setupShotlistMobileMenu();
  
  // Setup action dropdowns
  setupShotlistActionDropdowns();
}

// Load user info in sidebar
async function loadShotlistSidebarUser() {
  const nameEl = document.getElementById('sidebarUserName');
  const avatarImg = document.getElementById('sidebarAvatarImg');
  const avatarIcon = document.getElementById('sidebarAvatarIcon');
  
  try {
    let userName = localStorage.getItem('fullName');
    if (!userName) {
      userName = localStorage.getItem('userName') || 'User';
    }
    
    if (nameEl) nameEl.textContent = userName;
    
    // Try to load user photo
    const userId = localStorage.getItem('userId');
    if (userId && avatarImg && avatarIcon) {
      try {
        const res = await fetch(`${API_BASE}/api/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });
        if (res.ok) {
          const userData = await res.json();
          if (userData.profilePicture) {
            avatarImg.src = userData.profilePicture;
            avatarImg.style.display = 'block';
            avatarIcon.style.display = 'none';
          }
        }
      } catch (err) {
        debugLog('Could not load user photo:', err.message);
      }
    }
  } catch (error) {
    debugLog('Error loading sidebar user:', error);
    if (nameEl) nameEl.textContent = 'User';
  }
}

// Setup sidebar navigation
function setupShotlistSidebarNav() {
  const navItems = document.querySelectorAll('.shotlist-page .sidebar-nav .nav-item');
  const tableId = getCurrentTableId();
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.getAttribute('data-page');
      
      if (page === 'events') {
        window.navigate('events');
      } else if (page && tableId) {
        window.navigate(page, tableId);
      }
    });
  });
}

// ========================================
// ACTION DROPDOWN MENUS
// ========================================

let selectedListId_dropdown = null;
let selectedItemId_dropdown = null;

// Show list action dropdown
function showListActionMenu(listId, button) {
  selectedListId_dropdown = listId;
  
  const dropdown = document.getElementById('shotlistListActionDropdown');
  if (!dropdown) return;
  
  // Hide item dropdown if open
  hideItemActionMenu();
  
  if (dropdown.classList.contains('show')) {
    hideListActionMenu();
    return;
  }
  
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const dropdownWidth = 160;
  
  let left = rect.left;
  if (left + dropdownWidth > viewportWidth - 20) {
    left = rect.right - dropdownWidth;
  }
  
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${left}px`;
  dropdown.classList.add('show');
  
  setTimeout(() => {
    document.addEventListener('click', handleListDropdownOutsideClick);
  }, 10);
}

function hideListActionMenu() {
  const dropdown = document.getElementById('shotlistListActionDropdown');
  if (dropdown) dropdown.classList.remove('show');
  selectedListId_dropdown = null;
  document.removeEventListener('click', handleListDropdownOutsideClick);
}

function handleListDropdownOutsideClick(e) {
  const dropdown = document.getElementById('shotlistListActionDropdown');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.list-action-btn')) {
    hideListActionMenu();
  }
}

// Show item action dropdown
function showItemActionMenu(itemId, button) {
  selectedItemId_dropdown = itemId;
  
  const dropdown = document.getElementById('shotlistItemActionDropdown');
  if (!dropdown) return;
  
  // Hide list dropdown if open
  hideListActionMenu();
  
  if (dropdown.classList.contains('show')) {
    hideItemActionMenu();
    return;
  }
  
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const dropdownWidth = 140;
  
  let left = rect.left;
  if (left + dropdownWidth > viewportWidth - 20) {
    left = rect.right - dropdownWidth;
  }
  
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${left}px`;
  dropdown.classList.add('show');
  
  setTimeout(() => {
    document.addEventListener('click', handleItemDropdownOutsideClick);
  }, 10);
}

function hideItemActionMenu() {
  const dropdown = document.getElementById('shotlistItemActionDropdown');
  if (dropdown) dropdown.classList.remove('show');
  selectedItemId_dropdown = null;
  document.removeEventListener('click', handleItemDropdownOutsideClick);
}

function handleItemDropdownOutsideClick(e) {
  const dropdown = document.getElementById('shotlistItemActionDropdown');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.item-action-btn')) {
    hideItemActionMenu();
  }
}

// Setup action dropdown handlers
function setupShotlistActionDropdowns() {
  // Delete list action
  const deleteListBtn = document.getElementById('deleteListAction');
  if (deleteListBtn) {
    deleteListBtn.onclick = (e) => {
      e.stopPropagation();
      const listId = selectedListId_dropdown;
      hideListActionMenu();
      if (listId) {
        // Find the list element and trigger delete
        const listEl = document.querySelector(`[data-list-id="${listId}"]`);
        if (listEl) {
          const listIndex = parseInt(listEl.dataset.listIndex, 10);
          showDeleteConfirmation('list', listId, listIndex);
        }
      }
    };
  }
  
  // Delete item action
  const deleteItemBtn = document.getElementById('deleteItemAction');
  if (deleteItemBtn) {
    deleteItemBtn.onclick = (e) => {
      e.stopPropagation();
      const itemId = selectedItemId_dropdown;
      hideItemActionMenu();
      if (itemId) {
        // Find the item element and trigger delete
        const itemEl = document.querySelector(`[data-item-id="${itemId}"]`);
        if (itemEl) {
          showDeleteConfirmation('item', itemId);
        }
      }
    };
  }
}

// Show delete confirmation modal
function showDeleteConfirmation(type, id, listIndex) {
  const modal = document.getElementById('shotlistDeleteModal');
  const titleEl = document.getElementById('shotlistDeleteTitle');
  const messageEl = document.getElementById('shotlistDeleteMessage');
  const confirmBtn = document.getElementById('shotlistConfirmDelete');
  const cancelBtn = document.getElementById('shotlistCancelDelete');
  
  if (!modal) return;
  
  if (type === 'list') {
    const list = shotlists[listIndex];
    if (titleEl) titleEl.textContent = 'Delete List';
    if (messageEl) messageEl.textContent = `Are you sure you want to delete "${list?.name || 'this list'}" and all its items?`;
  } else {
    if (titleEl) titleEl.textContent = 'Delete Item';
    if (messageEl) messageEl.textContent = 'Are you sure you want to delete this item?';
  }
  
  modal.classList.add('show');
  
  // Clone buttons to remove old listeners
  const newConfirmBtn = confirmBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  
  newConfirmBtn.onclick = async () => {
    modal.classList.remove('show');
    if (type === 'list') {
      // Pass the listId (id parameter) not the listIndex
      await deleteList(id);
    } else {
      await deleteItemById(id);
    }
  };
  
  newCancelBtn.onclick = () => {
    modal.classList.remove('show');
  };
}

// Delete item by ID
async function deleteItemById(itemId) {
  try {
    for (const list of shotlists) {
      const itemIndex = list.items.findIndex(item => 
        (item._id && item._id === itemId) || 
        `temp-item-${list.items.indexOf(item)}` === itemId
      );
      
      if (itemIndex !== -1) {
        list.items.splice(itemIndex, 1);
        renderShotlists();
        await saveShotlists();
        debugLog('Item deleted successfully');
        return;
      }
    }
  } catch (error) {
    console.error('🎯 SHOTLIST: Failed to delete item:', error);
  }
}

// Setup mobile menu
function setupShotlistMobileMenu() {
  const menuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('shotlistSidebar');
  const overlay = document.getElementById('shotlistSidebarOverlay');
  
  if (menuBtn && sidebar) {
    menuBtn.onclick = () => {
      sidebar.classList.add('show');
      if (overlay) overlay.classList.add('show');
    };
  }
  
  if (overlay && sidebar) {
    overlay.onclick = () => {
      sidebar.classList.remove('show');
      overlay.classList.remove('show');
    };
  }
  
  // Close sidebar when clicking nav items on mobile
  const navItems = sidebar?.querySelectorAll('.nav-item');
  navItems?.forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('show');
        if (overlay) overlay.classList.remove('show');
      }
    });
  });
}

// Set up initPage function for app.js compatibility
window.initPage = async function(id) {
  debugLog('initPage called with id:', id);
  
  // Store the table ID
  if (id) {
    localStorage.setItem('currentTable', id);
    localStorage.setItem('eventId', id); // For compatibility
  }
  
  // Set event title
  try {
    const tableId = getCurrentTableId();
    if (tableId) {
      const response = await fetch(`${API_BASE}/api/tables/${tableId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (response.ok) {
        const tableData = await response.json();
        const eventTitleEl = document.getElementById('eventTitle');
        if (eventTitleEl) {
          eventTitleEl.textContent = tableData.title ? `${tableData.title} - Shotlists` : 'Shotlists';
        }
      }
    }
  } catch (error) {
    console.error('Error loading event title:', error);
  }
  
  // Initialize the shotlist functionality
  await initializeShotlist();
  
  // Initialize dark theme if detected
  if (isDarkThemeShotlist()) {
    debugLog('Dark theme detected, initializing...');
    initDarkThemeShotlist();
  }
};

// Export functions for global access
window.initializeShotlist = initializeShotlist;
window.cleanupShotlist = cleanupShotlist;
window.testShotlistData = testShotlistData;
window.testShotlistSave = testShotlistSave;

// Mark as loaded to prevent conflicts
window.__shotlistJsLoaded = true;

// Version identifier for cache debugging
console.log('🎯 SHOTLIST: Module loaded - Version: EDIT_ITEMS_v2.1_CLICK_TO_EDIT - ' + new Date().toISOString());
debugLog('Shotlist module loaded');

})(); // Close the IIFE 