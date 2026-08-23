(function() {
// Guard to prevent multiple initializations
if (window.__scheduleJsLoaded) {
  console.log('Schedule.js already loaded, skipping initialization');
  return;
}
window.__scheduleJsLoaded = true;

// User identification functions (moved from old collaborative system)
function getCurrentUserId() {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('[USER] No auth token found');
      return null;
    }
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userId = payload.userId || payload.id || payload.sub;
    console.log('[USER] Current user ID:', userId);
    return userId;
  } catch (error) {
    console.error('[USER] Error parsing token:', error);
    return null;
  }
}

function getCurrentUserName() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return 'Anonymous';
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userName = payload.fullName || payload.name || 'Unknown User';
    console.log('[USER] Current user name:', userName);
    return userName;
  } catch (error) {
    console.error('[USER] Error parsing user name:', error);
    return 'Anonymous';
  }
}

// Make functions globally available
window.getCurrentUserId = getCurrentUserId;
window.getCurrentUserName = getCurrentUserName;

// Deprecate old collaborative system to prevent conflicts
if (window.__collaborativeScheduleInitialized) {
  console.warn('[SCHEDULE] ⚠️ OLD COLLABORATIVE SYSTEM DETECTED! Disabling to prevent conflicts with atomic saves.');
  console.warn('[SCHEDULE] ⚠️ The schedule-collaborative.js system is now deprecated in favor of atomic field updates.');
  window.__collaborativeScheduleInitialized = false;
}

let tableData = { programs: [] };
let saveTimeout;
let searchQuery = '';
let filterDate = 'all';
let allNotesVisible = false;
let isOwner = false;
let lastKnownEventId = null; // Add this declaration
let cachedScheduleUsers = []; // Cached user list for photographer auto-suggest

// Store the intended event ID at module level to prevent external interference
let currentEventId = null;

// Track recently modified checkbox states to prevent race conditions
const recentCheckboxChanges = new Map(); // programIndex -> {checked: boolean, timestamp: number}
const CHECKBOX_CHANGE_PROTECTION_WINDOW = 2000; // 2 seconds

// Add logging utility for event ID tracking - SIMPLIFIED VERSION
function logEventIdState(location) {
  const timestamp = new Date().toISOString();
  const stored = localStorage.getItem('eventId');
  const module = currentEventId;
  const hasIssue = module !== stored;
  
  // Only log if there's a mismatch or during critical checkpoints
  if (hasIssue || ['INIT_START', 'LOAD_START', 'INIT_COMPLETE'].includes(location)) {
    const logLevel = hasIssue ? 'warn' : 'log';
    console[logLevel](`[${timestamp}] EVENT_ID_CHECK [${location}]: module=${module}, localStorage=${stored}, match=${!hasIssue}`);
  }
  
  return { timestamp, stored, module, match: module === stored };
}

// Simplified monitoring - only check during critical operations
let eventIdMonitorActive = false;
function startEventIdMonitoring() {
  if (eventIdMonitorActive) return;
  eventIdMonitorActive = true;
  lastKnownEventId = localStorage.getItem('eventId');
  console.log(`[MONITOR] Event ID monitoring active. Current: ${lastKnownEventId}`);
}

function stopEventIdMonitoring() {
  eventIdMonitorActive = false;
  console.log(`[MONITOR] Event ID monitoring stopped`);
}

// Load registered users for photographer auto-suggest
async function loadScheduleUsers() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/users`, {
      headers: { Authorization: token }
    });
    if (res.ok) {
      const users = await res.json();
      // Extract first names, deduplicate, and sort
      cachedScheduleUsers = users
        .map(u => {
          const fullName = u.name || u.fullName || '';
          return fullName.split(' ')[0].trim();
        })
        .filter(Boolean)
        .filter((name, i, arr) => arr.indexOf(name) === i)
        .sort((a, b) => a.localeCompare(b));
      console.log('[SCHEDULE] Loaded', cachedScheduleUsers.length, 'user first names for auto-suggest');
    }
  } catch (err) {
    console.error('[SCHEDULE] Failed to load users for auto-suggest:', err);
  }
}

// Only check for changes when actually needed
function checkEventIdStability() {
  if (!eventIdMonitorActive) return true;
  
  const current = localStorage.getItem('eventId');
  if (current !== lastKnownEventId) {
    console.warn(`[MONITOR] Event ID changed externally! Old: ${lastKnownEventId}, New: ${current}`);
    lastKnownEventId = current;
    return false;
  }
  return true;
}

// Add a global variable to track if scroll position should be restored
let pendingScrollRestore = null;

// Function to get the scrolling container element 
function getScrollContainer() {
  // Look for the page-container element which is the scrollable container in the SPA
  const container = document.getElementById('page-container');
  return container || window; // Fallback to window if container not found
}

// Save filter settings to localStorage (persistent) and scroll to sessionStorage (temporary)
function saveFilterSettings() {
  // Use the module-level currentEventId first, then fall back to localStorage
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId) {
    console.warn('No event ID available for saving filter settings');
    return;
  }
  
  // Save filters to localStorage for persistence across sessions (like crew.js)
  localStorage.setItem(`schedule_filter_date_${tableId}`, filterDate);
  localStorage.setItem(`schedule_search_${tableId}`, searchQuery);
  
  console.log('✅ SCHEDULE: Filter state saved to localStorage', { filterDate, searchQuery, tableId });
}

// Save scroll position separately to sessionStorage (temporary)
function saveScrollPosition() {
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId) return;
  
  // Get current scroll position from the container instead of window
  const scrollContainer = getScrollContainer();
  const currentScrollY = scrollContainer === window ? 
    (window.scrollY || window.pageYOffset || document.documentElement.scrollTop) : 
    scrollContainer.scrollTop;
  
  // Only save meaningful scroll positions
  if (currentScrollY > 10) {
    sessionStorage.setItem(`schedule_scroll_${tableId}`, currentScrollY);
    console.log(`📍 SCHEDULE: Scroll position saved: ${currentScrollY} for container: ${scrollContainer.id || 'window'}`);
  }
}

// Create a debounced scroll handler with proper reference for removal
function createScrollListener() {
  let timeout;
  
  const scrollHandler = function() {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      // Save scroll position separately from filters
      saveScrollPosition();
    }, 200);
  };
  
  // Add event listener to the correct scrolling container
  const scrollContainer = getScrollContainer();
  scrollContainer.addEventListener('scroll', scrollHandler);
  console.log(`Added scroll event listener to ${scrollContainer.id || 'window'}`);
  
  return {
    handler: scrollHandler,
    container: scrollContainer
  };
}

// Restore filter settings from localStorage (persistent)
function restoreFilterSettings() {
  // Use the module-level currentEventId first, then fall back to localStorage
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId) {
    console.warn('No event ID available for restoring filter settings');
    return;
  }
  
  try {
    // Restore filters from localStorage (like crew.js)
    const savedFilterDate = localStorage.getItem(`schedule_filter_date_${tableId}`) || 'all';
    const savedSearch = localStorage.getItem(`schedule_search_${tableId}`) || '';
    
    console.log('🔄 SCHEDULE: Restoring filter state...', { savedFilterDate, savedSearch, tableId });
    
    // Validate and restore filter date
    if (savedFilterDate && savedFilterDate !== 'all') {
      filterDate = savedFilterDate;
      console.log(`📅 SCHEDULE: Restored filter date: ${filterDate}`);
    }
    
    // Validate and restore search query
    if (savedSearch && savedSearch.length <= 100) { // Reasonable limit
      searchQuery = savedSearch;
      const searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = searchQuery;
      console.log(`🔍 SCHEDULE: Restored search query: ${searchQuery}`);
    }
    
    console.log('✅ SCHEDULE: Filter state restoration complete');
  } catch (err) {
    console.error('❌ SCHEDULE: Error restoring filter settings:', err);
    // Continue with defaults, don't break the page
  }
}

// Restore scroll position from sessionStorage (temporary)
function restoreScrollPosition() {
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId) return;
  
  try {
    const savedScrollPosition = sessionStorage.getItem(`schedule_scroll_${tableId}`);
    if (savedScrollPosition) {
      pendingScrollRestore = parseInt(savedScrollPosition, 10);
      console.log(`📍 SCHEDULE: Saved scroll position ${pendingScrollRestore} for restoration after rendering`);
    }
  } catch (err) {
    console.error('❌ SCHEDULE: Error restoring scroll position:', err);
  }
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
  return `${h.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

function syncTimeDisplay(input) {
  if (!input) return;
  const field = input.closest('.time-field');
  if (!field) return;
  const display = field.querySelector('.time-display');
  if (display) {
    display.textContent = formatTo12Hour(input.value) || '--:-- --';
  }
}

window.initPage = async function(id) {
  console.log(`\n=== SCHEDULE INITPAGE START ===`);
  const startTime = Date.now();
  
  // CRITICAL FIX: Only use the explicit id parameter passed from navigation
  // Don't fall back to getTableId() which could return stale data
  const tableId = id;
  if (!tableId) {
    console.error('Event ID missing in schedule initPage - id parameter required.');
    alert('Event ID missing.');
    return;
  }
  
  console.log(`[INIT] Called with explicit tableId: ${tableId}`);
  logEventIdState('INIT_START');
  
  // Store the intended event ID at module level to prevent external interference
  // Make this assignment more defensive
  currentEventId = tableId;
  console.log(`[INIT] Set module currentEventId to: ${currentEventId}`);
  
  // CRITICAL: Trust the navigation system to have already set the correct eventId
  // Don't override localStorage here as it could persist wrong event IDs
  const previousEventId = localStorage.getItem('eventId');
  const isEventChange = previousEventId && previousEventId !== tableId;
  
  console.log(`[INIT] Previous event ID: ${previousEventId}, isEventChange: ${isEventChange}`);
  
  // CRITICAL FIX: Don't override localStorage - trust the navigation system
  // localStorage.setItem('eventId', tableId); // REMOVED - causes wrong event persistence
  console.log(`[INIT] Using localStorage eventId set by navigation system: ${previousEventId}`);

  // Start monitoring for external changes (but don't defensively overwrite)
  startEventIdMonitoring();

  // Add schedule-page class to body
  document.body.classList.add('schedule-page');

  // Load event title and update page title
  try {
    const res = await fetch(`${API_BASE}/api/tables/${tableId}`, {
      headers: { Authorization: localStorage.getItem('token') }
    });
    const table = await res.json();
    
    // Update both the page title and any event title elements
    const eventTitleEl = document.getElementById('eventTitle');
    if (eventTitleEl) {
      eventTitleEl.textContent = table.title || 'Program Schedule';
    }
    
    // Also update the browser document title
    document.title = `LumDash - ${table.title || 'Program Schedule'}`;
    
    console.log(`[INIT] Updated event title to: ${table.title}`);
  } catch (err) {
    console.error('Failed to load event title:', err);
    const eventTitleEl = document.getElementById('eventTitle');
    if (eventTitleEl) {
      eventTitleEl.textContent = 'Program Schedule';
    }
  }


  // Load users for photographer auto-suggest (don't await - non-blocking)
  loadScheduleUsers();

  // Load collaborative system first
  await loadCollaborativeSystem();

  // Setup event listeners for schedule page controls
  console.log(`[INIT] Setting up event listeners...`);
  const newDateInput = document.getElementById('newDate');
  const addDateBtn = document.querySelector('button.add-btn');
  if (addDateBtn) addDateBtn.onclick = () => addDateSection();

  // Add event listener for date filter
  const filterDropdown = document.getElementById('filterDateDropdown');
  if (filterDropdown) {
    filterDropdown.addEventListener('change', function(e) {
      filterDate = e.target.value;
      renderProgramSections(isOwner); // Use the correct access
      saveFilterSettings(); // Save filter selection
    });
  }
  
  // Add event listener for search input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
  }
  
  // Set up the import button and file input
  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('fileImport');
  
  if (importBtn && fileInput) {
    // Remove any existing event listeners to prevent double attachment
    const newImportBtn = importBtn.cloneNode(true);
    importBtn.parentNode.replaceChild(newImportBtn, importBtn);
    
    const newFileInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newFileInput, fileInput);
    
    // Add event listeners to the fresh elements
    newImportBtn.addEventListener('click', () => {
      newFileInput.click();
    });
    
    newFileInput.addEventListener('change', handleFileImport);
  }
  
  // Set up the export button
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    // Remove any existing event listeners to prevent double attachment
    const newExportBtn = exportBtn.cloneNode(true);
    exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
    
    // Add event listener
    newExportBtn.addEventListener('click', exportScheduleToExcel);
  }

  setupAutoAssignControls();
  
  console.log(`[INIT] Event listeners setup complete`);

  // Load programs (this sets isOwner/hasScheduleAccess and calls renderProgramSections)
  console.log(`[INIT] Loading programs for event: ${tableId}...`);
  await loadPrograms(tableId);
  console.log(`[INIT] Programs loaded successfully`);

  // Wire up right-click / long-press "Mark as Important" gestures (binds once)
  setupScheduleImportantGestures();

  // Initialize dark theme if detected
  const isDarkTheme = document.querySelector('.schedule-page.dark-theme');
  if (isDarkTheme) {
    console.log(`[INIT] Dark theme detected, initializing...`);
    initDarkThemeSchedule();
  }

  // Check for interference after loadPrograms
  if (!checkEventIdStability()) {
    console.warn(`[INIT] Event ID was modified during program loading - this indicates interference`);
  }

  // Only restore filter settings after loadPrograms
  if (isEventChange) {
    console.log('[INIT] Event changed, resetting filters and scroll position');
    resetFilterSettings();
  } else {
    console.log('[INIT] Same event, restoring filter and scroll settings');
    restoreFilterSettings();
    restoreScrollPosition();
    
    // If we restored filters, re-render to apply them
    if (filterDate !== 'all' || searchQuery) {
      console.log('[INIT] Re-rendering to apply restored filters:', { filterDate, searchQuery });
      renderProgramSections(isOwner);
    }
  }
  
  logEventIdState('INIT_COMPLETE');
  const endTime = Date.now();
  console.log(`=== SCHEDULE INITPAGE COMPLETE (${endTime - startTime}ms) ===\n`);
  
  // Stop monitoring after completion
  setTimeout(stopEventIdMonitoring, 1000);
};

// Load collaborative schedule system
async function loadCollaborativeSystem() {
  return new Promise((resolve, reject) => {
    if (window.__simpleCollabLoaded) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = `${API_BASE}/js/schedule-simple-collab.js?v=${Date.now()}`;
    script.onload = () => {
      console.log('✅ Simple collaborative system loaded (UI notifications disabled)');
      window.__simpleCollabLoaded = true;
      resolve();
    };
    script.onerror = () => {
      console.error('❌ Failed to load simple collaborative system');
      resolve(); // Don't reject, continue without collaborative features
    };
    document.head.appendChild(script);
  });
}

async function loadPrograms(tableId = null, retryCount = 0) {
  console.log(`\n--- LOAD PROGRAMS START (retry: ${retryCount}) ---`);
  const loadStartTime = Date.now();
  
  // Prioritize the passed tableId parameter - this is the intended event ID
  // Only fall back to other sources if no explicit tableId is provided
  let eventId;
  if (tableId) {
    eventId = tableId;
    console.log(`[LOAD] Using explicit tableId parameter: ${eventId}`);
  } else {
    eventId = currentEventId || localStorage.getItem('eventId');
    console.log(`[LOAD] No explicit tableId, using fallback: ${eventId}`);
  }
  
  console.log(`[LOAD] Parameters: tableId=${tableId}, currentEventId=${currentEventId}, localStorage=${localStorage.getItem('eventId')}`);
  console.log(`[LOAD] Final eventId decision: ${eventId}`);
  logEventIdState('LOAD_START');
  
  if (!eventId) {
    console.error('[LOAD] No event ID available');
    return;
  }

  // Update the module variable to match what we're actually loading
  currentEventId = eventId;
  console.log(`[LOAD] Updated currentEventId to match what we're loading: ${currentEventId}`);

  const maxRetries = 5;
  const retryDelay = 250;

  try {
    console.log(`[LOAD] Getting user ID from token (attempt ${retryCount + 1}/${maxRetries + 1})...`);
    const userId = await getUserIdFromToken();
    console.log(`[LOAD] User ID obtained: ${userId}`);
    logEventIdState('AFTER_GET_USER_ID');
    
    if (!userId) {
      if (retryCount < maxRetries) {
        console.warn(`[LOAD] No userId available, retrying in ${retryDelay}ms... (attempt ${retryCount + 1}/${maxRetries + 1})`);
        setTimeout(() => {
          loadPrograms(eventId, retryCount + 1);
        }, retryDelay);
        return;
      } else {
        console.error('[LOAD] Failed to get user ID after maximum retries');
        return;
      }
    }

    console.log(`[LOAD] Fetching event data for: ${eventId}...`);
    logEventIdState('BEFORE_EVENT_FETCH');
    
    // Use the original API endpoint that was working
    const response = await fetch(`${API_BASE}/api/tables/${eventId}`, {
      headers: { Authorization: localStorage.getItem('token') }
    });
    
    console.log(`[LOAD] Event fetch response status: ${response.status}`);
    logEventIdState('AFTER_EVENT_FETCH');

    if (!response.ok) {
      throw new Error(`Failed to fetch event data: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[LOAD] Event data received for event: ${eventId}`);
    logEventIdState('AFTER_EVENT_PARSE');

    // Use the original data structure with validation
    if (!data.programSchedule) {
      console.warn('⚠️ [LOAD] WARNING: Server returned no programSchedule field');
    }
    
    const loadedPrograms = data.programSchedule || [];
    
    // CRITICAL: Validate loaded data before accepting it
    if (!Array.isArray(loadedPrograms)) {
      console.error('❌ [LOAD] CRITICAL: Server returned invalid programSchedule (not an array)');
      throw new Error('Invalid schedule data from server');
    }
    
    // Check if we're about to lose data
    if (loadedPrograms.length === 0 && tableData.programs && tableData.programs.length > 0) {
      console.error('❌ [LOAD] CRITICAL: Server returned empty schedule but we have local data!');
      console.error('❌ [LOAD] This could indicate data loss on server. Checking backup...');
      
      // Try to restore from backup
      const backupData = sessionStorage.getItem(`schedule_backup_${eventId}`);
      const backupTimestamp = sessionStorage.getItem(`schedule_backup_timestamp_${eventId}`);
      
      if (backupData && backupTimestamp) {
        const backupAge = Date.now() - parseInt(backupTimestamp);
        const backupAgeMinutes = Math.floor(backupAge / 60000);
        console.warn(`⚠️ [LOAD] Found backup from ${backupAgeMinutes} minutes ago`);
        
        if (confirm(`Warning: Server has no schedule data, but a backup from ${backupAgeMinutes} minutes ago was found. Restore from backup?`)) {
          try {
            const restoredPrograms = JSON.parse(backupData);
            if (Array.isArray(restoredPrograms) && restoredPrograms.length > 0) {
              console.log(`✅ [LOAD] Restoring ${restoredPrograms.length} programs from backup`);
              tableData.programs = restoredPrograms;
              // Save the restored data immediately
              await savePrograms();
              alert(`Successfully restored ${restoredPrograms.length} programs from backup!`);
              sessionStorage.setItem(`schedule_loaded_${eventId}`, 'true');
              return;
            }
          } catch (err) {
            console.error('❌ [LOAD] Failed to restore backup:', err);
          }
        }
      }
    }
    
    // Before overwriting local data, preserve any recently changed checkbox states
    const now = Date.now();
    const protectedChanges = [];
    recentCheckboxChanges.forEach((change, indexStr) => {
      const index = parseInt(indexStr);
      if (now - change.timestamp < CHECKBOX_CHANGE_PROTECTION_WINDOW) {
        protectedChanges.push({ index, checked: change.checked });
      }
    });
    
    tableData.programs = loadedPrograms;
    
    // Re-apply protected checkbox changes after loading
    if (protectedChanges.length > 0) {
      console.log(`✅ [LOAD] Protecting ${protectedChanges.length} recent checkbox changes from being overwritten`);
      protectedChanges.forEach(({ index, checked }) => {
        if (tableData.programs[index]) {
          console.log(`[LOAD] Preserving checkbox state for program ${index}: ${checked}`);
          tableData.programs[index].done = checked;
        }
      });
    }
    
    console.log(`✅ [LOAD] Programs loaded for event ${eventId}, count: ${tableData.programs.length}`);
    
    // Mark that we've successfully loaded data
    if (tableData.programs.length > 0) {
      sessionStorage.setItem(`schedule_loaded_${eventId}`, 'true');
    }
    
    console.log(`[LOAD] Checking access permissions for userId: ${userId}...`);
    // Check permissions using the data we just fetched
    const isOwnerRaw = userId && Array.isArray(data.owners) && data.owners.includes(userId);
    const isLead = userId && Array.isArray(data.leads) && data.leads.includes(userId);
    const hasScheduleAccess = isOwnerRaw || isLead;
    
    console.log(`[LOAD] Access check - isOwner: ${isOwnerRaw}, isLead: ${isLead}, hasAccess: ${hasScheduleAccess}`);
    logEventIdState('AFTER_ACCESS_CHECK');
    
    // Set global variables
    isOwner = hasScheduleAccess;
    
    // Add body class for CSS targeting
    if (hasScheduleAccess) {
      document.body.classList.add('has-owner-controls');
      document.body.classList.remove('no-owner-controls');
      console.log('[LOAD] Added has-owner-controls body class');
    } else {
      document.body.classList.add('no-owner-controls');
      document.body.classList.remove('has-owner-controls');
      console.log('[LOAD] Added no-owner-controls body class');
    }
    logEventIdState('AFTER_BODY_CLASS_UPDATE');

    console.log(`[LOAD] Calling renderProgramSections with hasScheduleAccess: ${hasScheduleAccess}...`);
    renderProgramSections(hasScheduleAccess);
    console.log(`[LOAD] renderProgramSections completed`);
    logEventIdState('AFTER_RENDER_PROGRAMS');

    console.log(`[LOAD] Setting up date filter options...`);
    setupDateFilterOptions();
    console.log(`[LOAD] Date filter options setup complete`);
    logEventIdState('AFTER_DATE_FILTER_SETUP');

    // Initialize simple collaborative features if available (UI notifications disabled)
    if (window.SimpleCollab && !window.__simpleCollabInitialized) {
      console.log('🤝 Initializing simple collaborative features (UI notifications disabled)...');
      try {
        const userId = await getUserIdFromToken();
        const userName = getUserName();
        window.SimpleCollab.init(eventId, userId, userName);
        window.__simpleCollabInitialized = true;
        console.log('✅ Simple collaborative features initialized successfully (UI notifications disabled)');
      } catch (error) {
        console.error('❌ Failed to initialize simple collaborative features:', error);
      }
    }

    // Final verification that event ID hasn't changed
    const finalEventId = localStorage.getItem('eventId');
    if (finalEventId !== eventId) {
      console.warn(`[LOAD] Event ID changed during loadPrograms! Expected: ${eventId}, Final: ${finalEventId}`);
      logEventIdState('FINAL_ID_MISMATCH');
    } else {
      console.log(`[LOAD] Event ID verification passed: ${finalEventId}`);
      logEventIdState('FINAL_ID_VERIFIED');
    }
    
  } catch (error) {
    console.error('[LOAD] Error in loadPrograms:', error);
    logEventIdState('LOAD_ERROR');
    
    if (retryCount < maxRetries) {
      console.warn(`[LOAD] Retrying loadPrograms in ${retryDelay}ms... (attempt ${retryCount + 1}/${maxRetries + 1})`);
      setTimeout(() => {
        loadPrograms(eventId, retryCount + 1);
      }, retryDelay);
    } else {
      console.error('[LOAD] Failed to load programs after maximum retries');
      // Show error message to user
      const programList = document.getElementById('programList');
      if (programList) {
        programList.innerHTML = '<p>Error loading schedule. Please try again.</p>';
      }
      isOwner = false; // Reset on error
      document.body.classList.remove('has-owner-controls');
      document.body.classList.add('no-owner-controls');
      renderProgramSections(false); // Render without access on error
    }
  }
  
  const loadEndTime = Date.now();
  console.log(`--- LOAD PROGRAMS COMPLETE (${loadEndTime - loadStartTime}ms) ---\n`);
}

// Enhanced getUserIdFromToken with proper async handling and logging
async function getUserIdFromToken() {
  console.log(`[TOKEN] Getting user ID from token...`);
  
  const token = localStorage.getItem('token');
  if (!token) {
    console.log(`[TOKEN] No token found in localStorage`);
    return null;
  }
  
  try {
    console.log(`[TOKEN] Token found, decoding...`);
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userId = payload.userId || payload.id || payload.sub;
    console.log(`[TOKEN] User ID decoded: ${userId}`);
    return userId;
  } catch (error) {
    console.error('[TOKEN] Error decoding token:', error);
    return null;
  }
}

function getUserName() {
  // Try to get user name from JWT token
  const token = localStorage.getItem('token');
  if (!token) return 'Anonymous User';
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    console.log('[DEBUG] JWT payload for username:', JSON.stringify(payload, null, 2));
    
    // Try different possible name fields in the JWT
    const possibleNames = [
      payload.fullName,     // Most likely field - try this first
      payload.name,
      payload.username, 
      payload.displayName,
      payload.firstName,
      payload.email?.split('@')[0], // Use email prefix as fallback
      payload.userId && `User ${payload.userId}`,
      payload.id && `User ${payload.id}`,
      'User Unknown'
    ];
    
    const userName = possibleNames.find(name => name && name.trim() !== '');
    console.log('[DEBUG] Selected username:', userName);
    return userName;
    
  } catch (error) {
    console.error('[DEBUG] Error parsing JWT for username:', error);
    return 'Anonymous User';
  }
}

function getUserRoleFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.role;
}

async function savePrograms() {
  const tableId = localStorage.getItem('eventId');
  if (!tableId) {
    console.error('No tableId found in localStorage. Cannot save.');
    throw new Error('No event ID available');
  }
  
  // CRITICAL: Validate data before saving to prevent data loss
  if (!tableData || !Array.isArray(tableData.programs)) {
    console.error('❌ [SAVE] CRITICAL: tableData.programs is not an array!');
    throw new Error('Invalid schedule data structure');
  }
  
  // CRITICAL: Never send empty array unless explicitly intended
  if (tableData.programs.length === 0) {
    console.warn('⚠️ [SAVE] WARNING: Attempting to save empty schedule. This will delete all data!');
    // Check if this is a new event or if data was loaded
    const hasLoadedData = sessionStorage.getItem(`schedule_loaded_${tableId}`);
    if (hasLoadedData === 'true') {
      console.error('❌ [SAVE] BLOCKED: Refusing to save empty array when data was previously loaded. This prevents accidental data loss.');
      throw new Error('Cannot save empty schedule - data loss prevention');
    }
  }
  
  // Validate data before saving to prevent corruption
  if (!validateScheduleData()) {
    console.error('❌ [SAVE] Aborting save due to data validation failure');
    throw new Error('Schedule data validation failed');
  }
  
  // Create a backup before saving
  const backup = JSON.stringify(tableData.programs);
  sessionStorage.setItem(`schedule_backup_${tableId}`, backup);
  sessionStorage.setItem(`schedule_backup_timestamp_${tableId}`, Date.now().toString());
  
  try {
    console.log('💾 [SAVE] Saving programs for tableId:', tableId, '- Count:', tableData.programs.length);
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/program-schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: localStorage.getItem('token'),
      },
      body: JSON.stringify({ programSchedule: tableData.programs }),
    });
    
    if (!res.ok) {
      const text = await res.text();
      console.error('❌ [SAVE] Failed to save programs:', res.status, text);
      throw new Error(`Save failed: ${res.status} - ${text}`);
    }
    
    const result = await res.json();
    console.log('✅ [SAVE] Programs saved successfully! Count:', tableData.programs.length);
    return result;
  } catch (err) {
    console.error('❌ [SAVE] Failed to save programs:', err);
    // Keep backup in case of failure
    throw err;
  }
}

