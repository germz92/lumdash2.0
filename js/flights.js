/**
 * Flight Tracker JavaScript
 * Handles flight request creation, viewing, and management
 * Uses API calls to persist data in MongoDB
 */

(function() {
  'use strict';

  // API Base URL (from config.js)
  const API_BASE = window.API_BASE || '';

  // State
  let flightRequests = [];
  let bookedFlights = [];
  let passengers = [];
  let users = [];
  let selectedPassengers = [];
  let currentEditingRequest = null;
  let currentEditingPassenger = null;

  // DOM Elements
  const elements = {
    // Grids
    pendingRequestsGrid: document.getElementById('pendingRequestsGrid'),
    bookedFlightsGrid: document.getElementById('bookedFlightsGrid'),
    pendingEmptyState: document.getElementById('pendingEmptyState'),
    bookedEmptyState: document.getElementById('bookedEmptyState'),
    pendingCount: document.getElementById('pendingCount'),
    bookedCount: document.getElementById('bookedCount'),

    // Create Request Modal
    createRequestBtn: document.getElementById('createRequestBtn'),
    createRequestModal: document.getElementById('createRequestModal'),
    closeCreateModal: document.getElementById('closeCreateModal'),
    createRequestForm: document.getElementById('createRequestForm'),
    fromAirport: document.getElementById('fromAirport'),
    toAirport: document.getElementById('toAirport'),
    fromSuggestions: document.getElementById('fromSuggestions'),
    toSuggestions: document.getElementById('toSuggestions'),
    departDate: document.getElementById('departDate'),
    returnDate: document.getElementById('returnDate'),
    returnDateGroup: document.getElementById('returnDateGroup'),
    departTimePreference: document.getElementById('departTimePreference'),
    passengerSelect: document.getElementById('passengerSelect'),
    addPassengerBtn: document.getElementById('addPassengerBtn'),
    selectedPassengers: document.getElementById('selectedPassengers'),
    eventName: document.getElementById('eventName'),
    eventSuggestions: document.getElementById('eventSuggestions'),

    // View Request Modal
    viewRequestModal: document.getElementById('viewRequestModal'),
    closeViewModal: document.getElementById('closeViewModal'),
    viewRequestForm: document.getElementById('viewRequestForm'),
    viewEventName: document.getElementById('viewEventName'),
    viewDepartDate: document.getElementById('viewDepartDate'),
    viewReturnDate: document.getElementById('viewReturnDate'),
    viewReturnDateGroup: document.getElementById('viewReturnDateGroup'),
    viewDepartTimePreference: document.getElementById('viewDepartTimePreference'),
    viewReturnTimePreference: document.getElementById('viewReturnTimePreference'),
    viewPassengersAccordion: document.getElementById('viewPassengersAccordion'),
    cancelViewBtn: document.getElementById('cancelViewBtn'),

    // Add Passenger Modal
    addPassengerModal: document.getElementById('addPassengerModal'),
    closeAddPassengerModal: document.getElementById('closeAddPassengerModal'),
    addPassengerForm: document.getElementById('addPassengerForm'),
    cancelAddPassengerBtn: document.getElementById('cancelAddPassengerBtn'),

    // Edit Booked Flight Modal
    editBookedModal: document.getElementById('editBookedModal'),
    closeEditBookedModal: document.getElementById('closeEditBookedModal'),
    editBookedForm: document.getElementById('editBookedForm'),
    cancelEditBookedBtn: document.getElementById('cancelEditBookedBtn'),
    editBookedReturnSection: document.getElementById('editBookedReturnSection'),
    editBookedPassengers: document.getElementById('editBookedPassengers'),

    // Manage Passengers Modal
    managePassengersBtn: document.getElementById('managePassengersBtn'),
    managePassengersModal: document.getElementById('managePassengersModal'),
    closeManagePassengersModal: document.getElementById('closeManagePassengersModal'),
    passengerSearchInput: document.getElementById('passengerSearchInput'),
    passengersTableBody: document.getElementById('passengersTableBody'),
    passengersEmptyState: document.getElementById('passengersEmptyState'),
    addNewPassengerFromManageBtn: document.getElementById('addNewPassengerFromManageBtn'),

    // Edit Passenger Modal
    editPassengerModal: document.getElementById('editPassengerModal'),
    closeEditPassengerModal: document.getElementById('closeEditPassengerModal'),
    editPassengerForm: document.getElementById('editPassengerForm'),
    cancelEditPassengerBtn: document.getElementById('cancelEditPassengerBtn')
  };

  /**
   * Get auth headers for API calls
   */
  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  /**
   * Make API request with error handling
   */
  async function apiRequest(endpoint, options = {}) {
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  /**
   * Initialize the flights page
   */
  async function init() {
    console.log('🛫 Initializing Flight Management...');
    
    // Show loading states
    showLoadingState();

    try {
      // Load data from API
      await Promise.all([
        loadPassengers(),
        loadFlightRequests(),
        loadUsers()
      ]);

      // Populate dropdowns
      populatePassengerDropdown();
      populateUserDropdowns();

      // Render flight cards
      renderPendingRequests();
      renderBookedFlights();

      // Setup event listeners
      setupEventListeners();

      console.log('✅ Flight Management initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Flight Management:', error);
      showErrorState('Failed to load flight data. Please refresh the page.');
    }
  }

  /**
   * Show loading state
   */
  function showLoadingState() {
    if (elements.pendingRequestsGrid) {
      elements.pendingRequestsGrid.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Loading flights...</p></div>';
    }
  }

  /**
   * Show error state
   */
  function showErrorState(message) {
    if (elements.pendingRequestsGrid) {
      elements.pendingRequestsGrid.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">error</span><p>${message}</p></div>`;
    }
  }

  /**
   * Load passengers from API
   */
  async function loadPassengers() {
    try {
      passengers = await apiRequest('/api/passengers');
      console.log(`📋 Loaded ${passengers.length} passengers`);
    } catch (error) {
      console.error('Failed to load passengers:', error);
      passengers = [];
    }
  }

  /**
   * Load users from API
   */
  async function loadUsers() {
    try {
      users = await apiRequest('/api/users');
      console.log(`👥 Loaded ${users.length} users`);
    } catch (error) {
      console.error('Failed to load users:', error);
      users = [];
    }
  }

  /**
   * Populate user dropdowns in passenger modals
   */
  function populateUserDropdowns() {
    const dropdowns = [
      document.getElementById('newPassengerUserId'),
      document.getElementById('editPassengerUserId')
    ];

    dropdowns.forEach(dropdown => {
      if (!dropdown) return;
      
      dropdown.innerHTML = '<option value="">No linked user</option>';
      
      users.forEach(user => {
        const option = document.createElement('option');
        option.value = user._id;
        // API returns 'name' field (mapped from fullName)
        const displayName = user.name && user.name.trim() ? user.name : null;
        option.textContent = displayName ? `${displayName} (${user.email})` : user.email;
        dropdown.appendChild(option);
      });
    });
  }

  /**
   * Load flight requests from API
   */
  async function loadFlightRequests() {
    try {
      const [pending, booked] = await Promise.all([
        apiRequest('/api/flights/pending'),
        apiRequest('/api/flights/booked')
      ]);
      
      flightRequests = pending;
      bookedFlights = booked;
      
      console.log(`📋 Loaded ${flightRequests.length} pending requests, ${bookedFlights.length} booked flights`);
    } catch (error) {
      console.error('Failed to load flight requests:', error);
      flightRequests = [];
      bookedFlights = [];
    }
  }

  /**
   * Setup all event listeners
   */
  function setupEventListeners() {
    // Create Request Modal
    elements.createRequestBtn?.addEventListener('click', openCreateModal);
    elements.closeCreateModal?.addEventListener('click', closeCreateModal);
    elements.createRequestModal?.addEventListener('click', (e) => {
      if (e.target === elements.createRequestModal) closeCreateModal();
    });
    elements.createRequestForm?.addEventListener('submit', handleCreateRequest);

    // Trip type toggle
    document.querySelectorAll('input[name="tripType"]').forEach(radio => {
      radio.addEventListener('change', handleTripTypeChange);
    });

    // Airport search inputs
    elements.fromAirport?.addEventListener('input', (e) => handleAirportSearch(e, 'from'));
    elements.toAirport?.addEventListener('input', (e) => handleAirportSearch(e, 'to'));

    // Event name search
    elements.eventName?.addEventListener('input', handleEventSearch);

    // Add passenger from dropdown
    elements.passengerSelect?.addEventListener('change', handlePassengerSelect);
    elements.addPassengerBtn?.addEventListener('click', openAddPassengerModal);

    // View Request Modal
    elements.closeViewModal?.addEventListener('click', closeViewModal);
    elements.cancelViewBtn?.addEventListener('click', closeViewModal);
    elements.viewRequestModal?.addEventListener('click', (e) => {
      if (e.target === elements.viewRequestModal) closeViewModal();
    });
    elements.viewRequestForm?.addEventListener('submit', handleSaveChanges);

    // Trip type buttons in view modal
    document.querySelectorAll('.trip-type-btn').forEach(btn => {
      btn.addEventListener('click', handleViewTripTypeChange);
    });

    // Book Flight button
    document.getElementById('bookFlightBtn')?.addEventListener('click', showBookingSection);
    document.getElementById('closeBookingSection')?.addEventListener('click', hideBookingSection);
    document.getElementById('cancelBookingBtn')?.addEventListener('click', hideBookingSection);
    document.getElementById('confirmBookingBtn')?.addEventListener('click', handleConfirmBooking);

    // Delete Request button
    document.getElementById('deleteRequestBtn')?.addEventListener('click', handleDeleteRequest);

    // Add Passenger Modal
    elements.closeAddPassengerModal?.addEventListener('click', closeAddPassengerModal);
    elements.cancelAddPassengerBtn?.addEventListener('click', closeAddPassengerModal);
    elements.addPassengerModal?.addEventListener('click', (e) => {
      if (e.target === elements.addPassengerModal) closeAddPassengerModal();
    });
    elements.addPassengerForm?.addEventListener('submit', handleAddNewPassenger);

    // Edit Booked Flight Modal
    elements.closeEditBookedModal?.addEventListener('click', closeEditBookedModal);
    elements.cancelEditBookedBtn?.addEventListener('click', closeEditBookedModal);
    elements.editBookedModal?.addEventListener('click', (e) => {
      if (e.target === elements.editBookedModal) closeEditBookedModal();
    });
    elements.editBookedForm?.addEventListener('submit', handleSaveBookedFlight);
    document.getElementById('deleteBookedFlightBtn')?.addEventListener('click', handleDeleteCurrentBookedFlight);

    // Manage Passengers Modal
    elements.managePassengersBtn?.addEventListener('click', openManagePassengersModal);
    elements.closeManagePassengersModal?.addEventListener('click', closeManagePassengersModal);
    elements.managePassengersModal?.addEventListener('click', (e) => {
      if (e.target === elements.managePassengersModal) closeManagePassengersModal();
    });
    elements.passengerSearchInput?.addEventListener('input', handlePassengerSearch);
    elements.addNewPassengerFromManageBtn?.addEventListener('click', () => {
      closeManagePassengersModal();
      openAddPassengerModal();
    });

    // Edit Passenger Modal
    elements.closeEditPassengerModal?.addEventListener('click', closeEditPassengerModal);
    elements.cancelEditPassengerBtn?.addEventListener('click', closeEditPassengerModal);
    elements.editPassengerModal?.addEventListener('click', (e) => {
      if (e.target === elements.editPassengerModal) closeEditPassengerModal();
    });
    elements.editPassengerForm?.addEventListener('submit', handleSavePassenger);
    document.getElementById('deletePassengerBtn')?.addEventListener('click', handleDeletePassenger);

    // Close suggestions on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.form-group')) {
        elements.fromSuggestions?.classList.remove('show');
        elements.toSuggestions?.classList.remove('show');
        elements.eventSuggestions?.classList.remove('show');
      }
    });
  }

  /**
   * Populate passenger dropdown
   */
  function populatePassengerDropdown() {
    if (!elements.passengerSelect) return;

    elements.passengerSelect.innerHTML = '<option value="">Select passenger...</option>';
    
    passengers.forEach(passenger => {
      const option = document.createElement('option');
      option.value = passenger._id;
      option.textContent = passenger.fullName || `${passenger.firstName} ${passenger.lastName}`;
      elements.passengerSelect.appendChild(option);
    });
  }

  /**
   * Render pending requests
   */
  function renderPendingRequests() {
    if (!elements.pendingRequestsGrid) return;

    elements.pendingRequestsGrid.innerHTML = '';
    
    if (flightRequests.length === 0) {
      elements.pendingRequestsGrid.style.display = 'none';
      elements.pendingEmptyState.style.display = 'block';
    } else {
      elements.pendingRequestsGrid.style.display = 'grid';
      elements.pendingEmptyState.style.display = 'none';

      flightRequests.forEach(request => {
        const card = createPendingRequestCard(request);
        elements.pendingRequestsGrid.appendChild(card);
      });
    }

    elements.pendingCount.textContent = `${flightRequests.length} Request${flightRequests.length !== 1 ? 's' : ''}`;
  }

  /**
   * Render booked flights
   */
  function renderBookedFlights() {
    if (!elements.bookedFlightsGrid) return;

    elements.bookedFlightsGrid.innerHTML = '';
    
    if (bookedFlights.length === 0) {
      elements.bookedFlightsGrid.style.display = 'none';
      elements.bookedEmptyState.style.display = 'block';
    } else {
      elements.bookedFlightsGrid.style.display = 'grid';
      elements.bookedEmptyState.style.display = 'none';

      // Create separate cards for outbound and return flights
      let totalFlightCards = 0;
      
      bookedFlights.forEach(flight => {
        // Always create outbound card
        const outboundCard = createBookedFlightCard(flight, false);
        elements.bookedFlightsGrid.appendChild(outboundCard);
        totalFlightCards++;
        
        // Create return card for roundtrip flights
        if (flight.tripType === 'roundtrip' && flight.returnDate) {
          const returnCard = createBookedFlightCard(flight, true);
          elements.bookedFlightsGrid.appendChild(returnCard);
          totalFlightCards++;
        }
      });
      
      elements.bookedCount.textContent = `${totalFlightCards} Flight${totalFlightCards !== 1 ? 's' : ''}`;
      return;
    }

    elements.bookedCount.textContent = `0 Flights`;
  }

  /**
   * Format date for display
   */
  /**
   * Format date for display - timezone-safe
   * Parses date string without timezone conversion
   */
  function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    // Extract just the date part (YYYY-MM-DD) to avoid timezone issues
    const datePart = dateStr.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    // Create date using local timezone (noon to avoid any edge cases)
    const date = new Date(year, month - 1, day, 12, 0, 0);
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  }

  /**
   * Format date for input - timezone-safe
   */
  function formatDateForInput(dateStr) {
    if (!dateStr) return '';
    // Just extract the YYYY-MM-DD part
    return dateStr.split('T')[0];
  }

  /**
   * Calculate flight duration from depart and arrive times
   * Returns formatted string like "2h 30m" or empty string if can't calculate
   */
  function calculateFlightDuration(departTime, arriveTime) {
    if (!departTime || !arriveTime) return '';
    
    try {
      // Parse times (format: "HH:MM")
      const [depHours, depMins] = departTime.split(':').map(Number);
      const [arrHours, arrMins] = arriveTime.split(':').map(Number);
      
      // Convert to minutes since midnight
      let depMinutes = depHours * 60 + depMins;
      let arrMinutes = arrHours * 60 + arrMins;
      
      // Handle overnight flights (arrive time is earlier than depart)
      if (arrMinutes < depMinutes) {
        arrMinutes += 24 * 60; // Add a day
      }
      
      const durationMins = arrMinutes - depMinutes;
      const hours = Math.floor(durationMins / 60);
      const mins = durationMins % 60;
      
      if (hours === 0) {
        return `${mins}m`;
      } else if (mins === 0) {
        return `${hours}h`;
      } else {
        return `${hours}h ${mins}m`;
      }
    } catch (e) {
      return '';
    }
  }

  /**
   * Format time for display (12-hour format)
   */
  function formatTimeDisplay(time24) {
    if (!time24) return '';
    try {
      const [hours, mins] = time24.split(':').map(Number);
      const period = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      return `${hours12}:${mins.toString().padStart(2, '0')} ${period}`;
    } catch (e) {
      return time24;
    }
  }

  /**
   * Create pending request card HTML
   */
  function createPendingRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'flight-card';
    
    const departDisplay = formatDateDisplay(request.departDate);
    const returnDisplay = request.returnDate ? formatDateDisplay(request.returnDate) : null;
    
    card.innerHTML = `
      <div class="flight-card-header">
        <h3 class="flight-event-name">${request.eventName || 'Flight Request'}</h3>
        <span class="flight-type-badge">${request.tripType === 'roundtrip' ? 'Roundtrip' : 'One-way'}</span>
      </div>
      <div class="flight-card-body">
        
        <div class="flight-info-row">
          <div class="flight-info-label">Depart</div>
          <div class="flight-dates">
            <div class="flight-date-info">
              <span class="date-value">${departDisplay}</span>
            </div>
            ${returnDisplay ? `
              <div class="flight-date-info">
                <span class="date-label">Return</span>
                <span class="date-value">${returnDisplay}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="flight-info-row">
          <div class="flight-route">
            <div class="flight-airport">
              <span class="airport-code">${request.from?.code || 'TBD'}</span>
              <span class="airport-city">${request.from?.city || ''}</span>
            </div>
            <div class="flight-route-icon">
              <span class="material-symbols-outlined">flight_takeoff</span>
            </div>
            <div class="flight-airport">
              <span class="airport-code">${request.to?.code || 'TBD'}</span>
              <span class="airport-city">${request.to?.city || ''}</span>
            </div>
          </div>
        </div>

        <div class="flight-passengers">
          <div class="passengers-label">Passengers</div>
          <div class="passenger-list">
            ${(request.passengers || []).map(p => `
              <div class="passenger-item">
                <span class="material-symbols-outlined">person</span>
                <span>${p.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
        ${request.notes && request.notes.trim() ? `
        <div class="flight-notes">
          <span class="material-symbols-outlined">sticky_note_2</span>
          <span>${request.notes}</span>
        </div>
        ` : ''}
      </div>
      <div class="flight-card-footer">
        <button class="btn-view-request" data-request-id="${request._id}">
          <span>View Request</span>
          <span class="material-symbols-outlined">chevron_right</span>
        </button>
      </div>
    `;

    // Add click handler for view button
    const viewBtn = card.querySelector('.btn-view-request');
    viewBtn.addEventListener('click', () => openViewModal(request));

    return card;
  }

  /**
   * Create booked flight card HTML
   */
  function createBookedFlightCard(flight, isReturn = false) {
    const card = document.createElement('div');
    card.className = 'booked-flight-card';
    
    // Get the correct flight leg details
    const mainBookedDetails = flight.bookedDetails || {};
    const returnBookedDetails = flight.returnBookedDetails || {};
    const legDetails = isReturn ? returnBookedDetails : mainBookedDetails;
    
    // Airline and confirmation are shared (from main booking)
    const airline = mainBookedDetails.airline || '';
    const confirmationCode = mainBookedDetails.confirmationCode || '';
    
    // Get flight number for this leg
    const flightNumber = legDetails.flightNumber || '';
    
    // Determine dates and route for this leg
    const dateDisplay = formatDateDisplay(isReturn ? flight.returnDate : flight.departDate);
    const fromCode = isReturn ? (flight.to?.code || 'TBD') : (flight.from?.code || 'TBD');
    const toCode = isReturn ? (flight.from?.code || 'TBD') : (flight.to?.code || 'TBD');
    const fromCity = isReturn 
      ? (flight.to?.city ? `${flight.to.city}${flight.to.state ? ', ' + flight.to.state : ''}` : '')
      : (flight.from?.city ? `${flight.from.city}${flight.from.state ? ', ' + flight.from.state : ''}` : '');
    const toCity = isReturn 
      ? (flight.from?.city ? `${flight.from.city}${flight.from.state ? ', ' + flight.from.state : ''}` : '')
      : (flight.to?.city ? `${flight.to.city}${flight.to.state ? ', ' + flight.to.state : ''}` : '');
    
    // Calculate flight duration from times
    const flightDuration = calculateFlightDuration(legDetails.departTime, legDetails.arriveTime);
    
    // Format times for display
    const departTimeDisplay = formatTimeDisplay(legDetails.departTime);
    const arriveTimeDisplay = formatTimeDisplay(legDetails.arriveTime);
    
    // Check for notes (only show on outbound to avoid duplication)
    const hasNotes = !isReturn && flight.notes && flight.notes.trim();
    
    // Flight direction indicator
    const directionLabel = isReturn ? 'Return' : 'Outbound';
    const directionIcon = isReturn ? 'flight_land' : 'flight_takeoff';
    
    card.innerHTML = `
      <div class="booked-flight-header">
        <div class="booked-event-info">
          <span class="booked-event-name">${flight.eventName || 'Flight'}</span>
          <span class="flight-direction-badge ${isReturn ? 'return' : 'outbound'}">${directionLabel}</span>
        </div>
        <div class="booked-header-right">
          <div class="confirmation-code">
            <span>Confirmation #</span>
            <strong>${confirmationCode || 'N/A'}</strong>
            ${confirmationCode ? `
              <button class="copy-btn" title="Copy confirmation code">
                <span class="material-symbols-outlined">content_copy</span>
              </button>
            ` : ''}
          </div>
          <div class="booked-menu-wrapper">
            <button class="booked-menu-btn" title="More options">
              <span class="material-symbols-outlined">more_vert</span>
            </button>
            <div class="booked-menu-dropdown">
              <button class="booked-menu-item" data-action="edit">
                <span class="material-symbols-outlined">edit</span>
                <span>Edit</span>
              </button>
              <button class="booked-menu-item delete" data-action="delete">
                <span class="material-symbols-outlined">delete</span>
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="booked-flight-body">
        <div class="booked-flight-info-row">
          ${airline ? `<div class="booked-airline">${airline}${flightNumber ? ' ' + flightNumber : ''}</div>` : ''}
          <div class="booked-date">
            <span class="material-symbols-outlined">calendar_today</span>
            <span>${dateDisplay}</span>
          </div>
        </div>
        <div class="booked-flight-route">
          <div class="booked-airport">
            <span class="booked-airport-code">${fromCode}</span>
            <span class="booked-airport-city">${fromCity}</span>
            <span class="booked-airport-time">${departTimeDisplay}</span>
          </div>
          <div class="booked-route-icon">
            <span class="material-symbols-outlined">${directionIcon}</span>
            ${flightDuration ? `<span class="flight-duration">${flightDuration}</span>` : ''}
          </div>
          <div class="booked-airport">
            <span class="booked-airport-code">${toCode}</span>
            <span class="booked-airport-city">${toCity}</span>
            <span class="booked-airport-time">${arriveTimeDisplay}</span>
          </div>
        </div>
        <div class="flight-passengers">
          <div class="passengers-label">Passengers</div>
          <div class="passenger-list">
            ${(flight.passengers || []).map(p => `
              <div class="passenger-item">
                <span class="material-symbols-outlined">person</span>
                <span>${p.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
        ${hasNotes ? `
          <div class="booked-flight-notes">
            <span class="material-symbols-outlined">sticky_note_2</span>
            <span>${flight.notes}</span>
          </div>
        ` : ''}
      </div>
    `;

    // Add click handler for copy button
    const copyBtn = card.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(bookedDetails.confirmationCode);
        // Could add a toast notification here
      });
    }

    // Add click handler for menu button
    const menuBtn = card.querySelector('.booked-menu-btn');
    const menuDropdown = card.querySelector('.booked-menu-dropdown');
    
    if (menuBtn && menuDropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close all other open menus
        document.querySelectorAll('.booked-menu-dropdown.show').forEach(m => {
          if (m !== menuDropdown) m.classList.remove('show');
        });
        menuDropdown.classList.toggle('show');
      });

      // Handle menu item clicks
      menuDropdown.querySelectorAll('.booked-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = item.dataset.action;
          menuDropdown.classList.remove('show');
          
          if (action === 'edit') {
            openEditBookedFlightModal(flight);
          } else if (action === 'delete') {
            handleDeleteBookedFlight(flight);
          }
        });
      });
    }

    // Close menu when clicking outside
    document.addEventListener('click', () => {
      menuDropdown?.classList.remove('show');
    });

    return card;
  }

  /**
   * Open create request modal
   */
  function openCreateModal() {
    elements.createRequestModal?.classList.add('show');
    selectedPassengers = [];
    renderSelectedPassengers();
    // Reset form
    elements.createRequestForm?.reset();
    // Set default trip type
    document.querySelector('input[name="tripType"][value="roundtrip"]').checked = true;
    elements.returnDateGroup.style.display = 'block';
  }

  /**
   * Close create request modal
   */
  function closeCreateModal() {
    elements.createRequestModal?.classList.remove('show');
    selectedPassengers = [];
    // Clear form fields
    elements.createRequestForm?.reset();
    const createNotesEl = document.getElementById('createNotes');
    if (createNotesEl) createNotesEl.value = '';
    elements.selectedPassengers.innerHTML = '';
  }

  /**
   * Handle trip type change
   */
  function handleTripTypeChange(e) {
    const isRoundtrip = e.target.value === 'roundtrip';
    elements.returnDateGroup.style.display = isRoundtrip ? 'block' : 'none';
  }

  /**
   * Handle airport search with autocomplete
   */
  function handleAirportSearch(e, type) {
    const value = e.target.value;
    const suggestionsEl = type === 'from' ? elements.fromSuggestions : elements.toSuggestions;

    if (!value || value.length < 1) {
      suggestionsEl?.classList.remove('show');
      return;
    }

    // Use the global searchAirports function from airports.js
    const matches = window.searchAirports ? window.searchAirports(value, 8) : [];

    if (matches.length === 0) {
      suggestionsEl?.classList.remove('show');
      return;
    }

    suggestionsEl.innerHTML = matches.map(airport => `
      <div class="suggestion-item" data-code="${airport.code}" data-city="${airport.city}" data-state="${airport.state}" data-name="${airport.name}">
        <span class="airport-code">${airport.code} - ${airport.name}</span>
        <span class="airport-city">${airport.city}, ${airport.state}</span>
      </div>
    `).join('');

    suggestionsEl.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const input = type === 'from' ? elements.fromAirport : elements.toAirport;
        input.value = `${item.dataset.code} - ${item.dataset.city}, ${item.dataset.state}`;
        input.dataset.code = item.dataset.code;
        input.dataset.city = item.dataset.city;
        input.dataset.state = item.dataset.state;
        input.dataset.name = item.dataset.name;
        suggestionsEl.classList.remove('show');
      });
    });

    suggestionsEl.classList.add('show');
  }

  /**
   * Handle event search
   */
  async function handleEventSearch(e) {
    const value = e.target.value;

    if (value.length < 2) {
      elements.eventSuggestions?.classList.remove('show');
      return;
    }

    try {
      const events = await apiRequest(`/api/flights/events/search?q=${encodeURIComponent(value)}`);
      
      if (events.length === 0) {
        elements.eventSuggestions?.classList.remove('show');
        return;
      }

      elements.eventSuggestions.innerHTML = events.map(event => {
        const startDate = event.general?.startDate ? formatDateDisplay(event.general.startDate) : '';
        const endDate = event.general?.endDate ? formatDateDisplay(event.general.endDate) : '';
        const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : startDate || '';
        
        return `
          <div class="suggestion-item" data-event-id="${event._id}" data-event-name="${event.title}">
            <span class="event-title">${event.title}</span>
            <span class="event-date">${dateRange}</span>
          </div>
        `;
      }).join('');

      elements.eventSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          elements.eventName.value = item.dataset.eventName;
          elements.eventName.dataset.eventId = item.dataset.eventId;
          elements.eventSuggestions.classList.remove('show');
        });
      });

      elements.eventSuggestions.classList.add('show');
    } catch (error) {
      console.error('Event search error:', error);
    }
  }

  /**
   * Handle passenger selection from dropdown
   */
  function handlePassengerSelect(e) {
    const passengerId = e.target.value;
    if (!passengerId) return;

    const passenger = passengers.find(p => p._id === passengerId);
    if (!passenger) return;

    // Check if already selected
    if (selectedPassengers.find(p => p.passengerId === passengerId)) {
      e.target.value = '';
      return;
    }

    selectedPassengers.push({
      passengerId: passenger._id,
      name: passenger.fullName || `${passenger.firstName} ${passenger.lastName}`
    });

    renderSelectedPassengers();
    e.target.value = '';
  }

  /**
   * Render selected passengers chips
   */
  function renderSelectedPassengers() {
    if (!elements.selectedPassengers) return;

    elements.selectedPassengers.innerHTML = selectedPassengers.map(p => `
      <div class="selected-passenger-chip">
        <span class="material-symbols-outlined">person</span>
        <span>${p.name}</span>
        <button class="remove-passenger" data-id="${p.passengerId}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `).join('');

    // Add click handlers for remove buttons
    elements.selectedPassengers.querySelectorAll('.remove-passenger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        selectedPassengers = selectedPassengers.filter(p => p.passengerId !== id);
        renderSelectedPassengers();
      });
    });
  }

  /**
   * Parse airport input value
   */
  function parseAirportInput(inputEl) {
    // If we have dataset values from autocomplete selection
    if (inputEl.dataset.code) {
      return {
        code: inputEl.dataset.code,
        city: inputEl.dataset.city || '',
        state: inputEl.dataset.state || '',
        name: inputEl.dataset.name || ''
      };
    }
    
    // Manual entry - try to extract code from value
    const value = inputEl.value.trim();
    const codeMatch = value.match(/^([A-Za-z]{3})/);
    return {
      code: codeMatch ? codeMatch[1].toUpperCase() : value.substring(0, 3).toUpperCase(),
      city: '',
      state: '',
      name: ''
    };
  }

  /**
   * Handle create request form submission
   */
  async function handleCreateRequest(e) {
    e.preventDefault();

    const tripType = document.querySelector('input[name="tripType"]:checked').value;
    const fromAirport = parseAirportInput(elements.fromAirport);
    const toAirport = parseAirportInput(elements.toAirport);

    const requestData = {
      eventName: elements.eventName.value || 'Flight Request',
      eventId: elements.eventName.dataset.eventId || null,
      tripType: tripType,
      from: fromAirport,
      to: toAirport,
      departDate: elements.departDate.value,
      returnDate: tripType === 'roundtrip' ? elements.returnDate.value : null,
      departTimePreference: elements.departTimePreference.value,
      passengers: selectedPassengers,
      notes: document.getElementById('createNotes')?.value?.trim() || ''
    };

    try {
      const newFlight = await apiRequest('/api/flights', {
        method: 'POST',
        body: JSON.stringify(requestData)
      });

      flightRequests.unshift(newFlight);
      renderPendingRequests();
      closeCreateModal();

      console.log('✅ Flight request created:', newFlight._id);
    } catch (error) {
      console.error('Failed to create flight request:', error);
      alert('Failed to create flight request. Please try again.');
    }
  }

  /**
   * Open view request modal
   */
  function openViewModal(request) {
    currentEditingRequest = request;
    elements.viewRequestModal?.classList.add('show');

    // Reset modal title
    const modalTitle = elements.viewRequestModal?.querySelector('.modal-header h2');
    if (modalTitle) {
      modalTitle.textContent = 'View Request';
    }

    // Populate form fields
    elements.viewEventName.value = request.eventName || '';
    elements.viewDepartDate.value = formatDateForInput(request.departDate);
    elements.viewReturnDate.value = request.returnDate ? formatDateForInput(request.returnDate) : '';
    elements.viewDepartTimePreference.value = request.departTimePreference || 'any';
    elements.viewReturnTimePreference.value = request.returnTimePreference || 'any';
    
    // Populate notes
    const viewNotesEl = document.getElementById('viewNotes');
    if (viewNotesEl) viewNotesEl.value = request.notes || '';

    // Set trip type
    document.querySelectorAll('.trip-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === request.tripType);
    });
    elements.viewReturnDateGroup.style.display = request.tripType === 'roundtrip' ? 'block' : 'none';

    // Render passengers accordion
    renderPassengersAccordion(request.passengers || []);

    // Show book flight button for pending requests
    const bookFlightBtn = document.getElementById('bookFlightBtn');
    const deleteBtn = document.getElementById('deleteRequestBtn');
    if (bookFlightBtn) bookFlightBtn.style.display = 'flex';
    if (deleteBtn) deleteBtn.style.display = 'flex';

    // Hide booking section if visible
    hideBookingSection();
  }

  /**
   * Close view request modal
   */
  function closeViewModal() {
    elements.viewRequestModal?.classList.remove('show');
    currentEditingRequest = null;
  }

  /**
   * Handle trip type change in view modal
   */
  function handleViewTripTypeChange(e) {
    const type = e.target.dataset.type;
    document.querySelectorAll('.trip-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
    elements.viewReturnDateGroup.style.display = type === 'roundtrip' ? 'block' : 'none';
  }

  /**
   * Render passengers accordion in view modal
   */
  function renderPassengersAccordion(requestPassengers) {
    if (!elements.viewPassengersAccordion) return;

    elements.viewPassengersAccordion.innerHTML = requestPassengers.map((p, index) => {
      // Find full passenger details
      const fullPassenger = passengers.find(fp => fp._id === p.passengerId) || {};
      
      return `
        <div class="passenger-accordion-item" data-passenger-id="${p.passengerId}">
          <div class="passenger-accordion-header">
            <span class="passenger-name">
              <span class="material-symbols-outlined">arrow_drop_down</span>
              ${p.name}
            </span>
            <span class="material-symbols-outlined expand-icon">expand_more</span>
          </div>
          <div class="passenger-accordion-body">
            <div class="passenger-form-grid">
              <div class="form-group">
                <label>First</label>
                <input type="text" value="${fullPassenger.firstName || ''}" placeholder="First" data-field="firstName">
              </div>
              <div class="form-group">
                <label>Middle</label>
                <input type="text" value="${fullPassenger.middleName || ''}" placeholder="" data-field="middleName">
              </div>
              <div class="form-group">
                <label>Last</label>
                <input type="text" value="${fullPassenger.lastName || ''}" placeholder="Last" data-field="lastName">
              </div>
            </div>
            <div class="passenger-form-row">
              <div class="form-group">
                <label>Date of Birth</label>
                <input type="date" value="${fullPassenger.dateOfBirth ? formatDateForInput(fullPassenger.dateOfBirth) : ''}" data-field="dateOfBirth">
              </div>
              <div class="form-group">
                <label>Gender</label>
                <div class="select-wrapper">
                  <select data-field="gender">
                    <option value="">Select...</option>
                    <option value="male" ${fullPassenger.gender === 'male' ? 'selected' : ''}>Male</option>
                    <option value="female" ${fullPassenger.gender === 'female' ? 'selected' : ''}>Female</option>
                    <option value="other" ${fullPassenger.gender === 'other' ? 'selected' : ''}>Other</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="passenger-form-full">
              <div class="form-group">
                <label>Rewards</label>
                <input type="text" value="${fullPassenger.rewards || ''}" data-field="rewards">
              </div>
              <div class="form-group">
                <label>KTN</label>
                <input type="text" value="${fullPassenger.knownTravelerNumber || ''}" data-field="knownTravelerNumber">
              </div>
            </div>
            <div class="passenger-notes-row">
              <div class="form-group">
                <label>Notes</label>
                <input type="text" value="${fullPassenger.notes || ''}" data-field="notes">
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers for accordion headers
    elements.viewPassengersAccordion.querySelectorAll('.passenger-accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.passenger-accordion-item');
        item.classList.toggle('expanded');
      });
    });

    // Expand first passenger by default
    const firstItem = elements.viewPassengersAccordion.querySelector('.passenger-accordion-item');
    if (firstItem) {
      firstItem.classList.add('expanded');
    }
  }

  /**
   * Handle save changes in view modal
   */
  async function handleSaveChanges(e) {
    e.preventDefault();

    if (!currentEditingRequest) return;

    const tripType = document.querySelector('.trip-type-btn.active')?.dataset.type || 'roundtrip';

    const updateData = {
      eventName: elements.viewEventName.value,
      tripType: tripType,
      departDate: elements.viewDepartDate.value,
      returnDate: tripType === 'roundtrip' ? elements.viewReturnDate.value : null,
      departTimePreference: elements.viewDepartTimePreference.value,
      returnTimePreference: elements.viewReturnTimePreference.value,
      notes: document.getElementById('viewNotes')?.value?.trim() || ''
    };

    try {
      // Update passenger details if modified
      const accordionItems = elements.viewPassengersAccordion.querySelectorAll('.passenger-accordion-item');
      for (const item of accordionItems) {
        const passengerId = item.dataset.passengerId;
        const passengerData = {};
        
        item.querySelectorAll('[data-field]').forEach(input => {
          const field = input.dataset.field;
          passengerData[field] = input.value;
        });

        // Update passenger in database
        if (passengerId && Object.keys(passengerData).length > 0) {
          await apiRequest(`/api/passengers/${passengerId}`, {
            method: 'PUT',
            body: JSON.stringify(passengerData)
          });
        }
      }

      // Update flight request
      const updatedFlight = await apiRequest(`/api/flights/${currentEditingRequest._id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });

      // Update local state - check if it's pending or booked
      const pendingIndex = flightRequests.findIndex(f => f._id === currentEditingRequest._id);
      const bookedIndex = bookedFlights.findIndex(f => f._id === currentEditingRequest._id);
      
      if (pendingIndex !== -1) {
        flightRequests[pendingIndex] = updatedFlight;
        renderPendingRequests();
      } else if (bookedIndex !== -1) {
        bookedFlights[bookedIndex] = updatedFlight;
        renderBookedFlights();
      }

      // Reload passengers to get updated data
      await loadPassengers();
      
      closeViewModal();

      console.log('✅ Flight request updated:', updatedFlight._id);
    } catch (error) {
      console.error('Failed to update flight request:', error);
      alert('Failed to save changes. Please try again.');
    }
  }

  /**
   * Open add passenger modal
   */
  function openAddPassengerModal() {
    elements.addPassengerModal?.classList.add('show');
    elements.addPassengerForm?.reset();
  }

  /**
   * Close add passenger modal
   */
  function closeAddPassengerModal() {
    elements.addPassengerModal?.classList.remove('show');
  }

  /**
   * Handle add new passenger form submission
   */
  async function handleAddNewPassenger(e) {
    e.preventDefault();

    const passengerData = {
      firstName: document.getElementById('newPassengerFirst').value,
      middleName: document.getElementById('newPassengerMiddle').value,
      lastName: document.getElementById('newPassengerLast').value,
      userId: document.getElementById('newPassengerUserId').value || null,
      dateOfBirth: document.getElementById('newPassengerDob').value || null,
      gender: document.getElementById('newPassengerGender').value,
      rewards: document.getElementById('newPassengerRewards').value,
      knownTravelerNumber: document.getElementById('newPassengerKtn').value,
      notes: document.getElementById('newPassengerNotes').value
    };

    try {
      const newPassenger = await apiRequest('/api/passengers', {
        method: 'POST',
        body: JSON.stringify(passengerData)
      });

      passengers.push(newPassenger);
      populatePassengerDropdown();

      // Also add to selected passengers
      selectedPassengers.push({
        passengerId: newPassenger._id,
        name: newPassenger.fullName || `${newPassenger.firstName} ${newPassenger.lastName}`
      });
      renderSelectedPassengers();

      closeAddPassengerModal();

      console.log('✅ New passenger added:', newPassenger._id);
    } catch (error) {
      console.error('Failed to add passenger:', error);
      alert('Failed to add passenger. Please try again.');
    }
  }

  /**
   * Show booking section
   */
  function showBookingSection() {
    const bookingSection = document.getElementById('bookingSection');
    const footerActions = document.querySelector('.modal-footer-actions');
    const returnSection = document.getElementById('bookingReturnSection');
    
    if (bookingSection) {
      bookingSection.style.display = 'block';
      
      // Clear previous values
      document.getElementById('bookingConfirmation').value = '';
      document.getElementById('bookingAirline').value = '';
      document.getElementById('bookingDepartTime').value = '';
      document.getElementById('bookingArriveTime').value = '';
      document.getElementById('bookingFlightNumber').value = '';
      document.getElementById('bookingReturnDepartTime').value = '';
      document.getElementById('bookingReturnArriveTime').value = '';
      document.getElementById('bookingReturnFlightNumber').value = '';
      
      // Show/hide return section based on trip type
      const tripType = document.querySelector('.trip-type-btn.active')?.dataset.type || 'roundtrip';
      if (returnSection) {
        returnSection.style.display = tripType === 'roundtrip' ? 'block' : 'none';
      }
    }
    
    if (footerActions) {
      footerActions.classList.add('hidden');
    }

    // Scroll to booking section
    bookingSection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Hide booking section
   */
  function hideBookingSection() {
    const bookingSection = document.getElementById('bookingSection');
    const footerActions = document.querySelector('.modal-footer-actions');
    
    if (bookingSection) {
      bookingSection.style.display = 'none';
    }
    
    if (footerActions) {
      footerActions.classList.remove('hidden');
    }
  }

  /**
   * Handle confirm booking
   */
  async function handleConfirmBooking() {
    if (!currentEditingRequest) return;

    const confirmationCode = document.getElementById('bookingConfirmation').value.trim();
    if (!confirmationCode) {
      alert('Please enter a confirmation number.');
      return;
    }

    const tripType = document.querySelector('.trip-type-btn.active')?.dataset.type || 'roundtrip';

    const bookedDetails = {
      confirmationCode: confirmationCode,
      airline: document.getElementById('bookingAirline').value.trim(),
      departTime: document.getElementById('bookingDepartTime').value,
      arriveTime: document.getElementById('bookingArriveTime').value,
      flightNumber: document.getElementById('bookingFlightNumber').value.trim()
    };

    let returnBookedDetails = null;
    if (tripType === 'roundtrip') {
      returnBookedDetails = {
        departTime: document.getElementById('bookingReturnDepartTime').value,
        arriveTime: document.getElementById('bookingReturnArriveTime').value,
        flightNumber: document.getElementById('bookingReturnFlightNumber').value.trim()
      };
    }

    try {
      const bookedFlight = await apiRequest(`/api/flights/${currentEditingRequest._id}/book`, {
        method: 'PATCH',
        body: JSON.stringify({ bookedDetails, returnBookedDetails })
      });

      // Remove from pending, add to booked
      flightRequests = flightRequests.filter(f => f._id !== currentEditingRequest._id);
      bookedFlights.unshift(bookedFlight);

      // Re-render both sections
      renderPendingRequests();
      renderBookedFlights();

      // Close modal
      closeViewModal();

      console.log('✅ Flight booked:', bookedFlight._id);
    } catch (error) {
      console.error('Failed to book flight:', error);
      alert('Failed to book flight. Please try again.');
    }
  }

  /**
   * Handle delete request
   */
  async function handleDeleteRequest() {
    if (!currentEditingRequest) return;

    const confirmed = confirm(`Are you sure you want to delete this flight request?\n\nEvent: ${currentEditingRequest.eventName || 'Flight Request'}\n\nThis action cannot be undone.`);
    
    if (!confirmed) return;

    try {
      await apiRequest(`/api/flights/${currentEditingRequest._id}`, {
        method: 'DELETE'
      });

      // Remove from pending list
      flightRequests = flightRequests.filter(f => f._id !== currentEditingRequest._id);
      
      // Re-render
      renderPendingRequests();

      // Close modal
      closeViewModal();

      console.log('✅ Flight request deleted:', currentEditingRequest._id);
    } catch (error) {
      console.error('Failed to delete flight request:', error);
      alert('Failed to delete flight request. Please try again.');
    }
  }

  /**
   * Open edit modal for booked flight
   */
  function openEditBookedFlightModal(flight) {
    currentEditingRequest = flight;
    elements.editBookedModal?.classList.add('show');

    const bookedDetails = flight.bookedDetails || {};
    const returnBookedDetails = flight.returnBookedDetails || {};

    // Populate form fields
    document.getElementById('editBookedEventName').value = flight.eventName || '';
    document.getElementById('editBookedConfirmation').value = bookedDetails.confirmationCode || '';
    document.getElementById('editBookedAirline').value = bookedDetails.airline || '';
    
    // Outbound flight
    document.getElementById('editBookedDepartDate').value = formatDateForInput(flight.departDate);
    document.getElementById('editBookedFlightNumber').value = bookedDetails.flightNumber || '';
    document.getElementById('editBookedFromCode').value = flight.from?.code || '';
    document.getElementById('editBookedToCode').value = flight.to?.code || '';
    document.getElementById('editBookedDepartTime').value = bookedDetails.departTime || '';
    document.getElementById('editBookedArriveTime').value = bookedDetails.arriveTime || '';

    // Return flight (show/hide based on trip type)
    const isRoundtrip = flight.tripType === 'roundtrip';
    if (elements.editBookedReturnSection) {
      elements.editBookedReturnSection.style.display = isRoundtrip ? 'block' : 'none';
    }

    if (isRoundtrip) {
      document.getElementById('editBookedReturnDate').value = formatDateForInput(flight.returnDate);
      document.getElementById('editBookedReturnFlightNumber').value = returnBookedDetails.flightNumber || '';
      document.getElementById('editBookedReturnFromCode').value = flight.to?.code || '';
      document.getElementById('editBookedReturnToCode').value = flight.from?.code || '';
      document.getElementById('editBookedReturnDepartTime').value = returnBookedDetails.departTime || '';
      document.getElementById('editBookedReturnArriveTime').value = returnBookedDetails.arriveTime || '';
    }

    // Populate notes
    const editBookedNotesEl = document.getElementById('editBookedNotes');
    if (editBookedNotesEl) editBookedNotesEl.value = flight.notes || '';

    // Render passengers as chips
    renderBookedPassengersChips(flight.passengers || []);
  }

  /**
   * Close edit booked modal
   */
  function closeEditBookedModal() {
    elements.editBookedModal?.classList.remove('show');
    currentEditingRequest = null;
  }

  /**
   * Render passengers as chips in the edit booked modal
   */
  function renderBookedPassengersChips(requestPassengers) {
    if (!elements.editBookedPassengers) return;

    elements.editBookedPassengers.innerHTML = requestPassengers.map(p => `
      <div class="passenger-chip">
        <span class="material-symbols-outlined">person</span>
        <span>${p.name}</span>
      </div>
    `).join('');
  }

  /**
   * Handle save booked flight changes
   */
  async function handleSaveBookedFlight(e) {
    e.preventDefault();

    if (!currentEditingRequest) return;

    const isRoundtrip = currentEditingRequest.tripType === 'roundtrip';

    const updateData = {
      eventName: document.getElementById('editBookedEventName').value,
      departDate: document.getElementById('editBookedDepartDate').value,
      returnDate: isRoundtrip ? document.getElementById('editBookedReturnDate').value : null,
      from: {
        code: document.getElementById('editBookedFromCode').value.toUpperCase(),
        city: currentEditingRequest.from?.city || ''
      },
      to: {
        code: document.getElementById('editBookedToCode').value.toUpperCase(),
        city: currentEditingRequest.to?.city || ''
      },
      notes: document.getElementById('editBookedNotes')?.value?.trim() || '',
      bookedDetails: {
        ...currentEditingRequest.bookedDetails,
        confirmationCode: document.getElementById('editBookedConfirmation').value,
        airline: document.getElementById('editBookedAirline').value,
        flightNumber: document.getElementById('editBookedFlightNumber').value,
        departTime: document.getElementById('editBookedDepartTime').value,
        arriveTime: document.getElementById('editBookedArriveTime').value
      }
    };

    if (isRoundtrip) {
      updateData.returnBookedDetails = {
        ...currentEditingRequest.returnBookedDetails,
        flightNumber: document.getElementById('editBookedReturnFlightNumber').value,
        departTime: document.getElementById('editBookedReturnDepartTime').value,
        arriveTime: document.getElementById('editBookedReturnArriveTime').value
      };
    }

    try {
      const updatedFlight = await apiRequest(`/api/flights/${currentEditingRequest._id}`, {
        method: 'PUT',
        body: JSON.stringify(updateData)
      });

      // Update local state
      const index = bookedFlights.findIndex(f => f._id === currentEditingRequest._id);
      if (index !== -1) {
        bookedFlights[index] = updatedFlight;
      }

      renderBookedFlights();
      closeEditBookedModal();

      console.log('✅ Booked flight updated:', updatedFlight._id);
    } catch (error) {
      console.error('Failed to update booked flight:', error);
      alert('Failed to save changes. Please try again.');
    }
  }

  /**
   * Handle delete current booked flight from modal
   */
  async function handleDeleteCurrentBookedFlight() {
    if (!currentEditingRequest) return;
    
    await handleDeleteBookedFlight(currentEditingRequest);
    closeEditBookedModal();
  }

  /**
   * Handle delete booked flight
   */
  async function handleDeleteBookedFlight(flight) {
    const confirmed = confirm(`Are you sure you want to delete this booked flight?\n\nEvent: ${flight.eventName || 'Flight'}\nConfirmation: ${flight.bookedDetails?.confirmationCode || 'N/A'}\n\nThis action cannot be undone.`);
    
    if (!confirmed) return;

    try {
      await apiRequest(`/api/flights/${flight._id}`, {
        method: 'DELETE'
      });

      // Remove from booked list
      bookedFlights = bookedFlights.filter(f => f._id !== flight._id);
      
      // Re-render
      renderBookedFlights();

      console.log('✅ Booked flight deleted:', flight._id);
    } catch (error) {
      console.error('Failed to delete booked flight:', error);
      alert('Failed to delete booked flight. Please try again.');
    }
  }

  // ===========================================
  // MANAGE PASSENGERS FUNCTIONS
  // ===========================================

  /**
   * Open manage passengers modal
   */
  function openManagePassengersModal() {
    elements.managePassengersModal?.classList.add('show');
    if (elements.passengerSearchInput) {
      elements.passengerSearchInput.value = '';
    }
    renderPassengersTable(passengers);
  }

  /**
   * Close manage passengers modal
   */
  function closeManagePassengersModal() {
    elements.managePassengersModal?.classList.remove('show');
  }

  /**
   * Render passengers table
   */
  function renderPassengersTable(passengersToRender) {
    if (!elements.passengersTableBody) return;

    if (passengersToRender.length === 0) {
      elements.passengersTableBody.innerHTML = '';
      if (elements.passengersEmptyState) {
        elements.passengersEmptyState.style.display = 'flex';
      }
      return;
    }

    if (elements.passengersEmptyState) {
      elements.passengersEmptyState.style.display = 'none';
    }

    elements.passengersTableBody.innerHTML = passengersToRender.map(passenger => {
      const linkedUser = passenger.userId ? users.find(u => u._id === passenger.userId) : null;
      const fullName = passenger.fullName || `${passenger.firstName} ${passenger.middleName || ''} ${passenger.lastName}`.replace(/\s+/g, ' ').trim();
      
      return `
        <tr data-passenger-id="${passenger._id}">
          <td class="passenger-name-cell">${fullName}</td>
          <td>
            ${linkedUser ? `
              <span class="linked-user-badge">
                <span class="material-symbols-outlined">person</span>
                ${linkedUser.name || linkedUser.email}
              </span>
            ` : '<span class="no-linked-user">Not linked</span>'}
          </td>
          <td>${passenger.rewards || '-'}</td>
          <td>${passenger.knownTravelerNumber || '-'}</td>
          <td class="passenger-actions">
            <button class="btn-edit-passenger" data-passenger-id="${passenger._id}" title="Edit passenger">
              <span class="material-symbols-outlined">edit</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Add click handlers for edit buttons
    elements.passengersTableBody.querySelectorAll('.btn-edit-passenger').forEach(btn => {
      btn.addEventListener('click', () => {
        const passengerId = btn.dataset.passengerId;
        const passenger = passengers.find(p => p._id === passengerId);
        if (passenger) {
          openEditPassengerModal(passenger);
        }
      });
    });
  }

  /**
   * Handle passenger search
   */
  function handlePassengerSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    
    if (!searchTerm) {
      renderPassengersTable(passengers);
      return;
    }

    const filtered = passengers.filter(p => {
      const fullName = `${p.firstName} ${p.middleName || ''} ${p.lastName}`.toLowerCase();
      return fullName.includes(searchTerm) || 
             (p.rewards && p.rewards.toLowerCase().includes(searchTerm)) ||
             (p.knownTravelerNumber && p.knownTravelerNumber.toLowerCase().includes(searchTerm));
    });

    renderPassengersTable(filtered);
  }

  /**
   * Open edit passenger modal
   */
  function openEditPassengerModal(passenger) {
    currentEditingPassenger = passenger;
    elements.editPassengerModal?.classList.add('show');

    // Populate form
    document.getElementById('editPassengerId').value = passenger._id;
    document.getElementById('editPassengerFirst').value = passenger.firstName || '';
    document.getElementById('editPassengerMiddle').value = passenger.middleName || '';
    document.getElementById('editPassengerLast').value = passenger.lastName || '';
    document.getElementById('editPassengerUserId').value = passenger.userId || '';
    document.getElementById('editPassengerDob').value = passenger.dateOfBirth ? formatDateForInput(passenger.dateOfBirth) : '';
    document.getElementById('editPassengerGender').value = passenger.gender || '';
    document.getElementById('editPassengerRewards').value = passenger.rewards || '';
    document.getElementById('editPassengerKtn').value = passenger.knownTravelerNumber || '';
    document.getElementById('editPassengerNotes').value = passenger.notes || '';
  }

  /**
   * Close edit passenger modal
   */
  function closeEditPassengerModal() {
    elements.editPassengerModal?.classList.remove('show');
    currentEditingPassenger = null;
  }

  /**
   * Handle save passenger changes
   */
  async function handleSavePassenger(e) {
    e.preventDefault();

    if (!currentEditingPassenger) return;

    const passengerData = {
      firstName: document.getElementById('editPassengerFirst').value,
      middleName: document.getElementById('editPassengerMiddle').value,
      lastName: document.getElementById('editPassengerLast').value,
      userId: document.getElementById('editPassengerUserId').value || null,
      dateOfBirth: document.getElementById('editPassengerDob').value || null,
      gender: document.getElementById('editPassengerGender').value,
      rewards: document.getElementById('editPassengerRewards').value,
      knownTravelerNumber: document.getElementById('editPassengerKtn').value,
      notes: document.getElementById('editPassengerNotes').value
    };

    try {
      const updatedPassenger = await apiRequest(`/api/passengers/${currentEditingPassenger._id}`, {
        method: 'PUT',
        body: JSON.stringify(passengerData)
      });

      // Update local state
      const index = passengers.findIndex(p => p._id === currentEditingPassenger._id);
      if (index !== -1) {
        passengers[index] = updatedPassenger;
      }

      // Refresh UI
      populatePassengerDropdown();
      renderPassengersTable(passengers);
      closeEditPassengerModal();

      console.log('✅ Passenger updated:', updatedPassenger._id);
    } catch (error) {
      console.error('Failed to update passenger:', error);
      alert('Failed to save changes. Please try again.');
    }
  }

  /**
   * Handle delete passenger
   */
  async function handleDeletePassenger() {
    if (!currentEditingPassenger) return;

    const passengerId = currentEditingPassenger._id;
    const fullName = `${currentEditingPassenger.firstName} ${currentEditingPassenger.lastName}`;
    const confirmed = confirm(`Are you sure you want to delete ${fullName}?\n\nThis action cannot be undone.`);
    
    if (!confirmed) return;

    try {
      await apiRequest(`/api/passengers/${passengerId}`, {
        method: 'DELETE'
      });

      // Remove from local state
      passengers = passengers.filter(p => p._id !== passengerId);

      // Refresh UI
      populatePassengerDropdown();
      renderPassengersTable(passengers);
      closeEditPassengerModal();

      console.log('✅ Passenger deleted:', passengerId);
    } catch (error) {
      console.error('Failed to delete passenger:', error);
      alert('Failed to delete passenger. Please try again.');
    }
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', init);

})();
