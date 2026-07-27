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
  let currentChangeRequestFlight = null; // For request change modal
  let currentApprovingChangeRequestId = null; // For approve change modal
  let pendingViewType = 'cards'; // 'cards' or 'table'
  let bookedViewType = 'cards'; // 'cards' or 'table'

  function parseFlightCost(value) {
    const n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

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

  /**
   * Wrap an async submit/click handler so it can't run concurrently with itself.
   * Prevents duplicate records from double-taps / "ghost clicks" on mobile and
   * impatient re-taps while a slow request is still in flight. Also disables the
   * relevant submit/button control for the duration of the request.
   */
  function guardSubmit(handler) {
    let busy = false;
    return async function guardedHandler(e) {
      if (busy) {
        // Block the duplicate invocation (and any native form submission).
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }

      // Resolve the control to disable: the clicked button for click handlers,
      // or the form's submit button for submit handlers.
      const target = e && e.currentTarget;
      let control = null;
      if (target && target.tagName === 'BUTTON') {
        control = target;
      } else {
        const form = (target && target.tagName === 'FORM')
          ? target
          : (e && e.target && e.target.closest ? e.target.closest('form') : null);
        control = form ? form.querySelector('button[type="submit"], [type="submit"]') : null;
      }

      busy = true;
      const prevDisabled = control ? control.disabled : null;
      if (control) control.disabled = true;

      try {
        return await handler.call(this, e);
      } finally {
        busy = false;
        if (control) control.disabled = prevDisabled === null ? false : prevDisabled;
      }
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
    viewEventSuggestions: document.getElementById('viewEventSuggestions'),
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
    editBookedEventName: document.getElementById('editBookedEventName'),
    editBookedEventSuggestions: document.getElementById('editBookedEventSuggestions'),
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

    // Request Change Modal
    requestChangeModal: document.getElementById('requestChangeModal'),
    closeRequestChangeModal: document.getElementById('closeRequestChangeModal'),
    cancelRequestChangeBtn: document.getElementById('cancelRequestChangeBtn'),
    requestChangeForm: document.getElementById('requestChangeForm'),
    changeCurrentSummary: document.getElementById('changeCurrentSummary'),
    changeDepartDate: document.getElementById('changeDepartDate'),
    changeReturnDate: document.getElementById('changeReturnDate'),
    changeDepartTimePreference: document.getElementById('changeDepartTimePreference'),
    changeReturnTimePreference: document.getElementById('changeReturnTimePreference'),
    changeReason: document.getElementById('changeReason'),

    // Approve Change Modal
    approveChangeModal: document.getElementById('approveChangeModal'),
    closeApproveChangeModal: document.getElementById('closeApproveChangeModal'),
    cancelApproveChangeBtn: document.getElementById('cancelApproveChangeBtn'),
    approveChangeForm: document.getElementById('approveChangeForm'),
    approveChangeSummary: document.getElementById('approveChangeSummary'),
    approveReturnFlightSection: document.getElementById('approveReturnFlightSection'),

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
   * Get the display name for a flight's event.
   * Prefers populated eventId.title (always up-to-date) over stored eventName.
   */
  function getEventDisplayName(flight, fallback = 'Flight') {
    return flight.eventId?.title || flight.eventName || fallback;
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

      // Deep-link: auto-open a specific flight modal if ?flightId= is in the URL
      const urlParams = new URLSearchParams(window.location.search);
      const deepLinkFlightId = urlParams.get('flightId');
      if (deepLinkFlightId) {
        const pendingMatch = flightRequests.find(r => r._id === deepLinkFlightId);
        const bookedMatch = bookedFlights.find(f => f._id === deepLinkFlightId);
        if (pendingMatch) {
          openViewModal(pendingMatch);
        } else if (bookedMatch) {
          openEditBookedFlightModal(bookedMatch);
        } else {
          console.warn('⚠️ Deep-link flight not found:', deepLinkFlightId);
        }
        // Clean up the URL so refreshing doesn't re-open the modal
        window.history.replaceState({}, '', window.location.pathname);
      }

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
    elements.createRequestForm?.addEventListener('submit', guardSubmit(handleCreateRequest));

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

    // View Request Modal event name search
    elements.viewEventName?.addEventListener('input', handleViewEventSearch);

    // View Request Modal
    elements.closeViewModal?.addEventListener('click', closeViewModal);
    elements.cancelViewBtn?.addEventListener('click', closeViewModal);
    elements.viewRequestModal?.addEventListener('click', (e) => {
      if (e.target === elements.viewRequestModal) closeViewModal();
    });
    elements.viewRequestForm?.addEventListener('submit', guardSubmit(handleSaveChanges));

    // Trip type buttons in view modal
    document.querySelectorAll('.trip-type-btn').forEach(btn => {
      btn.addEventListener('click', handleViewTripTypeChange);
    });

    // Book Flight button
    document.getElementById('bookFlightBtn')?.addEventListener('click', showBookingSection);
    document.getElementById('closeBookingSection')?.addEventListener('click', hideBookingSection);
    document.getElementById('cancelBookingBtn')?.addEventListener('click', hideBookingSection);
    document.getElementById('confirmBookingBtn')?.addEventListener('click', guardSubmit(handleConfirmBooking));

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
    elements.addPassengerForm?.addEventListener('submit', guardSubmit(handleAddNewPassenger));

    // Edit Booked Flight Modal
    elements.closeEditBookedModal?.addEventListener('click', closeEditBookedModal);
    elements.cancelEditBookedBtn?.addEventListener('click', closeEditBookedModal);
    elements.editBookedModal?.addEventListener('click', (e) => {
      if (e.target === elements.editBookedModal) closeEditBookedModal();
    });
    elements.editBookedForm?.addEventListener('submit', guardSubmit(handleSaveBookedFlight));
    document.getElementById('deleteBookedFlightBtn')?.addEventListener('click', handleDeleteCurrentBookedFlight);

    // Edit booked event name search
    elements.editBookedEventName?.addEventListener('input', handleEditBookedEventSearch);

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
    elements.editPassengerForm?.addEventListener('submit', guardSubmit(handleSavePassenger));
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
    elements.createBookingForm?.addEventListener('submit', guardSubmit(handleCreateBooking));

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

    // Request Change Modal
    elements.closeRequestChangeModal?.addEventListener('click', closeRequestChangeModal);
    elements.cancelRequestChangeBtn?.addEventListener('click', closeRequestChangeModal);
    elements.requestChangeModal?.addEventListener('click', (e) => {
      if (e.target === elements.requestChangeModal) closeRequestChangeModal();
    });
    elements.requestChangeForm?.addEventListener('submit', guardSubmit(handleSubmitChangeRequest));

    // Change field checkboxes - toggle visibility of corresponding input fields
    document.querySelectorAll('input[name="changeField"]').forEach(cb => {
      cb.addEventListener('change', handleChangeFieldToggle);
    });

    // Approve Change Modal
    elements.closeApproveChangeModal?.addEventListener('click', closeApproveChangeModal);
    elements.cancelApproveChangeBtn?.addEventListener('click', closeApproveChangeModal);
    elements.approveChangeModal?.addEventListener('click', (e) => {
      if (e.target === elements.approveChangeModal) closeApproveChangeModal();
    });
    elements.approveChangeForm?.addEventListener('submit', guardSubmit(handleConfirmApproveChange));

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
   * Parse a flight date value into a valid local Date object (date-only, timezone-safe).
   * 
   * Flight dates are calendar dates (e.g. "Feb 9") with no specific time or timezone.
   * They're stored as UTC midnight in MongoDB (e.g. "2026-02-09T00:00:00.000Z"), but
   * must be treated as LOCAL calendar dates to avoid timezone shifts.
   *
   * Without this fix, "2026-02-09T00:00:00.000Z" parsed via new Date() in EST becomes
   * Feb 8 at 7pm local → after setHours(0,0,0,0) it's Feb 8 — the WRONG day.
   *
   * This function always extracts the YYYY-MM-DD portion and creates a local date at noon,
   * which avoids both UTC-to-local day shifts and DST edge cases.
   */
  function parseFlightDate(value) {
    if (!value) return null;
    
    if (value instanceof Date) {
      if (isNaN(value.getTime())) return null;
      // Extract UTC components to avoid local timezone shifting the day
      return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0);
    }
    
    if (typeof value === 'string') {
      // Extract YYYY-MM-DD from any string format (ISO, plain date, etc.)
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 12, 0, 0, 0);
      }
      // Fallback for non-standard formats
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
    
    return null;
  }

  /**
   * Get the "upcoming" cutoff date.
   * 
   * Flight dates are calendar dates booked in the departure city's local time.
   * A user in EST at 1am (Feb 10) should still see a flight booked for Feb 9 in PST
   * (where it's still 10pm on Feb 9). To handle this, we subtract 1 day from "today"
   * as a timezone grace period. This means:
   *   - "Upcoming" includes: yesterday, today, and future flights
   *   - "Past" includes: 2+ days ago
   * This generous buffer ensures no flight disappears from "upcoming" prematurely
   * due to timezone differences across the US (max ~6 hours continental, ~10 hours with Hawaii).
   */
  function getUpcomingCutoff() {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 1);
    return cutoff;
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
    
    // Use timezone-tolerant cutoff for upcoming/past filtering
    const cutoff = getUpcomingCutoff();
    
    // Filter flights
    let filteredRequests = flightRequests.filter(request => {
      // Search filter
      if (searchTerm) {
        const searchFields = [
          getEventDisplayName(request, ''),
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
        
        if (filterValue === 'upcoming' && departDate < cutoff) return false;
        if (filterValue === 'past' && departDate >= cutoff) return false;
      }
      
      return true;
    });
    
    // Sort flights by depart date
    filteredRequests.sort((a, b) => {
      const dateA = parseFlightDate(a.departDate) || new Date(0);
      const dateB = parseFlightDate(b.departDate) || new Date(0);
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
    
    // Use timezone-tolerant cutoff for upcoming/past filtering
    const cutoff = getUpcomingCutoff();
    
    // Filter flights
    let filteredFlights = bookedFlights.filter(flight => {
      // Search filter
      if (searchTerm) {
        const searchFields = [
          getEventDisplayName(flight, ''),
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
        
        // For upcoming: at least one date is in the future (or within timezone grace period)
        // For past: all dates are before the cutoff
        const latestDate = returnDate && returnDate > departDate ? returnDate : departDate;
        
        if (filterValue === 'upcoming' && latestDate < cutoff) return false;
        if (filterValue === 'past' && latestDate >= cutoff) return false;
      }
      
      return true;
    });
    
    // Sort flights by depart date
    filteredFlights.sort((a, b) => {
      const dateA = parseFlightDate(a.departDate) || new Date(0);
      const dateB = parseFlightDate(b.departDate) || new Date(0);
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
            <th>Type</th>
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
            const isChangeRequest = request.status === 'change_requested';
            const departDateStr = formatFlightDateTable(request.departDate);
            const returnDateStr = request.returnDate ? formatFlightDateTable(request.returnDate) : '—';
            const departTimePref = formatTimePreference(request.departTimePreference);
            const returnTimePref = formatTimePreference(request.returnTimePreference);
            
            return `
              <tr data-request-id="${request._id}" class="${isChangeRequest ? 'change-request-row' : ''}" onclick="window.openViewModal(event, '${request._id}')">
                <td>
                  ${isChangeRequest 
                    ? '<span class="table-change-badge">Change</span>' 
                    : '<span class="table-pending-badge">New</span>'}
                </td>
                <td>
                  <div class="table-passengers">
                    ${(request.passengers || []).map(p => 
                      `<span class="table-passenger-chip">${p.name || 'Unknown'}</span>`
                    ).join('')}
                  </div>
                </td>
                <td class="table-date">${departDateStr}</td>
                <td class="table-time">${departTimePref}</td>
                <td class="table-date">${returnDateStr}</td>
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
                <td class="table-event">${getEventDisplayName(request)}</td>
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
      const departDateStr = formatFlightDateTable(flight.departDate);
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
            ${departDateStr}
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
          <td class="table-event">${getEventDisplayName(flight)}</td>
        </tr>
      `);
      
      // Return row for round trips
      if (flight.tripType === 'roundtrip' && flight.returnDate) {
        const returnDateStr = formatFlightDateTable(flight.returnDate);
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
              ${returnDateStr}
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
            <td class="table-event">${getEventDisplayName(flight)}</td>
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
   * Format date for display - timezone-safe
   */
  function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const date = parseFlightDate(dateStr);
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  }

  /**
   * Format flight date for table cells (same calendar date as card view)
   */
  function formatFlightDateTable(value) {
    const date = parseFlightDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
      'early_morning': 'Early Morning',
      'morning': 'Morning',
      'midday': 'Midday',
      'afternoon': 'Afternoon',
      'evening': 'Evening',
      'night': 'Night',
      'redeye': 'Red-eye'
    };
    return preferences[pref] || pref;
  }

  /**
   * Create pending request card HTML
   */
  function createPendingRequestCard(request) {
    const card = document.createElement('div');
    const isChangeRequest = request.status === 'change_requested';
    card.className = `flight-card${isChangeRequest ? ' change-request-card' : ''}`;
    
    const departDisplay = formatDateDisplay(request.departDate);
    const returnDisplay = request.returnDate ? formatDateDisplay(request.returnDate) : null;

    // For change requests, show what changed
    let changeInfoHTML = '';
    if (isChangeRequest && request.changeDetails) {
      const changes = request.changeDetails.requestedChanges || {};
      const changedItems = [];
      if (changes.cancelFlight) changedItems.push('Cancel Flight');
      if (changes.departDate) changedItems.push('Outbound Date');
      if (changes.returnDate) changedItems.push('Return Date');
      if (changes.departTimePreference) changedItems.push('Outbound Time');
      if (changes.returnTimePreference) changedItems.push('Return Time');

      changeInfoHTML = `
        <div class="change-request-info">
          <span class="material-symbols-outlined">${changes.cancelFlight ? 'flight_land' : 'edit_calendar'}</span>
          <div class="change-request-details">
            <span class="change-request-label">${changes.cancelFlight ? 'Cancellation Requested' : 'Changes Requested:'}</span>
            <span class="change-request-fields">${changes.cancelFlight ? '' : (changedItems.join(', ') || 'See details')}</span>
          </div>
        </div>
        ${request.changeDetails.changeReason ? `
          <div class="change-request-reason">
            <span class="material-symbols-outlined">comment</span>
            <span>${request.changeDetails.changeReason}</span>
          </div>
        ` : ''}
      `;
    }
    
    card.innerHTML = `
      <div class="flight-card-header">
        <h3 class="flight-event-name">${getEventDisplayName(request, 'Flight Request')}</h3>
        <div class="flight-card-badges">
          ${isChangeRequest ? '<span class="flight-change-badge">Change Request</span>' : ''}
          <span class="flight-type-badge">${request.tripType === 'roundtrip' ? 'Roundtrip' : 'One-way'}</span>
        </div>
      </div>
      <div class="flight-card-body">
        ${changeInfoHTML}
        
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
          <span>${isChangeRequest ? 'Requested' : 'Created'} by ${request.createdBy.fullName || request.createdBy.email || 'Unknown'}</span>
        </div>
        ` : ''}
      </div>
      <div class="flight-card-footer">
        ${isChangeRequest ? `
          <div class="change-request-actions">
            <button class="btn-approve-change" data-request-id="${request._id}">
              <span class="material-symbols-outlined">check_circle</span>
              <span>Approve</span>
            </button>
            <button class="btn-reject-change" data-request-id="${request._id}">
              <span class="material-symbols-outlined">cancel</span>
              <span>Reject</span>
            </button>
          </div>
        ` : `
          <button class="btn-view-request" data-request-id="${request._id}">
            <span>View Request</span>
            <span class="material-symbols-outlined">chevron_right</span>
          </button>
        `}
      </div>
    `;

    // Add click handlers
    if (isChangeRequest) {
      const approveBtn = card.querySelector('.btn-approve-change');
      const rejectBtn = card.querySelector('.btn-reject-change');
      approveBtn?.addEventListener('click', () => handleApproveChangeRequest(request._id));
      rejectBtn?.addEventListener('click', () => handleRejectChangeRequest(request._id));
    } else {
      const viewBtn = card.querySelector('.btn-view-request');
      viewBtn?.addEventListener('click', () => openViewModal(request));
    }

    return card;
  }

  /**
   * Create booked flight card HTML
   */
  function createBookedFlightCard(flight, isReturn = false) {
    const card = document.createElement('div');
    const isCancelled = flight.status === 'cancelled';
    card.className = `booked-flight-card${isCancelled ? ' cancelled' : ''}`;
    
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
        <span class="booked-event-name">${getEventDisplayName(flight)}</span>
        <div class="booked-menu-wrapper">
          <button class="booked-menu-btn" title="More options">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
          <div class="booked-menu-dropdown">
            ${isCancelled ? `
            <button class="booked-menu-item restore" data-action="restore">
              <span class="material-symbols-outlined">undo</span>
              <span>Restore Flight</span>
            </button>
            ` : `
            <button class="booked-menu-item" data-action="request-change">
              <span class="material-symbols-outlined">edit_calendar</span>
              <span>Request Change</span>
            </button>
            <button class="booked-menu-item" data-action="edit">
              <span class="material-symbols-outlined">edit</span>
              <span>Edit</span>
            </button>
            <button class="booked-menu-item cancel-flight" data-action="cancel">
              <span class="material-symbols-outlined">block</span>
              <span>Mark as Cancelled</span>
            </button>
            `}
            <button class="booked-menu-item delete" data-action="delete">
              <span class="material-symbols-outlined">delete</span>
              <span>Delete</span>
            </button>
          </div>
        </div>
      </div>
      <div class="booked-flight-subheader">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="flight-direction-badge ${isReturn ? 'return' : 'outbound'}">${directionLabel}</span>
          ${isCancelled ? '<span class="flight-cancelled-badge">Cancelled</span>' : ''}
        </div>
        <div class="confirmation-code">
          <strong>${confirmationCode || 'N/A'}</strong>
          ${confirmationCode ? `
            <button class="copy-btn" title="Copy confirmation code">
              <span class="material-symbols-outlined">content_copy</span>
            </button>
          ` : ''}
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
          
          if (action === 'request-change') {
            openRequestChangeModal(flight);
          } else if (action === 'edit') {
            openEditBookedFlightModal(flight);
          } else if (action === 'cancel') {
            handleCancelBookedFlight(flight);
          } else if (action === 'restore') {
            handleUncancelBookedFlight(flight);
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

    // Clear eventId if user is typing (they haven't selected from autocomplete yet)
    if (elements.bookingEventName) {
      delete elements.bookingEventName.dataset.eventId;
    }

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
   * Handle event search in view request modal
   */
  async function handleViewEventSearch(e) {
    const value = e.target.value;

    // Clear eventId if user is typing (they haven't selected from autocomplete yet)
    if (elements.viewEventName) {
      delete elements.viewEventName.dataset.eventId;
    }

    if (value.length < 2) {
      elements.viewEventSuggestions?.classList.remove('show');
      return;
    }

    try {
      const events = await apiRequest(`/api/flights/events/search?q=${encodeURIComponent(value)}`);
      
      if (events.length === 0) {
        elements.viewEventSuggestions?.classList.remove('show');
        return;
      }

      elements.viewEventSuggestions.innerHTML = events.map(event => {
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

      elements.viewEventSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          elements.viewEventName.value = item.dataset.eventName;
          elements.viewEventName.dataset.eventId = item.dataset.eventId;
          elements.viewEventSuggestions.classList.remove('show');
        });
      });

      elements.viewEventSuggestions.classList.add('show');
    } catch (error) {
      console.error('View event search error:', error);
    }
  }

  /**
   * Handle event search in edit booked flight modal
   */
  async function handleEditBookedEventSearch(e) {
    const value = e.target.value;

    // Clear eventId if user is typing
    if (elements.editBookedEventName) {
      delete elements.editBookedEventName.dataset.eventId;
    }

    if (value.length < 2) {
      elements.editBookedEventSuggestions?.classList.remove('show');
      return;
    }

    try {
      const events = await apiRequest(`/api/flights/events/search?q=${encodeURIComponent(value)}`);
      
      if (events.length === 0) {
        elements.editBookedEventSuggestions?.classList.remove('show');
        return;
      }

      elements.editBookedEventSuggestions.innerHTML = events.map(event => {
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

      elements.editBookedEventSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          elements.editBookedEventName.value = item.dataset.eventName;
          elements.editBookedEventName.dataset.eventId = item.dataset.eventId;
          elements.editBookedEventSuggestions.classList.remove('show');
        });
      });

      elements.editBookedEventSuggestions.classList.add('show');
    } catch (error) {
      console.error('Edit booked event search error:', error);
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
      cost: parseFlightCost(document.getElementById('bookingCost')?.value),
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

    // Clear eventId if user is typing (they haven't selected from autocomplete yet)
    if (elements.eventName) {
      delete elements.eventName.dataset.eventId;
    }

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

    // Populate form fields — use populated eventId.title if available, fall back to eventName
    const eventTitle = request.eventId?.title || request.eventName || '';
    const eventIdValue = request.eventId?._id || request.eventId || '';
    elements.viewEventName.value = eventTitle;
    if (eventIdValue) {
      elements.viewEventName.dataset.eventId = eventIdValue;
    } else {
      delete elements.viewEventName.dataset.eventId;
    }
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

    // Handle change request vs regular pending request in modal
    const isChangeRequest = request.status === 'change_requested';
    const bookFlightBtn = document.getElementById('bookFlightBtn');
    const deleteBtn = document.getElementById('deleteRequestBtn');
    const modalFooterActions = elements.viewRequestModal?.querySelector('.modal-footer-actions');

    if (isChangeRequest) {
      // Update title for change requests
      if (modalTitle) {
        modalTitle.textContent = 'View Change Request';
      }

      // Show approve/reject instead of book/delete
      if (bookFlightBtn) bookFlightBtn.style.display = 'none';
      if (deleteBtn) deleteBtn.style.display = 'none';

      // Add change request info and approve/reject buttons if not already present
      let changeActionsEl = modalFooterActions?.querySelector('.change-request-modal-actions');
      if (!changeActionsEl && modalFooterActions) {
        changeActionsEl = document.createElement('div');
        changeActionsEl.className = 'change-request-modal-actions';
        changeActionsEl.innerHTML = `
          <button type="button" class="btn-approve-change" id="viewApproveChangeBtn">
            <span class="material-symbols-outlined">check_circle</span>
            Approve Change
          </button>
          <button type="button" class="btn-reject-change" id="viewRejectChangeBtn">
            <span class="material-symbols-outlined">cancel</span>
            Reject
          </button>
        `;
        modalFooterActions.appendChild(changeActionsEl);
      }
      if (changeActionsEl) changeActionsEl.style.display = 'flex';

      // Bind approve/reject handlers
      document.getElementById('viewApproveChangeBtn')?.addEventListener('click', () => handleApproveChangeRequest(request._id));
      document.getElementById('viewRejectChangeBtn')?.addEventListener('click', () => handleRejectChangeRequest(request._id));

      // Show change reason if present
      if (request.changeDetails?.changeReason) {
        const notesEl = document.getElementById('viewNotes');
        if (notesEl) {
          const reason = request.changeDetails.changeReason;
          notesEl.value = `[Change Reason] ${reason}${request.notes ? '\n\n' + request.notes : ''}`;
        }
      }
    } else {
      // Regular pending request
      if (bookFlightBtn) bookFlightBtn.style.display = 'flex';
      if (deleteBtn) deleteBtn.style.display = 'flex';
      // Hide change request actions if they exist from a previous view
      const changeActionsEl = modalFooterActions?.querySelector('.change-request-modal-actions');
      if (changeActionsEl) changeActionsEl.style.display = 'none';
    }

    // Hide booking section if visible
    hideBookingSection();
  }

  /**
   * Close view request modal
   */
  function closeViewModal() {
    elements.viewRequestModal?.classList.remove('show');
    currentEditingRequest = null;
    // Clear event name dataset
    if (elements.viewEventName) {
      delete elements.viewEventName.dataset.eventId;
    }
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
      eventId: elements.viewEventName.dataset.eventId || currentEditingRequest.eventId?._id || currentEditingRequest.eventId || null,
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
      const viewCostEl = document.getElementById('viewRequestBookingCost');
      if (viewCostEl) viewCostEl.value = '';

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
        body: JSON.stringify({
          bookedDetails,
          returnBookedDetails,
          cost: parseFlightCost(document.getElementById('viewRequestBookingCost')?.value)
        })
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

    const confirmed = confirm(`Are you sure you want to delete this flight request?\n\nEvent: ${getEventDisplayName(currentEditingRequest, 'Flight Request')}\n\nThis action cannot be undone.`);
    
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

    // Populate form fields — use populated eventId.title if available, fall back to eventName
    const editEventTitle = flight.eventId?.title || flight.eventName || '';
    const editEventIdValue = flight.eventId?._id || flight.eventId || '';
    document.getElementById('editBookedEventName').value = editEventTitle;
    if (editEventIdValue && elements.editBookedEventName) {
      elements.editBookedEventName.dataset.eventId = editEventIdValue;
    } else if (elements.editBookedEventName) {
      delete elements.editBookedEventName.dataset.eventId;
    }
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
    const editBookedCostEl = document.getElementById('editBookedCost');
    if (editBookedCostEl) {
      const costVal = parseFloat(flight.cost);
      editBookedCostEl.value = Number.isFinite(costVal) && costVal > 0 ? costVal.toFixed(2) : '';
    }

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
    // Clear event name dataset
    if (elements.editBookedEventName) {
      delete elements.editBookedEventName.dataset.eventId;
    }
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
      eventId: elements.editBookedEventName?.dataset.eventId || currentEditingRequest.eventId?._id || currentEditingRequest.eventId || null,
      departDate: document.getElementById('editBookedDepartDate').value,
      returnDate: isRoundtrip ? document.getElementById('editBookedReturnDate').value : null,
      from: fromAirport,
      to: toAirport,
      notes: document.getElementById('editBookedNotes')?.value?.trim() || '',
      cost: parseFlightCost(document.getElementById('editBookedCost')?.value),
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
   * Handle marking a booked flight as cancelled
   */
  async function handleCancelBookedFlight(flight) {
    const confirmed = confirm(`Are you sure you want to mark this flight as cancelled?\n\nEvent: ${getEventDisplayName(flight)}\nConfirmation: ${flight.bookedDetails?.confirmationCode || 'N/A'}`);

    if (!confirmed) return;

    try {
      const updated = await apiRequest(`/api/flights/${flight._id}/cancel`, {
        method: 'PATCH'
      });

      const idx = bookedFlights.findIndex(f => f._id === flight._id);
      if (idx !== -1) {
        bookedFlights[idx] = { ...bookedFlights[idx], status: 'cancelled' };
      }
      renderBookedFlights();

      console.log('✅ Booked flight cancelled:', flight._id);
    } catch (error) {
      console.error('Failed to cancel booked flight:', error);
      alert('Failed to cancel flight. Please try again.');
    }
  }

  async function handleUncancelBookedFlight(flight) {
    try {
      await apiRequest(`/api/flights/${flight._id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'booked' })
      });

      const idx = bookedFlights.findIndex(f => f._id === flight._id);
      if (idx !== -1) {
        bookedFlights[idx] = { ...bookedFlights[idx], status: 'booked' };
      }
      renderBookedFlights();

      console.log('✅ Booked flight restored:', flight._id);
    } catch (error) {
      console.error('Failed to restore flight:', error);
      alert('Failed to restore flight. Please try again.');
    }
  }

  /**
   * Handle delete booked flight
   */
  async function handleDeleteBookedFlight(flight) {
    const confirmed = confirm(`Are you sure you want to delete this booked flight?\n\nEvent: ${getEventDisplayName(flight)}\nConfirmation: ${flight.bookedDetails?.confirmationCode || 'N/A'}\n\nThis action cannot be undone.`);
    
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

  // ========================================
  // FLIGHT CHANGE REQUEST FUNCTIONS
  // ========================================

  /**
   * Open the Request Change modal for a booked flight
   */
  function openRequestChangeModal(flight) {
    currentChangeRequestFlight = flight;
    const modal = elements.requestChangeModal;
    if (!modal) return;

    modal.classList.add('show');

    // Populate current booking summary
    const bookedDetails = flight.bookedDetails || {};
    const returnBookedDetails = flight.returnBookedDetails || {};
    const departDate = formatDateDisplay(flight.departDate);
    const returnDate = flight.returnDate ? formatDateDisplay(flight.returnDate) : null;
    const isRoundtrip = flight.tripType === 'roundtrip';

    const summaryEl = elements.changeCurrentSummary;
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="change-summary-row">
          <div class="change-summary-route">
            <span class="change-summary-code">${flight.from?.code || 'TBD'}</span>
            <span class="material-symbols-outlined">arrow_forward</span>
            <span class="change-summary-code">${flight.to?.code || 'TBD'}</span>
          </div>
          ${getEventDisplayName(flight, '') ? `<span class="change-summary-event">${getEventDisplayName(flight, '')}</span>` : ''}
        </div>
        <div class="change-summary-details">
          <div class="change-summary-item">
            <span class="change-summary-label">Outbound</span>
            <span class="change-summary-value">${departDate}${bookedDetails.departTime ? ' at ' + formatTimeDisplay(bookedDetails.departTime) : ''}</span>
          </div>
          ${isRoundtrip && returnDate ? `
            <div class="change-summary-item">
              <span class="change-summary-label">Return</span>
              <span class="change-summary-value">${returnDate}${returnBookedDetails.departTime ? ' at ' + formatTimeDisplay(returnBookedDetails.departTime) : ''}</span>
            </div>
          ` : ''}
          <div class="change-summary-item">
            <span class="change-summary-label">Confirmation</span>
            <span class="change-summary-value">${bookedDetails.confirmationCode || 'N/A'}</span>
          </div>
          <div class="change-summary-item">
            <span class="change-summary-label">Passengers</span>
            <span class="change-summary-value">${(flight.passengers || []).map(p => p.name).join(', ') || 'None'}</span>
          </div>
        </div>
      `;
    }

    // Show/hide return-related checkboxes based on trip type
    const returnDateCb = document.getElementById('changeReturnDateCheckbox');
    const returnTimeCb = document.getElementById('changeReturnTimeCheckbox');
    if (returnDateCb) returnDateCb.closest('.change-checkbox-option').style.display = isRoundtrip ? 'flex' : 'none';
    if (returnTimeCb) returnTimeCb.closest('.change-checkbox-option').style.display = isRoundtrip ? 'flex' : 'none';

    // Reset form
    elements.requestChangeForm?.reset();
    document.querySelectorAll('.change-field-group').forEach(g => g.style.display = 'none');
    const allCheckboxes = document.querySelectorAll('input[name="changeField"]');
    allCheckboxes.forEach(cb => {
      cb.disabled = false;
      cb.closest('.change-checkbox-option').style.opacity = '1';
    });

    // Pre-fill dates with current values
    if (elements.changeDepartDate) elements.changeDepartDate.value = formatDateForInput(flight.departDate);
    if (elements.changeReturnDate && flight.returnDate) elements.changeReturnDate.value = formatDateForInput(flight.returnDate);
    if (elements.changeDepartTimePreference) elements.changeDepartTimePreference.value = flight.departTimePreference || 'any';
    if (elements.changeReturnTimePreference) elements.changeReturnTimePreference.value = flight.returnTimePreference || 'any';
  }

  /**
   * Close the Request Change modal
   */
  function closeRequestChangeModal() {
    currentChangeRequestFlight = null;
    elements.requestChangeModal?.classList.remove('show');
  }

  /**
   * Toggle visibility of change field inputs when checkboxes are checked
   */
  function handleChangeFieldToggle(e) {
    const field = e.target.value;

    if (field === 'cancelFlight') {
      const isCancel = e.target.checked;
      const otherCheckboxes = document.querySelectorAll('input[name="changeField"]:not([value="cancelFlight"])');
      otherCheckboxes.forEach(cb => {
        cb.checked = false;
        cb.disabled = isCancel;
        cb.closest('.change-checkbox-option').style.opacity = isCancel ? '0.4' : '1';
      });
      document.querySelectorAll('.change-field-group').forEach(g => g.style.display = 'none');
      return;
    }

    const cancelCb = document.getElementById('changeCancelFlightCheckbox');
    if (cancelCb?.checked) return;

    const groupMap = {
      'departDate': 'changeDepartDateGroup',
      'returnDate': 'changeReturnDateGroup',
      'departTime': 'changeDepartTimeGroup',
      'returnTime': 'changeReturnTimeGroup'
    };
    const groupId = groupMap[field];
    if (groupId) {
      document.getElementById(groupId).style.display = e.target.checked ? 'block' : 'none';
    }
  }

  /**
   * Submit a change request
   */
  async function handleSubmitChangeRequest(e) {
    e.preventDefault();
    if (!currentChangeRequestFlight) return;

    // Collect which fields are being changed
    const checkedFields = Array.from(document.querySelectorAll('input[name="changeField"]:checked')).map(cb => cb.value);
    if (checkedFields.length === 0) {
      alert('Please select at least one field to change.');
      return;
    }

    const requestedChanges = {};
    if (checkedFields.includes('cancelFlight')) {
      requestedChanges.cancelFlight = true;
    }
    if (checkedFields.includes('departDate')) {
      requestedChanges.departDate = elements.changeDepartDate?.value || null;
    }
    if (checkedFields.includes('returnDate')) {
      requestedChanges.returnDate = elements.changeReturnDate?.value || null;
    }
    if (checkedFields.includes('departTime')) {
      requestedChanges.departTimePreference = elements.changeDepartTimePreference?.value || null;
    }
    if (checkedFields.includes('returnTime')) {
      requestedChanges.returnTimePreference = elements.changeReturnTimePreference?.value || null;
    }

    const changeReason = elements.changeReason?.value?.trim() || '';

    try {
      const result = await apiRequest(`/api/flights/${currentChangeRequestFlight._id}/request-change`, {
        method: 'POST',
        body: JSON.stringify({ requestedChanges, changeReason })
      });

      // Add to local pending requests state
      flightRequests.push(result);
      renderPendingRequests();

      closeRequestChangeModal();
      console.log('✅ Change request submitted:', result._id);
    } catch (error) {
      console.error('Failed to submit change request:', error);
      alert('Failed to submit change request. Please try again.');
    }
  }

  /**
   * Approve a change request - opens modal to enter new booking details
   */
  function handleApproveChangeRequest(requestId) {
    const changeRequest = flightRequests.find(f => f._id === requestId);
    if (!changeRequest) return;

    currentApprovingChangeRequestId = requestId;

    // Find the original booked flight to show existing details
    const originalFlightId = changeRequest.changeDetails?.originalFlightId;
    const originalFlight = originalFlightId 
      ? bookedFlights.find(f => f._id === (originalFlightId._id || originalFlightId))
      : null;

    const existingBooked = originalFlight?.bookedDetails || {};
    const existingReturn = originalFlight?.returnBookedDetails || {};
    const isRoundtrip = changeRequest.tripType === 'roundtrip';

    // Build summary of what's changing
    const changes = changeRequest.changeDetails?.requestedChanges || {};
    const changedItems = [];
    if (changes.departDate) changedItems.push(`Outbound Date → ${formatDateDisplay(changeRequest.departDate)}`);
    if (changes.returnDate) changedItems.push(`Return Date → ${formatDateDisplay(changeRequest.returnDate)}`);
    if (changes.departTimePreference) changedItems.push(`Outbound Time Pref → ${formatTimePreference(changes.departTimePreference)}`);
    if (changes.returnTimePreference) changedItems.push(`Return Time Pref → ${formatTimePreference(changes.returnTimePreference)}`);

    const summaryEl = elements.approveChangeSummary;
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="approve-change-header">
          <div class="approve-route">
            <span class="approve-route-code">${changeRequest.from?.code || 'TBD'}</span>
            <span class="material-symbols-outlined">arrow_forward</span>
            <span class="approve-route-code">${changeRequest.to?.code || 'TBD'}</span>
          </div>
          <span class="approve-event">${getEventDisplayName(changeRequest)}</span>
        </div>
        <div class="approve-changes-list">
          <div class="approve-changes-label">
            <span class="material-symbols-outlined">edit_calendar</span>
            Changes being applied:
          </div>
          ${changedItems.map(item => `
            <div class="approve-change-item">
              <span class="material-symbols-outlined">arrow_right</span>
              <span>${item}</span>
            </div>
          `).join('')}
          ${changeRequest.changeDetails?.changeReason ? `
            <div class="approve-change-reason">
              <span class="material-symbols-outlined">comment</span>
              <span>${changeRequest.changeDetails.changeReason}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    // Pre-fill with existing booking details
    document.getElementById('approveConfirmationNumber').value = existingBooked.confirmationCode || '';
    document.getElementById('approveAirline').value = existingBooked.airline || '';
    document.getElementById('approveOutboundFlightNumber').value = existingBooked.flightNumber || '';
    document.getElementById('approveOutboundDepartTime').value = existingBooked.departTime || '';
    document.getElementById('approveOutboundArriveTime').value = existingBooked.arriveTime || '';

    // Show/hide return section
    if (elements.approveReturnFlightSection) {
      elements.approveReturnFlightSection.style.display = isRoundtrip ? 'block' : 'none';
    }
    if (isRoundtrip) {
      document.getElementById('approveReturnFlightNumber').value = existingReturn.flightNumber || '';
      document.getElementById('approveReturnDepartTime').value = existingReturn.departTime || '';
      document.getElementById('approveReturnArriveTime').value = existingReturn.arriveTime || '';
    }

    const approveCostEl = document.getElementById('approveChangeCost');
    if (approveCostEl) {
      const costVal = parseFloat(originalFlight?.cost);
      approveCostEl.value = Number.isFinite(costVal) && costVal > 0 ? costVal.toFixed(2) : '';
    }

    // Close the view modal if open, then open approve modal
    closeViewModal();
    elements.approveChangeModal?.classList.add('show');
  }

  /**
   * Close approve change modal
   */
  function closeApproveChangeModal() {
    currentApprovingChangeRequestId = null;
    elements.approveChangeModal?.classList.remove('show');
  }

  /**
   * Confirm the approval with new booking details
   */
  async function handleConfirmApproveChange(e) {
    e.preventDefault();
    if (!currentApprovingChangeRequestId) return;

    // Collect new booking details
    const updatedBookedDetails = {
      confirmationCode: document.getElementById('approveConfirmationNumber').value.trim(),
      airline: document.getElementById('approveAirline').value.trim(),
      flightNumber: document.getElementById('approveOutboundFlightNumber').value.trim(),
      departTime: document.getElementById('approveOutboundDepartTime').value,
      arriveTime: document.getElementById('approveOutboundArriveTime').value
    };

    const updatedReturnBookedDetails = {
      flightNumber: document.getElementById('approveReturnFlightNumber')?.value?.trim() || '',
      departTime: document.getElementById('approveReturnDepartTime')?.value || '',
      arriveTime: document.getElementById('approveReturnArriveTime')?.value || ''
    };

    try {
      const updatedFlight = await apiRequest(`/api/flights/${currentApprovingChangeRequestId}/approve-change`, {
        method: 'PATCH',
        body: JSON.stringify({
          updatedBookedDetails,
          updatedReturnBookedDetails,
          cost: parseFlightCost(document.getElementById('approveChangeCost')?.value)
        })
      });

      // Remove from pending
      flightRequests = flightRequests.filter(f => f._id !== currentApprovingChangeRequestId);

      // Update in booked
      const bookedIndex = bookedFlights.findIndex(f => f._id === updatedFlight._id);
      if (bookedIndex !== -1) {
        bookedFlights[bookedIndex] = updatedFlight;
      }

      renderPendingRequests();
      renderBookedFlights();
      closeApproveChangeModal();

      console.log('✅ Change request approved with new details:', currentApprovingChangeRequestId);
    } catch (error) {
      console.error('Failed to approve change request:', error);
      alert('Failed to approve change request. Please try again.');
    }
  }

  /**
   * Reject a change request
   */
  async function handleRejectChangeRequest(requestId) {
    if (!confirm('Reject this change request? It will be removed.')) return;

    try {
      await apiRequest(`/api/flights/${requestId}/reject-change`, {
        method: 'PATCH'
      });

      // Remove from pending
      flightRequests = flightRequests.filter(f => f._id !== requestId);
      renderPendingRequests();
      closeViewModal();

      console.log('✅ Change request rejected:', requestId);
    } catch (error) {
      console.error('Failed to reject change request:', error);
      alert('Failed to reject change request. Please try again.');
    }
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', init);

})();
