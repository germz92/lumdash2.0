// --- DEBUG PATCH: Log localStorage.eventId changes only when needed ---
(function() {
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    if (key === 'eventId') {
      // Only log in development or if there's a significant change
      const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const prevValue = localStorage.getItem('eventId');
      
      if (isDev && prevValue !== value) {
        console.log(`[NAVIGATE] Set localStorage eventId to: ${value} for page: ${window.currentNavigatingPage || 'unknown'}`);
      }
    }
    return originalSetItem.apply(this, arguments);
  };
})();

if (!localStorage.getItem('token') && !window.location.pathname.endsWith('index.html')) {
  window.location.replace('index.html');
}

console.log('🚀 app.js loaded and executing');
console.log(' app.js loaded');

// Global collaboration notification cleanup for mobile devices
(function() {
  console.log('📱 Starting global mobile collaboration cleanup...');
  
  function globalMobileCleanup() {
    // Remove any elements with collaboration text patterns
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      if (!el || !el.textContent) return;
      
      const text = el.textContent.toLowerCase().trim();
      
      // Match specific collaboration notification patterns
      if (text.match(/^\d+\s+user.*collaborating$/i) ||
          text.match(/^\d+\s+users?\s+collaborating$/i) ||
          text === 'user collaborating' ||
          text === 'users collaborating' ||
          text.match(/^active users?:?\s*$/i)) {
        
        // Safety check - don't remove if it's part of important content
        const parent = el.parentElement;
        const isImportantContent = parent && (
          parent.classList.contains('program-entry') ||
          parent.classList.contains('general-page') ||
          parent.classList.contains('schedule-page') ||
          el.tagName === 'TITLE' ||
          el.tagName === 'H1' ||
          el.tagName === 'H2'
        );
        
        if (!isImportantContent) {
          console.log(`🗑️ [GLOBAL] Removed mobile collaboration notification: "${el.textContent}"`);
          el.remove();
        }
      }
    });
    
    // Also remove any elements with collaboration-related classes
    const collabClassElements = document.querySelectorAll('[class*="collab"], [class*="notification"], [id*="collab"], [id*="notification"]');
    collabClassElements.forEach(el => {
      if (!el || !el.textContent) return;
      const text = el.textContent.toLowerCase();
      if (text.includes('collaborating') || text.includes('active users')) {
        console.log(`🗑️ [GLOBAL] Removed collaboration element by class: "${el.textContent}"`);
        el.remove();
      }
    });
  }
  
  // Run cleanup immediately
  globalMobileCleanup();
  
  // Run cleanup every 2 seconds
  setInterval(globalMobileCleanup, 2000);
  
  // Also run cleanup when page changes
  window.addEventListener('hashchange', () => {
    setTimeout(globalMobileCleanup, 500);
  });
  
  console.log('📱 Global mobile collaboration cleanup initialized');
})();

const PAGE_CLASSES = [
  'events-page', 'general-page', 'crew-page', 'travel-page', 'card-log-page', 'schedule-page', 'dashboard-page', 'login-page', 'register-page', 'users-page', 'crew-planner-page', 'crew-calendar-page'
];

function setBodyPageClass(page) {
  PAGE_CLASSES.forEach(cls => document.body.classList.remove(cls));
  // Map travel-accommodation to travel-page for CSS compatibility
  if (page === 'travel-accommodation') {
    document.body.classList.add('travel-page');
  } else {
    document.body.classList.add(`${page}-page`);
  }
}

function getTableId() {
  const params = new URLSearchParams(window.location.search);
  const urlId = params.get('id');
  const storedId = localStorage.getItem('eventId');
  const result = urlId || storedId;
  
  console.log(`[getTableId] URL ID: ${urlId}, localStorage ID: ${storedId}, returning: ${result}`);
  
  return result;
}

// Global navigation state
let navigationInProgress = false;

