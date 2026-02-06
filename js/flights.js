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
  let editBookedSelectedPassengers = []; // For edit booked modal
  let currentEditingRequest = null;
  let currentEditingPassenger = null;
  let newPassengerRewards = []; // For add passenger modal
  let editPassengerRewards = []; // For edit passenger modal
  let bookingSelectedPassengers = []; // For create booking modal
  let pendingViewType = 'cards'; // 'cards' or 'table'
  let bookedViewType = 'cards'; // 'cards' or 'table'

  // Debounce utility for search
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // DOM Elements
  const elements = {
    // Grids and Tables
    pendingRequestsGrid: document.getElementById('pendingRequestsGrid'),
    pendingRequestsTable: document.getElementById('pendingRequestsTable'),
    bookedFlightsGrid: document.getElementById('bookedFlightsGrid'),
    bookedFlightsTable: document.getElementById('bookedFlightsTable'),
    pendingEmptyState: document.getElementById('pendingEmptyState'),
    bookedEmptyState: document.getElementById('bookedEmptyState'),
    // View Toggle Buttons
    pendingCardsViewBtn: document.getElementById('pendingCardsViewBtn'),
    pendingTableViewBtn: document.getElementById('pendingTableViewBtn'),
    bookedCardsViewBtn: document.getElementById('bookedCardsViewBtn'),
    bookedTableViewBtn: document.getElementById('bookedTableViewBtn'),
    pendingCount: document.getElementById('pendingCount'),
    bookedCount: document.getElementById('bookedCount'),
    
    // Search, Filter, Sort
    pendingSearch: document.getElementById('pendingSearch'),
    pendingFilter: document.getElementById('pendingFilter'),
    pendingSort: document.getElementById('pendingSort'),
    bookedSearch: document.getElementById('bookedSearch'),
    bookedFilter: document.getElementById('bookedFilter'),
    bookedSort: document.getElementById('bookedSort'),

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
    returnTimePreference: document.getElementById('returnTimePreference'),
    returnTimePreferenceGroup: document.getElementById('returnTimePreferenceGroup'),
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
    editBookedPassengerSelect: document.getElementById('editBookedPassengerSelect'),
    editBookedAddPassengerBtn: document.getElementById('editBookedAddPassengerBtn'),
    // Edit booked airport inputs and suggestions
    editBookedFromCode: document.getElementById('editBookedFromCode'),
    editBookedToCode: document.getElementById('editBookedToCode'),
    editBookedFromSuggestions: document.getElementById('editBookedFromSuggestions'),
    editBookedToSuggestions: document.getElementById('editBookedToSuggestions'),
    editBookedReturnFromCode: document.getElementById('editBookedReturnFromCode'),
    editBookedReturnToCode: document.getElementById('editBookedReturnToCode'),
    editBookedReturnFromSuggestions: document.getElementById('editBookedReturnFromSuggestions'),
    editBookedReturnToSuggestions: document.getElementById('editBookedReturnToSuggestions'),

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
    cancelEditPassengerBtn: document.getElementById('cancelEditPassengerBtn'),

    // Create Booking Modal
    createBookingBtn: document.getElementById('createBookingBtn'),
    createBookingModal: document.getElementById('createBookingModal'),
    closeCreateBookingModal: document.getElementById('closeCreateBookingModal'),
    createBookingForm: document.getElementById('createBookingForm'),
    cancelCreateBookingBtn: document.getElementById('cancelCreateBookingBtn'),
    bookingFromAirport: document.getElementById('bookingFromAirport'),
    bookingToAirport: document.getElementById('bookingToAirport'),
    bookingFromSuggestions: document.getElementById('bookingFromSuggestions'),
    bookingToSuggestions: document.getElementById('bookingToSuggestions'),
    bookingEventName: document.getElementById('bookingEventName'),
    bookingEventSuggestions: document.getElementById('bookingEventSuggestions'),
    bookingPassengerSelect: document.getElementById('bookingPassengerSelect'),
    bookingAddPassengerBtn: document.getElementById('bookingAddPassengerBtn'),
    bookingSelectedPassengers: document.getElementById('bookingSelectedPassengers'),
    bookingReturnFlightSection: document.getElementById('bookingReturnFlightSection')
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
    
    // Re-initialize DOM element references (in case they weren't available when script first loaded)
    elements.pendingSearch = document.getElementById('pendingSearch');
    elements.pendingFilter = document.getElementById('pendingFilter');
    elements.pendingSort = document.getElementById('pendingSort');
    elements.bookedSearch = document.getElementById('bookedSearch');
    elements.bookedFilter = document.getElementById('bookedFilter');
    elements.bookedSort = document.getElementById('bookedSort');
    elements.pendingRequestsGrid = document.getElementById('pendingRequestsGrid');
    elements.pendingRequestsTable = document.getElementById('pendingRequestsTable');
    elements.bookedFlightsGrid = document.getElementById('bookedFlightsGrid');
    elements.bookedFlightsTable = document.getElementById('bookedFlightsTable');
    elements.pendingEmptyState = document.getElementById('pendingEmptyState');
    elements.bookedEmptyState = document.getElementById('bookedEmptyState');
    elements.pendingCount = document.getElementById('pendingCount');
    elements.bookedCount = document.getElementById('bookedCount');
    
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
    // Search, Filter, Sort for Pending
    elements.pendingSearch?.addEventListener('input', debounce(() => renderPendingRequests(), 300));
    elements.pendingFilter?.addEventListener('change', () => renderPendingRequests());
    elements.pendingSort?.addEventListener('change', () => renderPendingRequests());
    
    // View Toggle for Pending
    elements.pendingCardsViewBtn?.addEventListener('click', () => switchPendingView('cards'));
    elements.pendingTableViewBtn?.addEventListener('click', () => switchPendingView('table'));
    
    // Search, Filter, Sort for Booked
    elements.bookedSearch?.addEventListener('input', debounce(() => renderBookedFlights(), 300));
    elements.bookedFilter?.addEventListener('change', () => renderBookedFlights());
    elements.bookedSort?.addEventListener('change', () => renderBookedFlights());
    
    // View Toggle for Booked
    elements.bookedCardsViewBtn?.addEventListener('click', () => switchBookedView('cards'));
    elements.bookedTableViewBtn?.addEventListener('click', () => switchBookedView('table'));

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

    // Date validation - ensure return date is not before depart date
    elements.departDate?.addEventListener('change', handleDepartDateChange);
    elements.returnDate?.addEventListener('change', handleReturnDateChange);

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

    // Booking Confirmed Modal
    document.getElementById('closeBookingConfirmedModal')?.addEventListener('click', closeBookingConfirmedModal);
    document.getElementById('closeBookingConfirmedBtn')?.addEventListener('click', closeBookingConfirmedModal);
    document.getElementById('bookingConfirmedModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'bookingConfirmedModal') closeBookingConfirmedModal();
    });

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

    // Edit booked airport autocomplete
    elements.editBookedFromCode?.addEventListener('input', (e) => handleEditBookedAirportSearch(e, 'editBookedFrom'));
    elements.editBookedToCode?.addEventListener('input', (e) => handleEditBookedAirportSearch(e, 'editBookedTo'));
    elements.editBookedReturnFromCode?.addEventListener('input', (e) => handleEditBookedAirportSearch(e, 'editBookedReturnFrom'));
    elements.editBookedReturnToCode?.addEventListener('input', (e) => handleEditBookedAirportSearch(e, 'editBookedReturnTo'));

    // Edit Booked Passenger Add
    elements.editBookedAddPassengerBtn?.addEventListener('click', handleEditBookedAddPassenger);

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

    // Rewards management
    document.getElementById('addNewPassengerRewards')?.addEventListener('click', () => addRewardsEntry('new'));
    document.getElementById('addEditPassengerRewards')?.addEventListener('click', () => addRewardsEntry('edit'));

    // Create Booking Modal
    elements.createBookingBtn?.addEventListener('click', openCreateBookingModal);
    elements.closeCreateBookingModal?.addEventListener('click', closeCreateBookingModal);
    elements.cancelCreateBookingBtn?.addEventListener('click', closeCreateBookingModal);
    elements.createBookingModal?.addEventListener('click', (e) => {
      if (e.target === elements.createBookingModal) closeCreateBookingModal();
    });
    elements.createBookingForm?.addEventListener('submit', handleCreateBooking);

    // Booking trip type toggle
    document.querySelectorAll('input[name="bookingTripType"]').forEach(radio => {
      radio.addEventListener('change', handleBookingTripTypeChange);
    });

    // Booking airport search inputs
    elements.bookingFromAirport?.addEventListener('input', (e) => handleAirportSearch(e, 'bookingFrom'));
    elements.bookingToAirport?.addEventListener('input', (e) => handleAirportSearch(e, 'bookingTo'));

    // Booking event name search
    elements.bookingEventName?.addEventListener('input', handleBookingEventSearch);

    // Booking add passenger from dropdown
    elements.bookingPassengerSelect?.addEventListener('change', handleBookingPassengerSelect);
    elements.bookingAddPassengerBtn?.addEventListener('click', openAddPassengerModal);

    // Close suggestions on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.form-group')) {
        elements.fromSuggestions?.classList.remove('show');
        elements.toSuggestions?.classList.remove('show');
        elements.eventSuggestions?.classList.remove('show');
        // Also close edit booked modal suggestions
        elements.editBookedFromSuggestions?.classList.remove('show');
        elements.editBookedToSuggestions?.classList.remove('show');
        elements.editBookedReturnFromSuggestions?.classList.remove('show');
        elements.editBookedReturnToSuggestions?.classList.remove('show');
        // Also close booking modal suggestions
        elements.bookingFromSuggestions?.classList.remove('show');
        elements.bookingToSuggestions?.classList.remove('show');
        elements.bookingEventSuggestions?.classList.remove('show');
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
   * Parse a flight date value into a valid Date object.
   * Handles Date objects, ISO strings ("2026-02-10T00:00:00.000Z"), and plain date strings ("2026-02-10").
   * Returns null if the value is falsy or results in an invalid date.
   */
  function parseFlightDate(value) {
    if (!value) return null;
    
    let date;
    if (value instanceof Date) {
      date = new Date(value);
    } else if (typeof value === 'string') {
      // If it's already an ISO string (contains 'T'), parse directly
      // If it's a plain date like "2026-02-10", add T12:00:00 to avoid timezone shift
      if (value.includes('T')) {
        date = new Date(value);
      } else {
        date = new Date(value + 'T12:00:00');
      }
    } else {
      return null;
    }
    
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Render pending requests
   */
  function renderPendingRequests() {
    if (!elements.pendingRequestsGrid) return;

    elements.pendingRequestsGrid.innerHTML = '';
    
    // Get filter values - use direct DOM lookup as fallback
    const pendingFilterEl = elements.pendingFilter || document.getElementById('pendingFilter');
    const pendingSortEl = elements.pendingSort || document.getElementById('pendingSort');
    const pendingSearchEl = elements.pendingSearch || document.getElementById('pendingSearch');
    
    const searchTerm = (pendingSearchEl?.value || '').toLowerCase().trim();
    const filterValue = pendingFilterEl?.value || 'upcoming';
    const sortValue = pendingSortEl?.value || 'soonest';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Filter flights
    let filteredRequests = flightRequests.filter(request => {
      // Search filter
      if (searchTerm) {
        const searchFields = [
          request.eventName,
          request.from?.code,
          request.from?.city,
          request.to?.code,
          request.to?.city,
          ...(request.passengers || []).map(p => p.name),
          request.notes
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchFields.includes(searchTerm)) return false;
      }
      
      // Date filter
      if (filterValue !== 'all') {
        let departDate = parseFlightDate(request.departDate);
        if (!departDate) return true; // No valid date - include in results
        
        departDate.setHours(0, 0, 0, 0);
        
        if (filterValue === 'upcoming' && departDate < today) return false;
        if (filterValue === 'past' && departDate >= today) return false;
      }
      
      return true;
    });
    
    // Sort flights by depart date
    filteredRequests.sort((a, b) => {
      // Handle different date formats
      let dateA, dateB;
      
      if (a.departDate instanceof Date) {
        dateA = a.departDate;
      } else if (typeof a.departDate === 'string') {
        dateA = new Date(a.departDate);
      } else {
        dateA = new Date();
      }
      
      if (b.departDate instanceof Date) {
        dateB = b.departDate;
      } else if (typeof b.departDate === 'string') {
        dateB = new Date(b.departDate);
      } else {
        dateB = new Date();
      }
      
      // 'soonest' = earliest dates first (ascending), 'latest' = furthest dates first (descending)
      return sortValue === 'latest' ? dateB - dateA : dateA - dateB;
    });
    
    if (filteredRequests.length === 0) {
      elements.pendingRequestsGrid.style.display = 'none';
      elements.pendingRequestsTable.style.display = 'none';
      elements.pendingEmptyState.style.display = 'block';
    } else {
      elements.pendingEmptyState.style.display = 'none';

      if (pendingViewType === 'table') {
        elements.pendingRequestsGrid.style.display = 'none';
        elements.pendingRequestsTable.style.display = 'block';
        renderPendingTable(filteredRequests);
      } else {
        elements.pendingRequestsGrid.style.display = 'grid';
        elements.pendingRequestsTable.style.display = 'none';
      filteredRequests.forEach(request => {
        const card = createPendingRequestCard(request);
        elements.pendingRequestsGrid.appendChild(card);
      });
      }
    }

    // Show filtered count vs total
    const countText = searchTerm || filterValue !== 'all' 
      ? `${filteredRequests.length} of ${flightRequests.length} Request${flightRequests.length !== 1 ? 's' : ''}`
      : `${flightRequests.length} Request${flightRequests.length !== 1 ? 's' : ''}`;
    elements.pendingCount.textContent = countText;
  }

  /**
   * Render booked flights
   */
  function renderBookedFlights() {
    if (!elements.bookedFlightsGrid) return;

    elements.bookedFlightsGrid.innerHTML = '';
    
    // Get filter values - use direct DOM lookup as fallback
    const bookedFilterEl = elements.bookedFilter || document.getElementById('bookedFilter');
    const bookedSortEl = elements.bookedSort || document.getElementById('bookedSort');
    const bookedSearchEl = elements.bookedSearch || document.getElementById('bookedSearch');
    
    const searchTerm = (bookedSearchEl?.value || '').toLowerCase().trim();
    const filterValue = bookedFilterEl?.value || 'upcoming';
    const sortValue = bookedSortEl?.value || 'soonest';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Filter flights
    let filteredFlights = bookedFlights.filter(flight => {
      // Search filter
      if (searchTerm) {
        const searchFields = [
          flight.eventName,
          flight.from?.code,
          flight.from?.city,
          flight.to?.code,
          flight.to?.city,
          flight.bookedDetails?.airline,
          flight.bookedDetails?.confirmationCode,
          flight.bookedDetails?.flightNumber,
          ...(flight.passengers || []).map(p => p.name),
          flight.notes
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchFields.includes(searchTerm)) return false;
      }
      
      // Date filter - use the latest date (depart or return)
      if (filterValue !== 'all') {
        let departDate = parseFlightDate(flight.departDate);
        if (!departDate) return true; // No valid date - include in results
        departDate.setHours(0, 0, 0, 0);
        
        let returnDate = parseFlightDate(flight.returnDate);
        if (returnDate) returnDate.setHours(0, 0, 0, 0);
        
        // For upcoming: at least one date is in the future
        // For past: all dates are in the past
        const latestDate = returnDate && returnDate > departDate ? returnDate : departDate;
        
        if (filterValue === 'upcoming' && latestDate < today) return false;
        if (filterValue === 'past' && latestDate >= today) return false;
      }
      
      return true;
    });
    
    // Sort flights by depart date
    filteredFlights.sort((a, b) => {
      // Handle different date formats
      let dateA, dateB;
      
      if (a.departDate instanceof Date) {
        dateA = a.departDate;
      } else if (typeof a.departDate === 'string') {
        dateA = new Date(a.departDate);
      } else {
        dateA = new Date();
      }
      
      if (b.departDate instanceof Date) {
        dateB = b.departDate;
      } else if (typeof b.departDate === 'string') {
        dateB = new Date(b.departDate);
      } else {
        dateB = new Date();
      }
      
      // 'soonest' = earliest dates first (ascending), 'latest' = furthest dates first (descending)
      return sortValue === 'latest' ? dateB - dateA : dateA - dateB;
    });
    
    if (filteredFlights.length === 0) {
      elements.bookedFlightsGrid.style.display = 'none';
      elements.bookedFlightsTable.style.display = 'none';
      elements.bookedEmptyState.style.display = 'block';
      const countText = searchTerm || filterValue !== 'all' 
        ? `0 of ${bookedFlights.length} Flight${bookedFlights.length !== 1 ? 's' : ''}`
        : `0 Flights`;
      elements.bookedCount.textContent = countText;
      return;
    }
    
    elements.bookedEmptyState.style.display = 'none';

    if (bookedViewType === 'table') {
      elements.bookedFlightsGrid.style.display = 'none';
      elements.bookedFlightsTable.style.display = 'block';
      renderBookedTable(filteredFlights);
    } else {
      elements.bookedFlightsGrid.style.display = 'grid';
      elements.bookedFlightsTable.style.display = 'none';
      
    // Create separate cards for outbound and return flights
    filteredFlights.forEach(flight => {
      // Always create outbound card
      const outboundCard = createBookedFlightCard(flight, false);
      elements.bookedFlightsGrid.appendChild(outboundCard);
      
      // Create return card for roundtrip flights
      if (flight.tripType === 'roundtrip' && flight.returnDate) {
        const returnCard = createBookedFlightCard(flight, true);
        elements.bookedFlightsGrid.appendChild(returnCard);
      }
    });
    }
    
    // Show filtered count vs total
    const totalBookedCards = bookedFlights.reduce((acc, f) => {
      return acc + 1 + (f.tripType === 'roundtrip' && f.returnDate ? 1 : 0);
    }, 0);
    const totalFilteredCards = filteredFlights.reduce((acc, f) => {
      return acc + 1 + (f.tripType === 'roundtrip' && f.returnDate ? 1 : 0);
    }, 0);
    
    const countText = searchTerm || filterValue !== 'all' 
      ? `${totalFilteredCards} of ${totalBookedCards} Flight${totalBookedCards !== 1 ? 's' : ''}`
      : `${totalFilteredCards} Flight${totalFilteredCards !== 1 ? 's' : ''}`;
    elements.bookedCount.textContent = countText;
  }

  /**
   * Switch pending view between cards and table
   */
  function switchPendingView(viewType) {
    pendingViewType = viewType;
    elements.pendingCardsViewBtn?.classList.toggle('active', viewType === 'cards');
    elements.pendingTableViewBtn?.classList.toggle('active', viewType === 'table');
    renderPendingRequests();
  }

  /**
   * Switch booked view between cards and table
   */
  function switchBookedView(viewType) {
    bookedViewType = viewType;
    elements.bookedCardsViewBtn?.classList.toggle('active', viewType === 'cards');
    elements.bookedTableViewBtn?.classList.toggle('active', viewType === 'table');
    renderBookedFlights();
  }

  /**
   * Render pending requests as table
   */
  function renderPendingTable(requests) {
    if (!elements.pendingRequestsTable) return;
    
    const tableHTML = `
      <table class="flights-table">
        <thead>
          <tr>
            <th>Passengers</th>
            <th>Depart Date</th>
            <th>Depart Time Pref</th>
            <th>Return Date</th>
            <th>Return Time Pref</th>
            <th>From</th>
            <th>To</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          ${requests.map(request => {
            const departDate = new Date(request.departDate);
            const returnDate = request.returnDate ? new Date(request.returnDate) : null;
            const departTimePref = formatTimePreference(request.departTimePreference);
            const returnTimePref = formatTimePreference(request.returnTimePreference);
            
            return `
              <tr data-request-id="${request._id}" onclick="window.openViewModal(event, '${request._id}')">
                <td>
                  <div class="table-passengers">
                    ${(request.passengers || []).map(p => 
                      `<span class="table-passenger-chip">${p.name || 'Unknown'}</span>`
                    ).join('')}
                  </div>
                </td>
                <td class="table-date">${departDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td class="table-time">${departTimePref}</td>
                <td class="table-date">${returnDate ? returnDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                <td class="table-time">${request.returnDate ? returnTimePref : '—'}</td>
                <td>
                  <div class="table-airport">
                    <div class="table-airport-code">${request.from?.code || '—'}</div>
                    <div class="table-airport-city">${request.from?.city ? `${request.from.city}${request.from.state ? ', ' + request.from.state : ''}` : ''}</div>
                  </div>
                </td>
                <td>
                  <div class="table-airport">
                    <div class="table-airport-code">${request.to?.code || '—'}</div>
                    <div class="table-airport-city">${request.to?.city ? `${request.to.city}${request.to.state ? ', ' + request.to.state : ''}` : ''}</div>
                  </div>
                </td>
                <td class="table-event">${request.eventName || 'Flight'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    
    elements.pendingRequestsTable.innerHTML = tableHTML;
  }

  /**
   * Render booked flights as table (with round trips split into two rows)
   */
  function renderBookedTable(flights) {
    if (!elements.bookedFlightsTable) return;
    
    const rows = [];
    
    flights.forEach(flight => {
      // Outbound row
      const departDate = new Date(flight.departDate);
      const departTime = formatTimeDisplay(flight.bookedDetails?.departTime) || '—';
      const arriveTime = formatTimeDisplay(flight.bookedDetails?.arriveTime) || '—';
      const confirmationCode = flight.bookedDetails?.confirmationCode || 'N/A';
      
      rows.push(`
        <tr data-flight-id="${flight._id}" data-is-return="false" onclick="window.openEditBookedFlightFromTable(event, '${flight._id}')">
          <td>
            <div class="table-passengers">
              ${(flight.passengers || []).map(p => 
                `<span class="table-passenger-chip">${p.name || 'Unknown'}</span>`
              ).join('')}
            </div>
          </td>
          <td class="table-date">
            ${departDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            ${flight.tripType === 'roundtrip' ? '<span class="table-direction-badge outbound">Outbound</span>' : ''}
          </td>
          <td class="table-time">${departTime}</td>
          <td class="table-time">${arriveTime}</td>
          <td>
            <div class="table-airport">
              <div class="table-airport-code">${flight.from?.code || '—'}</div>
              <div class="table-airport-city">${flight.from?.city ? `${flight.from.city}${flight.from.state ? ', ' + flight.from.state : ''}` : ''}</div>
            </div>
          </td>
          <td>
            <div class="table-airport">
              <div class="table-airport-code">${flight.to?.code || '—'}</div>
              <div class="table-airport-city">${flight.to?.city ? `${flight.to.city}${flight.to.state ? ', ' + flight.to.state : ''}` : ''}</div>
            </div>
          </td>
          <td class="table-confirmation">
            <div class="table-confirmation-wrapper">
              <span>${confirmationCode}</span>
              ${confirmationCode !== 'N/A' ? `<button class="table-copy-btn" data-confirmation="${confirmationCode}" onclick="event.stopPropagation(); navigator.clipboard.writeText('${confirmationCode}');" title="Copy confirmation code"><span class="material-symbols-outlined">content_copy</span></button>` : ''}
            </div>
          </td>
          <td class="table-event">${flight.eventName || 'Flight'}</td>
        </tr>
      `);
      
      // Return row for round trips
      if (flight.tripType === 'roundtrip' && flight.returnDate) {
        const returnDate = new Date(flight.returnDate);
        const returnDepartTime = formatTimeDisplay(flight.returnBookedDetails?.departTime) || '—';
        const returnArriveTime = formatTimeDisplay(flight.returnBookedDetails?.arriveTime) || '—';
        
        rows.push(`
          <tr data-flight-id="${flight._id}" data-is-return="true" onclick="window.openEditBookedFlightFromTable(event, '${flight._id}')">
            <td>
              <div class="table-passengers">
                ${(flight.passengers || []).map(p => 
                  `<span class="table-passenger-chip">${p.name || 'Unknown'}</span>`
                ).join('')}
              </div>
            </td>
            <td class="table-date">
              ${returnDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              <span class="table-direction-badge return">Return</span>
            </td>
            <td class="table-time">${returnDepartTime}</td>
            <td class="table-time">${returnArriveTime}</td>
            <td>
              <div class="table-airport">
                <div class="table-airport-code">${flight.to?.code || '—'}</div>
                <div class="table-airport-city">${flight.to?.city ? `${flight.to.city}${flight.to.state ? ', ' + flight.to.state : ''}` : ''}</div>
              </div>
            </td>
            <td>
              <div class="table-airport">
                <div class="table-airport-code">${flight.from?.code || '—'}</div>
                <div class="table-airport-city">${flight.from?.city ? `${flight.from.city}${flight.from.state ? ', ' + flight.from.state : ''}` : ''}</div>
              </div>
            </td>
            <td class="table-confirmation">
              <div class="table-confirmation-wrapper">
                <span>${confirmationCode}</span>
                ${confirmationCode !== 'N/A' ? `<button class="table-copy-btn" data-confirmation="${confirmationCode}" onclick="event.stopPropagation(); navigator.clipboard.writeText('${confirmationCode}');" title="Copy confirmation code"><span class="material-symbols-outlined">content_copy</span></button>` : ''}
              </div>
            </td>
            <td class="table-event">${flight.eventName || 'Flight'}</td>
          </tr>
        `);
      }
    });
    
    const tableHTML = `
      <table class="flights-table">
        <thead>
          <tr>
            <th>Passengers</th>
            <th>Depart Date</th>
            <th>Depart Time</th>
            <th>Arrive Time</th>
            <th>From</th>
            <th>To</th>
            <th>Confirmation#</th>
            <th>Event</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
    `;
    
    elements.bookedFlightsTable.innerHTML = tableHTML;
  }

  // Make functions globally accessible for onclick handlers
  window.openViewModal = function(event, requestId) {
    const request = flightRequests.find(r => r._id === requestId);
    if (request) openViewModal(request);
  };

  window.openEditBookedFlightFromTable = function(event, flightId) {
    const flight = bookedFlights.find(f => f._id === flightId);
    if (flight) openEditBookedFlightModal(flight);
  };

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
   * Format time preference for display
   */
  function formatTimePreference(pref) {
    if (!pref || pref === 'any') return 'Any';
    const preferences = {
      'morning': 'Morning',
      'afternoon': 'Afternoon',
      'evening': 'Evening',
      'redeye': 'Red-eye'
    };
    return preferences[pref] || pref;
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
          <div class="flight-dates">
            <div class="flight-date-info">
              <span class="date-label">Depart</span>
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
              <span class="airport-city">${request.from?.city ? `${request.from.city}${request.from.state ? ', ' + request.from.state : ''}` : ''}</span>
            </div>
            <div class="flight-route-icon">
              <span class="material-symbols-outlined">flight_takeoff</span>
            </div>
            <div class="flight-airport">
              <span class="airport-code">${request.to?.code || 'TBD'}</span>
              <span class="airport-city">${request.to?.city ? `${request.to.city}${request.to.state ? ', ' + request.to.state : ''}` : ''}</span>
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
        ${request.createdBy ? `
        <div class="request-created-by">
          <span class="material-symbols-outlined">person_edit</span>
          <span>Created by ${request.createdBy.fullName || request.createdBy.email || 'Unknown'}</span>
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
        ${mainBookedDetails.bookedBy ? `
          <div class="booked-by-info">
            <span class="material-symbols-outlined">check_circle</span>
            <span>Booked by ${mainBookedDetails.bookedBy.fullName || mainBookedDetails.bookedBy.email || 'Unknown'}${mainBookedDetails.bookedAt ? ` on ${new Date(mainBookedDetails.bookedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
          </div>
        ` : ''}
      </div>
    `;

    // Add click handler for copy button
    const copyBtn = card.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(mainBookedDetails.confirmationCode);
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
    // Clear return date min constraint
    if (elements.returnDate) {
      elements.returnDate.min = '';
    }
    // Set default trip type
    document.querySelector('input[name="tripType"][value="roundtrip"]').checked = true;
    elements.returnDateGroup?.classList.remove('hidden');
    if (elements.returnTimePreferenceGroup) {
      elements.returnTimePreferenceGroup.classList.remove('hidden');
    }
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
    
    // Clear airport input datasets (city/state data from autocomplete)
    if (elements.fromAirport) {
      delete elements.fromAirport.dataset.code;
      delete elements.fromAirport.dataset.city;
      delete elements.fromAirport.dataset.state;
      delete elements.fromAirport.dataset.name;
    }
    if (elements.toAirport) {
      delete elements.toAirport.dataset.code;
      delete elements.toAirport.dataset.city;
      delete elements.toAirport.dataset.state;
      delete elements.toAirport.dataset.name;
    }
    // Clear event name dataset
    if (elements.eventName) {
      delete elements.eventName.dataset.eventId;
    }
  }

  /**
   * Handle trip type change
   */
  function handleTripTypeChange(e) {
    const isRoundtrip = e.target.value === 'roundtrip';
    elements.returnDateGroup?.classList.toggle('hidden', !isRoundtrip);
    if (elements.returnTimePreferenceGroup) {
      elements.returnTimePreferenceGroup.classList.toggle('hidden', !isRoundtrip);
    }
  }

  /**
   * Handle depart date change - update return date min constraint
   */
  function handleDepartDateChange() {
    const departDateValue = elements.departDate?.value;
    if (departDateValue && elements.returnDate) {
      // Set minimum return date to depart date
      elements.returnDate.min = departDateValue;
      
      // If current return date is before new depart date, clear it
      if (elements.returnDate.value && elements.returnDate.value < departDateValue) {
        elements.returnDate.value = '';
      }
    }
  }

  /**
   * Handle return date change - validate it's not before depart date
   */
  function handleReturnDateChange() {
    const departDateValue = elements.departDate?.value;
    const returnDateValue = elements.returnDate?.value;
    
    if (departDateValue && returnDateValue && returnDateValue < departDateValue) {
      alert('Return date cannot be before depart date.');
      elements.returnDate.value = '';
    }
  }

  /**
   * Open create booking modal
   */
  function openCreateBookingModal() {
    elements.createBookingModal?.classList.add('show');
    bookingSelectedPassengers = [];
    renderBookingSelectedPassengers();
    
    // Reset form
    elements.createBookingForm?.reset();
    
    // Set default trip type
    document.querySelector('input[name="bookingTripType"][value="roundtrip"]').checked = true;
    if (elements.bookingReturnFlightSection) {
      elements.bookingReturnFlightSection.style.display = 'block';
    }
    
    // Populate passenger dropdown
    populateBookingPassengerDropdown();
  }

  /**
   * Close create booking modal
   */
  function closeCreateBookingModal() {
    elements.createBookingModal?.classList.remove('show');
    bookingSelectedPassengers = [];
    elements.createBookingForm?.reset();
    elements.bookingSelectedPassengers.innerHTML = '';
    
    // Clear airport input datasets
    if (elements.bookingFromAirport) {
      delete elements.bookingFromAirport.dataset.code;
      delete elements.bookingFromAirport.dataset.city;
      delete elements.bookingFromAirport.dataset.state;
      delete elements.bookingFromAirport.dataset.name;
    }
    if (elements.bookingToAirport) {
      delete elements.bookingToAirport.dataset.code;
      delete elements.bookingToAirport.dataset.city;
      delete elements.bookingToAirport.dataset.state;
      delete elements.bookingToAirport.dataset.name;
    }
    // Clear event name dataset
    if (elements.bookingEventName) {
      delete elements.bookingEventName.dataset.eventId;
    }
  }

  /**
   * Handle booking trip type change
   */
  function handleBookingTripTypeChange(e) {
    const isRoundtrip = e.target.value === 'roundtrip';
    if (elements.bookingReturnFlightSection) {
      elements.bookingReturnFlightSection.style.display = isRoundtrip ? 'block' : 'none';
    }
  }

  /**
   * Handle booking event search
   */
  async function handleBookingEventSearch(e) {
    const value = e.target.value;

    if (value.length < 2) {
      elements.bookingEventSuggestions?.classList.remove('show');
      return;
    }

    try {
      const events = await apiRequest(`/api/flights/events/search?q=${encodeURIComponent(value)}`);
      
      if (events.length === 0) {
        elements.bookingEventSuggestions?.classList.remove('show');
        return;
      }

      elements.bookingEventSuggestions.innerHTML = events.map(event => {
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

      elements.bookingEventSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          elements.bookingEventName.value = item.dataset.eventName;
          elements.bookingEventName.dataset.eventId = item.dataset.eventId;
          elements.bookingEventSuggestions.classList.remove('show');
        });
      });

      elements.bookingEventSuggestions.classList.add('show');
    } catch (error) {
      console.error('Event search error:', error);
    }
  }

  /**
   * Populate booking passenger dropdown
   */
  function populateBookingPassengerDropdown() {
    if (!elements.bookingPassengerSelect) return;

    elements.bookingPassengerSelect.innerHTML = '<option value="">Select passenger...</option>';
    
    passengers.forEach(passenger => {
      const option = document.createElement('option');
      option.value = passenger._id;
      option.textContent = passenger.fullName || `${passenger.firstName} ${passenger.lastName}`;
      elements.bookingPassengerSelect.appendChild(option);
    });
  }

  /**
   * Handle booking passenger selection from dropdown
   */
  function handleBookingPassengerSelect(e) {
    const passengerId = e.target.value;
    if (!passengerId) return;

    const passenger = passengers.find(p => p._id === passengerId);
    if (!passenger) return;

    // Check if already selected
    if (bookingSelectedPassengers.find(p => p.passengerId === passengerId)) {
      e.target.value = '';
      return;
    }

    bookingSelectedPassengers.push({
      passengerId: passenger._id,
      name: passenger.fullName || `${passenger.firstName} ${passenger.lastName}`
    });

    renderBookingSelectedPassengers();
    e.target.value = '';
  }

  /**
   * Render booking selected passengers chips
   */
  function renderBookingSelectedPassengers() {
    if (!elements.bookingSelectedPassengers) return;

    elements.bookingSelectedPassengers.innerHTML = bookingSelectedPassengers.map(p => `
      <div class="selected-passenger-chip">
        <span class="material-symbols-outlined">person</span>
        <span>${p.name}</span>
        <button class="remove-passenger" data-id="${p.passengerId}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `).join('');

    // Add click handlers for remove buttons
    elements.bookingSelectedPassengers.querySelectorAll('.remove-passenger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        bookingSelectedPassengers = bookingSelectedPassengers.filter(p => p.passengerId !== id);
        renderBookingSelectedPassengers();
      });
    });
  }

  /**
   * Handle create booking form submission
   */
  async function handleCreateBooking(e) {
    e.preventDefault();

    // Validate required fields
    const confirmationNumber = document.getElementById('bookingConfirmationNumber').value.trim();
    if (!confirmationNumber) {
      alert('Confirmation number is required for direct bookings.');
      return;
    }

    if (bookingSelectedPassengers.length === 0) {
      alert('Please add at least one passenger.');
      return;
    }

    const tripType = document.querySelector('input[name="bookingTripType"]:checked').value;
    const fromAirport = parseAirportInput(elements.bookingFromAirport);
    const toAirport = parseAirportInput(elements.bookingToAirport);

    const bookingData = {
      eventName: elements.bookingEventName.value || 'Flight',
      eventId: elements.bookingEventName.dataset.eventId || null,
      tripType: tripType,
      from: fromAirport,
      to: toAirport,
      departDate: document.getElementById('bookingDepartDate').value,
      returnDate: tripType === 'roundtrip' ? document.getElementById('bookingReturnDate').value : null,
      passengers: bookingSelectedPassengers,
      notes: document.getElementById('bookingNotes')?.value?.trim() || '',
      status: 'booked',
      bookedDetails: {
        confirmationCode: confirmationNumber,
        airline: document.getElementById('bookingAirlineName').value.trim(),
        flightNumber: document.getElementById('bookingOutboundFlightNumber').value.trim(),
        departTime: document.getElementById('bookingDepartTime').value,
        arriveTime: document.getElementById('bookingArriveTime').value
      }
    };

    // Add return flight details for roundtrip
    if (tripType === 'roundtrip') {
      bookingData.returnBookedDetails = {
        flightNumber: document.getElementById('bookingReturnFlightNumber').value.trim(),
        departTime: document.getElementById('bookingReturnDepartTime').value,
        arriveTime: document.getElementById('bookingReturnArriveTime').value
      };
    }

    try {
      const newBooking = await apiRequest('/api/flights', {
        method: 'POST',
        body: JSON.stringify(bookingData)
      });

      bookedFlights.unshift(newBooking);
      renderBookedFlights();
      closeCreateBookingModal();

      console.log('✅ Direct booking created:', newBooking._id);
    } catch (error) {
      console.error('Failed to create booking:', error);
      alert('Failed to create booking. Please try again.');
    }
  }

  /**
   * Handle airport search with autocomplete
   */
  function handleAirportSearch(e, type) {
    const value = e.target.value;
    let suggestionsEl;
    
    switch(type) {
      case 'from':
        suggestionsEl = elements.fromSuggestions;
        break;
      case 'to':
        suggestionsEl = elements.toSuggestions;
        break;
      case 'bookingFrom':
        suggestionsEl = elements.bookingFromSuggestions;
        break;
      case 'bookingTo':
        suggestionsEl = elements.bookingToSuggestions;
        break;
      default:
        return;
    }

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
        let input;
        switch(type) {
          case 'from':
            input = elements.fromAirport;
            break;
          case 'to':
            input = elements.toAirport;
            break;
          case 'bookingFrom':
            input = elements.bookingFromAirport;
            break;
          case 'bookingTo':
            input = elements.bookingToAirport;
            break;
        }
        
        if (input) {
        input.value = `${item.dataset.code} - ${item.dataset.city}, ${item.dataset.state}`;
        input.dataset.code = item.dataset.code;
        input.dataset.city = item.dataset.city;
        input.dataset.state = item.dataset.state;
        input.dataset.name = item.dataset.name;
        }
        suggestionsEl.classList.remove('show');
      });
    });

    suggestionsEl.classList.add('show');
  }

  /**
   * Handle airport search for edit booked modal
   */
  function handleEditBookedAirportSearch(e, type) {
    const value = e.target.value;
    
    // Map type to input and suggestions elements
    const inputMap = {
      'editBookedFrom': { input: elements.editBookedFromCode, suggestions: elements.editBookedFromSuggestions },
      'editBookedTo': { input: elements.editBookedToCode, suggestions: elements.editBookedToSuggestions },
      'editBookedReturnFrom': { input: elements.editBookedReturnFromCode, suggestions: elements.editBookedReturnFromSuggestions },
      'editBookedReturnTo': { input: elements.editBookedReturnToCode, suggestions: elements.editBookedReturnToSuggestions }
    };
    
    const { input, suggestions: suggestionsEl } = inputMap[type] || {};
    if (!input || !suggestionsEl) return;

    if (!value || value.length < 1) {
      suggestionsEl.classList.remove('show');
      return;
    }

    // Use the global searchAirports function from airports.js
    const matches = window.searchAirports ? window.searchAirports(value, 8) : [];

    if (matches.length === 0) {
      suggestionsEl.classList.remove('show');
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
      returnTimePreference: tripType === 'roundtrip' ? (elements.returnTimePreference?.value || 'any') : null,
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

    // Populate route information
    const fromCodeEl = document.getElementById('viewFromCode');
    const fromCityEl = document.getElementById('viewFromCity');
    const toCodeEl = document.getElementById('viewToCode');
    const toCityEl = document.getElementById('viewToCity');

    if (fromCodeEl && request.from) {
      fromCodeEl.textContent = request.from.code || '---';
      if (fromCityEl) {
        const cityState = request.from.city 
          ? `${request.from.city}${request.from.state ? ', ' + request.from.state : ''}`
          : 'Not specified';
        fromCityEl.textContent = cityState;
      }
    }

    if (toCodeEl && request.to) {
      toCodeEl.textContent = request.to.code || '---';
      if (toCityEl) {
        const cityState = request.to.city 
          ? `${request.to.city}${request.to.state ? ', ' + request.to.state : ''}`
          : 'Not specified';
        toCityEl.textContent = cityState;
      }
    }
    
    // Populate notes
    const viewNotesEl = document.getElementById('viewNotes');
    if (viewNotesEl) viewNotesEl.value = request.notes || '';

    // Populate created by info
    const createdByEl = document.getElementById('viewRequestCreatedBy');
    if (createdByEl) {
      if (request.createdBy) {
        const creatorName = request.createdBy.fullName || request.createdBy.email || 'Unknown';
        const createdDate = request.createdAt ? new Date(request.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }) : '';
        createdByEl.innerHTML = `
          <span class="material-symbols-outlined">person_edit</span>
          <span>Created by <strong>${creatorName}</strong>${createdDate ? ` on ${createdDate}` : ''}</span>
        `;
        createdByEl.style.display = 'flex';
      } else {
        createdByEl.style.display = 'none';
      }
    }

    // Set trip type
    document.querySelectorAll('.trip-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === request.tripType);
    });
    elements.viewReturnDateGroup?.classList.toggle('hidden', request.tripType !== 'roundtrip');

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
    elements.viewReturnDateGroup?.classList.toggle('hidden', type !== 'roundtrip');
  }

  /**
   * Render passengers accordion in view modal
   */
  function renderPassengersAccordion(requestPassengers) {
    if (!elements.viewPassengersAccordion) return;

    elements.viewPassengersAccordion.innerHTML = requestPassengers.map((p, index) => {
      // Find full passenger details
      const fullPassenger = passengers.find(fp => fp._id === p.passengerId) || {};
      
      // Get email from passenger or linked user
      const email = fullPassenger.email || (fullPassenger.userId && fullPassenger.userId.email) || '';
      
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
            ${email ? `
              <div class="passenger-email-display">
                <span class="material-symbols-outlined">email</span>
                <span class="email-text">${email}</span>
                <button class="email-copy-btn" onclick="navigator.clipboard.writeText('${email}'); event.stopPropagation();" title="Copy email">
                  <span class="material-symbols-outlined">content_copy</span>
                </button>
              </div>
            ` : ''}
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
            <div class="passenger-form-row">
              <div class="form-group">
                <label>KTN</label>
                <input type="text" value="${fullPassenger.knownTravelerNumber || ''}" data-field="knownTravelerNumber">
              </div>
              <div class="form-group">
                <label>Passport Number</label>
                <input type="text" value="${fullPassenger.passportNumber || ''}" data-field="passportNumber">
            </div>
              <div class="form-group">
                <label>Passport Expiration</label>
                <input type="date" value="${fullPassenger.passportExpiration ? formatDateForInput(fullPassenger.passportExpiration) : ''}" data-field="passportExpiration">
              </div>
            </div>
            ${fullPassenger.rewardsNumbers && fullPassenger.rewardsNumbers.length > 0 ? `
              <div class="passenger-rewards-display">
                <label style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-bottom: 6px; display: block;">Airline Rewards</label>
                ${fullPassenger.rewardsNumbers.map(reward => `
                  <div class="passenger-rewards-item">
                    <span class="airline-name">${reward.airline}</span>
                    <span class="rewards-number">${reward.number}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
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
   * Add a new rewards entry
   */
  function addRewardsEntry(modalType) {
    const rewardsArray = modalType === 'new' ? newPassengerRewards : editPassengerRewards;
    rewardsArray.push({ airline: '', number: '' });
    renderRewardsList(modalType);
  }

  /**
   * Remove a rewards entry
   */
  function removeRewardsEntry(modalType, index) {
    const rewardsArray = modalType === 'new' ? newPassengerRewards : editPassengerRewards;
    rewardsArray.splice(index, 1);
    renderRewardsList(modalType);
  }

  /**
   * Update a rewards entry field
   */
  function updateRewardsEntry(modalType, index, field, value) {
    const rewardsArray = modalType === 'new' ? newPassengerRewards : editPassengerRewards;
    if (rewardsArray[index]) {
      rewardsArray[index][field] = value;
    }
  }

  /**
   * Render rewards list
   */
  function renderRewardsList(modalType) {
    const listId = modalType === 'new' ? 'newPassengerRewardsList' : 'editPassengerRewardsList';
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    const rewardsArray = modalType === 'new' ? newPassengerRewards : editPassengerRewards;

    if (rewardsArray.length === 0) {
      listEl.innerHTML = '<div class="rewards-list empty">No airline rewards added</div>';
      return;
    }

    listEl.innerHTML = rewardsArray.map((reward, index) => `
      <div class="rewards-entry">
        <div class="form-group">
          <label>Airline</label>
          <input 
            type="text" 
            class="rewards-airline" 
            data-modal="${modalType}"
            data-index="${index}"
            value="${reward.airline || ''}" 
            placeholder="e.g., Delta, United">
        </div>
        <div class="form-group">
          <label>Rewards Number</label>
          <input 
            type="text" 
            class="rewards-number" 
            data-modal="${modalType}"
            data-index="${index}"
            value="${reward.number || ''}" 
            placeholder="Enter rewards number">
        </div>
        <button type="button" class="btn-remove-rewards" data-modal="${modalType}" data-index="${index}" title="Remove rewards">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    `).join('');

    // Add event listeners for input changes
    listEl.querySelectorAll('.rewards-airline').forEach(input => {
      input.addEventListener('input', (e) => {
        const modal = e.target.dataset.modal;
        const index = parseInt(e.target.dataset.index);
        updateRewardsEntry(modal, index, 'airline', e.target.value);
      });
    });

    listEl.querySelectorAll('.rewards-number').forEach(input => {
      input.addEventListener('input', (e) => {
        const modal = e.target.dataset.modal;
        const index = parseInt(e.target.dataset.index);
        updateRewardsEntry(modal, index, 'number', e.target.value);
      });
    });

    // Add event listeners for remove buttons
    listEl.querySelectorAll('.btn-remove-rewards').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.currentTarget.dataset.modal;
        const index = parseInt(e.currentTarget.dataset.index);
        removeRewardsEntry(modal, index);
      });
    });
  }

  /**
   * Open add passenger modal
   */
  function openAddPassengerModal() {
    elements.addPassengerModal?.classList.add('show');
    elements.addPassengerForm?.reset();
    newPassengerRewards = [];
    renderRewardsList('new');
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

    // Filter out empty rewards entries
    const rewardsNumbers = newPassengerRewards.filter(r => r.airline && r.number);

    const passengerData = {
      firstName: document.getElementById('newPassengerFirst').value,
      middleName: document.getElementById('newPassengerMiddle').value,
      lastName: document.getElementById('newPassengerLast').value,
      userId: document.getElementById('newPassengerUserId').value || null,
      dateOfBirth: document.getElementById('newPassengerDob').value || null,
      gender: document.getElementById('newPassengerGender').value,
      rewardsNumbers: rewardsNumbers,
      knownTravelerNumber: document.getElementById('newPassengerKtn').value,
      passportNumber: document.getElementById('newPassengerPassport').value,
      passportExpiration: document.getElementById('newPassengerPassportExp').value || null,
      notes: document.getElementById('newPassengerNotes').value
    };

    try {
      const newPassenger = await apiRequest('/api/passengers', {
        method: 'POST',
        body: JSON.stringify(passengerData)
      });

      passengers.push(newPassenger);
      populatePassengerDropdown();
      populateBookingPassengerDropdown();

      // Also add to selected passengers (for whichever modal is open)
      if (elements.createRequestModal?.classList.contains('show')) {
      selectedPassengers.push({
        passengerId: newPassenger._id,
        name: newPassenger.fullName || `${newPassenger.firstName} ${newPassenger.lastName}`
      });
      renderSelectedPassengers();
      } else if (elements.createBookingModal?.classList.contains('show')) {
        bookingSelectedPassengers.push({
          passengerId: newPassenger._id,
          name: newPassenger.fullName || `${newPassenger.firstName} ${newPassenger.lastName}`
        });
        renderBookingSelectedPassengers();
      }

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
    const returnSection = document.getElementById('viewBookingReturnSection');
    
    if (bookingSection) {
      bookingSection.style.display = 'block';
      
      // Clear previous values
      document.getElementById('bookingConfirmation').value = '';
      document.getElementById('bookingAirline').value = '';
      document.getElementById('viewBookingDepartTime').value = '';
      document.getElementById('viewBookingArriveTime').value = '';
      document.getElementById('viewBookingFlightNumber').value = '';
      document.getElementById('viewBookingReturnDepartTime').value = '';
      document.getElementById('viewBookingReturnArriveTime').value = '';
      document.getElementById('viewBookingReturnFlightNumber').value = '';
      
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
      departTime: document.getElementById('viewBookingDepartTime').value,
      arriveTime: document.getElementById('viewBookingArriveTime').value,
      flightNumber: document.getElementById('viewBookingFlightNumber').value.trim()
    };

    let returnBookedDetails = null;
    if (tripType === 'roundtrip') {
      returnBookedDetails = {
        departTime: document.getElementById('viewBookingReturnDepartTime').value,
        arriveTime: document.getElementById('viewBookingReturnArriveTime').value,
        flightNumber: document.getElementById('viewBookingReturnFlightNumber').value.trim()
      };
    }

    try {
      // Save passenger info before the request is modified
      const requestPassengers = currentEditingRequest.passengers || [];
      
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

      // Close view modal
      closeViewModal();

      // Show booking confirmed modal with passenger emails
      showBookingConfirmedModal(requestPassengers);

      console.log('✅ Flight booked:', bookedFlight._id);
    } catch (error) {
      console.error('Failed to book flight:', error);
      alert('Failed to book flight. Please try again.');
    }
  }

  /**
   * Show booking confirmed modal with passenger emails
   */
  function showBookingConfirmedModal(requestPassengers) {
    const modal = document.getElementById('bookingConfirmedModal');
    const emailsList = document.getElementById('passengerEmailsList');
    const noEmailsMessage = document.getElementById('noEmailsMessage');
    
    if (!modal || !emailsList) return;
    
    // Collect unique emails from passengers
    const emails = [];
    requestPassengers.forEach(p => {
      const fullPassenger = passengers.find(fp => fp._id === p.passengerId) || {};
      const email = fullPassenger.email || 
        (fullPassenger.userId && typeof fullPassenger.userId === 'object' ? fullPassenger.userId.email : null) ||
        (fullPassenger.userId && users.find(u => u._id === fullPassenger.userId)?.email);
      
      if (email && !emails.some(e => e.email === email)) {
        emails.push({
          name: p.name || fullPassenger.fullName || `${fullPassenger.firstName} ${fullPassenger.lastName}`.trim(),
          email: email
        });
      }
    });
    
    // Populate emails list
    if (emails.length > 0) {
      emailsList.innerHTML = emails.map(e => `
        <div class="email-row">
          <div class="email-info">
            <span class="passenger-name">${e.name}</span>
            <span class="passenger-email">${e.email}</span>
          </div>
          <button class="btn-copy-email" onclick="copyToClipboard('${e.email}', this)" title="Copy email">
            <span class="material-symbols-outlined">content_copy</span>
          </button>
        </div>
      `).join('');
      emailsList.style.display = 'block';
      if (noEmailsMessage) noEmailsMessage.style.display = 'none';
    } else {
      emailsList.style.display = 'none';
      if (noEmailsMessage) noEmailsMessage.style.display = 'flex';
    }
    
    modal.classList.add('show');
  }
  
  /**
   * Close booking confirmed modal
   */
  function closeBookingConfirmedModal() {
    const modal = document.getElementById('bookingConfirmedModal');
    if (modal) modal.classList.remove('show');
  }
  
  /**
   * Copy to clipboard helper
   */
  window.copyToClipboard = function(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      // Visual feedback
      const icon = button.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.textContent = 'check';
        setTimeout(() => {
          icon.textContent = 'content_copy';
        }, 1500);
      }
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  /**
   * Handle delete request
   */
  async function handleDeleteRequest() {
    if (!currentEditingRequest) return;

    const confirmed = confirm(`Are you sure you want to delete this flight request?\n\nEvent: ${currentEditingRequest.eventName || 'Flight Request'}\n\nThis action cannot be undone.`);
    
    if (!confirmed) return;

    const requestId = currentEditingRequest._id; // Save ID before closing modal

    try {
      await apiRequest(`/api/flights/${requestId}`, {
        method: 'DELETE'
      });

      // Remove from pending list
      flightRequests = flightRequests.filter(f => f._id !== requestId);
      
      // Re-render
      renderPendingRequests();

      // Close modal
      closeViewModal();

      console.log('✅ Flight request deleted:', requestId);
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
    
    // Outbound From airport - display with city/state and set dataset
    const fromInput = document.getElementById('editBookedFromCode');
    if (fromInput) {
      const fromDisplay = flight.from?.city 
        ? `${flight.from.code} - ${flight.from.city}, ${flight.from.state || ''}`
        : flight.from?.code || '';
      fromInput.value = fromDisplay;
      fromInput.dataset.code = flight.from?.code || '';
      fromInput.dataset.city = flight.from?.city || '';
      fromInput.dataset.state = flight.from?.state || '';
      fromInput.dataset.name = flight.from?.name || '';
    }
    
    // Outbound To airport - display with city/state and set dataset
    const toInput = document.getElementById('editBookedToCode');
    if (toInput) {
      const toDisplay = flight.to?.city 
        ? `${flight.to.code} - ${flight.to.city}, ${flight.to.state || ''}`
        : flight.to?.code || '';
      toInput.value = toDisplay;
      toInput.dataset.code = flight.to?.code || '';
      toInput.dataset.city = flight.to?.city || '';
      toInput.dataset.state = flight.to?.state || '';
      toInput.dataset.name = flight.to?.name || '';
    }
    
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
      
      // Return From airport (which is the original destination)
      const returnFromInput = document.getElementById('editBookedReturnFromCode');
      if (returnFromInput) {
        const returnFromDisplay = flight.to?.city 
          ? `${flight.to.code} - ${flight.to.city}, ${flight.to.state || ''}`
          : flight.to?.code || '';
        returnFromInput.value = returnFromDisplay;
        returnFromInput.dataset.code = flight.to?.code || '';
        returnFromInput.dataset.city = flight.to?.city || '';
        returnFromInput.dataset.state = flight.to?.state || '';
        returnFromInput.dataset.name = flight.to?.name || '';
      }
      
      // Return To airport (which is the original departure)
      const returnToInput = document.getElementById('editBookedReturnToCode');
      if (returnToInput) {
        const returnToDisplay = flight.from?.city 
          ? `${flight.from.code} - ${flight.from.city}, ${flight.from.state || ''}`
          : flight.from?.code || '';
        returnToInput.value = returnToDisplay;
        returnToInput.dataset.code = flight.from?.code || '';
        returnToInput.dataset.city = flight.from?.city || '';
        returnToInput.dataset.state = flight.from?.state || '';
        returnToInput.dataset.name = flight.from?.name || '';
      }
      
      document.getElementById('editBookedReturnDepartTime').value = returnBookedDetails.departTime || '';
      document.getElementById('editBookedReturnArriveTime').value = returnBookedDetails.arriveTime || '';
    }

    // Populate notes
    const editBookedNotesEl = document.getElementById('editBookedNotes');
    if (editBookedNotesEl) editBookedNotesEl.value = flight.notes || '';

    // Populate booked by info
    const bookedByInfoEl = document.getElementById('editBookedByInfo');
    if (bookedByInfoEl) {
      const bookedDetails = flight.bookedDetails || {};
      if (bookedDetails.bookedBy) {
        const bookerName = bookedDetails.bookedBy.fullName || bookedDetails.bookedBy.email || 'Unknown';
        const bookedDate = bookedDetails.bookedAt ? new Date(bookedDetails.bookedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        }) : '';
        bookedByInfoEl.innerHTML = `
          <span class="material-symbols-outlined">check_circle</span>
          <span>Booked by <strong>${bookerName}</strong>${bookedDate ? ` on ${bookedDate}` : ''}</span>
        `;
        bookedByInfoEl.style.display = 'flex';
      } else {
        bookedByInfoEl.style.display = 'none';
      }
    }

    // Initialize passengers for editing
    editBookedSelectedPassengers = (flight.passengers || []).map(p => ({
      passengerId: p.passengerId,
      name: p.name
    }));
    
    // Render passengers and populate dropdown
    renderBookedPassengersChips();
    populateEditBookedPassengerDropdown();
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
  function renderBookedPassengersChips() {
    if (!elements.editBookedPassengers) return;

    if (editBookedSelectedPassengers.length === 0) {
      elements.editBookedPassengers.innerHTML = '<div class="no-passengers">No passengers added</div>';
      return;
    }

    elements.editBookedPassengers.innerHTML = editBookedSelectedPassengers.map(p => `
      <div class="passenger-chip removable" data-id="${p.passengerId}">
        <span class="material-symbols-outlined">person</span>
        <span>${p.name}</span>
        <button type="button" class="remove-passenger-chip" data-id="${p.passengerId}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `).join('');

    // Add click handlers for remove buttons
    elements.editBookedPassengers.querySelectorAll('.remove-passenger-chip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const passengerId = btn.dataset.id;
        editBookedSelectedPassengers = editBookedSelectedPassengers.filter(p => p.passengerId !== passengerId);
        renderBookedPassengersChips();
        populateEditBookedPassengerDropdown();
      });
    });
  }

  /**
   * Populate passenger dropdown for edit booked modal
   */
  function populateEditBookedPassengerDropdown() {
    if (!elements.editBookedPassengerSelect) return;

    elements.editBookedPassengerSelect.innerHTML = '<option value="">Select passenger to add...</option>';
    
    // Filter out already selected passengers
    const selectedIds = editBookedSelectedPassengers.map(p => p.passengerId);
    const availablePassengers = passengers.filter(p => !selectedIds.includes(p._id));
    
    availablePassengers.forEach(passenger => {
      const option = document.createElement('option');
      option.value = passenger._id;
      option.textContent = `${passenger.firstName} ${passenger.lastName}`;
      elements.editBookedPassengerSelect.appendChild(option);
    });
  }

  /**
   * Handle adding passenger in edit booked modal
   */
  function handleEditBookedAddPassenger() {
    const select = elements.editBookedPassengerSelect;
    if (!select || !select.value) return;

    const passengerId = select.value;
    const passenger = passengers.find(p => p._id === passengerId);
    
    if (!passenger) return;

    // Check if already added
    if (editBookedSelectedPassengers.some(p => p.passengerId === passengerId)) {
      return;
    }

    editBookedSelectedPassengers.push({
      passengerId: passenger._id,
      name: `${passenger.firstName} ${passenger.lastName}`
    });

    renderBookedPassengersChips();
    populateEditBookedPassengerDropdown();
    select.value = '';
  }

  /**
   * Handle save booked flight changes
   */
  async function handleSaveBookedFlight(e) {
    e.preventDefault();

    if (!currentEditingRequest) return;

    const isRoundtrip = currentEditingRequest.tripType === 'roundtrip';
    
    // Parse airport inputs with city/state from dataset
    const fromInput = document.getElementById('editBookedFromCode');
    const toInput = document.getElementById('editBookedToCode');
    
    const fromAirport = {
      code: fromInput?.dataset.code || fromInput?.value?.substring(0, 3).toUpperCase() || '',
      city: fromInput?.dataset.city || currentEditingRequest.from?.city || '',
      state: fromInput?.dataset.state || currentEditingRequest.from?.state || '',
      name: fromInput?.dataset.name || currentEditingRequest.from?.name || ''
    };
    
    const toAirport = {
      code: toInput?.dataset.code || toInput?.value?.substring(0, 3).toUpperCase() || '',
      city: toInput?.dataset.city || currentEditingRequest.to?.city || '',
      state: toInput?.dataset.state || currentEditingRequest.to?.state || '',
      name: toInput?.dataset.name || currentEditingRequest.to?.name || ''
    };

    const updateData = {
      eventName: document.getElementById('editBookedEventName').value,
      departDate: document.getElementById('editBookedDepartDate').value,
      returnDate: isRoundtrip ? document.getElementById('editBookedReturnDate').value : null,
      from: fromAirport,
      to: toAirport,
      notes: document.getElementById('editBookedNotes')?.value?.trim() || '',
      passengers: editBookedSelectedPassengers,
      bookedDetails: {
        confirmationCode: document.getElementById('editBookedConfirmation').value,
        airline: document.getElementById('editBookedAirline').value,
        flightNumber: document.getElementById('editBookedFlightNumber').value,
        departTime: document.getElementById('editBookedDepartTime').value,
        arriveTime: document.getElementById('editBookedArriveTime').value,
        // Preserve original booking metadata
        bookedBy: currentEditingRequest.bookedDetails?.bookedBy?._id || currentEditingRequest.bookedDetails?.bookedBy,
        bookedAt: currentEditingRequest.bookedDetails?.bookedAt
      }
    };

    if (isRoundtrip) {
      updateData.returnBookedDetails = {
        flightNumber: document.getElementById('editBookedReturnFlightNumber').value,
        departTime: document.getElementById('editBookedReturnDepartTime').value,
        arriveTime: document.getElementById('editBookedReturnArriveTime').value,
        // Preserve original booking metadata
        bookedBy: currentEditingRequest.returnBookedDetails?.bookedBy?._id || currentEditingRequest.returnBookedDetails?.bookedBy,
        bookedAt: currentEditingRequest.returnBookedDetails?.bookedAt
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
      // Handle userId - it may be populated (object) or just an ID string
      const userIdStr = passenger.userId 
        ? (typeof passenger.userId === 'object' ? passenger.userId._id : passenger.userId)
        : null;
      // If populated, we can use the data directly; otherwise look up in users array
      const linkedUser = passenger.userId 
        ? (typeof passenger.userId === 'object' ? passenger.userId : users.find(u => u._id === userIdStr))
        : null;
      const fullName = passenger.fullName || `${passenger.firstName} ${passenger.middleName || ''} ${passenger.lastName}`.replace(/\s+/g, ' ').trim();
      
      // Display rewards numbers
      let rewardsDisplay = '-';
      if (passenger.rewardsNumbers && passenger.rewardsNumbers.length > 0) {
        rewardsDisplay = `<div class="passenger-rewards-compact">
          ${passenger.rewardsNumbers.map(r => `<span class="rewards-badge">${r.airline}: ${r.number}</span>`).join('')}
        </div>`;
      } else if (passenger.rewards) {
        // Fallback for legacy rewards field
        rewardsDisplay = passenger.rewards;
      }

      // Display passport info
      let passportDisplay = '-';
      if (passenger.passportNumber) {
        const expDate = passenger.passportExpiration ? new Date(passenger.passportExpiration) : null;
        const isExpiringSoon = expDate && expDate < new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // Within 6 months
        const isExpired = expDate && expDate < new Date();
        const expClass = isExpired ? 'passport-expired' : (isExpiringSoon ? 'passport-expiring' : '');
        const expText = expDate ? formatDateDisplay(passenger.passportExpiration) : 'No expiration';
        passportDisplay = `<div class="passport-info ${expClass}" title="${passenger.passportNumber}">
          <div class="passport-number">${passenger.passportNumber}</div>
          <div class="passport-exp">${expText}</div>
        </div>`;
      }
      
      return `
        <tr data-passenger-id="${passenger._id}">
          <td class="passenger-name-cell">${fullName}</td>
          <td>
            ${linkedUser ? `
              <span class="linked-user-badge">
                <span class="material-symbols-outlined">person</span>
                ${linkedUser.fullName || linkedUser.name || linkedUser.email}
              </span>
            ` : '<span class="no-linked-user">Not linked</span>'}
          </td>
          <td>${rewardsDisplay}</td>
          <td>${passenger.knownTravelerNumber || '-'}</td>
          <td>${passportDisplay}</td>
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
    
    // Handle userId - it may be populated (object) or just an ID string
    const userIdValue = passenger.userId 
      ? (typeof passenger.userId === 'object' ? passenger.userId._id : passenger.userId)
      : '';
    document.getElementById('editPassengerUserId').value = userIdValue;
    
    document.getElementById('editPassengerDob').value = passenger.dateOfBirth ? formatDateForInput(passenger.dateOfBirth) : '';
    document.getElementById('editPassengerGender').value = passenger.gender || '';
    document.getElementById('editPassengerKtn').value = passenger.knownTravelerNumber || '';
    document.getElementById('editPassengerPassport').value = passenger.passportNumber || '';
    document.getElementById('editPassengerPassportExp').value = passenger.passportExpiration ? formatDateForInput(passenger.passportExpiration) : '';
    document.getElementById('editPassengerNotes').value = passenger.notes || '';

    // Load rewards numbers
    editPassengerRewards = passenger.rewardsNumbers && passenger.rewardsNumbers.length > 0 
      ? [...passenger.rewardsNumbers] 
      : [];
    renderRewardsList('edit');
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

    // Filter out empty rewards entries
    const rewardsNumbers = editPassengerRewards.filter(r => r.airline && r.number);

    const passengerData = {
      firstName: document.getElementById('editPassengerFirst').value,
      middleName: document.getElementById('editPassengerMiddle').value,
      lastName: document.getElementById('editPassengerLast').value,
      userId: document.getElementById('editPassengerUserId').value || null,
      dateOfBirth: document.getElementById('editPassengerDob').value || null,
      gender: document.getElementById('editPassengerGender').value,
      rewardsNumbers: rewardsNumbers,
      knownTravelerNumber: document.getElementById('editPassengerKtn').value,
      passportNumber: document.getElementById('editPassengerPassport').value,
      passportExpiration: document.getElementById('editPassengerPassportExp').value || null,
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
