(function() {
const token = localStorage.getItem('token');
if (!token && !window.location.pathname.endsWith('index.html')) {
  // Redirect without alert - toast not available yet
  window.location.href = 'index.html';
}

let currentTableId = null;
let showArchived = false;
let statusFilter = localStorage.getItem('eventsStatusFilter') || 'active'; // 'active', 'archived', or 'all'
let ownerFilter = localStorage.getItem('eventsOwnerFilter') || 'all'; // 'all', 'mine', or a specific owner ID
let clientFilter = null; // null means no filter, otherwise it's the client name
let searchEventsValue = '';
let dateFilterStart = null;
let dateFilterEnd = null;
let sortField = localStorage.getItem('eventsSortField') || 'date'; // 'name' or 'date'
let sortOrder = localStorage.getItem('eventsSortOrder') || 'asc'; // 'asc' or 'desc'
let allOwners = []; // Store unique owners for the dropdown
let allClients = []; // Store unique client names for the dropdown
let allCompanies = []; // Store unique company names for the dropdown
let allUsers = [];
let selectedUsers = [];
let userPhotoMap = {}; // Maps lowercase user name → profilePhoto URL
let isInitialLoad = true; // Track if this is the first load

// Pagination state
let currentPage = 1;
const EVENTS_PER_PAGE = 50;
let totalFilteredEvents = 0;

function getUserIdFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.id;
}

// ========================================
// BADGE NOT-REQUIRED HELPERS
// ========================================

// Determine badge CSS class based on condition met and not-required status
function getBadgeClass(badgeType, conditionMet, badgesNotRequired) {
  const notRequired = badgesNotRequired && badgesNotRequired[badgeType];
  if (notRequired) return 'badge-not-required';
  if (!conditionMet) return 'badge-inactive';
  return '';
}

// Build title/tooltip for badges
function getBadgeTitle(badgeType, conditionMet, badgesNotRequired, count, pendingCount = 0, badgesRequested = null) {
  const notRequired = badgesNotRequired && badgesNotRequired[badgeType];
  const labels = {
    flight: { active: `${count || 0} passenger${count !== 1 ? 's' : ''} with flights`, inactive: 'No flights', notRequired: 'Flights — Not required' },
    hotel: { active: `${count || 0} hotel booking${count !== 1 ? 's' : ''}`, inactive: 'No accommodations', notRequired: 'Hotels — Not required' },
    share: { active: `Shared with ${count || 0} ${count === 1 ? 'person' : 'people'}`, inactive: 'Not shared', notRequired: 'Sharing — Not required' },
    schedule: { active: 'Has program schedule', inactive: 'No schedule', notRequired: 'Schedule — Not required' },
    gear: { active: 'Has gear reserved', inactive: 'No gear reserved', notRequired: 'Gear — Not required' }
  };
  const l = labels[badgeType] || {};
  if (notRequired) return l.notRequired || 'Not required';
  let title = conditionMet ? (l.active || '') : (l.inactive || '');
  if (badgeType === 'flight' && pendingCount > 0) {
    const pendingLabel = `${pendingCount} pending request${pendingCount !== 1 ? 's' : ''}`;
    title = title ? `${title} · ${pendingLabel}` : pendingLabel;
  }
  if (badgeType === 'hotel' && !conditionMet && badgesRequested?.hotel) {
    title = 'Hotels requested';
  }
  return title;
}

function flightPendingDotHtml(pendingCount, badgesNotRequired) {
  // Visual is handled by .has-pending (yellow icon) — no corner dot
  return '';
}

function hotelRequestedDotHtml(table) {
  // Visual is handled by .has-requested (yellow icon) — no corner dot
  return '';
}

// Show right-click context menu on a badge
function showBadgeContextMenu(e, eventId, badgeType, isCurrentlyNotRequired, isCurrentlyRequested = false) {
  // Remove any existing context menu
  const existing = document.querySelector('.badge-context-menu');
  if (existing) existing.remove();

  const badgeLabels = {
    flight: 'Flights',
    hotel: 'Hotels',
    share: 'Sharing',
    schedule: 'Schedule',
    gear: 'Gear'
  };
  const label = badgeLabels[badgeType] || badgeType;

  const menu = document.createElement('div');
  menu.className = 'badge-context-menu';

  const items = [];
  if (isCurrentlyNotRequired) {
    items.push(`
      <div class="menu-item mark-required" onclick="toggleBadgeRequired('${eventId}', '${badgeType}'); this.closest('.badge-context-menu').remove();">
        <span class="material-symbols-outlined">check_circle</span>
        Mark ${label} as required
      </div>
    `);
  } else {
    items.push(`
      <div class="menu-item" onclick="toggleBadgeRequired('${eventId}', '${badgeType}'); this.closest('.badge-context-menu').remove();">
        <span class="material-symbols-outlined">block</span>
        Mark ${label} as not required
      </div>
    `);
    if (badgeType === 'hotel') {
      if (isCurrentlyRequested) {
        items.push(`
          <div class="menu-item" onclick="toggleBadgeRequested('${eventId}', 'hotel', false); this.closest('.badge-context-menu').remove();">
            <span class="material-symbols-outlined">close</span>
            Clear hotels requested
          </div>
        `);
      } else {
        items.push(`
          <div class="menu-item mark-requested" onclick="toggleBadgeRequested('${eventId}', 'hotel', true); this.closest('.badge-context-menu').remove();">
            <span class="material-symbols-outlined">mark_email_unread</span>
            Mark hotels as requested
          </div>
        `);
      }
    }
  }
  menu.innerHTML = items.join('');

  document.body.appendChild(menu);

  // Position the menu at cursor, keep within viewport
  const menuRect = menu.getBoundingClientRect();
  let left = e.clientX;
  let top = e.clientY;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight - 8) top = window.innerHeight - menuRect.height - 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  // Close on click outside
  setTimeout(() => {
    const closeHandler = (evt) => {
      if (!menu.contains(evt.target)) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
        document.removeEventListener('contextmenu', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
  }, 10);
}

// Toggle badge not-required status via API
async function toggleBadgeRequired(eventId, badgeType) {
  try {
    const res = await fetch(`${API_BASE}/api/tables/${eventId}/badge-required`, {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ badge: badgeType })
    });
    
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Failed to update badge', 'error');
      return;
    }
    
    const data = await res.json();
    const statusLabel = data.notRequired ? 'not required' : 'required';
    const badgeLabels = { flight: 'Flights', hotel: 'Hotels', share: 'Sharing', schedule: 'Schedule', gear: 'Gear' };
    showToast(`${badgeLabels[badgeType] || badgeType} marked as ${statusLabel}`, 'success');
    
    // Update the cached data and re-render
    if (cachedTables) {
      const tableIdx = cachedTables.findIndex(t => t._id === eventId);
      if (tableIdx !== -1) {
        if (!cachedTables[tableIdx].badgesNotRequired) {
          cachedTables[tableIdx].badgesNotRequired = {};
        }
        cachedTables[tableIdx].badgesNotRequired[badgeType] = data.notRequired;
        if (data.badgesRequested) {
          cachedTables[tableIdx].badgesRequested = data.badgesRequested;
        } else if (data.notRequired && cachedTables[tableIdx].badgesRequested) {
          cachedTables[tableIdx].badgesRequested[badgeType] = false;
        }
      }
    }
    
    // Re-render
    loadTables(false);
  } catch (error) {
    console.error('Error toggling badge requirement:', error);
    showToast('Failed to update badge requirement', 'error');
  }
}

async function toggleBadgeRequested(eventId, badgeType, requested) {
  try {
    const res = await fetch(`${API_BASE}/api/tables/${eventId}/badge-requested`, {
      method: 'PATCH',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ badge: badgeType, requested })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to update badge', 'error');
      return;
    }

    const data = await res.json();
    showToast(
      data.requested ? 'Hotels marked as requested' : 'Hotels requested mark cleared',
      'success'
    );

    if (cachedTables) {
      const tableIdx = cachedTables.findIndex(t => t._id === eventId);
      if (tableIdx !== -1) {
        if (!cachedTables[tableIdx].badgesRequested) cachedTables[tableIdx].badgesRequested = {};
        cachedTables[tableIdx].badgesRequested[badgeType] = data.requested;
        if (data.badgesNotRequired) {
          cachedTables[tableIdx].badgesNotRequired = data.badgesNotRequired;
        }
      }
    }

    loadTables(false);
  } catch (error) {
    console.error('Error toggling badge requested:', error);
    showToast('Failed to update hotels requested mark', 'error');
  }
}
window.toggleBadgeRequested = toggleBadgeRequested;

// Long-press handler for badge context menu on touch devices
(function setupBadgeLongPress() {
  let longPressTimer = null;
  let longPressFired = false;

  document.addEventListener('touchstart', function(e) {
    const badge = e.target.closest('.badge-longpress');
    if (!badge) return;

    longPressFired = false;
    const touch = e.touches[0];

    longPressTimer = setTimeout(function() {
      longPressFired = true;
      e.preventDefault();
      const eventId = badge.dataset.eventId;
      const badgeType = badge.dataset.badgeType;
      const isNotRequired = badge.dataset.notRequired === 'true';
      const isRequested = badge.dataset.requested === 'true';
      const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, preventDefault: function(){}, stopPropagation: function(){} };
      showBadgeContextMenu(fakeEvent, eventId, badgeType, isNotRequired, isRequested);
    }, 500);
  }, { passive: false });

  document.addEventListener('touchmove', function() {
    clearTimeout(longPressTimer);
  });

  document.addEventListener('touchend', function(e) {
    clearTimeout(longPressTimer);
    if (longPressFired) {
      e.preventDefault();
    }
  });
})();

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
    // Populate company/client datalists with existing values
    populateCompanyDatalist();
    populateClientDatalist();
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function populateCompanyDatalist() {
  const datalist = document.getElementById('companyDatalist');
  if (!datalist) return;
  
  datalist.innerHTML = '';
  
  allCompanies.forEach(company => {
    if (company && company.trim()) {
      const option = document.createElement('option');
      option.value = company;
      datalist.appendChild(option);
    }
  });
}