function navigate(page, id) {
  // Prevent double navigation
  if (navigationInProgress) {
    console.log(`[NAVIGATE] Navigation already in progress, skipping duplicate call for page: ${page}`);
    return;
  }
  
  navigationInProgress = true;
  window.currentNavigatingPage = page; // Track for debugging
  
  // Only require an ID for pages that need it
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management'].includes(page);
  
  // CRITICAL FIX: Determine the final tableId to use consistently throughout navigation
  let finalId = id;
  if (needsId && (!finalId || finalId === "null")) {
    finalId = getTableId();
    console.log(`[NAVIGATE] No valid ID provided for ${page}, using getTableId(): ${finalId}`);
  }
  
  if (needsId && (!finalId || finalId === "null")) {
    alert("No event selected. Please select an event first.");
    navigationInProgress = false;
    return;
  }
  
  // Special handling for gear page - redirect to standalone page
  if (page === 'gear') {
    navigationInProgress = false;
    window.location.href = `pages/gear.html?eventId=${finalId}`;
    return;
  }

  // Set the correct body class for the page
  setBodyPageClass(page);

  // Store the event ID ONLY if we have a valid one and it's needed
  if (finalId && needsId) {
    localStorage.setItem('eventId', finalId);
    // Logging handled by the localStorage wrapper
  }
  
  // Clean up any existing page content and scripts
  const pageContainer = document.getElementById('page-container');
  if (pageContainer) {
    // Call any cleanup function from the current page before removing scripts
    // but only if we're not on the first load (window.currentPage will be set)
    if (window.currentPage) {
      // Check for page-specific cleanup functions
      const cleanupFunctionMap = {
        'schedule': 'cleanupSchedulePage',
        'card-log': 'cleanupCardLogPage',
        'shotlist': 'cleanupShotlist'
        // Add more page cleanup functions here as needed
      };
      
      const cleanupFunctionName = cleanupFunctionMap[window.currentPage] || 
                                 `cleanup${window.currentPage.charAt(0).toUpperCase() + window.currentPage.slice(1)}Page`;
      
      if (typeof window[cleanupFunctionName] === 'function') {
        console.log(`Calling ${cleanupFunctionName} for page:`, window.currentPage);
        try {
          window[cleanupFunctionName]();
        } catch (err) {
          console.error(`Error in ${cleanupFunctionName}:`, err);
        }
      }
    }
  
    // Remove all page scripts
    const oldScript = document.getElementById('page-script');
    if (oldScript) {
      oldScript.remove();
    }
    
    // Also remove any duplicate scripts
    document.querySelectorAll('script[id="page-script"]').forEach(script => {
      script.remove();
    });
 
    // Clear page container
    pageContainer.innerHTML = '';
  }
  
  // Update hash and load new page
  location.hash = `#${page}`;
  loadPageCSS(page);
  
  // Track the current page to know when we're navigating
  window.currentPage = page;
  
  // Save the current page state for PWA restoration
  saveCurrentPageState(page, finalId);
  
  // CRITICAL: Always pass the finalId (which is guaranteed to be valid for pages that need it)
  loadPage(page, needsId ? finalId : null);
  
  // Reset navigation flag after a short delay to allow the page to load
  setTimeout(() => {
    navigationInProgress = false;
  }, 100);
}

function loadPage(page, id) {
  fetch(`pages/${page}.html`)
    .then(res => res.text())
    .then(html => {
      // Wait for DOM to be ready if it isn't already
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          injectPageContent(html, page, id);
        });
      } else {
        injectPageContent(html, page, id);
      }
    })
    .catch(err => {
      console.error('Error loading page:', err);
    });
}

