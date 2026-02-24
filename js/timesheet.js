(function() {
  const token = localStorage.getItem('token');
  if (!token && !window.location.pathname.endsWith('index.html')) {
    alert('Not logged in');
    window.location.href = 'index.html';
  }

  let timesheetData = null;
  let editMode = false;
  let currentFilter = 'this_month';
  let customStartDate = null;
  let customEndDate = null;

  // Helper to format date for display
  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: '2-digit',
      timeZone: 'UTC'
    });
  }

  // Helper to format time for display
  function formatTime(time) {
    if (!time) return '-';
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHours = h % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  }

  // Get current local date in YYYY-MM-DD format
  function getLocalDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Get current local time in HH:MM format
  function getLocalTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  // Get current UTC timestamp (ISO string) for accurate time tracking
  function getUTCTimestamp() {
    return new Date().toISOString();
  }

  // Calculate hours between clock in and clock out
  // Uses UTC timestamps when available (handles timezone changes during travel)
  // Falls back to date/time strings for manual entries or legacy data
  function calculateHours(clockIn, clockOut) {
    if (!clockIn || !clockOut) return null;
    
    // If both have UTC timestamps, use those for accurate calculation
    // This handles the case where someone clocks in PT and clocks out ET
    if (clockIn.utcTimestamp && clockOut.utcTimestamp) {
      const inTime = new Date(clockIn.utcTimestamp);
      const outTime = new Date(clockOut.utcTimestamp);
      const diffMs = outTime - inTime;
      const diffHours = diffMs / (1000 * 60 * 60);
      return Math.max(0, diffHours).toFixed(2);
    }
    
    // Fallback: use date/time strings (for manual entries or legacy data)
    // Note: This may be inaccurate if timezones changed between clock in/out
    const inDate = new Date(clockIn.date);
    const outDate = new Date(clockOut.date);
    
    // Parse times
    const [inHours, inMinutes] = (clockIn.time || '00:00').split(':').map(Number);
    const [outHours, outMinutes] = (clockOut.time || '00:00').split(':').map(Number);
    
    inDate.setHours(inHours, inMinutes, 0, 0);
    outDate.setHours(outHours, outMinutes, 0, 0);
    
    const diffMs = outDate - inDate;
    const diffHours = diffMs / (1000 * 60 * 60);
    
    return Math.max(0, diffHours).toFixed(2);
  }

  // Filter entries based on selected period
  function filterEntries(entries) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    return entries.filter(entry => {
      const entryDate = new Date(entry.date);
      const entryMonth = entryDate.getMonth();
      const entryYear = entryDate.getFullYear();
      
      switch (currentFilter) {
        case 'this_month':
          return entryMonth === currentMonth && entryYear === currentYear;
        case 'last_month':
          const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
          const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
          return entryMonth === lastMonth && entryYear === lastMonthYear;
        case 'past_3_months':
          // Get date 3 months ago
          const threeMonthsAgo = new Date(now);
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
          return entryDate >= threeMonthsAgo && entryDate <= now;
        case 'this_year':
          return entryYear === currentYear;
        case 'custom':
          if (customStartDate && customEndDate) {
            const start = new Date(customStartDate);
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999); // Include the entire end day
            return entryDate >= start && entryDate <= end;
          }
          return true; // Show all if custom range not set
        default:
          return true;
      }
    });
  }

  // Pair clock in and clock out entries
  function pairEntries(entries) {
    const paired = [];
    const unpaired = [];
    
    // Sort entries by date and time
    const sorted = [...entries].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateA.getTime() !== dateB.getTime()) {
        return dateA - dateB;
      }
      // If same date, sort by time
      const timeA = a.time || '00:00';
      const timeB = b.time || '00:00';
      return timeA.localeCompare(timeB);
    });
    
    // Separate by type
    const clockIns = sorted.filter(e => e.type === 'clock_in');
    const clockOuts = sorted.filter(e => e.type === 'clock_out');
    const travels = sorted.filter(e => e.type === 'travel');
    
    // Try to pair clock ins with clock outs
    const usedClockOuts = new Set();
    
    clockIns.forEach(clockIn => {
      // If already paired, use that pair
      if (clockIn.pairId) {
        const matchingOut = clockOuts.find(co => co.pairId === clockIn.pairId && !usedClockOuts.has(co._id));
        if (matchingOut) {
          usedClockOuts.add(matchingOut._id);
          paired.push({
            type: 'pair',
            clockIn,
            clockOut: matchingOut,
            hours: calculateHours(clockIn, matchingOut)
          });
          return;
        }
      }
      
      // Find closest clock out on same date or shortly after
      const clockInTime = clockIn.time || '00:00';
      
      // Maximum time gap for pairing: 24 hours
      const MAX_PAIR_GAP_MS = 24 * 60 * 60 * 1000;
      
      // Find clock out that is on the same date or within 24 hours
      let bestMatch = null;
      let bestDiff = Infinity;
      
      clockOuts.forEach(clockOut => {
        if (usedClockOuts.has(clockOut._id)) return;
        
        const clockOutTime = clockOut.time || '00:00';
        
        // Calculate time difference
        const inDateTime = new Date(clockIn.date);
        const [inH, inM] = clockInTime.split(':').map(Number);
        inDateTime.setHours(inH, inM);
        
        const outDateTime = new Date(clockOut.date);
        const [outH, outM] = clockOutTime.split(':').map(Number);
        outDateTime.setHours(outH, outM);
        
        const diff = outDateTime - inDateTime;
        
        // Only consider clock outs that are:
        // 1. After the clock in
        // 2. Within 24 hours (to avoid pairing entries days apart)
        // 3. Closer than any previous match
        if (diff > 0 && diff <= MAX_PAIR_GAP_MS && diff < bestDiff) {
          bestDiff = diff;
          bestMatch = clockOut;
        }
      });
      
      if (bestMatch) {
        usedClockOuts.add(bestMatch._id);
        paired.push({
          type: 'pair',
          clockIn,
          clockOut: bestMatch,
          hours: calculateHours(clockIn, bestMatch)
        });
      } else {
        unpaired.push({
          type: 'single',
          entry: clockIn
        });
      }
    });
    
    // Add unpaired clock outs
    clockOuts.forEach(clockOut => {
      if (!usedClockOuts.has(clockOut._id)) {
        unpaired.push({
          type: 'single',
          entry: clockOut
        });
      }
    });
    
    // Add travel entries
    travels.forEach(travel => {
      paired.push({
        type: 'travel',
        entry: travel,
        hours: travel.hours || 4
      });
    });
    
    // Sort all entries by date
    const allEntries = [...paired, ...unpaired].sort((a, b) => {
      const dateA = a.type === 'pair' ? new Date(a.clockIn.date) : new Date(a.entry.date);
      const dateB = b.type === 'pair' ? new Date(b.clockIn.date) : new Date(b.entry.date);
      return dateB - dateA; // Most recent first
    });
    
    return allEntries;
  }

  // Calculate total hours for filtered entries
  function calculateTotalHours(groupedEntries) {
    let total = 0;
    
    groupedEntries.forEach(group => {
      if (group.type === 'pair') {
        total += parseFloat(group.hours) || 0;
      } else if (group.type === 'travel') {
        total += parseFloat(group.hours) || 4;
      }
    });
    
    return total.toFixed(2);
  }

  // Check if mobile
  function isMobile() {
    return window.innerWidth <= 768;
  }

  // Render the timesheet table
  function renderTimesheet() {
    if (!timesheetData || !timesheetData.entries) {
      showEmptyState();
      return;
    }
    
    const filteredEntries = filterEntries(timesheetData.entries);
    
    if (filteredEntries.length === 0) {
      showEmptyState();
      return;
    }
    
    const groupedEntries = pairEntries(filteredEntries);
    
    const tbody = document.getElementById('timesheetBody');
    const table = document.getElementById('timesheetTable');
    const mobileContainer = document.getElementById('mobileCardsContainer');
    const emptyState = document.getElementById('emptyState');
    
    if (tbody) tbody.innerHTML = '';
    if (mobileContainer) mobileContainer.innerHTML = '';
    if (table) table.style.display = 'table';
    if (emptyState) emptyState.style.display = 'none';
    
    // Update total hours
    const totalHours = calculateTotalHours(groupedEntries);
    const hoursDisplay = document.getElementById('monthlyHours');
    if (hoursDisplay) hoursDisplay.textContent = totalHours;
    
    groupedEntries.forEach(group => {
      if (group.type === 'pair') {
        // Render clock in row
        const inRow = createEntryRow(group.clockIn, 'in', group.hours, true);
        tbody.appendChild(inRow);
        
        // Render clock out row
        const outRow = createEntryRow(group.clockOut, 'out', null, false);
        tbody.appendChild(outRow);
        
        // Mobile: Create paired card showing both in and out
        if (mobileContainer) {
          mobileContainer.appendChild(createPairedMobileCard(group.clockIn, group.clockOut, group.hours));
        }
      } else if (group.type === 'travel') {
        const travelRow = createEntryRow(group.entry, 'travel', group.hours, true);
        tbody.appendChild(travelRow);
        
        if (mobileContainer) {
          mobileContainer.appendChild(createMobileCard(group.entry, 'travel', group.hours));
        }
      } else if (group.type === 'single') {
        const rowType = group.entry.type === 'clock_in' ? 'in' : 'out';
        const singleRow = createEntryRow(group.entry, rowType, null, true);
        tbody.appendChild(singleRow);
        
        if (mobileContainer) {
          mobileContainer.appendChild(createMobileCard(group.entry, rowType, null));
        }
      }
    });
  }

  // Create paired mobile card showing clock in and clock out together
  function createPairedMobileCard(clockIn, clockOut, hours) {
    const card = document.createElement('div');
    card.className = 'entry-card entry-card-paired';
    card.dataset.clockInId = clockIn._id;
    card.dataset.clockOutId = clockOut._id;
    
    // Header with date and hours
    const header = document.createElement('div');
    header.className = 'entry-card-pair-header';
    
    const dateEl = document.createElement('span');
    dateEl.className = 'entry-card-pair-date';
    dateEl.textContent = formatDate(clockIn.date);
    header.appendChild(dateEl);
    
    const hoursEl = document.createElement('span');
    hoursEl.className = 'entry-card-pair-hours';
    hoursEl.textContent = hours ? hours + 'h' : '';
    header.appendChild(hoursEl);
    
    card.appendChild(header);
    
    // Time range row
    const timeRow = document.createElement('div');
    timeRow.className = 'entry-card-pair-times';
    
    // Clock In time (clickable in edit mode)
    const inTime = document.createElement('div');
    inTime.className = 'entry-card-pair-time in';
    inTime.dataset.entryId = clockIn._id;
    inTime.innerHTML = `
      <span class="entry-type-badge type-in">IN</span>
      <span class="time-value">${formatTime(clockIn.time)}</span>
    `;
    timeRow.appendChild(inTime);
    
    // Arrow
    const arrow = document.createElement('span');
    arrow.className = 'entry-card-pair-arrow';
    arrow.innerHTML = '<span class="material-symbols-outlined">arrow_forward</span>';
    timeRow.appendChild(arrow);
    
    // Clock Out time (clickable in edit mode)
    const outTime = document.createElement('div');
    outTime.className = 'entry-card-pair-time out';
    outTime.dataset.entryId = clockOut._id;
    outTime.innerHTML = `
      <span class="entry-type-badge type-out">OUT</span>
      <span class="time-value">${formatTime(clockOut.time)}</span>
    `;
    timeRow.appendChild(outTime);
    
    card.appendChild(timeRow);
    
    // Add click handlers for individual IN/OUT times in edit mode
    inTime.onclick = (e) => {
      if (editMode) {
        e.stopPropagation();
        openEditModal(clockIn);
      }
    };
    
    outTime.onclick = (e) => {
      if (editMode) {
        e.stopPropagation();
        openEditModal(clockOut);
      }
    };
    
    // Notes section (if either has notes)
    const hasNotes = clockIn.notes || clockOut.notes;
    if (hasNotes) {
      const notesToggle = document.createElement('button');
      notesToggle.className = 'entry-card-notes-toggle';
      notesToggle.innerHTML = `
        <span class="material-symbols-outlined">expand_more</span>
        <span>Notes</span>
      `;
      
      const notesContent = document.createElement('div');
      notesContent.className = 'entry-card-notes';
      let notesHtml = '';
      if (clockIn.notes) notesHtml += `<div><strong>In:</strong> ${clockIn.notes}</div>`;
      if (clockOut.notes) notesHtml += `<div><strong>Out:</strong> ${clockOut.notes}</div>`;
      notesContent.innerHTML = `<div class="entry-card-notes-content">${notesHtml}</div>`;
      
      notesToggle.onclick = (e) => {
        e.stopPropagation();
        notesToggle.classList.toggle('expanded');
        notesContent.classList.toggle('expanded');
      };
      
      card.appendChild(notesToggle);
      card.appendChild(notesContent);
    }
    
    // Edit mode - clicking on header area does nothing (must click IN or OUT specifically)
    card.onclick = () => {
      // No action - user must click on IN or OUT time specifically
    };
    
    return card;
  }

  // Create mobile card for an entry
  function createMobileCard(entry, type, hours) {
    const card = document.createElement('div');
    card.className = `entry-card entry-row-${type === 'travel' ? 'travel' : type}`;
    card.dataset.entryId = entry._id;
    
    // Main row with date, time, hours
    const mainRow = document.createElement('div');
    mainRow.className = 'entry-card-main';
    
    // Type badge
    const typeBadge = document.createElement('span');
    typeBadge.className = `entry-type-badge type-${type}`;
    typeBadge.textContent = type === 'in' ? 'IN' : type === 'out' ? 'OUT' : 'TRV';
    mainRow.appendChild(typeBadge);
    
    // Date
    const dateEl = document.createElement('span');
    dateEl.className = 'entry-card-date';
    dateEl.textContent = formatDate(entry.date);
    mainRow.appendChild(dateEl);
    
    // Time
    const timeEl = document.createElement('span');
    timeEl.className = 'entry-card-time';
    timeEl.textContent = type === 'travel' ? '-' : formatTime(entry.time);
    mainRow.appendChild(timeEl);
    
    // Hours
    const hoursEl = document.createElement('span');
    hoursEl.className = 'entry-card-hours';
    hoursEl.textContent = hours ? hours + 'h' : '';
    mainRow.appendChild(hoursEl);
    
    card.appendChild(mainRow);
    
    // Notes toggle (only if has notes)
    if (entry.notes) {
      const notesToggle = document.createElement('button');
      notesToggle.className = 'entry-card-notes-toggle';
      notesToggle.innerHTML = `
        <span class="material-symbols-outlined">expand_more</span>
        <span>Notes</span>
      `;
      
      const notesContent = document.createElement('div');
      notesContent.className = 'entry-card-notes';
      notesContent.innerHTML = `<div class="entry-card-notes-content">${entry.notes}</div>`;
      
      notesToggle.onclick = (e) => {
        e.stopPropagation();
        notesToggle.classList.toggle('expanded');
        notesContent.classList.toggle('expanded');
      };
      
      card.appendChild(notesToggle);
      card.appendChild(notesContent);
    }
    
    // Edit mode click handler
    card.onclick = (e) => {
      console.log('Card clicked, editMode:', editMode);
      if (editMode) {
        e.preventDefault();
        e.stopPropagation();
        openEditModal(entry);
      }
    };
    
    return card;
  }

  // Create a table row for an entry
  function createEntryRow(entry, type, hours, showHours) {
    const row = document.createElement('tr');
    row.className = `entry-row entry-row-${type === 'travel' ? 'travel' : type}`;
    row.dataset.entryId = entry._id;
    
    // Type cell (editable in edit mode)
    const typeCell = document.createElement('td');
    typeCell.className = 'cell-type';
    typeCell.dataset.field = 'type';
    typeCell.dataset.value = entry.type;
    
    const typeBadge = document.createElement('span');
    typeBadge.className = `entry-type-badge type-${type}`;
    typeBadge.textContent = type === 'in' ? 'IN' : type === 'out' ? 'OUT' : 'TRV';
    typeCell.appendChild(typeBadge);
    
    // Type dropdown (hidden by default)
    const typeSelect = document.createElement('select');
    typeSelect.className = 'inline-edit-select';
    typeSelect.innerHTML = `
      <option value="clock_in" ${entry.type === 'clock_in' ? 'selected' : ''}>IN</option>
      <option value="clock_out" ${entry.type === 'clock_out' ? 'selected' : ''}>OUT</option>
      <option value="travel" ${entry.type === 'travel' ? 'selected' : ''}>TRV</option>
    `;
    typeSelect.onchange = async () => {
      const newType = typeSelect.value;
      const updates = { type: newType };
      // If changing to travel, set default hours
      if (newType === 'travel') {
        updates.hours = 4;
        updates.time = null;
      }
      await updateEntry(entry._id, updates);
    };
    typeCell.appendChild(typeSelect);
    row.appendChild(typeCell);
    
    // Date cell (editable)
    const dateCell = document.createElement('td');
    dateCell.className = 'cell-date';
    dateCell.dataset.field = 'date';
    
    const dateDisplay = document.createElement('span');
    dateDisplay.className = 'cell-display';
    dateDisplay.textContent = formatDate(entry.date);
    dateCell.appendChild(dateDisplay);
    
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'inline-edit-input';
    const entryDate = new Date(entry.date);
    dateInput.value = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;
    dateInput.onchange = async () => {
      await updateEntry(entry._id, { date: dateInput.value });
    };
    dateCell.appendChild(dateInput);
    row.appendChild(dateCell);
    
    // Time cell (editable, except for travel)
    const timeCell = document.createElement('td');
    timeCell.className = 'cell-time';
    timeCell.dataset.field = 'time';
    
    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'cell-display';
    timeDisplay.textContent = type === 'travel' ? '-' : formatTime(entry.time);
    timeCell.appendChild(timeDisplay);
    
    if (type !== 'travel') {
      const timeInput = document.createElement('input');
      timeInput.type = 'time';
      timeInput.className = 'inline-edit-input';
      timeInput.value = entry.time || '';
      timeInput.onchange = async () => {
        await updateEntry(entry._id, { time: timeInput.value });
      };
      timeCell.appendChild(timeInput);
    }
    row.appendChild(timeCell);
    
    // Hours cell (editable for travel entries)
    const hoursCell = document.createElement('td');
    hoursCell.className = 'cell-hours';
    hoursCell.dataset.field = 'hours';
    
    const hoursDisplay = document.createElement('span');
    hoursDisplay.className = 'cell-display';
    if (showHours && hours) {
      hoursDisplay.className += ' entry-hours';
      hoursDisplay.textContent = hours;
    } else {
      hoursDisplay.textContent = '';
    }
    hoursCell.appendChild(hoursDisplay);
    
    // Hours input for travel entries
    if (type === 'travel') {
      const hoursInput = document.createElement('input');
      hoursInput.type = 'number';
      hoursInput.className = 'inline-edit-input';
      hoursInput.step = '0.25';
      hoursInput.min = '0';
      hoursInput.value = entry.hours || 4;
      hoursInput.onchange = async () => {
        await updateEntry(entry._id, { hours: parseFloat(hoursInput.value) || 0 });
      };
      hoursCell.appendChild(hoursInput);
    }
    row.appendChild(hoursCell);
    
    // Notes cell (editable)
    const notesCell = document.createElement('td');
    notesCell.className = 'cell-notes entry-notes';
    notesCell.dataset.field = 'notes';
    
    const notesDisplay = document.createElement('span');
    notesDisplay.className = 'cell-display';
    notesDisplay.textContent = entry.notes || '';
    notesDisplay.title = entry.notes || '';
    notesCell.appendChild(notesDisplay);
    
    const notesInput = document.createElement('input');
    notesInput.type = 'text';
    notesInput.className = 'inline-edit-input';
    notesInput.value = entry.notes || '';
    notesInput.placeholder = 'Add notes...';
    notesInput.onblur = async () => {
      if (notesInput.value !== (entry.notes || '')) {
        await updateEntry(entry._id, { notes: notesInput.value });
      }
    };
    notesInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        notesInput.blur();
      }
    };
    notesCell.appendChild(notesInput);
    row.appendChild(notesCell);
    
    // Delete button cell (only visible in edit mode)
    const deleteCell = document.createElement('td');
    deleteCell.className = 'edit-col';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-entry';
    deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Are you sure you want to delete this entry?')) {
        try {
          await deleteEntry(entry._id);
        } catch (error) {
          // Error already handled in deleteEntry
        }
      }
    };
    deleteCell.appendChild(deleteBtn);
    row.appendChild(deleteCell);
    
    return row;
  }

  // Show empty state
  function showEmptyState() {
    const table = document.getElementById('timesheetTable');
    const emptyState = document.getElementById('emptyState');
    const hoursDisplay = document.getElementById('monthlyHours');
    
    if (table) table.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    if (hoursDisplay) hoursDisplay.textContent = '0';
  }

  // Fetch timesheet data from API
  async function fetchTimesheet() {
    try {
      const response = await fetch(`${API_BASE}/api/timesheet`, {
        headers: { Authorization: token }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch timesheet');
      }
      
      timesheetData = await response.json();
      renderTimesheet();
    } catch (error) {
      console.error('Error fetching timesheet:', error);
      showEmptyState();
    }
  }

  // Add a new entry
  async function addEntry(type, date, time, notes, hours, isManualEntry = false) {
    try {
      // Include UTC timestamp for accurate elapsed time calculation
      // This handles timezone changes (e.g., PT to ET travel)
      const utcTimestamp = isManualEntry ? null : getUTCTimestamp();
      
      const response = await fetch(`${API_BASE}/api/timesheet/entry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify({ 
          type, 
          date, 
          time, 
          notes, 
          hours, 
          isManual: isManualEntry,
          utcTimestamp // Store actual moment in time for accurate calculations
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to add entry');
      }
      
      const result = await response.json();
      
      // Refresh timesheet
      await fetchTimesheet();
      
      showToast(`${type === 'clock_in' ? 'Clocked in' : type === 'clock_out' ? 'Clocked out' : 'Travel logged'} successfully!`, 'success');
      
      return result;
    } catch (error) {
      console.error('Error adding entry:', error);
      showToast('Failed to add entry. Please try again.', 'error');
      throw error;
    }
  }

  // Update an entry
  async function updateEntry(entryId, updates) {
    try {
      const response = await fetch(`${API_BASE}/api/timesheet/entry/${entryId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token
        },
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) {
        throw new Error('Failed to update entry');
      }
      
      await fetchTimesheet();
      showToast('Entry updated successfully!', 'success');
    } catch (error) {
      console.error('Error updating entry:', error);
      showToast('Failed to update entry. Please try again.', 'error');
      throw error;
    }
  }

  // Delete an entry
  async function deleteEntry(entryId) {
    try {
      const response = await fetch(`${API_BASE}/api/timesheet/entry/${entryId}`, {
        method: 'DELETE',
        headers: { Authorization: token }
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete entry');
      }
      
      await fetchTimesheet();
      showToast('Entry deleted successfully!', 'success');
    } catch (error) {
      console.error('Error deleting entry:', error);
      showToast('Failed to delete entry. Please try again.', 'error');
      throw error;
    }
  }

  // Show toast notification
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 24px;
      border-radius: 8px;
      color: white;
      font-weight: 500;
      z-index: 10001;
      opacity: 0;
      transition: opacity 0.3s;
      ${type === 'success' ? 'background: #28a745;' : 
        type === 'error' ? 'background: #dc3545;' : 
        'background: #17a2b8;'}
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => toast.style.opacity = '1', 10);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Open manual entry modal
  function openManualEntryModal() {
    const modal = document.getElementById('manualEntryModal');
    const typeSelect = document.getElementById('manualType');
    const dateInput = document.getElementById('manualDate');
    const timeInput = document.getElementById('manualTime');
    const notesInput = document.getElementById('manualNotes');
    
    // Set defaults
    if (typeSelect) typeSelect.value = 'clock_in';
    if (dateInput) dateInput.value = getLocalDate();
    if (timeInput) timeInput.value = getLocalTime();
    if (notesInput) notesInput.value = '';
    
    if (modal) {
      // Prevent body scroll
      document.body.classList.add('modal-open');
      
      // Move modal to body if needed
      if (modal.parentElement && modal.parentElement.tagName !== 'BODY') {
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      modal.style.visibility = 'visible';
      modal.style.opacity = '1';
      console.log('Manual entry modal opened');
      console.log('Modal display:', window.getComputedStyle(modal).display);
    }
  }

  // Close manual entry modal
  window.closeManualEntryModal = function() {
    const modal = document.getElementById('manualEntryModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('modal-open');
  };

  // Current entry being edited
  let currentEditEntryId = null;

  // Open edit modal
  function openEditModal(entry) {
    console.log('Opening edit modal for entry:', entry._id);
    currentEditEntryId = entry._id;
    
    let modal = document.getElementById('editEntryModal');
    
    // If modal not found, it might be in a different part of the DOM
    if (!modal) {
      console.error('Edit modal not found!');
      return;
    }
    
    const typeSelect = document.getElementById('editType');
    const dateInput = document.getElementById('editDate');
    const timeInput = document.getElementById('editTime');
    const hoursInput = document.getElementById('editHours');
    const notesInput = document.getElementById('editNotes');
    
    // Set type
    if (typeSelect) typeSelect.value = entry.type;
    
    // Set date - use UTC to avoid timezone shifts
    if (dateInput) {
      const date = new Date(entry.date);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      dateInput.value = `${year}-${month}-${day}`;
    }
    
    // Show/hide time vs hours based on type
    updateEditModalFields(entry.type);
    
    if (timeInput) timeInput.value = entry.time || '';
    if (hoursInput) hoursInput.value = entry.hours || 4;
    if (notesInput) notesInput.value = entry.notes || '';
    
    // Move modal to body if needed and show it
    if (modal.parentElement && modal.parentElement.tagName !== 'BODY') {
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.opacity = '1';
    
    // Force reflow
    modal.offsetHeight;
    
    // Prevent body scroll
    document.body.classList.add('modal-open');
    
    console.log('Edit modal opened');
    console.log('Modal display:', modal.style.display);
    console.log('Modal computed display:', window.getComputedStyle(modal).display);
    console.log('Modal z-index:', window.getComputedStyle(modal).zIndex);
    console.log('Modal position:', window.getComputedStyle(modal).position);
  }

  // Update edit modal fields based on type
  function updateEditModalFields(type) {
    const timeGroup = document.getElementById('editTimeGroup');
    const hoursGroup = document.getElementById('editHoursGroup');
    
    if (type === 'travel') {
      if (timeGroup) timeGroup.style.display = 'none';
      if (hoursGroup) hoursGroup.style.display = 'block';
    } else {
      if (timeGroup) timeGroup.style.display = 'block';
      if (hoursGroup) hoursGroup.style.display = 'none';
    }
  }

  // Close edit modal
  window.closeEditModal = function() {
    const modal = document.getElementById('editEntryModal');
    if (modal) modal.style.display = 'none';
    currentEditEntryId = null;
    document.body.classList.remove('modal-open');
  };


  // Setup action buttons
  function setupActionButtons() {
    // Clock In button - quick clock in with current time
    const clockInBtn = document.getElementById('clockInBtn');
    if (clockInBtn) {
      clockInBtn.onclick = () => {
        addEntry('clock_in', getLocalDate(), getLocalTime(), '');
      };
    }
    
    // Clock Out button - quick clock out with current time
    const clockOutBtn = document.getElementById('clockOutBtn');
    if (clockOutBtn) {
      clockOutBtn.onclick = () => {
        addEntry('clock_out', getLocalDate(), getLocalTime(), '');
      };
    }
    
    // Travel button - log 4 hours travel
    const travelBtn = document.getElementById('travelBtn');
    if (travelBtn) {
      travelBtn.onclick = () => {
        addEntry('travel', getLocalDate(), null, '', 4);
      };
    }
    
    // Manual Entry button - open modal
    const manualEntryBtn = document.getElementById('manualEntryBtn');
    if (manualEntryBtn) {
      manualEntryBtn.onclick = () => {
        openManualEntryModal();
      };
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    // Back button
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.onclick = () => {
        if (window.navigate) {
          window.navigate('events');
        } else {
          window.location.href = '/dashboard.html#events';
        }
      };
    }
    
    // Edit mode toggle
    const editModeBtn = document.getElementById('editModeBtn');
    if (editModeBtn) {
      editModeBtn.onclick = () => {
        editMode = !editMode;
        console.log('Edit mode toggled:', editMode);
        editModeBtn.classList.toggle('active', editMode);
        document.querySelector('.timesheet-page')?.classList.toggle('edit-mode-active', editMode);
      };
    }
    
    // Move modals to body to ensure they persist and are accessible
    const editModal = document.getElementById('editEntryModal');
    const manualModal = document.getElementById('manualEntryModal');
    if (editModal && editModal.parentElement !== document.body) {
      document.body.appendChild(editModal);
    }
    if (manualModal && manualModal.parentElement !== document.body) {
      document.body.appendChild(manualModal);
    }
    
    // Period filter
    const periodFilter = document.getElementById('periodFilter');
    const customDateRange = document.getElementById('customDateRange');
    
    if (periodFilter) {
      periodFilter.onchange = (e) => {
        currentFilter = e.target.value;
        
        // Show/hide custom date range inputs
        if (customDateRange) {
          if (currentFilter === 'custom') {
            customDateRange.style.display = 'flex';
            // Set default dates if not set
            if (!customStartDate) {
              const start = new Date();
              start.setMonth(start.getMonth() - 1);
              document.getElementById('customStartDate').value = start.toISOString().split('T')[0];
            }
            if (!customEndDate) {
              document.getElementById('customEndDate').value = getLocalDate();
            }
          } else {
            customDateRange.style.display = 'none';
            renderTimesheet();
          }
        } else if (currentFilter !== 'custom') {
          renderTimesheet();
        }
      };
    }
    
    // Apply custom date range
    const applyCustomRange = document.getElementById('applyCustomRange');
    if (applyCustomRange) {
      applyCustomRange.onclick = () => {
        customStartDate = document.getElementById('customStartDate')?.value;
        customEndDate = document.getElementById('customEndDate')?.value;
        
        if (!customStartDate || !customEndDate) {
          showToast('Please select both start and end dates', 'error');
          return;
        }
        
        if (new Date(customStartDate) > new Date(customEndDate)) {
          showToast('Start date must be before end date', 'error');
          return;
        }
        
        renderTimesheet();
      };
    }
    
    // Submit manual entry
    const submitManualBtn = document.getElementById('submitManualEntry');
    if (submitManualBtn) {
      submitManualBtn.onclick = async () => {
        const type = document.getElementById('manualType')?.value;
        const date = document.getElementById('manualDate')?.value;
        const time = document.getElementById('manualTime')?.value;
        const notes = document.getElementById('manualNotes')?.value || '';
        
        if (!type || !date || !time) {
          showToast('Please fill in all required fields', 'error');
          return;
        }
        
        try {
          // Manual entries don't have UTC timestamp - they use the user-specified date/time
          await addEntry(type, date, time, notes, null, true);
          closeManualEntryModal();
        } catch (error) {
          // Error already handled in addEntry
        }
      };
    }
    
    // Edit modal type change
    const editTypeSelect = document.getElementById('editType');
    if (editTypeSelect) {
      editTypeSelect.onchange = () => {
        updateEditModalFields(editTypeSelect.value);
      };
    }
    
    // Save edit entry
    const saveEditBtn = document.getElementById('saveEditEntry');
    if (saveEditBtn) {
      saveEditBtn.onclick = async () => {
        if (!currentEditEntryId) return;
        
        const type = document.getElementById('editType')?.value;
        const date = document.getElementById('editDate')?.value;
        const time = document.getElementById('editTime')?.value;
        const hours = document.getElementById('editHours')?.value;
        const notes = document.getElementById('editNotes')?.value || '';
        
        if (!date) {
          showToast('Please enter a date', 'error');
          return;
        }
        
        const updates = { type, date, notes };
        
        if (type === 'travel') {
          updates.hours = parseFloat(hours) || 4;
          updates.time = null;
        } else {
          updates.time = time;
        }
        
        try {
          await updateEntry(currentEditEntryId, updates);
          closeEditModal();
        } catch (error) {
          // Error already handled
        }
      };
    }
    
    // Delete edit entry
    const deleteEditBtn = document.getElementById('deleteEditEntry');
    if (deleteEditBtn) {
      deleteEditBtn.onclick = async () => {
        if (!currentEditEntryId) return;
        
        if (confirm('Are you sure you want to delete this entry?')) {
          try {
            await deleteEntry(currentEditEntryId);
            closeEditModal();
          } catch (error) {
            // Error already handled
          }
        }
      };
    }
    
    // Close modals on background click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          currentEditEntryId = null;
        }
      });
    });
  }

  // Cleanup when leaving page
  window.cleanupTimesheet = function() {
    // Show bottom nav again when leaving
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
      bottomNav.style.display = '';
    }
  };

  // Initialize page
  window.initPage = function() {
    console.log('Timesheet page initialized');
    
    // Hide bottom nav on this page
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
      bottomNav.style.display = 'none';
    }
    
    setupActionButtons();
    setupEventListeners();
    fetchTimesheet();
  };
})();
