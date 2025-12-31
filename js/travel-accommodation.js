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

        if (!isEditMode) {
          console.log('Not in edit mode, showing readonly view without action column');
          if (tableId === 'travelTable') {
            row.innerHTML = `
              <td class="date"><span class="readonly-span">${formatDateReadable(item.date)}</span></td>
              <td class="time"><span class="readonly-span">${formatTo12Hour(item.depart)}</span></td>
              <td class="time"><span class="readonly-span">${formatTo12Hour(item.arrive)}</span></td>
              <td class="text"><span class="readonly-span">${item.name || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.airline || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.fromTo || ''}</span></td>
              <td class="text"><span class="readonly-span">${item.ref || ''}</span></td>
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
      return Array.from(table).map(row => {
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
      
      populateTable('travelTable', travelData);
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