function injectPageContent(html, page, id) {
  // Use the simple page container
  const targetElement = document.getElementById('page-container');
  if (!targetElement) {
    console.error('page-container not found');
    return;
  }

  // Clear any existing content
  targetElement.innerHTML = '';
  
  // Add new content to the target element
  targetElement.innerHTML = html;
  
  // Initialize AI Chat Widget for pages with event ID
  if (id && typeof window.initChat === 'function') {
    console.log(`Initializing AI chat for page: ${page} with id: ${id}`);
    window.initChat(id);
  } else if (id) {
    console.warn('Chat widget not available - window.initChat not found');
  }

  // Normalize event-page sidebar behavior (mobile toggle + nav links)
  ensureEventSidebarAdminLinks();
  setupEventPageSidebarNavigation();

  // Remove any existing page script with the same ID
  const existingScript = document.getElementById('page-script');
  if (existingScript) {
    existingScript.remove();
  }
  
  // Also remove any duplicate scripts (with or without cache-busting params)
  const pageScriptSelector = `script[src^="js/${page}.js"]`;
  document.querySelectorAll(pageScriptSelector).forEach(script => {
    script.remove();
  });
  
  // Check if script is already being loaded
  if (document.querySelector(pageScriptSelector)) {
    console.log(`[SCRIPT_LOAD] Script js/${page}.js is already being loaded, skipping`);
    return;
  }

  // Reset page-specific global variables that might have been set by previous scripts
  // Clear any page-specific flags
  const pageFlags = {
    'schedule': ['__scheduleJsLoaded'],
    'card-log': ['__cardLogJsLoaded'],
    'shotlist': ['__shotlistJsLoaded']
    // Add other page flags as needed
  };
  
  if (pageFlags[page]) {
    pageFlags[page].forEach(flag => {
      window[flag] = false;
    });
  }

  // Clear global functions that might be set by page scripts to prevent conflicts
  window.initPage = null;
  
  // Clear any page-specific global functions
  const pageGlobals = [
    'addContactRow', 'addLocationRow', 'saveGeneralInfo', 'switchToEdit', // general.js
    'documentsPage', // documents.js
    // Add other page-specific globals as needed
  ];
  
  pageGlobals.forEach(globalName => {
    if (window[globalName]) {
      window[globalName] = null;
    }
  });

  // CRITICAL FIX: Add cache busting to prevent old corrupted JS from loading
  function loadPageScript(page, callback) {
    // Generate cache buster - use current timestamp for aggressive cache invalidation
    const cacheBuster = Date.now();
    
    const script = document.createElement('script');
    script.id = 'page-script';
    script.src = `js/${page}.js?v=${cacheBuster}`;
    script.onload = callback;
    script.onerror = () => {
      console.warn(`Failed to load js/${page}.js with cache buster, trying without`);
      // Fallback: try loading without cache buster
      const fallbackScript = document.createElement('script');
      fallbackScript.id = 'page-script';
      fallbackScript.src = `js/${page}.js`;
      fallbackScript.onload = callback;
      document.head.appendChild(fallbackScript);
    };
    
    document.head.appendChild(script);
  }

     // Dynamically load JS if it exists
   loadPageScript(page, () => {
     console.log(`Script loaded for ${page}, calling window.initPage with id: ${id}`);
    console.log(`[SCRIPT_LOAD] window.initPage exists: ${typeof window.initPage === 'function'}`);
    
    // Check if the script actually executed by looking for our debug marker
    const pageMarkers = {
      'documents': 'window.__documentsJsLoaded',
      'schedule': 'window.__scheduleJsLoaded',
      'card-log': 'window.__cardLogJsLoaded',
      'shotlist': 'window.__shotlistJsLoaded'
    };
    
    const markerName = pageMarkers[page];
    if (markerName && window[markerName.replace('window.', '')]) {
      console.log(`[SCRIPT_LOAD] ${page}.js execution confirmed via marker`);
    } else if (markerName) {
      console.warn(`[SCRIPT_LOAD] ${page}.js may not have executed properly - no execution marker found`);
    }
    
    // Small delay to ensure the script has been properly initialized
    setTimeout(() => {
      if (window.initPage) {
        try {
          // CRITICAL FIX: Always call initPage if it exists, but only pass ID for pages that need it
          const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management'].includes(page);
          
          if (needsId && id) {
            console.log(`[INIT_PAGE] Calling initPage with explicit id: ${id}`);
            window.initPage(id);
          } else if (needsId && !id) {
            console.warn(`[INIT_PAGE] Page ${page} needs event ID but none provided, initPage not called`);
          } else {
            // Page doesn't need an ID, call initPage without parameters
            console.log(`[INIT_PAGE] Calling initPage for page ${page} (no ID needed)`);
            window.initPage();
          }
        } catch (err) {
          console.error('Error initializing page:', err);
        }
      } else {
        console.warn(`window.initPage is not defined after loading js/${page}.js`);
      }

      // Re-apply shared event sidebar behavior after page-specific init hooks.
      // Some page scripts bind their own handlers; this ensures consistent final behavior.
      ensureEventSidebarAdminLinks();
      setupEventPageSidebarNavigation();
    }, 50);
  });
}

