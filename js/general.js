(function() {
// ✅ Avoid redeclaration across scripts
window.token = window.token || localStorage.getItem('token');
const params = new URLSearchParams(window.location.search);
let tableId = params.get('id') || localStorage.getItem('eventId');
let isOwner = false;
let clockInterval = null; // Global clock interval for time modal
let isSummaryExpanded = true; // Track Event Summary collapse state
let currentTableData = null; // Store table data for dark theme

// ========================================
// DARK THEME GENERAL PAGE FUNCTIONS
// ========================================

function isDarkTheme() {
  return document.querySelector('.dark-theme.general-page') !== null;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function formatDateRange(start, end) {
  if (!start) return 'Dates not set';
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : null;
  
  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = startDate.getDate();
  const startYear = startDate.getFullYear();
  
  if (!endDate) return `${startMonth} ${startDay}, ${startYear}`;
  
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
  const endDay = endDate.getDate();
  const endYear = endDate.getFullYear();
  
  if (startYear === endYear && startMonth === endMonth) {
    return `${startMonth} ${startDay} → ${endDay}, ${startYear}`;
  } else if (startYear === endYear) {
    return `${startMonth} ${startDay} → ${endMonth} ${endDay}, ${startYear}`;
  }
  return `${startMonth} ${startDay}, ${startYear} → ${endMonth} ${endDay}, ${endYear}`;
}

function formatCurrency(amount) {
  if (!amount) return '$0';
  const num = parseFloat(amount.toString().replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}

function formatNumber(num) {
  if (!num) return '0';
  const n = parseInt(num.toString().replace(/[^0-9]/g, ''));
  if (isNaN(n)) return '0';
  return new Intl.NumberFormat('en-US').format(n);
}

function getEventStatus(start, end) {
  if (!start) return 'upcoming';
  const now = new Date();
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : startDate;
  
  if (now < startDate) return 'upcoming';
  if (now > endDate) return 'past';
  return 'live';
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function renderDarkThemeHeader(table) {
  const general = table.general || {};
  
  // Event Title
  const titleEl = document.getElementById('eventTitle');
  if (titleEl) titleEl.textContent = table.title || 'Untitled Event';
  
  // Client (stored in general.client)
  const clientEl = document.getElementById('eventClient');
  if (clientEl) clientEl.textContent = general.client || 'No client';
  
  // Dates
  const datesEl = document.getElementById('eventDates');
  if (datesEl) datesEl.textContent = formatDateRange(general.start, general.end);
  
  // Location Header
  const locationEl = document.getElementById('eventLocationHeader');
  if (locationEl) {
    const city = general.city || '';
    const state = general.state || '';
    locationEl.textContent = city && state ? `${city}, ${state}` : (general.location || 'Location TBD');
  }
  
  // Status Badge
  const statusBadge = document.getElementById('eventStatusBadge');
  if (statusBadge) {
    const status = getEventStatus(general.start, general.end);
    statusBadge.className = `event-status-badge ${status}`;
    statusBadge.innerHTML = `<span class="status-dot"></span><span>${status.toUpperCase()}</span>`;
  }
}

function renderDarkThemeSummary(table) {
  const general = table.general || {};
  
  // Notes/Summary (only notes in this card now)
  const notesEl = document.getElementById('summaryNotes');
  if (notesEl) {
    const summary = general.summary || '';
    if (summary) {
      // Display rich HTML content with URL linkification
      if (summary.includes('<') && summary.includes('>')) {
        notesEl.innerHTML = linkifyText(summary);
      } else {
        // Plain text - preserve line breaks
        notesEl.innerHTML = `<p>${linkifyText(summary).replace(/\n/g, '<br>')}</p>`;
      }
      notesEl.classList.remove('empty');
    } else {
      notesEl.innerHTML = '<p class="empty-notes">No notes added yet. Click edit to add notes.</p>';
      notesEl.classList.add('empty');
    }
  }
  
  // Event Info Card - Client and Location
  const clientEl = document.getElementById('summaryClient');
  if (clientEl) clientEl.textContent = general.client || 'No client';
  
  const cityEl = document.getElementById('summaryCity');
  const venueEl = document.getElementById('summaryVenue');
  if (cityEl) cityEl.textContent = general.city || 'City TBD';
  if (venueEl) venueEl.textContent = general.location || 'Venue TBD';
}

function renderDarkThemeStats(table) {
  const general = table.general || {};
  
  // Start Date
  const startEl = document.getElementById('statStartDate');
  if (startEl) startEl.textContent = formatDate(general.start);
  
  // End Date
  const endEl = document.getElementById('statEndDate');
  if (endEl) endEl.textContent = formatDate(general.end);
  
  // Budget
  const budgetEl = document.getElementById('statBudget');
  if (budgetEl) budgetEl.textContent = formatCurrency(general.budget);
  
  // Attendees
  const attendeesEl = document.getElementById('statAttendees');
  if (attendeesEl) attendeesEl.textContent = formatNumber(general.attendees);
}

function renderDarkThemeContacts(contacts) {
  const grid = document.getElementById('contactsGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (!contacts || contacts.length === 0) {
    grid.innerHTML = '<div class="empty-state">No contacts added yet</div>';
    return;
  }
  
  contacts.forEach((contact, index) => {
    const card = document.createElement('div');
    card.className = 'contact-card clickable';
    card.dataset.contactIndex = index;
    card.innerHTML = `
      <div class="contact-avatar initials">${getInitials(contact.name)}</div>
      <div class="contact-info">
        <div class="contact-name">${contact.name || 'Unknown'}</div>
        <div class="contact-role">${contact.role || 'No role specified'}</div>
        <div class="contact-details">
          ${contact.number ? `<div class="contact-detail"><span class="material-symbols-outlined">call</span><span>${contact.number}</span></div>` : ''}
          ${contact.email ? `<div class="contact-detail"><span class="material-symbols-outlined">mail</span><span>${contact.email}</span></div>` : ''}
        </div>
      </div>
    `;
    
    // Click handler to edit contact
    card.addEventListener('click', (e) => {
      // Prevent opening modal when clicking action buttons
      if (e.target.closest('.contact-action-btn')) return;
      openEditContactModal(index);
    });
    
    grid.appendChild(card);
  });
}

function renderDarkThemeLocations(locations) {
  const list = document.getElementById('locationsList');
  if (!list) return;
  
  list.innerHTML = '';
  
  if (!locations || locations.length === 0) {
    list.innerHTML = '<div class="empty-state">No locations added yet</div>';
    return;
  }
  
  locations.forEach((loc, index) => {
    const item = document.createElement('div');
    item.className = 'location-item clickable';
    item.dataset.locationIndex = index;
    
    const addressLink = loc.address ? 
      `https://www.google.com/maps/search/?q=${encodeURIComponent(loc.address)}` : '#';
    
    item.innerHTML = `
      <div class="location-icon">
        <span class="material-symbols-outlined">place</span>
      </div>
      <div class="location-info">
        <div class="location-name">${loc.name || 'Unnamed Location'}</div>
        <div class="location-address">${loc.address || 'No address'}</div>
      </div>
      <div class="location-actions">
        <button class="location-action-btn open-maps-btn" title="Open in Maps">
          <span class="material-symbols-outlined">open_in_new</span>
        </button>
      </div>
      ${loc.event ? `<div class="location-event-badge">${loc.event}</div>` : ''}
    `;
    
    // Click handler to edit location
    item.addEventListener('click', (e) => {
      // Prevent opening modal when clicking the maps button
      if (e.target.closest('.open-maps-btn')) {
        window.open(addressLink, '_blank');
        return;
      }
      openEditLocationModal(index);
    });
    
    list.appendChild(item);
  });
}

async function fetchWeatherForEvent(city, startDate, endDate) {
  const forecastEl = document.getElementById('weatherForecast');
  const conditionEl = document.getElementById('weatherCondition');
  
  if (!forecastEl || !city) {
    renderWeatherPlaceholder('No city set');
    return;
  }
  
  // Show loading state
  forecastEl.innerHTML = `
    <div class="weather-loading">
      <span class="material-symbols-outlined spinning">sync</span>
      <span>Loading weather...</span>
    </div>
  `;
  if (conditionEl) conditionEl.textContent = 'Loading...';
  
  try {
    // Use OpenWeatherMap free API (user needs to set their API key)
    const apiKey = window.OPENWEATHER_API_KEY || localStorage.getItem('openweather_api_key');
    
    if (!apiKey) {
      renderWeatherPlaceholder('API key needed');
      return;
    }
    
    // Get coordinates for the city
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`;
    const geoRes = await fetch(geoUrl);
    
    // Check for API errors
    if (geoRes.status === 401) {
      console.error('OpenWeatherMap API key invalid or not yet activated (can take up to 2 hours)');
      renderWeatherPlaceholder('API key activating...');
      return;
    }
    
    if (!geoRes.ok) {
      console.error('Weather geo API error:', geoRes.status);
      renderWeatherPlaceholder('Weather unavailable');
      return;
    }
    
    const geoData = await geoRes.json();
    
    if (!geoData || geoData.length === 0) {
      renderWeatherPlaceholder('City not found');
      return;
    }
    
    const { lat, lon } = geoData[0];
    
    // Get 5-day forecast
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`;
    const forecastRes = await fetch(forecastUrl);
    const forecastData = await forecastRes.json();
    
    if (!forecastData || !forecastData.list) {
      renderWeatherPlaceholder('Weather unavailable');
      return;
    }
    
    // Check if event dates are valid for weather lookup
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Safely parse event dates
    let eventStartDate = null;
    let eventEndDate = null;
    
    try {
      if (startDate && startDate.trim()) {
        const startStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
        eventStartDate = new Date(startStr + 'T00:00:00');
        if (isNaN(eventStartDate.getTime())) eventStartDate = null;
      }
      if (endDate && endDate.trim()) {
        const endStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;
        eventEndDate = new Date(endStr + 'T23:59:59');
        if (isNaN(eventEndDate.getTime())) eventEndDate = null;
      }
      if (eventStartDate && !eventEndDate) {
        eventEndDate = new Date(eventStartDate);
        eventEndDate.setHours(23, 59, 59);
      }
    } catch (e) {
      console.warn('Error parsing event dates for weather:', e);
    }
    
    // Check if event is in the past
    if (eventEndDate && eventEndDate < today) {
      renderWeatherPlaceholder('Event has passed');
      return;
    }
    
    // Check if event is too far in the future (beyond 5 days)
    // Weather APIs typically provide 5-day forecasts
    const forecastDays = 5;
    const forecastLimit = new Date(today);
    forecastLimit.setDate(forecastLimit.getDate() + forecastDays);
    
    if (eventStartDate && eventStartDate > forecastLimit) {
      const daysUntilEvent = Math.ceil((eventStartDate - today) / (1000 * 60 * 60 * 24));
      const daysUntilAvailable = daysUntilEvent - forecastDays;
      
      if (daysUntilAvailable <= 0) {
        // Should be available now, try to fetch anyway
      } else if (daysUntilAvailable === 1) {
        renderWeatherPlaceholder('Available tomorrow');
        return;
      } else {
        renderWeatherPlaceholder(`Available in ${daysUntilAvailable} days`);
        return;
      }
    }
    
    // Process forecast data - group by day and filter to event dates
    const dailyForecasts = processForecastData(forecastData.list, startDate, endDate);
    
    if (dailyForecasts.length === 0) {
      // If no event dates set, show next few days
      if (!eventStartDate) {
        const allForecasts = processForecastData(forecastData.list, null, null);
        renderWeatherForecast(allForecasts, conditionEl);
        return;
      }
      renderWeatherPlaceholder('No forecast for event dates');
      return;
    }
    
    renderWeatherForecast(dailyForecasts, conditionEl);
    
  } catch (err) {
    console.error('Weather fetch error:', err);
    renderWeatherPlaceholder('Weather unavailable');
  }
}

function processForecastData(forecastList, eventStart, eventEnd) {
  const dailyData = {};
  
  // Parse event dates safely
  let eventStartDate = null;
  let eventEndDate = null;
  let eventStartKey = null;
  let eventEndKey = null;
  
  try {
    if (eventStart && eventStart.trim()) {
      // Handle both ISO format and date-only format
      const startStr = eventStart.includes('T') ? eventStart.split('T')[0] : eventStart;
      eventStartDate = new Date(startStr + 'T00:00:00');
      if (!isNaN(eventStartDate.getTime())) {
        eventStartKey = startStr;
      } else {
        eventStartDate = null;
      }
    }
    
    if (eventEnd && eventEnd.trim()) {
      const endStr = eventEnd.includes('T') ? eventEnd.split('T')[0] : eventEnd;
      eventEndDate = new Date(endStr + 'T23:59:59');
      if (!isNaN(eventEndDate.getTime())) {
        eventEndKey = endStr;
      } else {
        eventEndDate = null;
      }
    }
    
    // If we have start but no end, use start as end
    if (eventStartDate && !eventEndDate) {
      eventEndDate = eventStartDate;
      eventEndKey = eventStartKey;
    }
  } catch (e) {
    console.warn('Error parsing event dates:', e);
  }
  
  // Group forecasts by day
  forecastList.forEach(item => {
    const date = new Date(item.dt * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    
    if (!dailyData[dateKey]) {
      dailyData[dateKey] = {
        date: date,
        dateKey: dateKey,
        temps: [],
        icons: [],
        descriptions: []
      };
    }
    
    dailyData[dateKey].temps.push(item.main.temp);
    dailyData[dateKey].icons.push(item.weather[0].icon);
    dailyData[dateKey].descriptions.push(item.weather[0].main);
  });
  
  // Convert to array and calculate high/low
  let days = Object.keys(dailyData).sort().map(key => {
    const day = dailyData[key];
    const high = Math.round(Math.max(...day.temps));
    const low = Math.round(Math.min(...day.temps));
    const mostCommonIcon = getMostCommon(day.icons);
    const mostCommonDesc = getMostCommon(day.descriptions);
    
    return {
      date: day.date,
      dateKey: day.dateKey,
      high,
      low,
      icon: mostCommonIcon,
      description: mostCommonDesc
    };
  });
  
  // Filter to only show event dates if we have valid event dates
  if (eventStartKey && eventEndKey) {
    days = days.filter(day => {
      return day.dateKey >= eventStartKey && day.dateKey <= eventEndKey;
    });
  }
  
  // Limit to 5 days max
  return days.slice(0, 5);
}

function getMostCommon(arr) {
  const counts = {};
  arr.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function getWeatherEmoji(iconCode) {
  const iconMap = {
    '01d': '☀️', '01n': '🌙',
    '02d': '⛅', '02n': '☁️',
    '03d': '☁️', '03n': '☁️',
    '04d': '☁️', '04n': '☁️',
    '09d': '🌧️', '09n': '🌧️',
    '10d': '🌦️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️',
    '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️'
  };
  return iconMap[iconCode] || '🌤️';
}

function formatDayName(date) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Show weekday and date (e.g., "Mon 15")
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = date.getDate();
  
  // Add "Today" or "Tomorrow" indicator if applicable
  if (date.toDateString() === today.toDateString()) {
    return `Today`;
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow`;
  }
  
  return `${weekday} ${dayNum}`;
}

function renderWeatherForecast(days, conditionEl) {
  const forecastEl = document.getElementById('weatherForecast');
  if (!forecastEl) return;
  
  if (days.length === 0) {
    renderWeatherPlaceholder('No forecast available');
    return;
  }
  
  forecastEl.innerHTML = days.map(day => `
    <div class="weather-day">
      <div class="weather-day-name">${formatDayName(day.date)}</div>
      <div class="weather-icon">${getWeatherEmoji(day.icon)}</div>
      <div class="weather-temp"><span class="high">${day.high}°</span>/<span class="low">${day.low}°</span></div>
    </div>
  `).join('');
  
  if (conditionEl && days[0]) {
    conditionEl.textContent = days[0].description;
  }
}

function renderWeatherPlaceholder(message) {
  const forecastEl = document.getElementById('weatherForecast');
  const conditionEl = document.getElementById('weatherCondition');
  
  if (forecastEl) {
    forecastEl.innerHTML = `
      <div class="weather-placeholder">
        <span class="material-symbols-outlined">cloud_off</span>
        <span>${message}</span>
      </div>
    `;
  }
  
  if (conditionEl) {
    conditionEl.textContent = message;
  }
}

function renderDarkThemeWeather(weather) {
  // This is now a fallback - actual weather is fetched separately
  const forecastEl = document.getElementById('weatherForecast');
  const conditionEl = document.getElementById('weatherCondition');
  
  if (!forecastEl) return;
  
  // Show placeholder until real weather is fetched
  forecastEl.innerHTML = `
    <div class="weather-day">
      <div class="weather-day-name">Today</div>
      <div class="weather-icon">🌤️</div>
      <div class="weather-temp"><span class="high">--°</span>/<span class="low">--°</span></div>
    </div>
    <div class="weather-day">
      <div class="weather-day-name">Tomorrow</div>
      <div class="weather-icon">☀️</div>
      <div class="weather-temp"><span class="high">--°</span>/<span class="low">--°</span></div>
    </div>
    <div class="weather-day">
      <div class="weather-day-name">Wed</div>
      <div class="weather-icon">🌧️</div>
      <div class="weather-temp"><span class="high">--°</span>/<span class="low">--°</span></div>
    </div>
  `;
  
  if (conditionEl) {
    conditionEl.textContent = weather || 'Loading...';
  }
}

// Modal show/hide functions for dark theme
function showEditModal() {
  const modal = document.getElementById('editEventModal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function hideEditModal() {
  const modal = document.getElementById('editEventModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

function showContactModal() {
  const modal = document.getElementById('addContactModal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function hideContactModal() {
  const modal = document.getElementById('addContactModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
    resetContactModal();
  }
}

function showLocationModal() {
  const modal = document.getElementById('addLocationModal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function hideLocationModal() {
  const modal = document.getElementById('addLocationModal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
    resetLocationModal();
  }
}

// Track which item is being edited (-1 = adding new)
let editingContactIndex = -1;
let editingLocationIndex = -1;

function openEditContactModal(index) {
  editingContactIndex = index;
  const contact = currentTableData?.general?.contacts?.[index];
  if (!contact) return;
  
  // Populate form with existing data
  document.getElementById('contactName').value = contact.name || '';
  document.getElementById('contactRole').value = contact.role || '';
  document.getElementById('contactPhone').value = contact.number || '';
  document.getElementById('contactEmail').value = contact.email || '';
  
  // Update modal title and button
  const modalTitle = document.querySelector('#addContactModal .modal-header-dark h3');
  const saveBtn = document.getElementById('saveContactBtn');
  if (modalTitle) modalTitle.textContent = 'Edit Contact';
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  
  // Add delete button if not present
  let deleteBtn = document.getElementById('deleteContactBtn');
  if (!deleteBtn) {
    const footer = document.querySelector('#addContactModal .modal-footer-dark');
    if (footer) {
      deleteBtn = document.createElement('button');
      deleteBtn.id = 'deleteContactBtn';
      deleteBtn.className = 'btn-danger';
      deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span> Delete';
      deleteBtn.onclick = () => deleteContact(index);
      footer.insertBefore(deleteBtn, footer.firstChild);
    }
  }
  deleteBtn.style.display = 'flex';
  
  showContactModal();
}

function openEditLocationModal(index) {
  editingLocationIndex = index;
  const location = currentTableData?.general?.locations?.[index];
  if (!location) return;
  
  // Populate form with existing data
  document.getElementById('locationName').value = location.name || '';
  document.getElementById('locationAddress').value = location.address || '';
  const eventField = document.getElementById('locationEvent');
  if (eventField) eventField.value = location.event || '';
  
  // Update modal title and button
  const modalTitle = document.querySelector('#addLocationModal .modal-header-dark h3');
  const saveBtn = document.getElementById('saveLocationBtn');
  if (modalTitle) modalTitle.textContent = 'Edit Location';
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  
  // Add delete button if not present
  let deleteBtn = document.getElementById('deleteLocationBtn');
  if (!deleteBtn) {
    const footer = document.querySelector('#addLocationModal .modal-footer-dark');
    if (footer) {
      deleteBtn = document.createElement('button');
      deleteBtn.id = 'deleteLocationBtn';
      deleteBtn.className = 'btn-danger';
      deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span> Delete';
      deleteBtn.onclick = () => deleteLocation(index);
      footer.insertBefore(deleteBtn, footer.firstChild);
    }
  }
  deleteBtn.style.display = 'flex';
  
  showLocationModal();
}

async function deleteContact(index) {
  if (!confirm('Are you sure you want to delete this contact?')) return;
  
  const tableId = currentTableData?._id;
  if (!tableId) return;
  
  try {
    const contacts = [...(currentTableData?.general?.contacts || [])];
    contacts.splice(index, 1);
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify({
        general: {
          ...currentTableData?.general,
          contacts
        }
      })
    });
    
    if (!res.ok) throw new Error('Failed to delete contact');
    
    hideContactModal();
    initPageDarkTheme(tableId);
  } catch (err) {
    console.error('Delete contact error:', err);
    alert('Failed to delete contact');
  }
}

async function deleteLocation(index) {
  if (!confirm('Are you sure you want to delete this location?')) return;
  
  const tableId = currentTableData?._id;
  if (!tableId) return;
  
  try {
    const locations = [...(currentTableData?.general?.locations || [])];
    locations.splice(index, 1);
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify({
        general: {
          ...currentTableData?.general,
          locations
        }
      })
    });
    
    if (!res.ok) throw new Error('Failed to delete location');
    
    hideLocationModal();
    initPageDarkTheme(tableId);
  } catch (err) {
    console.error('Delete location error:', err);
    alert('Failed to delete location');
  }
}

function resetContactModal() {
  editingContactIndex = -1;
  const nameEl = document.getElementById('contactName');
  const roleEl = document.getElementById('contactRole');
  const phoneEl = document.getElementById('contactPhone');
  const emailEl = document.getElementById('contactEmail');
  
  if (nameEl) nameEl.value = '';
  if (roleEl) roleEl.value = '';
  if (phoneEl) phoneEl.value = '';
  if (emailEl) emailEl.value = '';
  
  const modalTitle = document.querySelector('#addContactModal .modal-header-dark h3');
  const saveBtn = document.getElementById('saveContactBtn');
  const deleteBtn = document.getElementById('deleteContactBtn');
  
  if (modalTitle) modalTitle.textContent = 'Add Contact';
  if (saveBtn) saveBtn.textContent = 'Add Contact';
  if (deleteBtn) deleteBtn.style.display = 'none';
}

function resetLocationModal() {
  editingLocationIndex = -1;
  const nameEl = document.getElementById('locationName');
  const addressEl = document.getElementById('locationAddress');
  const eventEl = document.getElementById('locationEvent');
  
  if (nameEl) nameEl.value = '';
  if (addressEl) addressEl.value = '';
  if (eventEl) eventEl.value = '';
  
  const modalTitle = document.querySelector('#addLocationModal .modal-header-dark h3');
  const saveBtn = document.getElementById('saveLocationBtn');
  const deleteBtn = document.getElementById('deleteLocationBtn');
  
  if (modalTitle) modalTitle.textContent = 'Add Location';
  if (saveBtn) saveBtn.textContent = 'Add Location';
  if (deleteBtn) deleteBtn.style.display = 'none';
}

// Expose to window for onclick handlers
window.showEditModal = showEditModal;
window.hideEditModal = hideEditModal;
window.showContactModal = showContactModal;
window.hideContactModal = hideContactModal;
window.showLocationModal = showLocationModal;
window.hideLocationModal = hideLocationModal;
window.openEditContactModal = openEditContactModal;
window.openEditLocationModal = openEditLocationModal;

let isInlineEditMode = false;
let isInfoEditMode = false;
let isStatsEditMode = false;
let notesQuillEditor = null;
let quillLoaded = false;

// Load Quill dynamically
function loadQuill() {
  return new Promise((resolve, reject) => {
    // Check if Quill is already available
    if (typeof Quill !== 'undefined') {
      quillLoaded = true;
      resolve();
      return;
    }
    
    // Load CSS first
    if (!document.querySelector('link[href*="quill.snow.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.quilljs.com/1.3.7/quill.snow.css';
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
    
    // Remove any existing quill script that may have failed
    const existingScript = document.querySelector('script[src*="quill.min.js"]');
    if (existingScript) {
      existingScript.remove();
    }
    
    // Load JS
    const script = document.createElement('script');
    script.src = 'https://cdn.quilljs.com/1.3.7/quill.min.js';
    script.crossOrigin = 'anonymous';
    
    let resolved = false;
    
    script.onload = () => {
      if (resolved) return;
      resolved = true;
      
      // Wait a bit for Quill to be defined
      setTimeout(() => {
        if (typeof Quill !== 'undefined') {
          quillLoaded = true;
          resolve();
        } else {
          reject(new Error('Quill loaded but not defined'));
        }
      }, 100);
    };
    
    script.onerror = (e) => {
      if (resolved) return;
      resolved = true;
      console.error('Failed to load Quill script:', e);
      reject(new Error('Failed to load Quill script'));
    };
    
    document.head.appendChild(script);
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      reject(new Error('Quill load timeout'));
    }, 10000);
  });
}

function initDarkThemeEventListeners(tableId) {
  // Edit Summary Button - switches to inline edit mode
  const editSummaryBtn = document.getElementById('editSummaryBtn');
  if (editSummaryBtn && !editSummaryBtn._listenerAttached) {
    editSummaryBtn._listenerAttached = true;
    editSummaryBtn.addEventListener('click', () => {
      if (currentTableData) {
        if (isInlineEditMode) {
          cancelInlineEdit(tableId);
        } else {
          switchToInlineEditMode(tableId);
        }
      }
    });
  }
  
  // Add Contact Button
  const addContactBtn = document.getElementById('addContactBtn');
  if (addContactBtn && !addContactBtn._listenerAttached) {
    addContactBtn._listenerAttached = true;
    addContactBtn.addEventListener('click', () => {
      showContactModal();
    });
  }
  
  // Add Location Button
  const addLocationBtn = document.getElementById('addLocationBtn');
  if (addLocationBtn && !addLocationBtn._listenerAttached) {
    addLocationBtn._listenerAttached = true;
    addLocationBtn.addEventListener('click', () => {
      showLocationModal();
    });
  }
  
  // Edit Info Button - switches to inline edit mode for Event Info card
  const editInfoBtn = document.getElementById('editInfoBtn');
  if (editInfoBtn && !editInfoBtn._listenerAttached) {
    editInfoBtn._listenerAttached = true;
    editInfoBtn.addEventListener('click', () => {
      if (currentTableData) {
        if (isInfoEditMode) {
          cancelInfoEdit(tableId);
        } else {
          switchToInfoEditMode(tableId);
        }
      }
    });
  }
  
  
  // Save Event Button
  const saveEventBtn = document.getElementById('saveEventBtn');
  if (saveEventBtn && !saveEventBtn._listenerAttached) {
    saveEventBtn._listenerAttached = true;
    saveEventBtn.addEventListener('click', () => saveDarkThemeEvent(tableId));
  }
  
  // Save Contact Button
  const saveContactBtn = document.getElementById('saveContactBtn');
  if (saveContactBtn && !saveContactBtn._listenerAttached) {
    saveContactBtn._listenerAttached = true;
    saveContactBtn.addEventListener('click', () => saveDarkThemeContact(tableId));
  }
  
  // Save Location Button
  const saveLocationBtn = document.getElementById('saveLocationBtn');
  if (saveLocationBtn && !saveLocationBtn._listenerAttached) {
    saveLocationBtn._listenerAttached = true;
    saveLocationBtn.addEventListener('click', () => saveDarkThemeLocation(tableId));
  }
  
  // Load user info in sidebar
  loadUserInfoDarkTheme();
}

function loadUserInfoDarkTheme() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    // Get user name from localStorage (set during login) or from token
    let userName = localStorage.getItem('fullName');
    
    if (!userName) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userName = payload.fullName || payload.name || payload.email || 'User';
    }
    
    const sidebarUserName = document.getElementById('sidebarUserName');
    if (sidebarUserName) sidebarUserName.textContent = userName;
    
    // Also try to get user photo
    fetchAndDisplayUserPhoto();
    
    // Check for admin
    const adminNavItem = document.getElementById('adminNavItem');
    if (adminNavItem) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role === 'admin') {
        adminNavItem.style.display = 'flex';
      }
    }
  } catch (e) {
    console.error('Error loading user info:', e);
  }
}

async function fetchAndDisplayUserPhoto() {
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

function populateEditModal(table) {
  const general = table.general || {};
  
  document.getElementById('editEventName').value = table.title || '';
  document.getElementById('editClientName').value = general.client || '';
  document.getElementById('editStartDate').value = general.start?.split('T')[0] || '';
  document.getElementById('editEndDate').value = general.end?.split('T')[0] || '';
  document.getElementById('editLocation').value = general.location || '';
  document.getElementById('editCity').value = general.city || '';
  document.getElementById('editState').value = general.state || '';
  document.getElementById('editAttendees').value = general.attendees || '';
  document.getElementById('editBudget').value = general.budget || '';
  document.getElementById('editSummary').value = general.summary || '';
}

async function switchToInlineEditMode(tableId) {
  if (isInlineEditMode) return;
  isInlineEditMode = true;
  
  const general = currentTableData?.general || {};
  const card = document.getElementById('eventSummaryCard');
  if (!card) return;
  
  // Add editing class to card
  card.classList.add('editing');
  
  // Update the edit button to show "Cancel"
  const editBtn = document.getElementById('editSummaryBtn');
  if (editBtn) {
    editBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    editBtn.title = 'Cancel';
  }
  
  // Convert Notes to Quill rich text editor (at top)
  const notesEl = document.getElementById('summaryNotes');
  if (notesEl) {
    const editorContainer = document.createElement('div');
    editorContainer.id = 'editInlineNotesContainer';
    editorContainer.className = 'inline-quill-container';
    
    const editorDiv = document.createElement('div');
    editorDiv.id = 'editInlineNotes';
    editorContainer.appendChild(editorDiv);
    
    notesEl.replaceWith(editorContainer);
    
    // Load and initialize Quill editor
    try {
      await loadQuill();
      
      notesQuillEditor = new Quill('#editInlineNotes', {
        theme: 'snow',
        placeholder: 'Add notes about this event...',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline'],
            [{ 'header': [1, 2, 3, false] }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'color': [] }],
            ['link'],
            ['clean']
          ]
        }
      });
      
      // Set initial content
      const initialContent = general.summary || '';
      if (initialContent) {
        notesQuillEditor.root.innerHTML = initialContent;
      }
    } catch (err) {
      console.error('Failed to load Quill editor:', err);
      // Fallback to textarea if Quill fails
      const textarea = document.createElement('textarea');
      textarea.id = 'editInlineNotesFallback';
      textarea.className = 'inline-edit-textarea';
      textarea.value = general.summary || '';
      textarea.placeholder = 'Add notes about this event...';
      textarea.rows = 4;
      editorContainer.replaceWith(textarea);
    }
  }
  
  // Add save button at the bottom of the card
  const cardContent = card.querySelector('.card-content');
  if (cardContent && !document.getElementById('inlineSaveBtn')) {
    const saveContainer = document.createElement('div');
    saveContainer.className = 'inline-save-container';
    saveContainer.id = 'inlineSaveContainer';
    saveContainer.innerHTML = `
      <button class="btn-secondary" id="inlineCancelBtn">Cancel</button>
      <button class="btn-primary" id="inlineSaveBtn">Save Changes</button>
    `;
    cardContent.appendChild(saveContainer);
    
    document.getElementById('inlineCancelBtn').addEventListener('click', () => cancelInlineEdit(tableId));
    document.getElementById('inlineSaveBtn').addEventListener('click', () => saveInlineEdit(tableId));
  }
}

function restoreSummaryCardStructure() {
  const card = document.getElementById('eventSummaryCard');
  if (!card) return;
  
  // Remove editing class
  card.classList.remove('editing');
  
  // Restore the edit button icon
  const editBtn = document.getElementById('editSummaryBtn');
  if (editBtn) {
    editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
    editBtn.title = 'Edit';
  }
  
  // Remove save container
  const saveContainer = document.getElementById('inlineSaveContainer');
  if (saveContainer) saveContainer.remove();
  
  // Restore Notes field (clean up Quill container or fallback textarea)
  const notesContainer = document.getElementById('editInlineNotesContainer');
  const notesFallback = document.getElementById('editInlineNotesFallback');
  
  if (notesContainer) {
    const div = document.createElement('div');
    div.className = 'summary-notes-content';
    div.id = 'summaryNotes';
    notesContainer.replaceWith(div);
  } else if (notesFallback) {
    const div = document.createElement('div');
    div.className = 'summary-notes-content';
    div.id = 'summaryNotes';
    notesFallback.replaceWith(div);
  }
  
  // Clean up Quill editor
  if (notesQuillEditor) {
    notesQuillEditor = null;
  }
}

function cancelInlineEdit(tableId) {
  isInlineEditMode = false;
  restoreSummaryCardStructure();
  initPageDarkTheme(tableId); // Reload the page to restore read-only state
}

async function saveInlineEdit(tableId) {
  const saveBtn = document.getElementById('inlineSaveBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  // Get notes from Quill editor or fallback textarea
  let notesValue = '';
  if (notesQuillEditor) {
    notesValue = notesQuillEditor.root.innerHTML;
    // Clean up empty content
    if (notesValue === '<p><br></p>') {
      notesValue = '';
    }
  } else {
    // Fallback to textarea if Quill failed to load
    const fallbackTextarea = document.getElementById('editInlineNotesFallback');
    if (fallbackTextarea) {
      notesValue = fallbackTextarea.value || '';
    }
  }
  
  try {
    const eventData = {
      title: currentTableData?.title, // Keep the existing title
      general: {
        ...currentTableData?.general,
        summary: notesValue
      }
    };
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify(eventData)
    });
    
    if (!res.ok) throw new Error('Failed to save');
    
    isInlineEditMode = false;
    restoreSummaryCardStructure();
    initPageDarkTheme(tableId); // Reload data
  } catch (err) {
    console.error('Save error:', err);
    alert('Failed to save changes');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

// ========================================
// EVENT INFO CARD INLINE EDIT
// ========================================

function switchToInfoEditMode(tableId) {
  if (isInfoEditMode) return;
  isInfoEditMode = true;
  
  const general = currentTableData?.general || {};
  const card = document.getElementById('eventInfoCard');
  if (!card) return;
  
  card.classList.add('editing');
  
  // Update edit button to show cancel
  const editBtn = document.getElementById('editInfoBtn');
  if (editBtn) {
    editBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    editBtn.title = 'Cancel';
  }
  
  // Convert Client to input
  const clientEl = document.getElementById('summaryClient');
  if (clientEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'editInfoClient';
    input.className = 'inline-edit-input';
    input.value = general.client || '';
    input.placeholder = 'Client name';
    clientEl.replaceWith(input);
  }
  
  // Convert City to input
  const cityEl = document.getElementById('summaryCity');
  if (cityEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'editInfoCity';
    input.className = 'inline-edit-input';
    input.value = general.city || '';
    input.placeholder = 'City';
    cityEl.replaceWith(input);
  }
  
  // Convert Venue to input
  const venueEl = document.getElementById('summaryVenue');
  if (venueEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'editInfoVenue';
    input.className = 'inline-edit-input';
    input.value = general.location || '';
    input.placeholder = 'Venue';
    venueEl.replaceWith(input);
  }
  
  // Convert Start Date to input
  const startEl = document.getElementById('statStartDate');
  if (startEl) {
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'editInfoStart';
    input.className = 'inline-edit-input';
    input.value = general.start?.split('T')[0] || '';
    startEl.replaceWith(input);
  }
  
  // Convert End Date to input
  const endEl = document.getElementById('statEndDate');
  if (endEl) {
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'editInfoEnd';
    input.className = 'inline-edit-input';
    input.value = general.end?.split('T')[0] || '';
    endEl.replaceWith(input);
  }
  
  // Convert Budget to input
  const budgetEl = document.getElementById('statBudget');
  if (budgetEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'editInfoBudget';
    input.className = 'inline-edit-input';
    input.value = general.budget || '';
    input.placeholder = '$0';
    budgetEl.replaceWith(input);
  }
  
  // Convert Attendees to input
  const attendeesEl = document.getElementById('statAttendees');
  if (attendeesEl) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'editInfoAttendees';
    input.className = 'inline-edit-input';
    input.value = general.attendees || '';
    input.placeholder = '0';
    attendeesEl.replaceWith(input);
  }
  
  // Add save buttons
  const cardContent = card.querySelector('.card-content');
  if (cardContent && !document.getElementById('infoSaveBtn')) {
    const saveContainer = document.createElement('div');
    saveContainer.className = 'inline-save-container';
    saveContainer.id = 'infoSaveContainer';
    saveContainer.innerHTML = `
      <button class="btn-secondary" id="infoCancelBtn">Cancel</button>
      <button class="btn-primary" id="infoSaveBtn">Save</button>
    `;
    cardContent.appendChild(saveContainer);
    
    document.getElementById('infoCancelBtn').addEventListener('click', () => cancelInfoEdit(tableId));
    document.getElementById('infoSaveBtn').addEventListener('click', () => saveInfoEdit(tableId));
  }
}

function restoreInfoCardStructure() {
  const card = document.getElementById('eventInfoCard');
  if (!card) return;
  
  card.classList.remove('editing');
  
  const editBtn = document.getElementById('editInfoBtn');
  if (editBtn) {
    editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
    editBtn.title = 'Edit';
  }
  
  const saveContainer = document.getElementById('infoSaveContainer');
  if (saveContainer) saveContainer.remove();
  
  // Restore fields
  const clientInput = document.getElementById('editInfoClient');
  if (clientInput) {
    const span = document.createElement('span');
    span.className = 'info-value';
    span.id = 'summaryClient';
    clientInput.replaceWith(span);
  }
  
  const cityInput = document.getElementById('editInfoCity');
  if (cityInput) {
    const span = document.createElement('span');
    span.className = 'info-city';
    span.id = 'summaryCity';
    cityInput.replaceWith(span);
  }
  
  const venueInput = document.getElementById('editInfoVenue');
  if (venueInput) {
    const span = document.createElement('span');
    span.className = 'info-venue';
    span.id = 'summaryVenue';
    venueInput.replaceWith(span);
  }
  
  const startInput = document.getElementById('editInfoStart');
  if (startInput) {
    const span = document.createElement('span');
    span.className = 'info-value';
    span.id = 'statStartDate';
    startInput.replaceWith(span);
  }
  
  const endInput = document.getElementById('editInfoEnd');
  if (endInput) {
    const span = document.createElement('span');
    span.className = 'info-value';
    span.id = 'statEndDate';
    endInput.replaceWith(span);
  }
  
  const budgetInput = document.getElementById('editInfoBudget');
  if (budgetInput) {
    const span = document.createElement('span');
    span.className = 'info-value';
    span.id = 'statBudget';
    budgetInput.replaceWith(span);
  }
  
  const attendeesInput = document.getElementById('editInfoAttendees');
  if (attendeesInput) {
    const span = document.createElement('span');
    span.className = 'info-value';
    span.id = 'statAttendees';
    attendeesInput.replaceWith(span);
  }
}

function cancelInfoEdit(tableId) {
  isInfoEditMode = false;
  restoreInfoCardStructure();
  initPageDarkTheme(tableId);
}

async function saveInfoEdit(tableId) {
  const saveBtn = document.getElementById('infoSaveBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  const clientValue = document.getElementById('editInfoClient')?.value || '';
  const cityValue = document.getElementById('editInfoCity')?.value || '';
  const venueValue = document.getElementById('editInfoVenue')?.value || '';
  const startValue = document.getElementById('editInfoStart')?.value || '';
  const endValue = document.getElementById('editInfoEnd')?.value || '';
  const budgetValue = document.getElementById('editInfoBudget')?.value || '';
  const attendeesValue = document.getElementById('editInfoAttendees')?.value || '';
  
  try {
    const eventData = {
      title: currentTableData?.title,
      general: {
        ...currentTableData?.general,
        client: clientValue,
        city: cityValue,
        location: venueValue,
        start: startValue,
        end: endValue,
        budget: budgetValue,
        attendees: attendeesValue
      }
    };
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify(eventData)
    });
    
    if (!res.ok) throw new Error('Failed to save');
    
    isInfoEditMode = false;
    restoreInfoCardStructure();
    initPageDarkTheme(tableId);
  } catch (err) {
    console.error('Save error:', err);
    alert('Failed to save changes');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

// ========================================
// STATS CARD INLINE EDIT
// ========================================

function switchToStatsEditMode(tableId) {
  if (isStatsEditMode) return;
  isStatsEditMode = true;
  
  const general = currentTableData?.general || {};
  const card = document.getElementById('statsCard');
  if (!card) return;
  
  card.classList.add('editing');
  
  // Update edit button to show cancel
  const editBtn = document.getElementById('editStatsBtn');
  if (editBtn) {
    editBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    editBtn.title = 'Cancel';
  }
  
  // Convert Start Date to input
  const startEl = document.getElementById('statStartDate');
  if (startEl) {
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'editStatStart';
    input.className = 'inline-edit-input';
    input.value = general.start?.split('T')[0] || '';
    startEl.replaceWith(input);
  }
  
  // Convert End Date to input
  const endEl = document.getElementById('statEndDate');
  if (endEl) {
    const input = document.createElement('input');
    input.type = 'date';
    input.id = 'editStatEnd';
    input.className = 'inline-edit-input';
    input.value = general.end?.split('T')[0] || '';
    endEl.replaceWith(input);
  }
  
  // Convert Budget to input
  const budgetEl = document.getElementById('statBudget');
  if (budgetEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'editStatBudget';
    input.className = 'inline-edit-input';
    input.value = general.budget || '';
    input.placeholder = '$0';
    budgetEl.replaceWith(input);
  }
  
  // Convert Attendees to input
  const attendeesEl = document.getElementById('statAttendees');
  if (attendeesEl) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'editStatAttendees';
    input.className = 'inline-edit-input';
    input.value = general.attendees || '';
    input.placeholder = '0';
    attendeesEl.replaceWith(input);
  }
  
  // Add save buttons
  const cardContent = card.querySelector('.card-content');
  if (cardContent && !document.getElementById('statsSaveBtn')) {
    const saveContainer = document.createElement('div');
    saveContainer.className = 'inline-save-container';
    saveContainer.id = 'statsSaveContainer';
    saveContainer.innerHTML = `
      <button class="btn-secondary" id="statsCancelBtn">Cancel</button>
      <button class="btn-primary" id="statsSaveBtn">Save</button>
    `;
    cardContent.appendChild(saveContainer);
    
    document.getElementById('statsCancelBtn').addEventListener('click', () => cancelStatsEdit(tableId));
    document.getElementById('statsSaveBtn').addEventListener('click', () => saveStatsEdit(tableId));
  }
}

function restoreStatsCardStructure() {
  const card = document.getElementById('statsCard');
  if (!card) return;
  
  card.classList.remove('editing');
  
  const editBtn = document.getElementById('editStatsBtn');
  if (editBtn) {
    editBtn.innerHTML = '<span class="material-symbols-outlined">edit</span>';
    editBtn.title = 'Edit';
  }
  
  const saveContainer = document.getElementById('statsSaveContainer');
  if (saveContainer) saveContainer.remove();
  
  // Restore fields
  const startInput = document.getElementById('editStatStart');
  if (startInput) {
    const span = document.createElement('span');
    span.className = 'stat-value';
    span.id = 'statStartDate';
    startInput.replaceWith(span);
  }
  
  const endInput = document.getElementById('editStatEnd');
  if (endInput) {
    const span = document.createElement('span');
    span.className = 'stat-value';
    span.id = 'statEndDate';
    endInput.replaceWith(span);
  }
  
  const budgetInput = document.getElementById('editStatBudget');
  if (budgetInput) {
    const span = document.createElement('span');
    span.className = 'stat-value large';
    span.id = 'statBudget';
    budgetInput.replaceWith(span);
  }
  
  const attendeesInput = document.getElementById('editStatAttendees');
  if (attendeesInput) {
    const span = document.createElement('span');
    span.className = 'stat-value large';
    span.id = 'statAttendees';
    attendeesInput.replaceWith(span);
  }
}

function cancelStatsEdit(tableId) {
  isStatsEditMode = false;
  restoreStatsCardStructure();
  initPageDarkTheme(tableId);
}

async function saveStatsEdit(tableId) {
  const saveBtn = document.getElementById('statsSaveBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  const startValue = document.getElementById('editStatStart')?.value || '';
  const endValue = document.getElementById('editStatEnd')?.value || '';
  const budgetValue = document.getElementById('editStatBudget')?.value || '';
  const attendeesValue = document.getElementById('editStatAttendees')?.value || '';
  
  try {
    const eventData = {
      title: currentTableData?.title,
      general: {
        ...currentTableData?.general,
        start: startValue,
        end: endValue,
        budget: budgetValue,
        attendees: attendeesValue
      }
    };
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify(eventData)
    });
    
    if (!res.ok) throw new Error('Failed to save');
    
    isStatsEditMode = false;
    restoreStatsCardStructure();
    initPageDarkTheme(tableId);
  } catch (err) {
    console.error('Save error:', err);
    alert('Failed to save changes');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

async function saveDarkThemeEvent(tableId) {
  const saveBtn = document.getElementById('saveEventBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const eventData = {
      title: document.getElementById('editEventName').value,
      general: {
        ...currentTableData?.general,
        client: document.getElementById('editClientName').value,
        start: document.getElementById('editStartDate').value,
        end: document.getElementById('editEndDate').value,
        location: document.getElementById('editLocation').value,
        city: document.getElementById('editCity').value,
        state: document.getElementById('editState').value,
        attendees: document.getElementById('editAttendees').value,
        budget: document.getElementById('editBudget').value,
        summary: document.getElementById('editSummary').value
      }
    };
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify(eventData)
    });
    
    if (!res.ok) throw new Error('Failed to save');
    
    hideEditModal();
    initPageDarkTheme(tableId); // Reload data
  } catch (err) {
    console.error('Save error:', err);
    alert('Failed to save changes');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

async function saveDarkThemeContact(tableId) {
  const saveBtn = document.getElementById('saveContactBtn');
  const isEditing = editingContactIndex >= 0;
  
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const contactData = {
      name: document.getElementById('contactName').value,
      role: document.getElementById('contactRole').value,
      number: document.getElementById('contactPhone').value,
      email: document.getElementById('contactEmail').value
    };
    
    let contacts = [...(currentTableData?.general?.contacts || [])];
    
    if (isEditing) {
      // Update existing contact
      contacts[editingContactIndex] = contactData;
    } else {
      // Add new contact
      contacts.push(contactData);
    }
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify({
        general: {
          ...currentTableData?.general,
          contacts
        }
      })
    });
    
    if (!res.ok) throw new Error('Failed to save contact');
    
    resetContactModal();
    hideContactModal();
    initPageDarkTheme(tableId);
  } catch (err) {
    console.error('Save contact error:', err);
    alert('Failed to save contact');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = isEditing ? 'Save Changes' : 'Add Contact';
    }
  }
}

async function saveDarkThemeLocation(tableId) {
  const saveBtn = document.getElementById('saveLocationBtn');
  const isEditing = editingLocationIndex >= 0;
  
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const locationData = {
      name: document.getElementById('locationName').value,
      address: document.getElementById('locationAddress').value,
      event: document.getElementById('locationEvent')?.value || ''
    };
    
    let locations = [...(currentTableData?.general?.locations || [])];
    
    if (isEditing) {
      // Update existing location
      locations[editingLocationIndex] = locationData;
    } else {
      // Add new location
      locations.push(locationData);
    }
    
    const res = await fetch(`${API_BASE}/api/tables/${tableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      body: JSON.stringify({
        general: {
          ...currentTableData?.general,
          locations
        }
      })
    });
    
    if (!res.ok) throw new Error('Failed to save location');
    
    resetLocationModal();
    hideLocationModal();
    initPageDarkTheme(tableId);
  } catch (err) {
    console.error('Save location error:', err);
    alert('Failed to save location');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = isEditing ? 'Save Changes' : 'Add Location';
    }
  }
}

function initPageDarkTheme(id) {
  if (!id || !window.token) return;
  
  fetch(`${API_BASE}/api/tables/${id}`, {
    headers: { Authorization: window.token }
  })
    .then(res => res.json())
    .then(table => {
      currentTableData = table;
      const general = table.general || {};
      
      // Render all sections
      renderDarkThemeHeader(table);
      renderDarkThemeSummary(table);
      renderDarkThemeStats(table);
      renderDarkThemeContacts(general.contacts);
      renderDarkThemeLocations(general.locations);
      
      // Fetch weather based on event city and dates
      const city = general.city || '';
      const startDate = general.start || '';
      const endDate = general.end || '';
      fetchWeatherForEvent(city, startDate, endDate);
      
      // Set up event listeners
      initDarkThemeEventListeners(id);
    })
    .catch(err => console.error('Error loading event:', err));
}

// ========================================
// END DARK THEME FUNCTIONS
// ========================================

// Socket.IO real-time updates
if (window.socket) {
  // Listen for general info updates
  window.socket.on('generalChanged', (data) => {
    console.log('General info changed, checking if relevant...');
    // Only reload if it's for the current table
    if (data && data.tableId && data.tableId !== tableId) {
      console.log('Update was for a different table, ignoring');
      return;
    }
    console.log('Reloading general info for current table');
    initPage(tableId);
  });
  
  // Also listen for general table updates
  window.socket.on('tableUpdated', (data) => {
    console.log('Table updated, checking if relevant...');
    // Only reload if it's for the current table
    if (data && data.tableId && data.tableId !== tableId) {
      console.log('Update was for a different table, ignoring');
      return;
    }
    console.log('Reloading general info for current table');
    initPage(tableId);
  });
}

// Function to get appropriate weather icon based on text description
function getWeatherIcon(weatherText) {
  if (!weatherText) return 'cloud'; // Default Material Symbol
  
  const text = weatherText.toLowerCase();
  
  // Check for various weather conditions - return Material Symbol names
  if (text.includes('sunny') || text.includes('clear')) return 'clear_day';
  if (text.includes('partly cloudy') || text.includes('partly sunny')) return 'partly_cloudy_day';
  if (text.includes('cloudy') || text.includes('overcast')) return 'cloudy';
  if (text.includes('rain') || text.includes('shower')) return 'rainy';
  if (text.includes('storm') || text.includes('thunder') || text.includes('lightning')) return 'thunderstorm';
  if (text.includes('snow') || text.includes('flurrie')) return 'weather_snowy';
  if (text.includes('fog') || text.includes('mist')) return 'foggy';
  if (text.includes('wind') || text.includes('breez')) return 'air';
  if (text.includes('hot') || text.includes('heat')) return 'local_fire_department';
  if (text.includes('cold') || text.includes('freez')) return 'ac_unit';
  if (text.includes('tornado') || text.includes('hurricane')) return 'cyclone';
  
  return 'cloud'; // Default Material Symbol
}

// Function to update the weather label icon based on current weather text
function updateWeatherIcon() {
  const weatherLabel = document.querySelector('label[for="weather"]');
  if (!weatherLabel) return;
  
  const weatherEl = document.getElementById('weather');
  const weatherText = weatherEl?.tagName === 'TEXTAREA' 
    ? weatherEl.value.trim() 
    : weatherEl?.textContent.trim() || '';
  
  const iconName = getWeatherIcon(weatherText);
  // Ensure the label starts with the icon span, then text
  weatherLabel.innerHTML = `<span class="material-symbols-outlined">${iconName}</span> Weather`;
}

// Toggle Event Summary expand/collapse
window.toggleEventSummary = function() {
  isSummaryExpanded = !isSummaryExpanded;
  const summaryContent = document.getElementById('summaryContent');
  const toggleIcon = document.getElementById('summaryToggleIcon');
  
  if (isSummaryExpanded) {
    summaryContent.style.maxHeight = summaryContent.scrollHeight + 'px';
    summaryContent.style.opacity = '1';
    summaryContent.style.overflow = 'visible';
    toggleIcon.style.transform = 'rotate(0deg)';
  } else {
    summaryContent.style.maxHeight = '0';
    summaryContent.style.opacity = '0';
    summaryContent.style.overflow = 'hidden';
    toggleIcon.style.transform = 'rotate(-90deg)';
  }
};

function getUserIdFromToken() {
  try {
    const token = window.token;
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.id;
  } catch {
    return null;
  }
}

function createLinkedTextarea(value, type) {
  const textarea = document.createElement('textarea');
  textarea.value = value || '';
  textarea.placeholder = type.charAt(0).toUpperCase() + type.slice(1);
  textarea.addEventListener('input', () => autoResizeTextarea(textarea));
  autoResizeTextarea(textarea);
  textarea.addEventListener('dblclick', () => {
    const val = textarea.value.trim();
    if (!val) return;
    if (type === 'email') {
      window.location.href = `mailto:${val}`;
    }
    else if (type === 'phone') {
      window.location.href = `tel:${val}`;
    }
    else if (type === 'address') {
      // Use a more iOS-friendly maps URL format
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      
      if (isIOS) {
        // Apple Maps format (iOS)
        window.location.href = `maps://?q=${encodeURIComponent(val)}`;
      } else {
        // Google Maps format (Android, desktop)
        window.open(`https://www.google.com/maps/search/?q=${encodeURIComponent(val)}`, '_blank');
      }
    }
  });
  return textarea;
}

function createLinkHTML(value, type) {
  if (!value) return '<div>(empty)</div>';
  value = value.trim();
  let href = '#';
  
  if (type === 'email') {
    href = `mailto:${value}`;
  } 
  else if (type === 'phone' || type === 'number') {
    href = `tel:${value}`;
  } 
  else if (type === 'address') {
    // Use a more iOS-friendly maps URL format
    // Apple Maps URL scheme for iOS, fallback to Google Maps
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    
    if (isIOS) {
      // Apple Maps format (iOS)
      href = `maps://?q=${encodeURIComponent(value)}`;
    } else {
      // Google Maps format (Android, desktop)
      href = `https://www.google.com/maps/search/?q=${encodeURIComponent(value)}`;
    }
  }
  else {
    return `<div>${value}</div>`;
  }
  
  return `<a href="${href}" target="_blank" style="color: #1976d2; text-decoration: underline;">${value}</a>`;
}

// Enhanced linkifyText function that preserves HTML formatting
function linkifyText(text) {
  if (!text) return '';
  
  // Handle markdown-style custom links first: [Custom Name](URL)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  text = text.replace(markdownLinkRegex, (match, linkText, url) => {
    let href = url.trim();
    
    // Add protocol if missing
    if (!href.match(/^https?:\/\//)) {
      href = 'https://' + href;
    }
    
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #1976d2; text-decoration: underline;" onclick="window.open('${href}', '_blank'); return false;">${linkText}</a>`;
  });
  
  // Then handle regular URLs (but skip ones already inside <a> tags from markdown processing)
  const urlRegex = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s<]*)?)/g;
  
  // Replace URLs with clickable links, but only if they're not already inside <a> tags
  text = text.replace(urlRegex, (url) => {
    // Check if this URL is already inside an <a> tag
    const beforeUrl = text.substring(0, text.indexOf(url));
    const lastATag = beforeUrl.lastIndexOf('<a ');
    const lastCloseATag = beforeUrl.lastIndexOf('</a>');
    
    // If we're inside an <a> tag, don't linkify
    if (lastATag > lastCloseATag) {
      return url;
    }
    
    let href = url;
    
    // Add protocol if missing
    if (!url.match(/^https?:\/\//)) {
      href = 'https://' + url;
    }
    
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: #1976d2; text-decoration: underline;" onclick="window.open('${href}', '_blank'); return false;">${url}</a>`;
  });
  
  return text;
}

// Function to convert HTML to plain text for editing
function htmlToPlainText(html) {
  if (!html) return '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
}

// TinyMCE editor instance
let summaryEditor = null;

// Load TinyMCE dynamically
function loadTinyMCE() {
  return new Promise((resolve, reject) => {
    if (window.tinymce) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    // Use API key from config file, fallback to no-api-key for development
    const apiKey = window.TINYMCE_API_KEY || 'no-api-key';
    
    // For development/testing, you can temporarily use no-api-key
    // const apiKey = 'no-api-key'; // Uncomment this line for development
    
    script.src = `https://cdn.tiny.cloud/1/${apiKey}/tinymce/6/tinymce.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load TinyMCE'));
    document.head.appendChild(script);
  });
}

// Initialize TinyMCE editor
async function initializeTinyMCE(initialContent = '') {
  try {
    await loadTinyMCE();
    
    // Remove any existing editor first
    if (summaryEditor) {
      summaryEditor.remove();
      summaryEditor = null;
    }
    
    // Initialize TinyMCE
    await tinymce.init({
      selector: '#summaryEditor',
      height: 300,
      menubar: false,
      toolbar: 'bold italic | bullist numlist | link unlink | removeformat',
      plugins: 'lists link',
      branding: false,
      content_style: `
        body {
          font-family: 'Roboto', Arial, sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: #333;
          padding: 10px;
          margin: 0;
        }
        p { margin: 0 0 10px 0; }
        ul, ol { margin: 0 0 10px 20px; padding: 0; }
        li { margin: 0 0 4px 0; }
      `,
      setup: function(editor) {
        editor.on('init', function() {
          console.log('TinyMCE initialized successfully');
          editor.setContent(initialContent);
        });
      }
    });
    
    // Get the editor instance
    summaryEditor = tinymce.get('summaryEditor');
    
    if (summaryEditor) {
      summaryEditor.setContent(initialContent);
      console.log('TinyMCE editor ready with content');
    }
    
  } catch (error) {
    console.error('Error initializing TinyMCE:', error);
    throw error;
  }
}

// Get content from TinyMCE editor
function getTinyMCEContent() {
  if (summaryEditor) {
    return summaryEditor.getContent();
  }
  return '';
}

// Set content in TinyMCE editor
function setTinyMCEContent(content) {
  if (summaryEditor) {
    summaryEditor.setContent(content || '');
  }
}

// Clean up TinyMCE editor
function cleanupTinyMCE() {
  if (summaryEditor) {
    summaryEditor.remove();
    summaryEditor = null;
  }
}

function renderContactRow(data = {}, readOnly = false) {
  const tbody = document.getElementById('contactRows');
  const row = document.createElement('tr');
  const fields = ['name', 'number', 'email', 'role'];

  fields.forEach(type => {
    const td = document.createElement('td');
    if (readOnly) td.innerHTML = createLinkHTML(data[type], type);
    else td.appendChild(createLinkedTextarea(data[type], type));
    row.appendChild(td);
  });

  // Only add action column when not in read-only mode
  if (!readOnly) {
    const deleteTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    btn.onclick = () => row.remove();
    deleteTd.appendChild(btn);
    row.appendChild(deleteTd);
  }
  
  tbody.appendChild(row);
}

function renderLocationRow(data = {}, readOnly = false) {
  const tbody = document.getElementById('locationsRows');
  const row = document.createElement('tr');
  const fields = ['name', 'address', 'event'];

  fields.forEach(type => {
    const td = document.createElement('td');
    if (readOnly) td.innerHTML = createLinkHTML(data[type], type);
    else td.appendChild(createLinkedTextarea(data[type], type));
    row.appendChild(td);
  });

  // Only add action column when not in read-only mode
  if (!readOnly) {
    const deleteTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    btn.onclick = () => row.remove();
    deleteTd.appendChild(btn);
    row.appendChild(deleteTd);
  }
  
  tbody.appendChild(row);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

document.addEventListener('input', e => {
  if (e.target.tagName.toLowerCase() === 'textarea') autoResizeTextarea(e.target);
});

function collectContacts() {
  return [...document.querySelectorAll("#contactRows tr")].map(row => {
    const inputs = row.querySelectorAll("textarea");
    if (inputs.length) {
    return {
      name: inputs[0]?.value.trim(),
      number: inputs[1]?.value.trim(),
      email: inputs[2]?.value.trim(),
      role: inputs[3]?.value.trim()
    };
    } else {
      // Fallback to text content in view mode
      const cells = row.querySelectorAll("td");
      return {
        name: cells[0]?.textContent.trim(),
        number: cells[1]?.textContent.trim(),
        email: cells[2]?.textContent.trim(),
        role: cells[3]?.textContent.trim()
      };
    }
  });
}

function collectLocations() {
  return [...document.querySelectorAll("#locationsRows tr")].map(row => {
    const inputs = row.querySelectorAll("textarea");
    if (inputs.length) {
    return {
      name: inputs[0]?.value.trim(),
      address: inputs[1]?.value.trim(),
      event: inputs[2]?.value.trim()
    };
    } else {
      // Fallback to text content in view mode
      const cells = row.querySelectorAll("td");
      return {
        name: cells[0]?.textContent.trim(),
        address: cells[1]?.textContent.trim(),
        event: cells[2]?.textContent.trim()
      };
    }
  });
}

function isAdmin() {
  try {
    const token = window.token;
    if (!token) return false;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

function insertAdminNotesBtn(tableId) {
  const container = document.getElementById('adminNotesBtnContainer');
  if (!container) return;
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  
  if (isAdmin() || isOwner) {
    const btn = document.createElement('button');
    btn.textContent = 'Notes';
    btn.className = 'admin-notes-btn';
    btn.style = 'margin-bottom: 18px; background: #CC0007; color: #fff; border: none; border-radius: 8px; padding: 10px 22px; font-weight: 600; font-size: 17px; box-shadow: 0 2px 8px rgba(204,0,7,0.08); cursor: pointer;';
    btn.onclick = () => {
      window.location.href = `/pages/notes.html?id=${tableId}`;
    };
    container.appendChild(btn);
  }
  
  // Add Folder Logs icon button for all users
  const folderBtn = document.createElement('button');
  folderBtn.innerHTML = '<span class="material-symbols-outlined">folder</span>';
  folderBtn.className = 'folder-logs-btn';
  folderBtn.style = 'margin-bottom: 18px; margin-left: 8px; background: none; color: #888; border: none; border-radius: 8px; padding: 8px; font-size: 17px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;';
  folderBtn.title = 'Folder Logs';
  folderBtn.onclick = () => {
    window.location.href = `/folder-logs.html?id=${tableId}`;
  };
  container.appendChild(folderBtn);

  // Add QR Code button for all users, styled like folder icon
  const qrBtn = document.createElement('button');
  qrBtn.innerHTML = '<span class="material-symbols-outlined">qr_code</span>';
  qrBtn.className = 'qr-code-btn';
  qrBtn.style = 'margin-bottom: 18px; margin-left: 8px; background: none; color: #888; border: none; border-radius: 8px; padding: 8px; font-size: 17px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;';
  qrBtn.title = 'QR Code';
  qrBtn.onclick = () => {
    showQRCodeModal();
  };
  container.appendChild(qrBtn);

  // Add Task icon button for owners, styled like folder icon, to the right
  if (isOwner) {
    const taskBtn = document.createElement('button');
    taskBtn.innerHTML = '<span class="material-symbols-outlined">task_alt</span>';
    taskBtn.className = 'task-logs-btn';
    taskBtn.style = 'margin-bottom: 18px; margin-left: 8px; background: none; color: #888; border: none; border-radius: 8px; padding: 8px; font-size: 17px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;';
    taskBtn.title = 'To-Do List';
    taskBtn.onclick = () => {
      window.location.href = `/pages/tasks.html?id=${tableId}`;
    };
    container.appendChild(taskBtn);
  }
  console.log('Folder logs button added for all users');
}

function showQRCodeModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'qrCodeModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.9);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    cursor: pointer;
  `;

  // Create QR code container
  const qrContainer = document.createElement('div');
  qrContainer.style.cssText = `
    background: white;
    border-radius: 16px;
    padding: 20px;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  `;

  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '×';
  closeBtn.style.cssText = `
    position: absolute;
    top: 10px;
    right: 15px;
    background: none;
    border: none;
    font-size: 30px;
    color: #666;
    cursor: pointer;
    padding: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeQRCodeModal();
  };

  // Create QR code image
  const qrImage = document.createElement('img');
  qrImage.src = '../assets/qr-code.png'; // QR code that links to https://www.lumtags.com/#/attendee
  qrImage.alt = 'QR Code for LumTags Attendee';
  qrImage.style.cssText = `
    max-width: 100%;
    max-height: 60vh;
    width: auto;
    height: auto;
    border-radius: 8px;
    cursor: pointer;
  `;
  
  // Make QR code clickable to open the link
  qrImage.onclick = (e) => {
    e.stopPropagation();
    window.open('https://www.lumtags.com/#/attendee', '_blank');
  };

  // Create title
  const title = document.createElement('h3');
  title.textContent = 'LumTags Attendee Portal';
  title.style.cssText = `
    margin: 0 0 15px 0;
    color: #333;
    font-size: 24px;
    text-align: center;
  `;

  // Create subtitle with link
  const subtitle = document.createElement('p');
  subtitle.innerHTML = 'Scan QR code or <a href="https://www.lumtags.com/#/attendee" target="_blank" style="color: #CC0007; text-decoration: none; font-weight: bold;">click here</a> to access the attendee portal';
  subtitle.style.cssText = `
    margin: 0 0 20px 0;
    color: #666;
    font-size: 16px;
    text-align: center;
    max-width: 300px;
  `;

  // Create URL display
  const urlDisplay = document.createElement('div');
  urlDisplay.textContent = 'www.lumtags.com/#/attendee';
  urlDisplay.style.cssText = `
    margin: 15px 0 0 0;
    color: #888;
    font-size: 14px;
    text-align: center;
    font-family: monospace;
    background: #f5f5f5;
    padding: 8px 12px;
    border-radius: 4px;
    user-select: all;
  `;

  // Add elements to container
  qrContainer.appendChild(closeBtn);
  qrContainer.appendChild(title);
  qrContainer.appendChild(subtitle);
  qrContainer.appendChild(qrImage);
  qrContainer.appendChild(urlDisplay);

  // Add container to modal
  modal.appendChild(qrContainer);

  // Add modal to document
  document.body.appendChild(modal);

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeQRCodeModal();
    }
  };

  // Prevent scrolling when modal is open
  document.body.style.overflow = 'hidden';

  // Handle image load error
  qrImage.onerror = () => {
    qrImage.style.display = 'none';
    const errorMsg = document.createElement('p');
    errorMsg.textContent = 'QR code image not found. Please add the LumTags QR code as qr-code.png to the assets folder.';
    errorMsg.style.cssText = `
      color: #666;
      text-align: center;
      margin: 20px;
      font-size: 16px;
    `;
    qrContainer.appendChild(errorMsg);
  };
}

function closeQRCodeModal() {
  const modal = document.getElementById('qrCodeModal');
  if (modal) {
    modal.remove();
    document.body.style.overflow = '';
  }
}

function initPage(id) {
  // Safeguard: Only run on the general page
  // Parse the page name from hash, handling #page?id=xxx format
  const hash = location.hash.replace('#', '') || 'events';
  const currentPage = hash.split('?')[0];
  if (currentPage !== 'general') {
    console.log(`general.js initPage called on wrong page: ${currentPage}, skipping execution`);
    return;
  }
  
  console.log('[GENERAL] initPage called with id:', id);
  
  if (!id || !window.token) return;
  
  // Check if dark theme and use dark theme functions
  if (isDarkTheme()) {
    console.log('[GENERAL] Dark theme detected, using dark theme layout');
    initPageDarkTheme(id);
    return;
  }

  fetch(`${API_BASE}/api/tables/${id}`, {
    headers: { Authorization: window.token }
  })
    .then(res => res.json())
    .then(table => {
      const general = table.general || {};
      const userId = getUserIdFromToken();
      isOwner = Array.isArray(table.owners) && table.owners.includes(userId);

      // Now that isOwner is set, insert the admin/folder/task buttons
      insertAdminNotesBtn(id);

      const eventTitleEl = document.getElementById('eventTitle');
      if (eventTitleEl) eventTitleEl.textContent = table.title;

      ['eventSummary', 'location', 'weather', 'attendees', 'budget'].forEach(field => {
        const el = document.getElementById(field === 'eventSummary' ? 'summary' : field);
        if (el) {
          const div = document.createElement('div');
          div.id = field === 'eventSummary' ? 'summary' : field;
          div.dataset.value = general[field === 'eventSummary' ? 'summary' : field] || '';
          div.className = 'read-only';
          
          // Make location field clickable to open maps
          if (field === 'location') {
            div.innerHTML = createLinkHTML(general.location || '', 'address');
          } else if (field === 'eventSummary') {
            // Display rich HTML content with URL linkification
            const summaryContent = general.summary || '';
            if (summaryContent.includes('<') && summaryContent.includes('>')) {
              // Contains HTML tags, treat as rich content
              div.innerHTML = linkifyText(summaryContent);
              div.classList.add('rich-content');
            } else {
              // Plain text, apply basic linkification
              div.innerHTML = linkifyText(summaryContent);
            }
          } else {
            div.textContent = general[field] || '';
          }
          
          el.replaceWith(div);
        }
      });

      // Update weather icon after loading data
      updateWeatherIcon();
      
      // Store original date values for non-owners
      const startDate = general.start?.split('T')[0] || '';
      const endDate = general.end?.split('T')[0] || '';
      
      // Set values for date fields
      document.getElementById('start').value = startDate;
      document.getElementById('end').value = endDate;
      
      // 🔒 Make date fields readonly for non-owners
      if (!isOwner) {
        const startInput = document.getElementById('start');
        const endInput = document.getElementById('end');
        
        // Make inputs readonly
        startInput.setAttribute('readonly', 'readonly');
        endInput.setAttribute('readonly', 'readonly');
        
        // Add visual indicator
        startInput.classList.add('read-only-input');
        endInput.classList.add('read-only-input');
        
        // Prevent changes to the date inputs by adding event listeners
        startInput.addEventListener('change', function(e) {
          e.preventDefault();
          this.value = startDate;
          alert('Not authorized. Only owners can change event dates.');
          return false;
        });
        
        endInput.addEventListener('change', function(e) {
          e.preventDefault();
          this.value = endDate;
          alert('Not authorized. Only owners can change event dates.');
          return false;
        });
        
        // Prevent click events on date inputs
        startInput.addEventListener('mousedown', function(e) {
          if (!isOwner) {
            e.preventDefault();
            alert('Not authorized. Only owners can change event dates.');
            return false;
          }
        });
        
        endInput.addEventListener('mousedown', function(e) {
          if (!isOwner) {
            e.preventDefault();
            alert('Not authorized. Only owners can change event dates.');
            return false;
          }
        });
      }

      const contactRows = document.getElementById('contactRows');
      contactRows.innerHTML = '';
      (general.contacts || []).forEach(data => renderContactRow(data, true));

      const locationRows = document.getElementById('locationsRows');
      locationRows.innerHTML = '';
      (general.locations || []).forEach(data => renderLocationRow(data, true));

      document.getElementById('editBtn').style.display = isOwner ? 'inline-block' : 'none';
      document.querySelectorAll('.add-row-btn').forEach(btn => {
        btn.style.display = isOwner ? 'inline-block' : 'none';
      });
      
      // View Only indicator removed - not needed
      
      // Set up navigation using the centralized function from app.js
      if (window.setupBottomNavigation) {
        window.setupBottomNavigation(null, tableId, 'general'); // Changed page to general
      }
      
      // Initialize clock functionality after DOM is ready
      // Use multiple attempts to ensure DOM elements are available
      console.log('[CLOCK] Starting clock initialization, isOwner:', isOwner, 'isAdmin:', isAdmin());
      console.log('[CLOCK] Page container content:', document.getElementById('page-container')?.innerHTML?.substring(0, 200));
      
      let clockInitAttempts = 0;
      const tryInitClock = () => {
        clockInitAttempts++;
        const clockBtn = document.getElementById('clockIconBtn');
        const clockContainer = document.getElementById('clockIconContainer');
        
        console.log(`[CLOCK] Attempt ${clockInitAttempts} - clockBtn:`, !!clockBtn, 'clockContainer:', !!clockContainer);
        console.log(`[CLOCK] Clock button element:`, clockBtn);
        
        if (clockBtn) {
          console.log('[CLOCK] Clock button found, initializing...');
          initializeClock();
        } else if (clockInitAttempts < 10) { // Increased attempts
          console.log(`[CLOCK] Clock button not ready yet (attempt ${clockInitAttempts}), retrying...`);
          setTimeout(tryInitClock, 300); // Increased delay
        } else {
          console.error('[CLOCK] Failed to find clock button after 10 attempts');
          console.error('[CLOCK] DOM state:', {
            clockContainer: !!document.getElementById('clockIconContainer'),
            clockBtn: !!document.getElementById('clockIconBtn'),
            adminContainer: !!document.getElementById('adminNotesBtnContainer'),
            pageContainer: !!document.getElementById('page-container'),
            generalPage: !!document.querySelector('.general-page')
          });
          console.error('[CLOCK] All elements with schedule class:', document.querySelectorAll('.material-symbols-outlined'));
        }
      };
      setTimeout(tryInitClock, 500); // Increased initial delay
    })
    .catch(err => console.error('Error loading event:', err));
}

async function saveGeneralInfo() {
  // 🔒 Check if user is owner before proceeding
  if (!isOwner) {
    return alert("Not authorized. Only owners can edit event information.");
  }

  const getText = id => {
    if (id === 'summary') {
      // Get content from TinyMCE editor if active, otherwise from read-only div
      const summaryEditorContainer = document.getElementById('summaryEditorContainer');
      if (summaryEditorContainer && summaryEditorContainer.style.display !== 'none') {
        // Check if TinyMCE is available
        const content = getTinyMCEContent();
        if (content !== '') {
          console.log('Getting content from TinyMCE for save:', content);
          return content;
        } else {
          // Fallback to textarea if TinyMCE failed
          const fallbackTextarea = document.getElementById('summaryFallback');
          if (fallbackTextarea) {
            console.log('Getting content from fallback textarea for save:', fallbackTextarea.value);
            return fallbackTextarea.value.trim();
          }
        }
      } else {
        // Fall back to the read-only div
        const el = document.getElementById(id);
        return el?.dataset.value || el?.innerHTML || '';
      }
    } else {
      const el = document.getElementById(id);
      return el?.tagName === 'TEXTAREA' ? el.value.trim() : el?.textContent.trim() || '';
    }
  };

  // Get event title from input if in edit mode, otherwise from h2 element
  const getEventTitle = () => {
    const titleInput = document.getElementById('eventTitleInput');
    if (titleInput) {
      return titleInput.value.trim();
    }
    const titleEl = document.getElementById('eventTitle');
    return titleEl?.textContent.trim() || '';
  };

  // Create the general data object with the exact schema structure expected by the backend
  const generalData = {
    summary: getText('summary'),
    location: getText('location'),
    weather: getText('weather'),
    attendees: getText('attendees'),
    budget: getText('budget'),
    start: document.getElementById('start')?.value || '',
    end: document.getElementById('end')?.value || '',
    contacts: collectContacts(),
    locations: collectLocations()
  };

  // Update the weather icon before saving
  updateWeatherIcon();

  console.log('Saving general data:', generalData);

  try {
    // Get the current table ID directly from the URL or localStorage
    const currentTableId = params.get('id') || localStorage.getItem('eventId');
    
    if (!currentTableId) {
      throw new Error('No table ID found. Cannot save data.');
    }
    
    console.log('Saving to table ID:', currentTableId);
    
    // Get the event title
    const eventTitle = getEventTitle();
    
    // Key difference: Wrap the generalData in a "general" property to match the backend API expectation
    const res = await fetch(`${API_BASE}/api/tables/${currentTableId}/general`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': window.token
      },
      // This is the key fix - the server.js API expects a body with a "general" property and title
      body: JSON.stringify({ 
        title: eventTitle,
        general: generalData 
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Server error response:', errorText);
      throw new Error(errorText || 'Server returned an error');
    }
    
    console.log('Save successful!');
    window.location.reload();
  } catch (err) {
    console.error('Save error:', err);
    alert("Failed to save: " + (err.message || "Unknown error occurred"));
  }
}

function switchToEdit() {
  if (!isOwner) return;

  console.log('[GENERAL] switchToEdit called');

  // Handle event title editing
  const eventTitleEl = document.getElementById('eventTitle');
  if (eventTitleEl) {
    const currentTitle = eventTitleEl.textContent || '';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'eventTitleInput';
    titleInput.value = currentTitle;
    titleInput.style.cssText = `
      width: 100%;
      max-width: 600px;
      font-size: 1.5rem;
      font-weight: 600;
      color: #333;
      text-align: center;
      border: 2px solid #cc0007;
      border-radius: 8px;
      padding: 8px 16px;
      background: #fff;
      box-shadow: 0 2px 8px rgba(204, 0, 7, 0.1);
      outline: none;
      font-family: inherit;
      margin: 0 auto;
      display: block;
    `;
    titleInput.dataset.originalValue = currentTitle;
    eventTitleEl.replaceWith(titleInput);
  }

  ['eventSummary', 'location', 'weather', 'attendees', 'budget'].forEach(id => {
    const element = document.getElementById(id === 'eventSummary' ? 'summary' : id);
    if (!element) return;
    
    if (id === 'eventSummary') {
      // Handle event summary with TinyMCE editor
      const summaryEditorContainer = document.getElementById('summaryEditorContainer');
      
      if (summaryEditorContainer) {
        // Hide the read-only div and show the editor
        element.style.display = 'none';
        summaryEditorContainer.style.display = 'block';
        
        // Get existing HTML content for editing
        const currentContent = element.dataset.value || element.innerHTML || '';
        
        // Initialize TinyMCE with current content
        initializeTinyMCE(currentContent).then(() => {
          console.log('TinyMCE editor ready with content');
        }).catch(error => {
          console.error('Failed to initialize TinyMCE:', error);
          // Fallback to a simple textarea if TinyMCE fails
          const fallbackTextarea = document.createElement('textarea');
          fallbackTextarea.id = 'summaryFallback';
          fallbackTextarea.value = htmlToPlainText(currentContent);
          fallbackTextarea.style.width = '100%';
          fallbackTextarea.style.minHeight = '200px';
          fallbackTextarea.style.fontFamily = 'inherit';
          fallbackTextarea.style.fontSize = '14px';
          fallbackTextarea.style.padding = '10px';
          fallbackTextarea.style.border = '1px solid #ccc';
          fallbackTextarea.style.borderRadius = '4px';
          summaryEditorContainer.appendChild(fallbackTextarea);
        });
        
      } else {
        console.error('summaryEditorContainer element not found');
      }
    } else {
      // Handle other fields with regular textareas
      if (element.tagName === 'TEXTAREA') {
        console.log(`[GENERAL] ${id} is already a textarea, preserving value:`, element.value);
        return; // Already in edit mode, don't change anything
      }
      
      console.log(`[GENERAL] Converting ${id} from div to textarea`);
      // Convert div to textarea
      const textarea = document.createElement('textarea');
      textarea.id = id;
      textarea.value = element.dataset.value || element.textContent || '';
      element.replaceWith(textarea);
      autoResizeTextarea(textarea);
      
      // Add input handler for weather field to update icon
      if (id === 'weather') {
        textarea.addEventListener('input', updateWeatherIcon);
      }
    }
  });

  const contactData = collectContacts();
  document.getElementById('contactRows').innerHTML = '';
  contactData.forEach(data => renderContactRow(data, false));

  const locationData = collectLocations();
  document.getElementById('locationsRows').innerHTML = '';
  locationData.forEach(data => renderLocationRow(data, false));

  document.querySelectorAll('.add-row-btn').forEach(btn => {
    btn.style.display = 'inline-block';
  });

  const editBtn = document.getElementById('editBtn');
  if (editBtn) editBtn.style.display = 'none';

  // Auto-resize all textareas after rendering
  document.querySelectorAll('textarea').forEach(autoResizeTextarea);
}

function addContactRow() {
  // Check if we're already in edit mode by looking for TinyMCE editor or textareas
  const summaryEditorContainer = document.getElementById('summaryEditorContainer');
  const isAlreadyInEditMode = summaryEditorContainer && summaryEditorContainer.style.display !== 'none';
  
  console.log('[GENERAL] addContactRow called, already in edit mode:', isAlreadyInEditMode);
  
  if (!isAlreadyInEditMode) {
    console.log('[GENERAL] Switching to edit mode before adding contact row');
    switchToEdit();
  } else {
    console.log('[GENERAL] Already in edit mode, preserving existing data');
  }
  renderContactRow({}, false);
}

function addLocationRow() {
  // Check if we're already in edit mode by looking for TinyMCE editor or textareas
  const summaryEditorContainer = document.getElementById('summaryEditorContainer');
  const isAlreadyInEditMode = summaryEditorContainer && summaryEditorContainer.style.display !== 'none';
  
  console.log('[GENERAL] addLocationRow called, already in edit mode:', isAlreadyInEditMode);
  
  if (!isAlreadyInEditMode) {
    console.log('[GENERAL] Switching to edit mode before adding location row');
    switchToEdit();
  } else {
    console.log('[GENERAL] Already in edit mode, preserving existing data');
  }
  renderLocationRow({}, false);
}


// ✅ Ensure it's globally accessible for SPA router
window.initPage = initPage;

// Cleanup function for when leaving the page
window.addEventListener('beforeunload', function() {
  cleanupTinyMCE();
});
window.addContactRow = addContactRow;
window.addLocationRow = addLocationRow;
window.saveGeneralInfo = saveGeneralInfo;
window.switchToEdit = switchToEdit;

// CLOCK ICON LOGIC
function showTimeModal() {
  console.log('[CLOCK] showTimeModal called - user type:', {isOwner, isAdmin: isAdmin()});
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'timeModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.95);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    cursor: pointer;
    backdrop-filter: blur(5px);
  `;

  // Create time container
  const timeContainer = document.createElement('div');
  timeContainer.style.cssText = `
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 24px;
    padding: 60px 40px;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
  `;

  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '×';
  closeBtn.style.cssText = `
    position: absolute;
    top: 20px;
    right: 25px;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    font-size: 40px;
    color: white;
    cursor: pointer;
    padding: 10px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.3s ease;
  `;
  closeBtn.onmouseover = () => closeBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
  closeBtn.onmouseout = () => closeBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeTimeModal();
  };

  // Create time display
  const timeDisplay = document.createElement('div');
  timeDisplay.id = 'modalTimeDisplay';
  timeDisplay.style.cssText = `
    font-size: clamp(2.5rem, 8vw, 4rem);
    font-weight: 300;
    color: white;
    text-align: center;
    font-family: 'Roboto', monospace;
    letter-spacing: 0.1em;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    margin-bottom: 20px;
  `;

  // Create date display
  const dateDisplay = document.createElement('div');
  dateDisplay.id = 'modalDateDisplay';
  dateDisplay.style.cssText = `
    font-size: clamp(1rem, 4vw, 1.5rem);
    font-weight: 400;
    color: rgba(255, 255, 255, 0.9);
    text-align: center;
    margin-bottom: 30px;
  `;

  // Create timezone display
  const timezoneDisplay = document.createElement('div');
  timezoneDisplay.style.cssText = `
    font-size: 1rem;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.7);
    text-align: center;
  `;

  function updateTime() {
    const now = new Date();
    
    // Format time
    timeDisplay.textContent = now.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    });
    
    // Format date
    dateDisplay.textContent = now.toLocaleDateString([], { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Format timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    timezoneDisplay.textContent = timezone.replace('_', ' ');
  }

  // Initial time update
  updateTime();
  
  // Start interval for live updates
  clockInterval = setInterval(updateTime, 1000);

  // Add elements to container
  timeContainer.appendChild(closeBtn);
  timeContainer.appendChild(timeDisplay);
  timeContainer.appendChild(dateDisplay);
  timeContainer.appendChild(timezoneDisplay);

  // Add container to modal
  modal.appendChild(timeContainer);

  // Add modal to document
  document.body.appendChild(modal);

  // Close modal when clicking outside
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeTimeModal();
    }
  };

  // Prevent scrolling when modal is open
  document.body.style.overflow = 'hidden';

  // Handle ESC key
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      closeTimeModal();
    }
  };
  document.addEventListener('keydown', handleEsc);
  
  // Store the event listener for cleanup
  modal.escHandler = handleEsc;

  console.log('[CLOCK] Time modal opened');
}