function populateClientDatalist() {
  const datalist = document.getElementById('clientDatalist');
  if (!datalist) return;
  
  // Clear existing options
  datalist.innerHTML = '';
  
  // Add each unique client
  allClients.forEach(client => {
    if (client && client.trim()) {
      const option = document.createElement('option');
      option.value = client;
      datalist.appendChild(option);
    }
  });
}

function hideCreateModal() {
  const modal = document.getElementById('createModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
    
    // Reset form fields
    const editEventId = document.getElementById('editEventId');
    const newTitle = document.getElementById('newTitle');
    const newCompany = document.getElementById('newCompany');
    const newClient = document.getElementById('newClient');
    const newCity = document.getElementById('newCity');
    const newState = document.getElementById('newState');
    const newStart = document.getElementById('newStart');
    const newEnd = document.getElementById('newEnd');
    
    if (editEventId) editEventId.value = '';
    if (newTitle) newTitle.value = '';
    if (newCompany) newCompany.value = '';
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
  const company = document.getElementById('newCompany')?.value;
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
        general: { company, client, city, state, start, end }
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
        general: { company, client, city, state, start, end }
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
    document.getElementById('newCompany').value = '';
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
    document.getElementById('newCompany').value = event.general?.company || '';
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
window.openShareModal = openShareModal;
window.showBadgeContextMenu = showBadgeContextMenu;
window.toggleBadgeRequired = toggleBadgeRequired;

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

// Parse date string as local date (ignoring timezone)
function parseLocalDate(dateStr) {
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

// Get event status using device's local time
function getEventStatus(table) {
  const now = new Date();
  const general = table.general || {};
  
  // Parse dates as local dates for accurate comparison
  const start = general.start ? parseLocalDate(general.start) : null;
  const end = general.end ? parseLocalDate(general.end) : null;
  
  // Get today's date at midnight (local time) for comparison
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  
  // Check if event is live (start date <= today <= end date)
  const isCurrentlyLive = table.isLive || (start && end && start <= todayEnd && end >= todayStart);
  
  if (isCurrentlyLive) {
    return { label: 'LIVE', class: 'live' };
  } else if (start && start > todayEnd) {
    return { label: 'Upcoming', class: 'upcoming' };
  } else {
    return { label: 'Past', class: 'past' };
  }
}

// Format date range for dark theme table (using local time)
function formatDateRangeDark(start, end) {
  if (!start) return '—';
  
  const startDate = parseLocalDate(start);
  const options = { weekday: 'short', month: 'short', day: 'numeric' };
  const startStr = startDate.toLocaleDateString('en-US', options);
  
  if (!end || start === end) {
    return `<span class="date-line">${startStr}</span>`;
  }
  
  const endDate = parseLocalDate(end);
  const endStr = endDate.toLocaleDateString('en-US', options);
  
  return `<span class="date-line">${startStr}</span><span class="date-separator"> – </span><span class="date-line">${endStr}</span>`;
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

function renderCrewAvatarsDark(crewMembers, totalCount, eventId = null, unassignedCount = 0) {
  const maxVisible = 4;
  const crewArray = Array.isArray(crewMembers) ? crewMembers : [];
  
  // Calculate total items to show (assigned crew + unassigned positions)
  const totalItems = crewArray.length + unassignedCount;
  const hasOverflow = totalItems > maxVisible;
  
  // Determine how many slots we have for avatars (leave room for +N if overflow)
  const maxAvatarSlots = hasOverflow ? maxVisible - 1 : maxVisible;
  
  // Show assigned crew first, then fill remaining slots with unassigned
  const assignedToShow = Math.min(crewArray.length, maxAvatarSlots);
  const remainingSlots = maxAvatarSlots - assignedToShow;
  const unassignedToShow = Math.min(unassignedCount, remainingSlots);
  
  const overflow = totalItems - assignedToShow - unassignedToShow;
  
  let html = '<div class="avatar-stack">';
  
  // Show assigned crew members first
  for (let i = 0; i < assignedToShow; i++) {
    const member = crewArray[i];
    const name = member?.name || member?.fullName || member?.email || 'Crew';
    const photo = member?.photo || member?.avatar || member?.profileImage;
    const initials = getInitials(name);
    
    if (photo) {
      html += `
        <div class="crew-avatar" title="${name}" onclick="event.stopPropagation(); navigateToCrew('${eventId}')" style="cursor: pointer;">
          <img src="${photo}" alt="${name}" onerror="this.parentElement.innerHTML='<span class=\\'initials\\'>${initials}</span>'">
        </div>
      `;
    } else {
      html += `
        <div class="crew-avatar initials-avatar" title="${name}" onclick="event.stopPropagation(); navigateToCrew('${eventId}')" style="cursor: pointer;">
          <span class="initials">${initials}</span>
        </div>
      `;
    }
  }
  
  // Show unassigned position placeholders (red avatars)
  for (let i = 0; i < unassignedToShow; i++) {
    html += `
      <div class="crew-avatar unassigned-avatar" title="Unassigned position" onclick="event.stopPropagation(); navigateToCrew('${eventId}')" style="cursor: pointer;">
        <span class="material-symbols-outlined avatar-icon">person</span>
      </div>
    `;
  }
  
  // Show +N overflow indicator as part of the avatar stack
  if (hasOverflow && overflow > 0) {
    // Build crew list for the expanded view (including unassigned)
    const crewListItems = crewArray.map(member => {
      const name = member?.name || member?.fullName || member?.email || 'Crew';
      const initials = getInitials(name);
      const photo = member?.photo || member?.avatar || member?.profileImage;
      const avatarHtml = photo 
        ? `<img src="${photo}" alt="${name}" class="crew-list-avatar-img">`
        : `<span class="crew-list-initials">${initials}</span>`;
      return `<div class="crew-list-item"><div class="crew-list-avatar">${avatarHtml}</div><span class="crew-list-name">${name}</span></div>`;
    }).join('');
    
    // Add unassigned to the list
    let unassignedListItems = '';
    for (let i = 0; i < unassignedCount; i++) {
      unassignedListItems += `<div class="crew-list-item unassigned-list-item"><div class="crew-list-avatar unassigned"><span class="material-symbols-outlined">person</span></div><span class="crew-list-name">Unassigned</span></div>`;
    }
    
    // Check if any hidden items in overflow are unassigned
    const hiddenUnassigned = unassignedCount - unassignedToShow;
    const overflowHasUnassigned = hiddenUnassigned > 0;
    
    html += `
      <div class="crew-avatar overflow-count crew-expand-trigger${overflowHasUnassigned ? ' overflow-unassigned' : ''}" data-crew-count="${totalItems}">
        +${overflow}
        <div class="crew-expanded-view">
          <div class="crew-expanded-header">Crew Members (${totalCount})${unassignedCount > 0 ? ` <span class="unassigned-header-count">+ ${unassignedCount} unassigned</span>` : ''}</div>
          <div class="crew-expanded-list-wrapper ${totalItems > 5 ? 'has-scroll' : ''}">
            <div class="crew-expanded-list">${crewListItems}${unassignedListItems}</div>
          </div>
          <button class="crew-view-all-btn" onclick="event.stopPropagation(); ${eventId ? `window.navigate && window.navigate('crew', '${eventId}');` : `window.location.href = '/pages/crew-planner.html';`}">
            <span class="material-symbols-outlined">group</span>
            View Crew Page
          </button>
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  
  // Always show total crew count (assigned + unassigned)
  const displayCount = totalCount + unassignedCount;
  if (displayCount > 0) {
    html += `
      <span class="crew-total-count">${displayCount}</span>
    `;
  }
  
  return html;
}

// Render event row for dark theme table
// Calculate task status for an event
function getTaskStatus(todos) {
  if (!todos || todos.length === 0) {
    return { label: 'No Tasks', class: 'no-tasks', icon: 'check_box_outline_blank' };
  }
  
  // Get today's date in user's local timezone (midnight)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Helper to parse due date in timezone-agnostic way
  function parseDueDate(dueDate) {
    if (!dueDate) return null;
    let dateStr = dueDate;
    if (typeof dueDate === 'string' && dueDate.includes('T')) {
      dateStr = dueDate.split('T')[0]; // Get just YYYY-MM-DD
    }
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day); // Local date
  }
  
  const completed = todos.filter(t => t.status === 'done');
  const inProgress = todos.filter(t => t.status === 'in-progress');
  const pending = todos.filter(t => t.status === 'todo');
  
  // Check if all tasks are completed
  if (completed.length === todos.length) {
    return { label: 'Completed', class: 'completed', icon: 'check_circle' };
  }
  
  // Check for overdue tasks FIRST (pending or in-progress with PAST due date - before today)
  // Overdue takes priority over everything else
  const hasOverdue = todos.some(t => {
    if (t.status === 'done') return false;
    if (!t.dueDate) return false;
    const dueDate = parseDueDate(t.dueDate);
    if (!dueDate) return false;
    dueDate.setHours(0, 0, 0, 0);
    return dueDate < today;
  });
  
  if (hasOverdue) {
    return { label: 'Overdue', class: 'overdue', icon: 'warning' };
  }
  
  // Check for tasks due today (not yet complete) - "Needs Action"
  const hasDueToday = todos.some(t => {
    if (t.status === 'done') return false;
    if (!t.dueDate) return false;
    const dueDate = parseDueDate(t.dueDate);
    if (!dueDate) return false;
    const dueDateStr = dueDate.toISOString().split('T')[0];
    return dueDateStr === todayStr;
  });
  
  if (hasDueToday) {
    return { label: 'Due Today', class: 'due-today', icon: 'today' };
  }
  
  // Check if there's any progress
  if (inProgress.length > 0 || completed.length > 0) {
    return { label: 'In Progress', class: 'in-progress', icon: 'pending' };
  }
  
  // Check if there are upcoming tasks with due dates
  const hasFutureTasks = todos.some(t => {
    if (!t.dueDate) return false;
    const dueDate = parseDueDate(t.dueDate);
    if (!dueDate) return false;
    dueDate.setHours(0, 0, 0, 0);
    return dueDate > today;
  });
  
  if (hasFutureTasks) {
    return { label: 'Up to Date', class: 'up-to-date', icon: 'schedule' };
  }
  
  // No completed tasks and no due dates set
  return { label: 'Not Started', class: 'not-started', icon: 'radio_button_unchecked' };
}

// Navigate to the todos page for a specific event
function navigateToTodos(eventId) {
  if (!eventId) return;
  localStorage.setItem('eventId', eventId);
  if (typeof window.navigate === 'function') {
    window.navigate('todos', eventId);
  } else {
    window.location.hash = `todos?id=${eventId}`;
  }
}

// Navigate to the crew page for a specific event
function navigateToCrew(eventId) {
  if (!eventId) return;
  localStorage.setItem('eventId', eventId);
  if (typeof window.navigate === 'function') {
    window.navigate('crew', eventId);
  } else {
    window.location.hash = `crew?id=${eventId}`;
  }
}

// Make them globally available
window.navigateToTodos = navigateToTodos;
window.navigateToCrew = navigateToCrew;

/**
 * Fetch passenger counts for all events (unique passengers per event)
 */
async function fetchFlightCounts() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE}/api/flights/booked`, {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.warn('Failed to fetch flight counts');
      return {};
    }
    
    const flights = await response.json();
    
    // Group flights by event name and count unique passengers
    const passengerCounts = {};
    flights.forEach(flight => {
      const eventName = flight.eventName || 'Flight';
      if (!passengerCounts[eventName]) {
        passengerCounts[eventName] = new Set();
      }
      // Add all passenger IDs to the set for this event
      if (flight.passengers && Array.isArray(flight.passengers)) {
        flight.passengers.forEach(passenger => {
          if (passenger.passengerId) {
            passengerCounts[eventName].add(passenger.passengerId);
          }
        });
      }
    });
    
    // Convert Sets to counts
    const counts = {};
    Object.keys(passengerCounts).forEach(eventName => {
      counts[eventName] = passengerCounts[eventName].size;
    });
    
    return counts;
  } catch (error) {
    console.error('Error fetching flight counts:', error);
    return {};
  }
}

/**
 * Pending / change-requested flight counts per event (by eventId, title fallback).
 * Planner/admin only — returns {} for others.
 */
async function fetchPendingFlightCounts() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE}/api/flights/pending`, {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) return { byId: {}, byName: {}, firstIdByEvent: {} };

    const flights = await response.json();
    const byId = {};
    const byName = {};
    const firstIdByEvent = {};
    (Array.isArray(flights) ? flights : []).forEach(flight => {
      const id = flight.eventId?._id || flight.eventId;
      if (id) {
        const key = String(id);
        byId[key] = (byId[key] || 0) + 1;
        if (!firstIdByEvent[key] && flight._id) firstIdByEvent[key] = String(flight._id);
      }
      const name = (flight.eventId?.title || flight.eventName || '').trim();
      if (name) {
        byName[name] = (byName[name] || 0) + 1;
        if (!firstIdByEvent[`name:${name}`] && flight._id) {
          firstIdByEvent[`name:${name}`] = String(flight._id);
        }
      }
    });
    return { byId, byName, firstIdByEvent };
  } catch (error) {
    console.error('Error fetching pending flight counts:', error);
    return { byId: {}, byName: {}, firstIdByEvent: {} };
  }
}

function handleFlightBadgeClick(eventId, flightCount, pendingCount, pendingFlightId) {
  // Pending-only: jump to Flight Management and open that request
  if (!(Number(flightCount) > 0) && Number(pendingCount) > 0) {
    const url = pendingFlightId
      ? `/pages/flights.html?flightId=${encodeURIComponent(pendingFlightId)}`
      : `/pages/flights.html?eventId=${encodeURIComponent(eventId)}`;
    window.location.href = url;
    return false;
  }
  if (typeof window.navigate === 'function') {
    window.navigate('travel-accommodation', eventId);
  }
  return false;
}
window.handleFlightBadgeClick = handleFlightBadgeClick;

/**
 * Check which events have schedule content
 * Returns object with eventId as key and boolean as value
 */
function checkScheduleContent(tables) {
  const scheduleStatus = {};
  tables.forEach(table => {
    // Check if programSchedule exists and has content
    const hasSchedule = table.programSchedule && 
                       Array.isArray(table.programSchedule) && 
                       table.programSchedule.length > 0;
    scheduleStatus[table._id] = hasSchedule;
  });
  return scheduleStatus;
}

/**
 * Fetch events that have gear reserved
 * Returns Set of eventIds that have gear
 */
async function fetchEventsWithGear() {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE}/api/gear-packages/events-with-gear`, {
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch events with gear');
      return new Set();
    }
    
    const data = await response.json();
    // Convert ObjectIds to strings for comparison
    const eventIdStrings = (data.eventIds || []).map(id => id.toString());
    console.log('[GEAR DEBUG] Events with gear:', eventIdStrings);
    return new Set(eventIdStrings);
  } catch (error) {
    console.error('Error fetching events with gear:', error);
    return new Set();
  }
}

function companyClientCellHtml(general) {
  const company = (general?.company || '').trim();
  const client = (general?.client || '').trim();
  if (company && client) {
    return `<div class="event-company-client">
      <span class="event-company">${company}</span>
      <span class="event-client">${client}</span>
    </div>`;
  }
  if (company) return `<span class="event-client">${company}</span>`;
  if (client) return `<span class="event-client">${client}</span>`;
  return `<span class="event-client">—</span>`;
}

function renderEventRowDark(table, index, userId) {
  const general = table.general || {};
  const accentColor = rowAccentColors[index % rowAccentColors.length];
  
  // Get unique crew member names from rows, with profile photos if available
  const rows = table.rows || [];
  const uniqueCrewNames = [...new Set(rows.map(r => r.name).filter(n => n && n.trim()))];
  const crewMembers = uniqueCrewNames.map(name => {
    const photo = userPhotoMap[name.toLowerCase().trim()] || null;
    return photo ? { name, photo } : { name };
  });
  const crewCount = crewMembers.length;
  
  // Count unassigned positions (rows with a real role but no name assigned)
  // Exclude placeholder rows (role === '__placeholder__') and empty roles
  const unassignedCount = rows.filter(r => {
    const role = r.role && r.role.trim();
    const hasRealRole = role && role !== '__placeholder__';
    const hasName = r.name && r.name.trim();
    return hasRealRole && !hasName;
  }).length;
  
  const dateStr = formatDateRangeDark(general.start, general.end);
  
  // Check if current user is owner (handle both populated and unpopulated owners)
  const isOwner = Array.isArray(table.owners) && table.owners.some(owner => 
    (typeof owner === 'string' && owner === userId) || 
    (owner && owner._id && owner._id.toString() === userId)
  );
  
  // Get owner names for display
  const ownerNames = table.ownerNames || [];
  const ownerDisplay = ownerNames.length > 0 ? ownerNames[0] : '—';
  const hasMultipleOwners = ownerNames.length > 1;
  const ownerListHtml = ownerNames.map(name => `<div class="owner-dropdown-item">${name}</div>`).join('');
  
  // Get task status
  const todos = table.todos || [];
  const taskStatus = getTaskStatus(todos);
  
  const row = document.createElement('tr');
  row.className = 'event-row';
  row.dataset.eventId = table._id;
  
  // Get city and state from general
  const cityState = [general.city, general.state].filter(Boolean).join(', ');
  
  row.innerHTML = `
    <td style="--row-accent: ${accentColor};">
      <div class="event-name-cell">
        <div class="event-name">
          <a href="#" class="event-name-link" onclick="window.navigate('general', '${table._id}'); return false;">
            ${table.title || 'Untitled Event'}
          </a>
          <span class="material-symbols-outlined edit-icon" onclick="event.stopPropagation(); openEditEventModal('${table._id}', this)">edit</span>
        </div>
        ${cityState ? `
          <div class="event-location-info">
            <span class="material-symbols-outlined" style="font-size: 14px;">location_on</span>
            ${cityState}
          </div>
          ` : ''}
        <div class="event-badges event-badges-inline">
          <span class="flight-badge badge-longpress ${getBadgeClass('flight', table.flightCount > 0, table.badgesNotRequired)}${table.pendingFlightCount > 0 && !table.badgesNotRequired?.flight ? ' has-pending' : ''}" data-event-id="${table._id}" data-badge-type="flight" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.flight)}" onclick="event.stopPropagation(); handleFlightBadgeClick('${table._id}', ${table.flightCount || 0}, ${table.pendingFlightCount || 0}, '${table.pendingFlightId || ''}'); return false;" title="${getBadgeTitle('flight', table.flightCount > 0, table.badgesNotRequired, table.flightCount, table.pendingFlightCount)}">
              <span class="material-symbols-outlined">flight</span>
              ${table.flightCount > 0 && !table.badgesNotRequired?.flight ? `<span class="flight-count">${table.flightCount}</span>` : ''}
              ${flightPendingDotHtml(table.pendingFlightCount, table.badgesNotRequired)}
            </span>
          <span class="hotel-badge badge-longpress ${getBadgeClass('hotel', table.hotelCount > 0, table.badgesNotRequired)}${table.badgesRequested?.hotel && !(table.hotelCount > 0) && !table.badgesNotRequired?.hotel ? ' has-requested' : ''}" data-event-id="${table._id}" data-badge-type="hotel" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.hotel)}" data-requested="${!!(table.badgesRequested && table.badgesRequested.hotel)}" onclick="event.stopPropagation(); window.navigate('travel-accommodation', '${table._id}'); return false;" title="${getBadgeTitle('hotel', table.hotelCount > 0, table.badgesNotRequired, table.hotelCount, 0, table.badgesRequested)}">
              <span class="material-symbols-outlined">hotel</span>
              ${table.hotelCount > 0 && !table.badgesNotRequired?.hotel ? `<span class="hotel-count">${table.hotelCount}</span>` : ''}
              ${hotelRequestedDotHtml(table)}
            </span>
          <span class="share-badge badge-longpress ${getBadgeClass('share', table.shareCount > 0, table.badgesNotRequired)}" data-event-id="${table._id}" data-badge-type="share" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.share)}" onclick="event.stopPropagation(); openShareModal('${table._id}');" title="${getBadgeTitle('share', table.shareCount > 0, table.badgesNotRequired, table.shareCount)}">
              <span class="material-symbols-outlined">send</span>
              ${table.shareCount > 0 && !table.badgesNotRequired?.share ? `<span class="share-count">${table.shareCount}</span>` : ''}
            </span>
          <span class="schedule-badge badge-longpress ${getBadgeClass('schedule', table.hasSchedule, table.badgesNotRequired)}" data-event-id="${table._id}" data-badge-type="schedule" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.schedule)}" onclick="event.stopPropagation(); window.navigate('schedule', '${table._id}'); return false;" title="${getBadgeTitle('schedule', table.hasSchedule, table.badgesNotRequired)}">
              <span class="material-symbols-outlined">calendar_month</span>
            </span>
          <span class="gear-badge badge-longpress ${getBadgeClass('gear', table.hasGear, table.badgesNotRequired)}" data-event-id="${table._id}" data-badge-type="gear" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.gear)}" onclick="event.stopPropagation(); window.navigate('gear', '${table._id}'); return false;" title="${getBadgeTitle('gear', table.hasGear, table.badgesNotRequired)}">
              <span class="material-symbols-outlined">photo_camera</span>
            </span>
        </div>
      </div>
    </td>
    <td class="badges-cell">
      <div class="event-badges">
          <span class="flight-badge badge-longpress ${getBadgeClass('flight', table.flightCount > 0, table.badgesNotRequired)}${table.pendingFlightCount > 0 && !table.badgesNotRequired?.flight ? ' has-pending' : ''}" data-event-id="${table._id}" data-badge-type="flight" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.flight)}" onclick="event.stopPropagation(); handleFlightBadgeClick('${table._id}', ${table.flightCount || 0}, ${table.pendingFlightCount || 0}, '${table.pendingFlightId || ''}'); return false;" oncontextmenu="event.preventDefault(); event.stopPropagation(); showBadgeContextMenu(event, '${table._id}', 'flight', ${!!(table.badgesNotRequired && table.badgesNotRequired.flight)});" title="${getBadgeTitle('flight', table.flightCount > 0, table.badgesNotRequired, table.flightCount, table.pendingFlightCount)}">
              <span class="material-symbols-outlined">flight</span>
              ${table.flightCount > 0 && !table.badgesNotRequired?.flight ? `<span class="flight-count">${table.flightCount}</span>` : ''}
              ${flightPendingDotHtml(table.pendingFlightCount, table.badgesNotRequired)}
            </span>
          <span class="hotel-badge badge-longpress ${getBadgeClass('hotel', table.hotelCount > 0, table.badgesNotRequired)}${table.badgesRequested?.hotel && !(table.hotelCount > 0) && !table.badgesNotRequired?.hotel ? ' has-requested' : ''}" data-event-id="${table._id}" data-badge-type="hotel" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.hotel)}" data-requested="${!!(table.badgesRequested && table.badgesRequested.hotel)}" onclick="event.stopPropagation(); window.navigate('travel-accommodation', '${table._id}'); return false;" oncontextmenu="event.preventDefault(); event.stopPropagation(); showBadgeContextMenu(event, '${table._id}', 'hotel', ${!!(table.badgesNotRequired && table.badgesNotRequired.hotel)}, ${!!(table.badgesRequested && table.badgesRequested.hotel)});" title="${getBadgeTitle('hotel', table.hotelCount > 0, table.badgesNotRequired, table.hotelCount, 0, table.badgesRequested)}">
              <span class="material-symbols-outlined">hotel</span>
              ${table.hotelCount > 0 && !table.badgesNotRequired?.hotel ? `<span class="hotel-count">${table.hotelCount}</span>` : ''}
              ${hotelRequestedDotHtml(table)}
            </span>
          <span class="share-badge badge-longpress ${getBadgeClass('share', table.shareCount > 0, table.badgesNotRequired)}" data-event-id="${table._id}" data-badge-type="share" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.share)}" onclick="event.stopPropagation(); openShareModal('${table._id}');" oncontextmenu="event.preventDefault(); event.stopPropagation(); showBadgeContextMenu(event, '${table._id}', 'share', ${!!(table.badgesNotRequired && table.badgesNotRequired.share)});" title="${getBadgeTitle('share', table.shareCount > 0, table.badgesNotRequired, table.shareCount)}">
              <span class="material-symbols-outlined">send</span>
              ${table.shareCount > 0 && !table.badgesNotRequired?.share ? `<span class="share-count">${table.shareCount}</span>` : ''}
            </span>
          <span class="schedule-badge badge-longpress ${getBadgeClass('schedule', table.hasSchedule, table.badgesNotRequired)}" data-event-id="${table._id}" data-badge-type="schedule" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.schedule)}" onclick="event.stopPropagation(); window.navigate('schedule', '${table._id}'); return false;" oncontextmenu="event.preventDefault(); event.stopPropagation(); showBadgeContextMenu(event, '${table._id}', 'schedule', ${!!(table.badgesNotRequired && table.badgesNotRequired.schedule)});" title="${getBadgeTitle('schedule', table.hasSchedule, table.badgesNotRequired)}">
              <span class="material-symbols-outlined">calendar_month</span>
            </span>
          <span class="gear-badge badge-longpress ${getBadgeClass('gear', table.hasGear, table.badgesNotRequired)}" data-event-id="${table._id}" data-badge-type="gear" data-not-required="${!!(table.badgesNotRequired && table.badgesNotRequired.gear)}" onclick="event.stopPropagation(); window.navigate('gear', '${table._id}'); return false;" oncontextmenu="event.preventDefault(); event.stopPropagation(); showBadgeContextMenu(event, '${table._id}', 'gear', ${!!(table.badgesNotRequired && table.badgesNotRequired.gear)});" title="${getBadgeTitle('gear', table.hasGear, table.badgesNotRequired)}">
              <span class="material-symbols-outlined">photo_camera</span>
            </span>
      </div>
    </td>
    <td>
      ${companyClientCellHtml(general)}
    </td>
    <td>
      <span class="event-date">${dateStr}</span>
    </td>
    <td>
      <div class="crew-avatars">
        ${renderCrewAvatarsDark(crewMembers, crewCount, table._id, unassignedCount)}
      </div>
    </td>
    <td>
      <div class="task-status-badge ${taskStatus.class}" onclick="event.stopPropagation(); navigateToTodos('${table._id}')" style="cursor: pointer;" title="View tasks">
        <span class="material-symbols-outlined">${taskStatus.icon}</span>
        <span class="task-status-label">${taskStatus.label}</span>
      </div>
    </td>
    <td>
      <div class="event-owner ${hasMultipleOwners ? 'has-dropdown' : ''}" onclick="${hasMultipleOwners ? 'event.stopPropagation(); toggleOwnerDropdown(this)' : ''}">
        <span class="owner-name">${ownerDisplay}</span>
        ${hasMultipleOwners ? `<span class="owner-more">+${ownerNames.length - 1}</span>` : ''}
        ${hasMultipleOwners ? `<div class="owner-dropdown">${ownerListHtml}</div>` : ''}
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
          ${!isOwner ? (() => {
            try {
              const tkn = localStorage.getItem('token');
              const p = JSON.parse(atob(tkn.split('.')[1]));
              if (p.role === 'admin') {
                return `
                  <button class="action-item add-me-owner-action">
                    <span class="material-symbols-outlined">person_add</span>
                    Add Me as Owner
                  </button>
                `;
              } else if (p.role === 'planner') {
                const hasPending = Array.isArray(table.ownerRequests) && 
                  table.ownerRequests.some(r => r.userId === userId && r.status === 'pending');
                return `
                  <button class="action-item request-owner-action" ${hasPending ? 'disabled style="opacity:0.6;cursor:default;"' : ''}>
                    <span class="material-symbols-outlined">${hasPending ? 'hourglass_top' : 'admin_panel_settings'}</span>
                    ${hasPending ? 'Request Pending...' : 'Request Owner Access'}
                  </button>
                `;
              }
            } catch(e) { console.error('Error rendering owner request button:', e); }
            return '';
          })() : ''}
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
  
  const addMeOwnerBtn = row.querySelector('.add-me-owner-action');
  if (addMeOwnerBtn) {
    addMeOwnerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.classList.remove('show');
      
      const confirmed = await showConfirm(
        'Add Yourself as Owner',
        `Add yourself as an owner of "${table.title}"?`,
        { confirmText: 'Add Me', type: 'warning' }
      );
      if (!confirmed) return;
      
      try {
        const res = await fetch(`${API_BASE}/api/tables/${table._id}/add-me-as-owner`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token
          }
        });
        const data = await res.json();
        if (res.ok) {
          showToast('You are now an owner of this event!', 'success');
          loadTables();
        } else {
          showToast(data.error || 'Failed to add as owner', 'error');
        }
      } catch (err) {
        console.error('Error adding self as owner:', err);
        showToast('Failed to add as owner. Please try again.', 'error');
      }
    });
  }

  const requestOwnerBtn = row.querySelector('.request-owner-action');
  if (requestOwnerBtn && !requestOwnerBtn.disabled) {
    requestOwnerBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      menu.classList.remove('show');
      
      const confirmed = await showConfirm(
        'Request Owner Access',
        `Request owner access to "${table.title}"? The event owner will be notified and can approve your request.`,
        { confirmText: 'Request', type: 'warning' }
      );
      if (!confirmed) return;
      
      try {
        const res = await fetch(`${API_BASE}/api/tables/${table._id}/request-owner`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token
          }
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Owner access request sent!', 'success');
        } else {
          showToast(data.error || 'Failed to send request', 'error');
        }
      } catch (err) {
        console.error('Error requesting owner access:', err);
        showToast('Failed to send request. Please try again.', 'error');
      }
    });
  }

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
        <td>
          <div style="display: flex; gap: 6px;">
            <div class="skeleton" style="width: 28px; height: 28px; border-radius: 8px;"></div>
            <div class="skeleton" style="width: 28px; height: 28px; border-radius: 8px;"></div>
            <div class="skeleton" style="width: 28px; height: 28px; border-radius: 8px;"></div>
          </div>
        </td>
        <td><div class="skeleton" style="width: 120px; height: 16px;"></div></td>
        <td><div class="skeleton" style="width: 140px; height: 16px;"></div></td>
        <td>
          <div style="display: flex;">
            <div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%;"></div>
            <div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%; margin-left: -8px;"></div>
            <div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%; margin-left: -8px;"></div>
          </div>
        </td>
        <td><div class="skeleton" style="width: 60px; height: 24px; border-radius: 12px;"></div></td>
        <td><div class="skeleton" style="width: 32px; height: 32px; border-radius: 50%;"></div></td>
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
  
  // Fetch users with profile photos for crew avatars
  try {
    const usersRes = await fetch(`${API_BASE}/api/users`, {
      headers: { Authorization: token }
    });
    if (usersRes.ok) {
      const users = await usersRes.json();
      userPhotoMap = {};
      users.forEach(u => {
        if (u.profilePhoto && u.name) {
          userPhotoMap[u.name.toLowerCase().trim()] = u.profilePhoto;
        }
      });
    }
  } catch (err) {
    console.error('Error fetching user photos:', err);
  }

  // Always fetch passenger counts to ensure they're up to date
  const [passengerCounts, pendingFlightCounts] = await Promise.all([
    fetchFlightCounts(),
    fetchPendingFlightCounts()
  ]);
  tables.forEach(table => {
    const eventTitle = table.title || 'Untitled Event';
    const tableId = table._id?.toString?.() || String(table._id);
    table.flightCount = passengerCounts[eventTitle] || 0; // flightCount stores unique passenger count
    table.pendingFlightCount = pendingFlightCounts.byId[tableId]
      || pendingFlightCounts.byName[eventTitle]
      || 0;
    table.pendingFlightId = pendingFlightCounts.firstIdByEvent[tableId]
      || pendingFlightCounts.firstIdByEvent[`name:${eventTitle}`]
      || '';
  });
  
  // Check which events have schedule content
  const scheduleStatus = checkScheduleContent(tables);
  tables.forEach(table => {
    table.hasSchedule = scheduleStatus[table._id] || false;
  });
  
  // Check which events have gear reserved
  const eventsWithGear = await fetchEventsWithGear();
  tables.forEach(table => {
    const tableId = table._id.toString();
    table.hasGear = eventsWithGear.has(tableId);
    if (eventsWithGear.size > 0) {
      console.log('[GEAR DEBUG] Checking table:', tableId, 'hasGear:', table.hasGear);
    }
  });
  
  // Calculate share count for each table (leads + sharedWith, excluding owners)
  tables.forEach(table => {
    const leadsCount = Array.isArray(table.leads) ? table.leads.length : 0;
    const sharedWithCount = Array.isArray(table.sharedWith) ? table.sharedWith.length : 0;
    table.shareCount = leadsCount + sharedWithCount;
  });
  
  // Calculate hotel count for each table (accommodation entries with hotel info)
  tables.forEach(table => {
    const accommodations = Array.isArray(table.accommodation) ? table.accommodation : [];
    table.hotelCount = accommodations.filter(a => a.hotel && a.hotel.trim()).length;
  });
  
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

  // Extract unique companies and clients for the dropdowns (before filtering)
  const companySet = new Set();
  const clientSet = new Set();
  tables.forEach(table => {
    const company = table.general?.company;
    if (company && company.trim()) {
      companySet.add(company.trim());
    }
    const client = table.general?.client;
    if (client && client.trim()) {
      clientSet.add(client.trim());
    }
  });
  allCompanies = Array.from(companySet).sort();
  allClients = Array.from(clientSet).sort();

  // Filter by owner selection
  if (ownerFilter === 'mine') {
    const userId = getUserIdFromToken();
    filteredTables = filteredTables.filter(table => {
      // Check if user is in owners array (handle both populated and unpopulated)
      return Array.isArray(table.owners) && table.owners.some(owner => 
        (typeof owner === 'string' && owner === userId) || 
        (owner && owner._id && owner._id.toString() === userId)
      );
    });
  } else if (ownerFilter !== 'all') {
    // Filter by specific owner ID
    filteredTables = filteredTables.filter(table => {
      return Array.isArray(table.owners) && table.owners.some(owner => 
        (typeof owner === 'string' && owner === ownerFilter) || 
        (owner && owner._id && owner._id.toString() === ownerFilter)
      );
    });
  }

  // Filter by client selection
  if (clientFilter) {
    filteredTables = filteredTables.filter(table => {
      const client = table.general?.client || '';
      return client === clientFilter;
    });
  }

  // Filter by search box
  if (searchEventsValue) {
    const q = searchEventsValue.toLowerCase();
    filteredTables = filteredTables.filter(table => {
      const title = (table.title || '').toLowerCase();
      const company = (table.general?.company || '').toLowerCase();
      const client = (table.general?.client || '').toLowerCase();
      const city = (table.general?.city || '').toLowerCase();
      const state = (table.general?.state || '').toLowerCase();
      const location = (table.general?.location || '').toLowerCase();
      return title.includes(q) || company.includes(q) || client.includes(q) || city.includes(q) || state.includes(q) || location.includes(q);
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

  // Sort based on column header clicks
  filteredTables.sort((a, b) => {
    let comparison = 0;
    
    if (sortField === 'name') {
      comparison = (a.title || '').localeCompare(b.title || '');
    } else if (sortField === 'date') {
    const parseDateUTC = (dateStr) => {
      if (!dateStr) return new Date(0);
        return new Date(dateStr);
    };
    const dateA = parseDateUTC(a.general?.start || a.createdAt || 0);
    const dateB = parseDateUTC(b.general?.start || b.createdAt || 0);
      comparison = dateA - dateB;
    }
    
    // Apply sort order
    return sortOrder === 'desc' ? -comparison : comparison;
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
      
      // Separate live events from the rest
      const liveEvents = filteredTables.filter(table => {
        const status = getEventStatus(table);
        return status.class === 'live';
      });
      
      // Filter by tab (live events are excluded from tab filtering since they get their own section on Upcoming)
      let tabFilteredTables = filteredTables;
      if (filter === 'upcoming') {
        // For Upcoming tab: show only upcoming events (live events shown separately above)
        tabFilteredTables = filteredTables.filter(table => {
          const status = getEventStatus(table);
          return status.class === 'upcoming';
        });
      } else if (filter !== 'all') {
        tabFilteredTables = filteredTables.filter(table => {
          const status = getEventStatus(table);
          return status.class === filter;
        });
      }
      
      // On the Upcoming tab, include live events in the total count
      const liveCountForUpcoming = (filter === 'upcoming') ? liveEvents.length : 0;
      
      // Store total for pagination (upcoming events only, live section is always shown in full)
      totalFilteredEvents = tabFilteredTables.length + liveCountForUpcoming;
      const totalPages = Math.ceil(tabFilteredTables.length / EVENTS_PER_PAGE) || 1;
      
      // Ensure current page is valid
      if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
      
      // Paginate the upcoming results (live events are NOT paginated - always shown)
      const startIndex = (currentPage - 1) * EVENTS_PER_PAGE;
      const endIndex = startIndex + EVENTS_PER_PAGE;
      const paginatedTables = tabFilteredTables.slice(startIndex, endIndex);
      
      // Populate owner dropdown with owners from currently visible events
      const allVisibleTables = filter === 'upcoming' ? [...liveEvents, ...paginatedTables] : paginatedTables;
      populateOwnerDropdown(allVisibleTables);
      
      // If on the Upcoming tab and there are live events, render the Live Events section first
      if (filter === 'upcoming' && liveEvents.length > 0) {
        // Live section header row
        const liveHeaderRow = document.createElement('tr');
        liveHeaderRow.className = 'live-section-header-row';
        liveHeaderRow.innerHTML = `
          <td colspan="8">
            <div class="live-section-header">
              <span class="live-pulse-dot"></span>
              <span class="live-section-title">Live Events</span>
              <span class="live-section-count">${liveEvents.length}</span>
            </div>
          </td>
        `;
        tableBody.appendChild(liveHeaderRow);
        
        // Render live event rows
        liveEvents.forEach((table, index) => {
          const row = renderEventRowDark(table, index, userId);
          row.classList.add('live-section-event');
          tableBody.appendChild(row);
        });
        
        // Divider row between live and upcoming sections
        if (paginatedTables.length > 0) {
          const dividerRow = document.createElement('tr');
          dividerRow.className = 'live-section-divider-row';
          dividerRow.innerHTML = `
            <td colspan="8">
              <div class="live-section-divider">
                <span class="divider-label">Upcoming Events</span>
              </div>
            </td>
          `;
          tableBody.appendChild(dividerRow);
        }
      }
      
      // Render the main event rows
      paginatedTables.forEach((table, index) => {
        const row = renderEventRowDark(table, startIndex + index, userId);
        tableBody.appendChild(row);
      });
      
      if (eventsCount) {
        const showingStart = totalFilteredEvents > 0 ? 1 : 0;
        eventsCount.textContent = `Showing ${totalFilteredEvents} events`;
      }
      
      // Render pagination controls
      renderPagination(totalPages);
      
      // Mark initial load as complete
      if (isInitialLoad) {
        isInitialLoad = false;
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
}

// Helper function to render a single event card
function renderEventCard(table, container, userId) {
  const general = table.general || {};
  const company = general.company || '';
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
  details.innerHTML = `${company && client !== 'N/A' ? `${company} · ${client}` : (company || `Client: ${client}`)} <br> ${start} - ${end}`;
  
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

  // "Request Owner Access" menu item (for planners/admins who are NOT already owners)
  const requestOwnerMenuItem = document.createElement('button');
  requestOwnerMenuItem.className = 'menu-item';
  requestOwnerMenuItem.innerHTML = '<span class="material-symbols-outlined">admin_panel_settings</span> Request Owner Access';
  requestOwnerMenuItem.onclick = async (e) => {
    e.stopPropagation();
    menuDropdown.classList.remove('show');
    
    const confirmed = await showConfirm(
      'Request Owner Access',
      `Request owner access to "${table.title}"? The event owner will be notified and can approve your request.`,
      { confirmText: 'Request', type: 'warning' }
    );
    if (!confirmed) return;
    
    try {
      const res = await fetch(`${API_BASE}/api/tables/${table._id}/request-owner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        }
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Owner access request sent!', 'success');
      } else {
        showToast(data.error || 'Failed to send request', 'error');
      }
    } catch (err) {
      console.error('Error requesting owner access:', err);
      showToast('Failed to send request. Please try again.', 'error');
    }
  };

  // Add menu items to dropdown
  menuDropdown.appendChild(archiveMenuItem);
  
  // Show "Request Owner Access" for planners/admins who are NOT already owners
  if (!isOwner) {
    try {
      const tokenPayload = JSON.parse(atob(token.split('.')[1]));
      if (['planner', 'admin'].includes(tokenPayload.role)) {
        // Check if there's already a pending request
        const hasPendingRequest = Array.isArray(table.ownerRequests) && 
          table.ownerRequests.some(r => r.userId === getUserIdFromToken() && r.status === 'pending');
        if (hasPendingRequest) {
          requestOwnerMenuItem.disabled = true;
          requestOwnerMenuItem.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span> Request Pending...';
          requestOwnerMenuItem.style.opacity = '0.6';
          requestOwnerMenuItem.style.cursor = 'default';
        }
        menuDropdown.appendChild(requestOwnerMenuItem);
      }
    } catch (e) { console.error('Error rendering owner request button:', e); }
  }

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