/**
 * Setup mobile sidebar toggle + sidebar nav links for event pages.
 * This normalizes behavior across pages that currently use different class names.
 */
function setupEventPageSidebarNavigation() {
  const sidebar = document.querySelector('.general-sidebar');
  const overlay = document.querySelector('.general-sidebar-overlay');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');

  if (!sidebar || !mobileMenuBtn) return;

  const applyMenuButtonVisibility = () => {
    // Some page-specific CSS only enables this at 768px.
    // Force consistent mobile/tablet behavior across event pages.
    mobileMenuBtn.style.display = window.innerWidth <= 1024 ? 'flex' : '';
  };
  applyMenuButtonVisibility();
  if (window.__eventSidebarResizeHandler) {
    window.removeEventListener('resize', window.__eventSidebarResizeHandler);
  }
  window.__eventSidebarResizeHandler = applyMenuButtonVisibility;
  window.addEventListener('resize', applyMenuButtonVisibility);

  const closeSidebar = () => {
    sidebar.classList.remove('open', 'show');
    if (overlay) overlay.classList.remove('show', 'visible');
    document.body.style.overflow = '';
  };

  const openSidebar = () => {
    sidebar.classList.add('open', 'show');
    if (overlay) overlay.classList.add('show', 'visible');
    document.body.style.overflow = 'hidden';
  };

  // Use onclick assignment to avoid accumulating listeners during SPA navigation
  mobileMenuBtn.onclick = function(e) {
    e.preventDefault();
    const isOpen = sidebar.classList.contains('open') || sidebar.classList.contains('show');
    if (isOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  };

  if (overlay) {
    overlay.onclick = closeSidebar;
  }

  // Normalize event-page sidebar navigation links
  const sidebarLinks = sidebar.querySelectorAll('.nav-item[data-page]');
  sidebarLinks.forEach(link => {
    link.onclick = function(e) {
      e.preventDefault();
      const targetPage = link.getAttribute('data-page');
      if (!targetPage) return;
      closeSidebar();
      const externalHref = link.getAttribute('data-external-href');
      if (externalHref) {
        window.location.href = externalHref;
        return;
      }
      const currentEventId = localStorage.getItem('eventId');
      if (window.navigate) {
        window.navigate(targetPage, currentEventId);
      }
    };
  });
}

/**
 * Ensure event-page sidebars include admin/planner links seen on dashboard.
 * These pages are injected per-view, so we add missing links dynamically.
 */
function ensureEventSidebarAdminLinks() {
  const sidebarNav = document.querySelector('.general-sidebar .sidebar-nav');
  if (!sidebarNav) return;

  let role = 'user';
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role) role = String(user.role).toLowerCase();
  } catch (_) {}

  if (role === 'user') {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const normalizedToken = token.startsWith('Bearer ') ? token.slice(7) : token;
        const payload = JSON.parse(atob(normalizedToken.split('.')[1]));
        if (payload.role) role = String(payload.role).toLowerCase();
      } catch (_) {}
    }
  }

  const isAdmin = role === 'admin';
  const isOwner = role === 'owner';
  const isPlanner = role === 'planner';
  const canSeeAdminLinks = isAdmin || isOwner;
  const canSeePlannerLinks = isAdmin || isPlanner;
  if (!canSeeAdminLinks && !canSeePlannerLinks) return;

  const adminLabelSelector = '.nav-section-label.admin-only-section, #adminSectionLabel';
  let adminSectionLabel = sidebarNav.querySelector(adminLabelSelector);
  if (!adminSectionLabel) {
    adminSectionLabel = document.createElement('div');
    adminSectionLabel.className = 'nav-section-label admin-only-section';
    adminSectionLabel.id = 'adminSectionLabel';
    adminSectionLabel.textContent = 'Admin';
    sidebarNav.appendChild(adminSectionLabel);
  }
  adminSectionLabel.style.display = 'block';

  // Show the Notes link that already exists in the page HTML
  const notesLink = sidebarNav.querySelector('.nav-item[data-page="admin-notes"]');
  if (notesLink) notesLink.style.display = '';
}

