// To-Dos Page JavaScript
(function() {
  'use strict';

  let currentEventId = null;
  let todos = [];
  let users = [];
  let currentUser = null;
  let isOwnerOrAdmin = false;
  let editingTodoId = null;
  let statusFilter = 'all'; // 'all', 'pending', 'completed'
  let dueDateSort = 'none'; // 'none', 'asc', 'desc'

  // Initialize the page
  window.initPage = async function(eventId) {
    console.log('Initializing todos page with eventId:', eventId);
    currentEventId = eventId;
    
    if (!currentEventId) {
      console.error('No event ID provided');
      return;
    }

    await getCurrentUser();
    await checkPermissions();
    await loadUsers();
    await loadTodos();
    setupEventListeners();
    setupCustomDropdowns();
    setupSidebar();
  };

  // Get current user from token
  async function getCurrentUser() {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = {
          id: payload.id,
          role: payload.role,
          fullName: localStorage.getItem('fullName') || payload.fullName || 'User'
        };
      }
    } catch (e) {
      console.error('Error getting current user:', e);
    }
  }

  // Check if user is owner or admin
  async function checkPermissions() {
    try {
      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (response.ok) {
        const event = await response.json();
        const userId = currentUser?.id;
        
        // Update event title in header
        const titleEl = document.getElementById('tableTitle');
        if (titleEl) {
          titleEl.textContent = event.title || 'Untitled Event';
        }
        
        // Check if user is an owner or admin
        const isOwner = event.owners && event.owners.some(o => 
          (typeof o === 'string' && o === userId) || (o._id && o._id === userId)
        );
        const isAdmin = currentUser?.role === 'admin';
        
        isOwnerOrAdmin = isOwner || isAdmin;
        
        // Show/hide add task section based on permissions
        const addTaskSection = document.getElementById('addTaskSection');
        if (addTaskSection) {
          addTaskSection.style.display = isOwnerOrAdmin ? 'block' : 'none';
        }
      }
    } catch (e) {
      console.error('Error checking permissions:', e);
    }
  }

  // Load users for owner dropdown
  async function loadUsers() {
    try {
      const response = await fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (response.ok) {
        users = await response.json();
        populateOwnerDropdowns();
      }
    } catch (e) {
      console.error('Error loading users:', e);
    }
  }

  // Populate owner dropdowns
  function populateOwnerDropdowns() {
    // Populate custom dropdown for edit modal with search
    const editOwnerDropdown = document.getElementById('editOwnerDropdown');
    const editOwnerMenu = document.getElementById('editOwnerMenu');
    
    if (editOwnerMenu) {
      editOwnerMenu.innerHTML = '';
      
      // Add search input
      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'custom-dropdown-search';
      searchWrapper.innerHTML = `<input type="text" placeholder="Search owners..." autocomplete="off">`;
      editOwnerMenu.appendChild(searchWrapper);
      
      // Add options container
      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'custom-dropdown-options';
      editOwnerMenu.appendChild(optionsContainer);
      
      // Build and render options
      function renderOwnerOptions(filter = '') {
        const allOptions = [
          { value: '', label: 'Unassigned', icon: 'person_off' },
          ...users.map(user => ({
            value: user._id,
            label: user.name || user.fullName || 'Unknown User',
            icon: 'person',
            photo: user.photo
          }))
        ];
        
        const filtered = allOptions.filter(opt => 
          opt.label.toLowerCase().includes(filter.toLowerCase())
        );
        
        if (filtered.length === 0) {
          optionsContainer.innerHTML = `<div class="custom-dropdown-empty">No results found</div>`;
        } else {
          optionsContainer.innerHTML = filtered.map(opt => `
            <button type="button" class="custom-dropdown-option" data-value="${opt.value}">
              <div class="option-avatar">
                ${opt.photo 
                  ? `<img src="${opt.photo}" alt="${opt.label}">` 
                  : `<span class="material-symbols-outlined">${opt.icon}</span>`}
              </div>
              ${opt.label}
            </button>
          `).join('');
        }
        
        // Setup click handlers
        setupModalOwnerOptions();
      }
      
      renderOwnerOptions();
      
      // Search functionality
      const searchInput = searchWrapper.querySelector('input');
      searchInput.addEventListener('input', (e) => {
        renderOwnerOptions(e.target.value);
      });
      
      searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      // Store render function for later
      editOwnerMenu._renderOptions = renderOwnerOptions;
    }
    
    // Setup add task row dropdowns
    setupAddTaskDropdowns();
  }
  
  // Setup add task row custom dropdowns
  function setupAddTaskDropdowns() {
    // Status dropdown for add task
    setupAddTaskStatusDropdown();
    
    // Owner dropdown for add task
    setupAddTaskOwnerDropdown();
  }
  
  function setupAddTaskStatusDropdown() {
    const statusWrapper = document.getElementById('newStatusDropdown');
    let statusTrigger = document.getElementById('newStatusTrigger');
    const statusHidden = document.getElementById('newTaskStatus');
    
    if (!statusTrigger) return;
    
    // Remove existing menu if any
    let statusMenu = document.getElementById('newStatusMenu');
    if (statusMenu) statusMenu.remove();
    
    // Create status menu
    statusMenu = document.createElement('div');
    statusMenu.id = 'newStatusMenu';
    statusMenu.className = 'add-task-dropdown-menu';
    statusMenu.style.cssText = 'display: none; position: fixed; z-index: 999999; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); overflow: hidden;';
    
    const statusOptions = [
      { value: 'todo', label: 'To Do' },
      { value: 'in-progress', label: 'In Progress' },
      { value: 'done', label: 'Done' }
    ];
    
    statusOptions.forEach(opt => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'inline-dropdown-option';
      option.dataset.value = opt.value;
      option.style.cssText = 'display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; background: transparent; border: none; color: #e0e0e0; font-size: 13px; cursor: pointer; text-align: left;';
      option.innerHTML = `
        <span class="status-dot status-${opt.value}"></span>
        ${opt.label}
      `;
      option.onmouseover = () => option.style.background = '#2a2a2a';
      option.onmouseout = () => option.style.background = 'transparent';
      option.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        statusMenu.style.display = 'none';
        statusHidden.value = opt.value;
        // Get current trigger (may have been replaced)
        const currentTrigger = document.getElementById('newStatusTrigger');
        if (currentTrigger) {
          currentTrigger.className = `inline-dropdown-trigger status-${opt.value}`;
          const statusText = currentTrigger.querySelector('.status-text');
          if (statusText) statusText.textContent = opt.label;
        }
      };
      statusMenu.appendChild(option);
    });
    
    document.body.appendChild(statusMenu);
    
    // Use onclick to replace any existing handler
    statusTrigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Close other dropdowns but not this one
      const ownerMenu = document.getElementById('newOwnerMenu');
      if (ownerMenu) ownerMenu.style.display = 'none';
      document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.style.display = 'none');
      
      const isOpen = statusMenu.style.display === 'block';
      if (isOpen) {
        statusMenu.style.display = 'none';
      } else {
        const rect = statusTrigger.getBoundingClientRect();
        statusMenu.style.display = 'block';
        statusMenu.style.top = `${rect.bottom + 4}px`;
        statusMenu.style.left = `${rect.left}px`;
        statusMenu.style.minWidth = `${Math.max(rect.width, 140)}px`;
      }
    };
  }
  
  function setupAddTaskOwnerDropdown() {
    const ownerWrapper = document.getElementById('newOwnerDropdown');
    let ownerTrigger = document.getElementById('newOwnerTrigger');
    const ownerHidden = document.getElementById('newTaskOwner');
    
    if (!ownerTrigger) return;
    
    // Remove existing menu if any
    let ownerMenu = document.getElementById('newOwnerMenu');
    if (ownerMenu) ownerMenu.remove();
    
    // Create owner menu with search
    ownerMenu = document.createElement('div');
    ownerMenu.id = 'newOwnerMenu';
    ownerMenu.className = 'add-task-dropdown-menu';
    ownerMenu.style.cssText = 'display: none; position: fixed; z-index: 999999; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); overflow: hidden;';
    
    // Search input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'custom-dropdown-search';
    searchWrapper.style.cssText = 'padding: 8px; border-bottom: 1px solid #333;';
    searchWrapper.innerHTML = `<input type="text" placeholder="Search owners..." autocomplete="off" style="width: 100%; padding: 8px 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 6px; color: #fff; font-size: 13px; outline: none;">`;
    ownerMenu.appendChild(searchWrapper);
    
    // Options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-dropdown-options';
    optionsContainer.style.cssText = 'max-height: 200px; overflow-y: auto;';
    ownerMenu.appendChild(optionsContainer);
    
    // Build options
    const allOptions = [
      { value: '', label: 'Unassigned', icon: 'person_off' },
      ...users.map(user => ({
        value: user._id,
        label: user.name || user.fullName || 'Unknown User',
        icon: 'person'
      }))
    ];
    
    function renderOptions(filter = '') {
      const filtered = allOptions.filter(opt => 
        opt.label.toLowerCase().includes(filter.toLowerCase())
      );
      
      if (filtered.length === 0) {
        optionsContainer.innerHTML = `<div style="padding: 12px; color: #888; text-align: center; font-size: 13px;">No results found</div>`;
      } else {
        optionsContainer.innerHTML = '';
        filtered.forEach(opt => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'inline-dropdown-option';
          option.dataset.value = opt.value;
          option.style.cssText = 'display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; background: transparent; border: none; color: #e0e0e0; font-size: 13px; cursor: pointer; text-align: left;';
          option.innerHTML = `
            <span class="material-symbols-outlined" style="font-size: 18px; color: #888;">${opt.icon}</span>
            ${opt.label}
          `;
          option.onmouseover = () => option.style.background = '#2a2a2a';
          option.onmouseout = () => option.style.background = 'transparent';
          option.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            ownerHidden.value = opt.value;
            
            // Get current trigger (may have been replaced)
            const currentTrigger = document.getElementById('newOwnerTrigger');
            if (currentTrigger) {
              const ownerText = currentTrigger.querySelector('.owner-text');
              if (ownerText) ownerText.textContent = opt.label;
            }
            
            ownerMenu.style.display = 'none';
          };
          optionsContainer.appendChild(option);
        });
      }
    }
    
    renderOptions();
    
    document.body.appendChild(ownerMenu);
    
    // Search filtering
    const searchInput = searchWrapper.querySelector('input');
    searchInput.oninput = (e) => renderOptions(e.target.value);
    searchInput.onclick = (e) => e.stopPropagation();
    
    // Use onclick to replace any existing handler
    ownerTrigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Close other dropdowns but not this one
      const statusMenu = document.getElementById('newStatusMenu');
      if (statusMenu) statusMenu.style.display = 'none';
      document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.style.display = 'none');
      
      const isOpen = ownerMenu.style.display === 'block';
      if (isOpen) {
        ownerMenu.style.display = 'none';
      } else {
        const rect = ownerTrigger.getBoundingClientRect();
        ownerMenu.style.display = 'block';
        ownerMenu.style.top = `${rect.bottom + 4}px`;
        ownerMenu.style.left = `${rect.left}px`;
        ownerMenu.style.minWidth = `${Math.max(rect.width, 200)}px`;
        
        // Reset search and focus
        searchInput.value = '';
        renderOptions();
        setTimeout(() => searchInput.focus(), 50);
      }
    };
  }
  
  // Setup custom dropdowns - only document click handler
  function setupCustomDropdowns() {
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      const isInsideDropdown = e.target.closest('.custom-dropdown') || 
          e.target.closest('.inline-custom-dropdown') || 
          e.target.closest('.inline-status-dropdown') ||
          e.target.closest('.inline-dropdown-menu') ||
          e.target.closest('.custom-dropdown-menu') ||
          e.target.closest('.add-task-dropdown-menu') ||
          e.target.closest('.inline-dropdown-trigger');
      
      if (!isInsideDropdown) {
        closeAllDropdowns();
      }
    });
  }
  
  // Setup modal dropdowns when modal is opened
  function setupModalDropdowns() {
    setupModalStatusDropdown();
    setupModalOwnerDropdown();
  }
  
  function setupModalStatusDropdown() {
    const statusDropdown = document.getElementById('editStatusDropdown');
    const statusTrigger = document.getElementById('editStatusTrigger');
    const statusHidden = document.getElementById('editTaskStatus');
    const statusMenu = statusDropdown?.querySelector('.custom-dropdown-menu');
    
    if (!statusTrigger || !statusMenu) return;
    
    // Use onclick to replace any existing handler
    statusTrigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const wasOpen = statusDropdown.classList.contains('open');
      closeAllDropdowns();
      
      if (!wasOpen) {
        statusDropdown.classList.add('open');
        statusTrigger.classList.add('open');
        positionDropdownMenu(statusTrigger, statusMenu);
      }
    };
    
    // Setup option click handlers
    statusDropdown.querySelectorAll('.custom-dropdown-option').forEach(option => {
      option.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const value = option.dataset.value;
        statusHidden.value = value;
        statusTrigger.querySelector('.dropdown-value').textContent = option.textContent.trim();
        statusDropdown.classList.remove('open');
        statusTrigger.classList.remove('open');
        
        // Update selected state
        statusDropdown.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
      };
    });
  }
  
  function setupModalOwnerDropdown() {
    const ownerDropdown = document.getElementById('editOwnerDropdown');
    const ownerTrigger = document.getElementById('editOwnerTrigger');
    const ownerHidden = document.getElementById('editTaskOwner');
    const ownerMenu = document.getElementById('editOwnerMenu');
    
    if (!ownerTrigger || !ownerMenu) return;
    
    // Use onclick to replace any existing handler
    ownerTrigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const wasOpen = ownerDropdown.classList.contains('open');
      closeAllDropdowns();
      
      if (!wasOpen) {
        ownerDropdown.classList.add('open');
        ownerTrigger.classList.add('open');
        positionDropdownMenu(ownerTrigger, ownerMenu);
        
        // Focus search input
        const searchInput = ownerMenu.querySelector('.custom-dropdown-search input');
        if (searchInput) {
          searchInput.value = '';
          // Re-render options
          if (ownerMenu._renderOptions) ownerMenu._renderOptions('');
          setTimeout(() => searchInput.focus(), 50);
        }
      }
    };
    
    // Setup option click handlers
    setupModalOwnerOptions();
  }
  
  // Setup owner dropdown options (called after population)
  function setupModalOwnerOptions() {
    const ownerDropdown = document.getElementById('editOwnerDropdown');
    const ownerTrigger = document.getElementById('editOwnerTrigger');
    const ownerHidden = document.getElementById('editTaskOwner');
    const ownerMenu = document.getElementById('editOwnerMenu');
    
    if (!ownerMenu) return;
    
    const optionsContainer = ownerMenu.querySelector('.custom-dropdown-options');
    if (!optionsContainer) return;
    
    optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(option => {
      option.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const value = option.dataset.value;
        ownerHidden.value = value;
        
        const valueEl = ownerTrigger?.querySelector('.dropdown-value');
        if (valueEl) {
          if (value) {
            valueEl.textContent = option.textContent.trim();
            valueEl.classList.remove('placeholder');
          } else {
            valueEl.textContent = 'Unassigned';
            valueEl.classList.add('placeholder');
          }
        }
        
        ownerDropdown.classList.remove('open');
        if (ownerTrigger) ownerTrigger.classList.remove('open');
        
        // Update selected state
        optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
      };
    });
  }
  
  // Create searchable dropdown component (like crew page)
  function createSearchableDropdown(options, currentValue, placeholder, onSelect) {
    const container = document.createElement('div');
    container.className = 'custom-dropdown searchable-dropdown';
    
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-dropdown-trigger';
    trigger.innerHTML = `
      <span class="dropdown-value ${!currentValue ? 'placeholder' : ''}">${currentValue || placeholder}</span>
      <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
    `;
    
    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu searchable-menu';
    
    // Search input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'custom-dropdown-search';
    searchWrapper.innerHTML = `<input type="text" placeholder="Search..." autocomplete="off">`;
    
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-dropdown-options';
    
    let currentSelected = currentValue;
    
    // Render options
    function renderOptions(filter = '') {
      const filtered = options.filter(opt => 
        opt.label.toLowerCase().includes(filter.toLowerCase())
      );
      
      if (filtered.length === 0 && filter) {
        optionsContainer.innerHTML = `<div class="custom-dropdown-empty">No results found</div>`;
      } else {
        optionsContainer.innerHTML = filtered.map(opt => `
          <button type="button" class="custom-dropdown-option ${opt.value === currentSelected ? 'selected' : ''}" data-value="${opt.value}">
            ${opt.icon ? `<span class="material-symbols-outlined">${opt.icon}</span>` : ''}
            ${opt.label}
          </button>
        `).join('');
      }
      
      // Attach click handlers
      optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(option => {
        option.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const value = option.dataset.value;
          currentSelected = value;
          
          const selectedOpt = options.find(o => o.value === value);
          trigger.querySelector('.dropdown-value').textContent = selectedOpt ? selectedOpt.label : placeholder;
          trigger.querySelector('.dropdown-value').classList.toggle('placeholder', !value);
          
          closeDropdown();
          onSelect(value);
        });
      });
    }
    
    renderOptions();
    
    menu.appendChild(searchWrapper);
    menu.appendChild(optionsContainer);
    container.appendChild(trigger);
    container.appendChild(menu);
    
    let isOpen = false;
    
    function openDropdown() {
      isOpen = true;
      container.classList.add('open');
      
      // Position the menu using fixed positioning
      const triggerRect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const menuHeight = Math.min(300, viewportHeight * 0.5);
      
      // Check if menu should open above or below
      const spaceBelow = viewportHeight - triggerRect.bottom - 10;
      const spaceAbove = triggerRect.top - 10;
      
      if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
        menu.style.top = `${triggerRect.bottom + 4}px`;
        menu.style.bottom = 'auto';
        menu.style.maxHeight = `${Math.min(menuHeight, spaceBelow)}px`;
      } else {
        menu.style.bottom = `${viewportHeight - triggerRect.top + 4}px`;
        menu.style.top = 'auto';
        menu.style.maxHeight = `${Math.min(menuHeight, spaceAbove)}px`;
      }
      
      menu.style.left = `${triggerRect.left}px`;
      menu.style.width = `${Math.max(triggerRect.width, 200)}px`;
      menu.style.position = 'fixed';
      menu.style.zIndex = '999999';
      
      const searchInput = searchWrapper.querySelector('input');
      searchInput.value = '';
      renderOptions();
      setTimeout(() => searchInput.focus(), 50);
    }
    
    function closeDropdown() {
      isOpen = false;
      container.classList.remove('open');
    }
    
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) {
        closeDropdown();
      } else {
        closeAllDropdowns();
        openDropdown();
      }
    });
    
    // Search filtering
    const searchInput = searchWrapper.querySelector('input');
    searchInput.addEventListener('input', (e) => {
      renderOptions(e.target.value);
    });
    
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
      }
    });
    
    // Close on outside click
    container.closeDropdown = closeDropdown;
    container.setValue = (value) => {
      currentSelected = value;
      const selectedOpt = options.find(o => o.value === value);
      trigger.querySelector('.dropdown-value').textContent = selectedOpt ? selectedOpt.label : placeholder;
      trigger.querySelector('.dropdown-value').classList.toggle('placeholder', !value);
    };
    
    return container;
  }
  
  // Position dropdown menu relative to trigger - move to body to escape transform containing block
  function positionDropdownMenu(trigger, menu) {
    const rect = trigger.getBoundingClientRect();
    const menuHeight = 280; // max-height
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    // Move menu to body to escape modal's transform containing block
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
    
    // Set all necessary styles to ensure visibility (override CSS rules)
    // Use overflow: hidden on menu, let inner .custom-dropdown-options scroll
    menu.style.cssText = `
      position: fixed !important;
      z-index: 999999 !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: #1a1a1a !important;
      border: 1px solid #333 !important;
      border-radius: 8px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6) !important;
      overflow: hidden !important;
      transform: none !important;
      left: ${rect.left}px;
      width: ${Math.max(rect.width, 200)}px;
    `;
    
    // Position below by default, above if not enough space
    if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.bottom = 'auto';
    } else {
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      menu.style.top = 'auto';
    }
    
    // Set max-height on the options container for scrolling
    const optionsContainer = menu.querySelector('.custom-dropdown-options');
    if (optionsContainer) {
      const availableHeight = Math.min(menuHeight, Math.max(spaceBelow, spaceAbove) - 60);
      optionsContainer.style.maxHeight = `${availableHeight}px`;
      optionsContainer.style.overflowY = 'auto';
    }
  }
  
  function closeAllDropdowns() {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.custom-dropdown-trigger').forEach(t => t.classList.remove('open'));
    // Hide all inline dropdown menus
    document.querySelectorAll('.inline-dropdown-menu').forEach(m => m.style.display = 'none');
    // Hide all custom dropdown menus (including ones moved to body)
    document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.style.display = 'none');
    // Hide add task dropdown menus
    document.querySelectorAll('.add-task-dropdown-menu').forEach(m => m.style.display = 'none');
  }
  
  // Create inline status dropdown for table rows
  function createInlineStatusDropdown(todo) {
    const wrapper = document.createElement('div');
    wrapper.className = 'inline-status-dropdown';
    
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `inline-dropdown-trigger status-${todo.status}`;
    trigger.innerHTML = `
      <span class="status-dot"></span>
      <span class="status-text">${getStatusLabel(todo.status)}</span>
      <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
    `;
    
    const menu = document.createElement('div');
    menu.className = 'inline-dropdown-menu';
    menu.style.display = 'none';
    
    const options = [
      { value: 'todo', label: 'To Do' },
      { value: 'in-progress', label: 'In Progress' },
      { value: 'done', label: 'Done' }
    ];
    
    options.forEach(opt => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `inline-dropdown-option ${opt.value === todo.status ? 'selected' : ''}`;
      option.dataset.value = opt.value;
      option.innerHTML = `
        <span class="status-dot status-${opt.value}"></span>
        ${opt.label}
      `;
      option.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.style.display = 'none';
        trigger.className = `inline-dropdown-trigger status-${opt.value}`;
        trigger.querySelector('.status-text').textContent = opt.label;
        updateTodoStatus(todo._id, opt.value);
      });
      menu.appendChild(option);
    });
    
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAllDropdowns();
      
      const isOpen = menu.style.display === 'block';
      if (!isOpen) {
        const rect = trigger.getBoundingClientRect();
        menu.style.display = 'block';
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.minWidth = `${rect.width}px`;
        menu.style.zIndex = '999999';
      }
    });
    
    wrapper.appendChild(trigger);
    document.body.appendChild(menu); // Append to body to escape table overflow
    
    return wrapper;
  }
  

  let isInitialLoad = true;
  
  // Load todos from API
  async function loadTodos(showLoading = true) {
    const loadingEl = document.getElementById('todosLoading');
    const emptyMessageEl = document.getElementById('todosEmptyMessage');
    const tableBody = document.getElementById('todosTableBody');
    
    try {
      // Only show loading on initial load
      if (showLoading && isInitialLoad && loadingEl) {
        loadingEl.style.display = 'flex';
      }
      if (emptyMessageEl) emptyMessageEl.style.display = 'none';
      
      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}/todos`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        todos = data.todos || [];
        renderTodos();
        updateProgress();
        isInitialLoad = false;
      } else {
        console.error('Error loading todos:', response.status);
      }
    } catch (e) {
      console.error('Error loading todos:', e);
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  // Render todos table
  function renderTodos() {
    const tableBody = document.getElementById('todosTableBody');
    const emptyMessageEl = document.getElementById('todosEmptyMessage');
    const searchValue = document.getElementById('searchTodos')?.value?.toLowerCase() || '';
    
    if (!tableBody) return;
    
    // Start with all todos
    let filteredTodos = [...todos];
    
    // Apply status filter
    if (statusFilter === 'pending') {
      filteredTodos = filteredTodos.filter(todo => todo.status === 'todo' || todo.status === 'in-progress');
    } else if (statusFilter === 'completed') {
      filteredTodos = filteredTodos.filter(todo => todo.status === 'done');
    }
    
    // Apply search filter
    if (searchValue) {
      filteredTodos = filteredTodos.filter(todo => 
        todo.task.toLowerCase().includes(searchValue) ||
        (todo.notes && todo.notes.toLowerCase().includes(searchValue)) ||
        (todo.owner?.fullName && todo.owner.fullName.toLowerCase().includes(searchValue))
      );
    }
    
    // Apply due date sorting
    if (dueDateSort !== 'none') {
      filteredTodos.sort((a, b) => {
        const dateA = a.dueDate ? new Date(a.dueDate) : null;
        const dateB = b.dueDate ? new Date(b.dueDate) : null;
        
        // Handle null dates - put them at the end
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        
        const diff = dateA - dateB;
        return dueDateSort === 'asc' ? diff : -diff;
      });
    }
    
    // Show/hide empty message
    if (emptyMessageEl) {
      if (filteredTodos.length === 0) {
        emptyMessageEl.style.display = 'flex';
        const msgP = emptyMessageEl.querySelector('p');
        if (msgP) {
          if (searchValue) {
            msgP.textContent = 'No tasks match your search';
          } else if (statusFilter === 'pending') {
            msgP.textContent = 'No pending tasks';
          } else if (statusFilter === 'completed') {
            msgP.textContent = 'No completed tasks';
          } else {
            msgP.textContent = 'No tasks yet. Add your first task below.';
          }
        }
      } else {
        emptyMessageEl.style.display = 'none';
      }
    }
    
    tableBody.innerHTML = '';
    
    filteredTodos.forEach(todo => {
      const row = createTodoRow(todo);
      tableBody.appendChild(row);
    });
  }

  // Create a todo row
  function createTodoRow(todo) {
    const row = document.createElement('tr');
    row.dataset.id = todo._id;
    
    const isAssignee = todo.owner && todo.owner._id === currentUser?.id;
    const canEdit = isOwnerOrAdmin || isAssignee;
    
    // Check if overdue (not completed and past due)
    const dueInfo = formatDueDate(todo.dueDate);
    const isOverdue = dueInfo.className === 'overdue' && todo.status !== 'done';
    row.className = `todo-row${isOverdue ? ' overdue-row' : ''}`;
    
    // Task column
    const taskCell = document.createElement('td');
    taskCell.className = 'col-task';
    taskCell.textContent = todo.task;
    row.appendChild(taskCell);
    
    // Status column
    const statusCell = document.createElement('td');
    statusCell.className = 'col-status';
    
    if (canEdit) {
      const statusDropdown = createInlineStatusDropdown(todo);
      statusCell.appendChild(statusDropdown);
    } else {
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge status-${todo.status}`;
      statusBadge.textContent = getStatusLabel(todo.status);
      statusCell.appendChild(statusBadge);
    }
    row.appendChild(statusCell);
    
    // Due Date column
    const dueDateCell = document.createElement('td');
    dueDateCell.className = 'col-due';
    // Don't show overdue styling for completed tasks
    const dueDateClass = isOverdue ? 'overdue' : (dueInfo.className === 'overdue' ? '' : dueInfo.className);
    dueDateCell.innerHTML = `<span class="due-date ${dueDateClass}">${dueInfo.text}</span>`;
    row.appendChild(dueDateCell);
    
    // Owner column
    const ownerCell = document.createElement('td');
    ownerCell.className = 'col-owner';
    if (todo.owner) {
      ownerCell.innerHTML = `
        <div class="owner-info">
          <div class="owner-avatar">
            ${todo.owner.photo 
              ? `<img src="${todo.owner.photo}" alt="${todo.owner.fullName}">` 
              : `<span class="material-symbols-outlined">person</span>`}
          </div>
          <span class="owner-name">${todo.owner.fullName || 'Unknown'}</span>
        </div>
      `;
    } else {
      ownerCell.innerHTML = '<span class="unassigned">Unassigned</span>';
    }
    row.appendChild(ownerCell);
    
    // Notes column
    const notesCell = document.createElement('td');
    notesCell.className = 'col-notes';
    
    if (canEdit) {
      const notesInput = document.createElement('input');
      notesInput.type = 'text';
      notesInput.className = 'notes-input';
      notesInput.value = todo.notes || '';
      notesInput.placeholder = 'Add notes...';
      notesInput.addEventListener('blur', (e) => {
        if (e.target.value !== (todo.notes || '')) {
          updateTodoNotes(todo._id, e.target.value);
        }
      });
      notesInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.target.blur();
        }
      });
      notesCell.appendChild(notesInput);
    } else {
      notesCell.textContent = todo.notes || '';
    }
    row.appendChild(notesCell);
    
    // Actions column
    const actionsCell = document.createElement('td');
    actionsCell.className = 'col-actions';
    
    if (isOwnerOrAdmin) {
      const actionsBtn = document.createElement('button');
      actionsBtn.className = 'actions-btn';
      actionsBtn.innerHTML = '<span class="material-symbols-outlined">more_vert</span>';
      actionsBtn.addEventListener('click', (e) => showActionsMenu(e, todo));
      actionsCell.appendChild(actionsBtn);
    }
    row.appendChild(actionsCell);
    
    return row;
  }

  // Get status label
  function getStatusLabel(status) {
    const labels = {
      'todo': 'To Do',
      'in-progress': 'In Progress',
      'done': 'Done'
    };
    return labels[status] || status;
  }

  // Format due date with relative text and colors
  function formatDueDate(dueDate) {
    if (!dueDate) return { text: '—', className: '' };
    
    // Parse the date string in a timezone-agnostic way
    // Extract just the date portion (YYYY-MM-DD) to avoid UTC conversion issues
    let dateStr = dueDate;
    if (typeof dueDate === 'string' && dueDate.includes('T')) {
      dateStr = dueDate.split('T')[0]; // Get just YYYY-MM-DD
    }
    
    // Parse as local date (not UTC)
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    
    const diffDays = Math.round((date - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      // Overdue
      const daysAgo = Math.abs(diffDays);
      return {
        text: daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`,
        className: 'overdue'
      };
    } else if (diffDays === 0) {
      return { text: 'Today', className: 'due-soon' };
    } else if (diffDays === 1) {
      return { text: 'Tomorrow', className: 'due-soon' };
    } else if (diffDays <= 3) {
      return { text: `In ${diffDays} days`, className: 'due-soon' };
    } else {
      // Format as "Jan 30" style
      const options = { month: 'short', day: 'numeric' };
      return { text: date.toLocaleDateString('en-US', options), className: '' };
    }
  }

  // Update progress bar
  function updateProgress() {
    const progressText = document.getElementById('progressText');
    const progressFill = document.getElementById('progressFill');
    
    const total = todos.length;
    const completed = todos.filter(t => t.status === 'done').length;
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    
    if (progressText) {
      progressText.textContent = `${completed} / ${total} completed`;
    }
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
    }
  }

  // Show actions menu
  function showActionsMenu(e, todo) {
    e.stopPropagation();
    
    // Remove existing menus
    document.querySelectorAll('.actions-menu').forEach(m => m.remove());
    
    const menu = document.createElement('div');
    menu.className = 'actions-menu';
    menu.innerHTML = `
      <button class="action-item edit-action">
        <span class="material-symbols-outlined">edit</span>
        Edit
      </button>
      <button class="action-item delete-action">
        <span class="material-symbols-outlined">delete</span>
        Delete
      </button>
    `;
    
    // Position menu
    const rect = e.target.closest('.actions-btn').getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    
    // Add event listeners
    menu.querySelector('.edit-action').addEventListener('click', () => {
      menu.remove();
      openEditModal(todo);
    });
    
    menu.querySelector('.delete-action').addEventListener('click', () => {
      menu.remove();
      openDeleteModal(todo);
    });
    
    document.body.appendChild(menu);
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      });
    }, 0);
  }

  // Open edit modal
  function openEditModal(todo) {
    editingTodoId = todo._id;
    
    // Set task input
    document.getElementById('editTaskInput').value = todo.task;
    
    // Set status custom dropdown
    const statusHidden = document.getElementById('editTaskStatus');
    const statusTrigger = document.getElementById('editStatusTrigger');
    const statusDropdown = document.getElementById('editStatusDropdown');
    if (statusHidden) statusHidden.value = todo.status;
    if (statusTrigger) {
      const statusLabels = { 'todo': 'To Do', 'in-progress': 'In Progress', 'done': 'Done' };
      statusTrigger.querySelector('.dropdown-value').textContent = statusLabels[todo.status] || 'To Do';
    }
    if (statusDropdown) {
      statusDropdown.querySelectorAll('.custom-dropdown-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.value === todo.status);
      });
    }
    
    // Set due date
    document.getElementById('editTaskDueDate').value = todo.dueDate 
      ? new Date(todo.dueDate).toISOString().split('T')[0] 
      : '';
    
    // Set owner custom dropdown
    const ownerHidden = document.getElementById('editTaskOwner');
    const ownerTrigger = document.getElementById('editOwnerTrigger');
    const ownerMenu = document.getElementById('editOwnerMenu');
    const ownerId = todo.owner?._id || '';
    const ownerName = todo.owner?.fullName || todo.owner?.name || '';
    
    if (ownerHidden) ownerHidden.value = ownerId;
    if (ownerTrigger) {
      const valueEl = ownerTrigger.querySelector('.dropdown-value');
      if (ownerId && ownerName) {
        valueEl.textContent = ownerName;
        valueEl.classList.remove('placeholder');
      } else {
        valueEl.textContent = 'Unassigned';
        valueEl.classList.add('placeholder');
      }
    }
    if (ownerMenu) {
      const optionsContainer = ownerMenu.querySelector('.custom-dropdown-options');
      if (optionsContainer) {
        optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.value === ownerId);
        });
      }
    }
    
    // Set notes
    document.getElementById('editTaskNotes').value = todo.notes || '';
    
    // Show modal
    document.getElementById('editTaskModal').classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // Setup dropdown handlers after modal is visible
    setTimeout(() => {
      setupModalDropdowns();
    }, 50);
  }

  // Close edit modal
  function closeEditModal() {
    editingTodoId = null;
    closeAllDropdowns();
    document.getElementById('editTaskModal').classList.remove('show');
    document.body.style.overflow = '';
  }

  // Save edit
  async function saveEdit() {
    if (!editingTodoId) return;
    
    const task = document.getElementById('editTaskInput').value.trim();
    if (!task) {
      alert('Task description is required');
      return;
    }
    
    const updates = {
      task,
      status: document.getElementById('editTaskStatus').value,
      dueDate: document.getElementById('editTaskDueDate').value || null,
      owner: document.getElementById('editTaskOwner').value || null,
      notes: document.getElementById('editTaskNotes').value.trim()
    };
    
    try {
      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}/todos/${editingTodoId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(updates)
      });
      
      if (response.ok) {
        await loadTodos(false);
        closeEditModal();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update task');
      }
    } catch (e) {
      console.error('Error updating todo:', e);
      alert('Error updating task');
    }
  }

  // Open delete modal
  function openDeleteModal(todo) {
    editingTodoId = todo._id;
    document.getElementById('deleteTaskName').textContent = todo.task;
    document.getElementById('deleteTaskModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  // Close delete modal
  function closeDeleteModal() {
    editingTodoId = null;
    document.getElementById('deleteTaskModal').classList.remove('show');
    document.body.style.overflow = '';
  }

  // Confirm delete
  async function confirmDelete() {
    if (!editingTodoId) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}/todos/${editingTodoId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (response.ok) {
        await loadTodos(false);
        closeDeleteModal();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to delete task');
      }
    } catch (e) {
      console.error('Error deleting todo:', e);
      alert('Error deleting task');
    }
  }

  // Update todo status
  async function updateTodoStatus(todoId, status) {
    try {
      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}/todos/${todoId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status })
      });
      
      if (response.ok) {
        // Update local state
        const todo = todos.find(t => t._id === todoId);
        if (todo) todo.status = status;
        updateProgress();
        
        // Update select styling
        const row = document.querySelector(`tr[data-id="${todoId}"]`);
        if (row) {
          const select = row.querySelector('.status-select');
          if (select) {
            select.className = `status-select status-${status}`;
          }
        }
      }
    } catch (e) {
      console.error('Error updating status:', e);
    }
  }

  // Update todo notes
  async function updateTodoNotes(todoId, notes) {
    try {
      await fetch(`${API_BASE}/api/tables/${currentEventId}/todos/${todoId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ notes })
      });
    } catch (e) {
      console.error('Error updating notes:', e);
    }
  }

  // Show add task row
  function showAddTaskRow() {
    const addTaskRow = document.getElementById('addTaskRow');
    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskRow) {
      addTaskRow.classList.add('active');
      if (addTaskBtn) addTaskBtn.style.display = 'none';
      document.getElementById('newTaskInput')?.focus();
      
      // Auto-select current user by default
      if (currentUser) {
        const ownerHidden = document.getElementById('newTaskOwner');
        const ownerTrigger = document.getElementById('newOwnerTrigger');
        if (ownerHidden) ownerHidden.value = currentUser.id;
        if (ownerTrigger) {
          const ownerText = ownerTrigger.querySelector('.owner-text');
          if (ownerText) ownerText.textContent = currentUser.fullName || 'Me';
        }
      }
    }
  }

  // Hide add task row
  function hideAddTaskRow() {
    const addTaskRow = document.getElementById('addTaskRow');
    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskRow) {
      addTaskRow.classList.remove('active');
      if (addTaskBtn) addTaskBtn.style.display = 'flex';
      // Clear inputs
      const newTaskInput = document.getElementById('newTaskInput');
      const newTaskStatus = document.getElementById('newTaskStatus');
      const newTaskDueDate = document.getElementById('newTaskDueDate');
      const newTaskOwner = document.getElementById('newTaskOwner');
      const newTaskNotes = document.getElementById('newTaskNotes');
      const statusTrigger = document.getElementById('newStatusTrigger');
      const ownerTrigger = document.getElementById('newOwnerTrigger');
      
      if (newTaskInput) newTaskInput.value = '';
      if (newTaskStatus) newTaskStatus.value = 'todo';
      if (newTaskDueDate) newTaskDueDate.value = '';
      if (newTaskOwner) newTaskOwner.value = '';
      if (newTaskNotes) newTaskNotes.value = '';
      
      // Reset dropdown displays
      if (statusTrigger) {
        statusTrigger.className = 'inline-dropdown-trigger status-todo';
        const statusText = statusTrigger.querySelector('.status-text');
        if (statusText) statusText.textContent = 'To Do';
      }
      if (ownerTrigger) {
        const ownerText = ownerTrigger.querySelector('.owner-text');
        if (ownerText) ownerText.textContent = 'Select Owner';
      }
    }
  }

  // Save new task
  async function saveNewTask() {
    const task = document.getElementById('newTaskInput').value.trim();
    if (!task) {
      document.getElementById('newTaskInput').focus();
      return;
    }
    
    const newTodo = {
      task,
      status: document.getElementById('newTaskStatus').value,
      dueDate: document.getElementById('newTaskDueDate').value || null,
      owner: document.getElementById('newTaskOwner').value || null,
      notes: document.getElementById('newTaskNotes').value.trim()
    };
    
    try {
      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}/todos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(newTodo)
      });
      
      if (response.ok) {
        await loadTodos(false);
        hideAddTaskRow();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to add task');
      }
    } catch (e) {
      console.error('Error adding todo:', e);
      alert('Error adding task');
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    // Add task button
    const addTaskBtn = document.getElementById('addTaskBtn');
    if (addTaskBtn) {
      addTaskBtn.addEventListener('click', showAddTaskRow);
    }
    
    // Save/Cancel new task
    const saveTaskBtn = document.getElementById('saveTaskBtn');
    if (saveTaskBtn) {
      saveTaskBtn.addEventListener('click', saveNewTask);
    }
    
    const cancelTaskBtn = document.getElementById('cancelTaskBtn');
    if (cancelTaskBtn) {
      cancelTaskBtn.addEventListener('click', hideAddTaskRow);
    }
    
    // Enter key to save new task
    const newTaskInput = document.getElementById('newTaskInput');
    if (newTaskInput) {
      newTaskInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveNewTask();
      });
    }
    
    // Search
    const searchInput = document.getElementById('searchTodos');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderTodos();
      });
    }
    
    // Status filter tabs
    setupStatusFilterTabs();
    
    // Update sort icon
    updateSortIcon();
    
    // Edit modal buttons
    document.getElementById('closeEditModal')?.addEventListener('click', closeEditModal);
    document.getElementById('cancelEditBtn')?.addEventListener('click', closeEditModal);
    document.getElementById('saveEditBtn')?.addEventListener('click', saveEdit);
    document.getElementById('editTaskModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'editTaskModal') closeEditModal();
    });
    
    // Delete modal buttons
    document.getElementById('closeDeleteModal')?.addEventListener('click', closeDeleteModal);
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', closeDeleteModal);
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDelete);
    document.getElementById('deleteTaskModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'deleteTaskModal') closeDeleteModal();
    });
  }

  // Setup sidebar
  function setupSidebar() {
    // Update user info
    const userNameEl = document.getElementById('sidebarUserName');
    
    if (userNameEl && currentUser) {
      userNameEl.textContent = currentUser.fullName;
    }
    
    // Mobile menu toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('todosSidebar');
    const overlay = document.getElementById('todosSidebarOverlay');
    
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('open');
      });
    }
    
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
      });
    }
  }

  // Setup status filter tabs
  function setupStatusFilterTabs() {
    const tabs = document.querySelectorAll('.todos-filter-bar .status-tab');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Update active state
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update filter
        statusFilter = tab.dataset.status;
        
        // Re-render
        renderTodos();
      });
    });
  }

  // Toggle due date sort
  window.toggleDueDateSort = function() {
    // Cycle through: none -> asc -> desc -> none
    if (dueDateSort === 'none') {
      dueDateSort = 'asc';
    } else if (dueDateSort === 'asc') {
      dueDateSort = 'desc';
    } else {
      dueDateSort = 'none';
    }
    
    updateSortIcon();
    renderTodos();
  };

  // Update sort icon based on current sort state
  function updateSortIcon() {
    const icon = document.getElementById('dueDateSortIcon');
    const header = document.getElementById('dueDateHeader');
    
    if (!icon || !header) return;
    
    if (dueDateSort === 'asc') {
      icon.textContent = 'arrow_upward';
      header.classList.add('sorted');
    } else if (dueDateSort === 'desc') {
      icon.textContent = 'arrow_downward';
      header.classList.add('sorted');
    } else {
      icon.textContent = 'unfold_more';
      header.classList.remove('sorted');
    }
  }

})();

