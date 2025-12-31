(function() {
const token = localStorage.getItem('token');
if (!token && !window.location.pathname.endsWith('index.html')) {
  // Redirect without alert - toast not available yet
  window.location.href = 'index.html';
}

let currentTableId = null;
let showArchived = false;
let statusFilter = 'active'; // 'active', 'archived', or 'all'
let searchEventsValue = '';
let dateFilterStart = null;
let dateFilterEnd = null;
let allUsers = [];
let selectedUsers = [];

function getUserIdFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.id;
}

// ========================================
// TOAST NOTIFICATION SYSTEM
// ========================================

function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) {
    console.warn('Toast container not found');
    return;
  }
  
  const icons = {
    success: 'check_circle',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };
  
  const titles = {
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Notice'
  };
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">
      <span class="material-symbols-outlined">${icons[type] || icons.info}</span>
    </div>
    <div class="toast-content">
      <div class="toast-title">${titles[type] || titles.info}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <span class="material-symbols-outlined">close</span>
    </button>
    <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
  `;
  
  container.appendChild(toast);
  
  // Auto remove after duration
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);
  
  return toast;
}

// ========================================
// CONFIRMATION MODAL SYSTEM
// ========================================

let confirmResolve = null;

function showConfirm(title, message, options = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    
    const modal = document.getElementById('confirmModal');
    const modalIcon = document.getElementById('confirmModalIcon');
    const modalTitle = document.getElementById('confirmModalTitle');
    const modalMessage = document.getElementById('confirmModalMessage');
    const confirmBtn = document.getElementById('confirmModalConfirm');
    const cancelBtn = document.getElementById('confirmModalCancel');
    
    if (!modal) {
      // Fallback to native confirm if modal not found
      resolve(confirm(message));
      return;
    }
    
    // Set content
    modalTitle.textContent = title || 'Confirm Action';
    modalMessage.textContent = message || 'Are you sure you want to proceed?';
    
    // Set icon type
    const iconType = options.type || 'danger';
    const icons = {
      danger: 'warning',
      warning: 'error',
      info: 'help'
    };
    modalIcon.className = `confirm-modal-icon ${iconType === 'danger' ? '' : iconType}`;
    modalIcon.innerHTML = `<span class="material-symbols-outlined">${icons[iconType] || 'help'}</span>`;
    
    // Set button text
    confirmBtn.textContent = options.confirmText || 'Confirm';
    cancelBtn.textContent = options.cancelText || 'Cancel';
    
    // Set button style
    confirmBtn.className = options.type === 'info' ? 'btn-primary' : 'btn-danger';
    
    // Show modal
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // Setup handlers
    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };
    
    const handleCancel = () => {
      cleanup();
      resolve(false);
    };
    
    const handleBackdrop = (e) => {
      if (e.target === modal) {
        cleanup();
        resolve(false);
      }
    };
    
    const cleanup = () => {
      modal.classList.remove('show');
      document.body.style.overflow = '';
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdrop);
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdrop);
  });
}

// Make toast globally available
window.showToast = showToast;
window.showConfirm = showConfirm;

function showCreateModal() {
  const modal = document.getElementById('createModal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function hideCreateModal() {
  const modal = document.getElementById('createModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
    
    // Reset form fields
    const editEventId = document.getElementById('editEventId');
    const newTitle = document.getElementById('newTitle');
    const newClient = document.getElementById('newClient');
    const newCity = document.getElementById('newCity');
    const newState = document.getElementById('newState');
    const newStart = document.getElementById('newStart');
    const newEnd = document.getElementById('newEnd');
    
    if (editEventId) editEventId.value = '';
    if (newTitle) newTitle.value = '';
    if (newClient) newClient.value = '';
    if (newCity) newCity.value = '';
    if (newState) newState.value = '';
    if (newStart) newStart.value = '';
    if (newEnd) newEnd.value = '';
    
    // Reset modal title and button to create mode
    const modalTitle = document.getElementById('eventModalTitle');
    const submitBtn = document.getElementById('eventModalSubmitBtn');
    if (modalTitle) modalTitle.textContent = 'Create New Event';
    if (submitBtn) submitBtn.textContent = 'Create Event';
  }
}

async function submitCreate() {
  const editEventId = document.getElementById('editEventId')?.value;
  const title = document.getElementById('newTitle')?.value;
  const client = document.getElementById('newClient')?.value;
  const city = document.getElementById('newCity')?.value;
  const state = document.getElementById('newState')?.value;
  const startDate = document.getElementById('newStart')?.value;
  const endDate = document.getElementById('newEnd')?.value;

  if (!title || !startDate || !endDate) {
    showToast("Please fill out all fields.", "warning");
    return;
  }

  // Ensure we're using ISO format without timezone issues
  const formatDateToISO = (dateStr) => {
    if (!dateStr) return '';
    // Parse the date and create an ISO string with time at noon UTC
    const date = new Date(dateStr);
    date.setUTCHours(12, 0, 0, 0);
    return date.toISOString();
  };

  const start = formatDateToISO(startDate);
  const end = formatDateToISO(endDate);

  if (editEventId) {
    // Update existing event
    const res = await fetch(`${API_BASE}/api/tables/${editEventId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({
        title,
        general: { client, city, state, start, end }
      })
    });
    await res.json();
  } else {
    // Create new event
  const res = await fetch(`${API_BASE}/api/tables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token
    },
    body: JSON.stringify({
      title,
        general: { client, city, state, start, end }
    })
  });
  await res.json();
  }

  hideCreateModal();
  loadTables(true); // Force refresh after create/edit
}

// Invalidate cache function
function invalidateEventsCache() {
  cachedTables = null;
  cacheTimestamp = 0;
}

window.invalidateEventsCache = invalidateEventsCache;

// Open edit modal with event data
async function openEditEventModal(eventId, clickedElement) {
  // Show immediate visual feedback on the edit icon
  if (clickedElement) {
    clickedElement.textContent = 'hourglass_empty';
    clickedElement.classList.add('loading');
  }
  
  try {
    // Show modal immediately with loading state
    document.getElementById('eventModalTitle').textContent = 'Edit Event';
    document.getElementById('eventModalSubmitBtn').textContent = 'Save Changes';
    document.getElementById('eventModalSubmitBtn').disabled = true;
    document.getElementById('editEventId').value = eventId;
    
    // Clear form fields while loading
    document.getElementById('newTitle').value = '';
    document.getElementById('newTitle').placeholder = 'Loading...';
    document.getElementById('newClient').value = '';
    document.getElementById('newCity').value = '';
    document.getElementById('newState').value = '';
    document.getElementById('newStart').value = '';
    document.getElementById('newEnd').value = '';
    
    // Show modal
    showCreateModal();
    
    // Fetch event data
    const res = await fetch(`${API_BASE}/api/tables/${eventId}`, {
      headers: { Authorization: token }
    });
    const event = await res.json();
    
    // Populate form fields
    document.getElementById('newTitle').value = event.title || '';
    document.getElementById('newTitle').placeholder = 'Enter event name';
    document.getElementById('newClient').value = event.general?.client || '';
    document.getElementById('newCity').value = event.general?.city || '';
    document.getElementById('newState').value = event.general?.state || '';
    
    // Format dates for input fields (YYYY-MM-DD)
    if (event.general?.start) {
      const startDate = new Date(event.general.start);
      document.getElementById('newStart').value = startDate.toISOString().split('T')[0];
    }
    if (event.general?.end) {
      const endDate = new Date(event.general.end);
      document.getElementById('newEnd').value = endDate.toISOString().split('T')[0];
    }
    
    // Enable submit button
    document.getElementById('eventModalSubmitBtn').disabled = false;
    
  } catch (error) {
    console.error('Error loading event for edit:', error);
    hideCreateModal();
    showToast('Failed to load event details', 'error');
  } finally {
    // Reset edit icon
    if (clickedElement) {
      clickedElement.textContent = 'edit';
      clickedElement.classList.remove('loading');
    }
  }
}

window.openEditEventModal = openEditEventModal;

// Row accent colors for dark theme table view
const rowAccentColors = [
  'var(--accent-blue)',
  'var(--accent-red)', 
  'var(--accent-green)',
  'var(--accent-orange)',
  'var(--accent-purple)',
  'var(--accent-cyan)'
];

// Dark theme is always active
function isDarkThemeActive() {
  return true;
}

// Get event status
function getEventStatus(table) {
  const now = new Date();
  const general = table.general || {};
  const start = general.start ? new Date(general.start) : null;
  const end = general.end ? new Date(general.end) : null;
  
  if (table.isLive || (start && end && now >= start && now <= end)) {
    return { label: 'LIVE', class: 'live' };
  } else if (start && now < start) {
    return { label: 'Upcoming', class: 'upcoming' };
  } else {
    return { label: 'Past', class: 'past' };
  }
}

// Format date range for dark theme table
function formatDateRangeDark(start, end) {
  if (!start) return '—';
  
  const startDate = new Date(start);
  const options = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  const startStr = startDate.toLocaleDateString('en-US', options);
  
  if (!end || start === end) {
    return startStr;
  }
  
  const endDate = new Date(end);
  const endOptions = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  const endStr = endDate.toLocaleDateString('en-US', endOptions);
  
  return `${startStr} – ${endStr}`;
}

// Render crew avatars for dark theme
// Get initials from a name
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function renderCrewAvatarsDark(crewMembers, totalCount) {
  const maxVisible = 4;
  const crewArray = Array.isArray(crewMembers) ? crewMembers : [];
  const hasOverflow = totalCount > maxVisible;
  // If overflow, show 3 avatars + overflow indicator; otherwise show up to 4
  const avatarsToShow = hasOverflow ? Math.min(crewArray.length, maxVisible - 1) : Math.min(crewArray.length, maxVisible);
  const overflow = totalCount - avatarsToShow;
  
  let html = '<div class="avatar-stack">';
  
  // Show actual crew members if available
  if (crewArray.length > 0) {
    for (let i = 0; i < avatarsToShow; i++) {
      const member = crewArray[i];
      const name = member?.name || member?.fullName || member?.email || 'Crew';
      const photo = member?.photo || member?.avatar || member?.profileImage;
      const initials = getInitials(name);
      
      if (photo) {
        html += `
          <div class="crew-avatar" title="${name}">
            <img src="${photo}" alt="${name}" onerror="this.parentElement.innerHTML='<span class=\\'initials\\'>${initials}</span>'">
          </div>
        `;
      } else {
        html += `
          <div class="crew-avatar initials-avatar" title="${name}">
            <span class="initials">${initials}</span>
          </div>
        `;
      }
    }
  } else if (totalCount > 0) {
    // No crew member details, just show placeholders based on count
    const placeholderCount = hasOverflow ? maxVisible - 1 : Math.min(totalCount, maxVisible);
    for (let i = 0; i < placeholderCount; i++) {
    html += `
      <div class="crew-avatar placeholder">
          <span class="material-symbols-outlined avatar-icon">person</span>
      </div>
    `;
  }
  }
  
  // Show +N overflow indicator as part of the avatar stack
  if (hasOverflow && overflow > 0) {
    // Build crew list for the expanded view
    const crewListItems = crewArray.map(member => {
      const name = member?.name || member?.fullName || member?.email || 'Crew';
      const initials = getInitials(name);
      const photo = member?.photo || member?.avatar || member?.profileImage;
      const avatarHtml = photo 
        ? `<img src="${photo}" alt="${name}" class="crew-list-avatar-img">`
        : `<span class="crew-list-initials">${initials}</span>`;
      return `<div class="crew-list-item"><div class="crew-list-avatar">${avatarHtml}</div><span class="crew-list-name">${name}</span></div>`;
    }).join('');
    
    html += `
      <div class="crew-avatar overflow-count crew-expand-trigger" data-crew-count="${totalCount}">
        +${overflow}
        <div class="crew-expanded-view">
          <div class="crew-expanded-header">Crew Members (${totalCount})</div>
          <div class="crew-expanded-list-wrapper ${totalCount > 5 ? 'has-scroll' : ''}">
            <div class="crew-expanded-list">${crewListItems}</div>
          </div>
          <button class="crew-view-all-btn" onclick="event.stopPropagation(); window.navigate && window.navigate('crew-planner');">
            <span class="material-symbols-outlined">group</span>
            View Crew Page
          </button>
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  
  // Always show total crew count
  if (totalCount > 0) {
    html += `
      <span class="crew-total-count">${totalCount}</span>
    `;
  }
  
  return html;
}

// Render event row for dark theme table
function renderEventRowDark(table, index, userId) {
  const general = table.general || {};
  const accentColor = rowAccentColors[index % rowAccentColors.length];
  const status = getEventStatus(table);
  
  // Get unique crew member names from rows
  const rows = table.rows || [];
  const uniqueCrewNames = [...new Set(rows.map(r => r.name).filter(n => n && n.trim()))];
  const crewMembers = uniqueCrewNames.map(name => ({ name }));
  const crewCount = crewMembers.length;
  
  const dateStr = formatDateRangeDark(general.start, general.end);
  const isOwner = Array.isArray(table.owners) && table.owners.includes(userId);
  
  const row = document.createElement('tr');
  row.className = 'event-row';
  row.dataset.eventId = table._id;
  
  // Get city and state from general
  const cityState = [general.city, general.state].filter(Boolean).join(', ');
  
  row.innerHTML = `
    <td style="--row-accent: ${accentColor};">
      <div class="event-name-cell">
        <div class="event-name">
          ${table.title || 'Untitled Event'}
          <span class="material-symbols-outlined edit-icon" onclick="event.stopPropagation(); openEditEventModal('${table._id}', this)">edit</span>
        </div>
        ${cityState ? `
          <div class="event-location-info">
            <span class="material-symbols-outlined" style="font-size: 14px;">location_on</span>
            ${cityState}
          </div>
          ` : ''}
      </div>
    </td>
    <td>
      <span class="event-client">${general.client || '—'}</span>
    </td>
    <td>
      <span class="event-date">${dateStr}</span>
    </td>
    <td>
      <div class="crew-avatars">
        ${renderCrewAvatarsDark(crewMembers, crewCount)}
      </div>
    </td>
    <td>
      <div class="event-status">
        <span class="status-badge ${status.class}">${status.label}</span>
      </div>
    </td>
    <td>
      <div class="event-actions">
        <button class="action-menu-btn">
          <span class="material-symbols-outlined">more_horiz</span>
        </button>
        <div class="action-dropdown" id="menu-${table._id}">
          <button class="action-item open-action">
            <span class="material-symbols-outlined">open_in_new</span>
            Open Event
          </button>
          <div class="dropdown-divider"></div>
          <button class="action-item calendar-action">
            <span class="material-symbols-outlined">event</span>
            Add to Calendar
          </button>
          <button class="action-item archive-action">
            <span class="material-symbols-outlined">${table.userArchived ? 'unarchive' : 'inventory_2'}</span>
            ${table.userArchived ? 'Unarchive' : 'Archive'}
          </button>
          ${isOwner ? `
            <button class="action-item share-action">
              <span class="material-symbols-outlined">person_add</span>
              Share
            </button>
            <div class="dropdown-divider"></div>
            <button class="action-item danger delete-action">
              <span class="material-symbols-outlined">delete_forever</span>
              Delete
            </button>
          ` : ''}
        </div>
      </div>
    </td>
  `;
  
  // Add event listeners
  const menuBtn = row.querySelector('.action-menu-btn');
  const menu = row.querySelector('.action-dropdown');
  
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close all other menus
    document.querySelectorAll('.action-dropdown.show').forEach(m => {
      if (m !== menu) {
        m.classList.remove('show');
        m.classList.remove('flip-up');
      }
    });
    
    const isOpen = menu.classList.toggle('show');
    
    if (isOpen) {
      // Use fixed positioning for proper placement
      const btnRect = menuBtn.getBoundingClientRect();
      const menuHeight = 220; // Approximate menu height
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - btnRect.bottom;
      
      menu.style.position = 'fixed';
      menu.style.right = (window.innerWidth - btnRect.right) + 'px';
      menu.style.left = 'auto';
      
      // Check if there's enough space below, otherwise flip up
      if (spaceBelow < menuHeight && btnRect.top > menuHeight) {
        menu.style.top = 'auto';
        menu.style.bottom = (viewportHeight - btnRect.top + 8) + 'px';
        menu.classList.add('flip-up');
      } else {
        menu.style.top = (btnRect.bottom + 8) + 'px';
        menu.style.bottom = 'auto';
        menu.classList.remove('flip-up');
      }
    }
  });
  
  // Crew expand trigger - click to show crew list
  const crewExpandTrigger = row.querySelector('.crew-expand-trigger');
  if (crewExpandTrigger) {
    const expandedView = crewExpandTrigger.querySelector('.crew-expanded-view');
    
    if (expandedView) {
      // Move expanded view to body for proper z-index stacking
      document.body.appendChild(expandedView);
      
      // Prevent clicks inside expanded view from closing it
      expandedView.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      crewExpandTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        // Close other expanded views
        document.querySelectorAll('.crew-expanded-view.show').forEach(v => {
          if (v !== expandedView) v.classList.remove('show');
        });
        document.querySelectorAll('.crew-expand-trigger.show-expanded').forEach(t => {
          if (t !== crewExpandTrigger) t.classList.remove('show-expanded');
        });
        
        // Toggle this one
        const isOpen = expandedView.classList.toggle('show');
        crewExpandTrigger.classList.toggle('show-expanded', isOpen);
        
        if (isOpen) {
          // Position the expanded view
          const triggerRect = crewExpandTrigger.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          const expandedHeight = 300;
          const expandedWidth = 260;
          
          // Calculate left position (don't go off screen)
          let leftPos = triggerRect.left - (expandedWidth / 2) + (triggerRect.width / 2);
          leftPos = Math.max(10, Math.min(leftPos, viewportWidth - expandedWidth - 10));
          
          // Position above if near bottom, otherwise below
          if (triggerRect.bottom + expandedHeight > viewportHeight && triggerRect.top > expandedHeight) {
            expandedView.style.bottom = (viewportHeight - triggerRect.top + 12) + 'px';
            expandedView.style.top = 'auto';
          } else {
            expandedView.style.top = (triggerRect.bottom + 12) + 'px';
            expandedView.style.bottom = 'auto';
          }
          expandedView.style.left = leftPos + 'px';
        }
      });
    }
  }
  
  // Action buttons
  row.querySelector('.open-action').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.remove('show');
    window.navigate('general', table._id);
  });
  
  row.querySelector('.calendar-action').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.remove('show');
    showAddToCalendarModal(table);
  });
  
  row.querySelector('.archive-action').addEventListener('click', async (e) => {
    e.stopPropagation();
    menu.classList.remove('show');
    const action = table.userArchived ? 'unarchive' : 'archive';
    const confirmTitle = table.userArchived ? 'Unarchive Event' : 'Archive Event';
    const confirmMessage = table.userArchived 
      ? 'Are you sure you want to unarchive this event?' 
      : 'Are you sure you want to archive this event?';
    
    const confirmed = await showConfirm(confirmTitle, confirmMessage, { 
      confirmText: table.userArchived ? 'Unarchive' : 'Archive', 
      type: 'warning' 
    });
    if (confirmed) {
      await fetch(`${API_BASE}/api/tables/${table._id}/user-archive`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ archive: !table.userArchived })
      });
      showToast(`Event ${action}d successfully`, 'success');
      loadTables();
    }
  });
  
  const shareBtn = row.querySelector('.share-action');
  if (shareBtn) {
    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.remove('show');
      openShareModal(table._id);
    });
  }
  
  const deleteBtn = row.querySelector('.delete-action');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.classList.remove('show');
      const confirmed = await showConfirm(
        'Delete Event',
        'Are you sure you want to delete this event? This will also release all gear items reserved for this event.',
        { confirmText: 'Delete', type: 'danger' }
      );
      if (confirmed) {
        try {
          const response = await fetch(`${API_BASE}/api/tables/${table._id}`, {
            method: 'DELETE',
            headers: { Authorization: token }
          });
          
          if (response.ok) {
            const result = await response.json();
            showToast(result.message || 'Event deleted successfully!', 'success');
          } else {
            const error = await response.json();
            showToast(`Error deleting event: ${error.error || 'Unknown error'}`, 'error');
          }
        } catch (err) {
          console.error('Error deleting event:', err);
          showToast('Error deleting event. Please try again.', 'error');
        }
        loadTables();
      }
    });
  }
  
  return row;
}

