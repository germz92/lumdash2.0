(function() {
window.initPage = undefined;
    const token = localStorage.getItem('token');
    const params = new URLSearchParams(window.location.search);
    const tableId = params.get('id') || localStorage.getItem('eventId');

    // Add guard for missing ID
    if (!tableId) {
      console.warn('No table ID provided, redirecting to dashboard...');
      window.location.href = 'dashboard.html';
      return;
    }

    let isOwner = false;
    let travelEditMode = false;
    let accommodationEditMode = false;
    let cachedUsers = [];
    let showMineOnly = false;
    let currentUserName = '';

    function getUserIdFromToken() {
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.id;
    }

    async function preloadUsers() {
      const res = await fetch(`${API_BASE}/api/users`, {
        headers: { Authorization: token }
      });
      const users = await res.json();
      users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      cachedUsers = users;
    }

    function formatDateReadable(dateStr) {
      if (!dateStr) return '';
      const [year, month, day] = dateStr.split('-');
      return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
    }

    function formatTo12Hour(time) {
      if (!time) return '';
      const [hourStr, minuteStr] = time.split(':');
      let hour = parseInt(hourStr, 10);
      const minute = parseInt(minuteStr || '0', 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12 || 12;
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} ${ampm}`;
    }

    function autoResizeTextarea(el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }

    // Create custom dropdown component (matching crew page style)
    function createCustomDropdown(options, currentValue, placeholder, onSelect, onAddNew) {
      const container = document.createElement('div');
      container.className = 'custom-dropdown';
      
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'custom-dropdown-trigger';
      trigger.innerHTML = `
        <span class="dropdown-value ${!currentValue ? 'placeholder' : ''}">${currentValue || placeholder}</span>
        <span class="material-symbols-outlined dropdown-arrow">expand_more</span>
      `;
      
      const menu = document.createElement('div');
      menu.className = 'custom-dropdown-menu';
      
      // Search input for filtering
      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'custom-dropdown-search';
      searchWrapper.innerHTML = `<input type="text" placeholder="Search..." autocomplete="off">`;
      
      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'custom-dropdown-options';
      
      // Minimal inline styles to override global button styles - CSS handles the rest
      const optionStyle = 'height: auto !important; min-height: 0 !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important;';
      const addNewStyle = 'height: auto !important; min-height: 0 !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important;';
      
      // Render options
      function renderOptions(filter = '') {
        const filtered = options.filter(opt => 
          opt.toLowerCase().includes(filter.toLowerCase())
        );
        
        if (filtered.length === 0 && filter) {
          optionsContainer.innerHTML = `<div class="custom-dropdown-empty">No results found</div>`;
        } else {
          optionsContainer.innerHTML = filtered.map(opt => `
            <button type="button" class="custom-dropdown-option ${opt === currentValue ? 'selected' : ''}" data-value="${opt}" style="${optionStyle}">
              ${opt}
            </button>
          `).join('');
          
          // Add "Add new" option
          if (onAddNew) {
            optionsContainer.innerHTML += `
              <button type="button" class="custom-dropdown-option add-new" data-value="__add_new__" style="${addNewStyle}">
                <span class="material-symbols-outlined" style="font-size: 16px;">add</span>
                Add new...
              </button>
            `;
          }
        }
      }
      
      renderOptions();
      
      menu.appendChild(searchWrapper);
      menu.appendChild(optionsContainer);
      container.appendChild(trigger);
      container.appendChild(menu);
      
      // Event handlers
      let isOpen = false;
      
      function openDropdown() {
        isOpen = true;
        container.classList.add('open');
        
        // Position the menu using fixed positioning
        const triggerRect = trigger.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const menuHeight = Math.min(280, viewportHeight * 0.4);
        
        // Check if menu should open above or below
        const spaceBelow = viewportHeight - triggerRect.bottom - 10;
        const spaceAbove = triggerRect.top - 10;
        
        // Reset positioning
        menu.style.top = '';
        menu.style.bottom = '';
        
        if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
          // Open below - position top edge just below trigger
          menu.style.top = `${triggerRect.bottom + 2}px`;
          menu.style.maxHeight = `${Math.min(menuHeight, spaceBelow)}px`;
        } else {
          // Open above - use bottom positioning to anchor menu bottom to trigger top
          menu.style.bottom = `${viewportHeight - triggerRect.top + 2}px`;
          menu.style.maxHeight = `${Math.min(menuHeight, spaceAbove)}px`;
        }
        
        menu.style.left = `${triggerRect.left}px`;
        menu.style.width = `${Math.max(triggerRect.width, 180)}px`;
        
        const searchInput = searchWrapper.querySelector('input');
        searchInput.value = '';
        renderOptions();
        setTimeout(() => searchInput.focus(), 50);
      }
      
      function closeDropdown() {
        isOpen = false;
        container.classList.remove('open');
      }
      
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen) {
          closeDropdown();
        } else {
          openDropdown();
        }
      });
      
      // Search filtering
      const searchInput = searchWrapper.querySelector('input');
      searchInput.addEventListener('input', (e) => {
        renderOptions(e.target.value);
      });
      
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeDropdown();
        }
      });
      
      // Option selection
      optionsContainer.addEventListener('click', async (e) => {
        const option = e.target.closest('.custom-dropdown-option');
        if (!option) return;
        
        e.stopPropagation();
        const value = option.dataset.value;
        
        if (value === '__add_new__' && onAddNew) {
          closeDropdown();
          const newValue = await onAddNew();
          if (newValue) {
            trigger.querySelector('.dropdown-value').textContent = newValue;
            trigger.querySelector('.dropdown-value').classList.remove('placeholder');
            onSelect(newValue);
          }
        } else {
          trigger.querySelector('.dropdown-value').textContent = value;
          trigger.querySelector('.dropdown-value').classList.remove('placeholder');
          closeDropdown();
          onSelect(value);
        }
      });
      
      // Close on outside click
      function handleOutsideClick(e) {
        if (!container.contains(e.target)) {
          closeDropdown();
        }
      }
      
      document.addEventListener('click', handleOutsideClick);
      
      // Store reference to update options later
      container.updateOptions = (newOptions, newValue) => {
        options = newOptions;
        currentValue = newValue;
        renderOptions();
        if (newValue) {
          trigger.querySelector('.dropdown-value').textContent = newValue;
          trigger.querySelector('.dropdown-value').classList.remove('placeholder');
        }
      };
      
      container.getValue = () => {
        const valueEl = trigger.querySelector('.dropdown-value');
        return valueEl.classList.contains('placeholder') ? '' : valueEl.textContent;
      };
      
      return container;
    }

    // Function to create clickable location links (similar to general page)
    function createLocationLink(hotelValue) {
      if (!hotelValue || !hotelValue.trim()) {
        return '<span class="readonly-span"></span>';
      }
      
      const value = hotelValue.trim();
      
      // Enhanced location detection - check for hotel chains, common location words, or addresses
      const hotelChains = ['marriott', 'hilton', 'hyatt', 'sheraton', 'westin', 'radisson', 'intercontinental', 'doubletree', 'embassy', 'hampton', 'holiday inn', 'fairfield', 'residence inn', 'courtyard', 'springhill', 'homewood', 'ritz carlton', 'ritz-carlton', 'w hotel', 'le meridien', 'renaissance', 'aloft', 'four points', 'luxury collection'];
      const locationWords = ['hotel', 'resort', 'inn', 'suites', 'lodge', 'motel', 'hostel', 'bed & breakfast', 'b&b', 'guesthouse', 'villa', 'resort & spa', 'spa', 'center', 'centre', 'plaza', 'tower', 'towers', 'grand', 'royal', 'palace', 'castle'];
      const addressWords = ['street', 'st', 'ave', 'avenue', 'road', 'rd', 'blvd', 'boulevard', 'drive', 'dr', 'lane', 'ln', 'way', 'place', 'pl', 'court', 'ct', 'circle', 'cir', 'square', 'sq'];
      
      const valueLower = value.toLowerCase();
      
      // Check if it looks like a location
      const isHotelChain = hotelChains.some(chain => valueLower.includes(chain));
      const hasLocationWords = locationWords.some(word => valueLower.includes(word));
      const hasAddressWords = addressWords.some(word => valueLower.includes(word));
      const hasNumbers = /\d+/.test(value); // Contains numbers (common in addresses)
      const hasCommaOrAddress = value.includes(',') || /\b(city|state|zip|postal)\b/i.test(value);
      
      // Consider it a location if it matches any of these criteria
      const looksLikeLocation = isHotelChain || hasLocationWords || hasAddressWords || (hasNumbers && hasCommaOrAddress);
      
      if (looksLikeLocation) {
        // Use iOS-friendly maps URL format
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        let href;
        if (isIOS) {
          // Apple Maps format (iOS)
          href = `maps://?q=${encodeURIComponent(value)}`;
        } else {
          // Google Maps format (Android, desktop)
          href = `https://www.google.com/maps/search/?q=${encodeURIComponent(value)}`;
        }
        
        return `<span class="readonly-span"><a href="${href}" target="_blank" title="Open in Maps: ${value}"><span class="material-symbols-outlined" style="font-size: 14px; vertical-align: text-bottom; margin-right: 4px;">place</span>${value}</a></span>`;
      } else {
        // Not a location, just display as text
        return `<span class="readonly-span">${value}</span>`;
      }
    }

    // Airline URL mapping for major airlines
    const airlineUrls = {
      'United': (ref, last) => `https://www.united.com/en/us/checkin/confirmation?confirmationNumber=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`,
      'Delta': (ref, last) => `https://www.delta.com/mytrips/validatePNR?confirmationNumber=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`,
      'American': (ref, last) => `https://www.aa.com/guest/viewreservation/findReservation?recordLocator=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`,
      'Southwest': (ref, first, last) => `https://www.southwest.com/air/manage-reservation/index.html?confirmationNumber=${encodeURIComponent(ref)}&firstName=${encodeURIComponent(first)}&lastName=${encodeURIComponent(last)}`,
      'Alaska': (ref, last) => `https://www.alaskaair.com/booking/reservation-lookup?confirmationCode=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`,
      'JetBlue': (ref, last) => `https://www.jetblue.com/at-the-airport/check-in?confirmationCode=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`,
      'Air Canada': (ref, last) => `https://www.aircanada.com/ca/en/aco/home/book/manage-bookings.html#/find?bookingReference=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`,
      'British Airways': (ref, last) => `https://www.britishairways.com/travel/yourbooking/public/en_us?bookingReference=${encodeURIComponent(ref)}&lastName=${encodeURIComponent(last)}`
    };

    function openAirlineSite(airline, ref, name) {
      if (!airline || !ref || !name) {
        alert('Missing airline, reference, or name.');
        return;
      }
      // Try to match airline name loosely
      const key = Object.keys(airlineUrls).find(k => airline.toLowerCase().includes(k.toLowerCase()));
      if (key) {
        let firstName = name.trim().split(' ')[0];
        let lastName = name.trim().split(' ').slice(-1)[0];
        if (key === 'Southwest') {
          window.open(airlineUrls[key](ref, firstName, lastName), '_blank');
        } else {
          window.open(airlineUrls[key](ref, lastName), '_blank');
        }
      } else {
        alert('This airline is not supported for automatic lookup.');
      }
    }

    function updateTableHeaders(tableId) {
      if (tableId === 'travelTable') {
      // Update travel table header
      const travelHeader = document.querySelector('#travelTable thead tr');
      if (travelHeader) {
          if (travelEditMode) {
          travelHeader.innerHTML = `
            <th class="date">Date</th>
            <th class="time">Depart</th>
            <th class="time">Arrive</th>
            <th class="text name-column">Name</th>
            <th class="text">Airline</th>
            <th class="text">From/To</th>
            <th class="text">Ref Number</th>
            <th class="action"></th>
          `;
        } else {
          travelHeader.innerHTML = `
            <th class="date">Date</th>
            <th class="time">Depart</th>
            <th class="time">Arrive</th>
            <th class="text name-column">Name</th>
            <th class="text">Airline</th>
            <th class="text">From/To</th>
            <th class="text">Ref Number</th>
          `;
        }
      }
      } else if (tableId === 'accommodationTable') {
      // Update accommodation table header
      const accommodationHeader = document.querySelector('#accommodationTable thead tr');
      if (accommodationHeader) {
          if (accommodationEditMode) {
          accommodationHeader.innerHTML = `
            <th class="date">Check-In</th>
            <th class="date">Check-Out</th>
            <th class="text name-column">Name</th>
            <th class="text hotel-column">Hotel</th>
            <th class="text">Ref Number</th>
            <th class="action"></th>
          `;
        } else {
          accommodationHeader.innerHTML = `
            <th class="date">Check-In</th>
            <th class="date">Check-Out</th>
            <th class="text name-column">Name</th>
            <th class="text hotel-column">Hotel</th>
            <th class="text">Ref Number</th>
          `;
          }
        }
      }
    }

    function populateTable(tableId, rows) {
      const isEditMode = tableId === 'travelTable' ? travelEditMode : accommodationEditMode;
      console.log('populateTable called for', tableId, 'with editMode:', isEditMode);
      const table = document.getElementById(tableId)?.querySelector("tbody");
      if (!table) return;
      table.innerHTML = '';

      // Update table headers based on edit mode
      updateTableHeaders(tableId);
      
      // Get search query
      const searchQuery = document.getElementById('searchInput')?.value.toLowerCase() || '';
      
      // Filter rows based on search query
      if (searchQuery) {
        rows = rows.filter(item => {
          const searchableText = tableId === 'travelTable' 
            ? [item.date, item.depart, item.arrive, item.name, item.airline, item.fromTo, item.ref].join(' ').toLowerCase()
            : [item.checkin, item.checkout, item.name, item.hotel, item.ref].join(' ').toLowerCase();
          return searchableText.includes(searchQuery);
        });
      }
      
      // Filter by current user if "Show Mine" is active
      if (showMineOnly && currentUserName) {
        rows = rows.filter(item => {
          const itemName = (item.name || '').toLowerCase();
          return itemName.includes(currentUserName.toLowerCase());
        });
      }

      // Show/hide empty state
      const emptyStateId = tableId === 'travelTable' ? 'travelEmptyState' : 'accommodationEmptyState';
      const emptyState = document.getElementById(emptyStateId);
      const tableWrapper = document.querySelector(`#${tableId}`).closest('.table-wrapper-dark');
      
      if (rows.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        if (tableWrapper) tableWrapper.style.display = 'none';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        if (tableWrapper) tableWrapper.style.display = 'block';
      }

      rows.forEach(item => {
        const row = document.createElement("tr");

        // Check if this is a flight management entry (read-only)
        const isFromFlightManagement = item._fromFlightManagement === true;
        if (isFromFlightManagement) {
          row.classList.add('flight-management-row');
        }

        // Flight management entries are always read-only
        if (!isEditMode || isFromFlightManagement) {
          console.log('Showing readonly view', isFromFlightManagement ? '(from Flight Management)' : '');
          if (tableId === 'travelTable') {
            // Add flight icon indicator for flight management entries
            const flightIcon = isFromFlightManagement 
              ? '<span class="material-symbols-outlined flight-mgmt-icon" title="From Flight Management">airplane_ticket</span>' 
              : '';
            row.innerHTML = `
              <td class="date"><span class="readonly-span">${formatDateReadable(item.date)}</span></td>
              <td class="time"><span class="readonly-span">${formatTo12Hour(item.depart)}</span></td>
              <td class="time"><span class="readonly-span">${formatTo12Hour(item.arrive)}</span></td>
              <td class="text"><span class="readonly-span">${flightIcon}${item.name || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.airline || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.fromTo || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.ref || ''}</span></td>
              ${isEditMode ? '<td class="action"></td>' : ''}
            `;
          } else {
            row.innerHTML = `
              <td class="date"><span class="readonly-span">${formatDateReadable(item.checkin)}</span></td>
              <td class="date"><span class="readonly-span">${formatDateReadable(item.checkout)}</span></td>
              <td class="text"><span class="readonly-span">${item.name || ''}</span></td>
              <td class="text">${createLocationLink(item.hotel)}</td>
              <td class="text"><span class="readonly-span">${item.ref || ''}</span></td>
            `;
          }
        } else {
          console.log('In edit mode, showing editable view with delete button');
          if (tableId === 'travelTable') {
            row.innerHTML = `
              <td class="date"><input type="date" value="${item.date || ''}"></td>
              <td class="time"><input type="time" value="${item.depart || ''}"></td>
              <td class="time"><input type="time" value="${item.arrive || ''}"></td>
              <td class="text name-cell"></td>
              <td class="text"><textarea>${item.airline || ''}</textarea></td>
              <td class="text"><textarea>${item.fromTo || ''}</textarea></td>
              <td class="text"><textarea>${item.ref || ''}</textarea></td>
              <td class="action"><button type="button" class="delete-btn"><span class="material-symbols-outlined">delete</span></button></td>
            `;
          } else {
            row.innerHTML = `
              <td class="date"><input type="date" value="${item.checkin || ''}"></td>
              <td class="date"><input type="date" value="${item.checkout || ''}"></td>
              <td class="text name-cell"></td>
              <td class="text"><textarea>${item.hotel || ''}</textarea></td>
              <td class="text"><textarea>${item.ref || ''}</textarea></td>
              <td class="action"><button type="button" class="delete-btn"><span class="material-symbols-outlined">delete</span></button></td>
            `;
          }
          
          // Create and append custom name dropdown
          const nameCell = row.querySelector('.name-cell');
          if (nameCell) {
            const userNames = cachedUsers.map(u => u.name);
            const dropdown = createCustomDropdown(
              userNames,
              item.name || '',
              'Select Name',
              (value) => {
                // Value is automatically set in the dropdown
                console.log('Name selected:', value);
              },
              async () => {
                // Add new name handler
                const newName = prompt('Enter new name:');
                if (newName && !cachedUsers.some(u => u.name === newName)) {
                  cachedUsers.push({ name: newName });
                  cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
                  return newName;
                }
                return null;
              }
            );
            nameCell.appendChild(dropdown);
          }
        }

        table.appendChild(row);
      });

      table.querySelectorAll('textarea').forEach(autoResizeTextarea);
    }

    function collectTableData(tableId) {
      const table = document.getElementById(tableId)?.querySelectorAll("tbody tr");
      if (!table) return [];
      return Array.from(table)
        // Skip flight management rows - they are read-only and managed separately
        .filter(row => !row.classList.contains('flight-management-row'))
        .map(row => {
        // Get all inputs/textareas, but exclude the dropdown search input
        const allInputs = row.querySelectorAll('input, textarea');
        const inputs = Array.from(allInputs).filter(input => 
          !input.closest('.custom-dropdown-search')
        );
        
        // Get name from custom dropdown
        const nameDropdown = row.querySelector('.custom-dropdown');
        const nameValue = nameDropdown ? nameDropdown.getValue() : '';
        
        return tableId === 'travelTable' ? {
          date: inputs[0]?.value || '',
          depart: inputs[1]?.value || '',
          arrive: inputs[2]?.value || '',
          name: nameValue,
          airline: inputs[3]?.value || '',
          fromTo: inputs[4]?.value || '',
          ref: inputs[5]?.value || ''
        } : {
          checkin: inputs[0]?.value || '',
          checkout: inputs[1]?.value || '',
          name: nameValue,
          hotel: inputs[2]?.value || '',
          ref: inputs[3]?.value || ''
        };
      });
    }

    function addRow(tableId) {
      const isEditMode = tableId === 'travelTable' ? travelEditMode : accommodationEditMode;
      console.log('addRow called for', tableId, 'editMode:', isEditMode);
      // Don't allow adding rows if not in edit mode or not an owner
      if (!isEditMode || !isOwner) {
        console.log('Cannot add row: editMode is', isEditMode, 'isOwner is', isOwner);
        return;
      }
      const table = document.getElementById(tableId)?.querySelector("tbody");
      console.log('table element:', table);
      if (!table) {
        console.log('No table/tbody found for', tableId);
        return;
      }
      
      // Show the table wrapper if it was hidden
      const tableWrapper = document.querySelector(`#${tableId}`).closest('.table-wrapper-dark');
      const emptyStateId = tableId === 'travelTable' ? 'travelEmptyState' : 'accommodationEmptyState';
      const emptyState = document.getElementById(emptyStateId);
      if (tableWrapper) tableWrapper.style.display = 'block';
      if (emptyState) emptyState.style.display = 'none';
      
      const row = document.createElement("tr");

      row.innerHTML = tableId === 'travelTable'
        ? `
          <td class="date"><input type="date"></td>
          <td class="time"><input type="time"></td>
          <td class="time"><input type="time"></td>
          <td class="text name-cell"></td>
          <td class="text"><textarea></textarea></td>
          <td class="text"><textarea></textarea></td>
          <td class="text"><textarea></textarea></td>
          <td class="action"><button class="delete-btn" onclick="window.removeRow(this)"><span class="material-symbols-outlined">delete</span></button></td>
        `
        : `
          <td class="date"><input type="date"></td>
          <td class="date"><input type="date"></td>
          <td class="text name-cell"></td>
          <td class="text"><textarea></textarea></td>
          <td class="text"><textarea></textarea></td>
          <td class="action"><button class="delete-btn" onclick="window.removeRow(this)"><span class="material-symbols-outlined">delete</span></button></td>
        `;

      table.appendChild(row);
      row.querySelectorAll('textarea').forEach(autoResizeTextarea);
      
      // Create and append custom name dropdown
      const nameCell = row.querySelector('.name-cell');
      if (nameCell) {
        const userNames = cachedUsers.map(u => u.name);
        const dropdown = createCustomDropdown(
          userNames,
          '',
          'Select Name',
          (value) => {
            console.log('Name selected:', value);
          },
          async () => {
            // Add new name handler
            const newName = prompt('Enter new name:');
            if (newName && !cachedUsers.some(u => u.name === newName)) {
              cachedUsers.push({ name: newName });
              cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
              return newName;
            }
            return null;
          }
        );
        nameCell.appendChild(dropdown);
      }
      
      console.log('Row appended to', tableId);
    }

    function removeRow(button) {
      console.log('removeRow called', button);
      const row = button.closest('tr');
      console.log('row to remove:', row);
      if (row) {
      row.remove();
        console.log('row removed');
      }
    }

    let travelData = [];
    let accommodationData = [];
    let flightManagementData = []; // Booked flights from Flight Management

    /**
     * Transform a booked flight from Flight Management to travel table format
     * Creates one row per passenger for the outbound flight
     */
    function transformFlightToTravelRow(flight, passenger, isReturn = false) {
      const mainBookedDetails = flight.bookedDetails || {};
      const returnBookedDetails = flight.returnBookedDetails || {};
      const flightDetails = isReturn ? returnBookedDetails : mainBookedDetails;
      const fromCode = isReturn ? (flight.to?.code || '') : (flight.from?.code || '');
      const toCode = isReturn ? (flight.from?.code || '') : (flight.to?.code || '');
      const date = isReturn ? flight.returnDate : flight.departDate;
      
      // Airline and confirmation are shared across both legs (stored in main bookedDetails)
      const airline = mainBookedDetails.airline || '';
      const confirmationCode = mainBookedDetails.confirmationCode || '';
      
      return {
        date: date ? date.split('T')[0] : '',
        depart: flightDetails.departTime || '',
        arrive: flightDetails.arriveTime || '',
        name: passenger.name || '',
        airline: airline,
        fromTo: `${fromCode} → ${toCode}`,
        ref: confirmationCode,
        _fromFlightManagement: true, // Flag to identify flight management entries
        _flightId: flight._id,
        _isReturn: isReturn
      };
    }

    /**
     * Fetch booked flights for this event from Flight Management
     */
    async function loadFlightManagementData(eventName) {
      if (!eventName) return [];
      
      try {
        const res = await fetch(`${API_BASE}/api/flights/booked?eventName=${encodeURIComponent(eventName)}`, {
          headers: { Authorization: token }
        });
        
        if (!res.ok) {
          console.log('No flight management data available for this event');
          return [];
        }
        
        const flights = await res.json();
        const rows = [];
        
        // Transform each flight into travel rows (one per passenger, separate for outbound/return)
        flights.forEach(flight => {
          const passengers = flight.passengers || [];
          
          // Outbound flight rows
          passengers.forEach(passenger => {
            rows.push(transformFlightToTravelRow(flight, passenger, false));
          });
          
          // Return flight rows (for roundtrip)
          if (flight.tripType === 'roundtrip' && flight.returnBookedDetails) {
            passengers.forEach(passenger => {
              rows.push(transformFlightToTravelRow(flight, passenger, true));
            });
          }
        });
        
        return rows;
      } catch (error) {
        console.log('Could not load flight management data:', error);
        return [];
      }
    }

    async function loadData() {
      console.log('Fetching table data for tableId:', tableId);
      
      // Load users if not already loaded
      if (!cachedUsers.length) await preloadUsers();
      
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/travel`, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      
      // Store manual travel data globally for filtering
      travelData = data.travel || [];
      accommodationData = data.accommodation || [];
      
      // Also fetch booked flights from Flight Management for this event
      const eventTitle = document.getElementById('eventTitle')?.textContent || '';
      if (eventTitle && eventTitle !== 'Loading Event...') {
        flightManagementData = await loadFlightManagementData(eventTitle);
        console.log('Loaded flight management data:', flightManagementData.length, 'rows');
      }
      
      // Combine manual travel data with flight management data
      // Sort by date ascending (oldest first)
      const combinedTravelData = [...flightManagementData, ...travelData].sort((a, b) => {
        const dateA = a.date || '9999-99-99'; // Empty dates go to end
        const dateB = b.date || '9999-99-99';
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        return 0;
      });
      
      populateTable('travelTable', combinedTravelData);
      populateTable('accommodationTable', accommodationData);
    }
    
    function filterTables() {
      // Combine manual travel data with flight management data
      // Sort by date ascending (oldest first)
      const combinedTravelData = [...flightManagementData, ...travelData].sort((a, b) => {
        const dateA = a.date || '9999-99-99';
        const dateB = b.date || '9999-99-99';
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        return 0;
      });
      populateTable('travelTable', combinedTravelData);
      populateTable('accommodationTable', accommodationData);
    }

    async function saveTravelData() {
      // Show saving status
      const saveStatus = document.getElementById('saveStatus');
      if (saveStatus) {
        saveStatus.textContent = 'Saving...';
        saveStatus.classList.add('saving');
      }
      
      const travelRows = collectTableData('travelTable');
      // Keep existing accommodation data
      await fetch(`${API_BASE}/api/tables/${tableId}/travel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ travel: travelRows, accommodation: accommodationData })
      });
      travelEditMode = false;
      
      // Update UI
      const editTravelBtn = document.getElementById('editTravelBtn');
      const saveTravelBtn = document.getElementById('saveTravelBtn');
      const addTravelBtn = document.getElementById('addTravelBtn');
      if (editTravelBtn) editTravelBtn.style.display = 'flex';
      if (saveTravelBtn) saveTravelBtn.style.display = 'none';
      if (addTravelBtn) addTravelBtn.style.display = 'none';
      
      // Update save status
      if (saveStatus) {
        saveStatus.textContent = 'All changes saved';
        saveStatus.classList.remove('saving');
      }
      
      await loadData();
    }

    async function saveAccommodationData() {
      // Show saving status
      const saveStatus = document.getElementById('saveStatus');
      if (saveStatus) {
        saveStatus.textContent = 'Saving...';
        saveStatus.classList.add('saving');
      }
      
      const accommodationRows = collectTableData('accommodationTable');
      // Keep existing travel data
      await fetch(`${API_BASE}/api/tables/${tableId}/travel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ travel: travelData, accommodation: accommodationRows })
      });
      accommodationEditMode = false;
      
      // Update UI
      const editAccommodationBtn = document.getElementById('editAccommodationBtn');
      const saveAccommodationBtn = document.getElementById('saveAccommodationBtn');
      const addAccommodationBtn = document.getElementById('addAccommodationBtn');
      if (editAccommodationBtn) editAccommodationBtn.style.display = 'flex';
      if (saveAccommodationBtn) saveAccommodationBtn.style.display = 'none';
      if (addAccommodationBtn) addAccommodationBtn.style.display = 'none';
      
      // Update save status
      if (saveStatus) {
        saveStatus.textContent = 'All changes saved';
        saveStatus.classList.remove('saving');
      }
      
      await loadData();
    }

    function enterTravelEditMode() {
      console.log('enterTravelEditMode called', { isOwner, travelEditMode });
      if (!isOwner) return;
      travelEditMode = true;
      console.log('Travel edit mode set to:', travelEditMode);
      
      const editTravelBtn = document.getElementById('editTravelBtn');
      const saveTravelBtn = document.getElementById('saveTravelBtn');
      const addTravelBtn = document.getElementById('addTravelBtn');
      if (editTravelBtn) editTravelBtn.style.display = 'none';
      if (saveTravelBtn) saveTravelBtn.style.display = 'flex';
      if (addTravelBtn) addTravelBtn.style.display = 'flex';
      
      // Combine manual travel data with flight management data
      // Sort by date ascending (oldest first)
      const combinedTravelData = [...flightManagementData, ...travelData].sort((a, b) => {
        const dateA = a.date || '9999-99-99';
        const dateB = b.date || '9999-99-99';
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        return 0;
      });
      populateTable('travelTable', combinedTravelData);
    }

    function enterAccommodationEditMode() {
      console.log('enterAccommodationEditMode called', { isOwner, accommodationEditMode });
      if (!isOwner) return;
      accommodationEditMode = true;
      console.log('Accommodation edit mode set to:', accommodationEditMode);
      
      const editAccommodationBtn = document.getElementById('editAccommodationBtn');
      const saveAccommodationBtn = document.getElementById('saveAccommodationBtn');
      const addAccommodationBtn = document.getElementById('addAccommodationBtn');
      if (editAccommodationBtn) editAccommodationBtn.style.display = 'none';
      if (saveAccommodationBtn) saveAccommodationBtn.style.display = 'flex';
      if (addAccommodationBtn) addAccommodationBtn.style.display = 'flex';
      
      populateTable('accommodationTable', accommodationData);
    }

    // Expose functions on window
    window.addRow = addRow;
    window.removeRow = removeRow;
    window.saveTravelData = saveTravelData;
    window.saveAccommodationData = saveAccommodationData;
    window.enterTravelEditMode = enterTravelEditMode;
    window.enterAccommodationEditMode = enterAccommodationEditMode;
    window.filterTables = filterTables;

    // Add click handler for delete buttons
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.classList.contains('delete-btn') || e.target.closest('.delete-btn'))) {
        console.log('Delete button clicked');
        const btn = e.target.classList.contains('delete-btn') ? e.target : e.target.closest('.delete-btn');
        window.removeRow(btn);
      }
    });

    // Load sidebar user info
    function loadSidebarUser() {
      const userNameEl = document.getElementById('sidebarUserName');
      const avatarImg = document.getElementById('sidebarAvatarImg');
      const avatarIcon = document.getElementById('sidebarAvatarIcon');
      
      const userName = localStorage.getItem('fullName') || localStorage.getItem('userName') || 'User';
      if (userNameEl) userNameEl.textContent = userName;
      
      // Try to fetch user photo
      const userId = getUserIdFromToken();
      if (userId) {
        fetch(`${API_BASE}/api/users/${userId}`, {
          headers: { Authorization: token }
        })
          .then(res => {
            if (res.ok) return res.json();
            throw new Error('User not found');
          })
          .then(user => {
            if (user.profilePhoto) {
              if (avatarImg) {
                avatarImg.src = user.profilePhoto;
                avatarImg.style.display = 'block';
              }
              if (avatarIcon) avatarIcon.style.display = 'none';
            }
          })
          .catch(err => {
            console.log('Could not load user photo:', err);
          });
      }
    }

    // Setup sidebar navigation
    function setupSidebarNav() {
      const sidebar = document.getElementById('travelSidebar');
      const overlay = document.getElementById('travelSidebarOverlay');
      const mobileMenuBtn = document.getElementById('mobileMenuBtn');

      if (mobileMenuBtn) {
        mobileMenuBtn.onclick = function() {
          if (sidebar) sidebar.classList.add('open');
          if (overlay) overlay.classList.add('visible');
          document.body.style.overflow = 'hidden';
        };
      }

      if (overlay) {
        overlay.onclick = function() {
          if (sidebar) sidebar.classList.remove('open');
          overlay.classList.remove('visible');
          document.body.style.overflow = '';
        };
      }

      // Close sidebar when clicking nav items on mobile
      const navItems = sidebar?.querySelectorAll('.nav-item');
      navItems?.forEach(item => {
        item.addEventListener('click', function() {
          if (window.innerWidth <= 1024) {
            if (sidebar) sidebar.classList.remove('open');
            if (overlay) overlay.classList.remove('visible');
            document.body.style.overflow = '';
          }
        });
      });
    }

    window.initPage = async function(id) {
      console.log('initPage called with id:', id);
      const tableIdToUse = id || tableId;
      
      // Setup search input listener
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.addEventListener('input', filterTables);
      }
      
      // Setup sidebar
      loadSidebarUser();
      setupSidebarNav();
      
      // Setup add row buttons
      const addTravelBtn = document.getElementById('addTravelBtn');
      const addAccommodationBtn = document.getElementById('addAccommodationBtn');
      
      if (addTravelBtn) {
        addTravelBtn.onclick = () => addRow('travelTable');
      }
      if (addAccommodationBtn) {
        addAccommodationBtn.onclick = () => addRow('accommodationTable');
      }
      
      // Setup travel edit/save buttons
      const editTravelBtn = document.getElementById('editTravelBtn');
      const saveTravelBtn = document.getElementById('saveTravelBtn');
      
      if (editTravelBtn) {
        editTravelBtn.onclick = enterTravelEditMode;
      }
      if (saveTravelBtn) {
        saveTravelBtn.onclick = saveTravelData;
      }
      
      // Setup accommodation edit/save buttons
      const editAccommodationBtn = document.getElementById('editAccommodationBtn');
      const saveAccommodationBtn = document.getElementById('saveAccommodationBtn');
      
      if (editAccommodationBtn) {
        editAccommodationBtn.onclick = enterAccommodationEditMode;
      }
      if (saveAccommodationBtn) {
        saveAccommodationBtn.onclick = saveAccommodationData;
      }
      
      // Get current user name for "Show Mine" filter
      currentUserName = localStorage.getItem('fullName') || localStorage.getItem('userName') || '';
      
      // Setup Show All / Show Mine filter buttons
      const showAllBtn = document.getElementById('showAllBtn');
      const showMineBtn = document.getElementById('showMineBtn');
      
      if (showAllBtn) {
        showAllBtn.onclick = () => {
          showMineOnly = false;
          showAllBtn.classList.add('active');
          if (showMineBtn) showMineBtn.classList.remove('active');
          filterTables();
        };
      }
      
      if (showMineBtn) {
        showMineBtn.onclick = () => {
          showMineOnly = true;
          showMineBtn.classList.add('active');
          if (showAllBtn) showAllBtn.classList.remove('active');
          filterTables();
        };
      }
      
      try {
        const res = await fetch(`${API_BASE}/api/tables/${tableIdToUse}`, {
        headers: { Authorization: token }
      });

        if (!res.ok) {
          throw new Error(`Failed to load table: ${res.status}`);
        }

        const table = await res.json();
        const eventTitleEl = document.getElementById('eventTitle');
        if (eventTitleEl) eventTitleEl.textContent = table.title;
        
        const userId = getUserIdFromToken();
        isOwner = Array.isArray(table.owners) && table.owners.map(String).includes(String(userId));
        console.log('isOwner set to:', isOwner, 'userId:', userId, 'table.owners:', table.owners);
        
        // Hide edit buttons for non-owners
        if (!isOwner) {
          if (editTravelBtn) editTravelBtn.style.display = 'none';
          if (editAccommodationBtn) editAccommodationBtn.style.display = 'none';
        }
        
        await loadData();
      } catch (error) {
        console.error('Error initializing travel page:', error);
      }

      if (window.lucide) lucide.createIcons();
    };

    // Add Socket.IO real-time updates
    if (window.socket) {
      // Listen for travel updates
      window.socket.on('travelChanged', (data) => {
        console.log('Travel/accommodation data changed, checking if relevant...');
        // Only reload if it's for the current table
        if (data && data.tableId && data.tableId !== tableId) {
          console.log('Update was for a different table, ignoring');
          return;
        }
        console.log('Reloading travel/accommodation data for current table');
        loadData();
      });
      
      // Also listen for general table updates
      window.socket.on('tableUpdated', (data) => {
        console.log('Table updated, checking if relevant...');
        // Only reload if it's for the current table
        if (data && data.tableId && data.tableId !== tableId) {
          console.log('Update was for a different table, ignoring');
          return;
        }
        console.log('Reloading travel data for current table');
        loadData();
      });
    }
})();