// Calendar view removed - using dedicated calendar page (/pages/event-calendar.html) instead

async function openShareModal(tableId) {
  try {
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
    if (!shareModal) {
      console.error('[SHARE_MODAL] shareModal element not found in DOM!');
      showToast('Error: Share modal not found. Please refresh the page.', 'error');
      return;
    }
    
    if (shareModal) {
      shareModal.classList.add('show');
      document.body.style.overflow = 'hidden';
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
    const ownerListContainer = document.getElementById('ownerList');
    const leadListContainer = document.getElementById('leadList');
    const sharedListContainer = document.getElementById('sharedList');
    
    let ownerList = ownerListContainer?.querySelector('ul');
    let leadList = leadListContainer?.querySelector('ul');
    let sharedList = sharedListContainer?.querySelector('ul');
    
    // If UL elements are missing, recreate them
    if (ownerListContainer && !ownerList) {
      ownerListContainer.innerHTML = '<ul></ul>';
      ownerList = ownerListContainer.querySelector('ul');
    }
    if (leadListContainer && !leadList) {
      leadListContainer.innerHTML = '<ul></ul>';
      leadList = leadListContainer.querySelector('ul');
    }
    if (sharedListContainer && !sharedList) {
      sharedListContainer.innerHTML = '<ul></ul>';
      sharedList = sharedListContainer.querySelector('ul');
    }

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
      return `<li class="share-empty-item"><div class="share-empty">${message}</div></li>`;
    }

    // Populate lists and update counts
    const ownerCount = document.getElementById('ownerCount');
    const leadCount = document.getElementById('leadCount');
    const sharedCount = document.getElementById('sharedCount');
    
    if (ownerList) {
      ownerList.innerHTML = owners.length > 0 
        ? owners.map(u => renderUser(u, true)).join('') 
        : renderEmptyState('No owners');
    }
    if (leadList) {
      leadList.innerHTML = leads.length > 0 
        ? leads.map(u => renderUser(u, false)).join('') 
        : renderEmptyState('No leads assigned');
    }
    if (sharedList) {
      sharedList.innerHTML = shared.length > 0 
        ? shared.map(u => renderUser(u, false)).join('') 
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
  const dropdownContainer = document.getElementById('userDropdownContainer');
  const trigger = document.getElementById('userDropdownTrigger');
  const menu = document.getElementById('userDropdownMenu');
  const searchInput = document.getElementById('userSearchInput');
  const optionsContainer = document.getElementById('userDropdownOptions');
  const selectedUsersContainer = document.getElementById('selectedUsersList');
  
  if (!dropdownContainer || !trigger || !menu || !searchInput || !optionsContainer) {
    console.error('[SHARE_DROPDOWN] Missing dropdown elements');
    return;
  }
  
  // Reset selectedUsers array
  selectedUsers = [];
  renderSelectedUsers();
  
  let isOpen = false;
  
  // Helper to get initials
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
    }
    
  // Render user options
  function renderOptions(filter = '') {
    const filteredUsers = allUsers.filter(user => {
      const name = (user.name || user.fullName || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const isAlreadySelected = selectedUsers.some(s => s._id === user._id);
      const matchesFilter = !filter || name.includes(filter.toLowerCase()) || email.includes(filter.toLowerCase());
      return !isAlreadySelected && matchesFilter;
    });
    
    if (filteredUsers.length === 0) {
      optionsContainer.innerHTML = `<div class="share-dropdown-empty">No users found</div>`;
    } else {
      optionsContainer.innerHTML = filteredUsers.map(user => {
        const name = user.name || user.fullName || user.email;
        const email = user.email;
        const initials = getInitials(name);
        return `
          <button type="button" class="share-dropdown-option" data-user-id="${user._id}">
            <div class="option-avatar">${initials}</div>
            <div class="option-info">
              <span class="option-name">${name}</span>
              <span class="option-email">${email}</span>
            </div>
          </button>
        `;
      }).join('');
      
      // Add click handlers
      optionsContainer.querySelectorAll('.share-dropdown-option').forEach(option => {
        option.onclick = (e) => {
      e.preventDefault();
          e.stopPropagation();
          const userId = option.dataset.userId;
          const user = allUsers.find(u => u._id === userId);
          if (user) {
            addSelectedUser(user);
            searchInput.value = '';
            renderOptions('');
            closeDropdown();
          }
        };
      });
    }
  }
  
  function openDropdown() {
    console.log('[SHARE_DROPDOWN] Opening dropdown');
    isOpen = true;
    dropdownContainer.classList.add('open');
    
    // Calculate available space above trigger
    const triggerRect = trigger.getBoundingClientRect();
    const availableHeight = Math.min(280, triggerRect.top - 20);
    
    // Use CSS positioning within container
    menu.style.cssText = `
      display: block !important;
      position: absolute !important;
      bottom: calc(100% + 4px) !important;
      left: 0 !important;
      right: 0 !important;
      max-height: ${availableHeight}px !important;
      z-index: 999999 !important;
      background: #1a1a1a !important;
      border: 1px solid #333 !important;
      border-radius: 8px !important;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.6) !important;
      overflow: hidden !important;
    `;
    
    renderOptions(searchInput.value);
    setTimeout(() => searchInput.focus(), 50);
  }
  
  function closeDropdown() {
    console.log('[SHARE_DROPDOWN] Closing dropdown');
    isOpen = false;
    dropdownContainer.classList.remove('open');
    menu.style.cssText = 'display: none !important;';
  }
  
  // Trigger click
  trigger.onclick = (e) => {
    console.log('[SHARE_DROPDOWN] Trigger clicked, isOpen:', isOpen);
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
        }
  };
  
  // Search input
  searchInput.oninput = (e) => {
    renderOptions(e.target.value);
  };
  
  searchInput.onclick = (e) => e.stopPropagation();
  
  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isOpen && !dropdownContainer.contains(e.target) && !menu.contains(e.target)) {
      closeDropdown();
  }
  });
  
  function addSelectedUser(user) {
    if (!selectedUsers.some(selected => selected._id === user._id)) {
      selectedUsers.push(user);
      renderSelectedUsers();
    }
  }
  
  function removeSelectedUser(userId) {
    selectedUsers = selectedUsers.filter(user => user._id !== userId);
    renderSelectedUsers();
    // Re-render options to show the user again
    if (isOpen) renderOptions(searchInput.value);
  }
  
  function renderSelectedUsers() {
    if (!selectedUsersContainer) return;
    
    if (selectedUsers.length === 0) {
      selectedUsersContainer.innerHTML = '';
      trigger.querySelector('.dropdown-value').textContent = 'Select a person...';
      trigger.querySelector('.dropdown-value').classList.add('placeholder');
      return;
    }
    
    selectedUsersContainer.innerHTML = selectedUsers.map(user => {
      const name = user.name || user.fullName || user.email;
      const initials = getInitials(name);
      return `
        <div class="selected-user-chip">
          <div class="chip-avatar">${initials}</div>
          <span class="chip-name">${name}</span>
          <button type="button" class="chip-remove" onclick="window.removeSelectedUserById('${user._id}')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      `;
    }).join('');
    
    trigger.querySelector('.dropdown-value').textContent = `${selectedUsers.length} selected`;
    trigger.querySelector('.dropdown-value').classList.remove('placeholder');
  }
  
  // Make removeSelectedUser available globally
  window.removeSelectedUserById = removeSelectedUser;
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
  
  // Hide and reset dropdown
  const dropdownContainer = document.getElementById('userDropdownContainer');
  const dropdownMenu = document.getElementById('userDropdownMenu');
  if (dropdownContainer) dropdownContainer.classList.remove('open');
  if (dropdownMenu) {
    dropdownMenu.style.cssText = 'display: none !important;';
  }
  
  // Reset trigger text
  const trigger = document.getElementById('userDropdownTrigger');
  if (trigger) {
    const valueSpan = trigger.querySelector('.dropdown-value');
    if (valueSpan) {
      valueSpan.textContent = 'Select a person...';
      valueSpan.classList.add('placeholder');
    }
  }

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