// Cache for events data
let cachedTables = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30000; // 30 seconds

// Generate skeleton loading rows
function generateSkeletonRows(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <tr class="event-row skeleton-row">
        <td>
          <div class="skeleton-content">
            <div class="skeleton" style="width: 180px; height: 18px; margin-bottom: 8px;"></div>
            <div class="skeleton" style="width: 100px; height: 14px;"></div>
          </div>
        </td>
        <td><div class="skeleton" style="width: 120px; height: 16px;"></div></td>
        <td><div class="skeleton" style="width: 140px; height: 16px;"></div></td>
        <td>
          <div style="display: flex; gap: -8px;">
            <div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%;"></div>
            <div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%; margin-left: -8px;"></div>
            <div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%; margin-left: -8px;"></div>
          </div>
        </td>
        <td><div class="skeleton" style="width: 80px; height: 24px; border-radius: 12px;"></div></td>
        <td><div class="skeleton" style="width: 32px; height: 32px; border-radius: 8px;"></div></td>
      </tr>
    `;
  }
  return html;
}

async function loadTables(forceRefresh = false) {
  const loadingEl = document.getElementById('eventsLoading');
  const tableBody = document.getElementById('eventsTableBody');
  const emptyEl = document.getElementById('eventsEmpty');
  
  // Show loading state with skeleton rows
  if (loadingEl) loadingEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  
  // Show skeleton rows if table is empty
  if (tableBody && tableBody.children.length === 0) {
    tableBody.innerHTML = generateSkeletonRows(5);
  } else if (tableBody) {
    tableBody.style.opacity = '0.6';
  }
  
  let tables;
  const now = Date.now();
  
  // Use cache if available and not expired
  if (!forceRefresh && cachedTables && (now - cacheTimestamp) < CACHE_DURATION) {
    tables = cachedTables;
  } else {
  const res = await fetch(`${API_BASE}/api/tables`, {
    headers: { Authorization: token }
  });
    tables = await res.json();
    
    // Update cache
    cachedTables = tables;
    cacheTimestamp = now;
  }
  
  // Hide loading
  if (loadingEl) loadingEl.style.display = 'none';
  if (tableBody) tableBody.style.opacity = '1';

  const userId = getUserIdFromToken();
  const isDarkTheme = isDarkThemeActive();

  // Filter tables based on status filter
  let filteredTables = tables;
  if (statusFilter === 'active') {
    filteredTables = tables.filter(table => !table.userArchived);
  } else if (statusFilter === 'archived') {
    filteredTables = tables.filter(table => !!table.userArchived);
  }
  // 'all' shows everything

  // Filter by search box
  if (searchEventsValue) {
    const q = searchEventsValue.toLowerCase();
    filteredTables = filteredTables.filter(table => {
      const title = (table.title || '').toLowerCase();
      const client = (table.general?.client || '').toLowerCase();
      return title.includes(q) || client.includes(q);
    });
  }

  // Filter by date range
  if (dateFilterStart || dateFilterEnd) {
    filteredTables = filteredTables.filter(table => {
      const eventStart = table.general?.start ? new Date(table.general.start) : null;
      const eventEnd = table.general?.end ? new Date(table.general.end) : null;
      
      // If event has no dates, exclude from date-filtered results
      if (!eventStart && !eventEnd) return false;
      
      const filterStart = dateFilterStart ? new Date(dateFilterStart) : null;
      const filterEnd = dateFilterEnd ? new Date(dateFilterEnd) : null;
      
      // Check if event overlaps with the filter date range
      if (filterStart && filterEnd) {
        // Event overlaps if it starts before filter ends AND ends after filter starts
        const eventEndDate = eventEnd || eventStart;
        const eventStartDate = eventStart || eventEnd;
        return eventStartDate <= filterEnd && eventEndDate >= filterStart;
      } else if (filterStart) {
        // Only start date set - show events that end on or after this date
        const eventEndDate = eventEnd || eventStart;
        return eventEndDate >= filterStart;
      } else if (filterEnd) {
        // Only end date set - show events that start on or before this date
        const eventStartDate = eventStart || eventEnd;
        return eventStartDate <= filterEnd;
      }
      
      return true;
    });
  }

  const sortValue = document.getElementById('sortDropdown')?.value || 'newest';
  filteredTables.sort((a, b) => {
    // Create UTC dates for consistent sorting regardless of timezone
    const parseDateUTC = (dateStr) => {
      if (!dateStr) return new Date(0);
      const date = new Date(dateStr);
      // Create a UTC date to prevent timezone issues
      return date;
    };
    
    const dateA = parseDateUTC(a.general?.start || a.createdAt || 0);
    const dateB = parseDateUTC(b.general?.start || b.createdAt || 0);
    
    if (sortValue === 'newest') return dateB - dateA;
    if (sortValue === 'oldest') return dateA - dateB;
    if (sortValue === 'title') return (a.title || '').localeCompare(b.title || '');
    return 0;
  });

  // Check if using dark theme table layout
  if (isDarkTheme) {
    const tableBody = document.getElementById('eventsTableBody');
    const eventsCount = document.getElementById('eventsCount');
    
    if (tableBody) {
      tableBody.innerHTML = '';
      
      // Determine current filter tab
      const activeTab = document.querySelector('.events-tab.active');
      const filter = activeTab ? activeTab.dataset.filter : 'upcoming';
      
      // Filter by tab
      let tabFilteredTables = filteredTables;
      if (filter !== 'all') {
        tabFilteredTables = filteredTables.filter(table => {
          const status = getEventStatus(table);
          return status.class === filter;
        });
      }
      
      tabFilteredTables.forEach((table, index) => {
        const row = renderEventRowDark(table, index, userId);
        tableBody.appendChild(row);
      });
      
      if (eventsCount) {
        eventsCount.textContent = `Showing ${tabFilteredTables.length} of ${filteredTables.length} events`;
      }
    }
    
    // Close menus and crew expanded views when clicking outside
    document.addEventListener('click', () => {
      document.querySelectorAll('.action-dropdown.show').forEach(menu => {
        menu.classList.remove('show');
      });
      document.querySelectorAll('.crew-expanded-view.show').forEach(view => {
        view.classList.remove('show');
      });
      document.querySelectorAll('.crew-expand-trigger.show-expanded').forEach(trigger => {
        trigger.classList.remove('show-expanded');
      });
    });
    
    return; // Skip the old card rendering
  }

  const list = document.getElementById('tableList');
  if (list) list.innerHTML = '';

  // Check if we're showing archived events
  if (showArchived) {
    // For archived events, show single list as before
    // Reset the list container to use table-cards class for proper layout
    list.className = 'table-cards';
    // Reset inline styles that might have been set for non-archived view
    list.style.display = '';
    list.style.flexDirection = '';
    list.style.gap = '';
    filteredTables.forEach(table => {
      renderEventCard(table, list, userId);
    });
  } else {
    // For non-archived events, split into Active and All Events sections
    // Reset the list container to remove table-cards class since we'll use sections
    list.className = '';
    // Ensure sections stack vertically
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '0';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day for comparison
    
    // Helper function to check if an event is active
    const isEventActive = (table) => {
      const general = table.general || {};
      if (!general.start || !general.end) return false;
      
      // Parse dates and extract just the date portion to avoid timezone issues
      const startDateStr = general.start.split('T')[0]; // Get YYYY-MM-DD part
      const endDateStr = general.end.split('T')[0]; // Get YYYY-MM-DD part
      const todayStr = today.toISOString().split('T')[0]; // Get YYYY-MM-DD part
      
      // Compare date strings directly to avoid timezone conversion issues
      return todayStr >= startDateStr && todayStr <= endDateStr;
    };
    
    // Split events into active and non-active
    const activeEvents = filteredTables.filter(isEventActive);
    const nonActiveEvents = filteredTables.filter(table => !isEventActive(table));
    
    // Create Active Events section if there are active events
    if (activeEvents.length > 0) {
      const activeSection = document.createElement('div');
      activeSection.className = 'events-section';
      
      const activeHeader = document.createElement('h3');
      activeHeader.className = 'events-section-header';
      activeHeader.textContent = 'Active Events';
      activeHeader.style.cssText = `
        margin: 0 0 16px 0;
        padding: 12px 0;
        border-bottom: 2px solid #CC0007;
        color: #CC0007;
        font-size: 1.2em;
        font-weight: 600;
        text-align: center;
      `;
      
      // Create the cards container with proper flex layout
      const activeCardsContainer = document.createElement('div');
      activeCardsContainer.className = 'table-cards';
      
      activeSection.appendChild(activeHeader);
      activeSection.appendChild(activeCardsContainer);
      
      activeEvents.forEach(table => {
        renderEventCard(table, activeCardsContainer, userId);
      });
      
      list.appendChild(activeSection);
    }
    
    // Create All Events section
    if (nonActiveEvents.length > 0) {
      const allEventsSection = document.createElement('div');
      allEventsSection.className = 'events-section';
      
      const allHeader = document.createElement('h3');
      allHeader.className = 'events-section-header';
      allHeader.textContent = 'All Events';
      allHeader.style.cssText = `
        margin: ${activeEvents.length > 0 ? '32px' : '0'} 0 16px 0;
        padding: 12px 0;
        border-bottom: 2px solid #CC0007;
        color: #CC0007;
        font-size: 1.2em;
        font-weight: 600;
        text-align: center;
      `;
      
      // Create the cards container with proper flex layout
      const allCardsContainer = document.createElement('div');
      allCardsContainer.className = 'table-cards';
      
      allEventsSection.appendChild(allHeader);
      allEventsSection.appendChild(allCardsContainer);
      
      nonActiveEvents.forEach(table => {
        renderEventCard(table, allCardsContainer, userId);
      });
      
      list.appendChild(allEventsSection);
    }
  }

  renderCalendar(filteredTables);

  // Ensure only the correct view is visible
  const cal = document.getElementById('calendarViewContainer');
  if (list && cal) {
    if (cal.style.display === 'block') {
      list.style.display = 'none';
      cal.style.display = 'block';
    } else {
      list.style.display = 'flex';
      cal.style.display = 'none';
    }
  }
}

// Helper function to render a single event card
function renderEventCard(table, container, userId) {
  const general = table.general || {};
  const client = general.client || 'N/A';
  
  // Format dates consistently with UTC to prevent timezone shifts
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    // Use UTC date methods to prevent timezone issues
    return date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric',
      timeZone: 'UTC' // Prevent timezone shifts
    });
  };
  
  const start = formatDate(general.start);
  const end = formatDate(general.end);

  const card = document.createElement('div');
  card.className = 'table-card';

  const header = document.createElement('div');
  header.className = 'event-header';
  
  // Title and details container
  const titleContainer = document.createElement('div');
  titleContainer.className = 'event-title-container';

  const title = document.createElement('h3');
  title.textContent = table.title;

  const details = document.createElement('div');
  details.className = 'event-details';
  details.innerHTML = `Client: ${client} <br> ${start} - ${end}`;
  
  titleContainer.appendChild(title);
  titleContainer.appendChild(details);
  
  // 3-dot menu button in top right
  const menuContainer = document.createElement('div');
  menuContainer.className = 'event-menu-container';
  
  const menuBtn = document.createElement('button');
  menuBtn.className = 'event-menu-btn';
  menuBtn.innerHTML = '<span class="material-symbols-outlined">more_vert</span>';
  menuBtn.setAttribute('aria-label', 'Event options');
  
  const menuDropdown = document.createElement('div');
  menuDropdown.className = 'event-menu-dropdown';
  
  menuContainer.appendChild(menuBtn);
  menuContainer.appendChild(menuDropdown);

  header.appendChild(titleContainer);
  header.appendChild(menuContainer);

  const actions = document.createElement('div');
  actions.className = 'action-buttons';

  const openBtn = document.createElement('button');
  openBtn.className = 'btn-open';
  openBtn.textContent = 'OPEN';
  openBtn.onclick = () => {
    const page = 'general'; // Set this to the correct page identifier
    const tableId = table._id;
    window.navigate(page, tableId);
  };

  const addToCalendarBtn = document.createElement('button');
  addToCalendarBtn.className = 'btn-add-calendar';
  addToCalendarBtn.innerHTML = '<span class="material-symbols-outlined">event</span> Add to Calendar';
  addToCalendarBtn.onclick = (e) => {
    e.stopPropagation();
    showAddToCalendarModal(table);
  };

  const isOwner = Array.isArray(table.owners) && table.owners.includes(userId);

  // Create menu items for dropdown
  const archiveMenuItem = document.createElement('button');
  archiveMenuItem.className = 'menu-item';
  archiveMenuItem.innerHTML = `<span class="material-symbols-outlined">archive</span> ${table.userArchived ? 'Unarchive' : 'Archive'}`;
  archiveMenuItem.onclick = async (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('show');
    const action = table.userArchived ? 'unarchive' : 'archive';
    const confirmTitle = table.userArchived ? 'Unarchive Event' : 'Archive Event';
    const confirmMessage = table.userArchived 
      ? 'Are you sure you want to unarchive this event for yourself?' 
      : 'Are you sure you want to archive this event for yourself?';
    
    const confirmed = await showConfirm(confirmTitle, confirmMessage, { 
      confirmText: table.userArchived ? 'Unarchive' : 'Archive', 
      type: 'warning' 
    });
    if (confirmed) {
      await fetch(`${API_BASE}/api/tables/${table._id}/user-archive`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ archive: !table.userArchived })
      });
      showToast(`Event ${action}d successfully`, 'success');
      loadTables();
    }
  };

  const shareMenuItem = document.createElement('button');
  shareMenuItem.className = 'menu-item';
  shareMenuItem.innerHTML = '<span class="material-symbols-outlined">share</span> Share';
  shareMenuItem.onclick = (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('show');
    openShareModal(table._id);
  };

  const deleteMenuItem = document.createElement('button');
  deleteMenuItem.className = 'menu-item menu-item-danger';
  deleteMenuItem.innerHTML = '<span class="material-symbols-outlined">delete</span> Delete';
  deleteMenuItem.onclick = async (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('show');
    const confirmed = await showConfirm(
      'Delete Event',
      'Are you sure you want to delete this event? This will also release all gear items reserved for this event back to inventory.',
      { confirmText: 'Delete', type: 'danger' }
    );
    if (confirmed) {
      try {
        const response = await fetch(`${API_BASE}/api/tables/${table._id}`, {
          method: 'DELETE',
          headers: { Authorization: token }
        });
        
        if (response.ok) {
          const result = await response.json();
          showToast(result.message || 'Event deleted successfully!', 'success');
        } else {
          const error = await response.json();
          showToast(`Error deleting event: ${error.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        console.error('Error deleting event:', err);
        showToast('Error deleting event. Please try again.', 'error');
      }
      loadTables();
    }
  };

  // Add menu items to dropdown
  menuDropdown.appendChild(archiveMenuItem);
  if (isOwner) {
    menuDropdown.appendChild(shareMenuItem);
    menuDropdown.appendChild(deleteMenuItem);
  }

  // Toggle menu on button click
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    // Close all other menus
    document.querySelectorAll('.event-menu-dropdown.show').forEach(menu => {
      if (menu !== menuDropdown) {
        menu.classList.remove('show');
      }
    });
    menuDropdown.classList.toggle('show');
  };

  // Close menu when clicking outside
  document.addEventListener('click', () => {
    menuDropdown.classList.remove('show');
  });

  // Add buttons to actions (Open and Add to Calendar in same row)
  actions.appendChild(openBtn);
  actions.appendChild(addToCalendarBtn);

  card.append(header, actions);
  if (container) container.appendChild(card);
}

