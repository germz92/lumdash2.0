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
  'events-page', 'general-page', 'crew-page', 'travel-page', 'card-log-page', 'schedule-page', 'dashboard-page', 'login-page', 'register-page', 'users-page', 'crew-planner-page', 'crew-calendar-page', 'gear-page', 'todos-page', 'executive-summary-page', 'call-times-page', 'notes-page', 'maps-page', 'documents-page', 'shotlist-page', 'reimbursements-page', 'expenses-page', 'post-production-page', 'settings-page'
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

// Parse hash to extract page and ID (supports #page?id=xxx format)
function parseHash() {
  const hash = location.hash.replace('#', '') || 'events';
  
  // Split only on the FIRST ? to handle any malformed URLs
  const questionIndex = hash.indexOf('?');
  let page, queryString;
  
  if (questionIndex !== -1) {
    page = hash.substring(0, questionIndex);
    queryString = hash.substring(questionIndex + 1);
  } else {
    page = hash;
    queryString = null;
  }
  
  let id = null;
  if (queryString) {
    // Handle potentially malformed query strings (e.g., id=xxx?id=xxx)
    // Only take the first id parameter
    const params = new URLSearchParams(queryString.split('?')[0]);
    id = params.get('id');
  }
  
  console.log(`[parseHash] hash: "${hash}", page: "${page}", id: "${id}"`);
  
  return { page: page || 'events', id };
}

function getTableId() {
  // First check hash for ID (new approach - bookmarkable URLs)
  const { id: hashId } = parseHash();
  
  // Then check query string (legacy support)
  const params = new URLSearchParams(window.location.search);
  const urlId = params.get('id');
  
  // Finally fall back to localStorage
  const storedId = localStorage.getItem('eventId');
  
  const result = hashId || urlId || storedId;
  
  console.log(`[getTableId] Hash ID: ${hashId}, URL ID: ${urlId}, localStorage ID: ${storedId}, returning: ${result}`);
  
  return result;
}

// Global navigation state
let navigationInProgress = false;

window.navigateToSettings = function navigateToSettings() {
  document.getElementById('userMenuDropdown')?.classList.remove('show');
  if (typeof window.navigate === 'function') {
    window.navigate('settings');
  } else {
    window.location.href = '/dashboard.html#settings';
  }
};