function scheduleSave() {
  return new Promise((resolve, reject) => {
    // Clear any existing timeout to prevent double-saves
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Debounce saves to prevent too many rapid updates
    saveTimeout = setTimeout(async () => {
      try {
        await savePrograms();
        resolve();
      } catch (error) {
        reject(error);
      }
    }, 500);
  });
}

function renderProgramSections(hasScheduleAccess) {
  // If hasScheduleAccess is not explicitly provided, default to the global isOwner status.
  if (typeof hasScheduleAccess === 'undefined') {
    console.warn('renderProgramSections called without explicit access status, defaulting to global isOwner:', isOwner);
    hasScheduleAccess = isOwner;
  }

  // Check for dark theme - render card view (table view uses existing renderScheduleTable)
  const schedulePage = document.querySelector('.schedule-page.dark-theme');
  if (schedulePage) {
    renderDarkThemeCardView(hasScheduleAccess);
    return;
  }

  const container = document.getElementById('programSections');
  if (!container) {
    console.error('Missing #programSections div!');
    return;
  }

  // --- Preserve focus and cursor position ---
  let activeElement = document.activeElement;
  let focusInfo = null;
  if (container.contains(activeElement) && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
    focusInfo = {
      tag: activeElement.tagName,
      className: activeElement.className,
      placeholder: activeElement.getAttribute('placeholder'),
      dataset: { ...activeElement.dataset },
      value: activeElement.value,
      selectionStart: activeElement.selectionStart,
      selectionEnd: activeElement.selectionEnd
    };
    // Try to get program index if present
    const entry = activeElement.closest('.program-entry');
    if (entry) {
      focusInfo.programIndex = entry.getAttribute('data-program-index');
    }
  }

  // --- CRITICAL FIX: Preserve checkbox states before clearing DOM ---
  // This prevents checkbox states from being lost when adding rows
  const checkboxStates = new Map();
  container.querySelectorAll('.program-entry').forEach(entry => {
    const programIndex = entry.getAttribute('data-program-index');
    const checkbox = entry.querySelector('.done-checkbox');
    if (checkbox && programIndex !== null) {
      // Store the CURRENT DOM state, which is the source of truth for user interaction
      checkboxStates.set(programIndex, checkbox.checked);
      // Also sync to tableData to ensure data consistency
      if (tableData.programs[programIndex]) {
        tableData.programs[programIndex].done = checkbox.checked;
      }
    }
  });
  console.log(`[RENDER] Preserved ${checkboxStates.size} checkbox states before re-render`);

  container.innerHTML = '';

  const filterDropdown = document.getElementById('filterDateDropdown');
  if (filterDropdown) {
    const allDates = [...new Set(tableData.programs.map(p => p.date))].sort((a, b) => a.localeCompare(b));
    const currentSelection = filterDate || 'all';
    filterDropdown.innerHTML = `<option value="all">All Dates</option>`;
    allDates.forEach(date => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = formatDate(date);
      filterDropdown.appendChild(option);
    });
    filterDropdown.value = currentSelection;
    
    // Update custom dropdown if it exists (dark theme)
    if (typeof updateScheduleDateDropdown === 'function') {
      updateScheduleDateDropdown();
    }
  }

  if (tableData.programs.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No programs yet. Add a new date to get started.';
    empty.style.textAlign = 'center';
    empty.style.padding = '40px';
    empty.style.color = '#777';
    container.appendChild(empty);
    return;
  }

  const dates = [...new Set(tableData.programs.map(p => p.date))].sort((a, b) => a.localeCompare(b));

  dates.forEach(date => {
    const matchingPrograms = tableData.programs
      .map((p, i) => ({ ...p, __index: i }))
      .filter(p => p.date === date && matchesSearch(p))
      .sort((a, b) => {
        // Programs with times should be sorted by time
        // Programs without times should appear at the bottom in order they were added
        const aHasTime = a.startTime && a.startTime.trim() !== '';
        const bHasTime = b.startTime && b.startTime.trim() !== '';
        
        // If both have times, sort by time
        if (aHasTime && bHasTime) {
          const startCmp = a.startTime.localeCompare(b.startTime);
          if (startCmp !== 0) return startCmp;
          
          // Same start time: sort by end time (shorter duration first)
          const aHasEnd = a.endTime && a.endTime.trim() !== '';
          const bHasEnd = b.endTime && b.endTime.trim() !== '';
          if (aHasEnd && bHasEnd) return a.endTime.localeCompare(b.endTime);
          if (aHasEnd && !bHasEnd) return -1; // a has end time, show first
          if (!aHasEnd && bHasEnd) return 1;
          return a.__index - b.__index;
        }
        
        // If only a has time, a comes first
        if (aHasTime && !bHasTime) {
          return -1;
        }
        
        // If only b has time, b comes first
        if (!aHasTime && bHasTime) {
          return 1;
        }
        
        // If neither has time, maintain original order (by index)
        return a.__index - b.__index;
      });

    if (matchingPrograms.length === 0) return;

    const section = document.createElement('div');
    section.className = 'date-section';
    section.setAttribute('data-date', date);

    const headerWrapper = document.createElement('div');
    headerWrapper.className = 'date-header';
    headerWrapper.innerHTML = `
      <div class="date-title">${formatDate(date)}</div>
      ${hasScheduleAccess ? `<button class="delete-date-btn" onclick="deleteDate('${date}')"><span class="material-symbols-outlined">delete</span></button>` : ''}
    `;
    section.appendChild(headerWrapper);

    matchingPrograms.forEach(program => {
      const entry = document.createElement('div');
      entry.className = 'program-entry' + (program.done ? ' done-entry' : '') + (program.important ? ' important-entry' : '');
      entry.setAttribute('data-program-index', program.__index);
      
      // Use _id if available, otherwise use _tempId for new programs
      const programId = program._id || program._tempId;
      if (programId) {
        entry.setAttribute('data-program-id', programId);
      }

      entry.innerHTML = `
        <div class="entry-top-row">
          <div class="entry-times">
            <label class="time-field">
              <input type="time" class="time-input-native" placeholder="Start Time"
                data-field="startTime"
                value="${program.startTime || ''}"
                ${!hasScheduleAccess ? 'readonly' : ''}
                onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
                oninput="syncTimeDisplay(this)"
                onblur="${hasScheduleAccess ? `syncTimeDisplay(this); autoSave(this, '${program.date}', ${program.__index}, 'startTime')` : ''}">
              <span class="time-display">${formatTo12Hour(program.startTime) || '--:-- --'}</span>
              <span class="material-symbols-outlined time-icon">schedule</span>
            </label>
            <label class="time-field">
              <input type="time" class="time-input-native" placeholder="End Time"
                data-field="endTime"
                value="${program.endTime || ''}"
                ${!hasScheduleAccess ? 'readonly' : ''}
                onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
                oninput="syncTimeDisplay(this)"
                onblur="${hasScheduleAccess ? `syncTimeDisplay(this); autoSave(this, '${program.date}', ${program.__index}, 'endTime')` : ''}">
              <span class="time-display">${formatTo12Hour(program.endTime) || '--:-- --'}</span>
              <span class="material-symbols-outlined time-icon">schedule</span>
            </label>
            ${program.folder ? `<div class="folder-field-container">
              <span class="material-symbols-outlined folder-icon">folder</span>
              <input type="text"
                data-field="folder"
                class="folder-input"
                placeholder="Folder"
                maxlength="7"
                ${!hasScheduleAccess ? 'readonly' : ''}
                value="${program.folder || ''}"
                onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
                onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'folder')` : ''}">
            </div>` : ''}
          </div>
          <label class="entry-done">
            <input type="checkbox" class="done-checkbox"
              data-field="done"
              data-original-value="${program.done ? 'true' : 'false'}"
              ${program.done ? 'checked' : ''}
              onchange="toggleDone(this, ${program.__index})">
          </label>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <input class="program-name" type="text"
            data-field="name"
            ${!hasScheduleAccess ? 'readonly' : ''}
            placeholder="Program Name"
            style="flex: 1;"
            value="${program.name || ''}" 
            onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}" 
            onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'name')` : ''}">
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
          <div style="display: flex; align-items: center; flex: 1;">
            <span class="material-symbols-outlined" style="margin-right: 4px; font-size: 18px;">location_on</span>
            <textarea style="flex: 1; resize: none;"
              data-field="location"
              placeholder="Location"
              ${!hasScheduleAccess ? 'readonly' : ''}
              onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
              oninput="${hasScheduleAccess ? 'autoResizeTextarea(this)' : ''}"
              onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'location')` : ''}">${program.location || ''}</textarea>
          </div>
          <div style="display: flex; align-items: center; flex: 1;">
            <span class="material-symbols-outlined" style="margin-right: 4px; font-size: 18px;">photo_camera</span>
            <textarea style="flex: 1; resize: none;"
              data-field="photographer"
              placeholder="Photographer"
              ${!hasScheduleAccess ? 'readonly' : ''}
              onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
              oninput="${hasScheduleAccess ? 'autoResizeTextarea(this)' : ''}"
              onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'photographer')` : ''}">${program.photographer || ''}</textarea>
          </div>
        </div>
        <div class="entry-actions">
        <button class="show-notes-btn" onclick="toggleNotes(this)">Show Notes</button>
          ${hasScheduleAccess ? `<button class="delete-btn" onclick="deleteProgram(this)"><span class="material-symbols-outlined">delete</span></button>` : ''}
        </div>
        <div class="notes-field" style="display: none;">
          <textarea
            class="auto-expand"
            data-field="notes"
            placeholder="Notes"
            oninput="autoResizeTextarea(this)"
            ${!hasScheduleAccess ? 'readonly' : ''}
            onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
            onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'notes')` : ''}">${program.notes || ''}</textarea>
        </div>
      `;
      section.appendChild(entry);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+ Add Row';
    addBtn.onclick = () => addProgram(date);
    if (hasScheduleAccess) section.appendChild(addBtn);

    container.appendChild(section);
  });

  // After rendering is complete, restore scroll position if needed
  setTimeout(() => {
    document.querySelectorAll('textarea').forEach(setupTextareaResize);
    // --- Restore focus and cursor position ---
    if (focusInfo) {
      // Try to find the new element matching the previous one
      let selector = '';
      if (focusInfo.className) selector += '.' + focusInfo.className.split(' ').join('.');
      if (focusInfo.placeholder) selector += `[placeholder="${focusInfo.placeholder}"]`;
      let candidates = Array.from(container.querySelectorAll(focusInfo.tag + selector));
      let target = null;
      if (focusInfo.programIndex) {
        // Try to match by program index
        target = candidates.find(el => {
          const entry = el.closest('.program-entry');
          return entry && entry.getAttribute('data-program-index') === focusInfo.programIndex;
        });
      }
      if (!target && candidates.length === 1) target = candidates[0];
      if (target) {
        target.focus();
        if (typeof focusInfo.selectionStart === 'number' && typeof focusInfo.selectionEnd === 'number') {
          target.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
        }
      }
    }
    // Apply pending scroll restore if exists
    if (pendingScrollRestore !== null) {
      applyScrollRestore();
    }
  }, 150); // Increased delay for more reliable rendering completion
}

// Create a separate function for scroll restoration that can be called multiple times
function applyScrollRestore() {
  if (pendingScrollRestore === null) return;
  
  const scrollContainer = getScrollContainer();
  console.log(`Applying pending scroll restore to position: ${pendingScrollRestore} for container: ${scrollContainer.id || 'window'}`);
  
  if (scrollContainer === window) {
    window.scrollTo({
      top: pendingScrollRestore,
      behavior: 'auto'
    });
  } else {
    scrollContainer.scrollTop = pendingScrollRestore;
  }
  
  // Schedule multiple restore attempts to overcome any competing operations
  // that might be scrolling the container back to top
  const scrollValue = pendingScrollRestore;
  
  // Make multiple attempts to restore the scroll position
  for (let delay of [100, 300, 500, 1000, 2000]) {
    setTimeout(() => {
      const currentScrollY = scrollContainer === window ? 
        (window.scrollY || window.pageYOffset || document.documentElement.scrollTop) : 
        scrollContainer.scrollTop;
      
      // Only re-apply if the position was lost
      if (currentScrollY < scrollValue - 50) {
        console.log(`Scroll position lost (current: ${currentScrollY}, target: ${scrollValue}), reapplying at ${delay}ms`);
        
        if (scrollContainer === window) {
          window.scrollTo({
            top: scrollValue,
            behavior: 'auto'
          });
        } else {
          scrollContainer.scrollTop = scrollValue;
        }
      } else {
        // console.log(`Scroll position maintained at ${currentScrollY} at ${delay}ms check`); // Commented out to reduce log noise
      }
      
      // Clear after final check
      if (delay === 2000) {
        pendingScrollRestore = null;
      }
    }, delay);
  }
}

function toggleDone(checkbox, index) {
  console.log(`[TOGGLE DONE] Called with index: ${index}, checkbox checked: ${checkbox.checked}`);
  
  if (isNaN(index) || !tableData.programs[index]) {
    console.error(`[TOGGLE DONE] Invalid program index: ${index}, programs length: ${tableData.programs?.length}`);
    return;
  }
  
  const program = tableData.programs[index];
  const newValue = checkbox.checked;
  // Get the original value from the stored data attribute (set during rendering)
  const originalValue = checkbox.getAttribute('data-original-value') === 'true';
  
  // Only proceed if there's an actual change from the original value
  if (originalValue === newValue) {
    console.log(`[TOGGLE DONE] No change detected (${originalValue} → ${newValue}), skipping`);
    return;
  }
  
  console.log(`[TOGGLE DONE] Program ${index} done: ${originalValue} → ${newValue}`);
  
  // Update visual state immediately - handle both card view (.program-entry) and table view (tr)
  const entry = checkbox.closest('.program-entry');
  const tableRow = checkbox.closest('tr');
  if (entry) {
    entry.classList.toggle('done-entry', newValue);
  }
  if (tableRow) {
    tableRow.classList.toggle('done-row', newValue);
  }
  
  // Update in-memory data immediately for responsive UI
  program.done = newValue;
  
  // Track this change to protect against race conditions from socket reloads
  recentCheckboxChanges.set(String(index), {
    checked: newValue,
    timestamp: Date.now()
  });
  console.log(`[TOGGLE DONE] Tracked checkbox change for program ${index} (protection for ${CHECKBOX_CHANGE_PROTECTION_WINDOW}ms)`);
  
  // Clean up old tracking entries after protection window expires
  setTimeout(() => {
    recentCheckboxChanges.delete(String(index));
  }, CHECKBOX_CHANGE_PROTECTION_WINDOW);
  
  // Update the data attribute to reflect the new original value
  checkbox.setAttribute('data-original-value', newValue ? 'true' : 'false');
  
  // Use atomic save for checkbox changes
  if (program._id) {
    console.log('[TOGGLE DONE] Program has ID - using atomic save');
    
    // Get old value for operational transform and optimistic updates
    const oldValue = originalValue;
    
    // Apply optimistic update immediately for instant feedback
    optimisticUpdates.applyOptimisticUpdate(checkbox, 'done', program._id, newValue, oldValue);
    
    // Use atomic save function with operational transform
    const fieldId = `${program._id}-done`;
    atomicSaveField(checkbox, 'done', program._id, newValue, oldValue)
      .then(success => {
        if (success) {
          // Confirm the optimistic update
          optimisticUpdates.confirmUpdate(fieldId);
          console.log(`[TOGGLE DONE] ✅ Atomic save successful for done field`);
        } else {
          // Revert the optimistic update
          optimisticUpdates.revertUpdate(fieldId, new Error('Save returned false'));
        }
      })
      .catch(error => {
        console.error('[TOGGLE DONE] Atomic save failed, reverting optimistic update:', error);
        // Revert the optimistic update
        optimisticUpdates.revertUpdate(fieldId, error);
        // Fallback to full save
        const wasChanged = safeUpdateProgram(index, 'done', newValue);
        if (wasChanged) {
          scheduleSave();
        }
      });
  } else {
    console.log('[TOGGLE DONE] No program ID - using full schedule save');
    const wasChanged = safeUpdateProgram(index, 'done', newValue);
    if (wasChanged) {
      scheduleSave();
    }
  }
}

function matchesSearch(program) {
  if (filterDate !== 'all' && program.date !== filterDate) return false;
  if (!searchQuery.trim()) return true;
  const lower = searchQuery.toLowerCase();
  return (
    (program.name || '').toLowerCase().includes(lower) ||
    (program.startTime || '').toLowerCase().includes(lower) ||
    (program.endTime || '').toLowerCase().includes(lower) ||
    (program.location || '').toLowerCase().includes(lower) ||
    (program.photographer || '').toLowerCase().includes(lower) ||
    (program.folder || '').toLowerCase().includes(lower) ||
    (program.notes || '').toLowerCase().includes(lower)
  );
}

// Update folder field data attribute based on input value (for styling)
function toggleFolderVisibility(input) {
  const container = input.closest('.folder-field-container');
  if (!container) return;
  
  const hasValue = input.value.trim().length > 0;
  container.setAttribute('data-has-value', hasValue ? 'true' : 'false');
}

// --- Editing guard for partial updates and optimistic UI ---
window.currentlyEditing = null; // { programId, field, pendingUpdate: null }
window.recentlyEditedFields = new Map(); // Track recently edited fields to prevent socket overwrites

function enableEdit(field) {
  field.classList.add('editing');
  const entry = field.closest('.program-entry');
  if (entry) {
    const programIndex = entry.getAttribute('data-program-index');
    const program = tableData.programs[programIndex];
    if (program && program._id) {
      window.currentlyEditing = {
        programId: program._id,
        field: field.getAttribute('placeholder') || field.className,
        pendingUpdate: null
      };
    }
  }
}

// New atomic field save function - prevents data loss
async function atomicSaveField(field, fieldKey, programId, newValue) {
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId) {
    console.error('[ATOMIC] No event ID available for saving');
    return false;
  }
  
  if (!programId) {
    console.error('[ATOMIC] No program ID available for saving');
    return false;
  }
  
  try {
    console.log(`[ATOMIC] Saving field: ${fieldKey} = "${newValue}" for program ${programId}`);
    
    // Show saving indicator
    field.classList.add('saving');
    field.style.borderLeft = '3px solid #ffc107';
    
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/program-field`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': localStorage.getItem('token')
      },
      body: JSON.stringify({
        programId: programId,
        field: fieldKey,
        value: newValue,
        userId: await getUserIdFromToken(),
        sessionId: window.SimpleCollab?.getCurrentUser?.()?.sessionId
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`✅ [ATOMIC] Field saved successfully: ${fieldKey} = "${newValue}"`);
      
      // Show success indicator
      field.classList.remove('saving');
      field.classList.add('saved');
      field.style.borderLeft = '3px solid #28a745';
      
      // Clear success indicator after 2 seconds
      setTimeout(() => {
        field.classList.remove('saved');
        field.style.borderLeft = '';
      }, 2000);
      
      return true;
    } else {
      const error = await response.json();
      console.error(`❌ [ATOMIC] Failed to save field: ${error.error}`);
      
      // Show error indicator
      field.classList.remove('saving');
      field.classList.add('save-error');
      field.style.borderLeft = '3px solid #dc3545';
      field.title = `Save failed: ${error.error}`;
      
      // Clear error indicator after 5 seconds
      setTimeout(() => {
        field.classList.remove('save-error');
        field.style.borderLeft = '';
        field.title = '';
      }, 5000);
      
      return false;
    }
  } catch (error) {
    console.error(`❌ [ATOMIC] Network error saving field:`, error);
    
    // Show network error indicator
    field.classList.remove('saving');
    field.classList.add('save-error');
    field.style.borderLeft = '3px solid #dc3545';
    field.title = 'Network error - will retry automatically';
    
    // Add retry mechanism for network errors
    retryAtomicSave(field, fieldKey, programId, newValue, 1);
    
    return false;
  }
}

// Retry mechanism for failed atomic saves
async function retryAtomicSave(field, fieldKey, programId, newValue, attempt = 1) {
  const maxRetries = 3;
  const retryDelay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
  
  if (attempt > maxRetries) {
    console.error(`[ATOMIC] Max retries (${maxRetries}) exceeded for field ${fieldKey}`);
    field.title = 'Failed to save - please refresh and try again';
    return false;
  }
  
  console.log(`[ATOMIC] Retrying save attempt ${attempt}/${maxRetries} for field ${fieldKey} in ${retryDelay}ms`);
  
  setTimeout(async () => {
    try {
      const success = await atomicSaveField(field, fieldKey, programId, newValue);
      if (!success) {
        // If it still fails, try again
        retryAtomicSave(field, fieldKey, programId, newValue, attempt + 1);
      } else {
        console.log(`✅ [ATOMIC] Retry successful on attempt ${attempt} for field ${fieldKey}`);
      }
    } catch (error) {
      console.error(`[ATOMIC] Retry attempt ${attempt} failed:`, error);
      retryAtomicSave(field, fieldKey, programId, newValue, attempt + 1);
    }
  }, retryDelay);
}

// Queue for failed saves to retry when connection is restored
const failedSavesQueue = [];

// Add to queue when atomic save fails
function queueFailedSave(field, fieldKey, programId, newValue, reason) {
  const saveData = {
    field,
    fieldKey,
    programId,
    newValue,
    reason,
    timestamp: Date.now(),
    retries: 0
  };
  
  // Avoid duplicate entries
  const existing = failedSavesQueue.findIndex(item => 
    item.programId === programId && item.fieldKey === fieldKey
  );
  
  if (existing !== -1) {
    failedSavesQueue[existing] = saveData; // Update existing
  } else {
    failedSavesQueue.push(saveData);
  }
  
  console.log(`[QUEUE] Added failed save to queue: ${fieldKey} for program ${programId}`);
  
  // Show queue indicator
  showSaveQueueIndicator();
}

// Process queued saves when connection is restored
async function processFailedSavesQueue() {
  if (failedSavesQueue.length === 0) return;
  
  console.log(`[QUEUE] Processing ${failedSavesQueue.length} queued saves`);
  
  const toProcess = [...failedSavesQueue];
  failedSavesQueue.length = 0; // Clear queue
  
  for (const saveData of toProcess) {
    try {
      const success = await atomicSaveField(
        saveData.field, 
        saveData.fieldKey, 
        saveData.programId, 
        saveData.newValue
      );
      
      if (!success) {
        // Re-queue if still failing
        saveData.retries++;
        if (saveData.retries < 3) {
          failedSavesQueue.push(saveData);
        } else {
          console.error(`[QUEUE] Max retries exceeded for queued save: ${saveData.fieldKey}`);
        }
      }
    } catch (error) {
      console.error(`[QUEUE] Error processing queued save:`, error);
      saveData.retries++;
      if (saveData.retries < 3) {
        failedSavesQueue.push(saveData);
      }
    }
  }
  
  // Update queue indicator
  if (failedSavesQueue.length === 0) {
    hideSaveQueueIndicator();
  } else {
    showSaveQueueIndicator();
  }
}

// Visual indicator for save queue
function showSaveQueueIndicator() {
  let indicator = document.getElementById('save-queue-indicator');
  
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'save-queue-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff9800;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 14px;
      z-index: 2000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(indicator);
  }
  
  indicator.textContent = `⏳ ${failedSavesQueue.length} changes pending`;
  indicator.style.display = 'block';
}

function hideSaveQueueIndicator() {
  const indicator = document.getElementById('save-queue-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
}

// Coordination system to prevent atomic saves from conflicting with full saves
const saveCoordination = {
  pendingOperations: new Set(),
  isFullSaveInProgress: false
};

async function coordinatedSave(operationType, saveFunction) {
  console.log(`[COORDINATE] Starting coordinated save: ${operationType}`);
  
  // Wait for any pending atomic saves to complete
  if (saveCoordination.pendingOperations.size > 0) {
    console.log(`[COORDINATE] Waiting for ${saveCoordination.pendingOperations.size} atomic operations to complete`);
    
    // Wait up to 5 seconds for atomic saves to complete
    let waitTime = 0;
    while (saveCoordination.pendingOperations.size > 0 && waitTime < 5000) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitTime += 100;
    }
    
    if (saveCoordination.pendingOperations.size > 0) {
      console.warn(`[COORDINATE] Proceeding with save despite ${saveCoordination.pendingOperations.size} pending operations`);
    }
  }
  
  // Mark full save in progress
  saveCoordination.isFullSaveInProgress = true;
  
  try {
    const result = await saveFunction();
    console.log(`✅ [COORDINATE] Completed coordinated save: ${operationType}`);
    return result;
  } catch (error) {
    console.error(`❌ [COORDINATE] Failed coordinated save: ${operationType}`, error);
    throw error;
  } finally {
    saveCoordination.isFullSaveInProgress = false;
  }
}

// Operational Transform System for concurrent same-field edits
const operationalTransform = {
  // Vector clock for operation ordering
  vectorClock: new Map(), // userId -> sequence number
  pendingOps: new Map(), // fieldId -> operation queue
  userSessions: new Map(), // userId -> session info
  
  // Create a new operation
  createOperation(programId, field, oldValue, newValue, userId, cursorPos = null) {
    const sequence = (this.vectorClock.get(userId) || 0) + 1;
    this.vectorClock.set(userId, sequence);
    
    return {
      id: `${userId}-${sequence}-${Date.now()}`,
      programId,
      field,
      oldValue,
      newValue,
      userId,
      sequence,
      timestamp: Date.now(),
      vectorClock: new Map(this.vectorClock),
      cursorPos,
      type: this.detectOperationType(oldValue, newValue, cursorPos)
    };
  },
  
  // Detect operation type for better transformation
  detectOperationType(oldValue, newValue, cursorPos) {
    if (!oldValue) return 'insert';
    if (!newValue) return 'delete';
    if (oldValue.length < newValue.length) return 'insert';
    if (oldValue.length > newValue.length) return 'delete';
    return 'replace';
  },
  
  // Transform operations for concurrent edits
  transformOperation(op1, op2) {
    // If operations are on different fields, no transformation needed
    if (op1.programId !== op2.programId || op1.field !== op2.field) {
      return { op1, op2 };
    }
    
    console.log(`[OT] Transforming concurrent operations on ${op1.field}:`, {
      op1: { user: op1.userId, value: op1.newValue },
      op2: { user: op2.userId, value: op2.newValue }
    });
    
    // For text fields, use advanced text transformation
    if (this.isTextField(op1.field)) {
      return this.transformTextOperations(op1, op2);
    }
    
    // For simple fields, use timestamp precedence with user priority
    return this.transformSimpleOperations(op1, op2);
  },
  
  // Check if field contains text that can be merged
  isTextField(field) {
    return ['name', 'location', 'photographer', 'notes'].includes(field);
  },
  
  // Transform text operations (advanced)
  transformTextOperations(op1, op2) {
    // If one user just typed and another user made a different change,
    // try to merge them intelligently
    
    const commonBase = this.findCommonBase(op1.oldValue, op2.oldValue);
    
    if (commonBase !== null) {
      // Both operations have the same base - we can merge
      const merged = this.mergeTextChanges(commonBase, op1.newValue, op2.newValue, op1.userId, op2.userId);
      
      return {
        op1: { ...op1, newValue: merged.result, transformed: true, mergeInfo: merged },
        op2: { ...op2, newValue: merged.result, transformed: true, mergeInfo: merged }
      };
    }
    
    // Fall back to timestamp precedence
    return this.transformSimpleOperations(op1, op2);
  },
  
  // Find common base between two text values
  findCommonBase(val1, val2) {
    // Simple implementation - can be enhanced with proper diff algorithms
    if (val1 === val2) return val1;
    
    // Find longest common prefix
    let i = 0;
    while (i < Math.min(val1.length, val2.length) && val1[i] === val2[i]) {
      i++;
    }
    
    if (i > 0) {
      return val1.substring(0, i);
    }
    
    return null;
  },
  
  // Merge text changes intelligently
  mergeTextChanges(base, change1, change2, user1, user2) {
    // For now, concatenate with user attribution
    // This can be enhanced with more sophisticated merging
    
    const addition1 = change1.replace(base, '').trim();
    const addition2 = change2.replace(base, '').trim();
    
    let result;
    if (addition1 && addition2) {
      // Both users added content - merge with attribution
      result = `${base} ${addition1} (${this.getUserName(user1)}) + ${addition2} (${this.getUserName(user2)})`.trim();
    } else if (addition1) {
      result = change1;
    } else if (addition2) {
      result = change2;
    } else {
      result = base;
    }
    
    return {
      result,
      merged: true,
      contributors: [user1, user2],
      base,
      changes: { [user1]: addition1, [user2]: addition2 }
    };
  },
  
  // Transform simple operations (non-text)
  transformSimpleOperations(op1, op2) {
    // Use vector clock for ordering
    const op1Time = op1.vectorClock.get(op1.userId) || 0;
    const op2Time = op2.vectorClock.get(op2.userId) || 0;
    
    if (op1Time > op2Time) {
      // op1 wins
      return {
        op1: op1,
        op2: { ...op2, superseded: true, supersededBy: op1.id }
      };
    } else if (op2Time > op1Time) {
      // op2 wins  
      return {
        op1: { ...op1, superseded: true, supersededBy: op2.id },
        op2: op2
      };
    } else {
      // Same timestamp - use user ID for consistent ordering
      const winner = op1.userId < op2.userId ? op1 : op2;
      const loser = winner === op1 ? op2 : op1;
      
      return {
        op1: winner === op1 ? op1 : { ...op1, superseded: true, supersededBy: op2.id },
        op2: winner === op2 ? op2 : { ...op2, superseded: true, supersededBy: op1.id }
      };
    }
  },
  
  // Get user display name
  getUserName(userId) {
    const session = this.userSessions.get(userId);
    return session?.userName || `User ${userId.substr(-4)}`;
  }
};

