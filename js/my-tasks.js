// My Tasks Page JavaScript - All tasks across all events + General Tasks
(function() {
  'use strict';

  let tasks = [];
  let generalTasks = [];
  let users = [];
  let currentUser = null;
  let isAdmin = false;
  let editingTaskId = null;
  let editingEventId = null;
  let editingGeneralTaskId = null;
  let myTasksOnly = localStorage.getItem('myTasksFilter') !== 'false'; // Default to true (my tasks only)
  let statusFilter = localStorage.getItem('myTasksStatusFilter') || 'all'; // 'all', 'pending', 'completed'
  let generalStatusFilter = localStorage.getItem('generalTasksStatusFilter') || 'all'; // 'all', 'pending', 'completed'
  let dueDateSort = localStorage.getItem('myTasksDueDateSort') || 'none'; // 'none', 'asc', 'desc'
  let generalDueDateSort = localStorage.getItem('generalTasksDueDateSort') || 'none'; // 'none', 'asc', 'desc'
  let activeTab = localStorage.getItem('myTasksActiveTab') || 'event'; // 'event' or 'general'

  // Initialize the page
  window.initPage = async function() {
    console.log('Initializing my-tasks page');
    
    // Initialize sidebar first
    await initDashboardSidebar();
    
    await getCurrentUser();
    await loadUsers();
    await Promise.all([loadTasks(), loadGeneralTasks()]);
    setupEventListeners();
    setupFilterDropdown();
    setupGeneralTaskListeners();
    setupTabSwitching();
    
    // Restore active tab
    switchTab(activeTab);
  };

  // Initialize dashboard sidebar
  async function initDashboardSidebar() {
    // Inject the sidebar into the layout container
    const layoutContainer = document.getElementById('myTasksPageLayout');
    
    if (layoutContainer && typeof window.injectDashboardSidebar === 'function') {
      await window.injectDashboardSidebar(layoutContainer, { 
        position: 'prepend',
        activePage: 'my-tasks'
      });
    } else if (typeof window.initDashboardSidebar === 'function') {
      // Fallback: sidebar HTML already exists, just initialize
      window.initDashboardSidebar();
    }
    
    // Setup mobile menu button
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.getElementById('dashboardSidebarOverlay');
    
    if (mobileMenuBtn && sidebar) {
      mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('show');
        if (overlay) overlay.classList.toggle('show');
      });
    }
    
    if (overlay) {
      overlay.addEventListener('click', () => {
        if (sidebar) sidebar.classList.remove('show');
        overlay.classList.remove('show');
      });
    }
  }

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
        isAdmin = payload.role === 'admin';
      }
    } catch (e) {
      console.error('Error getting current user:', e);
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
      }
    } catch (e) {
      console.error('Error loading users:', e);
    }
  }

  // Load all tasks
  async function loadTasks(showLoading = true) {
    const loadingEl = document.getElementById('tasksLoading');
    const emptyEl = document.getElementById('tasksEmpty');
    const tbody = document.getElementById('tasksTableBody');
    
    if (showLoading && loadingEl) {
      loadingEl.style.display = 'flex';
    }
    if (emptyEl) emptyEl.style.display = 'none';
    
    try {
      const response = await fetch(`${API_BASE}/api/tasks/all?myTasks=${myTasksOnly}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load tasks');
      }
      
      const data = await response.json();
      tasks = data.todos || [];
      
      renderTasks();
      updateProgress();
      
    } catch (e) {
      console.error('Error loading tasks:', e);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
              <span class="material-symbols-outlined" style="font-size: 48px; display: block; margin-bottom: 12px;">error</span>
              Failed to load tasks. Please try again.
            </td>
          </tr>
        `;
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  // Load general tasks
  async function loadGeneralTasks(showLoading = true) {
    const loadingEl = document.getElementById('generalTasksLoading');
    const emptyEl = document.getElementById('generalTasksEmpty');
    const tbody = document.getElementById('generalTasksTableBody');
    
    if (showLoading && loadingEl) {
      loadingEl.style.display = 'flex';
    }
    if (emptyEl) emptyEl.style.display = 'none';
    
    try {
      const response = await fetch(`${API_BASE}/api/personal-tasks`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      if (!response.ok) {
        throw new Error('Failed to load general tasks');
      }
      
      const data = await response.json();
      generalTasks = data.tasks || [];
      
      renderGeneralTasks();
      updateProgress();
      
    } catch (e) {
      console.error('Error loading general tasks:', e);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">
              <span class="material-symbols-outlined" style="font-size: 48px; display: block; margin-bottom: 12px;">error</span>
              Failed to load general tasks. Please try again.
            </td>
          </tr>
        `;
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  // Render general tasks in the table
  function renderGeneralTasks() {
    const tbody = document.getElementById('generalTasksTableBody');
    const emptyEl = document.getElementById('generalTasksEmpty');
    
    if (!tbody) return;
    
    // Apply search filter
    const searchValue = (document.getElementById('generalTaskSearch')?.value || '').toLowerCase();
    let filteredTasks = [...generalTasks];
    
    // Apply status filter
    if (generalStatusFilter === 'pending') {
      filteredTasks = filteredTasks.filter(task => task.status === 'todo' || task.status === 'in-progress');
    } else if (generalStatusFilter === 'completed') {
      filteredTasks = filteredTasks.filter(task => task.status === 'done');
    }
    
    // Apply search filter
    if (searchValue) {
      filteredTasks = filteredTasks.filter(task => 
        (task.task || '').toLowerCase().includes(searchValue) ||
        (task.notes || '').toLowerCase().includes(searchValue)
      );
    }
    
    // Apply due date sorting
    if (generalDueDateSort !== 'none') {
      filteredTasks.sort((a, b) => {
        const dateA = a.dueDate ? new Date(a.dueDate) : null;
        const dateB = b.dueDate ? new Date(b.dueDate) : null;
        
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        
        const diff = dateA - dateB;
        return generalDueDateSort === 'asc' ? diff : -diff;
      });
    }
    
    if (filteredTasks.length === 0) {
      tbody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        let emptyMessage = 'No general tasks';
        if (searchValue) {
          emptyMessage = 'No tasks match your search';
        } else if (generalStatusFilter === 'pending') {
          emptyMessage = 'No pending tasks';
        } else if (generalStatusFilter === 'completed') {
          emptyMessage = 'No completed tasks';
        }
        const emptyTitle = emptyEl.querySelector('h3');
        if (emptyTitle) emptyTitle.textContent = emptyMessage;
      }
      return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    tbody.innerHTML = filteredTasks.map(task => createGeneralTaskRow(task)).join('');
    
    // Setup inline dropdowns for status
    filteredTasks.forEach(task => {
      setupGeneralTaskStatusDropdown(task);
    });
  }

  // Create a general task row
  function createGeneralTaskRow(task) {
    const dueInfo = formatDueDate(task.dueDate);
    const statusLabel = getStatusLabel(task.status);
    const isOverdue = dueInfo.className === 'overdue' && task.status !== 'done';
    
    return `
      <tr data-general-task-id="${task._id}" class="${isOverdue ? 'overdue-row' : ''}">
        <td class="col-task">
          <span class="task-name">${escapeHtml(task.task || '')}</span>
        </td>
        <td class="col-status">
          <button type="button" class="inline-dropdown-trigger status-${task.status}" id="generalStatusTrigger-${task._id}">
            <span class="status-dot"></span>
            <span class="status-text">${statusLabel}</span>
            <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
          </button>
        </td>
        <td class="col-due">
          <span class="due-date ${isOverdue ? 'overdue' : (dueInfo.className === 'overdue' ? '' : dueInfo.className)}">${dueInfo.text}</span>
        </td>
        <td class="col-notes">
          <span class="notes-preview">${escapeHtml(task.notes || '—')}</span>
        </td>
        <td class="col-actions">
          <div class="actions-dropdown">
            <button type="button" class="actions-btn" onclick="window.toggleActionsMenu(this)">
              <span class="material-symbols-outlined">more_vert</span>
            </button>
            <div class="actions-menu">
              <button class="action-item" onclick="window.openEditGeneralTaskModal('${task._id}')">
                <span class="material-symbols-outlined">edit</span> Edit
              </button>
              <button class="action-item delete" onclick="window.openDeleteGeneralTaskModal('${task._id}')">
                <span class="material-symbols-outlined">delete</span> Delete
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // Setup inline status dropdown for general tasks
  function setupGeneralTaskStatusDropdown(task) {
    const trigger = document.getElementById(`generalStatusTrigger-${task._id}`);
    if (!trigger) return;
    
    // Remove existing menu if any
    let menu = document.getElementById(`generalStatusMenu-${task._id}`);
    if (menu) menu.remove();
    
    // Create menu
    menu = document.createElement('div');
    menu.id = `generalStatusMenu-${task._id}`;
    menu.className = 'inline-status-menu';
    menu.style.cssText = 'display: none; position: fixed; z-index: 999999; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); overflow: hidden;';
    
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
      option.innerHTML = `<span class="status-dot status-${opt.value}"></span> ${opt.label}`;
      option.onmouseover = () => option.style.background = '#2a2a2a';
      option.onmouseout = () => option.style.background = 'transparent';
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.style.display = 'none';
        
        await updateGeneralTaskStatus(task._id, opt.value);
      };
      menu.appendChild(option);
    });
    
    document.body.appendChild(menu);
    
    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      closeAllDropdowns();
      
      const isOpen = menu.style.display === 'block';
      if (isOpen) {
        menu.style.display = 'none';
      } else {
        const rect = trigger.getBoundingClientRect();
        const menuHeight = 120; // Approximate height of 3 options
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        
        menu.style.display = 'block';
        menu.style.left = `${rect.left}px`;
        menu.style.minWidth = `${Math.max(rect.width, 140)}px`;
        
        // Flip dropdown upward if not enough space below
        if (spaceBelow < menuHeight + 20) {
          menu.style.top = 'auto';
          menu.style.bottom = `${viewportHeight - rect.top + 4}px`;
        } else {
          menu.style.top = `${rect.bottom + 4}px`;
          menu.style.bottom = 'auto';
        }
      }
    };
  }

  // Update general task status
  async function updateGeneralTaskStatus(taskId, newStatus) {
    try {
      const response = await fetch(`${API_BASE}/api/personal-tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update status');
      }
      
      // Update local data
      const taskIndex = generalTasks.findIndex(t => t._id === taskId);
      if (taskIndex !== -1) {
        generalTasks[taskIndex].status = newStatus;
      }
      
      renderGeneralTasks();
      updateProgress();
      
      showToast('Status updated', 'success');
    } catch (e) {
      console.error('Error updating status:', e);
      showToast('Failed to update status', 'error');
    }
  }

  // Setup general task listeners
  function setupGeneralTaskListeners() {
    // Add task button
    const addBtn = document.getElementById('addGeneralTaskBtn');
    if (addBtn) {
      addBtn.onclick = () => window.openAddGeneralTaskModal();
    }
    
    // Search input for general tasks
    const generalSearchInput = document.getElementById('generalTaskSearch');
    if (generalSearchInput) {
      let debounceTimer;
      generalSearchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => renderGeneralTasks(), 300);
      });
    }
    
    // Status filter tabs for general tasks
    setupGeneralStatusFilterTabs();
    
    // Update general sort icon
    updateGeneralSortIcon();
    
    // Setup general task modal dropdowns
    setupGeneralTaskModalDropdowns();
  }

  // Setup general tasks status filter tabs
  function setupGeneralStatusFilterTabs() {
    const tabs = document.querySelectorAll('.status-tab[data-section="general"]');
    
    // Set initial active state
    tabs.forEach(tab => {
      if (tab.dataset.status === generalStatusFilter) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
      
      tab.addEventListener('click', () => {
        // Update active state
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update filter
        generalStatusFilter = tab.dataset.status;
        localStorage.setItem('generalTasksStatusFilter', generalStatusFilter);
        
        // Re-render
        renderGeneralTasks();
      });
    });
  }

  // Toggle general due date sort
  window.toggleGeneralDueDateSort = function() {
    if (generalDueDateSort === 'none') {
      generalDueDateSort = 'asc';
    } else if (generalDueDateSort === 'asc') {
      generalDueDateSort = 'desc';
    } else {
      generalDueDateSort = 'none';
    }
    
    localStorage.setItem('generalTasksDueDateSort', generalDueDateSort);
    updateGeneralSortIcon();
    renderGeneralTasks();
  };

  // Update general sort icon
  function updateGeneralSortIcon() {
    const icon = document.getElementById('generalDueDateSortIcon');
    const header = document.getElementById('generalDueDateHeader');
    
    if (!icon || !header) return;
    
    if (generalDueDateSort === 'asc') {
      icon.textContent = 'arrow_upward';
      header.classList.add('sorted');
    } else if (generalDueDateSort === 'desc') {
      icon.textContent = 'arrow_downward';
      header.classList.add('sorted');
    } else {
      icon.textContent = 'unfold_more';
      header.classList.remove('sorted');
    }
  }

  // Open add general task modal
  window.openAddGeneralTaskModal = function() {
    editingGeneralTaskId = null;
    
    const modal = document.getElementById('generalTaskModal');
    const title = document.getElementById('generalTaskModalTitle');
    
    if (title) title.textContent = 'Add General Task';
    
    // Reset form
    document.getElementById('generalTaskId').value = '';
    document.getElementById('generalTaskName').value = '';
    document.getElementById('generalTaskStatus').value = 'todo';
    document.getElementById('generalTaskDueDate').value = '';
    document.getElementById('generalTaskNotes').value = '';
    
    // Reset status dropdown display
    const statusTrigger = document.getElementById('generalStatusTrigger');
    if (statusTrigger) {
      statusTrigger.innerHTML = `
        <span class="status-dot todo"></span>
        <span class="dropdown-value">To Do</span>
        <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
      `;
    }
    
    if (modal) modal.classList.add('show');
  };

  // Open edit general task modal
  window.openEditGeneralTaskModal = function(taskId) {
    closeAllDropdowns();
    
    const task = generalTasks.find(t => t._id === taskId);
    if (!task) return;
    
    editingGeneralTaskId = taskId;
    
    const modal = document.getElementById('generalTaskModal');
    const title = document.getElementById('generalTaskModalTitle');
    
    if (title) title.textContent = 'Edit General Task';
    
    // Populate form
    document.getElementById('generalTaskId').value = taskId;
    document.getElementById('generalTaskName').value = task.task || '';
    document.getElementById('generalTaskStatus').value = task.status || 'todo';
    document.getElementById('generalTaskDueDate').value = task.dueDate ? task.dueDate.split('T')[0] : '';
    document.getElementById('generalTaskNotes').value = task.notes || '';
    
    // Update status dropdown display
    const statusTrigger = document.getElementById('generalStatusTrigger');
    if (statusTrigger) {
      const statusLabel = getStatusLabel(task.status || 'todo');
      statusTrigger.innerHTML = `
        <span class="status-dot ${task.status || 'todo'}"></span>
        <span class="dropdown-value">${statusLabel}</span>
        <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
      `;
    }
    
    if (modal) modal.classList.add('show');
  };

  // Close general task modal
  window.closeGeneralTaskModal = function() {
    document.getElementById('generalTaskModal')?.classList.remove('show');
    editingGeneralTaskId = null;
  };

  // Save general task
  window.saveGeneralTask = async function() {
    const taskId = document.getElementById('generalTaskId').value;
    const task = document.getElementById('generalTaskName').value.trim();
    const status = document.getElementById('generalTaskStatus').value;
    const dueDate = document.getElementById('generalTaskDueDate').value;
    const notes = document.getElementById('generalTaskNotes').value.trim();
    
    if (!task) {
      showToast('Please enter a task description', 'error');
      return;
    }
    
    try {
      const isEditing = !!taskId;
      const url = isEditing 
        ? `${API_BASE}/api/personal-tasks/${taskId}` 
        : `${API_BASE}/api/personal-tasks`;
      const method = isEditing ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ task, status, dueDate: dueDate || null, notes })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save task');
      }
      
      window.closeGeneralTaskModal();
      await loadGeneralTasks(false);
      showToast(isEditing ? 'Task updated' : 'Task added', 'success');
    } catch (e) {
      console.error('Error saving general task:', e);
      showToast('Failed to save task', 'error');
    }
  };

  // Open delete general task modal
  window.openDeleteGeneralTaskModal = function(taskId) {
    closeAllDropdowns();
    document.getElementById('deleteGeneralTaskId').value = taskId;
    document.getElementById('deleteGeneralTaskModal')?.classList.add('show');
  };

  // Close delete general task modal
  window.closeDeleteGeneralTaskModal = function() {
    document.getElementById('deleteGeneralTaskModal')?.classList.remove('show');
  };

  // Confirm delete general task
  window.confirmDeleteGeneralTask = async function() {
    const taskId = document.getElementById('deleteGeneralTaskId').value;
    
    try {
      const response = await fetch(`${API_BASE}/api/personal-tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete task');
      }
      
      window.closeDeleteGeneralTaskModal();
      await loadGeneralTasks(false);
      showToast('Task deleted', 'success');
    } catch (e) {
      console.error('Error deleting general task:', e);
      showToast('Failed to delete task', 'error');
    }
  };

  // Setup general task modal dropdowns
  function setupGeneralTaskModalDropdowns() {
    const statusTrigger = document.getElementById('generalStatusTrigger');
    const statusMenu = document.getElementById('generalStatusMenu');
    
    if (statusTrigger && statusMenu) {
      statusTrigger.onclick = (e) => {
        e.stopPropagation();
        
        const isOpen = statusMenu.style.display === 'block';
        
        if (isOpen) {
          statusMenu.style.display = 'none';
        } else {
          const rect = statusTrigger.getBoundingClientRect();
          statusMenu.style.display = 'block';
          statusMenu.style.position = 'fixed';
          statusMenu.style.top = `${rect.bottom + 4}px`;
          statusMenu.style.left = `${rect.left}px`;
          statusMenu.style.minWidth = `${rect.width}px`;
        }
      };
      
      statusMenu.querySelectorAll('.custom-dropdown-option').forEach(option => {
        option.onclick = (e) => {
          e.stopPropagation();
          
          const value = option.dataset.value;
          document.getElementById('generalTaskStatus').value = value;
          
          const label = getStatusLabel(value);
          statusTrigger.innerHTML = `
            <span class="status-dot ${value}"></span>
            <span class="dropdown-value">${label}</span>
            <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
          `;
          
          statusMenu.style.display = 'none';
        };
      });
    }
  }

  // Render tasks in the table
  function renderTasks() {
    const tbody = document.getElementById('tasksTableBody');
    const emptyEl = document.getElementById('tasksEmpty');
    
    if (!tbody) return;
    
    // Apply search filter
    const searchValue = (document.getElementById('taskSearch')?.value || '').toLowerCase();
    let filteredTasks = [...tasks];
    
    // Apply status filter
    if (statusFilter === 'pending') {
      filteredTasks = filteredTasks.filter(task => task.status === 'todo' || task.status === 'in-progress');
    } else if (statusFilter === 'completed') {
      filteredTasks = filteredTasks.filter(task => task.status === 'done');
    }
    
    // Apply search filter
    if (searchValue) {
      filteredTasks = filteredTasks.filter(task => 
        (task.task || '').toLowerCase().includes(searchValue) ||
        (task.event?.title || '').toLowerCase().includes(searchValue) ||
        (task.owner?.fullName || task.owner?.name || '').toLowerCase().includes(searchValue) ||
        (task.notes || '').toLowerCase().includes(searchValue)
      );
    }
    
    // Apply due date sorting
    if (dueDateSort !== 'none') {
      filteredTasks.sort((a, b) => {
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
    
    if (filteredTasks.length === 0) {
      tbody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        let emptyMessage = 'No tasks found';
        if (searchValue) {
          emptyMessage = 'No tasks match your search';
        } else if (statusFilter === 'pending') {
          emptyMessage = 'No pending tasks';
        } else if (statusFilter === 'completed') {
          emptyMessage = 'No completed tasks';
        } else if (myTasksOnly) {
          emptyMessage = 'No tasks assigned to you';
        }
        emptyEl.querySelector('p').textContent = emptyMessage;
      }
      return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    tbody.innerHTML = filteredTasks.map(task => createTaskRow(task)).join('');
    
    // Setup inline dropdowns for status
    filteredTasks.forEach(task => {
      setupInlineStatusDropdown(task);
    });
  }

  // Create a task row
  function createTaskRow(task) {
    const dueInfo = formatDueDate(task.dueDate);
    const ownerName = task.owner?.fullName || task.owner?.name || 'Unassigned';
    const statusLabel = getStatusLabel(task.status);
    const canEdit = task.canEdit || isAdmin;
    const isOverdue = dueInfo.className === 'overdue' && task.status !== 'done';
    
    return `
      <tr data-task-id="${task._id}" data-event-id="${task.event?._id || ''}" class="${isOverdue ? 'overdue-row' : ''}">
        <td class="col-task">
          <span class="task-name">${escapeHtml(task.task || '')}</span>
        </td>
        <td class="col-event">
          <a href="#" class="event-link" onclick="event.preventDefault(); window.navigateToEventTodos('${task.event?._id}');">
            ${escapeHtml(task.event?.title || 'Unknown Event')}
          </a>
        </td>
        <td class="col-status">
          <button type="button" class="inline-dropdown-trigger status-${task.status}" id="statusTrigger-${task._id}">
            <span class="status-dot"></span>
            <span class="status-text">${statusLabel}</span>
            <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
          </button>
        </td>
        <td class="col-due">
          <span class="due-date ${isOverdue ? 'overdue' : (dueInfo.className === 'overdue' ? '' : dueInfo.className)}">${dueInfo.text}</span>
        </td>
        <td class="col-owner">
          <div class="owner-info">
            ${task.owner?.photo 
              ? `<img src="${task.owner.photo}" alt="${ownerName}" class="owner-avatar">` 
              : `<span class="material-symbols-outlined owner-avatar-icon">person</span>`}
            <span class="owner-name">${escapeHtml(ownerName)}</span>
          </div>
        </td>
        <td class="col-notes">
          <span class="notes-preview">${escapeHtml(task.notes || '—')}</span>
        </td>
        <td class="col-actions">
          ${canEdit ? `
            <div class="actions-dropdown">
              <button type="button" class="actions-btn" onclick="window.toggleActionsMenu(this)">
                <span class="material-symbols-outlined">more_vert</span>
              </button>
              <div class="actions-menu">
                <button class="action-item" onclick="window.openEditModal('${task._id}', '${task.event?._id}')">
                  <span class="material-symbols-outlined">edit</span> Edit
                </button>
                <button class="action-item delete" onclick="window.openDeleteModal('${task._id}', '${task.event?._id}')">
                  <span class="material-symbols-outlined">delete</span> Delete
                </button>
              </div>
            </div>
          ` : ''}
        </td>
      </tr>
    `;
  }

  // Setup inline status dropdown
  function setupInlineStatusDropdown(task) {
    const trigger = document.getElementById(`statusTrigger-${task._id}`);
    if (!trigger) return;
    
    // Remove existing menu if any
    let menu = document.getElementById(`statusMenu-${task._id}`);
    if (menu) menu.remove();
    
    // Create menu
    menu = document.createElement('div');
    menu.id = `statusMenu-${task._id}`;
    menu.className = 'inline-status-menu';
    menu.style.cssText = 'display: none; position: fixed; z-index: 999999; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.6); overflow: hidden;';
    
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
      option.innerHTML = `<span class="status-dot status-${opt.value}"></span> ${opt.label}`;
      option.onmouseover = () => option.style.background = '#2a2a2a';
      option.onmouseout = () => option.style.background = 'transparent';
      option.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.style.display = 'none';
        
        await updateTaskStatus(task._id, task.event?._id, opt.value);
      };
      menu.appendChild(option);
    });
    
    document.body.appendChild(menu);
    
    trigger.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Close all other menus
      closeAllDropdowns();
      
      const isOpen = menu.style.display === 'block';
      if (isOpen) {
        menu.style.display = 'none';
      } else {
        const rect = trigger.getBoundingClientRect();
        const menuHeight = 120; // Approximate height of 3 options
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        
        menu.style.display = 'block';
        menu.style.left = `${rect.left}px`;
        menu.style.minWidth = `${Math.max(rect.width, 140)}px`;
        
        // Flip dropdown upward if not enough space below
        if (spaceBelow < menuHeight + 20) {
          menu.style.top = 'auto';
          menu.style.bottom = `${viewportHeight - rect.top + 4}px`;
        } else {
          menu.style.top = `${rect.bottom + 4}px`;
          menu.style.bottom = 'auto';
        }
      }
    };
  }

  // Update task status
  async function updateTaskStatus(taskId, eventId, newStatus) {
    try {
      const response = await fetch(`${API_BASE}/api/tables/${eventId}/todos/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update status');
      }
      
      // Update local data
      const taskIndex = tasks.findIndex(t => t._id === taskId);
      if (taskIndex !== -1) {
        tasks[taskIndex].status = newStatus;
      }
      
      // Re-render with updated data
      renderTasks();
      updateProgress();
      
      showToast('Status updated', 'success');
    } catch (e) {
      console.error('Error updating status:', e);
      showToast('Failed to update status', 'error');
    }
  }

  // Update progress bar (shows progress for active tab)
  function updateProgress() {
    const progressText = document.getElementById('progressText');
    const progressFill = document.getElementById('progressFill');
    
    if (!progressText || !progressFill) return;
    
    // Show progress for the active tab
    const activeTasks = activeTab === 'event' ? tasks : generalTasks;
    const total = activeTasks.length;
    const completed = activeTasks.filter(t => t.status === 'done').length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    progressText.textContent = `${completed} / ${total} completed`;
    progressFill.style.width = `${percentage}%`;
    
    // Also update tab counts
    updateTabCounts();
  }

  // Setup event listeners
  function setupEventListeners() {
    // Search
    const searchInput = document.getElementById('taskSearch');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => renderTasks(), 300);
      });
    }
    
    // Status filter tabs
    setupStatusFilterTabs();
    
    // Update sort icon on load
    updateSortIcon();
    
    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.inline-dropdown-trigger') && 
          !e.target.closest('.inline-status-menu') &&
          !e.target.closest('.actions-dropdown') &&
          !e.target.closest('.filter-dropdown')) {
        closeAllDropdowns();
      }
    });
  }

  // Setup status filter tabs (Event Tasks only)
  function setupStatusFilterTabs() {
    const tabs = document.querySelectorAll('.status-tab[data-section="event"]');
    
    // Set initial active state
    tabs.forEach(tab => {
      if (tab.dataset.status === statusFilter) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
      
      tab.addEventListener('click', () => {
        // Update active state for event tabs only
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update filter
        statusFilter = tab.dataset.status;
        localStorage.setItem('myTasksStatusFilter', statusFilter);
        
        // Re-render event tasks only
        renderTasks();
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
    
    localStorage.setItem('myTasksDueDateSort', dueDateSort);
    updateSortIcon();
    renderTasks();
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

  // Setup filter dropdown
  function setupFilterDropdown() {
    const filterBtn = document.getElementById('myTasksFilterBtn');
    const filterDropdown = document.getElementById('myTasksDropdown');
    const filterLabel = document.getElementById('myTasksFilterLabel');
    
    if (!filterBtn || !filterDropdown) return;
    
    // Set initial state
    if (filterLabel) {
      filterLabel.textContent = myTasksOnly ? 'My Tasks Only' : 'All Tasks';
    }
    
    filterBtn.onclick = (e) => {
      e.stopPropagation();
      filterDropdown.classList.toggle('show');
    };
    
    filterDropdown.querySelectorAll('.filter-option').forEach(option => {
      option.onclick = async () => {
        const value = option.dataset.value;
        myTasksOnly = value === 'mine';
        localStorage.setItem('myTasksFilter', myTasksOnly);
        
        if (filterLabel) {
          filterLabel.textContent = myTasksOnly ? 'My Tasks Only' : 'All Tasks';
        }
        
        filterDropdown.classList.remove('show');
        await loadTasks();
      };
    });
  }

  // Close all dropdown menus
  function closeAllDropdowns() {
    document.querySelectorAll('.inline-status-menu').forEach(m => {
      m.style.display = 'none';
    });
    document.querySelectorAll('.actions-menu').forEach(m => {
      m.classList.remove('show');
    });
    document.querySelectorAll('.filter-dropdown').forEach(m => {
      m.classList.remove('show');
    });
  }

  // Toggle actions menu
  window.toggleActionsMenu = function(btn) {
    const menu = btn.nextElementSibling;
    const isOpen = menu.classList.contains('show');
    
    closeAllDropdowns();
    
    if (!isOpen) {
      // Position menu using fixed positioning to avoid cutoff
      const rect = btn.getBoundingClientRect();
      const menuHeight = 90; // Approximate height of menu
      const viewportHeight = window.innerHeight;
      
      // Check if menu would go below viewport
      const wouldOverflow = rect.bottom + menuHeight > viewportHeight;
      
      menu.style.position = 'fixed';
      menu.style.left = `${rect.right - 130}px`; // Right-align to button
      
      if (wouldOverflow) {
        // Show above the button
        menu.style.top = 'auto';
        menu.style.bottom = `${viewportHeight - rect.top + 4}px`;
      } else {
        // Show below the button
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.bottom = 'auto';
      }
      
      menu.classList.add('show');
    }
  };

  // Navigate to event's todos page
  window.navigateToEventTodos = function(eventId) {
    if (!eventId) {
      console.error('No eventId provided for navigation');
      return;
    }
    if (window.navigate) {
      window.navigate('todos', eventId);
    } else {
      window.location.href = `/dashboard.html#todos?id=${eventId}`;
    }
  };

  // Open edit modal
  window.openEditModal = function(taskId, eventId) {
    closeAllDropdowns();
    
    const task = tasks.find(t => t._id === taskId);
    if (!task) return;
    
    editingTaskId = taskId;
    editingEventId = eventId;
    
    const modal = document.getElementById('myTasksEditModal');
    
    // Populate form
    document.getElementById('editTaskId').value = taskId;
    document.getElementById('editTaskEventId').value = eventId;
    document.getElementById('editTaskName').value = task.task || '';
    document.getElementById('editTaskStatus').value = task.status || 'todo';
    document.getElementById('editTaskDueDate').value = task.dueDate ? task.dueDate.split('T')[0] : '';
    document.getElementById('editTaskOwner').value = task.owner?._id || '';
    document.getElementById('editTaskNotes').value = task.notes || '';
    
    // Update status dropdown display
    const statusTrigger = document.getElementById('editStatusTrigger');
    if (statusTrigger) {
      const statusLabel = getStatusLabel(task.status || 'todo');
      statusTrigger.innerHTML = `
        <span class="status-dot ${task.status || 'todo'}"></span>
        <span class="dropdown-value">${statusLabel}</span>
        <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
      `;
    }
    
    // Update owner dropdown display
    const ownerTrigger = document.getElementById('editOwnerTrigger');
    if (ownerTrigger) {
      const ownerName = task.owner?.fullName || task.owner?.name || 'Unassigned';
      ownerTrigger.innerHTML = `
        <span class="dropdown-value">${ownerName}</span>
        <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
      `;
    }
    
    // Populate owner dropdown options
    populateEditOwnerDropdown();
    
    // Setup modal dropdowns
    setupEditModalDropdowns();
    
    // Show modal
    if (modal) {
      modal.classList.add('show');
    }
  };

  // Populate edit owner dropdown
  function populateEditOwnerDropdown() {
    const menu = document.getElementById('editOwnerMenu');
    if (!menu) return;
    
    menu.innerHTML = '';
    
    // Search input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'custom-dropdown-search';
    searchWrapper.innerHTML = `<input type="text" placeholder="Search owners..." autocomplete="off">`;
    menu.appendChild(searchWrapper);
    
    // Options container
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-dropdown-options';
    menu.appendChild(optionsContainer);
    
    function renderOptions(filter = '') {
      const allOptions = [
        { value: '', label: 'Unassigned', icon: 'person_off' },
        ...users.map(user => ({
          value: user._id,
          label: user.name || user.fullName || 'Unknown User',
          icon: 'person'
        }))
      ];
      
      const filtered = allOptions.filter(opt => 
        opt.label.toLowerCase().includes(filter.toLowerCase())
      );
      
      optionsContainer.innerHTML = filtered.length === 0
        ? '<div class="custom-dropdown-empty">No results found</div>'
        : filtered.map(opt => `
            <button type="button" class="custom-dropdown-option" data-value="${opt.value}">
              <span class="material-symbols-outlined">${opt.icon}</span>
              ${escapeHtml(opt.label)}
            </button>
          `).join('');
      
      // Add click handlers
      optionsContainer.querySelectorAll('.custom-dropdown-option').forEach(option => {
        option.onclick = (e) => {
          e.stopPropagation();
          
          const value = option.dataset.value;
          const label = option.textContent.trim();
          
          document.getElementById('editTaskOwner').value = value;
          
          const trigger = document.getElementById('editOwnerTrigger');
          if (trigger) {
            trigger.querySelector('.dropdown-value').textContent = label;
          }
          
          menu.style.display = 'none';
        };
      });
    }
    
    renderOptions();
    
    // Search filtering
    const searchInput = searchWrapper.querySelector('input');
    searchInput.oninput = (e) => renderOptions(e.target.value);
    searchInput.onclick = (e) => e.stopPropagation();
  }

  // Setup edit modal dropdowns
  function setupEditModalDropdowns() {
    // Status dropdown
    const statusTrigger = document.getElementById('editStatusTrigger');
    const statusMenu = document.getElementById('editStatusMenu');
    
    if (statusTrigger && statusMenu) {
      statusTrigger.onclick = (e) => {
        e.stopPropagation();
        
        const ownerMenu = document.getElementById('editOwnerMenu');
        if (ownerMenu) ownerMenu.style.display = 'none';
        
        const isOpen = statusMenu.style.display === 'block';
        
        if (isOpen) {
          statusMenu.style.display = 'none';
        } else {
          const rect = statusTrigger.getBoundingClientRect();
          statusMenu.style.display = 'block';
          statusMenu.style.position = 'fixed';
          statusMenu.style.top = `${rect.bottom + 4}px`;
          statusMenu.style.left = `${rect.left}px`;
          statusMenu.style.minWidth = `${rect.width}px`;
        }
      };
      
      statusMenu.querySelectorAll('.custom-dropdown-option').forEach(option => {
        option.onclick = (e) => {
          e.stopPropagation();
          
          const value = option.dataset.value;
          document.getElementById('editTaskStatus').value = value;
          
          const label = getStatusLabel(value);
          statusTrigger.innerHTML = `
            <span class="status-dot ${value}"></span>
            <span class="dropdown-value">${label}</span>
            <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
          `;
          
          statusMenu.style.display = 'none';
        };
      });
    }
    
    // Owner dropdown
    const ownerTrigger = document.getElementById('editOwnerTrigger');
    const ownerMenu = document.getElementById('editOwnerMenu');
    
    if (ownerTrigger && ownerMenu) {
      ownerTrigger.onclick = (e) => {
        e.stopPropagation();
        
        if (statusMenu) statusMenu.style.display = 'none';
        
        const isOpen = ownerMenu.style.display === 'block';
        
        if (isOpen) {
          ownerMenu.style.display = 'none';
        } else {
          const rect = ownerTrigger.getBoundingClientRect();
          ownerMenu.style.display = 'block';
          ownerMenu.style.position = 'fixed';
          ownerMenu.style.top = `${rect.bottom + 4}px`;
          ownerMenu.style.left = `${rect.left}px`;
          ownerMenu.style.minWidth = `${rect.width}px`;
          ownerMenu.style.maxHeight = '200px';
          ownerMenu.style.overflowY = 'auto';
          
          const searchInput = ownerMenu.querySelector('input');
          if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
          }
        }
      };
    }
  }

  // Close edit modal
  window.closeEditTaskModal = function() {
    document.getElementById('myTasksEditModal')?.classList.remove('show');
    editingTaskId = null;
    editingEventId = null;
  };

  // Save edited task
  window.saveEditTask = async function() {
    const taskId = document.getElementById('editTaskId').value;
    const eventId = document.getElementById('editTaskEventId').value;
    const task = document.getElementById('editTaskName').value.trim();
    const status = document.getElementById('editTaskStatus').value;
    const dueDate = document.getElementById('editTaskDueDate').value;
    const owner = document.getElementById('editTaskOwner').value;
    const notes = document.getElementById('editTaskNotes').value.trim();
    
    if (!task) {
      showToast('Please enter a task description', 'error');
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/tables/${eventId}/todos/${taskId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ task, status, dueDate, owner, notes })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save task');
      }
      
      window.closeEditTaskModal();
      await loadTasks(false);
      showToast('Task updated', 'success');
    } catch (e) {
      console.error('Error saving task:', e);
      showToast('Failed to save task', 'error');
    }
  };

  // Open delete modal
  window.openDeleteModal = function(taskId, eventId) {
    closeAllDropdowns();
    
    document.getElementById('deleteTaskId').value = taskId;
    document.getElementById('deleteTaskEventId').value = eventId;
    document.getElementById('myTasksDeleteModal')?.classList.add('show');
  };

  // Close delete modal
  window.closeDeleteTaskModal = function() {
    document.getElementById('myTasksDeleteModal')?.classList.remove('show');
  };

  // Confirm delete task
  window.confirmDeleteTask = async function() {
    const taskId = document.getElementById('deleteTaskId').value;
    const eventId = document.getElementById('deleteTaskEventId').value;
    
    try {
      const response = await fetch(`${API_BASE}/api/tables/${eventId}/todos/${taskId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete task');
      }
      
      window.closeDeleteTaskModal();
      await loadTasks(false);
      showToast('Task deleted', 'success');
    } catch (e) {
      console.error('Error deleting task:', e);
      showToast('Failed to delete task', 'error');
    }
  };

  // Format due date
  function formatDueDate(dueDate) {
    if (!dueDate) return { text: '—', className: '' };
    
    let dateStr = dueDate;
    if (typeof dueDate === 'string' && dueDate.includes('T')) {
      dateStr = dueDate.split('T')[0];
    }
    
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    
    const diffDays = Math.round((date - today) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
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
      const options = { month: 'short', day: 'numeric' };
      return { text: date.toLocaleDateString('en-US', options), className: '' };
    }
  }

  // Get status label
  function getStatusLabel(status) {
    switch (status) {
      case 'todo': return 'To Do';
      case 'in-progress': return 'In Progress';
      case 'done': return 'Done';
      default: return 'To Do';
    }
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Setup tab switching
  function setupTabSwitching() {
    const tabs = document.querySelectorAll('.task-type-tab');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        switchTab(tabName);
      });
    });
    
    // Update tab counts initially
    updateTabCounts();
  }
  
  // Switch between tabs
  function switchTab(tabName) {
    activeTab = tabName;
    localStorage.setItem('myTasksActiveTab', tabName);
    
    // Update tab buttons
    const tabs = document.querySelectorAll('.task-type-tab');
    tabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    
    // Update tab content panels
    const eventContent = document.getElementById('eventTasksContent');
    const generalContent = document.getElementById('generalTasksContent');
    
    if (tabName === 'event') {
      eventContent?.classList.add('active');
      generalContent?.classList.remove('active');
    } else {
      eventContent?.classList.remove('active');
      generalContent?.classList.add('active');
    }
    
    // Show/hide Add Task button (only on General Tasks tab)
    const addTaskBtn = document.getElementById('addGeneralTaskBtn');
    if (addTaskBtn) {
      addTaskBtn.style.display = tabName === 'general' ? 'flex' : 'none';
    }
    
    // Update progress bar for the active tab
    updateProgress();
  }
  
  // Update tab counts
  function updateTabCounts() {
    const eventCount = document.getElementById('eventTaskCount');
    const generalCount = document.getElementById('generalTaskCount');
    
    if (eventCount) {
      const pendingEventTasks = tasks.filter(t => t.status !== 'done').length;
      eventCount.textContent = pendingEventTasks;
    }
    
    if (generalCount) {
      const pendingGeneralTasks = generalTasks.filter(t => t.status !== 'done').length;
      generalCount.textContent = pendingGeneralTasks;
    }
  }

  // Show toast notification
  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }

})();

