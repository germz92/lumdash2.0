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
    let editMode = false;
    let cachedUsers = [];

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

    function updateTableHeaders() {
      // Update travel table header
      const travelHeader = document.querySelector('#travelTable thead tr');
      if (travelHeader) {
        if (editMode) {
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

      // Update accommodation table header
      const accommodationHeader = document.querySelector('#accommodationTable thead tr');
      if (accommodationHeader) {
        if (editMode) {
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

    // Helper to get flight type badge HTML
    function getFlightTypeBadge(item) {
      if (!item.flightType || item.source !== 'booked') return '';
      if (item.flightType === 'outbound') {
        return '<span class="flight-type-badge outbound">OUT</span>';
      } else if (item.flightType === 'return') {
        return '<span class="flight-type-badge return">RET</span>';
      }
      return '';
    }

    // Helper to get source badge HTML
    function getSourceBadge(item) {
      if (item.source === 'booked') {
        return '<span class="source-badge booked">Booked</span>';
      }
      return '';
    }

    function populateTable(tableId, rows) {
      console.log('populateTable called with editMode:', editMode);
      const table = document.getElementById(tableId)?.querySelector("tbody");
      if (!table) return;
      table.innerHTML = '';

      // Update table headers based on edit mode
      updateTableHeaders();
      
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

      rows.forEach(item => {
        const row = document.createElement("tr");
        const isBooked = item.source === 'booked';

        if (!editMode) {
          if (tableId === 'travelTable') {
            const flightBadge = getFlightTypeBadge(item);
            const sourceBadge = getSourceBadge(item);
            row.innerHTML = `
              <td class="date"><span class="readonly-span">${formatDateReadable(item.date)}</span></td>
              <td class="time"><span class="readonly-span">${formatTo12Hour(item.depart)}</span></td>
              <td class="time"><span class="readonly-span">${formatTo12Hour(item.arrive)}</span></td>
              <td class="text"><span class="readonly-span">${item.name || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.airline || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.fromTo || ''}${flightBadge ? ' ' + flightBadge : ''}</span></td>
              <td class="text"><span class="readonly-span">${item.ref || ''}${sourceBadge ? ' ' + sourceBadge : ''}</span></td>
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
          // In edit mode: booked flights are read-only, manual flights are editable
          if (tableId === 'travelTable') {
            if (isBooked) {
              // Booked flights: read-only even in edit mode (can't edit booking system entries)
              const flightBadge = getFlightTypeBadge(item);
              row.classList.add('booked-row');
              row.innerHTML = `
                <td class="date"><span class="readonly-span">${formatDateReadable(item.date)}</span></td>
                <td class="time"><span class="readonly-span">${formatTo12Hour(item.depart)}</span></td>
                <td class="time"><span class="readonly-span">${formatTo12Hour(item.arrive)}</span></td>
                <td class="text"><span class="readonly-span">${item.name || ''}</span></td>
                <td class="text"><span class="readonly-span">${item.airline || ''}</span></td>
                <td class="text"><span class="readonly-span">${item.fromTo || ''}${flightBadge ? ' ' + flightBadge : ''}</span></td>
                <td class="text"><span class="readonly-span">${item.ref || ''} <span class="source-badge booked">Booked</span></span></td>
                <td class="action"></td>
              `;
            } else {
              row.innerHTML = `
                <td class="date"><input type="date" value="${item.date || ''}"></td>
                <td class="time"><input type="time" value="${item.depart || ''}"></td>
                <td class="time"><input type="time" value="${item.arrive || ''}"></td>
                <td class="text">
                  <select class="name-select">
                    <option value="">-- Select Name --</option>
                    ${cachedUsers.map(u => `<option value="${u.name}" ${u.name === item.name ? 'selected' : ''}>${u.name}</option>`).join('')}
                    <option value="__add_new__">➕ Add new name</option>
                  </select>
                </td>
                <td class="text"><textarea>${item.airline || ''}</textarea></td>
                <td class="text"><textarea>${item.fromTo || ''}</textarea></td>
                <td class="text"><textarea>${item.ref || ''}</textarea></td>
                <td class="action"><button type="button" class="delete-btn"><span class="material-symbols-outlined">delete</span></button></td>
              `;
            }
          } else {
            row.innerHTML = `
              <td class="date"><input type="date" value="${item.checkin || ''}"></td>
              <td class="date"><input type="date" value="${item.checkout || ''}"></td>
              <td class="text">
                <select class="name-select">
                  <option value="">-- Select Name --</option>
                  ${cachedUsers.map(u => `<option value="${u.name}" ${u.name === item.name ? 'selected' : ''}>${u.name}</option>`).join('')}
                  <option value="__add_new__">➕ Add new name</option>
                </select>
              </td>
              <td class="text"><textarea>${item.hotel || ''}</textarea></td>
              <td class="text"><textarea>${item.ref || ''}</textarea></td>
              <td class="action"><button type="button" class="delete-btn"><span class="material-symbols-outlined">delete</span></button></td>
            `;
          }
        }

        table.appendChild(row);
      });

      table.querySelectorAll('textarea').forEach(autoResizeTextarea);
      
      // Add event listener for name select dropdowns
      table.querySelectorAll('.name-select').forEach(select => {
        select.addEventListener('change', function() {
          if (this.value === '__add_new__') {
            const newName = prompt('Enter new name:');
            if (newName && !cachedUsers.some(u => u.name === newName)) {
              cachedUsers.push({ name: newName });
              cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
              
              // Update this select and all other name selects
              document.querySelectorAll('.name-select').forEach(sel => {
                const currentValue = sel.value;
                sel.innerHTML = `
                  <option value="">-- Select Name --</option>
                  ${cachedUsers.map(u => `<option value="${u.name}">${u.name}</option>`).join('')}
                  <option value="__add_new__">➕ Add new name</option>
                `;
                sel.value = sel === this ? newName : currentValue;
              });
            } else {
              // Reset selection if cancelled or duplicate
              this.value = '';
            }
          }
        });
      });
    }

    function collectTableData(tableId) {
      const table = document.getElementById(tableId)?.querySelectorAll("tbody tr");
      if (!table) return [];
      return Array.from(table)
        .filter(row => !row.classList.contains('booked-row'))  // Skip booked rows (read-only)
        .map(row => {
          const inputs = row.querySelectorAll('input, textarea, select');
          return tableId === 'travelTable' ? {
            date: inputs[0]?.value || '',
            depart: inputs[1]?.value || '',
            arrive: inputs[2]?.value || '',
            name: inputs[3]?.value || '',
            airline: inputs[4]?.value || '',
            fromTo: inputs[5]?.value || '',
            ref: inputs[6]?.value || ''
          } : {
            checkin: inputs[0]?.value || '',
            checkout: inputs[1]?.value || '',
            name: inputs[2]?.value || '',
            hotel: inputs[3]?.value || '',
            ref: inputs[4]?.value || ''
          };
        });
    }

    function addRow(tableId) {
      console.log('addRow called for', tableId, 'editMode:', editMode);
      // Don't allow adding rows if not in edit mode or not an owner
      if (!editMode || !isOwner) {
        console.log('Cannot add row: editMode is', editMode, 'isOwner is', isOwner);
        return;
      }
      const table = document.getElementById(tableId)?.querySelector("tbody");
      console.log('table element:', table);
      if (!table) {
        console.log('No table/tbody found for', tableId);
        return;
      }
      const row = document.createElement("tr");

      row.innerHTML = tableId === 'travelTable'
        ? `
          <td class="date"><input type="date"></td>
          <td class="time"><input type="time"></td>
          <td class="time"><input type="time"></td>
          <td class="text">
            <select class="name-select">
              <option value="">-- Select Name --</option>
              ${cachedUsers.map(u => `<option value="${u.name}">${u.name}</option>`).join('')}
              <option value="__add_new__">➕ Add new name</option>
            </select>
          </td>
          <td class="text"><textarea></textarea></td>
          <td class="text"><textarea></textarea></td>
          <td class="text"><textarea></textarea></td>
          <td class="action"><button class="delete-btn" onclick="window.removeRow(this)"><span class="material-symbols-outlined">delete</span></button></td>
        `
        : `
          <td class="date"><input type="date"></td>
          <td class="date"><input type="date"></td>
          <td class="text">
            <select class="name-select">
              <option value="">-- Select Name --</option>
              ${cachedUsers.map(u => `<option value="${u.name}">${u.name}</option>`).join('')}
              <option value="__add_new__">➕ Add new name</option>
            </select>
          </td>
          <td class="text"><textarea></textarea></td>
          <td class="text"><textarea></textarea></td>
          <td class="action"><button class="delete-btn" onclick="window.removeRow(this)"><span class="material-symbols-outlined">delete</span></button></td>
        `;

      table.appendChild(row);
      row.querySelectorAll('textarea').forEach(autoResizeTextarea);
      
      // Add event listener for name select in the new row
      const nameSelect = row.querySelector('.name-select');
      if (nameSelect) {
        nameSelect.addEventListener('change', function() {
          if (this.value === '__add_new__') {
            const newName = prompt('Enter new name:');
            if (newName && !cachedUsers.some(u => u.name === newName)) {
              cachedUsers.push({ name: newName });
              cachedUsers.sort((a, b) => a.name.localeCompare(b.name));
              
              // Update all name selects
              document.querySelectorAll('.name-select').forEach(sel => {
                const currentValue = sel.value;
                sel.innerHTML = `
                  <option value="">-- Select Name --</option>
                  ${cachedUsers.map(u => `<option value="${u.name}">${u.name}</option>`).join('')}
                  <option value="__add_new__">➕ Add new name</option>
                `;
                sel.value = sel === this ? newName : currentValue;
              });
            } else {
              // Reset selection if cancelled or duplicate
              this.value = '';
            }
          }
        });
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

    async function loadData() {
      console.log('Fetching table data for tableId:', tableId);
      
      // Load users if not already loaded
      if (!cachedUsers.length) await preloadUsers();
      
      const res = await fetch(`${API_BASE}/api/tables/${tableId}/travel`, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      
      // Store data globally for filtering
      travelData = data.travel || [];
      accommodationData = data.accommodation || [];
      
      populateTable('travelTable', travelData);
      populateTable('accommodationTable', accommodationData);
    }
    
    function filterTables() {
      populateTable('travelTable', travelData);
      populateTable('accommodationTable', accommodationData);
    }

    async function saveData() {
      const travelRows = collectTableData('travelTable');
      const accommodationRows = collectTableData('accommodationTable');
      await fetch(`${API_BASE}/api/tables/${tableId}/travel`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ travel: travelRows, accommodation: accommodationRows })
      });
      editMode = false;
      const editModeBtn = document.getElementById('editModeBtn');
      const saveBtn = document.getElementById('saveBtn');
      if (editModeBtn) editModeBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.style.display = 'none';
      await loadData();
    }

    function enterEditMode() {
      console.log('enterEditMode called', { isOwner, editMode });
      if (!isOwner) return;
      editMode = true;
      console.log('Edit mode set to:', editMode);
      const editModeBtn = document.getElementById('editModeBtn');
      const saveBtn = document.getElementById('saveBtn');
      if (editModeBtn) editModeBtn.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'inline-block';
      loadData();
    }

    // Expose functions on window
    window.addRow = addRow;
    window.removeRow = removeRow;
    window.saveData = saveData;
    window.enterEditMode = enterEditMode;
    window.filterTables = filterTables;

    // Add click handler for delete buttons
    document.addEventListener('click', function(e) {
      if (e.target && e.target.classList.contains('delete-btn')) {
        console.log('Delete button clicked');
        window.removeRow(e.target);
      }
    });

    window.initPage = async function(id) {
      console.log('initPage called with id:', id);
      const tableIdToUse = id || tableId;
      
      // Setup search input listener
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.addEventListener('input', filterTables);
      }
      
      // Ensure CSS is loaded when accessing page directly
      if (!document.querySelector('link[href*="travel-accommodation.css"]')) {
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = 'css/travel-accommodation.css';
        cssLink.setAttribute('data-page-css', 'true');
        document.head.appendChild(cssLink);
        console.log('Loaded travel-accommodation CSS directly');
      }
      
      // Ensure body class is set
      if (!document.body.classList.contains('travel-page')) {
        document.body.classList.add('travel-page');
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
        
        // Hide edit button for non-owners
        const editModeBtn = document.getElementById('editModeBtn');
        if (!isOwner && editModeBtn) editModeBtn.style.display = 'none';
        
        // Hide add row buttons for non-owners
        const addRowButtons = document.querySelectorAll('.add-btn');
        if (!isOwner && addRowButtons) {
          addRowButtons.forEach(btn => {
            btn.style.display = 'none';
          });
        }
        
        await loadData();
      } catch (error) {
        console.error('Error initializing travel page:', error);
        alert('Failed to load travel information. Please try again.');
      }

      // Bottom Nav
      try {
        let navContainer = document.getElementById('bottomNav');
        if (!navContainer) {
          navContainer = document.createElement('nav');
          navContainer.className = 'bottom-nav';
          navContainer.id = 'bottomNav';
          document.body.appendChild(navContainer);
        }
        const navRes = await fetch('../bottom-nav.html?v=' + Date.now());
        const navHTML = await navRes.text();
        
        // Extract just the nav content (without the outer nav tag)
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = navHTML;
        const navContent = tempDiv.querySelector('nav').innerHTML;
        navContainer.innerHTML = navContent;

        // Set up navigation using the centralized function from app.js
        if (window.setupBottomNavigation) {
          window.setupBottomNavigation(navContainer, tableIdToUse, 'travel-accommodation');
        }
      } catch (error) {
        console.error('Error loading navigation:', error);
      }

      if (window.lucide) lucide.createIcons();
    };

    // Add Socket.IO real-time updates early in the file
    // Socket.IO real-time updates
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