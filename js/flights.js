// Flights Page - Consolidated view of all flight data
(function() {
  'use strict';
  
  const API_BASE = window.API_BASE || '';
  const ITEMS_PER_PAGE = 50;
  
  let allFlights = [];
  let filteredFlights = [];
  let currentPage = 1;
  let isAdmin = false;
  let isLead = false;
  
  // Filter states
  let statusFilter = localStorage.getItem('flights_statusFilter') || 'upcoming';
  let dateFilter = localStorage.getItem('flights_dateFilter') || 'all';
  let searchQuery = '';
  let customStartDate = localStorage.getItem('flights_customStart') || '';
  let customEndDate = localStorage.getItem('flights_customEnd') || '';
  
  // Parse date string as local date
  function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0);
    }
    return new Date(dateStr);
  }
  
  // Format date for display
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const date = parseLocalDate(dateStr);
    if (!date || isNaN(date.getTime())) return dateStr;
    
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }
  
  // Format time for display (convert to AM/PM)
  function formatTime(timeStr) {
    if (!timeStr) return '—';
    
    // Parse time string (assuming format like "14:30" or "9:00")
    const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return timeStr;
    
    let hours = parseInt(match[1]);
    const minutes = match[2];
    
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12; // Convert to 12-hour format, 0 becomes 12
    
    return `${hours}:${minutes} ${ampm}`;
  }
  
  // Get date status badge
  function getDateStatus(dateStr) {
    if (!dateStr) return { label: '', class: '' };
    
    const date = parseLocalDate(dateStr);
    if (!date) return { label: '', class: '' };
    
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    if (date >= todayStart && date <= todayEnd) {
      return { label: 'TODAY', class: 'live' };
    } else if (date > todayEnd) {
      return { label: 'UPCOMING', class: 'upcoming' };
    } else {
      return { label: 'PAST', class: 'past' };
    }
  }
  
  // Load flights from API
  async function loadFlights(showLoading = true) {
    const loadingEl = document.getElementById('flightsLoading');
    const emptyEl = document.getElementById('flightsEmpty');
    const tableBody = document.getElementById('flightsTableBody');
    const paginationContainer = document.getElementById('paginationContainer');
    
    if (!tableBody) return;
    
    if (showLoading && loadingEl) {
      loadingEl.style.display = 'flex';
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (paginationContainer) paginationContainer.style.display = 'none';
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No token found');
        return;
      }
      
      // Build query params
      // NOTE: We don't send status filter to backend anymore - it's handled client-side
      // to avoid timezone issues between server and user
      const params = new URLSearchParams();
      params.append('dateFilter', dateFilter);
      if (dateFilter === 'custom' && customStartDate && customEndDate) {
        params.append('customStart', customStartDate);
        params.append('customEnd', customEndDate);
      }
      
      const response = await fetch(`${API_BASE}/api/flights/all?${params.toString()}`, {
        headers: { 'Authorization': token }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch flights');
      }
      
      const data = await response.json();
      allFlights = data.flights || [];
      isAdmin = data.isAdmin || false;
      isLead = data.isLead || false;
      
      // Add class to page for non-admin/non-lead styling (hide Name column)
      const flightsPage = document.querySelector('.flights-page');
      if (flightsPage) {
        if (isAdmin || isLead) {
          flightsPage.classList.remove('non-admin');
        } else {
          flightsPage.classList.add('non-admin');
        }
      }
      
      // Apply client-side search filter
      applyFilters();
      
    } catch (err) {
      console.error('Error loading flights:', err);
      if (tableBody) tableBody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('p').textContent = 'Error loading flights. Please try again.';
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }
  
  // Apply filters and render
  function applyFilters() {
    // Start with all flights
    filteredFlights = [...allFlights];
    
    // Apply status filter client-side (using user's timezone)
    if (statusFilter !== 'all') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      
      filteredFlights = filteredFlights.filter(flight => {
        const flightDate = parseLocalDate(flight.date);
        if (!flightDate) return true; // Include flights without dates
        
        if (statusFilter === 'upcoming') {
          // Upcoming = flight date is today or in the future (in user's timezone)
          return flightDate >= todayStart;
        } else if (statusFilter === 'past') {
          // Past = flight date is before today (in user's timezone)
          return flightDate < todayStart;
        }
        return true;
      });
    }
    
    // Apply search filter client-side
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredFlights = filteredFlights.filter(flight => {
        return (
          (flight.name && flight.name.toLowerCase().includes(query)) ||
          (flight.airline && flight.airline.toLowerCase().includes(query)) ||
          (flight.fromTo && flight.fromTo.toLowerCase().includes(query)) ||
          (flight.ref && flight.ref.toLowerCase().includes(query)) ||
          (flight.event && flight.event.title && flight.event.title.toLowerCase().includes(query)) ||
          (flight.date && flight.date.includes(query)) ||
          (flight.flightType && flight.flightType.toLowerCase().includes(query))
        );
      });
    }
    
    // Reset to page 1 when filters change
    currentPage = 1;
    
    // Update stats
    updateStats();
    
    // Render table
    renderFlights();
    
    // Update pagination
    updatePagination();
  }
  
  // Update stats display
  function updateStats() {
    const statsEl = document.getElementById('flightsStats');
    if (statsEl) {
      const total = filteredFlights.length;
      statsEl.textContent = `${total} flight${total !== 1 ? 's' : ''}`;
    }
  }
  
  // Render flights table
  function renderFlights() {
    const tableBody = document.getElementById('flightsTableBody');
    const emptyEl = document.getElementById('flightsEmpty');
    const loadingEl = document.getElementById('flightsLoading');
    
    if (!tableBody) return;
    
    if (loadingEl) loadingEl.style.display = 'none';
    
    if (filteredFlights.length === 0) {
      tableBody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('h3').textContent = searchQuery ? 'No matching flights' : 'No flights found';
        emptyEl.querySelector('p').textContent = searchQuery ? 'Try adjusting your search or filters' : 'Your flight information will appear here';
      }
      return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    // Calculate pagination
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageFlights = filteredFlights.slice(startIndex, endIndex);
    
    tableBody.innerHTML = pageFlights.map(flight => {
      const dateStatus = getDateStatus(flight.date);
      
      // Flight type badge (outbound/return/one-way)
      let flightTypeBadge = '';
      if (flight.flightType === 'outbound') {
        flightTypeBadge = '<span class="flight-type-badge outbound">OUT</span>';
      } else if (flight.flightType === 'return') {
        flightTypeBadge = '<span class="flight-type-badge return">RET</span>';
      }
      
      return `
        <tr class="flight-row">
          <td class="col-date">
            <div class="date-cell-content">
              <span class="date-text">${formatDate(flight.date)}</span>
              ${dateStatus.label ? `<span class="date-badge ${dateStatus.class}">${dateStatus.label}</span>` : ''}
            </div>
          </td>
          <td class="col-depart">${formatTime(flight.depart)}</td>
          <td class="col-arrive">${formatTime(flight.arrive)}</td>
          <td class="col-name">
            <span class="crew-name">${escapeHtml(flight.name || '—')}</span>
          </td>
          <td class="col-airline">${escapeHtml(flight.airline || '—')}</td>
          <td class="col-fromto">
            <div class="fromto-cell-content">
              ${escapeHtml(flight.fromTo || '—')}
              ${flightTypeBadge}
            </div>
          </td>
          <td class="col-ref">${escapeHtml(flight.ref || '—')}</td>
          <td class="col-event">
            <a href="#" class="event-link" onclick="window.navigate('travel-accommodation', '${flight.event._id}'); return false;">
              ${escapeHtml(flight.event.title || 'Untitled Event')}
            </a>
          </td>
        </tr>
      `;
    }).join('');
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Update pagination controls
  function updatePagination() {
    const paginationContainer = document.getElementById('paginationContainer');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (!paginationContainer) return;
    
    const totalPages = Math.ceil(filteredFlights.length / ITEMS_PER_PAGE);
    
    if (totalPages <= 1) {
      paginationContainer.style.display = 'none';
      return;
    }
    
    paginationContainer.style.display = 'flex';
    
    if (paginationInfo) {
      paginationInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
    
    if (prevBtn) {
      prevBtn.disabled = currentPage <= 1;
    }
    
    if (nextBtn) {
      nextBtn.disabled = currentPage >= totalPages;
    }
  }
  
  // Setup filter dropdowns
  function setupFilters() {
    // Status filter
    setupDropdown('statusFilterBtn', 'statusFilterDropdown', 'statusFilterLabel', (value) => {
      statusFilter = value;
      localStorage.setItem('flights_statusFilter', value);
      loadFlights(false);
    }, getStatusFilterLabel);
    
    // Date filter
    setupDropdown('dateFilterBtn', 'dateFilterDropdown', 'dateFilterLabel', (value) => {
      if (value === 'custom') {
        openCustomDateModal();
        return;
      }
      dateFilter = value;
      localStorage.setItem('flights_dateFilter', value);
      loadFlights(false);
    }, getDateFilterLabel);
    
    // Initialize filter labels
    updateFilterLabels();
  }
  
  function setupDropdown(btnId, dropdownId, labelId, onSelect, getLabelFn) {
    const btn = document.getElementById(btnId);
    const dropdown = document.getElementById(dropdownId);
    
    if (!btn || !dropdown) return;
    
    btn.onclick = (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      dropdown.classList.toggle('show');
    };
    
    dropdown.querySelectorAll('.filter-option').forEach(option => {
      option.onclick = (e) => {
        e.stopPropagation();
        const value = option.dataset.value;
        onSelect(value);
        
        const label = document.getElementById(labelId);
        if (label && getLabelFn) {
          label.textContent = getLabelFn(value);
        }
        
        dropdown.classList.remove('show');
      };
    });
  }
  
  function closeAllDropdowns() {
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('show'));
  }
  
  function getStatusFilterLabel(value) {
    const labels = {
      'all': 'All',
      'upcoming': 'Upcoming',
      'past': 'Past'
    };
    return labels[value] || 'All';
  }
  
  function getDateFilterLabel(value) {
    const labels = {
      'all': 'All Time',
      'this-month': 'This Month',
      'last-month': 'Last Month',
      'last-3-months': 'Last 3 Months',
      'this-year': 'This Year',
      'last-year': 'Last Year',
      'custom': 'Custom Range'
    };
    return labels[value] || 'All Time';
  }
  
  function updateFilterLabels() {
    const statusLabel = document.getElementById('statusFilterLabel');
    const dateLabel = document.getElementById('dateFilterLabel');
    
    if (statusLabel) statusLabel.textContent = getStatusFilterLabel(statusFilter);
    if (dateLabel) dateLabel.textContent = getDateFilterLabel(dateFilter);
  }
  
  // Custom date modal functions
  function openCustomDateModal() {
    const modal = document.getElementById('customDateModal');
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    
    if (modal) {
      modal.style.display = 'flex';
      
      // Pre-fill with saved values or defaults
      if (startInput) {
        startInput.value = customStartDate || '';
      }
      if (endInput) {
        endInput.value = customEndDate || '';
      }
    }
  }
  
  function closeCustomDateModal() {
    const modal = document.getElementById('customDateModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }
  
  function applyCustomDateRange() {
    const startInput = document.getElementById('customStartDate');
    const endInput = document.getElementById('customEndDate');
    
    if (!startInput || !endInput) return;
    
    const start = startInput.value;
    const end = endInput.value;
    
    if (!start || !end) {
      alert('Please select both start and end dates');
      return;
    }
    
    if (new Date(start) > new Date(end)) {
      alert('Start date must be before end date');
      return;
    }
    
    customStartDate = start;
    customEndDate = end;
    dateFilter = 'custom';
    
    localStorage.setItem('flights_dateFilter', 'custom');
    localStorage.setItem('flights_customStart', start);
    localStorage.setItem('flights_customEnd', end);
    
    const dateLabel = document.getElementById('dateFilterLabel');
    if (dateLabel) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const options = { month: 'short', day: 'numeric' };
      dateLabel.textContent = `${startDate.toLocaleDateString('en-US', options)} - ${endDate.toLocaleDateString('en-US', options)}`;
    }
    
    closeAllDropdowns();
    closeCustomDateModal();
    loadFlights(false);
  }
  
  // Setup search
  function setupSearch() {
    const searchInput = document.getElementById('flightsSearch');
    if (!searchInput) return;
    
    let searchTimeout;
    searchInput.oninput = () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        applyFilters();
      }, 300);
    };
  }
  
  // Setup pagination
  function setupPagination() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    
    if (prevBtn) {
      prevBtn.onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          renderFlights();
          updatePagination();
          scrollToTop();
        }
      };
    }
    
    if (nextBtn) {
      nextBtn.onclick = () => {
        const totalPages = Math.ceil(filteredFlights.length / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
          currentPage++;
          renderFlights();
          updatePagination();
          scrollToTop();
        }
      };
    }
  }
  
  function scrollToTop() {
    const container = document.querySelector('.flights-table-container');
    if (container) {
      container.scrollTop = 0;
    }
  }
  
  // Setup modal buttons
  function setupModalButtons() {
    const closeBtn = document.getElementById('closeCustomDateModal');
    const cancelBtn = document.getElementById('cancelCustomDateBtn');
    const applyBtn = document.getElementById('applyCustomDateBtn');
    const modal = document.getElementById('customDateModal');
    
    if (closeBtn) {
      closeBtn.onclick = closeCustomDateModal;
    }
    
    if (cancelBtn) {
      cancelBtn.onclick = closeCustomDateModal;
    }
    
    if (applyBtn) {
      applyBtn.onclick = applyCustomDateRange;
    }
    
    // Close modal on outside click
    if (modal) {
      modal.onclick = (e) => {
        if (e.target === modal) {
          closeCustomDateModal();
        }
      };
    }
  }
  
  // Setup back button
  function setupBackButton() {
    const backBtn = document.getElementById('backToEventsBtn');
    if (backBtn) {
      backBtn.onclick = () => {
        if (window.navigate) {
          window.navigate('events');
        } else {
          window.location.href = '/dashboard.html#events';
        }
      };
    }
  }
  
  // Close dropdowns on outside click
  function setupOutsideClick() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.filter-dropdown-wrapper')) {
        closeAllDropdowns();
      }
    });
  }
  
  // Initialize page
  async function initPage() {
    console.log('[flights] Initializing page...');
    
    // Setup UI
    setupFilters();
    setupSearch();
    setupPagination();
    setupModalButtons();
    setupBackButton();
    setupOutsideClick();
    
    // Load data
    await loadFlights();
    
    console.log('[flights] Page initialized');
  }
  
  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
  } else {
    initPage();
  }
  
})();