// Share with all crew members on the event
async function shareWithCrew() {
  if (!currentTableId) {
    showToast('Missing event information', 'error');
    return;
  }
  
  const shareBtn = document.getElementById('shareWithCrewBtn');
  if (shareBtn) {
    shareBtn.disabled = true;
    shareBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">hourglass_empty</span> Sharing...';
  }
  
  try {
    // Fetch table data to get crew and current sharing info
    const tableRes = await fetch(`${API_BASE}/api/tables/${currentTableId}`, {
      headers: { Authorization: token }
    });
    
    if (!tableRes.ok) {
      throw new Error('Failed to fetch event data');
    }
    
    const table = await tableRes.json();
    const crewRows = table.rows || [];
    
    // Get current user ID
    const currentUserId = getUserIdFromToken();
    
    // Get list of users already on the event (owners, leads, sharedWith)
    const existingUserIds = new Set([
      ...(table.owners || []),
      ...(table.leads || []),
      ...(table.sharedWith || [])
    ]);
    
    // Get unique crew member names (excluding placeholders and empty names)
    const crewNames = [...new Set(
      crewRows
        .filter(row => row.name && row.name.trim() && row.role !== '__placeholder__')
        .map(row => row.name.trim())
    )];
    
    if (crewNames.length === 0) {
      showToast('No crew members found on this event.', 'warning');
      resetShareWithCrewBtn();
      return;
    }
    
    // Find users that match crew names
    const usersToShare = allUsers.filter(user => {
      const userName = user.name || user.fullName || '';
      
      // Skip if user is already on the event
      if (existingUserIds.has(user._id)) return false;
      
      // Skip if user is the current user
      if (user._id === currentUserId) return false;
      
      // Check if user's name matches any crew name
      return crewNames.some(crewName => 
        userName.toLowerCase() === crewName.toLowerCase()
      );
    });
    
    if (usersToShare.length === 0) {
      showToast('All crew members are already shared with this event.', 'info');
      resetShareWithCrewBtn();
      return;
    }
    
    // Confirm before sharing
    const confirmed = await showConfirm(
      'Share with Crew',
      `Share this event with ${usersToShare.length} crew member(s)?`,
      { confirmText: 'Share', type: 'info' }
    );
    
    if (!confirmed) {
      resetShareWithCrewBtn();
      return;
    }
    
    // Share with each crew member
    const results = [];
    for (const user of usersToShare) {
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
        results.push({ success: true, user: user.name || user.fullName || user.email });
      } else {
        results.push({ success: false, user: user.name || user.fullName || user.email, error: result.error });
      }
    }
    
    // Show summary
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    
    if (successCount > 0) {
      showToast(`Successfully shared with ${successCount} crew member(s).`, 'success', 5000);
    }
    
    if (failureCount > 0) {
      showToast(`Failed to share with ${failureCount} member(s).`, 'error', 5000);
    }
    
    // Refresh modal
    if (successCount > 0) {
      await openShareModal(currentTableId);
    }
    
  } catch (err) {
    console.error('Error sharing with crew:', err);
    showToast('Failed to share with crew. Please try again.', 'error');
  }
  
  resetShareWithCrewBtn();
}