// Enhanced atomic save function with operational transform
const originalAtomicSaveField = atomicSaveField;
atomicSaveField = async function(field, fieldKey, programId, newValue, oldValue = '') {
  // Check if a full save is in progress
  if (saveCoordination.isFullSaveInProgress) {
    console.log(`[COORDINATE] Full save in progress, queuing atomic save: ${fieldKey}`);
    queueFailedSave(field, fieldKey, programId, newValue, 'full_save_in_progress');
    return false;
  }
  
  // Create operation for operational transform
  const userId = window.getCurrentUserId?.() || 'anonymous';
  const operation = operationalTransform.createOperation(
    programId, 
    fieldKey, 
    oldValue, 
    newValue, 
    userId,
    field.selectionStart
  );
  
  // Check for concurrent operations on the same field
  const fieldId = `${programId}-${fieldKey}`;
  const pendingOps = operationalTransform.pendingOps.get(fieldId) || [];
  
  if (pendingOps.length > 0) {
    console.log(`[OT] Concurrent edit detected on ${fieldKey}, applying operational transform`);
    
    // Transform with all pending operations
    let transformedOp = operation;
    for (const pendingOp of pendingOps) {
      const result = operationalTransform.transformOperation(transformedOp, pendingOp);
      transformedOp = result.op1;
    }
    
    // Use transformed value
    newValue = transformedOp.newValue;
    
    // Show merge notification if value was transformed
    if (transformedOp.transformed) {
      showMergeNotification(field, transformedOp.mergeInfo);
    }
  }
  
  // Add to pending operations
  operationalTransform.pendingOps.set(fieldId, [...pendingOps, operation]);
  
  // Track this atomic operation for coordination
  const operationId = `${programId}-${fieldKey}-${Date.now()}`;
  saveCoordination.pendingOperations.add(operationId);
  
  try {
    const result = await originalAtomicSaveField(field, fieldKey, programId, newValue);
    
    // Remove from pending operations on success
    const remaining = operationalTransform.pendingOps.get(fieldId)?.filter(op => op.id !== operation.id) || [];
    if (remaining.length === 0) {
      operationalTransform.pendingOps.delete(fieldId);
    } else {
      operationalTransform.pendingOps.set(fieldId, remaining);
    }
    
    return result;
  } catch (error) {
    // Remove from pending operations on error
    const remaining = operationalTransform.pendingOps.get(fieldId)?.filter(op => op.id !== operation.id) || [];
    if (remaining.length === 0) {
      operationalTransform.pendingOps.delete(fieldId);
    } else {
      operationalTransform.pendingOps.set(fieldId, remaining);
    }
    throw error;
  } finally {
    saveCoordination.pendingOperations.delete(operationId);
  }
};

// Merge notification system
function showMergeNotification(field, mergeInfo) {
  console.log('[MERGE] Showing merge notification:', mergeInfo);
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'merge-notification';
  notification.innerHTML = `
    <div class="merge-content">
      <i class="merge-icon">🔀</i>
      <span class="merge-text">Changes merged with ${mergeInfo.contributors.map(id => operationalTransform.getUserName(id)).join(', ')}</span>
      <button class="merge-close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;
  
  // Position relative to field with mobile-responsive approach
  const isMobile = window.innerWidth <= 768;
  
  if (isMobile) {
    // On mobile, use fixed positioning at top of screen
    notification.style.position = 'fixed';
    notification.style.top = '10px';
    notification.style.left = '20px';
    notification.style.right = '20px';
    notification.style.width = 'auto';
    notification.style.zIndex = '10000';
  } else {
    // On desktop, position relative to field
    const rect = field.getBoundingClientRect();
    notification.style.position = 'absolute';
    notification.style.top = (rect.bottom + window.scrollY + 5) + 'px';
    notification.style.left = rect.left + 'px';
    notification.style.zIndex = '10000';
  }
  
  document.body.appendChild(notification);
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 4000);
  
  // Add animation
  requestAnimationFrame(() => {
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
  });
}

// Optimistic update system
const optimisticUpdates = {
  activeUpdates: new Map(), // fieldId -> update info
  
  // Apply optimistic update immediately
  applyOptimisticUpdate(field, fieldKey, programId, newValue, oldValue) {
    const fieldId = `${programId}-${fieldKey}`;
    
    // Store the optimistic update
    this.activeUpdates.set(fieldId, {
      field,
      fieldKey,
      programId,
      newValue,
      oldValue,
      timestamp: Date.now(),
      applied: true
    });
    
    // Apply visual feedback immediately
    field.classList.add('optimistic-update');
    field.style.background = '#e3f2fd'; // Light blue background
    field.style.borderLeft = '3px solid #2196f3'; // Blue border
    
    // Update the field value immediately
    if (field.value !== newValue) {
      field.value = newValue;
    }
    
    console.log(`[OPTIMISTIC] Applied immediate update to ${fieldKey}: "${oldValue}" → "${newValue}"`);
  },
  
  // Confirm optimistic update was successful
  confirmUpdate(fieldId) {
    const update = this.activeUpdates.get(fieldId);
    if (update) {
      update.field.classList.remove('optimistic-update');
      update.field.classList.add('confirmed-update');
      update.field.style.background = '#e8f5e9'; // Light green
      update.field.style.borderLeft = '3px solid #4caf50'; // Green border
      
      // Clear the confirmed state after a moment
      setTimeout(() => {
        if (update.field.classList.contains('confirmed-update')) {
          update.field.classList.remove('confirmed-update');
          update.field.style.background = '';
          update.field.style.borderLeft = '';
        }
      }, 1500);
      
      this.activeUpdates.delete(fieldId);
      console.log(`[OPTIMISTIC] Confirmed update for ${fieldId}`);
    }
  },
  
  // Revert optimistic update on failure
  revertUpdate(fieldId, error) {
    const update = this.activeUpdates.get(fieldId);
    if (update) {
      // Revert to old value
      update.field.value = update.oldValue;
      
      // Show error state
      update.field.classList.remove('optimistic-update');
      update.field.classList.add('failed-update');
      update.field.style.background = '#ffebee'; // Light red
      update.field.style.borderLeft = '3px solid #f44336'; // Red border
      update.field.title = `Update failed: ${error.message}`;
      
      // Clear error state after a moment
      setTimeout(() => {
        if (update.field.classList.contains('failed-update')) {
          update.field.classList.remove('failed-update');
          update.field.style.background = '';
          update.field.style.borderLeft = '';
          update.field.title = '';
        }
      }, 3000);
      
      this.activeUpdates.delete(fieldId);
      console.log(`[OPTIMISTIC] Reverted update for ${fieldId}:`, error);
    }
  }
};

// User presence system for real-time collaboration
const userPresence = {
  activeUsers: new Map(), // userId -> presence info
  currentUser: null,
  colors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7', '#a29bfe'],
  colorIndex: 0,
  
  // Initialize presence system
  init() {
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    
    // Validate user identification
    if (!userId || userId === 'anonymous') {
      console.warn('[PRESENCE] ⚠️ User ID not found or anonymous - presence features may not work properly');
      console.warn('[PRESENCE] Check if user is logged in and token is valid');
    }
    
    this.currentUser = {
      id: userId || 'anonymous',
      name: userName || 'Anonymous User', 
      color: this.getNextColor(),
      currentField: null,
      lastSeen: Date.now()
    };
    
    // Store current user session info for operational transform
    operationalTransform.userSessions.set(this.currentUser.id, {
      userName: this.currentUser.name,
      userColor: this.currentUser.color
    });
    
    console.log('[PRESENCE] Initialized user presence:', this.currentUser);
    
    // Set up field tracking
    this.setupFieldTracking();
    
    // Start broadcasting presence
    this.startPresenceBroadcast();
  },
  
  // Get next available color
  getNextColor() {
    const color = this.colors[this.colorIndex % this.colors.length];
    this.colorIndex++;
    return color;
  },
  
  // Track field focus/blur events
  setupFieldTracking() {
    const container = document.getElementById('programSections');
    if (!container) {
      console.warn('[PRESENCE] Program container not found, retrying...');
      setTimeout(() => this.setupFieldTracking(), 1000);
      return;
    }
    
    // Track focus events
    container.addEventListener('focusin', (e) => {
      if (this.isScheduleField(e.target)) {
        this.onFieldFocus(e.target);
      }
    });
    
    // Track blur events  
    container.addEventListener('focusout', (e) => {
      if (this.isScheduleField(e.target)) {
        this.onFieldBlur(e.target);
      }
    });
    
    console.log('[PRESENCE] Field tracking set up');
  },
  
  // Check if element is a schedule field
  isScheduleField(element) {
    return element && (
      element.matches('input[type="text"], input[type="time"], textarea') ||
      element.matches('input[type="checkbox"]')
    ) && element.closest('.program-entry');
  },
  
  // Handle field focus
  onFieldFocus(field) {
    const entry = field.closest('.program-entry');
    const programId = entry?.getAttribute('data-program-id');
    const fieldKey = this.getFieldKey(field);
    
    if (!programId || !fieldKey) return;
    
    const fieldId = `${programId}-${fieldKey}`;
    this.currentUser.currentField = fieldId;
    
    // For checkboxes, set interaction state instead of typing
    if (field.type === 'checkbox') {
      this.currentUser.isInteracting = true;
      console.log(`[PRESENCE] User interacting with checkbox: ${fieldId}`);
    } else {
      this.currentUser.isTyping = true;
      console.log(`[PRESENCE] User focused on field: ${fieldId}`);
    }
    
    // DON'T show indicator for our own user - only broadcast to others
    console.log(`[PRESENCE] Not showing indicator for current user (${this.currentUser.id})`);
    
    // Broadcast typing/interaction started to other users
    this.broadcastTypingState('start', fieldId);
    
    // Set up typing detection (for text fields) or interaction detection (for checkboxes)
    this.setupFieldDetection(field, fieldId);
  },
  
  // Handle field blur
  onFieldBlur(field) {
    const fieldId = this.currentUser.currentField;
    this.currentUser.currentField = null;
    this.currentUser.isTyping = false;
    this.currentUser.isInteracting = false;
    
    console.log(`[PRESENCE] User blurred field: ${fieldId}`);
    
    // DON'T remove indicator for our own user (we don't show it)
    // Only broadcast to other users that we stopped typing/interacting
    if (fieldId) {
      this.broadcastTypingState('stop', fieldId);
    }
    
    // Clear typing/interaction detection
    this.clearFieldDetection(field);
  },
  
  // Get field key from element
  getFieldKey(field) {
    const dataField = field.getAttribute('data-field');
    if (dataField) return dataField;
    
    const placeholder = field.getAttribute('placeholder');
    if (placeholder) return placeholder.toLowerCase();
    
    if (field.className.includes('program-name')) return 'name';
    if (field.type === 'checkbox') return 'done';
    if (field.className.includes('start-time')) return 'startTime';
    if (field.className.includes('end-time')) return 'endTime';
    if (field.className.includes('location')) return 'location';
    if (field.className.includes('photographer')) return 'photographer';
    if (field.className.includes('notes')) return 'notes';
    
    return null;
  },
  
  // Show user indicator on field (Enhanced Google Sheets-style)
  showUserIndicator(field, user) {
    // Remove any existing indicator for this user
    this.hideUserIndicator(field, user.id);
    
    // Apply field styling to show it's being edited
    field.classList.add('field-being-edited');
    field.style.borderColor = user.color;
    field.style.boxShadow = `0 0 0 2px ${user.color}40`; // 40 for transparency
    
    // Create rich typing indicator with avatar and name
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator enhanced-typing-indicator';
    indicator.dataset.userId = user.id;
    
    // Mobile-responsive design
    const isMobile = window.innerWidth <= 768;
    const avatarSize = isMobile ? '24px' : '20px';
    const fontSize = isMobile ? '12px' : '11px';
    const padding = isMobile ? '6px 10px' : '4px 8px';
    
    indicator.innerHTML = `
      <div class="editor-avatar" style="
        background-color: ${user.color};
        width: ${avatarSize};
        height: ${avatarSize};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: ${fontSize};
        margin-right: 6px;
        flex-shrink: 0;
      ">
        ${user.name.charAt(0).toUpperCase()}
      </div>
      <span class="editor-name" style="
        font-size: ${fontSize};
        font-weight: 500;
        color: #333;
        white-space: nowrap;
        ${isMobile ? 'max-width: 120px; overflow: hidden; text-overflow: ellipsis;' : ''}
      ">${this.getPresenceText(field, user)}</span>
    `;
    
    // Style the indicator container
    indicator.style.cssText = `
      position: absolute;
      top: ${isMobile ? '-40px' : '-35px'};
      right: 0px;
      background: white;
      border: 2px solid ${user.color};
      border-radius: 16px;
      padding: ${padding};
      font-size: ${fontSize};
      font-weight: 500;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      max-width: ${isMobile ? '200px' : '250px'};
      pointer-events: none;
      animation: typingIndicatorFadeIn 0.3s ease-out;
    `;
    
    // Position relative to field with mobile considerations
    const parent = field.closest('.program-entry') || field.parentElement;
    if (parent) {
      // Ensure parent has relative positioning
      const currentPosition = window.getComputedStyle(parent).position;
      if (currentPosition === 'static') {
        parent.style.position = 'relative';
      }
      
      // Add mobile class for additional styling if needed
      if (isMobile) {
        indicator.classList.add('mobile-typing-indicator');
      }
      
      parent.appendChild(indicator);
      
      console.log(`👤 [TYPING] Showing enhanced indicator for ${user.name} on field`);
    }
  },
  
  // Get appropriate presence text based on field type and user state
  getPresenceText(field, user) {
    if (field.type === 'checkbox') {
      return user.isInteracting ? 
        `${user.name} is updating...` : 
        `${user.name} is editing`;
    } else {
      return user.isTyping ? 
        `${user.name} is typing...` : 
        `${user.name} is editing`;
    }
  },
  
  // Hide user indicator
  hideUserIndicator(field, userId) {
    // Clear field styling
    field.classList.remove('field-being-edited');
    field.style.borderColor = '';
    field.style.boxShadow = '';
    
    const parent = field.closest('.program-entry') || field.parentElement;
    if (parent) {
      // Remove both old and new style indicators
      const oldIndicator = parent.querySelector(`.user-presence-indicator[data-user-id="${userId}"]`);
      const newIndicator = parent.querySelector(`.typing-indicator[data-user-id="${userId}"]`);
      const enhancedIndicator = parent.querySelector(`.enhanced-typing-indicator[data-user-id="${userId}"]`);
      
      if (oldIndicator) oldIndicator.remove();
      if (newIndicator) newIndicator.remove();
      if (enhancedIndicator) enhancedIndicator.remove();
      
      console.log(`🚫 [TYPING] Removed indicator for user ${userId}`);
    }
  },
  
  // Start broadcasting presence to other users
  startPresenceBroadcast() {
    // Broadcast immediately
    this.broadcastPresence();
    
    // Set up periodic broadcasts
    setInterval(() => {
      this.broadcastPresence();
    }, 3000); // Every 3 seconds
  },
  
  // Broadcast current user presence
  broadcastPresence() {
    if (!window.socket || !window.socket.connected) return;
    
    const eventId = currentEventId || localStorage.getItem('eventId');
    if (!eventId) return;
    
    window.socket.emit('updatePresence', {
      eventId,
      userId: this.currentUser.id,
      userName: this.currentUser.name,
      userColor: this.currentUser.color,
      currentField: this.currentUser.currentField,
      isTyping: this.currentUser.isTyping || false,
      isInteracting: this.currentUser.isInteracting || false,
      timestamp: Date.now()
    });
  },
  
  // Broadcast typing state changes
  broadcastTypingState(action, fieldId) {
    if (!window.socket || !window.socket.connected) return;
    
    const eventId = currentEventId || localStorage.getItem('eventId');
    if (!eventId) return;
    
    const [programId, fieldKey] = fieldId.split('-');
    
    console.log(`[TYPING] Broadcasting ${action} for field ${fieldId}`);
    
    window.socket.emit(`fieldEdit${action === 'start' ? 'Started' : 'Stopped'}`, {
      eventId,
      programId,
      fieldName: fieldKey,
      userId: this.currentUser.id,
      userName: this.currentUser.name,
      userColor: this.currentUser.color,
      timestamp: Date.now()
    });
  },
  
  // Set up field detection (typing for text fields, interaction for checkboxes)
  setupFieldDetection(field, fieldId) {
    // Clear any existing detection
    this.clearFieldDetection(field);
    
    if (field.type === 'checkbox') {
      // For checkboxes, detect change events
      field._interactionHandler = () => {
        if (this.currentUser.currentField === fieldId) {
          this.currentUser.isInteracting = true;
          this.currentUser.lastInteraction = Date.now();
          
          console.log(`[PRESENCE] Checkbox interaction detected for ${fieldId}`);
        }
      };
      
      // Add change listener for checkboxes
      field.addEventListener('change', field._interactionHandler);
      
      // Shorter timeout for checkbox interactions (they're quick)
      field._interactionTimeout = setTimeout(() => {
        this.currentUser.isInteracting = false;
      }, 1000);
      
    } else {
      // For text fields, detect typing
      field._typingHandler = () => {
        if (this.currentUser.currentField === fieldId) {
          this.currentUser.isTyping = true;
          this.currentUser.lastTyping = Date.now();
          
          console.log(`[PRESENCE] Typing detected for ${fieldId}`);
        }
      };
      
      // Add input listeners for text fields
      field.addEventListener('input', field._typingHandler);
      field.addEventListener('keydown', field._typingHandler);
      
      // Set up typing timeout to detect when user stops typing
      field._typingTimeout = setInterval(() => {
        if (this.currentUser.lastTyping && Date.now() - this.currentUser.lastTyping > 3000) {
          // User stopped typing
          this.currentUser.isTyping = false;
        }
      }, 1000);
    }
  },
  
  // Clear field detection
  clearFieldDetection(field) {
    // Clear typing detection
    if (field._typingHandler) {
      field.removeEventListener('input', field._typingHandler);
      field.removeEventListener('keydown', field._typingHandler);
      delete field._typingHandler;
    }
    
    if (field._typingTimeout) {
      clearInterval(field._typingTimeout);
      delete field._typingTimeout;
    }
    
    // Clear interaction detection
    if (field._interactionHandler) {
      field.removeEventListener('change', field._interactionHandler);
      delete field._interactionHandler;
    }
    
    if (field._interactionTimeout) {
      clearTimeout(field._interactionTimeout);
      delete field._interactionTimeout;
    }
  },
  
  // Handle presence updates from other users
  handlePresenceUpdate(data) {
    const { userId, userName, userColor, currentField, isTyping, isInteracting, timestamp } = data;
    
    // Don't process our own presence updates
    if (userId === this.currentUser.id) {
      console.log(`[PRESENCE] Ignoring own presence update for user ${userId}`);
      return;
    }
    
    console.log(`[PRESENCE] Received presence update from other user:`, data);
    
    // Update user info
    this.activeUsers.set(userId, {
      id: userId,
      name: userName,
      color: userColor,
      currentField,
      isTyping: isTyping || false,
      isInteracting: isInteracting || false,
      lastSeen: timestamp
    });
    
    // Update operational transform user sessions
    operationalTransform.userSessions.set(userId, {
      userName,
      userColor
    });
    
    // Show/hide enhanced typing indicators (only for other users)
    this.updatePresenceIndicators(userId, currentField, { 
      id: userId, 
      name: userName, 
      color: userColor,
      isTyping: isTyping || false,
      isInteracting: isInteracting || false
    });
  },
  
  // Update presence indicators for a user
  updatePresenceIndicators(userId, currentField, user) {
    // Remove old indicators for this user (both legacy and enhanced)
    document.querySelectorAll(`.user-presence-indicator[data-user-id="${userId}"]`).forEach(el => el.remove());
    document.querySelectorAll(`.enhanced-typing-indicator[data-user-id="${userId}"]`).forEach(el => el.remove());
    
    // Add new enhanced indicator if user is editing a field
    if (currentField) {
      const [programId, fieldKey] = currentField.split('-');
      const entry = document.querySelector(`.program-entry[data-program-id="${programId}"]`);
      
      if (entry) {
        const field = entry.querySelector(`[data-field="${fieldKey}"], input[placeholder*="${fieldKey}"], textarea`);
        if (field) {
          // Show enhanced typing indicator
          this.showUserIndicator(field, user);
          
          // Update indicator text based on field type and user state
          setTimeout(() => {
            const indicator = field.parentElement?.querySelector('.enhanced-typing-indicator');
            if (indicator) {
              const nameSpan = indicator.querySelector('.editor-name');
              if (nameSpan) {
                nameSpan.textContent = this.getPresenceText(field, user);
              }
            }
          }, 10);
        }
      }
    }
  },
  
  // Clean up old presence data
  cleanup() {
    const now = Date.now();
    const timeout = 30000; // 30 seconds
    
    for (const [userId, user] of this.activeUsers.entries()) {
      if (now - user.lastSeen > timeout) {
        console.log(`[PRESENCE] Cleaning up inactive user: ${userId}`);
        
        // Remove all types of indicators
        document.querySelectorAll(`.user-presence-indicator[data-user-id="${userId}"]`).forEach(el => el.remove());
        document.querySelectorAll(`.enhanced-typing-indicator[data-user-id="${userId}"]`).forEach(el => el.remove());
        document.querySelectorAll(`.typing-indicator[data-user-id="${userId}"]`).forEach(el => el.remove());
        
        // Clear field styling for this user
        document.querySelectorAll('.field-being-edited').forEach(field => {
          // Check if this field's indicator belongs to the cleaned up user
          const parent = field.closest('.program-entry') || field.parentElement;
          const hasIndicator = parent?.querySelector(`[data-user-id="${userId}"]`);
          if (!hasIndicator) {
            field.classList.remove('field-being-edited');
            field.style.borderColor = '';
            field.style.boxShadow = '';
          }
        });
        
        // Remove from active users
        this.activeUsers.delete(userId);
        
        // Remove from operational transform sessions
        operationalTransform.userSessions.delete(userId);
      }
    }
  }
};

// Advanced conflict resolution UI for complex scenarios
const conflictResolution = {
  activeConflicts: new Map(),
  
  // Show conflict resolution dialog
  showConflictDialog(conflict) {
    console.log('[CONFLICT] Showing resolution dialog:', conflict);
    
    const modal = document.createElement('div');
    modal.className = 'conflict-resolution-modal';
    modal.innerHTML = `
      <div class="conflict-resolution-content">
        <h3>🔀 Conflict Resolution Required</h3>
        <p>Multiple users edited the same field simultaneously. Please choose how to resolve this conflict:</p>
        
        <div class="conflict-info">
          <strong>Field:</strong> ${this.getFieldDisplayName(conflict.field)}<br>
          <strong>Program:</strong> ${conflict.programName || 'Unnamed Program'}
        </div>
        
        <div class="conflict-field-comparison">
          <div class="conflict-option" data-choice="version1">
            <h4>📝 ${conflict.version1.userName}'s Version</h4>
            <div class="conflict-value">"${conflict.version1.value}"</div>
            <div class="conflict-meta">
              <small>Updated ${this.formatTime(conflict.version1.timestamp)}</small>
            </div>
          </div>
          
          <div class="conflict-option" data-choice="version2">
            <h4>📝 ${conflict.version2.userName}'s Version</h4>
            <div class="conflict-value">"${conflict.version2.value}"</div>
            <div class="conflict-meta">
              <small>Updated ${this.formatTime(conflict.version2.timestamp)}</small>
            </div>
          </div>
        </div>
        
        ${conflict.mergedSuggestion ? `
          <div class="conflict-option merged-suggestion" data-choice="merged">
            <h4>🤝 Suggested Merge</h4>
            <div class="conflict-value">"${conflict.mergedSuggestion.value}"</div>
            <div class="conflict-meta">
              <small>Automatically combined both changes</small>
            </div>
          </div>
        ` : ''}
        
        <div class="conflict-custom">
          <h4>✏️ Custom Solution</h4>
          <textarea class="conflict-custom-input" placeholder="Type your own resolution..."></textarea>
        </div>
        
        <div class="conflict-actions">
          <button class="btn-secondary" onclick="conflictResolution.cancelResolution('${conflict.id}')">
            Cancel
          </button>
          <button class="btn-primary" onclick="conflictResolution.applyResolution('${conflict.id}')">
            Apply Resolution
          </button>
        </div>
      </div>
    `;
    
    // Add event listeners for option selection
    modal.addEventListener('click', (e) => {
      if (e.target.classList.contains('conflict-option')) {
        // Remove previous selection
        modal.querySelectorAll('.conflict-option').forEach(opt => opt.classList.remove('selected'));
        // Add selection to clicked option
        e.target.classList.add('selected');
        
        // If custom option, focus the textarea
        if (e.target.dataset.choice === 'custom') {
          const textarea = modal.querySelector('.conflict-custom-input');
          textarea.focus();
        }
      }
    });
    
    // Handle custom textarea
    const customInput = modal.querySelector('.conflict-custom-input');
    customInput.addEventListener('input', () => {
      const customOption = modal.querySelector('.conflict-custom');
      customOption.classList.add('selected');
      
      // Deselect other options
      modal.querySelectorAll('.conflict-option').forEach(opt => opt.classList.remove('selected'));
    });
    
    document.body.appendChild(modal);
    
    // Store conflict data
    this.activeConflicts.set(conflict.id, { conflict, modal });
    
    // Auto-select the most recent version by default
    const mostRecent = conflict.version1.timestamp > conflict.version2.timestamp ? 'version1' : 'version2';
    modal.querySelector(`[data-choice="${mostRecent}"]`).classList.add('selected');
  },
  
  // Apply the chosen resolution
  applyResolution(conflictId) {
    const conflictData = this.activeConflicts.get(conflictId);
    if (!conflictData) return;
    
    const { conflict, modal } = conflictData;
    
    // Get selected resolution
    const selected = modal.querySelector('.conflict-option.selected, .conflict-custom.selected');
    if (!selected) {
      alert('Please select a resolution option');
      return;
    }
    
    let resolvedValue;
    let resolutionType;
    
    if (selected.classList.contains('conflict-custom')) {
      resolvedValue = modal.querySelector('.conflict-custom-input').value.trim();
      resolutionType = 'custom';
      if (!resolvedValue) {
        alert('Please enter a custom resolution');
        return;
      }
    } else {
      const choice = selected.dataset.choice;
      if (choice === 'version1') {
        resolvedValue = conflict.version1.value;
        resolutionType = 'version1';
      } else if (choice === 'version2') {
        resolvedValue = conflict.version2.value;
        resolutionType = 'version2';
      } else if (choice === 'merged') {
        resolvedValue = conflict.mergedSuggestion.value;
        resolutionType = 'merged';
      }
    }
    
    console.log(`[CONFLICT] Applying resolution: ${resolutionType} = "${resolvedValue}"`);
    
    // Apply the resolution
    this.executeResolution(conflict, resolvedValue, resolutionType);
    
    // Clean up
    this.cancelResolution(conflictId);
  },
  
  // Cancel conflict resolution
  cancelResolution(conflictId) {
    const conflictData = this.activeConflicts.get(conflictId);
    if (conflictData) {
      conflictData.modal.remove();
      this.activeConflicts.delete(conflictId);
    }
  },
  
  // Execute the chosen resolution
  executeResolution(conflict, resolvedValue, resolutionType) {
    const fieldElement = this.findFieldElement(conflict.programId, conflict.field);
    if (!fieldElement) {
      console.error('[CONFLICT] Could not find field element for resolution');
      return;
    }
    
    // Apply the resolved value
    if (fieldElement.type === 'checkbox') {
      fieldElement.checked = resolvedValue === true || resolvedValue === 'true';
    } else {
      fieldElement.value = resolvedValue;
    }
    
    // Update local data
    const programIndex = parseInt(
      fieldElement.closest('.program-entry')?.getAttribute('data-program-index'), 
      10
    );
    if (!isNaN(programIndex) && tableData.programs[programIndex]) {
      tableData.programs[programIndex][conflict.field] = resolvedValue;
    }
    
    // Save the resolution
    const programId = conflict.programId;
    if (programId) {
      atomicSaveField(fieldElement, conflict.field, programId, resolvedValue)
        .then(() => {
          console.log(`✅ [CONFLICT] Resolution saved successfully`);
          
          // Show success feedback
          fieldElement.style.background = '#e8f5e9';
          fieldElement.style.borderLeft = '3px solid #4caf50';
          setTimeout(() => {
            fieldElement.style.background = '';
            fieldElement.style.borderLeft = '';
          }, 2000);
        })
        .catch(error => {
          console.error('❌ [CONFLICT] Failed to save resolution:', error);
          alert('Failed to save the resolution. Please try again.');
        });
    }
    
    // Log the resolution
    console.log(`📊 [CONFLICT] Resolution applied:`, {
      type: resolutionType,
      field: conflict.field,
      finalValue: resolvedValue,
      originalVersions: [conflict.version1.value, conflict.version2.value]
    });
  },
  
  // Find field element by program ID and field name
  findFieldElement(programId, fieldName) {
    const entry = document.querySelector(`.program-entry[data-program-id='${programId}']`);
    if (!entry) return null;
    
    return entry.querySelector(`[data-field='${fieldName}']`) ||
           entry.querySelector(`input[placeholder*='${fieldName}']`) ||
           entry.querySelector(`textarea[placeholder*='${fieldName}']`);
  },
  
  // Get display name for field
  getFieldDisplayName(fieldName) {
    const displayNames = {
      name: 'Program Name',
      startTime: 'Start Time',
      endTime: 'End Time',
      location: 'Location',
      photographer: 'Photographer',
      notes: 'Notes',
      done: 'Completion Status'
    };
    return displayNames[fieldName] || fieldName;
  },
  
  // Format timestamp for display
  formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  },
  
  // Check if conflicts should trigger dialog (for complex scenarios)
  shouldShowDialog(conflict) {
    // Show dialog for:
    // 1. Simultaneous edits within 5 seconds
    // 2. Significantly different values
    // 3. Text fields with complex changes
    
    const timeDiff = Math.abs(conflict.version1.timestamp - conflict.version2.timestamp);
    const isSimultaneous = timeDiff < 5000; // 5 seconds
    
    const val1 = String(conflict.version1.value).trim();
    const val2 = String(conflict.version2.value).trim();
    const isSignificantlyDifferent = val1 !== val2 && val1.length > 5 && val2.length > 5;
    
    return isSimultaneous || isSignificantlyDifferent;
  }
};

// Add global conflict resolution functions
window.conflictResolution = conflictResolution;

// Monitor connection status and process queue when online
if (window.addEventListener) {
  window.addEventListener('online', () => {
    console.log('[NETWORK] Connection restored, processing failed saves queue');
    setTimeout(processFailedSavesQueue, 1000); // Small delay for stability
  });
  
  window.addEventListener('offline', () => {
    console.log('[NETWORK] Connection lost, future saves will be queued');
  });
}

function autoSave(field, date, ignoredIndex, key) {
  field.classList.remove('editing');
  const entry = field.closest('.program-entry');
  const programIndex = parseInt(entry.getAttribute('data-program-index'), 10);
  
  if (isNaN(programIndex) || !tableData.programs[programIndex]) {
    console.error(`[AUTOSAVE] Invalid program index: ${programIndex}`);
    return;
  }
  
  const program = tableData.programs[programIndex];
  let newValue = field.type === 'checkbox' ? field.checked : field.value;
  
  // Don't trim checkbox values, but trim text values
  if (field.type !== 'checkbox' && typeof newValue === 'string') {
    newValue = newValue.trim();
  }
  
  // Ensure we have the correct key for different field types
  let fieldKey = key;
  if (!fieldKey) {
    const dataField = field.getAttribute('data-field');
    if (dataField) {
      fieldKey = dataField;
    } else {
      const placeholder = field.getAttribute('placeholder');
      if (placeholder) {
        fieldKey = placeholder.toLowerCase();
      } else if (field.className.includes('program-name')) {
        fieldKey = 'name';
      } else if (field.type === 'checkbox') {
        fieldKey = 'done';
      }
    }
  }
  
  if (!fieldKey) {
    console.error(`[AUTOSAVE] Could not determine field key for auto-save`);
    return;
  }
  
  console.log(`[AUTOSAVE] Preparing to save field: ${fieldKey} = "${newValue}" for program ${program?._id || programIndex}`);
  
  // Update local data optimistically
  const wasChanged = safeUpdateProgram(programIndex, fieldKey, newValue);
  if (!wasChanged) {
    console.log(`[AUTOSAVE] No change detected for field ${fieldKey}, skipping save`);
    return;
  }
  
  // If startTime or endTime was changed, re-render to reorder programs
  const shouldReorder = fieldKey === 'startTime' || fieldKey === 'endTime';
  if (shouldReorder) {
    console.log(`[AUTOSAVE] Time field changed, triggering reorder`);
    // Delay render slightly to allow save to complete first
    setTimeout(() => renderProgramSections(isOwner), 50);
  }
  
  // Use atomic save if we have a program ID, otherwise fall back to full save
  if (program && program._id) {
    // Get old value for operational transform and optimistic updates
    const oldValue = program[fieldKey] || '';
    
    // Apply optimistic update immediately for instant feedback
    optimisticUpdates.applyOptimisticUpdate(field, fieldKey, program._id, newValue, oldValue);
    
    // Track this edit with a timestamp to protect it from socket overwrites
    const protectionKey = `${program._id}-${fieldKey}`;
    window.recentlyEditedFields = window.recentlyEditedFields || new Map();
    window.recentlyEditedFields.set(protectionKey, {
      value: newValue,
      timestamp: Date.now(),
      field: fieldKey
    });
    
    console.log(`[AUTOSAVE] Protected field ${fieldKey} for 10 seconds, applied optimistic update`);
    
    // Clear the tracking after 10 seconds (increased for better protection)
    setTimeout(() => {
      window.recentlyEditedFields.delete(protectionKey);
      console.log(`[AUTOSAVE] Protection expired for field ${fieldKey}`);
    }, 10000);
    
    // Use new atomic save function with operational transform
    const fieldId = `${program._id}-${fieldKey}`;
    atomicSaveField(field, fieldKey, program._id, newValue, oldValue)
      .then(success => {
        if (success) {
          // Confirm the optimistic update
          optimisticUpdates.confirmUpdate(fieldId);
          console.log(`[AUTOSAVE] ✅ Atomic save successful for ${fieldKey}`);
        } else {
          // Revert the optimistic update
          optimisticUpdates.revertUpdate(fieldId, new Error('Save returned false'));
        }
      })
      .catch(error => {
        console.error('[AUTOSAVE] Atomic save failed, queuing for retry:', error);
        // Revert the optimistic update
        optimisticUpdates.revertUpdate(fieldId, error);
        // Queue the failed save instead of doing a full save that could overwrite other changes
        queueFailedSave(field, fieldKey, program._id, newValue, 'atomic_save_failed');
      });
  } else {
    console.warn(`[AUTOSAVE] No program ID available, falling back to full schedule save`);
    scheduleSave();
  }
  
  // Clear editing state
  window.currentlyEditing = null;
}

// ===== Mark as Important =====

// Lightweight bottom toast (auto-hides ~1.8s)
function showImportantToast(message) {
  let toast = document.getElementById('scheduleImportantToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'scheduleImportantToast';
    toast.className = 'schedule-important-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  // Force reflow so the transition runs even on rapid repeat toggles
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// Toggle the important styling on both card and table representations of a row
function applyImportantStyles(programIndex, isImportant) {
  const card = document.querySelector(`#programSections .program-entry[data-program-index="${programIndex}"]`);
  if (card) card.classList.toggle('important-entry', isImportant);
  const row = document.querySelector(`#scheduleTableView .schedule-table-section tbody tr[data-program-index="${programIndex}"]`);
  if (row) row.classList.toggle('important-row', isImportant);
}