function navigate(page, id) {
  console.log(`[NAVIGATE] Called with page: "${page}", id: "${id}"`);

  if (page === 'users') {
    sessionStorage.setItem('settingsSection', 'users');
    page = 'settings';
  }
  
  // Prevent double navigation
  if (navigationInProgress) {
    console.log(`[NAVIGATE] Navigation already in progress, skipping duplicate call for page: ${page}`);
    return;
  }
  
  navigationInProgress = true;
  window.currentNavigatingPage = page; // Track for debugging

  // Hide current page immediately so avatars/content don't flash unstyled during fetch
  const pageContainer = document.getElementById('page-container');
  if (window.currentPage && pageContainer) {
    pageContainer.classList.add('page-navigating');
  }
  
  // Only require an ID for pages that need it
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management', 'my-tasks', 'call-times', 'reimbursements', 'post-production', 'settings'].includes(page);
  
  // CRITICAL FIX: Determine the final tableId to use consistently throughout navigation
  let finalId = id;
  if (needsId && (!finalId || finalId === "null")) {
    finalId = getTableId();
    console.log(`[NAVIGATE] No valid ID provided for ${page}, using getTableId(): ${finalId}`);
  }
  
  if (needsId && (!finalId || finalId === "null")) {
    alert("No event selected. Please select an event first.");
    navigationInProgress = false;
    pageContainer?.classList.remove('page-navigating');
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
  if (pageContainer) {
    // DON'T clear content yet - we'll do it in injectPageContent after new content is ready
    // This prevents the flash by keeping old content visible during fetch
    
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

      // Universal cleanup: reset body overflow and dismiss any lingering overlays
      document.body.style.overflow = '';
      document.querySelectorAll('.sidebar-overlay').forEach(el => el.classList.remove('show', 'visible'));
      const dashSidebar = document.getElementById('dashboardSidebar');
      if (dashSidebar) dashSidebar.classList.remove('show', 'open');
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
 
    // Note: We don't clear pageContainer.innerHTML here anymore
    // The content swap happens in injectPageContent for smoother transitions
  }
  
  // Update hash and load new page (include ID in hash for bookmarkable URLs)
  const newHash = needsId && finalId ? `#${page}?id=${finalId}` : `#${page}`;
  
  console.log(`[NAVIGATE] Current hash: "${location.hash}", New hash: "${newHash}"`);
  
  // Parse current hash to check if it already has the correct page and ID
  const currentParsed = parseHash();
  const hashAlreadyCorrect = currentParsed.page === page && 
                             (!needsId || currentParsed.id === finalId);
  
  if (!hashAlreadyCorrect) {
    console.log(`[NAVIGATE] Updating hash to "${newHash}"`);
    // Use pushState to create browser history entries so back button works correctly
    if (history.pushState) {
      history.pushState({ page, id: finalId }, '', newHash);
    } else {
      location.hash = newHash;
    }
  } else {
    console.log(`[NAVIGATE] Hash already correct (page: ${currentParsed.page}, id: ${currentParsed.id}), skipping update`);
  }

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
  // Add cache buster to ensure fresh HTML is loaded
  const cacheBuster = Date.now();
  fetch(`pages/${page}.html?v=${cacheBuster}`)
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
      const pageContainer = document.getElementById('page-container');
      if (pageContainer) {
        pageContainer.classList.remove('page-navigating');
        pageContainer.style.opacity = '1';
      }
    });
}