function resetShareWithCrewBtn() {
  const shareBtn = document.getElementById('shareWithCrewBtn');
  if (shareBtn) {
    shareBtn.disabled = false;
    shareBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">groups</span> Share with Crew';
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
  
  // Reset initial load flag so we check for live events each time page loads
  isInitialLoad = true;
  
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
      
      const isAdmin = payload.role === 'admin';
      const canManageInventory = isAdmin || payload.role === 'production_manager';

      if (isAdmin || canManageInventory) {
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

          if (isAdmin) {
            // Add user management button (Settings → User management)
            let adminBtn = document.getElementById('adminConsoleBtn');
            if (!adminBtn && adminButtonsContainer) {
              adminBtn = document.createElement('button');
              adminBtn.id = 'adminConsoleBtn';
              adminBtn.className = 'btn-admin btn-outlined';
              adminBtn.textContent = 'User Management';
              adminBtn.onclick = () => {
                sessionStorage.setItem('settingsSection', 'users');
                if (typeof window.navigate === 'function') {
                  window.navigate('settings');
                } else {
                  window.location.href = '/dashboard.html#settings';
                }
              };
              adminButtonsContainer.appendChild(adminBtn);
            }
          }

          // Add inventory management button (admins + production managers)
          let inventoryBtn = document.getElementById('inventoryManagementBtn');
          if (!inventoryBtn && adminButtonsContainer && canManageInventory) {
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

          if (isAdmin) {
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

// Calendar modal removed - using dedicated calendar page instead

// Initialize dark theme specific features
async function initDarkTheme() {
  console.log('Initializing dark theme for events page');
  
  // Inject the shared dashboard sidebar
  const layoutContainer = document.getElementById('eventsPageLayout');
  if (layoutContainer && typeof window.injectDashboardSidebar === 'function') {
    await window.injectDashboardSidebar(layoutContainer, { 
      position: 'prepend',
      activePage: 'events'
    });
  } else if (typeof window.initDashboardSidebar === 'function') {
    // Fallback: sidebar HTML already exists, just initialize
    window.initDashboardSidebar();
  }
  
  // Setup tab filtering
  const tabs = document.querySelectorAll('.events-tab');
  tabs.forEach(tab => {
    tab.onclick = function() {
      tabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      resetPagination(); // Reset to page 1 when switching tabs
      loadTables(); // Reload with new filter
    };
  });
  
  // Setup create event button
  const createBtn = document.getElementById('createEventBtn');
  if (createBtn) {
    createBtn.onclick = showCreateModal;
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
  
  // Setup owner filter dropdown
  setupOwnerFilter();
  
  // Setup column header sorting
  setupSorting();
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
  
  // Restore saved status filter state
  const savedStatus = localStorage.getItem('eventsStatusFilter') || 'active';
  statusFilter = savedStatus;
  
  // Update UI to match saved state
  const label = document.getElementById('statusFilterLabel');
  if (label) {
    if (savedStatus === 'active') label.textContent = 'Active';
    else if (savedStatus === 'archived') label.textContent = 'Archived';
    else label.textContent = 'All';
  }
  
  // Update active option
  statusOptions.forEach(o => {
    o.classList.toggle('active', o.dataset.status === savedStatus);
  });
  
  // Highlight button if not default
  if (statusFilterBtn) {
    statusFilterBtn.classList.toggle('active', savedStatus !== 'active');
  }
  
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
        
        // Save to localStorage
        localStorage.setItem('eventsStatusFilter', newStatus);
        
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
        
        // Reset pagination and reload tables
        resetPagination();
        loadTables(true);
      });
      option._listenerAttached = true;
    }
  });
}

// Owner filter functionality
function setupOwnerFilter() {
  const ownerFilterBtn = document.getElementById('ownerFilterBtn');
  const ownerFilterDropdown = document.getElementById('ownerFilterDropdown');
  const ownerFilterLabel = document.getElementById('ownerFilterLabel');
  
  if (!ownerFilterBtn || !ownerFilterDropdown) return;
  
  // Only show for admins
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role === 'admin') {
        ownerFilterBtn.style.display = '';
      } else {
        ownerFilterBtn.style.display = 'none';
        ownerFilter = 'all'; // Reset to all for non-admins
        return;
      }
    }
  } catch (e) {
    console.error('Error checking admin role for owner filter:', e);
    return;
  }
  
  // Restore saved state
  ownerFilter = localStorage.getItem('eventsOwnerFilter') || 'all';
  updateOwnerFilterLabel();
  updateActiveOwnerOption();
  
  // Toggle dropdown on button click
  if (!ownerFilterBtn._listenerAttached) {
    ownerFilterBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const isVisible = ownerFilterDropdown.classList.contains('show');
      
      // Hide all other dropdowns
      document.querySelectorAll('.action-dropdown').forEach(d => d.classList.remove('show'));
      
      if (!isVisible) {
        ownerFilterDropdown.classList.add('show');
        // Position dropdown below button
        const rect = ownerFilterBtn.getBoundingClientRect();
        ownerFilterDropdown.style.position = 'fixed';
        ownerFilterDropdown.style.top = (rect.bottom + 8) + 'px';
        ownerFilterDropdown.style.left = rect.left + 'px';
      }
    });
    ownerFilterBtn._listenerAttached = true;
  }
  
  // Handle static option clicks (All Owners, My Events)
  const staticOptions = ownerFilterDropdown.querySelectorAll('.owner-option');
  staticOptions.forEach(option => {
    if (option._listenerAttached) return;
    
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      const value = this.dataset.owner;
      
      ownerFilter = value;
      localStorage.setItem('eventsOwnerFilter', ownerFilter);
      
      updateOwnerFilterLabel();
      updateActiveOwnerOption();
      ownerFilterDropdown.classList.remove('show');
      
      resetPagination();
      loadTables(true);
    });
    option._listenerAttached = true;
  });
  
  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!ownerFilterBtn.contains(e.target) && !ownerFilterDropdown.contains(e.target)) {
      ownerFilterDropdown.classList.remove('show');
    }
  });
  
  function updateOwnerFilterLabel() {
    if (!ownerFilterLabel) return;
    if (ownerFilter === 'all') {
      ownerFilterLabel.textContent = 'All Owners';
    } else if (ownerFilter === 'mine') {
      ownerFilterLabel.textContent = 'My Events';
    } else {
      // Find owner name from allOwners
      const owner = allOwners.find(o => o.id === ownerFilter);
      ownerFilterLabel.textContent = owner ? owner.name : 'Owner';
    }
  }
  
  function updateActiveOwnerOption() {
    // Update active state on all options
    ownerFilterDropdown.querySelectorAll('.owner-option, .dynamic-owner-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.owner === ownerFilter);
    });
  }
}