// Persist the important flag through the same atomic field pipeline as every
// other program field (PATCH /program-field → server broadcast → remote apply).
async function saveImportantField(programId, programIndex, newValue) {
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId || !programId) {
    // New row without a persisted _id yet — fall back to full save
    scheduleSave();
    return;
  }

  // Guard our own socket echo for 10s (mirrors autoSave protection)
  const protectionKey = `${programId}-important`;
  window.recentlyEditedFields = window.recentlyEditedFields || new Map();
  window.recentlyEditedFields.set(protectionKey, {
    value: newValue,
    timestamp: Date.now(),
    field: 'important'
  });
  setTimeout(() => window.recentlyEditedFields.delete(protectionKey), 10000);

  try {
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/program-field`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': localStorage.getItem('token')
      },
      body: JSON.stringify({
        programId,
        field: 'important',
        value: newValue,
        userId: await getUserIdFromToken(),
        sessionId: window.SimpleCollab?.getCurrentUser?.()?.sessionId
      })
    });

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[IMPORTANT] Failed to save important flag, reverting:', err);
    // Revert optimistic local state + UI
    safeUpdateProgram(programIndex, 'important', !newValue);
    applyImportantStyles(programIndex, !newValue);
    showImportantToast('Failed to update — try again');
  }
}

// Public toggle (also invoked from gestures)
function toggleImportant(programIndex) {
  const program = tableData.programs[programIndex];
  if (!program) return;

  const oldValue = Boolean(program.important);
  const newValue = !oldValue;

  // Optimistic local state + UI before the network round-trip
  safeUpdateProgram(programIndex, 'important', newValue);
  applyImportantStyles(programIndex, newValue);
  showImportantToast(newValue ? 'Marked important' : 'Removed important flag');

  saveImportantField(program._id, programIndex, newValue);
}
window.toggleImportant = toggleImportant;

// Desktop right-click + mobile long-press gestures to toggle important.
// Uses delegated listeners on the persistent containers, so it only binds once.
function setupScheduleImportantGestures() {
  const containers = [
    document.getElementById('programSections'),
    document.getElementById('scheduleTableView')
  ].filter(Boolean);

  const isInteractive = (target) =>
    target.closest('input, textarea, select, button, a, label, .delete-date-btn, .delete-row-btn, .row-action-btn');

  const resolveIndex = (target) => {
    const host = target.closest('.program-entry[data-program-index], tr[data-program-index]');
    if (!host) return null;
    const idx = parseInt(host.getAttribute('data-program-index'), 10);
    return Number.isNaN(idx) ? null : idx;
  };

  containers.forEach(container => {
    if (container.dataset.importantGesturesInit === '1') return;
    container.dataset.importantGesturesInit = '1';

    // Desktop: right-click
    container.addEventListener('contextmenu', (e) => {
      if (window.innerWidth <= 768) return; // mobile uses long-press
      if (!isOwner) return;
      if (isInteractive(e.target)) return;
      const index = resolveIndex(e.target);
      if (index === null) return;
      e.preventDefault();
      toggleImportant(index);
    });

    // Mobile: long-press (500ms), cancel if finger moves > ~12px
    let pressTimer = null;
    let pressHost = null;
    let startX = 0;
    let startY = 0;

    const clearPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (pressHost) { pressHost.classList.remove('schedule-longpress-pending'); pressHost = null; }
    };

    container.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 768) return;
      if (!isOwner) return;
      if (isInteractive(e.target)) return;
      const index = resolveIndex(e.target);
      if (index === null) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      pressHost = e.target.closest('.program-entry, tr');
      if (pressHost) pressHost.classList.add('schedule-longpress-pending');

      pressTimer = setTimeout(() => {
        clearPress();
        if (navigator.vibrate) { try { navigator.vibrate(20); } catch (_) {} }
        toggleImportant(index);
      }, 500);
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (!pressTimer) return;
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) {
        clearPress();
      }
    }, { passive: true });

    container.addEventListener('touchend', clearPress);
    container.addEventListener('touchcancel', clearPress);
  });
}
window.setupScheduleImportantGestures = setupScheduleImportantGestures;

// Optimistic UI: update tableData on input
function optimisticInputHandler(e) {
  const field = e.target;
  
  // Skip optimistic updates for checkboxes - they're handled by toggleDone
  if (field.type === 'checkbox') {
    return;
  }
  
  const entry = field.closest('.program-entry');
  if (!entry) return;
  const programIndex = parseInt(entry.getAttribute('data-program-index'), 10);
  if (isNaN(programIndex)) return;
  
  // Determine the correct field key
  let key = field.getAttribute('placeholder');
  if (key) {
    key = key.toLowerCase();
  } else if (field.className.includes('program-name')) {
    key = 'name';
  }
  
  if (key && tableData.programs[programIndex]) {
    const value = field.value;
    tableData.programs[programIndex][key] = value;
    
    console.log(`[OPTIMISTIC] Updated ${key} = ${value} for program ${programIndex}`);
  }
}

function toggleNotes(button) {
  const entry = button.closest('.program-entry');
  const notesField = entry.querySelector('.notes-field');
  const textarea = notesField.querySelector('textarea');
  const isOpen = notesField.style.display === 'block';
  notesField.style.display = isOpen ? 'none' : 'block';
  button.textContent = isOpen ? 'Show Notes' : 'Hide Notes';
  if (!isOpen && textarea) {
    // Force a reflow to ensure the textarea is visible
    textarea.offsetHeight;
    setupTextareaResize(textarea);
  }
}

function toggleAllNotes() {
  const allNotes = document.querySelectorAll('.notes-field');
  const allButtons = document.querySelectorAll('.show-notes-btn');
  allNotes.forEach(note => {
    note.style.display = allNotesVisible ? 'none' : 'block';
    const textarea = note.querySelector('textarea');
    if (!allNotesVisible && textarea) setupTextareaResize(textarea);
  });
  allButtons.forEach(btn => {
    btn.textContent = allNotesVisible ? 'Show Notes' : 'Hide Notes';
  });
  allNotesVisible = !allNotesVisible;
  const toggleBtn = document.getElementById('toggleAllNotesBtn');
  if (toggleBtn) toggleBtn.textContent = allNotesVisible ? 'Hide All Notes' : 'Show All Notes';
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;

  // Reset height to auto to get the correct scrollHeight
  textarea.style.height = 'auto';

  // Calculate the new height
  const newHeight = Math.max(textarea.scrollHeight, 40); // Ensure minimum height of 40px

  // Set the new height
  textarea.style.height = newHeight + 'px';
}

function setupTextareaResize(textarea) {
  if (!textarea) return;

  // Initial resize
  autoResizeTextarea(textarea);

  // Add input event listener
  textarea.addEventListener('input', () => autoResizeTextarea(textarea));

  // Add change event listener for paste events
  textarea.addEventListener('change', () => autoResizeTextarea(textarea));

  // Add paste event listener
  textarea.addEventListener('paste', () => {
    // Wait for paste to complete
    setTimeout(() => autoResizeTextarea(textarea), 0);
  });

  // Add focus event listener to ensure resizing on focus
  textarea.addEventListener('focus', () => autoResizeTextarea(textarea));
}

function captureCurrentPrograms() {
  console.warn('[DEPRECATED] captureCurrentPrograms() is being phased out due to data corruption risks');
  // This function has been replaced with safer, targeted updates
  // Do not rebuild the entire array - this causes data loss
}

function safeUpdateProgram(programIndex, field, value) {
  if (!tableData.programs[programIndex]) {
    console.error(`Program index ${programIndex} does not exist`);
    return false;
  }
  
  const program = tableData.programs[programIndex];
  const oldValue = program[field];
  
  if (oldValue !== value) {
    console.log(`[SAFE UPDATE] Program ${programIndex} ${field}: "${oldValue}" → "${value}"`);
    program[field] = value;
    return true; // Changed
  }
  return false; // No change
}

function safeAddProgram(date) {
  // Create new program with temporary ID until saved to database
  const newProgram = { 
    date, 
    name: '', 
    startTime: '', 
    endTime: '', 
    location: '', 
    photographer: '', 
    folder: '',
    notes: '',
    done: false,
    // Add a temporary ID for UI consistency (will be replaced by MongoDB _id after save)
    _tempId: generateTempId()
  };
  
  // Store the index where we're adding it
  const newIndex = tableData.programs.length;
  
  tableData.programs.push(newProgram);
  console.log(`✅ [SAFE ADD] Added new program for ${date} with temp ID: ${newProgram._tempId}`);
  renderProgramSections(isOwner);
  
  // Broadcast to other users if collaboration is enabled
  if (window.SimpleCollab && window.SimpleCollab.isEnabled()) {
    window.SimpleCollab.broadcastProgramAdded(date, newProgram);
  }
  
  // Save immediately to get a real MongoDB _id
  // Coordinate with any pending atomic saves
  coordinatedSave('program_add', () => scheduleSave()).then(() => {
    console.log(`✅ [SAFE ADD] Program saved successfully, should now have real _id`);
    // Re-render to update data-program-id attributes with real IDs
    if (window.__collaborativeScheduleInitialized) {
      setTimeout(() => renderProgramSections(isOwner), 100);
    }
  }).catch(err => {
    console.error('❌ [SAFE ADD] CRITICAL: Failed to save new program:', err);
    
    // ROLLBACK: Remove the program from local state since save failed
    console.warn('⚠️ [SAFE ADD] Rolling back - removing unsaved program from local state');
    const rollbackIndex = tableData.programs.findIndex(p => p._tempId === newProgram._tempId);
    if (rollbackIndex !== -1) {
      tableData.programs.splice(rollbackIndex, 1);
      renderProgramSections(isOwner);
    }
    
    // Alert user about the failure
    alert(`Failed to add program: ${err.message || 'Network error'}. Please check your connection and try again.`);
  });
}

function safeDeleteProgram(programIndex) {
  if (programIndex < 0 || programIndex >= tableData.programs.length) {
    console.error(`Invalid program index: ${programIndex}`);
    return;
  }
  
  const program = tableData.programs[programIndex];
  
  // Create confirmation message with program details
  const programName = program.name || 'Untitled Program';
  const programDate = program.date ? formatDate(program.date) : 'Unknown Date';
  const timeInfo = program.startTime || program.endTime ? 
    ` at ${formatTo12Hour(program.startTime || '')}${program.endTime ? ' - ' + formatTo12Hour(program.endTime) : ''}` : '';
  
  const confirmMessage = `Are you sure you want to delete "${programName}" on ${programDate}${timeInfo}?`;
  
  // Check if dark theme modal exists
  const deleteModal = document.getElementById('scheduleDeleteModal');
  if (deleteModal) {
    // Use custom dark theme modal
    const titleEl = document.getElementById('deleteModalTitle');
    const messageEl = document.getElementById('deleteModalMessage');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const cancelBtn = document.getElementById('cancelDeleteBtn');
    
    if (titleEl) titleEl.textContent = 'Delete Program';
    if (messageEl) messageEl.textContent = confirmMessage;
    
    deleteModal.classList.add('show');
    
    // Remove old listeners and add new ones
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newConfirmBtn.onclick = () => {
      deleteModal.classList.remove('show');
      executeDeleteProgram(programIndex, program, programName);
    };
    
    newCancelBtn.onclick = () => {
      deleteModal.classList.remove('show');
    };
    
    return;
  }
  
  // Fallback to confirm() for non-dark theme
  if (!confirm(confirmMessage)) {
    return;
  }
  
  executeDeleteProgram(programIndex, program, programName);
}

function executeDeleteProgram(programIndex, program, programName) {
  console.log(`[SAFE DELETE] Removing program: ${programName} on ${program.date}`);
  
  // Broadcast to other users if collaboration is enabled
  if (window.SimpleCollab && window.SimpleCollab.isEnabled()) {
    window.SimpleCollab.broadcastProgramDeleted(program);
  }
  
  tableData.programs.splice(programIndex, 1);
  renderProgramSections(isOwner);
  // Coordinate delete with pending atomic saves
  coordinatedSave('program_delete', () => scheduleSave());
}

function safeDeleteDate(date) {
  // Count how many programs will be deleted
  const programCount = tableData.programs.filter(p => p.date === date).length;
  const formattedDate = formatDate(date);
  const confirmMessage = `Are you sure you want to delete ${formattedDate} and all ${programCount} program${programCount !== 1 ? 's' : ''} for this date?`;
  
  // Check if dark theme modal exists
  const deleteModal = document.getElementById('scheduleDeleteModal');
  if (deleteModal) {
    // Use custom dark theme modal
    const titleEl = document.getElementById('deleteModalTitle');
    const messageEl = document.getElementById('deleteModalMessage');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const cancelBtn = document.getElementById('cancelDeleteBtn');
    
    if (titleEl) titleEl.textContent = 'Delete Date';
    if (messageEl) messageEl.textContent = confirmMessage;
    
    deleteModal.classList.add('show');
    
    // Remove old listeners and add new ones
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newConfirmBtn.onclick = () => {
      deleteModal.classList.remove('show');
      executeDeleteDate(date);
    };
    
    newCancelBtn.onclick = () => {
      deleteModal.classList.remove('show');
    };
    
    return;
  }
  
  // Fallback to confirm() for non-dark theme
  if (!confirm(confirmMessage)) return;
  
  executeDeleteDate(date);
}

function executeDeleteDate(date) {
  const originalCount = tableData.programs.length;
  tableData.programs = tableData.programs.filter(p => p.date !== date);
  const removedCount = originalCount - tableData.programs.length;
  
  console.log(`[SAFE DELETE DATE] Removed ${removedCount} programs for ${date}`);
  renderProgramSections(isOwner);
  // Coordinate date delete with pending atomic saves
  coordinatedSave('date_delete', () => scheduleSave());
}

function addDateSection() {
  const date = document.getElementById('newDate').value;
  if (!date) return alert('Please select a date');
  
  // Use safe add instead of dangerous captureCurrentPrograms
  const newProgram = { 
    date, 
    name: '', 
    startTime: '', 
    endTime: '', 
    location: '', 
    photographer: '', 
    notes: '',
    done: false,
    // Add automatic temporary ID for collaborative system compatibility
    _tempId: generateTempId()
  };
  
  tableData.programs.push(newProgram);
  document.getElementById('newDate').value = '';
  console.log(`[ADD DATE SECTION] Added new date section: ${date}`);
  renderProgramSections(isOwner);
  // Coordinate add date with pending atomic saves
  coordinatedSave('date_add', () => scheduleSave());
}

function addProgram(date) {
  // Use safe add instead of dangerous captureCurrentPrograms
  safeAddProgram(date);
}

function deleteProgram(button) {
  // Support both card view (.program-entry) and table view (tr)
  const cardEntry = button.closest('.program-entry');
  const tableRow = button.closest('tr');
  
  let index;
  if (cardEntry) {
    index = parseInt(cardEntry.getAttribute('data-program-index'), 10);
  } else if (tableRow) {
    index = parseInt(tableRow.getAttribute('data-program-index'), 10);
  }
  
  if (!isNaN(index)) {
    safeDeleteProgram(index);
  }
}

function deleteDate(date) {
  safeDeleteDate(date);
}

function goBack() {
  // Use the module-level currentEventId first, then fall back to localStorage
  const eventIdToUse = currentEventId || localStorage.getItem('eventId');
  if (!eventIdToUse) {
    console.error('No current event ID found for goBack navigation');
    // Fallback to dashboard
    window.location.href = 'dashboard.html';
    return;
  }
  console.log(`Navigating back to event: ${eventIdToUse}`);
  window.location.href = `event.html?id=${eventIdToUse}`;
}

function handleSearchInput(e) {
  searchQuery = e.target.value.toLowerCase();
  renderProgramSections(isOwner);
  saveFilterSettings();
}

window.loadPrograms = loadPrograms;
window.getUserIdFromToken = getUserIdFromToken;
window.savePrograms = savePrograms;
window.scheduleSave = scheduleSave;
window.renderProgramSections = renderProgramSections;
window.toggleDone = toggleDone;
window.matchesSearch = matchesSearch;
window.enableEdit = enableEdit;
window.autoSave = autoSave;
window.syncTimeDisplay = syncTimeDisplay;
window.toggleNotes = toggleNotes;
window.toggleAllNotes = toggleAllNotes;
window.autoResizeTextarea = autoResizeTextarea;
window.toggleFolderVisibility = toggleFolderVisibility;

// DEPRECATED: Use safe functions instead
window.captureCurrentPrograms = captureCurrentPrograms;

// NEW SAFE FUNCTIONS - USE THESE
window.safeUpdateProgram = safeUpdateProgram;
window.safeAddProgram = safeAddProgram;
window.safeDeleteProgram = safeDeleteProgram;
window.safeDeleteDate = safeDeleteDate;

// DATA VALIDATION AND CORRUPTION DETECTION
function validateScheduleData() {
  if (!tableData || !Array.isArray(tableData.programs)) {
    console.error('[VALIDATION] tableData.programs is not an array!');
    return false;
  }
  
  const validationErrors = [];
  const dates = new Set();
  
  tableData.programs.forEach((program, index) => {
    if (!program) {
      validationErrors.push(`Program ${index} is null/undefined`);
      return;
    }
    
    if (!program.date) {
      validationErrors.push(`Program ${index} missing date`);
    } else {
      dates.add(program.date);
    }
    
    // Check for suspicious data patterns that indicate corruption
    if (program.photographer && typeof program.photographer === 'string') {
      // Check if all programs have exactly the same photographer (corruption pattern)
      const allPhotographers = tableData.programs
        .filter(p => p && p.photographer)
        .map(p => p.photographer.trim())
        .filter(p => p.length > 0);
      
      if (allPhotographers.length > 1) {
        const uniquePhotographers = new Set(allPhotographers);
        if (uniquePhotographers.size === 1 && allPhotographers.length > 3) {
          validationErrors.push(`Suspicious: All ${allPhotographers.length} programs have identical photographer "${program.photographer}"`);
        }
      }
    }
    
    // Validate checkbox field (done) is boolean
    if (program.done !== undefined && typeof program.done !== 'boolean') {
      validationErrors.push(`Program ${index} has invalid done value: "${program.done}" (expected boolean)`);
    }
  });
  
  if (validationErrors.length > 0) {
    console.error('[VALIDATION] Schedule data validation failed:');
    validationErrors.forEach(error => console.error(`  - ${error}`));
    
    // Alert user about data corruption
    if (validationErrors.some(error => error.includes('Suspicious'))) {
      const shouldReload = confirm(
        'Data corruption detected: All programs have the same photographer. ' +
        'This usually indicates a saving error. Would you like to reload the page to restore the correct data?'
      );
      if (shouldReload) {
        window.location.reload();
        return false;
      }
    }
    
    return false;
  }
  
  console.log(`[VALIDATION] Schedule data is valid: ${tableData.programs.length} programs across ${dates.size} dates`);
  return true;
}

window.validateScheduleData = validateScheduleData;

window.addDateSection = addDateSection;
window.addProgram = addProgram;
window.deleteProgram = deleteProgram;
window.deleteDate = deleteDate;
window.goBack = goBack;
window.handleSearchInput = handleSearchInput;
window.resetFilterSettings = resetFilterSettings;

// Call setupTextareaResize for each textarea on page load
document.querySelectorAll('.auto-expand').forEach(setupTextareaResize);

// Preserve current session state before any cleanup
function preserveSessionState() {
  console.log('💾 [PRESERVE] Saving current session state...');
  
  try {
    // Save current filter settings to localStorage
    saveFilterSettings();
    
    // Save current scroll position to sessionStorage
    saveScrollPosition();
    
    console.log('✅ [PRESERVE] Session state preserved', { filterDate, searchQuery });
  } catch (error) {
    console.error('❌ [PRESERVE] Error preserving session state:', error);
  }
}

// Clean up only event listeners and memory leaks, NOT user state
function cleanupEventListenersAndMemory() {
  console.log('🧹 [CLEANUP] Cleaning up event listeners and memory...');
  
  // Cleanup simple collaborative features first
  if (window.SimpleCollab && window.__simpleCollabInitialized) {
    console.log('🧹 Cleaning up simple collaborative schedule features...');
    try {
      window.SimpleCollab.cleanup();
      window.__simpleCollabInitialized = false;
      console.log('✅ Simple collaborative features cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up simple collaborative features:', error);
    }
  }
  
  // Legacy cleanup for old collaborative system
  if (window.CollaborativeSchedule && window.__collaborativeScheduleInitialized) {
    console.log('🧹 Cleaning up legacy collaborative schedule features...');
    try {
      window.CollaborativeSchedule.cleanup();
      window.__collaborativeScheduleInitialized = false;
      console.log('✅ Legacy collaborative features cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up legacy collaborative features:', error);
    }
  }
  
  // Stop event ID monitoring
  stopEventIdMonitoring();
  
  // Remove schedule-page class from body
  document.body.classList.remove('schedule-page');

  // Remove input event listeners
  const inputs = document.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    input.removeEventListener('input', handleSearchInput);
    input.removeEventListener('change', handleSearchInput);
  });

  // Remove scroll event listener
  if (window.scheduleScrollHandler) {
    const { handler, container } = window.scheduleScrollHandler;
    if (container && handler) {
      container.removeEventListener('scroll', handler);
      console.log(`Removed scroll event listener from ${container.id || 'window'}`);
    }
  }
  
  // Clear scroll timeout if exists
  if (window.scrollSaveTimeout) {
    clearTimeout(window.scrollSaveTimeout);
  }

  // Clear any remaining timeouts
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  // Remove any other dynamically added elements or styles
  const dynamicElements = document.querySelectorAll('.dynamic-element');
  dynamicElements.forEach(el => el.remove());

  // Remove collaboration UI elements
  const collabElements = document.querySelectorAll('#active-collab-users, .editing-badge, .collaboration-notification');
  collabElements.forEach(el => el.remove());
  
  // Remove collaboration styles
  const collabStyles = document.querySelectorAll('#collab-users-styles, #collab-notification-styles');
  collabStyles.forEach(style => style.remove());

  console.log('✅ [CLEANUP] Event listeners and memory cleanup complete');
}

// Reset module variables (only for fresh page loads, not navigation)
function resetModuleVariables() {
  console.log('🔄 [RESET] Resetting module variables...');
  
  tableData = { programs: [] };
  saveTimeout = null;
  searchQuery = '';
  filterDate = 'all';
  allNotesVisible = false;
  isOwner = false;
  pendingScrollRestore = null;
  currentEventId = null;
  
  // Reset the initialization guards when cleaned up
  window.__scheduleJsLoaded = false;
  window.__simpleCollabLoaded = false;
  
  console.log('✅ [RESET] Module variables reset');
}

// Main cleanup function - preserves state but cleans up memory
window.cleanupSchedulePage = function cleanupSchedulePage() {
  console.log('🧹 [CLEANUP] cleanupSchedulePage called');
  
  // First, preserve current user state
  preserveSessionState();
  
  // Then clean up event listeners and memory
  cleanupEventListenersAndMemory();
  
  // Note: We DON'T reset module variables here to preserve session state
  // They will be reset only when a new event is loaded via resetModuleVariables()
  
  console.log('🧹 [CLEANUP] Schedule page cleanup complete (state preserved)');
}

function handleNavClick(e) {
  e.preventDefault();
  const page = e.currentTarget.getAttribute('data-page');
  
  // Use the module-level currentEventId first, then fall back to localStorage
  const eventIdToUse = currentEventId || localStorage.getItem('eventId');
  if (!eventIdToUse) {
    console.error('No current event ID found for navigation');
    // Fallback to dashboard if no event ID
    window.navigate('dashboard');
    return;
  }
  
  console.log(`Navigating to page: ${page} within event: ${eventIdToUse}`);
  window.navigate(page, eventIdToUse);
}

// Call cleanupSchedulePage before navigating away
window.addEventListener('beforeunload', cleanupSchedulePage);

// Import the SheetJS library dynamically when needed
function loadSheetJSLibrary() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve(window.XLSX);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.19.3/package/dist/xlsx.full.min.js';
    script.async = true;
    script.onload = () => resolve(window.XLSX);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Function to handle the file import
async function handleFileImport(event) {
  // Only allow owners to import files
  if (!isOwner) {
    alert('Not authorized. Only owners can import schedules.');
    // Reset the file input
    if (event.target) {
      event.target.value = '';
    }
    return;
  }
  
  const file = event.target.files[0];
  if (!file) return;

  try {
    const XLSX = await loadSheetJSLibrary();
    
    // Read the file
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Process the data
        processImportedData(jsonData);
      } catch (error) {
        console.error('Error parsing file:', error);
        alert('Error parsing file. Please check the format and try again.');
      }
    };
    
    reader.readAsArrayBuffer(file);
  } catch (error) {
    console.error('Error loading SheetJS library:', error);
    alert('Error loading import library. Please try again later.');
  }
}

// Function to export schedule to Excel
async function exportScheduleToExcel() {
  // Only allow owners/leads to export
  if (!isOwner) {
    alert('Not authorized. Only admins, event owners, and leads can export the schedule.');
    return;
  }
  
  if (!tableData || !tableData.programs || tableData.programs.length === 0) {
    alert('No schedule data to export.');
    return;
  }
  
  try {
    // Load SheetJS library
    const XLSX = await loadSheetJSLibrary();
    
    // Prepare data for export
    const exportData = [];
    
    // Add header row
    exportData.push([
      'Date',
      'Start Time',
      'End Time',
      'Program Name',
      'Location',
      'Photographer',
      'Notes',
      'Folder',
      'Done'
    ]);
    
    // Sort programs by date
    const sortedPrograms = [...tableData.programs].sort((a, b) => {
      return new Date(a.date) - new Date(b.date);
    });
    
    // Add data rows
    sortedPrograms.forEach(program => {
      exportData.push([
        program.date || '',
        program.startTime || '',
        program.endTime || '',
        program.name || '',
        program.location || '',
        program.photographer || '',
        program.notes || '',
        program.folder || '',
        program.done ? 'Yes' : 'No'
      ]);
    });
    
    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(exportData);
    
    // Set column widths
    worksheet['!cols'] = [
      { width: 12 },  // Date
      { width: 10 },  // Start Time
      { width: 10 },  // End Time
      { width: 30 },  // Program Name
      { width: 25 },  // Location
      { width: 20 },  // Photographer
      { width: 40 },  // Notes
      { width: 10 },  // Folder
      { width: 8 }    // Done
    ];
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Schedule');
    
    // Get event title for filename
    const eventTitle = document.getElementById('eventTitle')?.textContent || 'Schedule';
    const fileName = `${eventTitle}_Schedule_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    // Download file
    XLSX.writeFile(workbook, fileName);
    
    console.log('Schedule exported successfully');
  } catch (error) {
    console.error('Error exporting schedule:', error);
    alert('Error exporting schedule. Please try again.');
  }
}