function injectPageContent(html, page, id) {
  // Use the simple page container
  const targetElement = document.getElementById('page-container');
  if (!targetElement) {
    console.error('page-container not found');
    return;
  }

  // Swap page CSS while hidden, then inject new HTML
  loadPageCSS(page);
  targetElement.classList.remove('page-navigating');
  targetElement.style.opacity = '0';
  targetElement.innerHTML = html;
  
  // Use requestAnimationFrame to let the browser parse and apply styles,
  // then fade in after a brief delay for fonts to apply
  requestAnimationFrame(() => {
    setTimeout(() => {
      targetElement.style.opacity = '1';
    }, 80);
  });
  
  // Setup user dropdown for event page sidebars (if not already present)
  setupEventPageUserDropdown();
  ensureEventSidebarAdminLinks();
  setupEventPageSidebarNavigation();

  // Re-initialize notification system for the new DOM
  if (window.notificationSystem && typeof window.notificationSystem.init === 'function') {
    window.notificationSystem.init();
  }

  // Initialize AI Chat Widget
  // For event pages (with ID): use event-specific chat
  // For dashboard pages (no ID): use global chat
  setTimeout(() => {
    if (id && typeof window.initChat === 'function') {
      console.log(`Initializing AI chat for page: ${page} with id: ${id}`);
      window.initChat(id);
    } else if (typeof window.initGlobalChat === 'function') {
      console.log(`Initializing global AI chat for dashboard page: ${page}`);
      window.initGlobalChat();
    } else if (typeof window.ensureChatInitialized === 'function') {
      console.log(`Ensuring AI chat is initialized for page: ${page}`);
      window.ensureChatInitialized();
    }
  }, 200); // Small delay to ensure chat.js is loaded

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

     // Pages that use inline scripts and should NOT load external JS files
     const pagesWithInlineScripts = ['gear'];
     
     if (pagesWithInlineScripts.includes(page)) {
       console.log(`[SCRIPT_LOAD] Page ${page} uses inline script, skipping external JS load`);
       // For gear page, the inline script in gear.html handles initialization
       // Just need to execute inline scripts that may have been injected
       const inlineScripts = targetElement.querySelectorAll('script');
       console.log(`[SCRIPT_LOAD] Found ${inlineScripts.length} script(s) in the injected HTML`);
       
       inlineScripts.forEach((script, index) => {
         if (!script.src) {
           console.log(`[SCRIPT_LOAD] Executing inline script #${index + 1} (${script.textContent.length} chars)`);
           try {
             // Execute inline script content
             const newScript = document.createElement('script');
             newScript.textContent = script.textContent;
             document.head.appendChild(newScript);
             console.log(`[SCRIPT_LOAD] Script #${index + 1} appended to head`);
             // Don't remove the script - let it stay for async operations
           } catch (err) {
             console.error(`[SCRIPT_LOAD] Error executing script #${index + 1}:`, err);
           }
         } else {
           console.log(`[SCRIPT_LOAD] Skipping external script: ${script.src}`);
         }
       });
       
       // Populate sidebar event info for inline script pages too
       setTimeout(() => {
         if (window.populateSidebarEventInfo) {
           window.populateSidebarEventInfo();
         }
         if (window.checkAdminNotesAccess) {
           window.checkAdminNotesAccess();
         }
       }, 200);
       
       return; // Skip loading external gear.js
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
          const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management', 'my-tasks', 'call-times', 'reimbursements', 'post-production', 'settings'].includes(page);
          
          if (needsId && id) {
            console.log(`[INIT_PAGE] Calling initPage with explicit id: ${id}`);
            window.initPage(id);
            // Populate sidebar event info for event-specific pages (with small delay to ensure DOM is ready)
            setTimeout(() => {
              if (window.populateSidebarEventInfo) {
                window.populateSidebarEventInfo();
              }
              if (window.checkAdminNotesAccess) {
                window.checkAdminNotesAccess();
              }
            }, 100);
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

/**
 * Setup user dropdown menu for event pages that have sidebarUserContainer
 * but are missing the userMenuDropdown element.
 * This runs after every page injection to ensure event page sidebars
 * have the same user dropdown functionality as the main dashboard.
 */
function setupEventPageUserDropdown() {
  const userContainer = document.getElementById('sidebarUserContainer');
  if (!userContainer) return; // No sidebar user container on this page

  // Remove any previously injected dropdown from body (SPA navigation cleanup)
  const existingDropdown = document.getElementById('userMenuDropdown');
  if (existingDropdown) {
    // If the dropdown is inside a sidebar partial (dashboard pages), don't touch it
    if (existingDropdown.closest('#page-container') || existingDropdown.parentElement === document.body) {
      // If it's in page-container, it belongs to the old page and will be replaced.
      // If it's appended to body by us, remove it so we can recreate for the new page.
      if (existingDropdown.parentElement === document.body) {
        existingDropdown.remove();
      } else {
        return; // It's managed by the page's own HTML, skip
      }
    } else {
      return; // It's part of the dashboard sidebar, skip
    }
  }

  // Ensure sidebarUserRole element exists (event pages are missing it)
  if (!document.getElementById('sidebarUserRole')) {
    const userInfoDiv = userContainer.querySelector('.sidebar-user-info');
    if (userInfoDiv) {
      const roleDiv = document.createElement('div');
      roleDiv.className = 'sidebar-user-role';
      roleDiv.id = 'sidebarUserRole';
      roleDiv.textContent = 'User';
      userInfoDiv.appendChild(roleDiv);
    }
  }

  // Populate user name and role from token/localStorage
  (function populateUserInfo() {
    let userName = 'User';
    let userRole = 'User';

    const fullName = localStorage.getItem('fullName');
    if (fullName) userName = fullName;

    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (userName === 'User' && user.name) userName = user.name;
      if (user.role) userRole = user.role;
    } catch (e) {}

    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (userName === 'User') {
          userName = payload.name || payload.fullName || payload.email || 'User';
        }
        if (payload.role) userRole = payload.role;
      } catch (e) {}
    }

    const displayRole = userRole.charAt(0).toUpperCase() + userRole.slice(1);

    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = userName;

    const roleEl = document.getElementById('sidebarUserRole');
    if (roleEl) roleEl.textContent = displayRole;
  })();

  let dropdown;

  // Create the dropdown HTML
  dropdown = document.createElement('div');
  dropdown.className = 'user-menu-dropdown action-dropdown';
  dropdown.id = 'userMenuDropdown';
  dropdown.innerHTML = `
    <button class="user-menu-item" id="profileMenuItem">
      <span class="material-symbols-outlined">person</span>
      <span>Profile</span>
    </button>
    <button class="user-menu-item" id="settingsMenuItem">
      <span class="material-symbols-outlined">settings</span>
      <span>Settings</span>
    </button>
    <button class="user-menu-item danger" id="logoutMenuItem">
      <span class="material-symbols-outlined">logout</span>
      <span>Logout</span>
    </button>
  `;

  // Append to document body so it can use position: fixed freely
  document.body.appendChild(dropdown);

  // Toggle dropdown on user container click
  userContainer.onclick = function(e) {
    e.stopPropagation();
    e.preventDefault();

    const menu = document.getElementById('userMenuDropdown');
    if (!menu) return;

    const isOpen = menu.classList.contains('show');

    // Close all other dropdowns first
    document.querySelectorAll('.action-dropdown.show').forEach(d => d.classList.remove('show'));

    if (!isOpen) {
      // Position above the user container
      const rect = userContainer.getBoundingClientRect();
      const sidebar = userContainer.closest('aside');
      const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : rect;
      const dropdownWidth = sidebarRect.width - 24;

      menu.style.position = 'fixed';
      menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      menu.style.top = 'auto';
      menu.style.left = (sidebarRect.left + 12) + 'px';
      menu.style.right = 'auto';
      menu.style.width = dropdownWidth + 'px';
      menu.style.maxWidth = dropdownWidth + 'px';
      menu.classList.add('show');
    } else {
      menu.classList.remove('show');
    }
  };

  // Close on outside click (only attach once)
  if (!document._eventPageDropdownClickAttached) {
    document.addEventListener('click', function(e) {
      const menu = document.getElementById('userMenuDropdown');
      const container = document.getElementById('sidebarUserContainer');
      if (menu && menu.classList.contains('show')) {
        if (!menu.contains(e.target) && (!container || !container.contains(e.target))) {
          menu.classList.remove('show');
        }
      }
    });
    document._eventPageDropdownClickAttached = true;
  }

  // Profile button
  const profileBtn = dropdown.querySelector('#profileMenuItem');
  if (profileBtn) {
    profileBtn.onclick = function(e) {
      e.stopPropagation();
      document.getElementById('userMenuDropdown')?.classList.remove('show');
    };
  }

  // Settings button
  const settingsBtn = dropdown.querySelector('#settingsMenuItem');
  if (settingsBtn) {
    settingsBtn.onclick = function(e) {
      e.stopPropagation();
      document.getElementById('userMenuDropdown')?.classList.remove('show');
      if (typeof window.navigateToSettings === 'function') {
        window.navigateToSettings();
      } else if (typeof window.navigate === 'function') {
        window.navigate('settings');
      } else {
        window.location.href = '/dashboard.html#settings';
      }
    };
  }

  // Logout button
  const logoutBtn = dropdown.querySelector('#logoutMenuItem');
  if (logoutBtn) {
    logoutBtn.onclick = function(e) {
      e.stopPropagation();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('fullName');
      localStorage.removeItem('userId');
      localStorage.removeItem('profilePhoto');
      window.location.href = '/index.html';
    };
  }

  // Setup avatar upload and load profile photo for event pages
  setupEventPageAvatarUpload();
  loadEventPageProfilePhoto();
}