// Populate owner dropdown with unique owners from loaded events
function populateOwnerDropdown(tables) {
  const ownerOptionsList = document.getElementById('ownerOptionsList');
  if (!ownerOptionsList) return;
  
  // Extract unique owners from all tables
  const ownersMap = new Map();
  
  tables.forEach(table => {
    if (Array.isArray(table.owners)) {
      table.owners.forEach(owner => {
        const id = typeof owner === 'string' ? owner : (owner._id || owner.id);
        const name = owner.fullName || owner.name || owner.email || 'Unknown';
        if (id && !ownersMap.has(id)) {
          ownersMap.set(id, { id, name });
        }
      });
    }
    // Also check ownerNames if populated
    if (Array.isArray(table.ownerNames) && Array.isArray(table.owners)) {
      table.owners.forEach((ownerId, index) => {
        const id = typeof ownerId === 'string' ? ownerId : (ownerId._id || ownerId.id);
        const name = table.ownerNames[index] || 'Unknown';
        if (id && !ownersMap.has(id)) {
          ownersMap.set(id, { id, name });
        }
      });
    }
  });
  
  // Convert to array and sort by name
  allOwners = Array.from(ownersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  
  // Clear existing dynamic options
  ownerOptionsList.innerHTML = '';
  
  // Add owner options
  allOwners.forEach(owner => {
    const option = document.createElement('button');
    option.className = 'action-item dynamic-owner-option';
    option.dataset.owner = owner.id;
    if (owner.id === ownerFilter) {
      option.classList.add('active');
    }
    option.innerHTML = `
      <span class="material-symbols-outlined">account_circle</span>
      ${owner.name}
    `;
    
    option.addEventListener('click', function(e) {
      e.stopPropagation();
      ownerFilter = owner.id;
      localStorage.setItem('eventsOwnerFilter', ownerFilter);
      
      const ownerFilterLabel = document.getElementById('ownerFilterLabel');
      if (ownerFilterLabel) ownerFilterLabel.textContent = owner.name;
      
      // Update active states
      const ownerFilterDropdown = document.getElementById('ownerFilterDropdown');
      if (ownerFilterDropdown) {
        ownerFilterDropdown.querySelectorAll('.owner-option, .dynamic-owner-option').forEach(opt => {
          opt.classList.toggle('active', opt.dataset.owner === ownerFilter);
        });
        ownerFilterDropdown.classList.remove('show');
      }
      
      resetPagination();
      loadTables(true);
    });
    
    ownerOptionsList.appendChild(option);
  });
}

window.setupOwnerFilter = setupOwnerFilter;
window.populateOwnerDropdown = populateOwnerDropdown;

// Column header sorting functionality
function setupSorting() {
  const sortableHeaders = document.querySelectorAll('.events-table th.sortable');
  
  sortableHeaders.forEach(header => {
    if (header._sortListenerAttached) return;
    
    header.addEventListener('click', function() {
      const field = this.dataset.sort;
      
      // Toggle order if same field, otherwise default to ascending
      if (sortField === field) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortOrder = 'asc';
      }
      
      // Save to localStorage
      localStorage.setItem('eventsSortField', sortField);
      localStorage.setItem('eventsSortOrder', sortOrder);
      
      // Update sort icons
      updateSortIcons();
      
      // Reload tables with new sort
      loadTables(true);
    });
    
    header._sortListenerAttached = true;
  });
  
  // Initialize sort icons on page load
  updateSortIcons();
}

