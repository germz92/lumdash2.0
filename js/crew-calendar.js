(function() {
  'use strict';

  // Check authentication
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Not logged in');
    window.location.href = '../index.html';
    return;
  }

  // Check if user is admin
  function checkAdminRole() {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role !== 'admin') {
        alert('Admin privileges required to access Crew Calendar');
        window.location.href = '../dashboard.html#events';
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error checking admin role:', err);
      return false;
    }
  }

  if (!checkAdminRole()) {
    return;
  }

  // State
  let currentWeekStart = null; // Will be set to the start of current week (Sunday)
  let crewData = null;
  let eventColors = {}; // Map of event IDs to colors

  // Generate a consistent color from a string (event ID)
  // Uses HSL color space for better color distribution
  function generateColorFromId(id) {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Convert hash to hue (0-360)
    const hue = Math.abs(hash % 360);
    
    // Use varying saturation and lightness for better distinction
    const saturation = 65 + (Math.abs(hash >> 8) % 20); // 65-85%
    const lightness = 88 + (Math.abs(hash >> 16) % 8); // 88-96% (light backgrounds)
    
    // Generate colors
    const bgColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    const borderColor = `hsl(${hue}, ${saturation}%, ${lightness - 35}%)`; // Darker for border
    const textColor = `hsl(${hue}, ${Math.min(saturation + 10, 100)}%, ${Math.max(lightness - 70, 15)}%)`; // Much darker for text
    
    return {
      bg: bgColor,
      border: borderColor,
      text: textColor
    };
  }

  // Save current week to localStorage
  function saveWeekPosition() {
    try {
      localStorage.setItem('crewCalendar_lastWeek', currentWeekStart.toISOString());
    } catch (e) {
      console.warn('Failed to save week position:', e);
    }
  }

  // Load last viewed week from localStorage
  function loadWeekPosition() {
    try {
      const saved = localStorage.getItem('crewCalendar_lastWeek');
      if (saved) {
        const savedDate = new Date(saved);
        // Validate the date is reasonable (not too far in past/future)
        const now = new Date();
        const daysDiff = Math.abs((savedDate - now) / (1000 * 60 * 60 * 24));
        
        // If saved date is within 1 year, use it
        if (daysDiff < 365) {
          return getWeekStart(savedDate);
        }
      }
    } catch (e) {
      console.warn('Failed to load week position:', e);
    }
    
    // Default to current week
    return getWeekStart(new Date());
  }

  // Initialize
  function init() {
    // Load saved week position or default to current week
    currentWeekStart = loadWeekPosition();
    
    setupEventListeners();
    loadCrewData();
  }

  // Get the start of the week (Sunday) for a given date
  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const diff = day; // Days to subtract to get to Sunday
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Format date as YYYY-MM-DD
  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Format date for display (e.g., "Jan 15, 2025")
  function formatDateDisplay(date) {
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  }

  // Get array of 7 dates starting from currentWeekStart
  function getWeekDates() {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }
    return dates;
  }

  // Update week range display
  function updateWeekDisplay() {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const startStr = formatDateDisplay(currentWeekStart);
    const endStr = formatDateDisplay(weekEnd);
    
    document.getElementById('currentWeekRange').textContent = `${startStr} - ${endStr}`;
  }

  // Setup event listeners
  function setupEventListeners() {
    document.getElementById('prevWeekBtn').addEventListener('click', () => {
      currentWeekStart.setDate(currentWeekStart.getDate() - 7);
      saveWeekPosition();
      renderCalendar();
    });

    document.getElementById('nextWeekBtn').addEventListener('click', () => {
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      saveWeekPosition();
      renderCalendar();
    });

    document.getElementById('todayBtn').addEventListener('click', () => {
      currentWeekStart = getWeekStart(new Date());
      saveWeekPosition();
      renderCalendar();
    });

    document.getElementById('weekPicker').addEventListener('change', (e) => {
      if (e.target.value) {
        const selectedDate = new Date(e.target.value + 'T12:00:00');
        currentWeekStart = getWeekStart(selectedDate);
        saveWeekPosition();
        renderCalendar();
      }
    });
  }

  // Load crew data from API
  async function loadCrewData() {
    showLoading();
    
    try {
      const response = await fetch(`${API_BASE}/api/crew-calendar`, {
        headers: { 
          'Authorization': token 
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch crew calendar data');
      }

      const data = await response.json();
      crewData = data.events;
      
      // Assign colors to events
      assignEventColors();
      
      renderCalendar();
    } catch (error) {
      console.error('Error loading crew data:', error);
      alert('Failed to load crew calendar data');
      hideLoading();
    }
  }

  // Assign colors to events using hash-based generation
  function assignEventColors() {
    crewData.forEach((event) => {
      eventColors[event._id] = generateColorFromId(event._id);
    });
  }

  // Show loading indicator
  function showLoading() {
    document.getElementById('loadingIndicator').style.display = 'block';
    document.getElementById('calendarGrid').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
  }

  // Hide loading indicator
  function hideLoading() {
    document.getElementById('loadingIndicator').style.display = 'none';
  }

  // Render the calendar
  function renderCalendar() {
    updateWeekDisplay();
    
    const weekDates = getWeekDates();
    const calendarGrid = document.getElementById('calendarGrid');
    const today = formatDate(new Date());
    
    // Clear existing content
    calendarGrid.innerHTML = '';
    
    let hasAnyCrew = false;
    
    // Create a column for each day
    weekDates.forEach((date) => {
      const dateStr = formatDate(date);
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNumber = date.getDate();
      const isToday = dateStr === today;
      
      // Get crew for this date
      const crewForDay = getCrewForDate(dateStr);
      
      if (crewForDay.length > 0) {
        hasAnyCrew = true;
      }
      
      // Create day column
      const dayColumn = document.createElement('div');
      dayColumn.className = 'day-column';
      
      // Day header
      const dayHeader = document.createElement('div');
      dayHeader.className = `day-header${isToday ? ' today' : ''}`;
      dayHeader.innerHTML = `
        <div class="day-name">${dayName}</div>
        <div class="day-date">${dayNumber}</div>
      `;
      dayColumn.appendChild(dayHeader);
      
      // Day content
      const dayContent = document.createElement('div');
      dayContent.className = 'day-content';
      
      if (crewForDay.length === 0) {
        dayContent.innerHTML = '<div class="no-crew">No assignments</div>';
      } else {
        crewForDay.forEach(eventGroup => {
          const eventGroupDiv = createEventGroupElement(eventGroup);
          dayContent.appendChild(eventGroupDiv);
        });
      }
      
      dayColumn.appendChild(dayContent);
      calendarGrid.appendChild(dayColumn);
    });
    
    // Show/hide empty state
    if (hasAnyCrew) {
      calendarGrid.style.display = 'grid';
      document.getElementById('emptyState').style.display = 'none';
    } else {
      calendarGrid.style.display = 'none';
      document.getElementById('emptyState').style.display = 'block';
    }
    
    hideLoading();
  }

  // Get crew assignments for a specific date, grouped by event
  function getCrewForDate(dateStr) {
    const result = [];
    
    crewData.forEach(event => {
      const crewMembers = event.crew.filter(crew => crew.date === dateStr);
      
      if (crewMembers.length > 0) {
        result.push({
          eventId: event._id,
          eventTitle: event.title,
          archived: event.archived,
          crew: crewMembers
        });
      }
    });
    
    return result;
  }

  // Create event group element
  function createEventGroupElement(eventGroup) {
    const colors = eventColors[eventGroup.eventId];
    
    const div = document.createElement('div');
    div.className = 'event-group';
    div.style.backgroundColor = colors.bg;
    div.style.borderLeftColor = colors.border;
    div.style.cursor = 'pointer';
    div.title = `Click to view ${eventGroup.eventTitle} crew page`;
    
    // Add click handler to open crew page
    div.addEventListener('click', () => {
      window.location.href = `../dashboard.html?id=${eventGroup.eventId}#crew`;
    });
    
    // Event title with icon and archived badge
    const titleDiv = document.createElement('div');
    titleDiv.className = 'event-title';
    titleDiv.style.color = colors.text;
    titleDiv.innerHTML = `
      <span class="material-symbols-outlined">event</span>
      <span>${eventGroup.eventTitle}</span>
      ${eventGroup.archived ? '<span class="archived-badge">ARCHIVED</span>' : ''}
    `;
    div.appendChild(titleDiv);
    
    // Crew members
    eventGroup.crew.forEach(crew => {
      const crewDiv = document.createElement('div');
      crewDiv.className = 'crew-member';
      crewDiv.innerHTML = `
        <span class="material-symbols-outlined">person</span>
        <span class="crew-name">${crew.name}</span>
        <span class="crew-role">• ${crew.role}</span>
      `;
      div.appendChild(crewDiv);
    });
    
    return div;
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

