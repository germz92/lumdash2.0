(function() {
const token = localStorage.getItem('token');
if (!token && !window.location.pathname.endsWith('index.html')) {
  alert('Not logged in');
  window.location.href = 'index.html';
}

let currentTableId = null;
let showArchived = false;
let searchEventsValue = '';
let timeFilter = 'upcoming'; // 'all', 'upcoming', or 'past' - default to upcoming
let allUsers = [];
let selectedUsers = [];

function getUserIdFromToken() {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const payload = JSON.parse(atob(token.split('.')[1]));
  return payload.id;
}

function showCreateModal() {
  const modal = document.getElementById('createModal');
  if (modal) {
    // Move modal to body to escape page-container stacking context
    if (modal.parentElement && modal.parentElement.id === 'page-container') {
      console.log('[CREATE_MODAL] Moving modal from page-container to body');
      document.body.appendChild(modal);
    }
    
    // Force display and ensure visibility
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    modal.style.zIndex = '10000';
    modal.style.position = 'fixed';
    modal.style.inset = '0';
    
    // Add click-outside functionality
    setTimeout(() => {
      modal.addEventListener('click', handleCreateModalClick);
    }, 0);
  }
}

function hideCreateModal() {
  const modal = document.getElementById('createModal');
  if (modal) {
    modal.style.display = 'none';
    // Remove click-outside event listener
    modal.removeEventListener('click', handleCreateModalClick);
  }
}

async function submitCreate() {
  const title = document.getElementById('newTitle')?.value;
  const client = document.getElementById('newClient')?.value;
  const startDate = document.getElementById('newStart')?.value;
  const endDate = document.getElementById('newEnd')?.value;

  if (!title || !startDate || !endDate) {
    alert("Please fill out all fields.");
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

  const res = await fetch(`${API_BASE}/api/tables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token
    },
    body: JSON.stringify({
      title,
      general: { client, start, end }
    })
  });

  await res.json();
  hideCreateModal();
  loadTables();
}

async function loadTables() {
  const res = await fetch(`${API_BASE}/api/tables`, {
    headers: { Authorization: token }
  });

  const tables = await res.json();
  const userId = getUserIdFromToken();

  // Filter tables based on user-specific archived status
  let filteredTables = tables.filter(table => !!table.userArchived === showArchived);

  // Apply time filter (All, Upcoming, Past)
  if (timeFilter !== 'all') {
    // Get today's date in local timezone (without time component)
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    filteredTables = filteredTables.filter(table => {
      const general = table.general || {};
      
      // Handle events without dates
      if (!general.start && !general.end) return timeFilter === 'upcoming';
      if (!general.end) return timeFilter === 'upcoming';
      
      // Extract date strings (YYYY-MM-DD) to avoid timezone issues
      const startDateStr = general.start ? general.start.split('T')[0] : null;
      const endDateStr = general.end.split('T')[0];
      
      if (timeFilter === 'upcoming') {
        // Upcoming: includes active events (start <= today <= end) OR future events (start > today)
        // This means: end date must be >= today (event is still ongoing or in the future)
        return endDateStr >= todayStr;
      } else if (timeFilter === 'past') {
        // Past: end date is before today
        return endDateStr < todayStr;
      }
      return true;
    });
  }

  // Filter by search box
  if (searchEventsValue) {
    const q = searchEventsValue.toLowerCase();
    filteredTables = filteredTables.filter(table => {
      const title = (table.title || '').toLowerCase();
      const client = (table.general?.client || '').toLowerCase();
      return title.includes(q) || client.includes(q);
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
  
  // Build location from city and state
  let location = null;
  if (general.city && general.state) {
    location = `${general.city}, ${general.state}`;
  } else if (general.city) {
    location = general.city;
  } else if (general.state) {
    location = general.state;
  }
  
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
  // Build details HTML with location if available
  let detailsHTML = `Client: ${client}`;
  if (location) {
    detailsHTML += ` <br> 📍 ${location}`;
  }
  detailsHTML += ` <br> ${start} - ${end}`;
  details.innerHTML = detailsHTML;
  
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
    const confirmMessage = table.userArchived 
      ? 'Are you sure you want to unarchive this event for yourself?' 
      : 'Are you sure you want to archive this event for yourself?';
    
    if (confirm(confirmMessage)) {
      await fetch(`${API_BASE}/api/tables/${table._id}/user-archive`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ archive: !table.userArchived })
      });
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
    if (confirm('Are you sure you want to delete this event?\n\nThis will also release all gear items reserved for this event back to inventory.')) {
      try {
        const response = await fetch(`${API_BASE}/api/tables/${table._id}`, {
          method: 'DELETE',
          headers: { Authorization: token }
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.message) {
            alert(`Event deleted successfully!\n${result.message}`);
          }
        } else {
          const error = await response.json();
          alert(`Error deleting event: ${error.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error('Error deleting event:', err);
        alert('Error deleting event. Please try again.');
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
    
    // Build location from city and state
    let location = null;
    if (general.city && general.state) {
      location = `${general.city}, ${general.state}`;
    } else if (general.city) {
      location = general.city;
    } else if (general.state) {
      location = general.state;
    }
    
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
      location: location,
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
        // Add location to tooltip if available
        pill.title = ev.location ? `${ev.title}\n📍 ${ev.location}` : ev.title;
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
      alert('Not authorized. Only owners can share events.');
      return;
    }
    
    // If owner, proceed with opening the share modal
    currentTableId = tableId;
    const shareModal = document.getElementById('shareModal');
    console.log('[SHARE_MODAL] Found shareModal element:', !!shareModal);
    
    if (!shareModal) {
      console.error('[SHARE_MODAL] shareModal element not found in DOM!');
      alert('Error: Share modal not found. Please refresh the page.');
      return;
    }
    
    if (shareModal) {
      // Move modal to body to escape page-container stacking context
      if (shareModal.parentElement && shareModal.parentElement.id === 'page-container') {
        console.log('[SHARE_MODAL] Moving modal from page-container to body');
        document.body.appendChild(shareModal);
      }
      
      // Force display and ensure visibility
      shareModal.style.display = 'flex';
      shareModal.style.visibility = 'visible';
      shareModal.style.opacity = '1';
      shareModal.style.zIndex = '10000';
      shareModal.style.position = 'fixed';
      shareModal.style.inset = '0';
      console.log('[SHARE_MODAL] Modal display set to flex and moved to body');
      
      // Add click-outside functionality
      setTimeout(() => {
        shareModal.addEventListener('click', handleModalClick);
      }, 0);
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

    // Helper to render user with action buttons (no badges)
    function renderUser(user, isOwnerList) {
      const name = user.name || user.fullName || user.email;
      const email = user.email;
      // Action buttons (only if current user is owner and not self)
      let actions = '';
      const currentUserId = getUserIdFromToken && getUserIdFromToken();
      const isSelf = user._id === currentUserId;
      if (isOwner) {
        if (!isOwnerUser(user)) {
          actions += `<button class=\"make-owner-btn\" data-email=\"${email}\" style=\"width:60px;min-width:60px;max-width:60px;margin-left:6px;padding:1px 0;font-size:12px;border-radius:4px;background:#CC0007;color:#fff;border:none;cursor:pointer;line-height:1.1;vertical-align:middle;\">Owner</button>`;
        }
        if (!isLead(user)) {
          actions += `<button class=\"make-lead-btn\" data-email=\"${email}\" style=\"width:60px;min-width:60px;max-width:60px;margin-left:3px;padding:1px 0;font-size:12px;border-radius:4px;background:#ff9800;color:#fff;border:none;cursor:pointer;line-height:1.1;vertical-align:middle;\">Lead</button>`;
        }
        // Add Unshare button (not for self, and not for owners in owner list)
        if (!isSelf && (!isOwnerList || !isOwnerUser(user))) {
          actions += `<button class=\"unshare-btn\" data-email=\"${email}\" title=\"Remove from event\" style=\"width:28px;min-width:28px;max-width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;margin-left:3px;padding:0;font-size:18px;border-radius:50%;background:#eee;color:#CC0007;border:none;cursor:pointer;line-height:1;vertical-align:middle;transition:background 0.15s;\">&#10005;</button>`;
        }
      }
      return `<li style=\"display:flex;align-items:center;justify-content:space-between;min-height:28px;width:100%;padding:2px 0;word-break:break-all;\"><span style=\"display:block;overflow-wrap:break-word;word-break:break-all;flex:1 1 0;\">${name} (${email})</span> <span style=\"display:flex;gap:3px;min-width:190px;justify-content:flex-end;\">${actions}</span></li>`;
    }

    if (ownerList) ownerList.innerHTML = owners.map(u => renderUser(u, true)).join('');
    if (leadList) leadList.innerHTML = leads.map(u => renderUser(u, false)).join('');
    if (sharedList) sharedList.innerHTML = shared.map(u => renderUser(u, false)).join('');

    // Make the lists scrollable if long, no horizontal scroll
    if (ownerList) {
      ownerList.parentElement.style.maxHeight = '220px';
      ownerList.parentElement.style.overflowY = 'auto';
      ownerList.parentElement.style.overflowX = 'hidden';
    }
    if (leadList) {
      leadList.parentElement.style.maxHeight = '220px';
      leadList.parentElement.style.overflowY = 'auto';
      leadList.parentElement.style.overflowX = 'hidden';
    }
    if (sharedList) {
      sharedList.parentElement.style.maxHeight = '220px';
      sharedList.parentElement.style.overflowY = 'auto';
      sharedList.parentElement.style.overflowX = 'hidden';
    }

    // Add event listeners for the new buttons
    function addRoleButtonListeners() {
      document.querySelectorAll('.make-lead-btn').forEach(btn => {
        btn.onclick = async function() {
          const email = btn.getAttribute('data-email');
          if (confirm('Are you sure you want to make this user a lead?')) {
            await submitRoleChange(email, false, true);
          }
        };
      });
      document.querySelectorAll('.make-owner-btn').forEach(btn => {
        btn.onclick = async function() {
          const email = btn.getAttribute('data-email');
          if (confirm('Are you sure you want to make this user an owner? This will give them full control of the event, including deletion.')) {
            await submitRoleChange(email, true, false);
          }
        };
      });
      document.querySelectorAll('.unshare-btn').forEach(btn => {
        btn.onclick = async function() {
          const email = btn.getAttribute('data-email');
          if (confirm('Are you sure you want to remove this user from the event?')) {
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
          // Refresh the modal
          await openShareModal(currentTableId);
        } else {
          alert(result.error || 'Error updating role');
        }
      } catch (err) {
        alert('Failed to update role. Please try again.');
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
          await openShareModal(currentTableId);
        } else {
          alert(result.error || 'Error removing user');
        }
      } catch (err) {
        alert('Failed to remove user. Please try again.');
      }
    }
  } catch (err) {
    console.error('Error in share modal:', err);
    alert('Error opening share options. Please try again.');
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
    const suggestions = suggestionsContainer.querySelectorAll('.user-suggestion');
    const active = suggestionsContainer.querySelector('.suggestion-active');
    
    let newIndex = 0;
    if (active) {
      const currentIndex = Array.from(suggestions).indexOf(active);
      newIndex = currentIndex + direction;
    }
    
    if (newIndex < 0) newIndex = suggestions.length - 1;
    if (newIndex >= suggestions.length) newIndex = 0;
    
    suggestions.forEach(s => {
      s.classList.remove('suggestion-active');
      s.style.backgroundColor = 'white';
    });
    if (suggestions[newIndex]) {
      suggestions[newIndex].classList.add('suggestion-active');
      suggestions[newIndex].style.backgroundColor = '#e3f2fd';
    }
  }
  
  function showSuggestions(users) {
    if (users.length === 0) {
      hideSuggestions();
      return;
    }
    
    suggestionsContainer.innerHTML = users.map(user => {
      const name = user.name || user.fullName || user.email;
      const email = user.email;
      return `
        <div class="user-suggestion" data-user-id="${user._id}" style="
          padding: 8px 12px; 
          cursor: pointer; 
          border-bottom: 1px solid #eee; 
          display: flex; 
          justify-content: space-between; 
          align-items: center;
          transition: background-color 0.15s;
        ">
          <div>
            <div style="font-weight: 500;">${name}</div>
            <div style="font-size: 0.85em; color: #666;">${email}</div>
          </div>
        </div>
      `;
    }).join('');
    
    // Add click handlers for suggestions
    suggestionsContainer.querySelectorAll('.user-suggestion').forEach(suggestion => {
      suggestion.addEventListener('mouseenter', () => {
        suggestionsContainer.querySelectorAll('.user-suggestion').forEach(s => {
          s.classList.remove('suggestion-active');
          s.style.backgroundColor = 'white';
        });
        suggestion.classList.add('suggestion-active');
        suggestion.style.backgroundColor = '#e3f2fd';
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
    
    suggestionsContainer.style.display = 'block';
  }
  
  function hideSuggestions() {
    setTimeout(() => {
      suggestionsContainer.style.display = 'none';
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
        <div class="selected-user-tag" style="
          background: #f0f0f0; 
          border: 1px solid #ccc; 
          border-radius: 16px; 
          padding: 4px 8px; 
          display: flex; 
          align-items: center; 
          gap: 6px;
          font-size: 0.9em;
        ">
          <span>${name}</span>
          <button type="button" onclick="removeSelectedUserById('${user._id}')" style="
            background: none; 
            border: none; 
            color: #666; 
            cursor: pointer; 
            font-size: 16px; 
            line-height: 1; 
            padding: 0; 
            width: 18px; 
            height: 18px; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            border-radius: 50%;
          ">&times;</button>
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
  const modalContent = shareModal?.querySelector('.modal-content');
  
  // If click is on the modal backdrop (not the content), close the modal
  if (e.target === shareModal && !modalContent?.contains(e.target)) {
    closeModal();
  }
}

function handleCreateModalClick(e) {
  const createModal = document.getElementById('createModal');
  const modalContent = createModal?.querySelector('.modal-content');
  
  // If click is on the modal backdrop (not the content), close the modal
  if (e.target === createModal && !modalContent?.contains(e.target)) {
    hideCreateModal();
  }
}

function closeModal() {
  const shareModal = document.getElementById('shareModal');
  if (shareModal) {
    shareModal.style.display = 'none';
    // Remove click-outside event listener
    shareModal.removeEventListener('click', handleModalClick);
  }
  const shareEmail = document.getElementById('shareEmail');
  if (shareEmail) shareEmail.value = '';
  
  // Clear selected users
  selectedUsers = [];
  const selectedUsersContainer = document.getElementById('selectedUsersList');
  if (selectedUsersContainer) selectedUsersContainer.innerHTML = '';
  
  // Hide suggestions
  const suggestionsContainer = document.getElementById('userSuggestions');
  if (suggestionsContainer) suggestionsContainer.style.display = 'none';

  const ownerList = document.getElementById('ownerList')?.querySelector('ul');
  const leadList = document.getElementById('leadList')?.querySelector('ul');
  const sharedList = document.getElementById('sharedList')?.querySelector('ul');
  if (ownerList) ownerList.innerHTML = '';
  if (leadList) leadList.innerHTML = '';
  if (sharedList) sharedList.innerHTML = '';
}

async function submitShare() {
  if (!currentTableId) return alert('Missing event information');
  
  // Check if any users are selected
  if (selectedUsers.length === 0) {
    return alert('Please select at least one user to share with.');
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
    
    let message = `Successfully shared with ${successCount} user(s).`;
    
    if (failureCount > 0) {
      message += `\n\nFailed to share with ${failureCount} user(s):`;
      results.filter(r => !r.success).forEach(r => {
        message += `\n- ${r.user}: ${r.error}`;
      });
    }
    
    if (successCount > 0) {
      message += '\n\nEmail notifications have been sent to successfully shared users.';
    }
    
    alert(message);
    
    // Refresh the modal if any were successful
    if (successCount > 0) {
      await openShareModal(currentTableId);
    } else {
      closeModal();
    }
    
  } catch (err) {
    console.error('Error sharing event:', err);
    alert('Failed to share event. Please try again.');
    closeModal();
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
  // Set username display
  const fullName = localStorage.getItem('fullName') || 'User';
  const usernameDisplayEl = document.getElementById('usernameDisplay');
  if (usernameDisplayEl) usernameDisplayEl.textContent = `Welcome, ${fullName}`;

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
    
    // Add admin-user class to body for CSS targeting
    if (payload.role === 'admin') {
      document.body.classList.add('admin-user');
    } else {
      document.body.classList.remove('admin-user');
    }
    
    // Restructure top bar into two rows for ALL users
    const topBar = document.querySelector('.top-bar');
      const usernameDisplay = document.getElementById('usernameDisplay');
      const topBarIcons = document.querySelector('.top-bar-icons');
      
      if (topBar && usernameDisplay && topBarIcons) {
        // Check if rows already exist
        let topRow = topBar.querySelector('.top-bar-row.welcome-row');
        let buttonsRow = topBar.querySelector('.top-bar-row.admin-row');
        
        if (!topRow) {
          // Create top row for welcome + icons (timesheet, logout)
          topRow = document.createElement('div');
          topRow.className = 'top-bar-row welcome-row';
          
          // Move username and icons container to top row
          topBar.appendChild(topRow);
          topRow.appendChild(usernameDisplay);
          topRow.appendChild(topBarIcons);
        }
        
        if (!buttonsRow) {
          // Create buttons row for all utility buttons (available to all users)
          buttonsRow = document.createElement('div');
          buttonsRow.className = 'top-bar-row admin-row';
          buttonsRow.style.justifyContent = 'center';
          topBar.appendChild(buttonsRow);
        }
        
        // Create buttons container if it doesn't exist
        let adminButtonsContainer = document.getElementById('adminButtonsContainer');
        if (!adminButtonsContainer) {
          adminButtonsContainer = document.createElement('div');
          adminButtonsContainer.id = 'adminButtonsContainer';
          adminButtonsContainer.style.display = 'flex';
          adminButtonsContainer.style.gap = '8px';
          adminButtonsContainer.style.alignItems = 'center';
          adminButtonsContainer.style.flexWrap = 'wrap';
          adminButtonsContainer.style.justifyContent = 'center';
          buttonsRow.appendChild(adminButtonsContainer);
        }
        
        // Add Call Times button (available to ALL users)
        let callTimesBtn = document.getElementById('callTimesBtn');
        if (!callTimesBtn) {
          callTimesBtn = document.createElement('button');
          callTimesBtn.id = 'callTimesBtn';
          callTimesBtn.className = 'btn-call-times btn-outlined';
          callTimesBtn.style.display = 'flex';
          callTimesBtn.style.alignItems = 'center';
          callTimesBtn.style.gap = '8px';
          callTimesBtn.innerHTML = `
            <span class="material-symbols-outlined">schedule</span>
            Call Times
          `;
          callTimesBtn.onclick = () => {
            if (window.navigate) {
              window.navigate('call-times');
            }
          };
          adminButtonsContainer.appendChild(callTimesBtn);
        }
        
        // Add Flights button (available to ALL users)
        let flightsBtn = document.getElementById('flightsBtn');
        if (!flightsBtn) {
          flightsBtn = document.createElement('button');
          flightsBtn.id = 'flightsBtn';
          flightsBtn.className = 'btn-flights btn-outlined';
          flightsBtn.style.display = 'flex';
          flightsBtn.style.alignItems = 'center';
          flightsBtn.style.gap = '8px';
          flightsBtn.innerHTML = `
            <span class="material-symbols-outlined">flight_takeoff</span>
            Flights
          `;
          flightsBtn.onclick = () => {
            if (window.navigate) {
              window.navigate('flights');
            }
          };
          adminButtonsContainer.appendChild(flightsBtn);
        }
        
        // Add admin-only buttons if user is admin
        if (payload.role === 'admin') {
          // Add admin console button
          let adminBtn = document.getElementById('adminConsoleBtn');
          if (!adminBtn) {
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
          if (!inventoryBtn) {
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
          if (!crewPlannerBtn) {
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
          if (!crewCalendarBtn) {
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

  // Set up time filter dropdown
  const timeFilterDropdown = document.getElementById('timeFilterDropdown');
  if (timeFilterDropdown) {
    // Set to current value (default is 'upcoming')
    timeFilterDropdown.value = timeFilter;
    timeFilterDropdown.addEventListener('change', () => {
      timeFilter = timeFilterDropdown.value;
      loadTables();
    });
  }

  // Set up logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;

  // Set up timesheet button
  const timesheetBtn = document.getElementById('timesheetBtn');
  if (timesheetBtn) {
    timesheetBtn.onclick = () => {
      if (window.navigate) {
        window.navigate('timesheet');
      }
    };
  }

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
      console.log(`${eventName} event received, reloading tables`);
      loadTables();
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