function closeTimeModal() {
  const modal = document.getElementById('timeModal');
  if (modal) {
    // Clear the interval
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
    
    // Remove ESC key listener
    if (modal.escHandler) {
      document.removeEventListener('keydown', modal.escHandler);
    }
    
    modal.remove();
    document.body.style.overflow = '';
    console.log('[CLOCK] Time modal closed');
  }
}

function initializeClock() {
  const clockBtn = document.getElementById('clockIconBtn');
  
  console.log('[CLOCK] initializeClock called, button found:', !!clockBtn);
  console.log('[CLOCK] Button element details:', clockBtn);

  if (clockBtn) {
    console.log('[CLOCK] Clock button found, initializing click handler');
    console.log('[CLOCK] Button is visible:', clockBtn.offsetParent !== null);
    console.log('[CLOCK] Button computed style:', window.getComputedStyle(clockBtn).display);
    
    // Remove any existing listeners to prevent duplicates
    if (window.clockButtonHandler) {
      clockBtn.removeEventListener('click', window.clockButtonHandler);
      console.log('[CLOCK] Removed existing click handler');
    }
    
    // Create named handler for easier removal
    window.clockButtonHandler = (e) => {
      console.log('[CLOCK] *** CLOCK BUTTON CLICKED *** - user:', {isOwner, isAdmin: isAdmin()});
      e.stopPropagation();
      e.preventDefault();
      showTimeModal();
    };
    
    clockBtn.addEventListener('click', window.clockButtonHandler);
    
    // Test click handler by adding a temporary test
    clockBtn.addEventListener('mousedown', () => {
      console.log('[CLOCK] Mouse down detected on clock button');
    });
    
    console.log('[CLOCK] Clock handlers attached successfully');
    console.log('[CLOCK] Button has event listeners:', clockBtn);
  } else {
    console.warn('[CLOCK] Clock button not found in initializeClock');
  }
}
})();