/**
 * Get API base URL for event pages
 */
function getEventPageApiBase() {
  if (window.API_BASE) return window.API_BASE;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `http://localhost:${window.location.port || 3000}`;
  }
  return window.location.origin;
}

/**
 * Get user ID from JWT token
 */
function getEventPageUserId() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id || payload._id || payload.userId || null;
  } catch (e) {
    return null;
  }
}

/**
 * Load profile photo in event page sidebar
 */
async function loadEventPageProfilePhoto() {
  const avatarImg = document.getElementById('sidebarAvatarImg');
  const avatarIcon = document.getElementById('sidebarAvatarIcon');
  if (!avatarImg || !avatarIcon) return;

  // Show cached photo instantly
  const cachedPhoto = localStorage.getItem('profilePhoto');
  if (cachedPhoto) {
    avatarImg.src = cachedPhoto;
    avatarImg.style.display = 'block';
    avatarIcon.style.display = 'none';
  }

  const userId = getEventPageUserId();
  const token = localStorage.getItem('token');
  if (!userId || !token) return;

  try {
    const res = await fetch(`${getEventPageApiBase()}/api/users/${userId}`, {
      headers: { 'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}` }
    });
    if (res.ok) {
      const userData = await res.json();
      if (userData.profilePhoto) {
        avatarImg.src = userData.profilePhoto;
        avatarImg.style.display = 'block';
        avatarIcon.style.display = 'none';
        localStorage.setItem('profilePhoto', userData.profilePhoto);
      } else {
        avatarImg.style.display = 'none';
        avatarIcon.style.display = '';
        localStorage.removeItem('profilePhoto');
      }
    }
  } catch (err) {
    console.error('Error loading profile photo:', err);
  }
}

/**
 * Setup avatar click-to-upload for event page sidebar
 */
function setupEventPageAvatarUpload() {
  const avatarEl = document.getElementById('sidebarUserAvatar');
  if (!avatarEl) return;

  // Add upload overlay hint
  let overlay = avatarEl.querySelector('.avatar-upload-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'avatar-upload-overlay';
    overlay.innerHTML = '<span class="material-symbols-outlined">photo_camera</span>';
    avatarEl.appendChild(overlay);
  }

  // Create hidden file input
  let fileInput = document.getElementById('avatarFileInput');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'avatarFileInput';
    fileInput.accept = 'image/jpeg,image/jpg,image/png,image/webp';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  // Click avatar to open file picker
  avatarEl.onclick = function(e) {
    e.stopPropagation();
    e.preventDefault();
    fileInput.click();
  };

  // Handle file selection
  fileInput.onchange = async function() {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Photo must be under 5MB');
      fileInput.value = '';
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please log in to upload a profile photo');
      return;
    }

    if (avatarEl) avatarEl.classList.add('uploading');

    try {
      const formData = new FormData();
      formData.append('photo', file);

      const res = await fetch(`${getEventPageApiBase()}/api/users/me/profile-photo`, {
        method: 'POST',
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok && data.profilePhoto) {
        const avatarImg = document.getElementById('sidebarAvatarImg');
        const avatarIcon = document.getElementById('sidebarAvatarIcon');
        if (avatarImg) {
          avatarImg.src = data.profilePhoto;
          avatarImg.style.display = 'block';
        }
        if (avatarIcon) {
          avatarIcon.style.display = 'none';
        }
        localStorage.setItem('profilePhoto', data.profilePhoto);
      } else {
        alert(data.error || 'Failed to upload photo');
      }
    } catch (err) {
      console.error('Error uploading profile photo:', err);
      alert('Failed to upload photo. Please try again.');
    } finally {
      if (avatarEl) avatarEl.classList.remove('uploading');
      fileInput.value = '';
    }
  };
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
    case 'gear': cssFile = 'css/gear.css'; break;
    case 'executive-summary': cssFile = 'css/executive-summary.css'; break;
    case 'reimbursements': cssFile = 'css/reimbursements.css'; break;
    case 'expenses': cssFile = 'css/expenses.css'; break;
    case 'post-production': cssFile = 'css/post-production.css'; break;
    case 'settings': cssFile = 'css/settings.css'; break;
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
  
  // Parse page and ID from hash (supports #page?id=xxx format)
  const { page, id: hashId } = parseHash();
  console.log(`[HASHCHANGE] Hash changed to page: ${page}, id: ${hashId}`);
  
  // For hash changes (back/forward navigation), we need to be more careful about event IDs
  // Only pass an event ID if the page actually needs one
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management', 'my-tasks', 'call-times', 'reimbursements', 'post-production', 'settings'].includes(page);
  
  if (needsId) {
    // Prefer hash ID, fall back to localStorage
    const eventId = hashId || localStorage.getItem('eventId');
    console.log(`[HASHCHANGE] Page ${page} needs event ID, using: ${eventId}`);
    navigate(page, eventId);
  } else {
    console.log(`[HASHCHANGE] Page ${page} doesn't need event ID`);
    navigate(page);
  }
});