function loadPageCSS(page) {
  // Remove any previously added page CSS
  document.querySelectorAll('link[data-page-css]').forEach(link => link.remove());

  let cssFile = '';
  switch (page) {
    case 'events': cssFile = 'css/events.css'; break;
    case 'general': cssFile = 'css/general.css'; break;
    case 'crew': cssFile = 'css/crew.css'; break;
    case 'crew-planner': cssFile = 'css/crew-planner.css'; break;
    case 'crew-calendar': cssFile = 'css/crew-calendar.css'; break;
    case 'travel-accommodation': cssFile = 'css/travel-accommodation.css'; break;

    case 'card-log': cssFile = 'css/card-log.css'; break;
    case 'schedule': cssFile = 'css/schedule.css'; break;
    case 'shotlist': cssFile = 'css/shotlist.css'; break;
    case 'users': cssFile = 'css/users.css'; break;
  }
  if (cssFile) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssFile;
    link.setAttribute('data-page-css', 'true'); // Mark for easy removal
    document.head.appendChild(link);
  }
}

// Handle hash changes (back/forward navigation)
window.addEventListener('hashchange', () => {
  // Prevent handling hashchange if navigation is already in progress
  if (navigationInProgress) {
    console.log(`[HASHCHANGE] Navigation in progress, skipping hashchange handler`);
    return;
  }
  
  const page = location.hash.replace('#', '') || 'events';
  console.log(`[HASHCHANGE] Hash changed to: ${page}`);
  
  // For hash changes (back/forward navigation), we need to be more careful about event IDs
  // Only pass an event ID if the page actually needs one
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management'].includes(page);
  
  if (needsId) {
    const currentEventId = localStorage.getItem('eventId');
    console.log(`[HASHCHANGE] Page ${page} needs event ID, using: ${currentEventId}`);
    navigate(page, currentEventId);
  } else {
    console.log(`[HASHCHANGE] Page ${page} doesn't need event ID`);
    navigate(page);
  }
});

// Initial load
window.addEventListener('DOMContentLoaded', () => {
  console.log('🔥 DOMContentLoaded fired, checking for elements...');
  console.log('page-container exists:', !!document.getElementById('page-container'));
  
  // Reset any state that might be lingering from previous sessions
  window.currentPage = null;
  window.__scheduleJsLoaded = false;
  window.__cardLogJsLoaded = false;
  
  // Clean up any duplicate scripts that might exist
  const pageScripts = document.querySelectorAll('script[id="page-script"]');
  if (pageScripts.length > 0) {
    console.warn(`Found ${pageScripts.length} page scripts, cleaning up...`);
    pageScripts.forEach(script => script.remove());
  }
  
  // Reset body classes
  const PAGE_CLASSES_RESET = [
    'events-page', 'general-page', 'crew-page', 'travel-page', 
    'card-log-page', 'schedule-page', 'dashboard-page', 'login-page', 'register-page'
  ];
  PAGE_CLASSES_RESET.forEach(cls => document.body.classList.remove(cls));
  
  // Get page from hash or default to events
  const page = location.hash.replace('#', '') || 'events';
  console.log(`[INITIAL_LOAD] Initial page load: ${page}`);
  
  // Use the same logic as hashchange handler for consistency
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management'].includes(page);
  
  if (needsId) {
    const currentEventId = localStorage.getItem('eventId');
    console.log(`[INITIAL_LOAD] Page ${page} needs event ID, using: ${currentEventId}`);
    navigate(page, currentEventId);
  } else {
    console.log(`[INITIAL_LOAD] Page ${page} doesn't need event ID`);
    navigate(page);
  }
});

// Expose navigate globally for nav links
window.navigate = navigate;