function renderCalendar(events) {
  const container = document.getElementById('calendarViewContainer');
  if (!container) return;
  container.innerHTML = '';

  // Get all event date ranges - fix timezone issues by parsing dates as UTC
  const eventObjs = events.map(table => {
    const general = table.general || {};
    
    // Parse dates as UTC to prevent timezone shifts
    const parseUTCDate = (dateStr) => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      // Create a new date using UTC components to prevent timezone shifts
      return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    };
    
    return {
      id: table._id,
      title: table.title,
      start: parseUTCDate(general.start),
      end: parseUTCDate(general.end),
      color: '#CC0007', // main accent
    };
  }).filter(e => e.start && e.end);

  // Find min and max dates
  let minDate = null, maxDate = null;
  eventObjs.forEach(e => {
    if (!minDate || e.start < minDate) minDate = e.start;
    if (!maxDate || e.end > maxDate) maxDate = e.end;
  });
  if (!minDate || !maxDate) {
    container.innerHTML = '<div style="text-align:center; color:#888;">No events to display in calendar.</div>';
    return;
  }

  // Show current month by default
  let currentMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);

  function renderMonth(monthDate) {
    container.innerHTML = '';
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startWeekDay = firstDay.getDay();
    const gap = 8; // matches grid gap in CSS

    // Header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '18px';
    header.innerHTML = `
      <button id="prevMonthBtn" style="background:none;border:none;color:#CC0007;font-size:22px;cursor:pointer;">&#8592;</button>
      <span style="font-size:1.3em;font-weight:600;color:#CC0007;">${firstDay.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
      <button id="nextMonthBtn" style="background:none;border:none;color:#CC0007;font-size:22px;cursor:pointer;">&#8594;</button>
    `;
    container.appendChild(header);

    // Days of week
    const daysRow = document.createElement('div');
    daysRow.style.display = 'grid';
    daysRow.style.gridTemplateColumns = 'repeat(7, 1fr)';
    daysRow.style.gap = '4px';
    daysRow.style.marginBottom = '6px';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
      const el = document.createElement('div');
      el.textContent = d;
      el.style.textAlign = 'center';
      el.style.fontWeight = 'bold';
      el.style.color = '#a1a1a1';
      daysRow.appendChild(el);
    });
    container.appendChild(daysRow);

    // Calendar grid
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    grid.style.gap = '8px';
    grid.style.background = 'linear-gradient(135deg, #fff 60%, #f8fafd 100%)';
    grid.style.borderRadius = '18px';
    grid.style.boxShadow = '0 8px 24px rgba(0,0,0,0.09)';
    grid.style.padding = '18px';
    grid.style.marginBottom = '18px';

    // Fill blanks for first week
    for (let i = 0; i < startWeekDay; i++) {
      const blank = document.createElement('div');
      grid.appendChild(blank);
    }
    // Fill days
    const dayCells = [];
    // For stacking: track max stack per week
    const weekStacks = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const cell = document.createElement('div');
      cell.style.minHeight = '60px';
      cell.style.borderRadius = '10px';
      cell.style.background = '#fff';
      cell.style.boxShadow = '0 2px 8px rgba(204,0,7,0.04)';
      cell.style.padding = '4px 4px 2px 4px';
      cell.style.position = 'relative';
      cell.style.display = 'flex';
      cell.style.flexDirection = 'column';
      cell.style.alignItems = 'flex-start';
      cell.style.justifyContent = 'flex-start';
      cell.style.cursor = 'pointer';
      cell.style.transition = 'background 0.15s, box-shadow 0.15s';
      cell.classList.add('calendar-day');
      // Day number
      const dayNum = document.createElement('div');
      dayNum.textContent = day;
      dayNum.className = 'calendar-day-num';
      cell.appendChild(dayNum);
      grid.appendChild(cell);
      dayCells.push(cell);
      // For stacking: initialize weekStacks
      const weekIdx = Math.floor((day + startWeekDay - 1) / 7);
      if (!weekStacks[weekIdx]) weekStacks[weekIdx] = [];
      weekStacks[weekIdx][(day + startWeekDay - 1) % 7] = [];
    }
    // Multi-day event rendering (after grid is built)
    eventObjs.forEach(ev => {
      // Find the first and last day in this month for the event
      const eventStart = new Date(Math.max(ev.start, firstDay));
      const eventEnd = new Date(Math.min(ev.end, lastDay));
      if (eventStart > lastDay || eventEnd < firstDay) return;
      // Calculate the start and end day index (0-based)
      let startIdx = eventStart.getDate() - 1;
      let endIdx = eventEnd.getDate() - 1;
      // For each week the event spans, render a pill in the first day of that week
      let idx = startIdx;
      while (idx <= endIdx) {
        // Find the week boundary
        const weekDay = (idx + startWeekDay) % 7;
        const weekIdx = Math.floor((idx + startWeekDay) / 7);
        const daysLeftInWeek = 7 - weekDay;
        const span = Math.min(endIdx - idx + 1, daysLeftInWeek);
        // Find the max stack index for this week segment
        let maxStack = 0;
        for (let d = 0; d < span; d++) {
          const cellStack = weekStacks[weekIdx][weekDay + d] || [];
          if (cellStack.length > maxStack) maxStack = cellStack.length;
        }
        // Assign this event to the next available stack index for all spanned days
        for (let d = 0; d < span; d++) {
          if (!weekStacks[weekIdx][weekDay + d]) weekStacks[weekIdx][weekDay + d] = [];
          weekStacks[weekIdx][weekDay + d][maxStack] = true;
        }
        // Render the pill at the correct stack index
        const pill = document.createElement('div');
        pill.textContent = ev.title;
        pill.className = 'calendar-event-pill';
        pill.title = ev.title;
        pill.style.background = ev.color;
        pill.style.color = '#fff';
        pill.style.position = 'absolute';
        pill.style.left = '0';
        pill.style.top = `${28 + maxStack * 28}px`;
        pill.style.height = '24px';
        pill.style.display = 'flex';
        pill.style.alignItems = 'center';
        pill.style.fontSize = '0.95em';
        pill.style.fontWeight = '600';
        pill.style.cursor = 'pointer';
        pill.style.boxShadow = '0 2px 8px rgba(204,0,7,0.08)';
        pill.style.zIndex = '2';
        pill.style.border = '2px solid #fff';
        pill.style.opacity = '0.96';
        pill.style.pointerEvents = 'auto';
        pill.onclick = (e) => {
          e.stopPropagation();
          window.navigate('general', ev.id);
        };
        // Calculate width: span * 100% + (span-1)*gap, but subtract 8px for the last pill in a week or for the event
        let pillWidth = `calc(${span * 100}% + ${(span - 1) * gap}px)`;
        if (idx + span - 1 === endIdx || ((idx + span + startWeekDay - 1) % 7 === 6)) {
          pillWidth = `calc(${span * 100}% + ${(span - 1) * gap}px - 8px)`;
        }
        pill.style.width = pillWidth;
        pill.style.maxWidth = pillWidth;
        pill.style.minWidth = pillWidth;
        // Append pill to the first cell of the span
        dayCells[idx].appendChild(pill);
        // Adjust minHeight of all spanned cells to fit stacked pills
        for (let d = 0; d < span; d++) {
          const cell = dayCells[idx + d];
          const minHeight = 60 + (maxStack * 28);
          if (cell) cell.style.minHeight = `${minHeight}px`;
        }
        idx += span;
      }
    });
    container.appendChild(grid);

    // Navigation
    document.getElementById('prevMonthBtn').onclick = () => {
      currentMonth = new Date(year, month - 1, 1);
      renderMonth(currentMonth);
    };
    document.getElementById('nextMonthBtn').onclick = () => {
      currentMonth = new Date(year, month + 1, 1);
      renderMonth(currentMonth);
    };
  }
  renderMonth(currentMonth);
}