function updateSortIcons() {
  const sortableHeaders = document.querySelectorAll('.events-table th.sortable');
  
  sortableHeaders.forEach(header => {
    const field = header.dataset.sort;
    const icon = header.querySelector('.sort-icon');
    
    if (!icon) return;
    
    // Reset all headers
    header.classList.remove('sorted-asc', 'sorted-desc');
    
    if (field === sortField) {
      // Active sort column
      header.classList.add(sortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
      icon.textContent = sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward';
    } else {
      // Inactive - show default expand_more
      icon.textContent = 'expand_more';
    }
  });
}

window.setupSorting = setupSorting;

window.setupStatusFilter = setupStatusFilter;
window.setupDateFilters = setupDateFilters;
window.hideDateFilterDropdown = hideDateFilterDropdown;
window.applyDateFilter = applyDateFilter;
window.clearDateFilter = clearDateFilter;
window.submitShare = submitShare;
window.closeModal = closeModal;
window.shareWithCrew = shareWithCrew;
window.submitCreate = submitCreate;
window.hideCreateModal = hideCreateModal;

// Toggle owner dropdown
function toggleOwnerDropdown(element) {
  // Close any other open dropdowns
  document.querySelectorAll('.event-owner.show-dropdown').forEach(el => {
    if (el !== element) el.classList.remove('show-dropdown');
  });
  
  // Toggle this dropdown
  element.classList.toggle('show-dropdown');
}

// Close owner dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.event-owner')) {
    document.querySelectorAll('.event-owner.show-dropdown').forEach(el => {
      el.classList.remove('show-dropdown');
    });
  }
});