// PullToRefresh.js integration for PWA/mobile
if (window.PullToRefresh) {
  PullToRefresh.init({
    mainElement: 'body',
    shouldPullToRefresh: function() {
      // Prevent pull-to-refresh if the user is pulling on a scrollable element
      const scrollableSelectors = [
        '.item-list', '.program-container', '.modal-content', '.table-cards', '.card-log-table', '.schedule-page', '.crew-page', '.travel-page', '.general-page', '.card-container', '.modal', '.modal-content', '.list-group', '.info-section', '.contacts-container', '.contacts-scroll-wrapper', '.program-container', '.program-entry', '.date-section', '.date-header', '.event-header', '.event-details', '.action-buttons', '.table-card', '.table-cards', '.schedule-page', '.crew-page', '.travel-page', '.general-page', '.dashboard-page', '.card-log-page', '.login-page', '.register-page'
      ];
      let el = document.elementFromPoint(window.innerWidth/2, 10);
      while (el) {
        if (scrollableSelectors.some(sel => el.matches && el.matches(sel))) {
          return false;
        }
        el = el.parentElement;
      }
      // Only allow pull-to-refresh when at the top of the page
      return window.scrollY === 0;
    },
    onRefresh() {
      console.log('PTR: onRefresh triggered', { currentPage: window.currentPage });
      // Show spinner (handled by library's custom icon)
      // Call SPA page refresh logic
      if (window.currentPage && window.navigate) {
        // Get the current event ID more reliably
        const currentEventId = localStorage.getItem('eventId');
        console.log(`PTR: Refreshing page ${window.currentPage} with eventId: ${currentEventId}`);
        window.navigate(window.currentPage, currentEventId);
      } else {
        window.location.reload();
      }
    },
    iconArrow: '<div class="ptr-spinner"><div class="loader"></div></div>',
    iconRefreshing: '<div class="ptr-spinner"><div class="loader"></div></div>',
    iconSuccess: '<div class="ptr-spinner"><div class="loader"></div></div>',
    distReload: 60,
    distThreshold: 60
  });
}

// Function to save current page state for PWA restoration
function saveCurrentPageState(page, eventId = null) {
  const pageState = {
    page: page,
    eventId: eventId || localStorage.getItem('eventId'),
    timestamp: Date.now(),
    url: window.location.href
  };
  
  localStorage.setItem('lastPageState', JSON.stringify(pageState));
  console.log('[PWA] Saved page state:', pageState);
}

// Function to restore the last visited page when PWA reopens
function restoreLastPageState() {
  try {
    const savedState = localStorage.getItem('lastPageState');
    if (!savedState) {
      console.log('[PWA] No saved page state found, starting fresh');
      return false;
    }
    
    const pageState = JSON.parse(savedState);
    const isAuthenticated = !!localStorage.getItem('token');
    
    // Don't restore if not authenticated or if saved state is too old (more than 7 days)
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    if (!isAuthenticated || (Date.now() - pageState.timestamp > maxAge)) {
      console.log('[PWA] Not restoring page state - not authenticated or state too old');
      localStorage.removeItem('lastPageState');
      return false;
    }
    
    // Restore the page if it's valid and we have the required eventId for pages that need it
    const needsId = !['events', 'dashboard', 'login', 'register', 'users'].includes(pageState.page);
    
    if (needsId && !pageState.eventId) {
      console.log('[PWA] Cannot restore page state - missing eventId for page:', pageState.page);
      return false;
    }
    
    console.log('[PWA] Restoring last page state:', pageState);
    
    // Update the hash without triggering navigation yet
    if (pageState.page !== 'events') {
      location.hash = `#${pageState.page}`;
    }
    
    // Restore eventId if needed
    if (pageState.eventId) {
      localStorage.setItem('eventId', pageState.eventId);
    }
    
    // Navigate to the restored page
    setTimeout(() => {
      navigate(pageState.page, pageState.eventId);
    }, 100);
    
    return true;
  } catch (error) {
    console.error('[PWA] Error restoring page state:', error);
    localStorage.removeItem('lastPageState');
    return false;
  }
}

// Function to clear old page state (utility)
function clearPageState() {
  localStorage.removeItem('lastPageState');
  console.log('[PWA] Page state cleared');
}

// Function to get the current page state (utility)
function getCurrentPageState() {
  try {
    const savedState = localStorage.getItem('lastPageState');
    return savedState ? JSON.parse(savedState) : null;
  } catch (error) {
    console.error('[PWA] Error getting current page state:', error);
    return null;
  }
}

// Make PWA utilities globally available
window.clearPageState = clearPageState;
window.getCurrentPageState = getCurrentPageState;