// Handle popstate events (browser back/forward buttons with pushState)
window.addEventListener('popstate', (event) => {
  // Prevent handling if navigation is already in progress
  if (navigationInProgress) {
    console.log(`[POPSTATE] Navigation in progress, skipping popstate handler`);
    return;
  }
  
  console.log(`[POPSTATE] Browser back/forward detected, state:`, event.state);
  
  // Parse page and ID from hash (supports #page?id=xxx format)
  const { page, id: hashId } = parseHash();
  
  if (!page) {
    console.log(`[POPSTATE] No page in hash, defaulting to events`);
    navigate('events');
    return;
  }
  
  // For popstate navigation, use state if available, otherwise parse from hash
  const stateId = event.state?.id;
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management', 'my-tasks', 'call-times', 'reimbursements', 'post-production', 'settings'].includes(page);
  
  if (needsId) {
    const eventId = stateId || hashId || localStorage.getItem('eventId');
    console.log(`[POPSTATE] Page ${page} needs event ID, using: ${eventId}`);
    navigate(page, eventId);
  } else {
    console.log(`[POPSTATE] Page ${page} doesn't need event ID`);
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
  
  // Parse page and ID from hash (supports #page?id=xxx format)
  const { page, id: hashId } = parseHash();
  console.log(`[INITIAL_LOAD] Initial page load: ${page}, hash ID: ${hashId}`);
  
  // Use the same logic as hashchange handler for consistency
  const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management', 'my-tasks', 'call-times', 'reimbursements', 'post-production', 'settings'].includes(page);
  
  if (needsId) {
    // Prefer hash ID, fall back to localStorage
    const eventId = hashId || localStorage.getItem('eventId');
    console.log(`[INITIAL_LOAD] Page ${page} needs event ID, using: ${eventId}`);
    navigate(page, eventId);
  } else {
    console.log(`[INITIAL_LOAD] Page ${page} doesn't need event ID`);
    navigate(page);
  }
});

// Expose navigation functions globally for nav links and external pages
window.navigate = navigate;
window.parseHash = parseHash;
window.getTableId = getTableId;

// Parse date string as local date to avoid timezone shifts
function parseLocalDateApp(dateStr) {
  if (!dateStr) return null;
  // Handle ISO date strings like "2026-01-15" or "2026-01-15T00:00:00.000Z"
  const str = String(dateStr);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, year, month, day] = match;
    // Create date in local timezone at midnight
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0);
  }
  // Fallback to regular parsing
  return new Date(dateStr);
}