async function openShareModal(tableId) {
  try {
    console.log('[SHARE_MODAL] Opening share modal for table:', tableId);
    
    // First fetch the table to check ownership
    const res = await fetch(`${API_BASE}/api/tables/${tableId}`, {
      headers: { Authorization: token }
    });
    
    if (!res.ok) {
      throw new Error('Failed to fetch table details');
    }
    
    const table = await res.json();
    const userId = getUserIdFromToken();
    
    // Check if the current user is an owner
    const isOwner = Array.isArray(table.owners) && table.owners.includes(userId);
    
    // If not owner, show not authorized message and return early
    if (!isOwner) {
      showToast('Not authorized. Only owners can share events.', 'error');
      return;
    }
    
    // If owner, proceed with opening the share modal
    currentTableId = tableId;
    const shareModal = document.getElementById('shareModal');
    console.log('[SHARE_MODAL] Found shareModal element:', !!shareModal);
    
    if (!shareModal) {
      console.error('[SHARE_MODAL] shareModal element not found in DOM!');
      showToast('Error: Share modal not found. Please refresh the page.', 'error');
      return;
    }
    
    if (shareModal) {
      shareModal.classList.add('show');
      document.body.style.overflow = 'hidden';
      console.log('[SHARE_MODAL] Modal shown');
    }

    // Fetch users for the lists
    const userRes = await fetch(`${API_BASE}/api/users`, {
      headers: { Authorization: token }
    });
    const users = await userRes.json();
    
    // Store all users for autofill functionality
    allUsers = users;

    const owners = users.filter(u => table.owners.includes(u._id));
    const leads = users.filter(u => table.leads.includes(u._id) && !table.owners.includes(u._id));
    const shared = users.filter(u => table.sharedWith.includes(u._id) && !table.leads.includes(u._id) && !table.owners.includes(u._id));

    // Render into <ul> elements
    const ownerList = document.getElementById('ownerList')?.querySelector('ul');
    const leadList = document.getElementById('leadList')?.querySelector('ul');
    const sharedList = document.getElementById('sharedList')?.querySelector('ul');

    // Helper to check if user is a lead
    const isLead = (user) => Array.isArray(table.leads) && table.leads.includes(user._id);
    // Helper to check if user is an owner
    const isOwnerUser = (user) => Array.isArray(table.owners) && table.owners.includes(user._id);

    // Helper to get user initials for avatar
    function getInitials(name) {
      if (!name) return '?';
      const parts = name.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }

    // Helper to render user with styled layout
    function renderUser(user, isOwnerList) {
      const name = user.name || user.fullName || user.email;
      const email = user.email;
      const initials = getInitials(name);
      const currentUserId = getUserIdFromToken && getUserIdFromToken();
      const isSelf = user._id === currentUserId;
      
      // Build action buttons
      let actions = '';
      if (isOwner) {
        if (!isOwnerUser(user)) {
          actions += `<button class="share-role-btn owner-btn make-owner-btn" data-email="${email}">Owner</button>`;
        }
        if (!isLead(user)) {
          actions += `<button class="share-role-btn lead-btn make-lead-btn" data-email="${email}">Lead</button>`;
        }
        // Add remove button (not for self, and not for owners in owner list)
        if (!isSelf && (!isOwnerList || !isOwnerUser(user))) {
          actions += `<button class="share-remove-btn unshare-btn" data-email="${email}" title="Remove from event"><span class="material-symbols-outlined">close</span></button>`;
        }
      }
      
      return `
        <li>
          <div class="share-user-avatar">${initials}</div>
          <div class="share-user-info">
            <div class="share-user-name">${name}${isSelf ? ' (you)' : ''}</div>
            <div class="share-user-email">${email}</div>
          </div>
          <div class="share-user-actions">${actions}</div>
        </li>
      `;
    }

    // Render empty state if no users
    function renderEmptyState(message) {
      return `<div class="share-empty">${message}</div>`;
    }

    // Populate lists and update counts
    const ownerCount = document.getElementById('ownerCount');
    const leadCount = document.getElementById('leadCount');
    const sharedCount = document.getElementById('sharedCount');
    
    if (ownerList) {
      ownerList.innerHTML = owners.length > 0 
        ? `<ul>${owners.map(u => renderUser(u, true)).join('')}</ul>` 
        : renderEmptyState('No owners');
    }
    if (leadList) {
      leadList.innerHTML = leads.length > 0 
        ? `<ul>${leads.map(u => renderUser(u, false)).join('')}</ul>` 
        : renderEmptyState('No leads assigned');
    }
    if (sharedList) {
      sharedList.innerHTML = shared.length > 0 
        ? `<ul>${shared.map(u => renderUser(u, false)).join('')}</ul>` 
        : renderEmptyState('No users shared with');
    }
    
    // Update counts
    if (ownerCount) ownerCount.textContent = owners.length;
    if (leadCount) leadCount.textContent = leads.length;
    if (sharedCount) sharedCount.textContent = shared.length;

    // Add event listeners for the new buttons
    function addRoleButtonListeners() {
      document.querySelectorAll('.make-lead-btn').forEach(btn => {
        btn.onclick = async function() {
          const email = btn.getAttribute('data-email');
          const confirmed = await showConfirm('Make Lead', 'Are you sure you want to make this user a lead?', { confirmText: 'Make Lead', type: 'info' });
          if (confirmed) {
            await submitRoleChange(email, false, true);
          }
        };
      });
      document.querySelectorAll('.make-owner-btn').forEach(btn => {
        btn.onclick = async function() {
          const email = btn.getAttribute('data-email');
          const confirmed = await showConfirm('Make Owner', 'Are you sure you want to make this user an owner? This will give them full control of the event, including deletion.', { confirmText: 'Make Owner', type: 'warning' });
          if (confirmed) {
            await submitRoleChange(email, true, false);
          }
        };
      });
      document.querySelectorAll('.unshare-btn').forEach(btn => {
        btn.onclick = async function() {
          const email = btn.getAttribute('data-email');
          const confirmed = await showConfirm('Remove User', 'Are you sure you want to remove this user from the event?', { confirmText: 'Remove', type: 'danger' });
          if (confirmed) {
            await submitUnshare(email);
          }
        };
      });
    }
    addRoleButtonListeners();
    
    // Initialize autofill functionality
    setupUserAutofill();
    
    console.log('[SHARE_MODAL] Modal setup complete. Lists populated:', {
      owners: owners.length,
      leads: leads.length,
      shared: shared.length
    });

    // Helper to submit role change and refresh modal
    async function submitRoleChange(email, makeOwner, makeLead) {
      if (!email || !currentTableId) return;
      try {
        const res = await fetch(`${API_BASE}/api/tables/${currentTableId}/share`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token
          },
          body: JSON.stringify({ email, makeOwner, makeLead })
        });
        const result = await res.json();
        if (res.ok) {
          showToast('Role updated successfully', 'success');
          // Refresh the modal
          await openShareModal(currentTableId);
        } else {
          showToast(result.error || 'Error updating role', 'error');
        }
      } catch (err) {
        showToast('Failed to update role. Please try again.', 'error');
      }
    }

    // Helper to submit unshare and refresh modal
    async function submitUnshare(email) {
      if (!email || !currentTableId) return;
      try {
        const res = await fetch(`${API_BASE}/api/tables/${currentTableId}/share`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token
          },
          body: JSON.stringify({ email, unshare: true })
        });
        const result = await res.json();
        if (res.ok) {
          showToast('User removed from event', 'success');
          await openShareModal(currentTableId);
        } else {
          showToast(result.error || 'Error removing user', 'error');
        }
      } catch (err) {
        showToast('Failed to remove user. Please try again.', 'error');
      }
    }
  } catch (err) {
    console.error('Error in share modal:', err);
    showToast('Error opening share options. Please try again.', 'error');
  }
}

