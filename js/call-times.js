// Call Times Page - Consolidated view of all crew call times
(function() {
  'use strict';
  
  const API_BASE = window.API_BASE || '';
  const ITEMS_PER_PAGE = 50;
  
  let allCallTimes = [];
  let filteredCallTimes = [];
  let currentPage = 1;
  let isAdmin = false;
  
  // Filter states
  let statusFilter = localStorage.getItem('callTimes_statusFilter') || 'upcoming';
  let dateFilter = localStorage.getItem('callTimes_dateFilter') || 'all';
  let myCallsFilter = localStorage.getItem('callTimes_myCallsFilter') || 'all';
  let searchQuery = '';
  let customStartDate = localStorage.getItem('callTimes_customStart') || '';
  let customEndDate = localStorage.getItem('callTimes_customEnd') || '';
  
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
  
  // Format hours for display
  function formatHours(hours) {
    if (!hours && hours !== 0) return '—';
    return `${hours}`;
  }
  
  // Format location (city, state)
  function formatLocation(city, state) {
    if (!city && !state) return '—';
    if (city && state) return `${city}, ${state}`;
    return city || state;
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
  
  // Load call times from API
  async function loadCallTimes(showLoading = true) {
    const loadingEl = document.getElementById('callTimesLoading');
    const emptyEl = document.getElementById('callTimesEmpty');
    const tableBody = document.getElementById('callTimesTableBody');
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
      if (myCallsFilter === 'mine') {
        params.append('myCalls', 'true');
      }
      if (dateFilter === 'custom' && customStartDate && customEndDate) {
        params.append('customStart', customStartDate);
        params.append('customEnd', customEndDate);
      }
      
      const response = await fetch(`${API_BASE}/api/calltimes/all?${params.toString()}`, {
        headers: { 'Authorization': token }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch call times');
      }
      
      const data = await response.json();
      allCallTimes = data.callTimes || [];
      isAdmin = data.isAdmin || false;
      
      // Show/hide admin-only filter
      const myCallsFilterWrapper = document.getElementById('myCallsFilterWrapper');
      if (myCallsFilterWrapper) {
        myCallsFilterWrapper.style.display = isAdmin ? 'block' : 'none';
      }
      
      // Add class to page for non-admin styling (hide Name column)
      const callTimesPage = document.querySelector('.call-times-page');
      if (callTimesPage) {
        if (isAdmin) {
          callTimesPage.classList.remove('non-admin');
        } else {
          callTimesPage.classList.add('non-admin');
        }
      }
      
      // Apply client-side search filter
      applyFilters();
      
    } catch (err) {
      console.error('Error loading call times:', err);
      if (tableBody) tableBody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('p').textContent = 'Error loading call times. Please try again.';
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }
  
  // Apply filters and render
  function applyFilters() {
    // Start with all call times
    filteredCallTimes = [...allCallTimes];
    
    // Apply status filter client-side (using user's timezone)
    if (statusFilter !== 'all') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      
      filteredCallTimes = filteredCallTimes.filter(call => {
        const callDate = parseLocalDate(call.date);
        if (!callDate) return true; // Include calls without dates
        
        if (statusFilter === 'live') {
          // Live = call date is today (in user's timezone)
          return callDate >= todayStart && callDate <= todayEnd;
        } else if (statusFilter === 'upcoming') {
          // Upcoming = call date is today or in the future (in user's timezone)
          return callDate >= todayStart;
        } else if (statusFilter === 'past') {
          // Past = call date is before today (in user's timezone)
          return callDate < todayStart;
        }
        return true;
      });
    }
    
    // Apply search filter client-side
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredCallTimes = filteredCallTimes.filter(call => {
        return (
          (call.name && call.name.toLowerCase().includes(query)) ||
          (call.role && call.role.toLowerCase().includes(query)) ||
          (call.notes && call.notes.toLowerCase().includes(query)) ||
          (call.event && call.event.title && call.event.title.toLowerCase().includes(query)) ||
          (call.date && call.date.includes(query))
        );
      });
    }
    
    // Reset to page 1 when filters change
    currentPage = 1;
    
    // Update stats
    updateStats();
    
    // Render table
    renderCallTimes();
    
    // Update pagination
    updatePagination();
  }
  
  // Update stats display
  function updateStats() {
    const statsEl = document.getElementById('callTimesStats');
    if (statsEl) {
      const total = filteredCallTimes.length;
      statsEl.textContent = `${total} call time${total !== 1 ? 's' : ''}`;
    }
  }
  
  // Render call times table
  function renderCallTimes() {
    const tableBody = document.getElementById('callTimesTableBody');
    const emptyEl = document.getElementById('callTimesEmpty');
    const loadingEl = document.getElementById('callTimesLoading');
    
    if (!tableBody) return;
    
    if (loadingEl) loadingEl.style.display = 'none';
    
    if (filteredCallTimes.length === 0) {
      tableBody.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'flex';
        emptyEl.querySelector('h3').textContent = searchQuery ? 'No matching call times' : 'No call times found';
        emptyEl.querySelector('p').textContent = searchQuery ? 'Try adjusting your search or filters' : 'Your crew call times will appear here';
      }
      return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';
    
    // Calculate pagination
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const pageCallTimes = filteredCallTimes.slice(startIndex, endIndex);
    
    tableBody.innerHTML = pageCallTimes.map(call => {
      const dateStatus = getDateStatus(call.date);
      
      return `
        <tr class="call-time-row">
          <td class="col-name">
            <span class="crew-name">${escapeHtml(call.name || '—')}</span>
          </td>
          <td class="col-date">
            <div class="date-cell-content">
              <span class="date-text">${formatDate(call.date)}</span>
              ${dateStatus.label ? `<span class="date-badge ${dateStatus.class}">${dateStatus.label}</span>` : ''}
            </div>
          </td>
          <td class="col-start">${formatTime(call.startTime)}</td>
          <td class="col-end">${formatTime(call.endTime)}</td>
          <td class="col-hours">${formatHours(call.totalHours)}</td>
          <td class="col-role">
            <span class="role-badge">${escapeHtml(call.role || '—')}</span>
          </td>
          <td class="col-notes">
            <span class="notes-text" title="${escapeHtml(call.notes || '')}">${escapeHtml(call.notes || '—')}</span>
          </td>
          <td class="col-event">
            <a href="#" class="event-link" onclick="window.navigate('crew', '${call.event._id}'); return false;">
              ${escapeHtml(call.event.title || 'Untitled Event')}
            </a>
          </td>
          <td class="col-location">
            <span class="location-text">${formatLocation(call.event.city, call.event.state)}</span>
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
    
    const totalPages = Math.ceil(filteredCallTimes.length / ITEMS_PER_PAGE);
    
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
      localStorage.setItem('callTimes_statusFilter', value);
      loadCallTimes(false);
    }, getStatusFilterLabel);
    
    // Date filter
    setupDropdown('dateFilterBtn', 'dateFilterDropdown', 'dateFilterLabel', (value) => {
      if (value === 'custom') {
        openCustomDateModal();
        return;
      }
      dateFilter = value;
      localStorage.setItem('callTimes_dateFilter', value);
      loadCallTimes(false);
    }, getDateFilterLabel);
    
    // My calls filter (admin only)
    setupDropdown('myCallsFilterBtn', 'myCallsFilterDropdown', 'myCallsFilterLabel', (value) => {
      myCallsFilter = value;
      localStorage.setItem('callTimes_myCallsFilter', value);
      loadCallTimes(false);
    }, getMyCallsFilterLabel);
    
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
      'live': 'Live (Today)',
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
  
  function getMyCallsFilterLabel(value) {
    const labels = {
      'all': 'All Crew',
      'mine': 'My Calls Only'
    };
    return labels[value] || 'All Crew';
  }
  
  function updateFilterLabels() {
    const statusLabel = document.getElementById('statusFilterLabel');
    const dateLabel = document.getElementById('dateFilterLabel');
    const myCallsLabel = document.getElementById('myCallsFilterLabel');
    
    if (statusLabel) statusLabel.textContent = getStatusFilterLabel(statusFilter);
    if (dateLabel) dateLabel.textContent = getDateFilterLabel(dateFilter);
    if (myCallsLabel) myCallsLabel.textContent = getMyCallsFilterLabel(myCallsFilter);
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
    
    localStorage.setItem('callTimes_dateFilter', 'custom');
    localStorage.setItem('callTimes_customStart', start);
    localStorage.setItem('callTimes_customEnd', end);
    
    const dateLabel = document.getElementById('dateFilterLabel');
    if (dateLabel) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const options = { month: 'short', day: 'numeric' };
      dateLabel.textContent = `${startDate.toLocaleDateString('en-US', options)} - ${endDate.toLocaleDateString('en-US', options)}`;
    }
    
    closeAllDropdowns();
    closeCustomDateModal();
    loadCallTimes(false);
  }
  
  // Setup search
  function setupSearch() {
    const searchInput = document.getElementById('callTimesSearch');
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
          renderCallTimes();
          updatePagination();
          scrollToTop();
        }
      };
    }
    
    if (nextBtn) {
      nextBtn.onclick = () => {
        const totalPages = Math.ceil(filteredCallTimes.length / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
          currentPage++;
          renderCallTimes();
          updatePagination();
          scrollToTop();
        }
      };
    }
  }
  
  function scrollToTop() {
    const container = document.querySelector('.call-times-table-container');
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
    console.log('[call-times] Initializing page...');
    
    // Setup UI
    setupFilters();
    setupSearch();
    setupPagination();
    setupModalButtons();
    setupBackButton();
    setupOutsideClick();
    
    // Load data
    await loadCallTimes();
    
    console.log('[call-times] Page initialized');
  }
  
  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPage);
  } else {
    initPage();
  }
  
})();