/**
 * Populate sidebar event info section with event name, location, and dates
 * Called from each event page's initPage function
 */
async function populateSidebarEventInfo() {
  const eventId = localStorage.getItem('eventId');
  if (!eventId) return;
  
  // Find the event info container (works for any page with the sidebar)
  const eventInfoContainer = document.getElementById('sidebarEventInfo');
  if (!eventInfoContainer) {
    console.log('[SIDEBAR] No sidebarEventInfo container found');
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    const API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');
    
    const res = await fetch(`${API_BASE}/api/tables/${eventId}`, {
      headers: { Authorization: token }
    });
    
    if (!res.ok) {
      console.error('[SIDEBAR] Failed to load event data for sidebar');
      return;
    }
    
    const table = await res.json();
    const general = table.general || {};
    
    // Format the date range (using parseLocalDateApp to avoid timezone shifts)
    let dateDisplay = '';
    if (general.start && general.end) {
      const startDate = parseLocalDateApp(general.start);
      const endDate = parseLocalDateApp(general.end);
      const options = { month: 'short', day: 'numeric' };
      
      if (startDate.toDateString() === endDate.toDateString()) {
        dateDisplay = startDate.toLocaleDateString('en-US', { ...options, year: 'numeric' });
      } else if (startDate.getFullYear() === endDate.getFullYear()) {
        dateDisplay = `${startDate.toLocaleDateString('en-US', options)} - ${endDate.toLocaleDateString('en-US', { ...options, year: 'numeric' })}`;
      } else {
        dateDisplay = `${startDate.toLocaleDateString('en-US', { ...options, year: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { ...options, year: 'numeric' })}`;
      }
    } else if (general.start) {
      dateDisplay = parseLocalDateApp(general.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    
    // Format location
    let locationDisplay = '';
    if (general.city && general.state) {
      locationDisplay = `${general.city}, ${general.state}`;
    } else if (general.city) {
      locationDisplay = general.city;
    } else if (general.state) {
      locationDisplay = general.state;
    }
    
    // Update the container
    eventInfoContainer.innerHTML = `
      <div class="sidebar-event-name">${table.title || 'Untitled Event'}</div>
      ${locationDisplay ? `<div class="sidebar-event-location"><span class="material-symbols-outlined">location_on</span>${locationDisplay}</div>` : ''}
      ${dateDisplay ? `<div class="sidebar-event-date"><span class="material-symbols-outlined">calendar_today</span>${dateDisplay}</div>` : ''}
    `;
    eventInfoContainer.style.display = 'block';
    
  } catch (err) {
    console.error('[SIDEBAR] Error loading event info:', err);
  }
}

// Expose globally
window.populateSidebarEventInfo = populateSidebarEventInfo;

/**
 * Show/hide admin notes link in sidebar based on user permissions
 * Only visible to admins and event owners
 */
async function checkAdminNotesAccess() {
  const eventId = localStorage.getItem('eventId');
  if (!eventId) return;
  
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');
    
    // Decode JWT token to get user info
    let userId, userRole;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.id || payload._id || payload.userId;
      userRole = payload.role;
    } catch (e) {
      console.error('[SIDEBAR] Failed to decode token:', e);
      return;
    }
    
    // Get table info to check owners
    const tableRes = await fetch(`${API_BASE}/api/tables/${eventId}`, {
      headers: { Authorization: token }
    });
    if (!tableRes.ok) return;
    const table = await tableRes.json();
    
    // Check if admin or owner
    const isAdmin = userRole === 'admin';
    const isOwner = table.owners && table.owners.includes(userId);
    
    console.log('[SIDEBAR] Admin notes access check:', { userId, userRole, isAdmin, isOwner, owners: table.owners });
    
    if (isAdmin || isOwner) {
      const adminSectionLabel = document.getElementById('adminSectionLabel');
      if (adminSectionLabel) adminSectionLabel.style.display = 'block';
      document.querySelectorAll('.admin-only-nav').forEach(link => {
        link.style.display = 'flex';
      });
      console.log('[SIDEBAR] Admin section links shown');
    }
    
  } catch (err) {
    console.error('[SIDEBAR] Error checking admin notes access:', err);
  }
}

// Expose globally
window.checkAdminNotesAccess = checkAdminNotesAccess;

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
    const needsId = !['events', 'dashboard', 'login', 'register', 'users', 'crew-planner', 'crew-calendar', 'inventory-management', 'my-tasks', 'call-times', 'reimbursements', 'post-production', 'settings'].includes(pageState.page);
    
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