function setupUserAutofill() {
  const shareEmailInput = document.getElementById('shareEmail');
  const suggestionsContainer = document.getElementById('userSuggestions');
  const selectedUsersContainer = document.getElementById('selectedUsersList');
  
  if (!shareEmailInput || !suggestionsContainer || !selectedUsersContainer) return;
  
  // Clear any existing event listeners
  shareEmailInput.removeEventListener('input', handleUserInput);
  shareEmailInput.removeEventListener('keydown', handleKeyDown);
  shareEmailInput.removeEventListener('blur', hideSuggestions);
  
  // Reset selectedUsers array
  selectedUsers = [];
  renderSelectedUsers();
  
  function handleUserInput(e) {
    const query = e.target.value.toLowerCase().trim();
    
    if (query.length < 1) {
      hideSuggestions();
      return;
    }
    
    // Filter users based on name or email
    const filteredUsers = allUsers.filter(user => {
      const name = (user.name || user.fullName || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      
      // Don't show already selected users
      const isAlreadySelected = selectedUsers.some(selected => selected._id === user._id);
      
      return !isAlreadySelected && (name.includes(query) || email.includes(query));
    });
    
    showSuggestions(filteredUsers.slice(0, 8)); // Limit to 8 suggestions
  }
  
  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const activeSuggestion = suggestionsContainer.querySelector('.suggestion-active');
      if (activeSuggestion) {
        activeSuggestion.click();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateSuggestions(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSuggestions(-1);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  }
  
  function navigateSuggestions(direction) {
    const suggestions = suggestionsContainer.querySelectorAll('.suggestion-item');
    const active = suggestionsContainer.querySelector('.suggestion-active');
    
    let newIndex = 0;
    if (active) {
      const currentIndex = Array.from(suggestions).indexOf(active);
      newIndex = currentIndex + direction;
    }
    
    if (newIndex < 0) newIndex = suggestions.length - 1;
    if (newIndex >= suggestions.length) newIndex = 0;
    
    suggestions.forEach(s => s.classList.remove('suggestion-active'));
    if (suggestions[newIndex]) {
      suggestions[newIndex].classList.add('suggestion-active');
    }
  }
  
  // Helper to get initials
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  
  function showSuggestions(users) {
    if (users.length === 0) {
      hideSuggestions();
      return;
    }
    
    suggestionsContainer.innerHTML = users.map(user => {
      const name = user.name || user.fullName || user.email;
      const email = user.email;
      const initials = getInitials(name);
      return `
        <div class="suggestion-item" data-user-id="${user._id}">
          <div class="suggestion-avatar">${initials}</div>
          <div class="suggestion-info">
            <div class="suggestion-name">${name}</div>
            <div class="suggestion-email">${email}</div>
          </div>
        </div>
      `;
    }).join('');
    
    // Add click handlers for suggestions
    suggestionsContainer.querySelectorAll('.suggestion-item').forEach(suggestion => {
      suggestion.addEventListener('mouseenter', () => {
        suggestionsContainer.querySelectorAll('.suggestion-item').forEach(s => {
          s.classList.remove('suggestion-active');
        });
        suggestion.classList.add('suggestion-active');
      });
      
      suggestion.addEventListener('click', () => {
        const userId = suggestion.getAttribute('data-user-id');
        const user = allUsers.find(u => u._id === userId);
        if (user) {
          addSelectedUser(user);
          shareEmailInput.value = '';
          hideSuggestions();
        }
      });
    });
    
    // Position dropdown using fixed positioning to escape modal overflow
    const inputRect = shareEmailInput.getBoundingClientRect();
    suggestionsContainer.style.position = 'fixed';
    suggestionsContainer.style.top = `${inputRect.bottom + 4}px`;
    suggestionsContainer.style.left = `${inputRect.left}px`;
    suggestionsContainer.style.width = `${inputRect.width}px`;
    suggestionsContainer.classList.add('show');
  }
  
  function hideSuggestions() {
    setTimeout(() => {
      suggestionsContainer.classList.remove('show');
      // Reset positioning
      suggestionsContainer.style.position = '';
      suggestionsContainer.style.top = '';
      suggestionsContainer.style.left = '';
      suggestionsContainer.style.width = '';
    }, 200);
  }
  
  function addSelectedUser(user) {
    if (!selectedUsers.some(selected => selected._id === user._id)) {
      selectedUsers.push(user);
      renderSelectedUsers();
    }
  }
  
  function removeSelectedUser(userId) {
    selectedUsers = selectedUsers.filter(user => user._id !== userId);
    renderSelectedUsers();
  }
  
  function renderSelectedUsers() {
    if (selectedUsers.length === 0) {
      selectedUsersContainer.innerHTML = '';
      return;
    }
    
    selectedUsersContainer.innerHTML = selectedUsers.map(user => {
      const name = user.name || user.fullName || user.email;
      return `
        <div class="selected-user-chip">
          <span>${name}</span>
          <button type="button" onclick="removeSelectedUserById('${user._id}')">
            <span class="material-symbols-outlined" style="font-size: 14px;">close</span>
          </button>
        </div>
      `;
    }).join('');
  }
  
  // Make removeSelectedUser available globally for onclick handlers
  window.removeSelectedUserById = removeSelectedUser;
  
  // Add event listeners
  shareEmailInput.addEventListener('input', handleUserInput);
  shareEmailInput.addEventListener('keydown', handleKeyDown);
  shareEmailInput.addEventListener('blur', hideSuggestions);
}

function handleModalClick(e) {
  const shareModal = document.getElementById('shareModal');
  const modalContent = shareModal?.querySelector('.dark-modal-content');
  
  // If click is on the modal backdrop (not the content), close the modal
  if (e.target === shareModal && !modalContent?.contains(e.target)) {
    closeModal();
  }
}

function closeModal() {
  const shareModal = document.getElementById('shareModal');
  if (shareModal) {
    shareModal.classList.remove('show');
    document.body.style.overflow = '';
  }
  const shareEmail = document.getElementById('shareEmail');
  if (shareEmail) shareEmail.value = '';
  
  // Clear selected users
  selectedUsers = [];
  const selectedUsersContainer = document.getElementById('selectedUsersList');
  if (selectedUsersContainer) selectedUsersContainer.innerHTML = '';
  
  // Hide suggestions
  const suggestionsContainer = document.getElementById('userSuggestions');
  if (suggestionsContainer) suggestionsContainer.classList.remove('show');

  // Clear lists
  const ownerList = document.getElementById('ownerList');
  const leadList = document.getElementById('leadList');
  const sharedList = document.getElementById('sharedList');
  if (ownerList) ownerList.innerHTML = '';
  if (leadList) leadList.innerHTML = '';
  if (sharedList) sharedList.innerHTML = '';
}

async function submitShare() {
  if (!currentTableId) {
    showToast('Missing event information', 'error');
    return;
  }
  
  // Check if any users are selected
  if (selectedUsers.length === 0) {
    showToast('Please select at least one user to share with.', 'warning');
    return;
  }

  try {
    const results = [];
    
    // Share with each selected user (as regular collaborators by default)
    for (const user of selectedUsers) {
      const res = await fetch(`${API_BASE}/api/tables/${currentTableId}/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ 
          email: user.email, 
          makeOwner: false, 
          makeLead: false 
        })
      });

      const result = await res.json();
      
      if (res.ok) {
        results.push({ success: true, user: user.name || user.fullName || user.email, message: result.message });
      } else {
        results.push({ success: false, user: user.name || user.fullName || user.email, error: result.error });
      }
    }
    
    // Show summary of results
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    if (successCount > 0) {
      showToast(`Successfully shared with ${successCount} user(s). Email notifications sent.`, 'success', 5000);
    }
    
    if (failureCount > 0) {
      const failedUsers = results.filter(r => !r.success).map(r => r.user).join(', ');
      showToast(`Failed to share with: ${failedUsers}`, 'error', 5000);
    }
    
    // Refresh the modal if any were successful
    if (successCount > 0) {
      await openShareModal(currentTableId);
    } else {
      closeModal();
    }
    
  } catch (err) {
    console.error('Error sharing event:', err);
    showToast('Failed to share event. Please try again.', 'error');
    closeModal();
  }
}

async function fetchUserPhotoForSidebar() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userId = payload.id;
    
    if (!userId) return;
    
    const res = await fetch(`${API_BASE}/api/users/${userId}`, {
      headers: { Authorization: token }
    });
    
    if (res.ok) {
      const user = await res.json();
      const avatarImg = document.getElementById('sidebarAvatarImg');
      const avatarIcon = document.getElementById('sidebarAvatarIcon');
      
      if (user.photo && avatarImg) {
        avatarImg.src = user.photo;
        avatarImg.style.display = 'block';
        if (avatarIcon) avatarIcon.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Error fetching user photo:', e);
  }
}

function logout() {
  localStorage.removeItem('fullName');
  localStorage.removeItem('token');
  
  // Clear PWA page state when logging out
  if (typeof window.clearPageState === 'function') {
    window.clearPageState();
  } else {
    localStorage.removeItem('lastPageState');
  }
  
  window.location.replace('index.html');
}

window.initPage = function(id) {
  console.log('initPage called for events');
  
  // Check if dark theme is active and initialize accordingly
  if (isDarkThemeActive()) {
    initDarkTheme();
  }
  
  // Set username display
  const fullName = localStorage.getItem('fullName') || 'User';
  const usernameDisplayEl = document.getElementById('usernameDisplay');
  if (usernameDisplayEl) usernameDisplayEl.textContent = `Welcome, ${fullName}`;
  
  // Update welcome title for dark theme
  const welcomeTitle = document.getElementById('welcomeTitle');
  if (welcomeTitle) {
    welcomeTitle.textContent = `Welcome, ${fullName.split(' ')[0]}`;
  }
  
  // Update sidebar user name
  const sidebarUserName = document.getElementById('sidebarUserName');
  if (sidebarUserName) {
    sidebarUserName.textContent = fullName;
  }
  
  // Fetch and display user photo in sidebar
  fetchUserPhotoForSidebar();

  // Add Admin Console button if user is admin
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      
      // Add a utility to check admin role from console
      window.checkAdminStatus = function() {
        const token = localStorage.getItem('token');
        if (!token) return { error: 'No token found' };
        
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          return { 
            isAdmin: payload.role === 'admin',
            role: payload.role,
            fullName: payload.fullName,
            id: payload.id,
            tokenExpiry: new Date(payload.exp * 1000).toLocaleString()
          };
        } catch (err) {
          return { error: 'Invalid token', details: err.message };
        }
      };
      
      if (payload.role === 'admin') {
        // Restructure top bar into two rows
        const topBar = document.querySelector('.top-bar');
        const usernameDisplay = document.getElementById('usernameDisplay');
        const logoutBtn = document.getElementById('logoutBtn');
        
        if (topBar && usernameDisplay && logoutBtn) {
          // Check if rows already exist
          let topRow = topBar.querySelector('.top-bar-row.welcome-row');
          let adminRow = topBar.querySelector('.top-bar-row.admin-row');
          
          if (!topRow) {
            // Create top row for welcome + logout
            topRow = document.createElement('div');
            topRow.className = 'top-bar-row welcome-row';
            
            // Move username and logout to top row
            topBar.appendChild(topRow);
            topRow.appendChild(usernameDisplay);
            topRow.appendChild(logoutBtn);
          }
          
          if (!adminRow) {
            // Create admin row for all admin buttons
            adminRow = document.createElement('div');
            adminRow.className = 'top-bar-row admin-row';
            adminRow.style.justifyContent = 'center';
            topBar.appendChild(adminRow);
          }
          
          // Create admin buttons container if it doesn't exist
          let adminButtonsContainer = document.getElementById('adminButtonsContainer');
          if (!adminButtonsContainer) {
            adminButtonsContainer = document.createElement('div');
            adminButtonsContainer.id = 'adminButtonsContainer';
            adminButtonsContainer.style.display = 'flex';
            adminButtonsContainer.style.gap = '8px';
            adminButtonsContainer.style.alignItems = 'center';
            adminButtonsContainer.style.flexWrap = 'wrap';
            adminButtonsContainer.style.justifyContent = 'center';
            adminRow.appendChild(adminButtonsContainer);
        }

        // Add admin console button
        let adminBtn = document.getElementById('adminConsoleBtn');
          if (!adminBtn && adminButtonsContainer) {
          adminBtn = document.createElement('button');
          adminBtn.id = 'adminConsoleBtn';
          adminBtn.className = 'btn-admin btn-outlined';
          adminBtn.textContent = 'Admin Console';
          adminBtn.onclick = () => {
            window.location.href = '/pages/users.html';
          };
          adminButtonsContainer.appendChild(adminBtn);
        }

        // Add inventory management button
        let inventoryBtn = document.getElementById('inventoryManagementBtn');
          if (!inventoryBtn && adminButtonsContainer) {
          inventoryBtn = document.createElement('button');
          inventoryBtn.id = 'inventoryManagementBtn';
          inventoryBtn.className = 'btn-inventory btn-outlined';
          inventoryBtn.style.display = 'flex';
          inventoryBtn.style.alignItems = 'center';
          inventoryBtn.style.gap = '8px';
          inventoryBtn.innerHTML = `
            <span class="material-symbols-outlined">inventory</span>
            Inventory
          `;
          inventoryBtn.onclick = () => {
            window.location.href = '/pages/inventory-management.html';
          };
          adminButtonsContainer.appendChild(inventoryBtn);
        }

        // Add crew planner button
        let crewPlannerBtn = document.getElementById('crewPlannerBtn');
          if (!crewPlannerBtn && adminButtonsContainer) {
          crewPlannerBtn = document.createElement('button');
          crewPlannerBtn.id = 'crewPlannerBtn';
          crewPlannerBtn.className = 'btn-crew-planner btn-outlined';
          crewPlannerBtn.style.display = 'flex';
          crewPlannerBtn.style.alignItems = 'center';
          crewPlannerBtn.style.gap = '8px';
          crewPlannerBtn.innerHTML = `
            <span class="material-symbols-outlined">groups</span>
            Crew Planner
          `;
          crewPlannerBtn.onclick = () => {
            window.location.href = '/pages/crew-planner.html';
          };
          adminButtonsContainer.appendChild(crewPlannerBtn);
        }

        // Add crew calendar button
        let crewCalendarBtn = document.getElementById('crewCalendarBtn');
          if (!crewCalendarBtn && adminButtonsContainer) {
          crewCalendarBtn = document.createElement('button');
          crewCalendarBtn.id = 'crewCalendarBtn';
          crewCalendarBtn.className = 'btn-crew-calendar btn-outlined';
          crewCalendarBtn.style.display = 'flex';
          crewCalendarBtn.style.alignItems = 'center';
          crewCalendarBtn.style.gap = '8px';
          crewCalendarBtn.innerHTML = `
            <span class="material-symbols-outlined">calendar_month</span>
            Crew Calendar
          `;
          crewCalendarBtn.onclick = () => {
            window.location.href = '/pages/crew-calendar.html';
          };
          adminButtonsContainer.appendChild(crewCalendarBtn);
          }
        }
      }
    }
  } catch (e) { console.error('Error adding admin button:', e); }

  // Set up event listeners
  const sortDropdown = document.getElementById('sortDropdown');
  if (sortDropdown) sortDropdown.addEventListener('change', loadTables);

  // Set up logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;

  // Set up Create Event button
  const createBtn = document.querySelector('.btn-create');
  if (createBtn) createBtn.onclick = showCreateModal;

  // Set up Archived Events toggle button
  const toggleBtn = document.getElementById('toggleArchivedBtn');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      showArchived = !showArchived;
      toggleBtn.textContent = showArchived ? 'Show Active Events' : 'Archived Events';
      loadTables();
    };
    toggleBtn.textContent = showArchived ? 'Show Active Events' : 'Archived Events';
  }

  // Set up Calendar View button
  const calendarBtn = document.getElementById('calendarViewBtn');
  if (calendarBtn) {
    calendarBtn.onclick = () => {
      const list = document.getElementById('tableList');
      const cal = document.getElementById('calendarViewContainer');
      if (!list || !cal) return;
      if (cal.style.display === 'none' || cal.style.display === '') {
        list.style.display = 'none';
        cal.style.display = 'block';
        // Use the same filtered tables as in loadTables
        fetch(`${API_BASE}/api/tables`, { headers: { Authorization: token } })
          .then(r => r.json())
          .then(tables => {
            const showArchived = !!document.getElementById('toggleArchivedBtn')?.classList.contains('active');
            const filteredTables = tables.filter(table => !!table.userArchived === showArchived);
            renderCalendar(filteredTables);
          });
      } else {
        cal.style.display = 'none';
        list.style.display = 'flex';
      }
    };
  }

  // Attach search box event listener (SPA-safe)
  const searchInput = document.getElementById('searchEventsInput');
  if (searchInput && !searchInput._listenerAttached) {
    searchInput.addEventListener('input', e => {
      searchEventsValue = e.target.value;
      loadTables();
    });
    searchInput._listenerAttached = true;
  }

  // Load tables
  loadTables();
};

// Initialize dark theme specific features
function initDarkTheme() {
  console.log('Initializing dark theme for events page');
  
  // Setup tab filtering
  const tabs = document.querySelectorAll('.events-tab');
  tabs.forEach(tab => {
    tab.onclick = function() {
      tabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      loadTables(); // Reload with new filter
    };
  });
  
  // Setup create event button
  const createBtn = document.getElementById('createEventBtn');
  if (createBtn) {
    createBtn.onclick = showCreateModal;
  }
  
  // Use shared dashboard sidebar component for user dropdown
  if (typeof window.initDashboardSidebar === 'function') {
    window.initDashboardSidebar();
  }
  
  // Logout and dropdown close handlers are managed by sidebar-dashboard.js
  
  // Check admin access and show nav item
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const adminNavItem = document.getElementById('adminNavItem');
      
      if (adminNavItem && payload.role === 'admin') {
        adminNavItem.style.display = 'flex';
      }
    }
  } catch (e) {
    console.error('Error checking admin access:', e);
  }
  
  // Setup search input
  const searchInput = document.getElementById('searchEventsInput');
  if (searchInput && !searchInput._listenerAttached) {
    searchInput.addEventListener('input', e => {
      searchEventsValue = e.target.value;
      loadTables();
    });
    searchInput._listenerAttached = true;
  }
  
  // Setup date filter inputs
  setupDateFilters();
  
  // Setup status filter
  setupStatusFilter();
}

// Date filter dropdown functionality
let currentDatePreset = 'all';

function setupDateFilters() {
  const dateFilterBtn = document.getElementById('dateFilterBtn');
  const dateFilterDropdown = document.getElementById('dateFilterDropdown');
  const dateOptions = document.querySelectorAll('.date-option');
  const customRangeContainer = document.getElementById('customDateRange');
  
  // Open dropdown on button click
  if (dateFilterBtn && dateFilterDropdown && !dateFilterBtn._listenerAttached) {
    dateFilterBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      
      // Close other dropdowns
      document.querySelectorAll('.action-dropdown.show').forEach(d => {
        if (d !== dateFilterDropdown) d.classList.remove('show');
      });
      
      // Toggle this dropdown
      dateFilterDropdown.classList.toggle('show');
      
      // Position dropdown below button
      if (dateFilterDropdown.classList.contains('show')) {
        const rect = dateFilterBtn.getBoundingClientRect();
        dateFilterDropdown.style.position = 'fixed';
        dateFilterDropdown.style.top = (rect.bottom + 8) + 'px';
        dateFilterDropdown.style.left = rect.left + 'px';
      }
    });
    dateFilterBtn._listenerAttached = true;
  }
  
  // Date option clicks
  dateOptions.forEach(option => {
    if (!option._listenerAttached) {
      option.addEventListener('click', function(e) {
        const preset = this.dataset.preset;
        
        // If clicking custom, just toggle the inputs
        if (preset === 'custom') {
          e.stopPropagation();
          if (customRangeContainer) {
            const isVisible = customRangeContainer.style.display === 'block';
            customRangeContainer.style.display = isVisible ? 'none' : 'block';
          }
          return;
        }
        
        // Update active state
        dateOptions.forEach(o => o.classList.remove('active'));
        this.classList.add('active');
        currentDatePreset = preset;
        
        // Hide custom range if not custom
        if (customRangeContainer) {
          customRangeContainer.style.display = 'none';
        }
        
        // Apply the filter immediately
        applyDateFilter();
        
        // Close dropdown
        if (dateFilterDropdown) {
          dateFilterDropdown.classList.remove('show');
        }
      });
      option._listenerAttached = true;
    }
  });
}

function hideDateFilterDropdown() {
  const dropdown = document.getElementById('dateFilterDropdown');
  if (dropdown) {
    dropdown.classList.remove('show');
  }
}

function applyDateFilter() {
  const startInput = document.getElementById('dateFilterStart');
  const endInput = document.getElementById('dateFilterEnd');
  const filterBtn = document.getElementById('dateFilterBtn');
  const filterLabel = document.getElementById('dateFilterLabel');
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  switch (currentDatePreset) {
    case 'all':
      dateFilterStart = null;
      dateFilterEnd = null;
      if (filterLabel) filterLabel.textContent = 'All Dates';
      if (filterBtn) filterBtn.classList.remove('active');
      break;
      
    case 'today':
      dateFilterStart = today.toISOString().split('T')[0];
      dateFilterEnd = today.toISOString().split('T')[0];
      if (filterLabel) filterLabel.textContent = 'Today';
      if (filterBtn) filterBtn.classList.add('active');
      break;
      
    case 'week':
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      dateFilterStart = weekStart.toISOString().split('T')[0];
      dateFilterEnd = weekEnd.toISOString().split('T')[0];
      if (filterLabel) filterLabel.textContent = 'This Week';
      if (filterBtn) filterBtn.classList.add('active');
      break;
      
    case 'month':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      dateFilterStart = monthStart.toISOString().split('T')[0];
      dateFilterEnd = monthEnd.toISOString().split('T')[0];
      if (filterLabel) filterLabel.textContent = 'This Month';
      if (filterBtn) filterBtn.classList.add('active');
      break;
      
    case 'custom':
      dateFilterStart = startInput?.value || null;
      dateFilterEnd = endInput?.value || null;
      if (dateFilterStart && dateFilterEnd) {
        const start = new Date(dateFilterStart);
        const end = new Date(dateFilterEnd);
        const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (filterLabel) filterLabel.textContent = `${formatDate(start)} - ${formatDate(end)}`;
        if (filterBtn) filterBtn.classList.add('active');
      } else if (dateFilterStart) {
        const start = new Date(dateFilterStart);
        if (filterLabel) filterLabel.textContent = `From ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        if (filterBtn) filterBtn.classList.add('active');
      } else if (dateFilterEnd) {
        const end = new Date(dateFilterEnd);
        if (filterLabel) filterLabel.textContent = `Until ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        if (filterBtn) filterBtn.classList.add('active');
      } else {
        if (filterLabel) filterLabel.textContent = 'All Dates';
        if (filterBtn) filterBtn.classList.remove('active');
      }
      break;
  }
  
  loadTables();
}

// Apply custom date range
function applyCustomDateFilter() {
  const startInput = document.getElementById('dateFilterStart');
  const endInput = document.getElementById('dateFilterEnd');
  const filterBtn = document.getElementById('dateFilterBtn');
  const filterLabel = document.getElementById('dateFilterLabel');
  const dateOptions = document.querySelectorAll('.date-option');
  
  dateFilterStart = startInput?.value || null;
  dateFilterEnd = endInput?.value || null;
  currentDatePreset = 'custom';
  
  // Update active state
  dateOptions.forEach(o => o.classList.remove('active'));
  const customOption = document.getElementById('customDateToggle');
  if (customOption) customOption.classList.add('active');
  
  if (dateFilterStart && dateFilterEnd) {
    const start = new Date(dateFilterStart);
    const end = new Date(dateFilterEnd);
    const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (filterLabel) filterLabel.textContent = `${formatDate(start)} - ${formatDate(end)}`;
    if (filterBtn) filterBtn.classList.add('active');
  } else if (dateFilterStart) {
    const start = new Date(dateFilterStart);
    if (filterLabel) filterLabel.textContent = `From ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    if (filterBtn) filterBtn.classList.add('active');
  } else if (dateFilterEnd) {
    const end = new Date(dateFilterEnd);
    if (filterLabel) filterLabel.textContent = `Until ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    if (filterBtn) filterBtn.classList.add('active');
  } else {
    if (filterLabel) filterLabel.textContent = 'All Dates';
    if (filterBtn) filterBtn.classList.remove('active');
  }
  
  // Close dropdown
  hideDateFilterDropdown();
  loadTables();
}

window.applyCustomDateFilter = applyCustomDateFilter;

function clearDateFilter() {
  dateFilterStart = null;
  dateFilterEnd = null;
  currentDatePreset = 'all';
  
  const startInput = document.getElementById('dateFilterStart');
  const endInput = document.getElementById('dateFilterEnd');
  const filterBtn = document.getElementById('dateFilterBtn');
  const filterLabel = document.getElementById('dateFilterLabel');
  
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  if (filterLabel) filterLabel.textContent = 'All Dates';
  if (filterBtn) filterBtn.classList.remove('active');
  
  // Reset date options
  const dateOptions = document.querySelectorAll('.date-option');
  dateOptions.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === 'all');
  });
  
  const customRangeContainer = document.getElementById('customDateRange');
  if (customRangeContainer) customRangeContainer.style.display = 'none';
  
  hideDateFilterDropdown();
  loadTables();
}

// Status filter functionality
function setupStatusFilter() {
  const statusFilterBtn = document.getElementById('statusFilterBtn');
  const statusFilterDropdown = document.getElementById('statusFilterDropdown');
  const statusOptions = document.querySelectorAll('.status-option');
  
  if (statusFilterBtn && statusFilterDropdown && !statusFilterBtn._listenerAttached) {
    statusFilterBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      
      // Close other dropdowns
      document.querySelectorAll('.action-dropdown.show').forEach(d => {
        if (d !== statusFilterDropdown) d.classList.remove('show');
      });
      
      // Toggle this dropdown
      statusFilterDropdown.classList.toggle('show');
      
      // Position dropdown below button
      if (statusFilterDropdown.classList.contains('show')) {
        const rect = statusFilterBtn.getBoundingClientRect();
        statusFilterDropdown.style.position = 'fixed';
        statusFilterDropdown.style.top = (rect.bottom + 8) + 'px';
        statusFilterDropdown.style.left = rect.left + 'px';
      }
    });
    statusFilterBtn._listenerAttached = true;
  }
  
  statusOptions.forEach(option => {
    if (!option._listenerAttached) {
      option.addEventListener('click', function() {
        const newStatus = this.dataset.status;
        statusFilter = newStatus;
        
        // Update active state
        statusOptions.forEach(o => o.classList.remove('active'));
        this.classList.add('active');
        
        // Update button label
        const label = document.getElementById('statusFilterLabel');
        const btn = document.getElementById('statusFilterBtn');
        if (label) {
          if (newStatus === 'active') label.textContent = 'Active';
          else if (newStatus === 'archived') label.textContent = 'Archived';
          else label.textContent = 'All';
        }
        
        // Highlight button if not default
        if (btn) {
          btn.classList.toggle('active', newStatus !== 'active');
        }
        
        // Close dropdown
        statusFilterDropdown.classList.remove('show');
        
        // Reload tables
        loadTables(true);
      });
      option._listenerAttached = true;
    }
  });
}

window.setupStatusFilter = setupStatusFilter;
window.setupDateFilters = setupDateFilters;
window.hideDateFilterDropdown = hideDateFilterDropdown;
window.applyDateFilter = applyDateFilter;
window.clearDateFilter = clearDateFilter;
window.submitShare = submitShare;
window.closeModal = closeModal;
window.submitCreate = submitCreate;
window.hideCreateModal = hideCreateModal;

// Exposing the loadTables function to the global scope for Socket.IO updates
window.loadTables = loadTables;

// Setup Socket.IO event listeners for real-time updates
function setupSocketListeners() {
  if (!window.socket) {
    console.warn('Socket.IO not available, real-time updates disabled');
    return;
  }
  
  console.log('Setting up Socket.IO listeners for events page');
  
  // Define the events that should trigger a table reload
  const eventsToMonitor = [
    'tableCreated',
    'tableUpdated',
    'tableDeleted',
    'tableArchived',
    'userEventArchived', // When user archives/unarchives an event
    'generalChanged' // When event details are updated
  ];
  
  // Setup listeners for each event
  eventsToMonitor.forEach(eventName => {
    window.socket.on(eventName, (data) => {
      console.log(`${eventName} event received, invalidating cache and reloading tables`);
      invalidateEventsCache();
      loadTables(true);
    });
  });
}

// Run the setup when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupSocketListeners);
} else {
  // Small delay to ensure Socket.IO is loaded
  setTimeout(setupSocketListeners, 100);
}

// ========= ADD TO CALENDAR FUNCTIONALITY =========

// Get user's full name from token
function getUserNameFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.fullName || payload.name || null;
  } catch (e) {
    console.error('Error parsing token:', e);
    return null;
  }
}

// Group consecutive dates
function groupConsecutiveDates(dates) {
  if (!dates || dates.length === 0) return [];
  
  // Sort dates
  const sortedDates = dates.map(d => new Date(d)).sort((a, b) => a - b);
  const groups = [];
  let currentGroup = [sortedDates[0]];
  
  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = sortedDates[i - 1];
    const currDate = sortedDates[i];
    const diffDays = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      // Consecutive day
      currentGroup.push(currDate);
    } else {
      // Gap found, start new group
      groups.push(currentGroup);
      currentGroup = [currDate];
    }
  }
  
  // Add the last group
  groups.push(currentGroup);
  
  return groups;
}

// Format date for iCalendar (YYYYMMDD format)
function formatICalDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Format date for Google Calendar URL (YYYYMMDD format for all-day events)
function formatGoogleCalendarDate(date) {
  return formatICalDate(date);
}

// Generate Google Calendar URL
function generateGoogleCalendarUrl(event) {
  const baseUrl = 'https://calendar.google.com/calendar/render';
  
  // For all-day events, use YYYYMMDD format (no time)
  const startDate = formatGoogleCalendarDate(event.startDate);
  
  // For Google Calendar, end date for all-day events should be the day AFTER
  const endDateObj = new Date(event.endDate);
  endDateObj.setDate(endDateObj.getDate() + 1);
  const endDate = formatGoogleCalendarDate(endDateObj);
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${startDate}/${endDate}`,
    details: event.description || '',
    location: event.location || '',
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  });
  
  return `${baseUrl}?${params.toString()}`;
}

// Open Google Calendar (single event only - Google Calendar doesn't support multiple events in one URL)
function openGoogleCalendar(events) {
  if (events.length === 0) return;
  
  if (events.length === 1) {
    // Single event - open directly
    window.open(generateGoogleCalendarUrl(events[0]), '_blank');
  } else {
    // Multiple events - open them in sequence
    events.forEach((event, index) => {
      setTimeout(() => {
        window.open(generateGoogleCalendarUrl(event), '_blank');
      }, index * 300); // Stagger by 300ms to avoid popup blocker
    });
    
    showMessage(`Opening ${events.length} events in Google Calendar...`, 'info');
  }
}

// Generate iCalendar (.ics) content
function generateICalendar(events) {
  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LumDash//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  
  events.forEach((event, index) => {
    const uid = `${Date.now()}-${index}@lumdash.com`;
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    icsContent.push('BEGIN:VEVENT');
    icsContent.push(`UID:${uid}`);
    icsContent.push(`DTSTAMP:${timestamp}`);
    icsContent.push(`DTSTART;VALUE=DATE:${formatICalDate(event.startDate)}`);
    
    // For multi-day events, DTEND should be the day AFTER the last day (iCalendar spec)
    const endDate = new Date(event.endDate);
    endDate.setDate(endDate.getDate() + 1);
    icsContent.push(`DTEND;VALUE=DATE:${formatICalDate(endDate)}`);
    
    icsContent.push(`SUMMARY:${event.title}`);
    
    if (event.location) {
      icsContent.push(`LOCATION:${event.location}`);
    }
    
    if (event.description) {
      // Escape special characters and wrap long lines
      const desc = event.description.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
      icsContent.push(`DESCRIPTION:${desc}`);
    }
    
    icsContent.push('STATUS:CONFIRMED');
    icsContent.push('TRANSP:OPAQUE');
    icsContent.push('END:VEVENT');
  });
  
  icsContent.push('END:VCALENDAR');
  
  return icsContent.join('\r\n');
}

// Fetch crew data for an event
async function fetchCrewData(tableId) {
  try {
    const response = await fetch(`${API_BASE}/api/tables/${tableId}`, {
      headers: { Authorization: token }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch crew data');
    }
    
    const data = await response.json();
    return data.rows || [];
  } catch (error) {
    console.error('Error fetching crew data:', error);
    return [];
  }
}

// Detect mobile device
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Detect iOS specifically
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Download .ics file (desktop) or auto-open (mobile)
function downloadICS(content, filename) {
  // For mobile, we need special handling
  if (isMobileDevice()) {
    // Create blob with proper MIME type for calendar
    const blob = new Blob([content], { type: 'text/calendar' });
    
    // Try using navigator.share API if available (best for mobile)
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'text/calendar' })] })) {
      const file = new File([blob], filename, { type: 'text/calendar' });
      navigator.share({
        files: [file],
        title: 'Add to Calendar',
        text: 'Add this event to your calendar'
      }).catch(err => {
        console.log('Share failed, falling back to download:', err);
        // Fallback to download
        downloadICSFallback(blob, filename);
      });
    } else {
      // Fallback: download the file
      downloadICSFallback(blob, filename);
    }
  } else {
    // Desktop: Standard download
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
}

