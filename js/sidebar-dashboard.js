/**
 * Dashboard Sidebar - Shared component for home dashboard pages
 * Used by: events.html, users.html, and other dashboard-level pages
 * 
 * This sidebar includes: Dashboard, Admin Console, Inventory, Crew Planner, Crew Calendar
 */

(function() {
  'use strict';
  
  /**
   * Initialize the dashboard sidebar
   * Call this from your page's init function
   */
  function initDashboardSidebar() {
    console.log('🎨 Initializing dashboard sidebar...');
    
    // Always re-run setup for SPA navigation (DOM elements are new)
    setupMobileMenu();
    setupUserDropdown();
    setupSidebarNavigation();
    setupExternalNavigation();
    updateUserInfo();
    checkAdminAccess();
    setupDropdownClickOutside();
    fixPageContainer();
  }
  
  /**
   * Setup external navigation links
   * Inline onclick handlers don't work reliably in SPA, so we attach listeners programmatically
   */
  function setupExternalNavigation() {
    const externalLinks = document.querySelectorAll('.nav-external');
    console.log('Setting up external navigation for', externalLinks.length, 'links');
    
    externalLinks.forEach(link => {
      // Use onclick property (simple, no accumulation)
      link.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        const href = link.getAttribute('href');
        console.log('External nav clicked:', href);
        window.location.href = href;
      };
    });
  }
  
  /**
   * Setup mobile menu toggle
   */
  function setupMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('dashboardSidebar');
    
    if (!mobileMenuBtn || !sidebar) return;
    
    // Create overlay element
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sidebar-overlay';
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
        // Navigate to login page (handle both root and pages/ paths)
        const isInPagesDir = window.location.pathname.includes('/pages/');
        window.location.href = isInPagesDir ? '../index.html' : 'index.html';
      };
    }
  }
  
  /**
   * Setup sidebar navigation
   * Note: Nav items use inline onclick handlers in the HTML, 
   * so we don't need to attach listeners here for basic navigation.
   * This function just handles the active state updates.
   */
  function setupSidebarNavigation() {
    // Navigation is handled by inline onclick handlers in the HTML
    // This keeps behavior consistent and avoids listener duplication issues
    console.log('Sidebar navigation ready');
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
    
    // Format role for display (capitalize first letter)
    const displayRole = userRole.charAt(0).toUpperCase() + userRole.slice(1);
    
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
   * Check admin access and show/hide admin-only nav items
   * These include: Admin Console, Inventory, Crew Planner, Crew Calendar
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
    
    const isAdmin = user.role === 'owner' || user.role === 'admin';
    console.log('Admin access check:', { role: user.role, isAdmin });
    
    // Show/hide all admin-only nav items
    const adminOnlyNavItems = document.querySelectorAll('.admin-only-nav');
    adminOnlyNavItems.forEach(item => {
      item.style.display = isAdmin ? 'flex' : 'none';
    });
    
    // Also check by specific IDs for backward compatibility
    const adminNavIds = ['adminNavItem', 'inventoryNavItem', 'crewPlannerNavItem', 'crewCalendarNavItem'];
    adminNavIds.forEach(id => {
      const navItem = document.getElementById(id);
      if (navItem) {
        navItem.style.display = isAdmin ? 'flex' : 'none';
      }
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
    
    // Hide bottom nav since dashboard uses sidebar
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
      bottomNav.style.display = 'none';
    }
  }
  
  // Expose functions globally
  window.initDashboardSidebar = initDashboardSidebar;
  window.updateDashboardUserInfo = updateUserInfo;
  
})();

