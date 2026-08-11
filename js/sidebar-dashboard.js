/**
 * Dashboard Sidebar - Shared component for home dashboard pages
 * Used by: events.html, users.html, inventory-management.html, crew-planner.html, crew-calendar.html, event-calendar.html
 * 
 * This sidebar includes: Dashboard, Event Calendar, Admin Console, Inventory, Crew Planner, Crew Calendar
 */

(function() {
  'use strict';
  
  // Cache for the sidebar HTML to avoid refetching
  let sidebarHTMLCache = null;
  
  /**
   * Get the current page name for determining active state
   */
  function getCurrentPage() {
    const path = window.location.pathname;
    const hash = window.location.hash;
    
    // Check for SPA pages via hash
    if (path.includes('dashboard.html')) {
      const hashPage = hash.replace('#', '').split('?')[0];
      if (hashPage === 'post-production') return 'post-production';
      return hashPage || 'events';
    }
    
    // Check for standalone pages
    if (path.includes('event-calendar')) return 'event-calendar';
    if (path.includes('users')) return 'users';
    if (path.includes('inventory-management')) return 'inventory-management';
    if (path.includes('crew-planner')) return 'crew-planner';
    if (path.includes('crew-calendar')) return 'crew-calendar';
    if (path.includes('flights')) return 'flights';
    if (path.includes('admin-timesheets')) return 'admin-timesheets';
    
    return 'events';
  }
  
  /**
   * Get the correct path prefix based on current page location
   */
  function getPathPrefix() {
    const path = window.location.pathname;
    // If we're in /pages/ directory, assets need to go up one level
    if (path.includes('/pages/')) {
      return '../';
    }
    return '';
  }
  
  /**
   * Wait for Material Symbols font to be loaded
   */
  async function waitForFonts() {
    // Quick check if fonts are already loaded
    if (document.fonts && document.fonts.check('24px "Material Symbols Outlined"')) {
      return;
    }
    
    // Wait for fonts to load (max 500ms)
    return new Promise(resolve => {
      if (document.fonts && document.fonts.ready) {
        const timeout = setTimeout(resolve, 500); // Fallback timeout
        document.fonts.ready.then(() => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        // Fallback for older browsers
        setTimeout(resolve, 100);
      }
    });
  }
  
  /**
   * Inject the dashboard sidebar into the page
   * @param {HTMLElement} container - The element to inject the sidebar into (or before)
   * @param {Object} options - Configuration options
   * @param {string} options.position - 'prepend' | 'before' | 'replace' - where to inject
   * @param {string} options.activePage - Override the active page detection
   */
  async function injectDashboardSidebar(container, options = {}) {
    if (!container) {
      console.error('[Dashboard Sidebar] No container provided for injection');
      return false;
    }
    
    const position = options.position || 'prepend';
    const activePage = options.activePage || getCurrentPage();
    const pathPrefix = getPathPrefix();
    
    console.log('[Dashboard Sidebar] Injecting sidebar, active page:', activePage);
    
    // Wait for fonts before injecting sidebar (prevents FOUT)
    await waitForFonts();
    
    try {
      // Fetch the sidebar HTML (use cache if available)
      if (!sidebarHTMLCache) {
        const response = await fetch(`${pathPrefix}partials/dashboard-sidebar.html`);
        if (!response.ok) {
          throw new Error(`Failed to fetch sidebar: ${response.status}`);
        }
        sidebarHTMLCache = await response.text();
      }
      
      // Create a temporary container to parse the HTML
      const temp = document.createElement('div');
      temp.innerHTML = sidebarHTMLCache;
      
      // Fix asset paths for pages in subdirectories
      if (pathPrefix) {
        const logoImg = temp.querySelector('.sidebar-logo-img');
        if (logoImg) {
          const currentSrc = logoImg.getAttribute('src');
          if (currentSrc && !currentSrc.startsWith('../') && !currentSrc.startsWith('/')) {
            logoImg.setAttribute('src', `${pathPrefix}${currentSrc}`);
          }
        }
      }
      
      // Set the active nav item
      const navItems = temp.querySelectorAll('.nav-item[data-sidebar-page]');
      navItems.forEach(item => {
        const itemPage = item.getAttribute('data-sidebar-page');
        if (itemPage === activePage) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
      
      // Get sidebar elements
      const sidebar = temp.querySelector('.dashboard-sidebar');
      const dropdown = temp.querySelector('.user-menu-dropdown');
      const overlay = temp.querySelector('.sidebar-overlay');
      
      if (!sidebar) {
        console.error('[Dashboard Sidebar] Sidebar element not found in partial');
        return false;
      }
      
      // Inject based on position option
      if (position === 'prepend') {
        // Insert sidebar, dropdown, and overlay at the start of container
        if (overlay) container.prepend(overlay);
        if (dropdown) container.prepend(dropdown);
        container.prepend(sidebar);
      } else if (position === 'before') {
        // Insert before the container
        if (sidebar) container.parentNode.insertBefore(sidebar, container);
        if (dropdown) container.parentNode.insertBefore(dropdown, container);
        if (overlay) document.body.appendChild(overlay);
      } else if (position === 'replace') {
        // Replace container's content
        container.innerHTML = '';
        container.appendChild(sidebar);
        if (dropdown) container.appendChild(dropdown);
        if (overlay) container.appendChild(overlay);
      }
      
      // Initialize the sidebar functionality
      initDashboardSidebar();
      
      return true;
    } catch (error) {
      console.error('[Dashboard Sidebar] Error injecting sidebar:', error);
      return false;
    }
  }
  
  /**
   * Initialize the dashboard sidebar
   * Call this from your page's init function after sidebar HTML is present
   */
  function initDashboardSidebar() {
    console.log('🎨 Initializing dashboard sidebar...');
    
    // Always re-run setup for SPA navigation (DOM elements are new)
    setupMobileMenu();
    setupUserDropdown();
    setupSidebarNavigation();
    updateUserInfo();
    checkAdminAccess();
    setupDropdownClickOutside();
    fixPageContainer();
    setupAvatarUpload();
    loadProfilePhoto();
    refreshAllSidebarDots();
    setupSidebarDotsPolling();
  }
  
  /**
   * Setup sidebar navigation click handlers
   */
  function setupSidebarNavigation() {
    const navItems = document.querySelectorAll('#dashboardSidebar .nav-item[data-sidebar-page]');
    
    navItems.forEach(item => {
      item.onclick = function(e) {
        const page = item.getAttribute('data-sidebar-page');
        const href = item.getAttribute('href');
        const isSpa = item.getAttribute('data-spa') === 'true';
        
        // If already on this page, do nothing
        if (item.classList.contains('active')) {
          e.preventDefault();
          return;
        }
        
        // For SPA pages (marked with data-spa="true"), use window.navigate
        if (isSpa && window.navigate) {
          e.preventDefault();
          if (page === 'post-production' || page === 'reimbursements') {
            markSidebarPageVisited(page).finally(() => window.navigate(page));
          } else {
            window.navigate(page);
          }
          return;
        }
        
        // For SPA navigation within dashboard.html (legacy check)
        if (href && href.startsWith('/dashboard.html#')) {
          e.preventDefault();
          const hashPage = href.replace('/dashboard.html#', '').split('?')[0];
          if (window.navigate) {
            window.navigate(hashPage);
          } else {
            window.location.href = href;
          }
          return;
        }
        
        // For external/standalone pages, let the browser handle the navigation
        // (href will work normally)
      };
    });
    
    console.log('Sidebar navigation ready');
  }
  
  /**
   * Setup mobile menu toggle
   */
  function setupMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('dashboardSidebar');
    let overlay = document.getElementById('dashboardSidebarOverlay') || document.querySelector('.sidebar-overlay');
    
    if (!sidebar || !mobileMenuBtn) return;
    
    // Create overlay if it doesn't exist
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
      overlay.id = 'dashboardSidebarOverlay';
      document.body.appendChild(overlay);
    }
    
    // Use onclick property (simple, no accumulation)
    mobileMenuBtn.onclick = function() {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
      document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
    };
    
    // Overlay click handler
    overlay.onclick = function() {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
      document.body.style.overflow = '';
    };
  }
  
  /**
   * Setup user dropdown menu
   */
  function setupUserDropdown() {
    const userContainer = document.getElementById('sidebarUserContainer');
    const userMenuDropdown = document.getElementById('userMenuDropdown');
    
    console.log('setupUserDropdown:', { 
      userContainer: !!userContainer, 
      userMenuDropdown: !!userMenuDropdown 
    });
    
    if (!userContainer || !userMenuDropdown) {
      console.warn('User dropdown elements not found');
      return;
    }
    
    // Use onclick property (simple, no accumulation issues)
    userContainer.onclick = function(e) {
      e.stopPropagation();
      e.preventDefault();
      console.log('User dropdown clicked');
      
      // Always get fresh references to elements (in case DOM was modified)
      const currentUserContainer = document.getElementById('sidebarUserContainer');
      const dropdown = document.getElementById('userMenuDropdown');
      const sidebar = document.getElementById('dashboardSidebar');
      
      if (!dropdown || !currentUserContainer) return;
      
      const isOpen = dropdown.classList.contains('show');
      
      // Close all other dropdowns first
      document.querySelectorAll('.action-dropdown.show').forEach(d => d.classList.remove('show'));
      
      if (!isOpen) {
        dropdown.classList.add('show');
        
        // Position the dropdown ABOVE the user container, aligned to sidebar
        const rect = currentUserContainer.getBoundingClientRect();
        const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : rect;
        const dropdownWidth = sidebarRect.width - 24; // Full sidebar width minus padding
        
        console.log('Dropdown positioning:', { 
          userTop: rect.top, 
          windowHeight: window.innerHeight,
          bottomPos: window.innerHeight - rect.top + 8
        });
        
        dropdown.style.position = 'fixed';
        dropdown.style.bottom = (window.innerHeight - rect.top + 8) + 'px'; // Above the user container
        dropdown.style.top = 'auto';
        dropdown.style.left = (sidebarRect.left + 12) + 'px'; // Align with sidebar left edge
        dropdown.style.right = 'auto';
        dropdown.style.width = dropdownWidth + 'px';
        dropdown.style.maxWidth = dropdownWidth + 'px';
        dropdown.style.zIndex = '10000';
      }
    };
    
    // Setup logout handler on the menu item directly
    const logoutMenuItem = document.getElementById('logoutMenuItem');
    if (logoutMenuItem) {
      logoutMenuItem.onclick = function(e) {
        e.stopPropagation();
        console.log('Logout clicked');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('fullName');
        localStorage.removeItem('userId');
        localStorage.removeItem('profilePhoto');
        // Navigate to login page
        window.location.href = '/index.html';
      };
    }
    
    // Setup profile and settings handlers
    const profileMenuItem = document.getElementById('profileMenuItem');
    if (profileMenuItem) {
      profileMenuItem.onclick = function(e) {
        e.stopPropagation();
        console.log('Profile clicked');
        // TODO: Navigate to profile page when implemented
        document.getElementById('userMenuDropdown')?.classList.remove('show');
      };
    }
    
    const settingsMenuItem = document.getElementById('settingsMenuItem');
    if (settingsMenuItem) {
      settingsMenuItem.onclick = function(e) {
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

    const feedbackMenuItem = document.getElementById('feedbackMenuItem');
    if (feedbackMenuItem) {
      feedbackMenuItem.onclick = function(e) {
        e.stopPropagation();
        document.getElementById('userMenuDropdown')?.classList.remove('show');
        if (typeof window.navigate === 'function') {
          window.navigate('feedback');
        } else {
          window.location.href = '/dashboard.html#feedback';
        }
      };
    }
  }
  
  /**
   * Update user info in sidebar and header
   */
  function updateUserInfo() {
    let userName = 'User';
    let userRole = 'User';
    
    // Method 1: Check for fullName (set by login.js)
    const fullName = localStorage.getItem('fullName');
    if (fullName) {
      userName = fullName;
    }
    
    // Method 2: Check for user object (some pages may store this)
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (userName === 'User') {
        if (user.name) userName = user.name;
        else if (user.email) userName = user.email;
      }
      if (user.role) {
        userRole = user.role;
      }
    } catch (e) {}
    
    // Method 3: Decode from token
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (userName === 'User') {
          if (payload.name) userName = payload.name;
          else if (payload.email) userName = payload.email;
          else if (payload.fullName) userName = payload.fullName;
        }
        if (payload.role) {
          userRole = payload.role;
        }
      } catch (e) {}
    }
    
    const firstName = userName.split(' ')[0];
    
    // Format role for display (title-case; underscore → space)
    const displayRole = String(userRole || 'user')
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    
    // Update welcome title (if exists)
    const welcomeTitle = document.getElementById('welcomeTitle');
    if (welcomeTitle) {
      welcomeTitle.textContent = `Welcome, ${firstName}`;
    }
    
    // Update sidebar user name
    const sidebarUserName = document.getElementById('sidebarUserName');
    if (sidebarUserName) {
      sidebarUserName.textContent = userName;
    }
    
    // Update sidebar user role
    const sidebarUserRole = document.getElementById('sidebarUserRole');
    if (sidebarUserRole) {
      sidebarUserRole.textContent = displayRole;
    }
    
    console.log('User info updated:', userName, 'Role:', displayRole);
  }
  
  /**
   * Check admin/planner/production-manager access and show/hide role-specific nav items
   * Admin-only: Crew Planner, Crew Calendar, Timesheets, Reimbursements
   * Inventory: admin + production manager
   * Planner (and admin): Flight Tracker
   */
  function checkAdminAccess() {
    let user = {};
    try {
      user = JSON.parse(localStorage.getItem('user') || '{}');
    } catch (e) {}
    
    // Fallback to token
    if (!user.role) {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          user.role = payload.role;
        } catch (e) {}
      }
    }
    
    const isAdmin = user.role === 'admin';
    const isOwner = user.role === 'owner'; // Event owner, not system admin
    const isPlanner = user.role === 'planner';
    const isProductionManager = user.role === 'production_manager';
    const canAccessAdminPages = isAdmin || isOwner; // Admin-only nav items
    const canAccessInventory = isAdmin || isOwner || isProductionManager;
    const canAccessPlannerPages = isAdmin || isPlanner; // Planner nav items (NOT owners)
    
    console.log('Access check:', { role: user.role, isAdmin, isOwner, isPlanner, isProductionManager, canAccessAdminPages, canAccessInventory, canAccessPlannerPages });
    
    // Show/hide all admin-only nav items (admins and owners)
    const adminOnlyNavItems = document.querySelectorAll('.admin-only-nav');
    adminOnlyNavItems.forEach(item => {
      item.style.display = canAccessAdminPages ? 'flex' : 'none';
    });
    
    // Inventory nav (admins + production managers)
    document.querySelectorAll('.inventory-nav').forEach(item => {
      item.style.display = canAccessInventory ? 'flex' : 'none';
    });
    
    // Show/hide admin section label
    const adminSectionLabels = document.querySelectorAll('.admin-only-section');
    adminSectionLabels.forEach(label => {
      label.style.display = canAccessAdminPages ? 'block' : 'none';
    });
    
    // Show/hide planner nav items (visible to planners AND admins, NOT owners)
    const plannerNavItems = document.querySelectorAll('.planner-nav');
    plannerNavItems.forEach(item => {
      item.style.display = canAccessPlannerPages ? 'flex' : 'none';
    });
  }
  
  /**
   * Setup click outside handler to close dropdowns
   */
  function setupDropdownClickOutside() {
    // Use a single document-level handler for closing dropdowns
    // This is attached once and handles all dropdowns
    if (document._dashboardDropdownClickAttached) return;
    
    document.addEventListener('click', function(e) {
      // Close user menu dropdown if click is outside
      const userMenuDropdown = document.getElementById('userMenuDropdown');
      const userContainer = document.getElementById('sidebarUserContainer');
      
      if (userMenuDropdown && userMenuDropdown.classList.contains('show')) {
        // Check if click was outside the dropdown and user container
        if (!userMenuDropdown.contains(e.target) && 
            (!userContainer || !userContainer.contains(e.target))) {
          userMenuDropdown.classList.remove('show');
        }
      }
      
      // Close other action dropdowns
      document.querySelectorAll('.action-dropdown.show').forEach(dropdown => {
        if (dropdown.id !== 'userMenuDropdown' &&
            !dropdown.contains(e.target) && 
            !e.target.closest('.action-menu-btn')) {
          dropdown.classList.remove('show');
        }
      });
    });
    
    document._dashboardDropdownClickAttached = true;
  }
  
  /**
   * Fix page container for proper scrolling
   */
  function fixPageContainer() {
    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
      pageContainer.style.padding = '0';
      pageContainer.style.overflow = 'hidden';
      pageContainer.style.height = '100vh';
    }
    
  }
  
  /**
   * Set active page in sidebar (for use after navigation)
   */
  function setActivePage(pageName) {
    const navItems = document.querySelectorAll('#dashboardSidebar .nav-item[data-sidebar-page]');
    navItems.forEach(item => {
      const itemPage = item.getAttribute('data-sidebar-page');
      if (itemPage === pageName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }
  
  /**
   * Get API base URL
   */
  function getApiBase() {
    // Check common patterns for API base
    if (window.API_BASE) return window.API_BASE;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `http://localhost:${window.location.port || 3000}`;
    }
    return window.location.origin;
  }

  /**
   * Get user ID from JWT token
   */
  function getUserIdFromToken() {
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
   * Load profile photo from server and display in sidebar avatar
   */
  async function loadProfilePhoto() {
    const avatarImg = document.getElementById('sidebarAvatarImg');
    const avatarIcon = document.getElementById('sidebarAvatarIcon');
    if (!avatarImg || !avatarIcon) return;

    // Check localStorage cache first for instant display
    const cachedPhoto = localStorage.getItem('profilePhoto');
    if (cachedPhoto) {
      avatarImg.src = cachedPhoto;
      avatarImg.style.display = 'block';
      avatarIcon.style.display = 'none';
    }

    const userId = getUserIdFromToken();
    const token = localStorage.getItem('token');
    if (!userId || !token) return;

    try {
      const res = await fetch(`${getApiBase()}/api/users/${userId}`, {
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
          // No photo on server - clear cache and show icon
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
   * Setup avatar click-to-upload functionality
   */
  function setupAvatarUpload() {
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

      // Validate file size (5MB)
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

      // Show loading state
      const avatarImg = document.getElementById('sidebarAvatarImg');
      const avatarIcon = document.getElementById('sidebarAvatarIcon');
      if (avatarEl) avatarEl.classList.add('uploading');

      try {
        const formData = new FormData();
        formData.append('photo', file);

        const res = await fetch(`${getApiBase()}/api/users/me/profile-photo`, {
          method: 'POST',
          headers: {
            'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
          },
          body: formData
        });

        const data = await res.json();
        if (res.ok && data.profilePhoto) {
          // Update avatar display
          if (avatarImg) {
            avatarImg.src = data.profilePhoto;
            avatarImg.style.display = 'block';
          }
          if (avatarIcon) {
            avatarIcon.style.display = 'none';
          }
          // Cache in localStorage
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

  function authHeaders() {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` };
  }

  function setSidebarDotVisible(dotId, show) {
    const dot = document.getElementById(dotId);
    if (!dot) return;
    if (show) {
      dot.classList.add('show');
      dot.removeAttribute('hidden');
      dot.setAttribute('aria-hidden', 'false');
    } else {
      dot.classList.remove('show');
      dot.setAttribute('hidden', '');
      dot.setAttribute('aria-hidden', 'true');
    }
  }

  async function refreshAllSidebarDots() {
    const token = localStorage.getItem('token');
    if (!token) {
      setSidebarDotVisible('ppSidebarDot', false);
      setSidebarDotVisible('flightsSidebarDot', false);
      setSidebarDotVisible('reimbursementsSidebarDot', false);
      return;
    }
    try {
      const res = await fetch(`${getApiBase()}/api/dashboard/sidebar-indicators`, {
        headers: authHeaders()
      });
      if (!res.ok) {
        setSidebarDotVisible('ppSidebarDot', false);
        setSidebarDotVisible('flightsSidebarDot', false);
        setSidebarDotVisible('reimbursementsSidebarDot', false);
        return;
      }
      const data = await res.json();
      setSidebarDotVisible('ppSidebarDot', !!data.postProduction);
      setSidebarDotVisible('flightsSidebarDot', !!data.flights);
      setSidebarDotVisible('reimbursementsSidebarDot', !!data.reimbursements);
    } catch (err) {
      console.error('Dashboard sidebar indicators:', err);
    }
  }

  async function markSidebarPageVisited(page) {
    const token = localStorage.getItem('token');
    if (!token || !page) return;
    const dotMap = {
      'post-production': 'ppSidebarDot',
      flights: 'flightsSidebarDot',
      reimbursements: 'reimbursementsSidebarDot'
    };
    try {
      const res = await fetch(`${getApiBase()}/api/dashboard/sidebar-visited`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page })
      });
      if (res.ok) {
        const data = await res.json();
        const dotId = dotMap[page];
        if (dotId) setSidebarDotVisible(dotId, !!data.hasNew);
        return;
      }
    } catch (err) {
      console.error('Dashboard sidebar mark visited:', err);
    }
    await refreshAllSidebarDots();
  }

  function setupSidebarDotsPolling() {
    if (document._sidebarDotsPollingAttached) return;
    document._sidebarDotsPollingAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshAllSidebarDots();
      }
    });
  }

  async function refreshPostProductionSidebarDot() {
    return refreshAllSidebarDots();
  }

  async function markPostProductionVisited() {
    return markSidebarPageVisited('post-production');
  }

  // Expose functions globally
  window.injectDashboardSidebar = injectDashboardSidebar;
  window.initDashboardSidebar = initDashboardSidebar;
  window.updateDashboardUserInfo = updateUserInfo;
  window.setDashboardActivePage = setActivePage;
  window.loadDashboardProfilePhoto = loadProfilePhoto;
  window.refreshAllSidebarDots = refreshAllSidebarDots;
  window.refreshPostProductionSidebarDot = refreshPostProductionSidebarDot;
  window.markSidebarPageVisited = markSidebarPageVisited;
  window.markPostProductionVisited = markPostProductionVisited;
  
})();