window.toggleOwnerDropdown = toggleOwnerDropdown;

// Pagination functions
function renderPagination(totalPages) {
  // Find or create pagination container
  let paginationContainer = document.getElementById('eventsPagination');
  
  if (!paginationContainer) {
    // Create pagination container if it doesn't exist
    const eventsFooter = document.querySelector('.events-footer');
    if (eventsFooter) {
      paginationContainer = document.createElement('div');
      paginationContainer.id = 'eventsPagination';
      paginationContainer.className = 'events-pagination';
      eventsFooter.appendChild(paginationContainer);
    } else {
      return; // No footer to attach to
    }
  }
  
  // Don't show pagination if only 1 page
  if (totalPages <= 1) {
    paginationContainer.innerHTML = '';
    paginationContainer.style.display = 'none';
    return;
  }
  
  paginationContainer.style.display = 'flex';
  
  // Build pagination HTML
  let html = '';
  
  // Previous button
  html += `<button class="pagination-btn pagination-prev ${currentPage === 1 ? 'disabled' : ''}" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">
    <span class="material-symbols-outlined">chevron_left</span>
  </button>`;
  
  // Page numbers
  html += '<div class="pagination-pages">';
  
  // Determine which pages to show
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // Adjust start if we're near the end
  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  // First page + ellipsis
  if (startPage > 1) {
    html += `<button class="pagination-btn pagination-page" onclick="goToPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
  }
  
  // Page numbers
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn pagination-page ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }
  
  // Last page + ellipsis
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
    html += `<button class="pagination-btn pagination-page" onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }
  
  html += '</div>';
  
  // Next button
  html += `<button class="pagination-btn pagination-next ${currentPage === totalPages ? 'disabled' : ''}" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">
    <span class="material-symbols-outlined">chevron_right</span>
  </button>`;
  
  paginationContainer.innerHTML = html;
}

function goToPage(page) {
  const totalPages = Math.ceil(totalFilteredEvents / EVENTS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  
  currentPage = page;
  loadTables(true);
  
  // Scroll to top of table
  const tableWrapper = document.querySelector('.events-table-wrapper');
  if (tableWrapper) {
    tableWrapper.scrollTop = 0;
  }
}

// Reset page when filters change
function resetPagination() {
  currentPage = 1;
}

window.goToPage = goToPage;
window.renderPagination = renderPagination;
window.resetPagination = resetPagination;

// Exposing the loadTables function to the global scope for Socket.IO updates
window.loadTables = loadTables;

// Setup Socket.IO event listeners for real-time updates
function setupSocketListeners(retryCount = 0) {
  const maxRetries = 10;
  
  if (!window.socket) {
    if (retryCount < maxRetries) {
      // Retry after a short delay - Socket.IO may still be loading
      setTimeout(() => setupSocketListeners(retryCount + 1), 200);
      return;
    }
    console.warn('Socket.IO not available after retries, real-time updates disabled');
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
  
  const companyLine = table.general?.company ? `Company: ${table.general.company}` : '';
  const clientLine = table.general?.client ? `Client: ${table.general.client}` : '';
  const companyClientDesc = [companyLine, clientLine].filter(Boolean).join('\n');
  
  // Prepare event data for full event
  const fullEventData = [{
    title: table.title || 'Event',
    startDate: table.general?.start || new Date(),
    endDate: table.general?.end || new Date(),
    location: table.general?.location || '',
    description: companyClientDesc
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
      description: [`Role: ${userRole}`, companyClientDesc].filter(Boolean).join('\n')
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

// ========================================
// CLIENT FILTERING FUNCTIONALITY
// ========================================

function filterByClient(clientName) {
  console.log('Filtering by client:', clientName);
  
  if (!clientName) {
    // Clear filter if no client name provided
    clientFilter = null;
  } else {
    clientFilter = clientName;
  }
  
  // Update UI to show active filter
  updateClientFilterDisplay();
  
  // Reload events with filter applied
  loadTables();
}

function clearClientFilter() {
  clientFilter = null;
  updateClientFilterDisplay();
  loadTables();
}

function updateClientFilterDisplay() {
  const headerFilters = document.querySelector('.events-filters');
  if (!headerFilters) return;
  
  // Remove existing client filter badge if any
  const existingBadge = document.getElementById('clientFilterBadge');
  if (existingBadge) {
    existingBadge.remove();
  }
  
  // Add new badge if filter is active
  if (clientFilter) {
    const badge = document.createElement('div');
    badge.id = 'clientFilterBadge';
    badge.className = 'filter-badge';
    badge.innerHTML = `
      <span class="material-symbols-outlined">business</span>
      <span>${clientFilter}</span>
      <button onclick="clearClientFilter(); event.stopPropagation();" title="Clear client filter">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;
    
    // Insert before the create event button
    const createBtn = document.getElementById('createEventBtn');
    if (createBtn) {
      headerFilters.insertBefore(badge, createBtn);
    } else {
      headerFilters.appendChild(badge);
    }
  }
}

// Make functions globally available
window.filterByClient = filterByClient;
window.clearClientFilter = clearClientFilter;

})();