// Fallback download method for mobile
function downloadICSFallback(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  
  // Try to trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Show instructions after download
  setTimeout(() => {
    showMobileInstructions();
  }, 500);
  
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Show instructions for mobile users
function showMobileInstructions() {
  const instructionModal = document.createElement('div');
  instructionModal.className = 'calendar-modal';
  instructionModal.innerHTML = `
    <div class="calendar-modal-content">
      <div class="calendar-modal-header">
        <h3>
          <span class="material-symbols-outlined">info</span>
          Next Steps
        </h3>
        <button class="close-btn" onclick="this.closest('.calendar-modal').remove()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="calendar-modal-body">
        <p style="margin-bottom: 16px;">The calendar file has been downloaded.</p>
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; border-left: 4px solid #CC0007;">
          <p style="margin: 0 0 12px 0; font-weight: 600;">To add to your calendar:</p>
          <ol style="margin: 0; padding-left: 20px; line-height: 1.6;">
            <li>Open your <strong>Downloads</strong> or <strong>Files</strong> app</li>
            <li>Tap on the <strong>.ics file</strong> you just downloaded</li>
            <li>Your calendar app will open</li>
            <li>Tap <strong>"Add"</strong> to save the event</li>
          </ol>
        </div>
        <button onclick="this.closest('.calendar-modal').remove()" style="
          width: 100%;
          padding: 12px;
          margin-top: 16px;
          background: #CC0007;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
        ">Got it!</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(instructionModal);
  
  instructionModal.addEventListener('click', (e) => {
    if (e.target === instructionModal) {
      instructionModal.remove();
    }
  });
}

// Show Add to Calendar modal
async function showAddToCalendarModal(table) {
  // Fetch crew data
  const crewRows = await fetchCrewData(table._id);
  const userName = getUserNameFromToken();
  
  // Find user's call days
  const userRows = crewRows.filter(row => 
    row.name === userName && row.role !== '__placeholder__' && row.date
  );
  
  // Get unique dates for user
  const userDates = [...new Set(userRows.map(row => row.date))];
  const hasCallDays = userDates.length > 0;
  
  // Get user's role (first non-placeholder role found)
  const userRole = userRows.find(row => row.role && row.role !== '__placeholder__')?.role || '';
  
  // Prepare event data for full event
  const fullEventData = [{
    title: table.title || 'Event',
    startDate: table.general?.start || new Date(),
    endDate: table.general?.end || new Date(),
    location: table.general?.location || '',
    description: `Client: ${table.client || ''}`
  }];
  
  // Prepare event data for user's call days
  const dateGroups = hasCallDays ? groupConsecutiveDates(userDates) : [];
  const userEventData = dateGroups.map((group, index) => {
    const startDate = group[0];
    const endDate = group[group.length - 1];
    
    return {
      title: `${table.title || 'Event'}${userRole ? ` - ${userRole}` : ''}`,
      startDate: startDate,
      endDate: endDate,
      location: table.general?.location || '',
      description: `Role: ${userRole}\nClient: ${table.client || ''}`
    };
  });
  
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'calendar-modal';
  modal.innerHTML = `
    <div class="calendar-modal-content">
      <div class="calendar-modal-header">
        <h3>
          <span class="material-symbols-outlined">event</span>
          Add to Calendar
        </h3>
        <button class="close-btn" onclick="this.closest('.calendar-modal').remove()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="calendar-modal-body">
        <p>Choose what to add to your calendar:</p>
        <div class="calendar-options">
          <button class="calendar-option-btn" id="addFullEventBtn">
            <span class="material-symbols-outlined">event_available</span>
            <div>
              <strong>Add Event Dates</strong>
              <small>Add the entire event (${table.general?.start ? new Date(table.general.start).toLocaleDateString() : ''} - ${table.general?.end ? new Date(table.general.end).toLocaleDateString() : ''})</small>
            </div>
          </button>
          ${hasCallDays ? `
          <button class="calendar-option-btn" id="addMyCallDaysBtn">
            <span class="material-symbols-outlined">person_pin_circle</span>
            <div>
              <strong>Add My Call Days</strong>
              <small>Add only the days you're assigned (${userDates.length} day${userDates.length !== 1 ? 's' : ''})</small>
            </div>
          </button>
          ` : `
          <div class="calendar-option-disabled">
            <span class="material-symbols-outlined">info</span>
            <div>
              <strong>My Call Days</strong>
              <small>You are not assigned to any days on this event</small>
            </div>
          </div>
          `}
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Add full event button handler (Google Calendar)
  const addFullEventBtn = modal.querySelector('#addFullEventBtn');
  if (addFullEventBtn) {
    addFullEventBtn.onclick = () => {
      openGoogleCalendar(fullEventData);
      modal.remove();
      showMessage('Opening Google Calendar...', 'success');
    };
  }
  
  // Add my call days button handler (Google Calendar)
  const addMyCallDaysBtn = modal.querySelector('#addMyCallDaysBtn');
  if (addMyCallDaysBtn && hasCallDays) {
    addMyCallDaysBtn.onclick = () => {
      openGoogleCalendar(userEventData);
      modal.remove();
      if (userEventData.length > 1) {
        showMessage(`Opening ${userEventData.length} events in Google Calendar...`, 'info');
      } else {
        showMessage('Opening Google Calendar...', 'success');
      }
    };
  }
}

function showMessage(message, type = 'info') {
  const messageEl = document.createElement('div');
  messageEl.className = `toast-message toast-${type}`;
  messageEl.textContent = message;
  messageEl.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    z-index: 10001;
    opacity: 0;
    transition: opacity 0.3s;
    ${type === 'success' ? 'background: #28a745;' : 
      type === 'error' ? 'background: #dc3545;' : 
      'background: #17a2b8;'}
  `;
  
  document.body.appendChild(messageEl);
  
  setTimeout(() => messageEl.style.opacity = '1', 10);
  
  setTimeout(() => {
    messageEl.style.opacity = '0';
    setTimeout(() => messageEl.remove(), 300);
  }, 3000);
}

// ========= END ADD TO CALENDAR FUNCTIONALITY =========

})();