// Process the imported data and add it to the schedule
function processImportedData(data) {
  if (!data || data.length < 2) {
    alert('The file appears to be empty or missing required data.');
    return;
  }
  
  // Extract headers from the first row
  const headers = data[0].map(header => header.toLowerCase().trim());
  
  // Check for required columns
  const requiredColumns = ['date', 'name'];
  const missingColumns = requiredColumns.filter(col => !headers.includes(col));
  
  if (missingColumns.length > 0) {
    alert(`The following required columns are missing: ${missingColumns.join(', ')}`);
    return;
  }
  
  // Map column indices
  const columnMap = {
    date: headers.indexOf('date'),
    name: headers.indexOf('name'),
    startTime: headers.indexOf('starttime') !== -1 ? headers.indexOf('starttime') : headers.indexOf('start time'),
    endTime: headers.indexOf('endtime') !== -1 ? headers.indexOf('endtime') : headers.indexOf('end time'),
    location: headers.indexOf('location'),
    photographer: headers.indexOf('photographer'),
    notes: headers.indexOf('notes'),
    folder: headers.indexOf('folder'),
    done: headers.indexOf('done') !== -1 ? headers.indexOf('done') : headers.indexOf('completed')
  };
  
  // Process each row
  const newPrograms = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[columnMap.date] || !row[columnMap.name]) continue; // Skip rows without date or name
    
    // Format the date to YYYY-MM-DD
    let dateValue = row[columnMap.date];
    
    // Handle Excel date format (numeric)
    if (typeof dateValue === 'number') {
      // Convert Excel date number to JS date
      const excelDate = new Date(Math.round((dateValue - 25569) * 86400 * 1000));
      dateValue = excelDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    } else if (typeof dateValue === 'string') {
      // Try to parse the date string
      const dateParts = dateValue.split(/[-\/]/);
      if (dateParts.length === 3) {
        // Check if it's MM/DD/YYYY or DD/MM/YYYY or YYYY/MM/DD
        if (dateParts[0].length === 4) {
          // YYYY/MM/DD
          dateValue = `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
        } else if (parseInt(dateParts[0]) > 12) {
          // DD/MM/YYYY
          dateValue = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;
        } else {
          // MM/DD/YYYY
          dateValue = `${dateParts[2]}-${dateParts[0].padStart(2, '0')}-${dateParts[1].padStart(2, '0')}`;
        }
      }
    }
    
    // Format times (convert e.g. "9:00" to "09:00")
    let startTime = '';
    let endTime = '';
    
    if (columnMap.startTime !== -1 && row[columnMap.startTime]) {
      startTime = formatTimeValue(row[columnMap.startTime]);
    }
    
    if (columnMap.endTime !== -1 && row[columnMap.endTime]) {
      endTime = formatTimeValue(row[columnMap.endTime]);
    }
    
    // Handle done/completed status
    let isDone = false;
    if (columnMap.done !== -1 && row[columnMap.done] !== undefined) {
      const doneValue = String(row[columnMap.done]).toLowerCase().trim();
      isDone = doneValue === 'true' || doneValue === '1' || doneValue === 'yes' || doneValue === 'completed' || doneValue === 'done';
    }
    
    newPrograms.push({
      date: dateValue,
      name: row[columnMap.name],
      startTime: startTime,
      endTime: endTime,
      location: columnMap.location !== -1 ? (row[columnMap.location] || '') : '',
      photographer: columnMap.photographer !== -1 ? (row[columnMap.photographer] || '') : '',
      notes: columnMap.notes !== -1 ? (row[columnMap.notes] || '') : '',
      folder: columnMap.folder !== -1 ? (row[columnMap.folder] || '') : '',
      done: isDone,
      // Add automatic temporary ID for collaborative system compatibility
      _tempId: generateTempId(`import_${i}`)
    });
  }
  
  if (newPrograms.length === 0) {
    alert('No valid data found in the file.');
    return;
  }

  // Create and show the modal
  showImportModal(newPrograms);
}

// Function to create and show the import modal
function showImportModal(newPrograms) {
  // Create modal container using dark theme classes
  const modalContainer = document.createElement('div');
  modalContainer.className = 'dark-modal show';
  modalContainer.id = 'importScheduleModal';
  
  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.className = 'dark-modal-content';
  
  // Create modal header
  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header-dark';
  modalHeader.innerHTML = `<h3>Import Schedule</h3>`;
  
  // Create modal body
  const modalBody = document.createElement('div');
  modalBody.className = 'modal-body-dark';
  modalBody.innerHTML = `
    <p>Found ${newPrograms.length} valid program entries.</p>
    <p>How would you like to import these entries?</p>
  `;
  
  // Create modal footer with buttons
  const modalFooter = document.createElement('div');
  modalFooter.className = 'modal-footer-dark';

  // Create cancel button
  const cancelButton = document.createElement('button');
  cancelButton.className = 'btn-secondary';
  cancelButton.textContent = 'Cancel';
  
  // Create merge button
  const mergeButton = document.createElement('button');
  mergeButton.className = 'btn-primary';
  mergeButton.style.background = 'var(--bg-tertiary)';
  mergeButton.style.border = '1px solid var(--border-default)';
  mergeButton.textContent = 'Merge with Current';
  
  // Create replace button
  const replaceButton = document.createElement('button');
  replaceButton.className = 'btn-primary';
  replaceButton.style.background = 'var(--brand-red)';
  replaceButton.textContent = 'Replace Current';
  
  // Add buttons to footer
  modalFooter.appendChild(cancelButton);
  modalFooter.appendChild(mergeButton);
  modalFooter.appendChild(replaceButton);
  
  // Add all elements to modal content
  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalContent.appendChild(modalFooter);
  
  // Add modal content to container
  modalContainer.appendChild(modalContent);
  
  // Add modal to body
  document.body.appendChild(modalContainer);
  
  // Helper function to close the modal
  const closeModal = () => {
    modalContainer.classList.remove('show');
    setTimeout(() => {
      if (modalContainer.parentNode) {
        modalContainer.parentNode.removeChild(modalContainer);
      }
    }, 200);
  };

  // Close modal when clicking backdrop
  modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) {
      closeModal();
    }
  });

  // Add event listeners to buttons
  cancelButton.addEventListener('click', closeModal);
  
  mergeButton.addEventListener('click', async () => {
    // Show loading state
    mergeButton.disabled = true;
    mergeButton.textContent = 'Importing...';
    
    try {
      // SAFE IMPORT: Add programs without overwriting existing data
      const originalLength = tableData.programs.length;
      tableData.programs = [...tableData.programs, ...newPrograms];
      
      // Use atomic approach: save entire schedule but with conflict detection
      await saveImportedPrograms(newPrograms, 'merge');
      
      renderProgramSections();
      closeModal();
      alert(`Successfully imported ${newPrograms.length} program entries.`);
    } catch (error) {
      console.error('Import failed:', error);
      // Rollback on error
      tableData.programs = tableData.programs.slice(0, originalLength);
      alert('Import failed. Please try again.');
    }
  });
  
  replaceButton.addEventListener('click', async () => {
    if (!confirm('This will replace ALL existing schedule data. Are you sure?')) return;
    
    // Show loading state
    replaceButton.disabled = true;
    replaceButton.textContent = 'Replacing...';
    
    try {
      // SAFE REPLACE: Backup original data in case of failure
      const originalPrograms = [...tableData.programs];
      tableData.programs = newPrograms;
      
      // Use atomic approach: save entire schedule but with conflict detection
      await saveImportedPrograms(newPrograms, 'replace');
      
      renderProgramSections();
      closeModal();
      alert(`Successfully replaced schedule with ${newPrograms.length} program entries.`);
    } catch (error) {
      console.error('Replace failed:', error);
      // Rollback on error
      tableData.programs = originalPrograms;
      renderProgramSections();
      alert('Replace failed. Please try again.');
    }
  });
}

// Safer import function with conflict detection
async function saveImportedPrograms(newPrograms, mode) {
  const tableId = currentEventId || localStorage.getItem('eventId');
  if (!tableId) {
    throw new Error('No event ID available for saving imported programs');
  }
  
  console.log(`[SAFE IMPORT] Saving ${newPrograms.length} programs via ${mode} import`);
  
  // For large imports, warn about potential conflicts
  if (newPrograms.length > 10) {
    console.warn(`[SAFE IMPORT] Large import detected (${newPrograms.length} programs). Consider using atomic saves for concurrent editing.`);
  }
  
  try {
    // Use the existing full save endpoint but with better error handling
    const response = await fetch(`${API_BASE}/api/tables/${tableId}/program-schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': localStorage.getItem('token')
      },
      body: JSON.stringify({ 
        programSchedule: tableData.programs,
        importMode: mode, // Add metadata for logging
        importCount: newPrograms.length
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.text();
    console.log(`✅ [SAFE IMPORT] Successfully saved ${newPrograms.length} imported programs`);
    
    return result;
  } catch (error) {
    console.error(`❌ [SAFE IMPORT] Failed to save imported programs:`, error);
    throw error;
  }
}

// Helper function to format time values
function formatTimeValue(timeValue) {
  if (typeof timeValue === 'number') {
    // Handle Excel time (decimal fraction of day)
    const totalMinutes = Math.round(timeValue * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } else if (typeof timeValue === 'string') {
    // Parse time string (various formats)
    const timeMatch = timeValue.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if (timeMatch) {
      let [_, hours, minutes, ampm] = timeMatch;
      hours = parseInt(hours);
      minutes = minutes ? parseInt(minutes) : 0;
      
      // Handle 12-hour format
      if (ampm) {
        if (ampm.toLowerCase() === 'pm' && hours < 12) hours += 12;
        if (ampm.toLowerCase() === 'am' && hours === 12) hours = 0;
      }
      
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }
  return timeValue;
}

// Utility function to generate temporary IDs for new programs
// This ensures all programs (manual and imported) have IDs from creation
// Temporary IDs get replaced with MongoDB _ids when saved to backend
function generateTempId(suffix = '') {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substr(2, 9);
  return `temp_${timestamp}_${randomId}${suffix ? '_' + suffix : ''}`;
}

// Function to download a CSV template for importing
function downloadImportTemplate() {
  // Only allow owners to download the template
  if (!isOwner) {
    alert('Not authorized. Only owners can download import templates.');
    return;
  }
  
  const headers = ['Date', 'Name', 'StartTime', 'EndTime', 'Location', 'Photographer', 'Notes', 'Folder', 'Done'];
  const csvContent = headers.join(',') + '\n' +
    '2023-06-01,Main Event,09:00,12:00,Grand Hall,John Smith,VIP guests expected,DAY1,FALSE\n' +
    '2023-06-01,Lunch Break,12:00,13:00,Dining Room,N/A,Catering by LocalFood,DAY1,FALSE\n' +
    '2023-06-01,Panel Discussion,13:30,15:00,Conference Room B,Jane Doe,Q&A session at the end,DAY1,TRUE\n' +
    '2023-06-02,Workshop,10:00,12:30,Training Room,Michael Johnson,Bring extra equipment,DAY2,FALSE\n' +
    '2023-06-02,Closing Event,16:00,18:00,Main Stage,Full Team,Group photo at 17:30,DAY2,FALSE';
  
  // Create a Blob with the CSV content
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // Create a download link
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', 'schedule_template.csv');
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Add to exports
window.generateTempId = generateTempId;
window.downloadImportTemplate = downloadImportTemplate;
window.handleFileImport = handleFileImport;
window.exportScheduleToExcel = exportScheduleToExcel;
window.processImportedData = processImportedData;
window.formatTimeValue = formatTimeValue;
window.showImportModal = showImportModal;
window.updateProgramRow = updateProgramRow;
window.updateProgramFields = updateProgramFields;
window.preserveProgramInputStates = preserveProgramInputStates;

// --- Socket.IO real-time updates ---
if (window.socket) {
  console.log('[SOCKET] Using global socket for schedule updates');
  
  // Listen for schedule-specific updates (per-row updates)
  window.socket.on('scheduleChanged', (data) => {
    console.log(`[SOCKET] Schedule update received:`, data);
    logEventIdState('SOCKET_SCHEDULE_UPDATE');
    
    const currentEvent = currentEventId || localStorage.getItem('eventId');
    
    // Only update if this update is for the current event
    if (data.eventId === currentEvent || data.tableId === currentEvent) {
      console.log(`[SOCKET] Update is for current event (${currentEvent}), processing...`);
      
      // Check if user is actively editing to prevent disruptions
      if (window.isActiveEditing) {
        console.log('[SOCKET] User is currently editing, setting pending reload flag');
        window.pendingReload = true;
        return;
      }
      
      // If this is a specific program update, try to update just that row
      if (data.program && data.program._id) {
        console.log(`[SOCKET] Smart updating specific program row: ${data.program._id}`);
        
        // Check if the user is specifically editing this program
        const container = document.getElementById('programSections');
        if (container) {
          const entry = container.querySelector(`.program-entry[data-program-id='${data.program._id}']`);
          if (entry && entry.contains(document.activeElement)) {
            console.log('[SOCKET] User is editing this specific program, deferring update');
            window.pendingReload = true;
            return;
          }
        }
        
        // Update the program in our local data and UI using smart update
        const programIndex = tableData.programs.findIndex(p => p._id === data.program._id);
        if (programIndex !== -1) {
          // Use the smart update which will handle field protection automatically
          updateProgramRow(data.program, isOwner);
          console.log(`[SOCKET] Smart update completed for program row: ${data.program.name || 'unnamed'}`);
        } else {
          console.log(`[SOCKET] Program not found in local data, doing full reload`);
          loadPrograms(); // Fallback to full reload
        }
      } else {
        console.log(`[SOCKET] General schedule update, doing full reload`);
        loadPrograms(); // Full reload for general updates
      }
    } else {
      console.log(`[SOCKET] Update is for different event (${data.eventId || data.tableId}), current: ${currentEvent}, ignoring`);
    }
  });
  
  // Listen for general table updates that might affect ownership
  window.socket.on('tableUpdated', (data) => {
    console.log(`[SOCKET] Table update received:`, data);
    logEventIdState('SOCKET_TABLE_UPDATE');
    
    const currentEvent = currentEventId || localStorage.getItem('eventId');
    
    // Only update if this update is for the current event
    if (data.tableId === currentEvent) {
      console.log(`[SOCKET] Table update is for current event (${currentEvent}), reloading...`);
      
      // Check if user is actively editing
      if (window.isActiveEditing) {
        console.log('[SOCKET] User is currently editing, setting pending reload flag');
        window.pendingReload = true;
        return;
      }
      
      loadPrograms(); // Reload to get updated permissions
    } else {
      console.log(`[SOCKET] Table update is for different event (${data.tableId}), current: ${currentEvent}, ignoring`);
    }
  });
  
  // Also listen for the legacy programUpdate event for backward compatibility
  window.socket.on('programUpdate', (data) => {
    console.log(`[SOCKET] Legacy program update received:`, data);
    logEventIdState('SOCKET_PROGRAM_UPDATE_LEGACY');
    
    const currentEvent = currentEventId || localStorage.getItem('eventId');
    
    if (data.eventId === currentEvent) {
      console.log(`[SOCKET] Legacy update is for current event (${currentEvent}), refreshing...`);
      
      if (window.isActiveEditing) {
        console.log('[SOCKET] User is currently editing, setting pending reload flag');
        window.pendingReload = true;
        return;
      }
      
      loadPrograms();
    } else {
      console.log(`[SOCKET] Legacy update is for different event (${data.eventId}), current: ${currentEvent}, ignoring`);
    }
  });
  
  // Listen for the actual programUpdated event that the backend emits
  window.socket.on('programUpdated', (data) => {
    console.log(`[SOCKET] Program updated event received:`, data);
    logEventIdState('SOCKET_PROGRAM_UPDATED');
    
    const currentEvent = currentEventId || localStorage.getItem('eventId');
    
    // Only update if this update is for the current event
    if (data.eventId === currentEvent || data.tableId === currentEvent) {
      console.log(`[SOCKET] Program update is for current event (${currentEvent}), processing...`);
      
      // Check if user is actively editing to prevent disruptions
      if (window.isActiveEditing) {
        console.log('[SOCKET] User is currently editing, setting pending reload flag');
        window.pendingReload = true;
        return;
      }
      
      // If this is a specific program update, try to update just that row
      if (data.program && data.program._id) {
        console.log(`[SOCKET] Smart updating specific program row: ${data.program._id}`);
        
        // Check if the user is specifically editing this program
        const container = document.getElementById('programSections');
        if (container) {
          const entry = container.querySelector(`.program-entry[data-program-id='${data.program._id}']`);
          if (entry && entry.contains(document.activeElement)) {
            console.log('[SOCKET] User is editing this specific program, deferring update');
            window.pendingReload = true;
            return;
          }
        }
        
        // Update the program in our local data and UI using smart update
        const programIndex = tableData.programs.findIndex(p => p._id === data.program._id);
        if (programIndex !== -1) {
          // Use the smart update which will handle field protection automatically
          updateProgramRow(data.program, isOwner);
          console.log(`[SOCKET] Smart update completed for program row: ${data.program.name || 'unnamed'}`);
        } else {
          console.log(`[SOCKET] Program not found in local data, doing full reload`);
          loadPrograms(); // Fallback to full reload
        }
      } else {
        console.log(`[SOCKET] General program update, doing full reload`);
        loadPrograms(); // Full reload for general updates
      }
    } else {
      console.log(`[SOCKET] Program update is for different event (${data.eventId || data.tableId}), current: ${currentEvent}, ignoring`);
    }
  });
  
  // NEW: Listen for atomic field updates - this prevents data loss!
  window.socket.on('programFieldUpdated', (data) => {
    console.log(`[SOCKET] Field update received:`, data);
    
    const currentEvent = currentEventId || localStorage.getItem('eventId');
    
    // Only update if this update is for the current event
    if (data.eventId === currentEvent) {
      console.log(`[SOCKET] Field update is for current event (${currentEvent}), processing...`);
      
      // Don't update if this came from the current user's session
      const currentSessionId = window.SimpleCollab?.getCurrentUser?.()?.sessionId;
      if (data.sessionId && data.sessionId === currentSessionId) {
        console.log('[SOCKET] Ignoring field update from own session');
        return;
      }
      
      // Find the specific field element
      const container = document.getElementById('programSections');
      if (!container) {
        console.warn('[SOCKET] Program container not found');
        return;
      }
      
      const entry = container.querySelector(`.program-entry[data-program-id='${data.programId}']`);
      if (!entry) {
        console.warn(`[SOCKET] Program entry not found: ${data.programId}`);
        return;
      }
      
      // The "important" flag has no input element — toggle classes on card + table row
      if (data.field === 'important') {
        const protectionKey = `${data.programId}-important`;
        const recentEdit = window.recentlyEditedFields?.get(protectionKey);
        if (recentEdit && Date.now() - recentEdit.timestamp < 10000) {
          console.log('[SOCKET] important recently edited locally, skipping remote apply');
          return;
        }
        const isImportant = Boolean(data.value);
        entry.classList.toggle('important-entry', isImportant);
        const tableRow = document.querySelector(`#scheduleTableView .schedule-table-section tbody tr[data-program-id='${data.programId}']`);
        if (tableRow) tableRow.classList.toggle('important-row', isImportant);
        const importantIndex = tableData.programs.findIndex(p => p._id === data.programId);
        if (importantIndex !== -1) safeUpdateProgram(importantIndex, 'important', isImportant);
        console.log(`✅ [SOCKET] Applied important = ${isImportant} by ${data.userName || 'another user'}`);
        return;
      }
      
      const fieldElement = entry.querySelector(`[data-field='${data.field}']`);
      if (!fieldElement) {
        console.warn(`[SOCKET] Field element not found: ${data.field}`);
        return;
      }
      
      // Don't update if user is currently editing this specific field
      if (document.activeElement === fieldElement) {
        console.log('[SOCKET] User is editing this field, deferring update');
        return;
      }
      
      // Check if this field was recently edited by the current user
      const protectionKey = `${data.programId}-${data.field}`;
      const recentEdit = window.recentlyEditedFields?.get(protectionKey);
      if (recentEdit && Date.now() - recentEdit.timestamp < 10000) {
        console.log(`[SOCKET] Field recently edited by current user, skipping update for ${data.field}`);
        return;
      }
      
      // Update the field value
      const oldValue = fieldElement.type === 'checkbox' ? fieldElement.checked : fieldElement.value;
      
      if (fieldElement.type === 'checkbox') {
        fieldElement.checked = data.value;
        fieldElement.setAttribute('data-original-value', data.value ? 'true' : 'false');
        // Update visual state
        entry.classList.toggle('done-entry', data.value);
      } else {
        fieldElement.value = data.value || '';
      }
      
      // Update local data
      const programIndex = tableData.programs.findIndex(p => p._id === data.programId);
      if (programIndex !== -1) {
        safeUpdateProgram(programIndex, data.field, data.value);
      }
      
      // Show visual feedback that field was updated by another user
      fieldElement.style.background = '#e3f2fd';
      fieldElement.style.transition = 'background 0.5s ease';
      
      setTimeout(() => {
        fieldElement.style.background = '';
      }, 2000);
      
      // Show notification of who made the change
      if (data.userName && data.userName !== 'Unknown User') {
        const notification = document.createElement('div');
        notification.style.cssText = `
          position: absolute;
          top: -25px;
          right: 0;
          background: #2196f3;
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          z-index: 1000;
          pointer-events: none;
        `;
        notification.textContent = `Updated by ${data.userName}`;
        
        entry.style.position = 'relative';
        entry.appendChild(notification);
        
        setTimeout(() => {
          notification.remove();
        }, 3000);
      }
      
      console.log(`✅ [SOCKET] Applied field update: ${data.field} = "${data.value}" by ${data.userName}`);
    } else {
      console.log(`[SOCKET] Field update is for different event (${data.eventId}), current: ${currentEvent}, ignoring`);
    }
  });
  
  // Listen for user presence updates
  window.socket.on('presenceUpdated', (data) => {
    console.log(`[SOCKET] Presence update received:`, data);
    if (userPresence && userPresence.handlePresenceUpdate) {
      userPresence.handlePresenceUpdate(data);
    }
  });
  
  console.log('[SOCKET] Global socket event handlers registered for schedule (including presence)');
} else {
  console.warn('[SOCKET] Global socket not available, real-time updates disabled');
}

// Create and store the scroll handler when page loads
window.scheduleScrollHandler = createScrollListener();

// Add a function to reset filter settings
function resetFilterSettings() {
  // Reset filter date
  filterDate = 'all';
  const filterDropdown = document.getElementById('filterDateDropdown');
  if (filterDropdown) filterDropdown.value = 'all';
  
  // Reset search query
  searchQuery = '';
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  
  // Reset scroll position
  window.scrollTo(0, 0);
  pendingScrollRestore = null;
  
  // Clear old stored state when switching events
  const oldTableId = localStorage.getItem('eventId');
  if (oldTableId) {
    try {
      localStorage.removeItem(`schedule_filter_date_${oldTableId}`);
      localStorage.removeItem(`schedule_search_${oldTableId}`);
      sessionStorage.removeItem(`schedule_scroll_${oldTableId}`);
      console.log('🧹 [RESET] Cleared old state for previous event');
    } catch (error) {
      console.error('❌ [RESET] Error clearing old state:', error);
    }
  }
  
  // Apply the reset filters
  renderProgramSections(isOwner);
}

// --- Editing guard for real-time updates ---
window.isActiveEditing = false;
window.pendingReload = false;

function setEditingListeners() {
  // Attach to all inputs and textareas in the schedule page
  document.querySelectorAll('input, textarea').forEach(el => {
    // Remove existing listeners to prevent duplicates
    el.removeEventListener('focus', handleFocus);
    el.removeEventListener('blur', handleBlur);
    el.removeEventListener('input', handleInput);
    
    // Add new listeners
    el.addEventListener('focus', handleFocus);
    el.addEventListener('blur', handleBlur);
    el.addEventListener('input', handleInput);
  });
}

// Separate handler functions for better control
function handleFocus(e) {
  const field = e.target;
  window.isActiveEditing = true;
  
  // Mark the specific field being edited
  const entry = field.closest('.program-entry');
  if (entry) {
    const programId = entry.getAttribute('data-program-id');
    let fieldKey = field.getAttribute('placeholder');
    if (fieldKey) {
      fieldKey = fieldKey.toLowerCase();
    } else if (field.className.includes('program-name')) {
      fieldKey = 'name';
    }
    
    if (programId && fieldKey) {
      console.log(`[FOCUS] Editing ${fieldKey} in program ${programId}`);
      window.currentlyEditingField = `${programId}-${fieldKey}`;
    }
  }
}

function handleBlur(e) {
  const field = e.target;
  window.isActiveEditing = false;
  window.currentlyEditingField = null;
  
  // Add a delay before processing pending updates to allow autoSave to complete
  if (window.pendingReload) {
    setTimeout(() => {
      // Check again if still not editing (in case user quickly focused another field)
      if (!window.isActiveEditing && window.pendingReload) {
        window.pendingReload = false;
        const tableId = localStorage.getItem('eventId');
        if (tableId && typeof loadPrograms === 'function') {
          console.log('[BLUR] Processing pending reload after edit completion');
          loadPrograms(tableId);
        }
      }
    }, 1000); // Increased delay for textarea fields
  }
}

function handleInput(e) {
  // Immediately update optimistic UI
  optimisticInputHandler(e);
  
  // For textareas, also trigger auto-resize
  if (e.target.tagName === 'TEXTAREA') {
    autoResizeTextarea(e.target);
  }
}

// Call this after rendering program sections
const origRenderProgramSections = renderProgramSections;
renderProgramSections = function(...args) {
  origRenderProgramSections.apply(this, args);
  setEditingListeners();
  // Attach input handler for optimistic UI
  document.querySelectorAll('.program-entry input, .program-entry textarea').forEach(el => {
    el.removeEventListener('input', optimisticInputHandler);
    el.addEventListener('input', optimisticInputHandler);
  });
};

// --- Per-row update for programUpdated ---
function updateProgramRow(program, hasScheduleAccess) {
  // Find the row by _id
  const container = document.getElementById('programSections');
  if (!container) return;
  
  // Find the entry with the matching data-program-id
  const entry = container.querySelector(`.program-entry[data-program-id='${program._id}']`);
  if (!entry) return;
  
  const programIndex = tableData.programs.findIndex(p => p._id === program._id);
  if (programIndex === -1) return;
  
  console.log(`[UPDATE] Smart updating program row for ${program.name || 'unnamed'}`);
  
  // Preserve current input states before making changes
  const preservationData = preserveProgramInputStates(entry);
  
  // Check if any field in this row is currently focused
  const activeElement = document.activeElement;
  const isRowBeingEdited = entry.contains(activeElement) && 
    (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
  
  // Always update the done-entry class for strikethrough
  entry.classList.toggle('done-entry', program.done);
  
  // Merge the incoming program data with protection for active editing
  const currentProgram = tableData.programs[programIndex];
  const finalProgram = { ...currentProgram };
  
  // Check each field in the incoming update
  for (const [key, value] of Object.entries(program)) {
    const fieldKey = `${program._id}-${key}`;
    const recentEdit = window.recentlyEditedFields.get(fieldKey);
    const currentlyEditing = window.currentlyEditingField === fieldKey;
    const isFieldFocused = preservationData.focusedField === key;
    
    // Skip this field if it was recently edited, currently being edited, or currently focused
    if (recentEdit && Date.now() - recentEdit.timestamp < 5000) {
      console.log(`[UPDATE] Preserving recently edited field: ${key} (${Date.now() - recentEdit.timestamp}ms ago)`);
      continue;
    }
    
    if (currentlyEditing || isFieldFocused) {
      console.log(`[UPDATE] Preserving actively editing field: ${key}`);
      continue;
    }
    
    finalProgram[key] = value;
  }
  
  // Update the local data
  tableData.programs[programIndex] = finalProgram;
  
  // Smart update individual fields instead of rebuilding entire HTML
  updateProgramFields(entry, finalProgram, preservationData, hasScheduleAccess, programIndex);
  
  console.log(`[UPDATE] Smart update completed for program ${finalProgram.name || 'unnamed'}`);
}

// Smart field update function that preserves input states
function updateProgramFields(entry, program, preservationData, hasScheduleAccess, programIndex) {
  // Update name
  const nameInput = entry.querySelector('.program-name');
  if (nameInput && !isFieldCurrentlyFocused(nameInput, preservationData)) {
    if (nameInput.value !== (program.name || '')) {
      console.log(`[UPDATE] Updating name: '${nameInput.value}' -> '${program.name || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      nameInput.dataset.collaborativeUpdate = 'true';
      
      nameInput.value = program.name || '';
    }
  }
  
  // Update done checkbox
  const doneCheckbox = entry.querySelector('input[type="checkbox"]');
  if (doneCheckbox && !isFieldCurrentlyFocused(doneCheckbox, preservationData)) {
    if (doneCheckbox.checked !== Boolean(program.done)) {
      console.log(`[UPDATE] Updating done: ${doneCheckbox.checked} -> ${Boolean(program.done)}`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      doneCheckbox.dataset.collaborativeUpdate = 'true';
      
      doneCheckbox.checked = Boolean(program.done);
      entry.classList.toggle('done-entry', Boolean(program.done));
    }
  }
  
  // Update start time
  const startTimeInput = entry.querySelector('input[type="time"]:first-of-type');
  if (startTimeInput && !isFieldCurrentlyFocused(startTimeInput, preservationData)) {
    if (startTimeInput.value !== (program.startTime || '')) {
      console.log(`[UPDATE] Updating start time: '${startTimeInput.value}' -> '${program.startTime || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      startTimeInput.dataset.collaborativeUpdate = 'true';
      
      startTimeInput.value = program.startTime || '';
      syncTimeDisplay(startTimeInput);
    }
  }
  
  // Update end time
  const endTimeInput = entry.querySelector('input[type="time"]:last-of-type');
  if (endTimeInput && !isFieldCurrentlyFocused(endTimeInput, preservationData)) {
    if (endTimeInput.value !== (program.endTime || '')) {
      console.log(`[UPDATE] Updating end time: '${endTimeInput.value}' -> '${program.endTime || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      endTimeInput.dataset.collaborativeUpdate = 'true';
      
      endTimeInput.value = program.endTime || '';
      syncTimeDisplay(endTimeInput);
    }
  }
  
  // Update location textarea
  const locationTextarea = entry.querySelector('textarea:first-of-type');
  if (locationTextarea && !isFieldCurrentlyFocused(locationTextarea, preservationData)) {
    if (locationTextarea.value !== (program.location || '')) {
      console.log(`[UPDATE] Updating location: '${locationTextarea.value}' -> '${program.location || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      locationTextarea.dataset.collaborativeUpdate = 'true';
      
      locationTextarea.value = program.location || '';
      autoResizeTextarea(locationTextarea);
    }
  }
  
  // Update photographer textarea
  const photographerTextarea = entry.querySelector('textarea:nth-of-type(2)');
  if (photographerTextarea && !isFieldCurrentlyFocused(photographerTextarea, preservationData)) {
    if (photographerTextarea.value !== (program.photographer || '')) {
      console.log(`[UPDATE] Updating photographer: '${photographerTextarea.value}' -> '${program.photographer || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      photographerTextarea.dataset.collaborativeUpdate = 'true';
      
      photographerTextarea.value = program.photographer || '';
      autoResizeTextarea(photographerTextarea);
    }
  }
  
  // Update notes textarea
  const notesTextarea = entry.querySelector('.notes-field textarea');
  if (notesTextarea && !isFieldCurrentlyFocused(notesTextarea, preservationData)) {
    if (notesTextarea.value !== (program.notes || '')) {
      console.log(`[UPDATE] Updating notes: '${notesTextarea.value}' -> '${program.notes || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      notesTextarea.dataset.collaborativeUpdate = 'true';
      
      notesTextarea.value = program.notes || '';
      autoResizeTextarea(notesTextarea);
    }
  }
  
  // Update folder input
  const folderInput = entry.querySelector('input[data-field="folder"]');
  if (folderInput && !isFieldCurrentlyFocused(folderInput, preservationData)) {
    if (folderInput.value !== (program.folder || '')) {
      console.log(`[UPDATE] Updating folder: '${folderInput.value}' -> '${program.folder || ''}'`);
      
      // CRITICAL: Mark as programmatic update to prevent feedback loops
      folderInput.dataset.collaborativeUpdate = 'true';
      
      folderInput.value = program.folder || '';
      
      // Update data attribute for styling purposes
      const container = folderInput.closest('.folder-field-container');
      if (container) {
        const hasValue = (program.folder || '').trim().length > 0;
        container.setAttribute('data-has-value', hasValue ? 'true' : 'false');
      }
    }
  }
  
  // Restore focus if it was preserved
  if (preservationData.focusedElement && preservationData.shouldRestoreFocus) {
    setTimeout(() => {
      try {
        preservationData.focusedElement.focus();
        if (preservationData.focusedElement.setSelectionRange && 
            preservationData.selectionStart !== undefined && 
            preservationData.selectionEnd !== undefined) {
          preservationData.focusedElement.setSelectionRange(
            preservationData.selectionStart, 
            preservationData.selectionEnd
          );
        }
        console.log('[UPDATE] Restored focus and selection');
      } catch (error) {
        console.log('[UPDATE] Could not restore focus:', error);
      }
    }, 0);
  }
}

// Preserve input states for program row updates
function preserveProgramInputStates(entry) {
  const preservationData = {
    focusedElement: null,
    focusedField: null,
    selectionStart: null,
    selectionEnd: null,
    shouldRestoreFocus: false
  };
  
  const activeElement = document.activeElement;
  if (activeElement && entry.contains(activeElement)) {
    preservationData.focusedElement = activeElement;
    preservationData.shouldRestoreFocus = true;
    
    // Determine which field is focused
    if (activeElement.classList.contains('program-name')) {
      preservationData.focusedField = 'name';
    } else if (activeElement.dataset.field === 'folder') {
      preservationData.focusedField = 'folder';
    } else if (activeElement.type === 'time') {
      if (activeElement === entry.querySelector('input[type="time"]:first-of-type')) {
        preservationData.focusedField = 'startTime';
      } else {
        preservationData.focusedField = 'endTime';
      }
    } else if (activeElement.type === 'checkbox') {
      preservationData.focusedField = 'done';
    } else if (activeElement.tagName === 'TEXTAREA') {
      if (activeElement.closest('.notes-field')) {
        preservationData.focusedField = 'notes';
      } else if (activeElement === entry.querySelector('textarea:first-of-type')) {
        preservationData.focusedField = 'location';
      } else {
        preservationData.focusedField = 'photographer';
      }
    }
    
    // Preserve selection for text inputs and textareas
    if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
      preservationData.selectionStart = activeElement.selectionStart;
      preservationData.selectionEnd = activeElement.selectionEnd;
    }
    
    console.log('[UPDATE] Preserving focus state for field:', preservationData.focusedField);
  }
  
  return preservationData;
}

// Check if a field is currently focused
function isFieldCurrentlyFocused(element, preservationData) {
  return preservationData.focusedElement === element;
}

// Add missing setupDateFilterOptions function and fix programs reference
function setupDateFilterOptions() {
  const filterDropdown = document.getElementById('filterDateDropdown');
  if (filterDropdown && tableData.programs) {
    const allDates = [...new Set(tableData.programs.map(p => p.date))].sort((a, b) => a.localeCompare(b));
    
    // Check if there's a saved filter date in localStorage
    const tableId = currentEventId || localStorage.getItem('eventId');
    const savedFilterDate = localStorage.getItem(`schedule_filter_date_${tableId}`) || null;
    
    // Use saved filter date if available, otherwise use current filterDate, fallback to 'all'
    const currentSelection = savedFilterDate || filterDate || 'all';
    
    // Update the global filterDate variable to match what we're setting
    filterDate = currentSelection;
    
    filterDropdown.innerHTML = `<option value="all">All Dates</option>`;
    allDates.forEach(date => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = formatDate(date);
      filterDropdown.appendChild(option);
    });
    filterDropdown.value = currentSelection;
    console.log(`[FILTER] Setup ${allDates.length} date filter options, current: ${currentSelection}, saved: ${savedFilterDate}`);
  }
}

// Test smart update functionality
window.testScheduleSmartUpdate = function(programId, testData) {
  console.log('[TEST] Testing smart schedule update for program:', programId);
  const mockProgram = testData || {
    _id: programId,
    name: 'Test Program ' + Date.now(),
    startTime: '14:30',
    endTime: '16:00',
    location: 'Test Location',
    photographer: 'Test Photographer',
    notes: 'Test notes content',
    done: false
  };
  
  console.log('[TEST] Mock program data:', mockProgram);
  updateProgramRow(mockProgram, true);
};

// Initialize Phase 2 collaboration features when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPhase2Features);
} else {
  initPhase2Features();
}

function initPhase2Features() {
  console.log('[PHASE2] DISABLED - Collaboration features disabled to prevent mobile header blocking');
  return; // Exit early - completely disable Phase 2 collaboration
  
  try {
    // Initialize user presence system
    userPresence.init();
    
    // Set up periodic cleanup for presence data
    setInterval(() => {
      userPresence.cleanup();
    }, 30000); // Every 30 seconds
    
    // Handle mobile orientation changes and window resizing
    window.addEventListener('resize', () => {
      // Update all presence indicators for new screen size
      setTimeout(() => {
        document.querySelectorAll('.user-presence-indicator').forEach(indicator => {
          const isMobile = window.innerWidth <= 768;
          const size = isMobile ? '20px' : '16px';
          const offset = isMobile ? '-10px' : '-8px';
          const border = isMobile ? '3px solid white' : '2px solid white';
          
          // Apply all sizing constraints to prevent oval stretching
          indicator.style.width = size;
          indicator.style.height = size;
          indicator.style.minWidth = size;
          indicator.style.minHeight = size;
          indicator.style.maxWidth = size;
          indicator.style.maxHeight = size;
          indicator.style.top = offset;
          indicator.style.right = offset;
          indicator.style.border = border;
          indicator.style.borderRadius = '50%';
          indicator.style.flexShrink = '0';
          indicator.style.boxSizing = 'border-box';
          indicator.style.display = 'block';
          
          if (isMobile) {
            indicator.classList.add('mobile-indicator');
          } else {
            indicator.classList.remove('mobile-indicator');
          }
        });
        
        // Update enhanced typing indicators for new screen size
        document.querySelectorAll('.enhanced-typing-indicator').forEach(indicator => {
          const isMobile = window.innerWidth <= 768;
          const avatarSize = isMobile ? '24px' : '20px';
          const fontSize = isMobile ? '12px' : '11px';
          const padding = isMobile ? '6px 10px' : '4px 8px';
          const topOffset = isMobile ? '-40px' : '-35px';
          const maxWidth = isMobile ? '200px' : '250px';
          
          // Update container styles
          indicator.style.top = topOffset;
          indicator.style.padding = padding;
          indicator.style.fontSize = fontSize;
          indicator.style.maxWidth = maxWidth;
          
          // Update avatar
          const avatar = indicator.querySelector('.editor-avatar');
          if (avatar) {
            avatar.style.width = avatarSize;
            avatar.style.height = avatarSize;
            avatar.style.fontSize = fontSize;
          }
          
          // Update name
          const name = indicator.querySelector('.editor-name');
          if (name) {
            name.style.fontSize = fontSize;
            if (isMobile) {
              name.style.maxWidth = '120px';
              name.style.overflow = 'hidden';
              name.style.textOverflow = 'ellipsis';
            } else {
              name.style.maxWidth = 'none';
              name.style.overflow = 'visible';
              name.style.textOverflow = 'initial';
            }
          }
          
          if (isMobile) {
            indicator.classList.add('mobile-typing-indicator');
          } else {
            indicator.classList.remove('mobile-typing-indicator');
          }
        });
        
        // Update any visible merge notifications
        document.querySelectorAll('.merge-notification').forEach(notification => {
          const isMobile = window.innerWidth <= 768;
          if (isMobile) {
            notification.style.position = 'fixed';
            notification.style.top = '10px';
            notification.style.left = '20px';
            notification.style.right = '20px';
            notification.style.width = 'auto';
          }
        });
      }, 100); // Small delay to let layout settle
    });
    
    console.log('✅ [PHASE2] Advanced collaboration features initialized successfully (with mobile support)');
  } catch (error) {
    console.error('❌ [PHASE2] Error initializing collaboration features:', error);
  }
}

// =============================================================================
// TABLE VIEW FUNCTIONALITY (Desktop Only)
// =============================================================================

let currentView = 'table'; // Default to table view
const SCHEDULE_VIEW_KEY = 'schedule_view_preference';

// Initialize view on page load
function initializeScheduleView() {
  // Only for desktop
  if (window.innerWidth <= 768) {
    currentView = 'cards';
    console.log('[TABLE VIEW] Mobile detected - using card view');
    // Ensure card container is visible on mobile
    const cardContainer = document.getElementById('programSections');
    const tableContainer = document.getElementById('scheduleTableView');
    if (cardContainer) {
      cardContainer.classList.remove('hidden');
      cardContainer.style.display = ''; // Restore flex layout
    }
    if (tableContainer) {
      tableContainer.classList.remove('active');
    }
    return;
  }
  
  // Load saved preference or default to table
  const savedView = localStorage.getItem(SCHEDULE_VIEW_KEY);
  currentView = savedView || 'table';
  
  console.log(`[TABLE VIEW] Initialized with view: ${currentView}`);
  applyScheduleView();
}

// Toggle between card and table view
window.toggleScheduleView = function() {
  // Only works on desktop
  if (window.innerWidth <= 768) {
    console.log('[TABLE VIEW] Toggle disabled on mobile');
    return;
  }
  
  currentView = currentView === 'cards' ? 'table' : 'cards';
  localStorage.setItem(SCHEDULE_VIEW_KEY, currentView);
  
  console.log(`[TABLE VIEW] Switched to ${currentView} view`);
  applyScheduleView();
};

// Apply the current view
function applyScheduleView() {
  const cardContainer = document.getElementById('programSections');
  const tableContainer = document.getElementById('scheduleTableView');
  const toggleBtn = document.getElementById('viewToggleBtn');
  const toggleText = document.getElementById('viewToggleText');
  const toggleIcon = toggleBtn?.querySelector('.material-symbols-outlined');
  
  if (!cardContainer || !tableContainer) {
    console.warn('[TABLE VIEW] Containers not found');
    return;
  }
  
  if (currentView === 'table') {
    // Show table view, hide cards
    cardContainer.classList.add('hidden');
    cardContainer.style.display = 'none';
    tableContainer.classList.add('active');
    // Button shows what you'll SWITCH TO (cards), not current view
    if (toggleText) toggleText.textContent = 'Card View';
    if (toggleIcon) toggleIcon.textContent = 'view_module';
    
    // Render table
    renderScheduleTable();
  } else {
    // Show card view, hide table
    cardContainer.classList.remove('hidden');
    cardContainer.style.display = ''; // Remove inline style to restore CSS flex display
    tableContainer.classList.remove('active');
    // Button shows what you'll SWITCH TO (table), not current view
    if (toggleText) toggleText.textContent = 'Table View';
    if (toggleIcon) toggleIcon.textContent = 'table_chart';
  }
}

// Render schedule as table
function renderScheduleTable() {
  const tableContainer = document.getElementById('scheduleTableView');
  if (!tableContainer) return;
  
  console.log('[TABLE VIEW] Rendering schedule table, isOwner:', isOwner);
  
  tableContainer.innerHTML = '';
  
  if (!tableData || !tableData.programs || tableData.programs.length === 0) {
    tableContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#777;">No programs yet. Add a new date to get started.</div>';
    return;
  }
  
  // Group by dates
  const dates = [...new Set(tableData.programs.map(p => p.date))].sort((a, b) => a.localeCompare(b));
  
  dates.forEach(date => {
    const matchingPrograms = tableData.programs
      .map((p, i) => ({ ...p, __index: i }))
      .filter(p => p.date === date && matchesSearch(p))
      .sort((a, b) => {
        const aHasTime = a.startTime && a.startTime.trim() !== '';
        const bHasTime = b.startTime && b.startTime.trim() !== '';
        
        if (aHasTime && bHasTime) {
          const startCmp = a.startTime.localeCompare(b.startTime);
          if (startCmp !== 0) return startCmp;
          
          // Same start time: sort by end time (shorter duration first)
          const aHasEnd = a.endTime && a.endTime.trim() !== '';
          const bHasEnd = b.endTime && b.endTime.trim() !== '';
          if (aHasEnd && bHasEnd) return a.endTime.localeCompare(b.endTime);
          if (aHasEnd && !bHasEnd) return -1;
          if (!aHasEnd && bHasEnd) return 1;
          return a.__index - b.__index;
        }
        if (aHasTime && !bHasTime) return -1;
        if (!aHasTime && bHasTime) return 1;
        return a.__index - b.__index;
      });
    
    if (matchingPrograms.length === 0) return;
    
    const section = document.createElement('div');
    section.className = 'schedule-table-section';
    section.setAttribute('data-date', date);
    
    const dateHeader = document.createElement('div');
    dateHeader.className = 'date-header';
    dateHeader.innerHTML = `
      <div>${formatDate(date)}</div>
      ${isOwner ? `<button class="date-action-btn" data-date="${date}" title="More options"><span class="material-symbols-outlined">more_horiz</span></button>` : ''}
    `;
    section.appendChild(dateHeader);
    
    // Add date action menu handler
    if (isOwner) {
      const dateActionBtn = dateHeader.querySelector('.date-action-btn');
      if (dateActionBtn) {
        dateActionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showScheduleDateActionMenu(date, e.currentTarget);
        });
      }
    }
    
    const table = document.createElement('table');
    
    // Table header
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
        ${isOwner ? '<th></th>' : ''}
      </tr>
    `;
    table.appendChild(thead);
    
    // Table body
    const tbody = document.createElement('tbody');
    matchingPrograms.forEach(program => {
      const row = document.createElement('tr');
      row.className = (program.done ? 'done-row' : '') + (program.important ? ' important-row' : '');
      row.setAttribute('data-program-index', program.__index);
      
      const programId = program._id || program._tempId;
      if (programId) {
        row.setAttribute('data-program-id', programId);
      }
      
      row.innerHTML = `
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="startTime">
          <span class="cell-display">${formatTo12Hour(program.startTime || '')}</span>
        </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="endTime">
          <span class="cell-display">${formatTo12Hour(program.endTime || '')}</span>
        </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="name">
          <span class="cell-display">${program.name || ''}</span>
        </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="location">
          <span class="cell-display">${program.location || ''}</span>
        </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="photographer">
          <span class="cell-display">${program.photographer || ''}</span>
        </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="notes">
          <span class="cell-display">${program.notes || ''}</span>
        </td>
        <td class="editable-cell ${isOwner ? 'owner-editable' : ''}" data-field="folder">
          <span class="cell-display folder-cell">${program.folder || ''}</span>
        </td>
        <td class="done-checkbox-cell">
          <input type="checkbox" class="done-checkbox"
            data-field="done"
            data-original-value="${program.done ? 'true' : 'false'}"
            ${program.done ? 'checked' : ''}
            ${isOwner ? `onchange="toggleDone(this, ${program.__index})"` : 'disabled'}>
        </td>
        ${isOwner ? `
          <td class="action-cell">
            <button class="row-action-btn" data-program-index="${program.__index}" title="More options">
              <span class="material-symbols-outlined">more_horiz</span>
            </button>
          </td>
        ` : ''}
      `;
      
      tbody.appendChild(row);
      
      // Add inline editing for owners
      if (isOwner) {
        row.querySelectorAll('.owner-editable').forEach(cell => {
          cell.addEventListener('click', () => makeTableCellEditable(cell, program));
        });
        
        // Add row action menu handler
        const actionBtn = row.querySelector('.row-action-btn');
        if (actionBtn) {
          actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showScheduleRowActionMenu(program.__index, e.currentTarget);
          });
        }
      }
    });
    
    table.appendChild(tbody);
    section.appendChild(table);
    
    // Add row button
    if (isOwner) {
      const addRowBtn = document.createElement('button');
      addRowBtn.className = 'add-row-btn';
      addRowBtn.innerHTML = '<span class="material-symbols-outlined">add</span> Add Row';
      addRowBtn.onclick = () => addProgram(date);
      section.appendChild(addRowBtn);
    }
    
    tableContainer.appendChild(section);
  });
  
  console.log('[TABLE VIEW] Table rendered successfully');
}

// Make table cell editable (inline editing)
function makeTableCellEditable(cell, program) {
  if (cell.classList.contains('editing')) return;
  
  const field = cell.getAttribute('data-field');
  const displaySpan = cell.querySelector('.cell-display');
  if (!displaySpan) return;
  
  // Read from the live tableData instead of the stale program copy
  // so that re-clicking a cell after editing shows the updated value
  const programIndex = parseInt(cell.closest('tr').getAttribute('data-program-index'));
  const liveProgram = tableData.programs[programIndex] || program;
  const currentValue = liveProgram[field] || '';
  
  cell.classList.add('editing');
  
  let inputElement;
  if (field === 'startTime' || field === 'endTime') {
    inputElement = document.createElement('input');
    inputElement.type = 'time';
    inputElement.value = currentValue;
  } else if (field === 'notes' || field === 'location') {
    inputElement = document.createElement('textarea');
    inputElement.value = currentValue;
    inputElement.rows = 2;
  } else if (field === 'folder') {
    inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.value = currentValue;
    inputElement.maxLength = 7; // Set max length to 7 characters for folder
  } else {
    inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.value = currentValue;
  }
  
  inputElement.className = 'inline-edit-input';
  
  // --- Auto-suggest dropdown for photographer field ---
  let suggestDropdown = null;
  let suppressBlur = false; // Flag to prevent blur when clicking a suggestion
  
  if (field === 'photographer' && cachedScheduleUsers.length > 0) {
    // Create the suggestion dropdown container
    suggestDropdown = document.createElement('div');
    suggestDropdown.className = 'photographer-suggest-dropdown';
    cell.appendChild(suggestDropdown);
    
    // Helper: get the token currently being typed (text after last comma)
    function getCurrentToken(value) {
      const parts = value.split(',');
      return (parts[parts.length - 1] || '').trim();
    }
    
    // Helper: get all tokens before the current one (text before last comma)
    function getPrefixTokens(value) {
      const parts = value.split(',');
      if (parts.length <= 1) return '';
      const prefix = parts.slice(0, -1).map(t => t.trim()).filter(Boolean).join(', ');
      return prefix;
    }
    
    // Helper: build final value by replacing the current token with a selected name
    function buildValueWithSelection(currentInput, selectedName) {
      const prefix = getPrefixTokens(currentInput);
      if (prefix) {
        return prefix + ', ' + selectedName;
      }
      return selectedName;
    }
    
    // Show/update suggestions based on current input
    function updateSuggestions() {
      const token = getCurrentToken(inputElement.value).toLowerCase();
      suggestDropdown.innerHTML = '';
      
      if (!token) {
        suggestDropdown.style.display = 'none';
        return;
      }
      
      // Get names already entered (to avoid suggesting duplicates)
      const existingNames = inputElement.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      // Don't include the current token in the "existing" list
      existingNames.pop();
      
      const matches = cachedScheduleUsers.filter(name => {
        const lowerName = name.toLowerCase();
        return lowerName.startsWith(token) && !existingNames.includes(lowerName);
      });
      
      if (matches.length === 0) {
        suggestDropdown.style.display = 'none';
        return;
      }
      
      matches.forEach(name => {
        const item = document.createElement('div');
        item.className = 'photographer-suggest-item';
        item.textContent = name;
        
        // Use mousedown instead of click so it fires before blur
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Prevent focus loss
          suppressBlur = true;
          inputElement.value = buildValueWithSelection(inputElement.value, name);
          suggestDropdown.style.display = 'none';
          inputElement.focus();
          // Reset suppressBlur after a tick
          setTimeout(() => { suppressBlur = false; }, 0);
        });
        
        suggestDropdown.appendChild(item);
      });
      
      suggestDropdown.style.display = 'block';
    }
    
    // Update suggestions as user types
    inputElement.addEventListener('input', updateSuggestions);
    
    // Show suggestions on focus if there's already a token being typed
    inputElement.addEventListener('focus', () => {
      setTimeout(updateSuggestions, 0);
    });
  }
  
  // --- Save on blur ---
  inputElement.addEventListener('blur', () => {
    // If the user clicked a suggestion, don't blur yet
    if (suppressBlur) return;
    
    // Clean up the suggest dropdown
    if (suggestDropdown) {
      suggestDropdown.remove();
      suggestDropdown = null;
    }
    
    // Clean up trailing commas and extra spaces for photographer field
    let newValue = inputElement.value;
    if (field === 'photographer') {
      newValue = newValue.split(',').map(t => t.trim()).filter(Boolean).join(', ');
    }
    
    if (newValue !== currentValue) {
      // Update the program in the live data
      const wasChanged = safeUpdateProgram(programIndex, field, newValue);
      if (wasChanged) {
        // Use atomic save if program has ID
        const liveProgramId = tableData.programs[programIndex] && tableData.programs[programIndex]._id;
        if (liveProgramId) {
          atomicSaveField(inputElement, field, liveProgramId, newValue, currentValue)
            .then(() => console.log(`[TABLE VIEW] Saved ${field} for program ${programIndex}`))
            .catch(err => {
              console.error(`[TABLE VIEW] Failed to save ${field}:`, err);
              alert('Failed to save changes. Please try again.');
            });
        } else {
          scheduleSave();
        }
      }
    }
    
    // Restore display
    displaySpan.textContent = field === 'startTime' || field === 'endTime' ? formatTo12Hour(newValue) : newValue;
    cell.classList.remove('editing');
    displaySpan.style.display = 'block';
    inputElement.remove();
  });
  
  // Save on Enter (except for textarea)
  if (inputElement.tagName !== 'TEXTAREA') {
    inputElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (suggestDropdown) {
          suggestDropdown.style.display = 'none';
        }
        inputElement.blur();
      }
      if (e.key === 'Escape') {
        if (suggestDropdown) {
          suggestDropdown.style.display = 'none';
        }
      }
    });
  }
  
  // Replace display with input
  displaySpan.style.display = 'none';
  cell.appendChild(inputElement);
  inputElement.focus();
}

// Helper: Format time to 12-hour format
function formatTo12Hour(timeStr) {
  if (!timeStr) return '';
  const [hour, minute] = timeStr.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute)) return timeStr;
  
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const adjustedHour = hour % 12 || 12;
  return `${adjustedHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

// Override renderProgramSections to also update table view
const originalRenderProgramSections = renderProgramSections;
let hasInitializedView = false;
renderProgramSections = function(hasScheduleAccess) {
  originalRenderProgramSections.call(this, hasScheduleAccess);
  
  // Initialize view on first render if not already done
  if (!hasInitializedView && window.innerWidth > 768) {
    hasInitializedView = true;
    console.log('[TABLE VIEW] First render detected, initializing view');
    setTimeout(() => {
      initializeScheduleView();
    }, 200);
  }
  
  // Update table view if it's active
  if (currentView === 'table' && window.innerWidth > 768) {
    setTimeout(() => renderScheduleTable(), 100);
  }
};

// Initialize view when page loads - multiple triggers to ensure it works
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[TABLE VIEW] DOMContentLoaded triggered');
    setTimeout(initializeScheduleView, 100);
  });
} else {
  // DOM already loaded
  console.log('[TABLE VIEW] DOM already loaded, initializing immediately');
  setTimeout(initializeScheduleView, 100);
}

// Also try after window load as backup
window.addEventListener('load', () => {
  console.log('[TABLE VIEW] Window load triggered');
  // Only initialize if not already done
  if (!document.getElementById('scheduleTableView')?.classList.contains('active') && 
      !document.getElementById('programSections')?.style.display) {
    setTimeout(initializeScheduleView, 100);
  }
});

// Re-check view on window resize
window.addEventListener('resize', () => {
  if (window.innerWidth <= 768) {
    // Force card view on mobile
    const cardContainer = document.getElementById('programSections');
    const tableContainer = document.getElementById('scheduleTableView');
    if (cardContainer) {
      cardContainer.classList.remove('hidden');
      cardContainer.style.display = ''; // Restore flex layout
    }
    if (tableContainer) tableContainer.classList.remove('active');
  } else {
    // Restore saved view on desktop
    applyScheduleView();
  }
});

console.log('✅ [TABLE VIEW] Table view functionality loaded');

// ============================================
// DARK THEME SUPPORT
// ============================================

// Check if page is in dark theme mode
function isDarkThemeSchedule() {
  const schedulePage = document.querySelector('.schedule-page.dark-theme');
  return !!schedulePage;
}

// Track selected items for dropdown menus
let selectedProgramIndex = null;
let selectedScheduleDate = null;

// Initialize dark theme elements
function initDarkThemeSchedule() {
  console.log('🌙 Initializing dark theme schedule');
  
  // Load sidebar user info
  loadScheduleSidebarUser();
  
  // Setup dark theme event listeners
  setupDarkThemeListeners();
  
  // Setup action menu handlers
  setupScheduleActionMenuHandlers();
  
  // Create custom date dropdown
  createScheduleDateDropdown();
}

// Load user info in sidebar (matching crew/general page structure)
async function loadScheduleSidebarUser() {
  const nameEl = document.getElementById('sidebarUserName');
  const avatarImg = document.getElementById('sidebarAvatarImg');
  const avatarIcon = document.getElementById('sidebarAvatarIcon');
  
  try {
    let userName = localStorage.getItem('fullName');
    
    if (!userName) {
      const tokenStr = localStorage.getItem('token');
      if (tokenStr) {
        const payload = JSON.parse(atob(tokenStr.split('.')[1]));
        userName = payload.fullName || payload.name || payload.email || 'User';
      }
    }
    
    if (nameEl && userName) nameEl.textContent = userName;
    
    // Try to fetch user photo
    try {
      const tokenStr = localStorage.getItem('token');
      if (tokenStr) {
        const payload = JSON.parse(atob(tokenStr.split('.')[1]));
        const userId = payload.userId || payload.id || payload.sub;
        if (userId) {
          const res = await fetch(`${API_BASE}/api/users/${userId}`, {
            headers: { Authorization: tokenStr }
          });
          if (res.ok) {
            const user = await res.json();
            if (user.avatar && avatarImg && avatarIcon) {
              avatarImg.src = user.avatar;
              avatarImg.style.display = 'block';
              avatarIcon.style.display = 'none';
            }
          }
        }
      }
    } catch (photoErr) {
      console.log('Could not load user photo:', photoErr);
    }
  } catch (err) {
    console.error('Failed to load user:', err);
  }
}

// Setup dark theme event listeners
function setupDarkThemeListeners() {
  // Add Date button in header
  const addDateBtnHeader = document.getElementById('addDateBtnHeader');
  if (addDateBtnHeader) {
    addDateBtnHeader.onclick = () => addDateDarkTheme();
  }
  
  // Mobile menu toggle (uses general-sidebar class like crew/general pages)
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('scheduleSidebar');
  const overlay = document.getElementById('scheduleSidebarOverlay');
  
  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.onclick = () => {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('show');
    };
  }
  
  if (overlay) {
    overlay.onclick = () => {
      if (sidebar) sidebar.classList.remove('open');
      overlay.classList.remove('show');
    };
  }
  
  // Filter dropdown
  const filterDropdown = document.getElementById('filterDateDropdown');
  if (filterDropdown) {
    filterDropdown.onchange = (e) => {
      filterDate = e.target.value;
      renderProgramSections(isOwner);
    };
  }
  
  // Search input
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.oninput = handleSearchInput;
  }
  
  // Import/Export buttons are set up in initPage with cloneNode approach
  // to prevent duplicate event listener attachment - do not add here
}

// Setup action menu handlers for dark theme
function setupScheduleActionMenuHandlers() {
  // Duplicate program action
  const duplicateAction = document.getElementById('duplicateProgramAction');
  if (duplicateAction && !duplicateAction._listenerAttached) {
    duplicateAction._listenerAttached = true;
    duplicateAction.onclick = (e) => {
      e.stopPropagation();
      const idx = selectedProgramIndex;
      hideScheduleRowActionMenu();
      if (idx !== null) duplicateProgram(idx);
    };
  }
  
  // Delete program action
  const deleteAction = document.getElementById('deleteProgramAction');
  if (deleteAction && !deleteAction._listenerAttached) {
    deleteAction._listenerAttached = true;
    deleteAction.onclick = (e) => {
      e.stopPropagation();
      const idx = selectedProgramIndex;
      hideScheduleRowActionMenu();
      if (idx !== null) deleteProgramDarkTheme(idx);
    };
  }
  
  // Delete date action
  const deleteDateAction = document.getElementById('deleteDateAction');
  if (deleteDateAction && !deleteDateAction._listenerAttached) {
    deleteDateAction._listenerAttached = true;
    deleteDateAction.onclick = (e) => {
      e.stopPropagation();
      const date = selectedScheduleDate;
      hideScheduleDateActionMenu();
      if (date) deleteDate(date);
    };
  }
}

// Show row action menu
function showScheduleRowActionMenu(programIndex, button) {
  selectedProgramIndex = programIndex;
  
  const dropdown = document.getElementById('scheduleRowActionDropdown');
  if (!dropdown) {
    console.error('[SCHEDULE] Row action dropdown not found');
    return;
  }
  
  if (dropdown.classList.contains('show')) {
    hideScheduleRowActionMenu();
    return;
  }
  
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const dropdownWidth = 180; // Approximate width
  
  // Position dropdown - prevent going off right edge
  let left = rect.left;
  if (left + dropdownWidth > viewportWidth - 20) {
    left = rect.right - dropdownWidth;
  }
  
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${left}px`;
  dropdown.classList.add('show');
  
  console.log('[SCHEDULE] Showing row action menu for program index:', programIndex);
  
  setTimeout(() => {
    document.addEventListener('click', handleScheduleRowOutsideClick);
  }, 10);
}

function hideScheduleRowActionMenu() {
  const dropdown = document.getElementById('scheduleRowActionDropdown');
  if (dropdown) dropdown.classList.remove('show');
  selectedProgramIndex = null;
  document.removeEventListener('click', handleScheduleRowOutsideClick);
}

function handleScheduleRowOutsideClick(e) {
  const dropdown = document.getElementById('scheduleRowActionDropdown');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.row-action-btn')) {
    hideScheduleRowActionMenu();
  }
}

// Show date action menu
function showScheduleDateActionMenu(date, button) {
  selectedScheduleDate = date;
  
  const dropdown = document.getElementById('scheduleDateActionDropdown');
  if (!dropdown) {
    console.error('[SCHEDULE] Date action dropdown not found');
    return;
  }
  
  if (dropdown.classList.contains('show')) {
    hideScheduleDateActionMenu();
    return;
  }
  
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const dropdownWidth = 180; // Approximate width
  
  // Position dropdown - prevent going off right edge
  let left = rect.left;
  if (left + dropdownWidth > viewportWidth - 20) {
    left = rect.right - dropdownWidth;
  }
  
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${left}px`;
  dropdown.classList.add('show');
  
  console.log('[SCHEDULE] Showing date action menu for date:', date);
  
  setTimeout(() => {
    document.addEventListener('click', handleScheduleDateOutsideClick);
  }, 10);
}

function hideScheduleDateActionMenu() {
  const dropdown = document.getElementById('scheduleDateActionDropdown');
  if (dropdown) dropdown.classList.remove('show');
  selectedScheduleDate = null;
  document.removeEventListener('click', handleScheduleDateOutsideClick);
}

function handleScheduleDateOutsideClick(e) {
  const dropdown = document.getElementById('scheduleDateActionDropdown');
  if (dropdown && !dropdown.contains(e.target) && !e.target.closest('.date-action-btn')) {
    hideScheduleDateActionMenu();
  }
}

// Duplicate program (for dark theme)
async function duplicateProgram(programIndex) {
  const program = tableData.programs[programIndex];
  if (!program) return;
  
  try {
    const newProgram = {
      date: program.date,
      startTime: program.startTime,
      endTime: program.endTime,
      name: program.name + ' (Copy)',
      location: program.location,
      photographer: program.photographer,
      notes: program.notes,
      done: false
    };
    
    tableData.programs.push(newProgram);
    await savePrograms();
    renderProgramSections(isOwner);
    console.log('Program duplicated successfully');
  } catch (err) {
    console.error('Duplicate error:', err);
  }
}

// Delete program from dark theme (wrapper for safeDeleteProgram)
function deleteProgramDarkTheme(programIndex) {
  safeDeleteProgram(programIndex);
}

// Add date with modal for dark theme
async function addDateDarkTheme() {
  const date = await showScheduleDatePickerModal();
  if (!date) return; // User cancelled
  
  // Check if date already exists
  const existingDate = tableData.programs.find(p => p.date === date);
  if (existingDate) {
    alert('This date already exists in the schedule.');
    return;
  }
  
  // Add empty program for this date
  tableData.programs.push({
    date,
    startTime: '',
    endTime: '',
    name: '',
    location: '',
    photographer: '',
    notes: '',
    done: false
  });
  
  renderProgramSections(isOwner);
  await savePrograms();
}

// Show date picker modal for schedule
function showScheduleDatePickerModal() {
  return new Promise((resolve) => {
    // Remove any existing modal
    const existingModal = document.querySelector('.date-picker-modal');
    if (existingModal) existingModal.remove();
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'date-picker-modal dark-theme-modal';
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    modal.innerHTML = `
      <div class="date-picker-content">
        <h3>
          <span class="material-symbols-outlined">event</span>
          Add New Date
        </h3>
        <input type="date" id="scheduleDatePickerInput" class="date-picker-input" value="${today}" />
        <div class="date-picker-buttons">
          <button class="date-picker-cancel-btn" id="scheduleDatePickerCancel">Cancel</button>
          <button class="date-picker-confirm-btn" id="scheduleDatePickerConfirm">Add Date</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const dateInput = document.getElementById('scheduleDatePickerInput');
    const cancelBtn = document.getElementById('scheduleDatePickerCancel');
    const confirmBtn = document.getElementById('scheduleDatePickerConfirm');
    
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

// Dark theme render function for CARD VIEW
function renderDarkThemeCardView(hasScheduleAccess) {
  const container = document.getElementById('programSections');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Update filter dropdown
  const filterDropdown = document.getElementById('filterDateDropdown');
  if (filterDropdown) {
    const allDates = [...new Set(tableData.programs.map(p => p.date))].sort();
    const currentSelection = filterDate || 'all';
    filterDropdown.innerHTML = `<option value="all">All Dates</option>`;
    allDates.forEach(date => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = formatDate(date);
      filterDropdown.appendChild(option);
    });
    filterDropdown.value = currentSelection;
    
    // Update custom dropdown if it exists
    if (typeof updateScheduleDateDropdown === 'function') {
      updateScheduleDateDropdown();
    }
  }
  
  // Update date range display
  const dates = [...new Set(tableData.programs.map(p => p.date))].filter(d => d).sort();
  if (dates.length > 0) {
    const fromEl = document.getElementById('dateRangeFrom');
    const toEl = document.getElementById('dateRangeTo');
    if (fromEl) fromEl.textContent = formatDate(dates[0]);
    if (toEl) toEl.textContent = formatDate(dates[dates.length - 1]);
  }
  
  if (tableData.programs.length === 0) {
    container.innerHTML = `
      <div class="schedule-empty-state">
        <span class="material-symbols-outlined">calendar_month</span>
        <h3>No Programs Yet</h3>
        <p>Add a new date to get started with your schedule.</p>
        <button class="btn-primary" onclick="addDateDarkTheme()">
          <span class="material-symbols-outlined">add</span>
          Add Date
        </button>
      </div>
    `;
    return;
  }
  
  const filteredDates = filterDate === 'all' ? dates : dates.filter(d => d === filterDate);
  
  filteredDates.forEach(date => {
    const matchingPrograms = tableData.programs
      .map((p, i) => ({ ...p, __index: i }))
      .filter(p => p.date === date && matchesSearch(p))
      .sort((a, b) => {
        const aHasTime = a.startTime && a.startTime.trim() !== '';
        const bHasTime = b.startTime && b.startTime.trim() !== '';
        if (aHasTime && bHasTime) return a.startTime.localeCompare(b.startTime);
        if (aHasTime) return -1;
        if (bHasTime) return 1;
        return a.__index - b.__index;
      });
    
    if (matchingPrograms.length === 0) return;
    
    // Create date section (card style)
    const section = document.createElement('div');
    section.className = 'date-section';
    section.setAttribute('data-date', date);
    
    // Section header
    const header = document.createElement('div');
    header.className = 'date-header';
    header.innerHTML = `
      <div class="date-title">${formatDate(date)}</div>
      ${hasScheduleAccess ? `
        <button class="delete-date-btn" onclick="deleteDate('${date}')">
          <span class="material-symbols-outlined">delete</span>
        </button>
      ` : ''}
    `;
    section.appendChild(header);
    
    // Create program entry cards
    matchingPrograms.forEach(program => {
      const entry = document.createElement('div');
      entry.className = 'program-entry' + (program.done ? ' done-entry' : '') + (program.important ? ' important-entry' : '');
      entry.setAttribute('data-program-index', program.__index);
      
      const programId = program._id || program._tempId;
      if (programId) {
        entry.setAttribute('data-program-id', programId);
      }
      
      entry.innerHTML = `
        <div class="entry-top-row">
          <div class="entry-times">
            <label class="time-field">
              <input type="time" class="time-input-native" placeholder="Start"
                data-field="startTime"
                value="${program.startTime || ''}"
                ${!hasScheduleAccess ? 'readonly' : ''}
                onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
                oninput="syncTimeDisplay(this)"
                onblur="${hasScheduleAccess ? `syncTimeDisplay(this); autoSave(this, '${program.date}', ${program.__index}, 'startTime')` : ''}">
              <span class="time-display">${formatTo12Hour(program.startTime) || '--:-- --'}</span>
              <span class="material-symbols-outlined time-icon">schedule</span>
            </label>
            <label class="time-field">
              <input type="time" class="time-input-native" placeholder="End"
                data-field="endTime"
                value="${program.endTime || ''}"
                ${!hasScheduleAccess ? 'readonly' : ''}
                onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
                oninput="syncTimeDisplay(this)"
                onblur="${hasScheduleAccess ? `syncTimeDisplay(this); autoSave(this, '${program.date}', ${program.__index}, 'endTime')` : ''}">
              <span class="time-display">${formatTo12Hour(program.endTime) || '--:-- --'}</span>
              <span class="material-symbols-outlined time-icon">schedule</span>
            </label>
            ${program.folder ? `<div class="folder-field-container">
              <span class="material-symbols-outlined folder-icon">folder</span>
              <input type="text"
                data-field="folder"
                class="folder-input"
                placeholder="Folder"
                maxlength="7"
                ${!hasScheduleAccess ? 'readonly' : ''}
                value="${program.folder || ''}"
                onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
                onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'folder')` : ''}">
            </div>` : ''}
          </div>
          <label class="entry-done">
            <input type="checkbox" class="done-checkbox"
              data-field="done"
              data-original-value="${program.done ? 'true' : 'false'}"
              ${program.done ? 'checked' : ''}
              ${hasScheduleAccess ? `onchange="toggleDone(this, ${program.__index})"` : 'disabled'}>
          </label>
        </div>
        <div>
          <input class="program-name" type="text"
            data-field="name"
            ${!hasScheduleAccess ? 'readonly' : ''}
            placeholder="Program Name"
            value="${program.name || ''}" 
            onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}" 
            onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'name')` : ''}">
        </div>
        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <div style="flex: 1; display: flex; align-items: center; gap: 4px;">
            <span class="material-symbols-outlined" style="font-size: 16px; color: var(--text-muted);">location_on</span>
            <input type="text"
              data-field="location"
              placeholder="Location"
              value="${program.location || ''}"
              ${!hasScheduleAccess ? 'readonly' : ''}
              onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
              onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'location')` : ''}">
          </div>
          <div style="flex: 1; display: flex; align-items: center; gap: 4px;">
            <span class="material-symbols-outlined" style="font-size: 16px; color: var(--text-muted);">photo_camera</span>
            <input type="text"
              data-field="photographer"
              placeholder="Photographer"
              value="${program.photographer || ''}"
              ${!hasScheduleAccess ? 'readonly' : ''}
              onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
              onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'photographer')` : ''}">
          </div>
        </div>
        <div class="entry-actions">
          <button class="show-notes-btn" onclick="toggleNotes(this)">Show Notes</button>
          ${hasScheduleAccess ? `<button class="delete-btn" onclick="deleteProgram(this)"><span class="material-symbols-outlined">delete</span></button>` : ''}
        </div>
        <div class="notes-field" style="display: none;">
          <textarea
            data-field="notes"
            placeholder="Notes"
            ${!hasScheduleAccess ? 'readonly' : ''}
            onfocus="${hasScheduleAccess ? 'enableEdit(this)' : ''}"
            onblur="${hasScheduleAccess ? `autoSave(this, '${program.date}', ${program.__index}, 'notes')` : ''}">${program.notes || ''}</textarea>
        </div>
      `;
      
      section.appendChild(entry);
    });
    
    // Add program button
    if (hasScheduleAccess) {
      const addBtn = document.createElement('button');
      addBtn.className = 'add-btn';
      addBtn.textContent = '+ Add Row';
      addBtn.onclick = () => addProgram(date);
      section.appendChild(addBtn);
    }
    
    container.appendChild(section);
  });
}

// Format time for display (convert 24h to 12h)
function formatTimeDisplay(time) {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

// Make cell editable in dark theme table
function makeScheduleCellEditable(cell, program, date) {
  if (cell.classList.contains('editing')) return;
  
  const field = cell.getAttribute('data-field');
  const displaySpan = cell.querySelector('.cell-display');
  const currentValue = tableData.programs[program.__index][field] || '';
  
  cell.classList.add('editing');
  displaySpan.style.display = 'none';
  
  let input;
  if (field === 'startTime' || field === 'endTime') {
    input = document.createElement('input');
    input.type = 'time';
    input.value = currentValue;
  } else if (field === 'notes') {
    input = document.createElement('textarea');
    input.value = currentValue;
    input.rows = 2;
  } else {
    input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
  }
  
  input.className = 'inline-edit-input';
  cell.appendChild(input);
  input.focus();
  
  const saveAndExit = async () => {
    const newValue = input.value;
    if (newValue !== currentValue) {
      tableData.programs[program.__index][field] = newValue;
      await autoSave(input, date, program.__index, field);
    }
    
    input.remove();
    displaySpan.style.display = '';
    if (field === 'startTime' || field === 'endTime') {
      displaySpan.textContent = formatTimeDisplay(newValue) || '--';
    } else {
      displaySpan.textContent = newValue || (field === 'notes' ? '' : 'Click to add');
    }
    cell.classList.remove('editing');
  };
  
  input.addEventListener('blur', saveAndExit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && field !== 'notes') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      input.value = currentValue;
      input.blur();
    }
  });
}

// Create custom dropdown for date filter (dark theme)
function createScheduleDateDropdown() {
  const selectEl = document.getElementById('filterDateDropdown');
  if (!selectEl) return;
  
  // Check if already replaced
  if (selectEl.classList.contains('hidden-native-select')) return;
  
  // Get options from select
  const options = Array.from(selectEl.options).map(opt => ({
    value: opt.value,
    label: opt.textContent
  }));
  
  // Hide native select
  selectEl.classList.add('hidden-native-select');
  selectEl.style.display = 'none';
  
  // Create custom dropdown container
  const container = document.createElement('div');
  container.className = 'custom-dropdown schedule-date-dropdown';
  container.id = 'scheduleDateDropdownContainer';
  
  // Create trigger button
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-dropdown-trigger';
  const currentOption = options.find(opt => opt.value === filterDate) || options[0];
  trigger.innerHTML = `
    <span class="dropdown-value">${currentOption?.label || 'All Dates'}</span>
    <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
  `;
  
  // Create dropdown menu
  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu schedule-date-menu';
  
  // Create options container
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'custom-dropdown-options';
  
  // Render options
  function renderOptions() {
    optionsContainer.innerHTML = options.map(opt => `
      <button type="button" class="custom-dropdown-option ${opt.value === filterDate ? 'selected' : ''}" data-value="${opt.value}">
        ${opt.label}
      </button>
    `).join('');
  }
  
  renderOptions();
  menu.appendChild(optionsContainer);
  container.appendChild(trigger);
  container.appendChild(menu);
  
  // Insert after the hidden select
  selectEl.parentNode.insertBefore(container, selectEl.nextSibling);
  
  // Track open state
  let isOpen = false;
  
  // Open dropdown function
  function openDropdown() {
    if (isOpen) return;
    isOpen = true;
    container.classList.add('open');
    
    // Position the menu
    const triggerRect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - triggerRect.bottom - 20;
    const spaceAbove = triggerRect.top - 20;
    
    menu.style.position = 'fixed';
    menu.style.left = `${triggerRect.left}px`;
    menu.style.width = `${Math.max(triggerRect.width, 200)}px`;
    
    // Decide whether to open above or below
    const menuHeight = Math.min(300, options.length * 40 + 20);
    if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
      menu.style.top = `${triggerRect.bottom + 4}px`;
      menu.style.bottom = 'auto';
      menu.style.maxHeight = `${Math.min(spaceBelow, 300)}px`;
    } else {
      menu.style.bottom = `${viewportHeight - triggerRect.top + 4}px`;
      menu.style.top = 'auto';
      menu.style.maxHeight = `${Math.min(spaceAbove, 300)}px`;
    }
    
    // Close when clicking outside
    setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 10);
  }
  
  // Close dropdown function
  function closeDropdown() {
    if (!isOpen) return;
    isOpen = false;
    container.classList.remove('open');
    document.removeEventListener('click', handleOutsideClick);
  }
  
  // Handle outside clicks
  function handleOutsideClick(e) {
    if (!container.contains(e.target)) {
      closeDropdown();
    }
  }
  
  // Toggle on trigger click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });
  
  // Handle option selection
  optionsContainer.addEventListener('click', (e) => {
    const option = e.target.closest('.custom-dropdown-option');
    if (!option) return;
    
    const value = option.dataset.value;
    
    // Update native select
    selectEl.value = value;
    
    // Update global filter
    filterDate = value;
    
    // Update trigger display
    const selectedLabel = options.find(opt => opt.value === value)?.label || 'All Dates';
    trigger.querySelector('.dropdown-value').textContent = selectedLabel;
    
    // Update selected state
    optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(opt => {
      opt.classList.toggle('selected', opt.dataset.value === value);
    });
    
    // Close and re-render
    closeDropdown();
    renderProgramSections(isOwner);
    saveFilterSettings();
  });
  
  return container;
}

// Update custom dropdown options (called when dates change)
function updateScheduleDateDropdown() {
  const container = document.getElementById('scheduleDateDropdownContainer');
  if (!container) return;
  
  const selectEl = document.getElementById('filterDateDropdown');
  if (!selectEl) return;
  
  // Get updated options
  const options = Array.from(selectEl.options).map(opt => ({
    value: opt.value,
    label: opt.textContent
  }));
  
  // Update trigger
  const trigger = container.querySelector('.custom-dropdown-trigger');
  const currentOption = options.find(opt => opt.value === filterDate) || options[0];
  if (trigger) {
    trigger.querySelector('.dropdown-value').textContent = currentOption?.label || 'All Dates';
  }
  
  // Update options
  const optionsContainer = container.querySelector('.custom-dropdown-options');
  if (optionsContainer) {
    optionsContainer.innerHTML = options.map(opt => `
      <button type="button" class="custom-dropdown-option ${opt.value === filterDate ? 'selected' : ''}" data-value="${opt.value}">
        ${opt.label}
      </button>
    `).join('');
  }
}

// Expose functions globally
window.showScheduleRowActionMenu = showScheduleRowActionMenu;
window.hideScheduleRowActionMenu = hideScheduleRowActionMenu;
window.showScheduleDateActionMenu = showScheduleDateActionMenu;
window.hideScheduleDateActionMenu = hideScheduleDateActionMenu;
window.duplicateProgram = duplicateProgram;
window.deleteProgramDarkTheme = deleteProgramDarkTheme;
window.addDateDarkTheme = addDateDarkTheme;
window.showScheduleDatePickerModal = showScheduleDatePickerModal;
window.initDarkThemeSchedule = initDarkThemeSchedule;
window.renderDarkThemeCardView = renderDarkThemeCardView;
window.createScheduleDateDropdown = createScheduleDateDropdown;
window.updateScheduleDateDropdown = updateScheduleDateDropdown;
window.openAutoAssignPreview = openAutoAssignPreview;

let autoAssignProposal = null;
let autoAssignUndoSnapshot = null;

function autoAssignAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': localStorage.getItem('token')
  };
}

function setupAutoAssignControls() {
  const openBtn = document.getElementById('autoAssignBtn');
  if (openBtn) {
    const fresh = openBtn.cloneNode(true);
    openBtn.parentNode.replaceChild(fresh, openBtn);
    fresh.addEventListener('click', openAutoAssignPreview);
  }
  const closeBtn = document.getElementById('autoAssignCloseBtn');
  const cancelBtn = document.getElementById('autoAssignCancelBtn');
  const applyBtn = document.getElementById('autoAssignApplyBtn');
  const undoBtn = document.getElementById('autoAssignUndoBtn');
  const body = document.getElementById('autoAssignModalBody');
  if (closeBtn) closeBtn.onclick = closeAutoAssignModal;
  if (cancelBtn) cancelBtn.onclick = closeAutoAssignModal;
  if (applyBtn) applyBtn.onclick = applyAutoAssignProposal;
  if (undoBtn) undoBtn.onclick = undoAutoAssign;
  if (body && !body.dataset.autoAssignBound) {
    body.dataset.autoAssignBound = '1';
    body.addEventListener('input', event => {
      const input = event.target.closest('.auto-assign-photo-input');
      if (!input) return;
      updateAutoAssignPhotographer(input.dataset.programId, input.value);
      const original = input.dataset.original || '';
      const edited = input.value.trim() !== original;
      input.classList.toggle('is-edited', edited);
      const badge = input.parentElement?.querySelector('.auto-assign-edited');
      if (badge) badge.hidden = !edited;
      const row = input.closest('tr');
      if (row) row.classList.toggle('is-unassigned', !input.value.trim());
      refreshAutoAssignSummary();
    });
    body.addEventListener('click', event => {
      const swapBtn = event.target.closest('[data-auto-assign-swap]');
      if (swapBtn) {
        const bar = swapBtn.closest('.auto-assign-swap-bar');
        const from = bar?.querySelector('[data-swap-from]')?.value;
        const to = bar?.querySelector('[data-swap-to]')?.value;
        swapAutoAssignPhotographers(from, to, swapBtn.dataset.date);
        return;
      }
      if (event.target.closest('[data-auto-assign-edit]')) {
        submitAutoAssignEdit();
      }
    });
    body.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      if (!event.target.closest('#autoAssignEditInput')) return;
      event.preventDefault();
      submitAutoAssignEdit();
    });
  }
}

function autoAssignTimeToMinutes(value) {
  if (value == null || value === '') return 9999;
  const raw = String(value).trim();
  const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)$/i);
  if (ampm) {
    let hours = parseInt(ampm[1], 10);
    const minutes = parseInt(ampm[2] || '0', 10);
    const suffix = ampm[3].toLowerCase();
    if (suffix === 'pm' && hours !== 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 9999;
  return parseInt(match[1], 10) * 60 + parseInt(match[2] || '0', 10);
}

function sortAutoAssignRowsByTime(rows) {
  return [...(rows || [])].sort((a, b) => {
    const byTime = autoAssignTimeToMinutes(a.startTime) - autoAssignTimeToMinutes(b.startTime);
    if (byTime) return byTime;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function updateAutoAssignPhotographer(programId, photographer) {
  if (!programId || !autoAssignProposal) return;
  for (const day of autoAssignProposal.days || []) {
    const row = (day.assignments || []).find(item => String(item.programId) === String(programId));
    if (!row) continue;
    if (row.originalPhotographer == null) row.originalPhotographer = row.photographer || '';
    row.photographer = String(photographer || '').trim();
    row.edited = row.photographer !== row.originalPhotographer;
    return;
  }
}

function syncAutoAssignEditsFromDom() {
  document.querySelectorAll('#autoAssignModal .auto-assign-photo-input').forEach(input => {
    updateAutoAssignPhotographer(input.dataset.programId, input.value);
  });
}

function splitAutoAssignNames(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean);
}

function autoAssignNamesMatch(left, right) {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const aFirst = a.split(/\s+/)[0];
  const bFirst = b.split(/\s+/)[0];
  return aFirst === b || bFirst === a || (aFirst === bFirst && (a.startsWith(b) || b.startsWith(a)));
}

function collectAutoAssignPhotographerNames(day) {
  const names = [];
  const seen = new Set();
  const add = name => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };
  for (const person of day?.workload || []) {
    add(person.name || person.fullName);
  }
  for (const row of day?.assignments || []) {
    splitAutoAssignNames(row.photographer).forEach(add);
  }
  const byFirst = new Map();
  for (const name of names) {
    const first = name.split(/\s+/)[0].toLowerCase();
    if (!byFirst.has(first)) byFirst.set(first, []);
    if (!byFirst.get(first).some(existing => {
      const a = existing.toLowerCase();
      const b = name.toLowerCase();
      return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
    })) {
      byFirst.get(first).push(name);
    }
  }
  const short = [];
  for (const group of byFirst.values()) {
    if (group.length === 1) short.push(group[0].split(/\s+/)[0]);
    else short.push(...group);
  }
  return short.sort((a, b) => a.localeCompare(b));
}

function swapAutoAssignNameList(value, from, to) {
  const names = splitAutoAssignNames(value);
  if (!names.length) return value || '';
  const next = names.map(name => {
    if (autoAssignNamesMatch(name, from)) return to;
    if (autoAssignNamesMatch(name, to)) return from;
    return name;
  });
  return next.join(', ');
}

function recountAutoAssignWorkload(day) {
  const counts = new Map();
  for (const row of day.assignments || []) {
    for (const name of splitAutoAssignNames(row.photographer)) {
      const key = name.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  for (const person of day.workload || []) {
    const key = String(person.name || person.fullName || '').trim().toLowerCase();
    if (counts.has(key)) person.sessions = counts.get(key);
  }
}

function swapAutoAssignPhotographers(from, to, date) {
  if (!autoAssignProposal) return;
  syncAutoAssignEditsFromDom();
  const left = String(from || '').trim();
  const right = String(to || '').trim();
  if (!left || !right || autoAssignNamesMatch(left, right)) {
    showImportantToast('Pick two different photographers to swap');
    return;
  }
  const day = (autoAssignProposal.days || []).find(item => String(item.date) === String(date));
  if (!day) {
    showImportantToast('Could not find that day to swap');
    return;
  }

  let changed = 0;
  for (const row of day.assignments || []) {
    const next = swapAutoAssignNameList(row.photographer, left, right);
    if (next === (row.photographer || '')) continue;
    if (row.originalPhotographer == null) row.originalPhotographer = row.photographer || '';
    row.photographer = next;
    row.edited = row.photographer !== row.originalPhotographer;
    const note = `Swapped ${left} ↔ ${right}`;
    if (!String(row.why || '').includes(note)) {
      row.why = [row.why, note].filter(Boolean).join('; ');
    }
    changed += 1;
  }
  const personA = (day.workload || []).find(item =>
    autoAssignNamesMatch(item.name, left) || autoAssignNamesMatch(item.fullName, left)
  );
  const personB = (day.workload || []).find(item =>
    autoAssignNamesMatch(item.name, right) || autoAssignNamesMatch(item.fullName, right)
  );
  if (personA && personB && personA !== personB) {
    const minutes = personA.minutes;
    personA.minutes = personB.minutes;
    personB.minutes = minutes;
  }
  recountAutoAssignWorkload(day);
  day.swapFrom = left;
  day.swapTo = right;
  renderAutoAssignModal(autoAssignProposal);
  const dayLabel = formatAutoAssignDate(day.date);
  showImportantToast(changed
    ? `Swapped ${left} and ${right} on ${dayLabel} (${changed} session${changed === 1 ? '' : 's'})`
    : `${left} and ${right} have no sessions to swap on ${dayLabel}`);
}

function autoAssignSwapOptions(names, selected) {
  return names.map(name =>
    `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`
  ).join('');
}

function closeAutoAssignModal() {
  const modal = document.getElementById('autoAssignModal');
  if (modal) modal.classList.remove('show');
}

function showAutoAssignLoading(title, subtitle) {
  const body = document.getElementById('autoAssignModalBody');
  if (!body) return;
  body.innerHTML = `<div class="auto-assign-loading">
    <div class="auto-assign-spinner" aria-hidden="true"></div>
    <p>${escapeHtml(title)}</p>
    <p class="auto-assign-loading-sub">${escapeHtml(subtitle)}</p>
  </div>`;
}

function startAutoAssignProgress() {
  const steps = [
    ['Reading the schedule…', 'Pulling sessions and crew for this date.'],
    ['Labeling sessions…', 'Deciding short visits vs dedicated coverage.'],
    ['Assigning photographers…', 'Matching people to rooms and travel time.'],
    ['Balancing the day…', 'Spreading leftover coverage so fewer people sit idle.']
  ];
  const started = Date.now();
  const paint = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    const step = steps[Math.min(steps.length - 1, Math.floor(secs / 2))];
    showAutoAssignLoading(step[0], `${step[1]} ${secs}s elapsed`);
  };
  paint();
  const timer = setInterval(paint, 400);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}

function isAutoAssignUnassigned(row) {
  return !String(row?.photographer || '').trim();
}

function summarizeAutoAssign(proposal) {
  const rows = collectAutoAssignRows(proposal);
  const unassigned = rows.filter(isAutoAssignUnassigned).length;
  return {
    total: rows.length,
    unassigned,
    assigned: Math.max(0, rows.length - unassigned)
  };
}

function autoAssignSummaryHtml(proposal) {
  const stats = summarizeAutoAssign(proposal);
  const unassignedLabel = stats.unassigned === 1 ? 'session unassigned' : 'sessions unassigned';
  const status = stats.unassigned
    ? `${stats.unassigned} of ${stats.total} ${unassignedLabel}`
    : `All ${stats.total} session${stats.total === 1 ? '' : 's'} assigned`;
  return `<div class="auto-assign-summary ${stats.unassigned ? 'has-unassigned' : 'is-complete'}">
    <div class="auto-assign-stat">
      <strong>${stats.total}</strong>
      <span>sessions</span>
    </div>
    <div class="auto-assign-stat is-ok">
      <strong>${stats.assigned}</strong>
      <span>assigned</span>
    </div>
    <div class="auto-assign-stat ${stats.unassigned ? 'is-warn' : 'is-ok'}">
      <strong>${stats.unassigned}</strong>
      <span>unassigned</span>
    </div>
    <p class="auto-assign-summary-copy">${status}</p>
  </div>`;
}

function refreshAutoAssignSummary() {
  if (!autoAssignProposal) return;
  syncAutoAssignEditsFromDom();
  const host = document.querySelector('#autoAssignModal .auto-assign-summary');
  if (!host) return;
  host.outerHTML = autoAssignSummaryHtml(autoAssignProposal);
}

function formatAutoAssignDate(dateStr) {
  if (!dateStr) return 'No date';
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });
}

function renderAutoAssignModal(proposal, { applied = false } = {}) {
  const body = document.getElementById('autoAssignModalBody');
  const applyBtn = document.getElementById('autoAssignApplyBtn');
  const undoBtn = document.getElementById('autoAssignUndoBtn');
  if (!body) return;

  if (!proposal || !proposal.days || !proposal.days.length) {
    body.innerHTML = '<p class="auto-assign-empty">No sessions found for the current date filter.</p>';
    if (applyBtn) applyBtn.disabled = true;
    return;
  }

  const daysHtml = proposal.days.map(day => {
    const dayUnassigned = (day.assignments || []).filter(isAutoAssignUnassigned).length;
    const rows = sortAutoAssignRowsByTime(day.assignments).map(row => {
      const time = [formatTimeDisplay(row.startTime), formatTimeDisplay(row.endTime)].filter(Boolean).join(' – ');
      const coverage = row.coverage === 'dedicated'
        ? 'Stay the whole session'
        : `Visit ~${row.visitMinutes || 15} min`;
      const original = row.originalPhotographer != null ? row.originalPhotographer : (row.photographer || '');
      const edited = !!row.edited;
      const unassigned = isAutoAssignUnassigned(row);
      const photographerCell = applied
        ? escapeHtml(row.photographer || 'Unassigned')
        : `<div class="auto-assign-photo-edit">
            <input type="text" class="auto-assign-photo-input${edited ? ' is-edited' : ''}" data-program-id="${escapeHtml(row.programId)}" data-original="${escapeHtml(original)}" value="${escapeHtml(row.photographer || '')}" placeholder="Unassigned">
            <span class="auto-assign-edited" ${edited ? '' : 'hidden'}>Edited</span>
          </div>`;
      return `<tr class="${unassigned ? 'is-unassigned' : ''}">
        <td class="auto-assign-time">${time || '—'}</td>
        <td>${escapeHtml(row.name || 'Untitled')}</td>
        <td class="auto-assign-loc">${escapeHtml(row.location || '')}</td>
        <td><span class="auto-assign-coverage ${row.coverage || ''}">${coverage}</span></td>
        <td>${photographerCell}</td>
        <td class="auto-assign-why">${escapeHtml(row.why || '')}</td>
      </tr>`;
    }).join('');
    const workload = (day.workload || []).map(person =>
      `<li><span>${escapeHtml(person.name)}</span><em>${person.sessions} session${person.sessions === 1 ? '' : 's'}</em><em>${person.minutes} min</em></li>`
    ).join('');
    const warnings = (day.warnings || []).map(item => `<li>${escapeHtml(item.message)}</li>`).join('');
    const names = collectAutoAssignPhotographerNames(day);
    const swapFrom = day.swapFrom && names.includes(day.swapFrom) ? day.swapFrom : names[0] || '';
    const swapTo = day.swapTo && names.includes(day.swapTo) && day.swapTo !== swapFrom
      ? day.swapTo
      : (names.find(name => name !== swapFrom) || '');
    const swapBar = !applied && names.length >= 2
      ? `<div class="auto-assign-swap-bar">
          <span>Swap this day</span>
          <select data-swap-from aria-label="First photographer">${autoAssignSwapOptions(names, swapFrom)}</select>
          <span>with</span>
          <select data-swap-to aria-label="Second photographer">${autoAssignSwapOptions(names, swapTo)}</select>
          <button type="button" class="btn-secondary" data-auto-assign-swap data-date="${escapeHtml(day.date || '')}">Swap sessions</button>
        </div>`
      : '';
    return `<section class="auto-assign-day">
      <div class="auto-assign-day-head">
        <h4>${escapeHtml(formatAutoAssignDate(day.date))}</h4>
        ${dayUnassigned ? `<span class="auto-assign-day-gap">${dayUnassigned} unassigned</span>` : ''}
      </div>
      ${swapBar}
      <div class="auto-assign-table-wrap">
        <table class="auto-assign-table">
          <thead><tr><th>Time</th><th>Session</th><th>Location</th><th>Type</th><th>Photographer</th><th>Why</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No sessions</td></tr>'}</tbody>
        </table>
      </div>
      ${workload ? `<ul class="auto-assign-workload">${workload}</ul>` : ''}
      ${warnings ? `<ul class="auto-assign-warnings">${warnings}</ul>` : ''}
    </section>`;
  }).join('');

  const editBar = applied ? '' : `<div class="auto-assign-edit-bar">
    ${proposal.editNote ? `<p class="auto-assign-edit-note">${escapeHtml(proposal.editNote)}</p>` : ''}
    <label class="auto-assign-edit-label" for="autoAssignEditInput">Ask for a change</label>
    <div class="auto-assign-edit-row">
      <textarea id="autoAssignEditInput" rows="2" placeholder="Give Kristina fewer sessions and keep her on the longer ones">${escapeHtml(proposal.editDraft || '')}</textarea>
      <button type="button" class="btn-primary" data-auto-assign-edit>Adjust</button>
    </div>
  </div>`;
  body.innerHTML = `${autoAssignSummaryHtml(proposal)}${editBar}${daysHtml}`;
  if (applyBtn) {
    applyBtn.disabled = applied;
    applyBtn.textContent = applied ? 'Applied' : 'Apply';
  }
  if (undoBtn) undoBtn.style.display = applied && autoAssignUndoSnapshot ? 'inline-flex' : 'none';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function openAutoAssignPreview() {
  if (!isOwner) {
    showImportantToast('Only owners and leads can auto-assign');
    return;
  }
  const modal = document.getElementById('autoAssignModal');
  const body = document.getElementById('autoAssignModalBody');
  const applyBtn = document.getElementById('autoAssignApplyBtn');
  const undoBtn = document.getElementById('autoAssignUndoBtn');
  if (!modal || !body) return;
  autoAssignProposal = null;
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Apply';
  }
  if (undoBtn) undoBtn.style.display = 'none';
  const stopProgress = startAutoAssignProgress();
  modal.classList.add('show');

  const tableId = currentEventId || localStorage.getItem('eventId');
  const dates = filterDate && filterDate !== 'all' ? [filterDate] : null;
  try {
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/auto-assign-photographers`, {
      method: 'POST',
      headers: autoAssignAuthHeaders(),
      body: JSON.stringify({ dates })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not build assignments');
    autoAssignProposal = data;
    stopProgress();
    renderAutoAssignModal(data);
  } catch (err) {
    stopProgress();
    body.innerHTML = `<p class="auto-assign-empty">${escapeHtml(err.message)}</p>`;
  }
}

async function submitAutoAssignEdit() {
  if (!autoAssignProposal) return;
  syncAutoAssignEditsFromDom();
  const input = document.getElementById('autoAssignEditInput');
  const instruction = String(input?.value || '').trim();
  if (!instruction) {
    showImportantToast('Tell the agent what to change');
    return;
  }
  const tableId = currentEventId || localStorage.getItem('eventId');
  const applyBtn = document.getElementById('autoAssignApplyBtn');
  if (applyBtn) applyBtn.disabled = true;
  autoAssignProposal.editDraft = instruction;
  showAutoAssignLoading('Adjusting assignments…', instruction);
  try {
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/auto-assign-photographers/edit`, {
      method: 'POST',
      headers: autoAssignAuthHeaders(),
      body: JSON.stringify({
        instruction,
        proposal: autoAssignProposal
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not adjust assignments');
    autoAssignProposal = data;
    autoAssignProposal.editDraft = '';
    renderAutoAssignModal(data);
    showImportantToast(data.editNote || 'Assignments updated');
  } catch (err) {
    renderAutoAssignModal(autoAssignProposal);
    showImportantToast(err.message || 'Could not adjust assignments');
  }
}

function collectAutoAssignRows(proposal) {
  return (proposal?.days || []).flatMap(day => day.assignments || []);
}

function writeLocalPhotographer(programId, photographer) {
  const program = (tableData.programs || []).find(item => String(item._id) === String(programId));
  if (program) program.photographer = photographer;
}

async function applyAutoAssignProposal() {
  if (!autoAssignProposal) return;
  syncAutoAssignEditsFromDom();
  const tableId = currentEventId || localStorage.getItem('eventId');
  const rows = collectAutoAssignRows(autoAssignProposal).filter(row => row.programId);
  const editingKey = window.currentlyEditingField || '';
  const toApply = [];
  const skipped = [];
  for (const row of rows) {
    if (editingKey === `${row.programId}-photographer`) {
      skipped.push(row.name || 'a session');
      continue;
    }
    toApply.push({
      programId: row.programId,
      photographer: row.photographer || '',
      previousPhotographer: row.previousPhotographer || ''
    });
  }
  if (!toApply.length) {
    showImportantToast('Nothing to apply');
    return;
  }
  const applyBtn = document.getElementById('autoAssignApplyBtn');
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
  }
  showAutoAssignLoading('Applying assignments…', 'Writing photographers onto the schedule.');
  try {
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/auto-assign-photographers/apply`, {
      method: 'POST',
      headers: autoAssignAuthHeaders(),
      body: JSON.stringify({
        assignments: toApply,
        sessionId: window.SimpleCollab?.getCurrentUser?.()?.sessionId
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Apply failed');
    autoAssignUndoSnapshot = toApply;
    for (const row of toApply) writeLocalPhotographer(row.programId, row.photographer);
    renderProgramSections(isOwner);
    renderAutoAssignModal(autoAssignProposal, { applied: true });
    showImportantToast(skipped.length
      ? `Assigned photographers (skipped ${skipped.length} being edited)`
      : 'Photographers assigned');
  } catch (err) {
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply';
    }
    renderAutoAssignModal(autoAssignProposal);
    showImportantToast(err.message || 'Apply failed');
  }
}

async function undoAutoAssign() {
  if (!autoAssignUndoSnapshot) return;
  const tableId = currentEventId || localStorage.getItem('eventId');
  const assignments = autoAssignUndoSnapshot.map(row => ({
    programId: row.programId,
    photographer: row.previousPhotographer || ''
  }));
  try {
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/auto-assign-photographers/apply`, {
      method: 'POST',
      headers: autoAssignAuthHeaders(),
      body: JSON.stringify({
        assignments,
        sessionId: window.SimpleCollab?.getCurrentUser?.()?.sessionId
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Undo failed');
    for (const row of autoAssignUndoSnapshot) {
      writeLocalPhotographer(row.programId, row.previousPhotographer || '');
    }
    autoAssignUndoSnapshot = null;
    renderProgramSections(isOwner);
    renderAutoAssignModal(autoAssignProposal, { applied: false });
    showImportantToast('Auto assign undone');
  } catch (err) {
    showImportantToast(err.message || 'Undo failed');
  }
}

console.log('✅ [DARK THEME] Dark theme schedule functionality loaded');

})();
