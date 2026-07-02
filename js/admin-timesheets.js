/**
 * Admin Timesheets Page
 * Displays and manages timesheets for all users
 */

(function() {
  'use strict';

  const API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');
  
  let allTimesheetData = [];
  let currentFilter = 'current-month';
  let currentUserId = null;

  // Initialize page
  document.addEventListener('DOMContentLoaded', function() {
    // Wait for sidebar to load before initializing
    setTimeout(initTimesheets, 300);
  });

  async function initTimesheets() {
    console.log('[TIMESHEETS] Initializing timesheets page...');
    
    setupEventListeners();
    setDefaultDateRange();
    await loadTimesheetData();
  }

  function setupEventListeners() {
    // Date filter dropdown
    const dateFilter = document.getElementById('dateFilter');
    if (dateFilter) {
      dateFilter.addEventListener('change', handleFilterChange);
    }

    // Custom date range apply button
    const applyBtn = document.getElementById('applyCustomDateBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', handleCustomDateApply);
    }

    // Back button
    const backBtn = document.getElementById('backToListBtn');
    if (backBtn) {
      backBtn.addEventListener('click', showUsersList);
    }
  }

  function setDefaultDateRange() {
    const now = new Date();
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    
    if (startDate && endDate) {
      // Default to current month
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      startDate.value = formatDateForInput(firstDay);
      endDate.value = formatDateForInput(lastDay);
    }
  }

  function formatDateForInput(date) {
    return date.toISOString().split('T')[0];
  }

  function handleFilterChange(e) {
    currentFilter = e.target.value;
    const customRange = document.getElementById('customDateRange');
    
    if (currentFilter === 'custom') {
      customRange.style.display = 'flex';
    } else {
      customRange.style.display = 'none';
      applyFilter().catch(err => console.error('[TIMESHEETS] applyFilter failed:', err));
    }
  }

  function handleCustomDateApply() {
    applyFilter().catch(err => console.error('[TIMESHEETS] applyFilter failed:', err));
  }

  async function applyFilter() {
    // The summary API is scoped to the selected range, so refetch instead of
    // re-filtering the already-loaded (current-month) data — otherwise other
    // ranges render blank. loadTimesheetData() re-renders the users list.
    await loadTimesheetData();
    if (currentUserId) {
      // If viewing a user's detail, refresh their data with the new range
      showUserDetail(currentUserId);
    }
  }

  function getDateRange() {
    const now = new Date();
    let startDate, endDate;

    switch (currentFilter) {
      case 'current-month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last-month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'current-year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      case 'custom':
        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        startDate = startInput ? new Date(startInput.value) : new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = endInput ? new Date(endInput.value) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    // Set time to cover full day
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
  }

  async function loadTimesheetData() {
    showLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Not authenticated');
      }

      const { startDate, endDate } = getDateRange();
      
      // First try to debug the data structure
      try {
        const debugResponse = await fetch(`${API_BASE}/api/timesheets/debug`, {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json'
          }
        });
        if (debugResponse.ok) {
          const debugData = await debugResponse.json();
          console.log('[TIMESHEETS DEBUG] Collection info:', debugData);
        }
      } catch (e) {
        console.log('[TIMESHEETS DEBUG] Debug endpoint not available:', e);
      }
      
      const response = await fetch(
        `${API_BASE}/api/timesheets/summary?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        {
          headers: {
            'Authorization': token,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch timesheets');
      }

      allTimesheetData = await response.json();
      console.log('[TIMESHEETS] Loaded data for', allTimesheetData.length, 'users');
      console.log('[TIMESHEETS] Raw data:', allTimesheetData);
      
      renderUsersList();
    } catch (error) {
      console.error('[TIMESHEETS] Error loading data:', error);
      showError('Failed to load timesheet data: ' + error.message);
    } finally {
      showLoading(false);
    }
  }

  function showLoading(show) {
    const loader = document.getElementById('usersLoadingIndicator');
    const grid = document.getElementById('usersGrid');
    const empty = document.getElementById('usersEmptyState');
    
    if (loader) loader.style.display = show ? 'block' : 'none';
    if (grid && !show) grid.style.display = 'grid';
    if (empty) empty.style.display = 'none';
  }

  function showError(message) {
    const grid = document.getElementById('usersGrid');
    const empty = document.getElementById('usersEmptyState');
    
    if (grid) grid.style.display = 'none';
    if (empty) {
      empty.querySelector('p').textContent = message;
      empty.style.display = 'flex';
    }
  }

  function calculateUserHours(entries) {
    if (!entries || entries.length === 0) return { totalHours: 0, processedEntries: [] };
    
    const processedEntries = [];
    const { startDate, endDate } = getDateRange();
    
    // Helper to get entry type
    const getEntryType = (entry) => {
      const rawType = entry.type || '';
      return String(rawType).toLowerCase().replace('_', '-');
    };
    
    // Helper to format date from entry
    const formatEntryDate = (entry) => {
      if (!entry.date) return '-';
      const d = new Date(entry.date);
      // Format as MM/DD/YY
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const year = String(d.getUTCFullYear()).slice(-2);
      return `${month}/${day}/${year}`;
    };
    
    // Helper to format time from entry (entry.time is already local time string like "10:24")
    const formatEntryTime = (entry) => {
      if (!entry.time) return '-';
      // Convert 24h time to 12h format
      const [hours, minutes] = entry.time.split(':');
      const h = parseInt(hours, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    };
    
    // Helper to parse time string to hours decimal
    const parseTimeToDecimal = (timeStr) => {
      if (!timeStr) return null;
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours + (minutes / 60);
    };
    
    // Filter entries within date range
    const filteredEntries = entries.filter(entry => {
      if (!entry.date) return false;
      const entryDate = new Date(entry.date);
      return entryDate >= startDate && entryDate <= endDate;
    });

    console.log('[TIMESHEETS] Filtering entries:', entries.length, '->', filteredEntries.length, 'in date range');

    // Sort by date (most recent first), then by time
    const sortedEntries = [...filteredEntries].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB - dateA; // Most recent date first
      }
      // Same date, sort by time (clock_in before clock_out)
      const timeA = a.time || '00:00';
      const timeB = b.time || '00:00';
      return timeA.localeCompare(timeB);
    });

    // Group entries by date to find clock_in/clock_out pairs
    const entriesByDate = {};
    sortedEntries.forEach(entry => {
      const dateKey = entry.date ? new Date(entry.date).toISOString().split('T')[0] : 'unknown';
      if (!entriesByDate[dateKey]) {
        entriesByDate[dateKey] = [];
      }
      entriesByDate[dateKey].push(entry);
    });

    let totalHours = 0;

    // Process each date's entries
    Object.keys(entriesByDate).sort().reverse().forEach(dateKey => {
      const dayEntries = entriesByDate[dateKey];
      const usedIndices = new Set();
      
      dayEntries.forEach((entry, index) => {
        if (usedIndices.has(index)) return;
        
        const type = getEntryType(entry);
        
        // Travel is always 4 hours (use entry.hours if available)
        if (type === 'travel') {
          const travelHours = entry.hours || 4;
          processedEntries.push({
            ...entry,
            type: 'travel',
            hours: travelHours,
            displayDate: formatEntryDate(entry),
            displayTime: '-'
          });
          totalHours += travelHours;
          usedIndices.add(index);
          return;
        }

        // For clock-in entries, find matching clock-out on same day
        if (type === 'clock-in') {
          let hours = null;
          let pairedEntry = null;

          // Look for clock-out on the same day
          for (let j = 0; j < dayEntries.length; j++) {
            if (j === index || usedIndices.has(j)) continue;
            
            const otherEntry = dayEntries[j];
            const otherType = getEntryType(otherEntry);
            
            if (otherType === 'clock-out' && entry.time && otherEntry.time) {
              const clockInDecimal = parseTimeToDecimal(entry.time);
              const clockOutDecimal = parseTimeToDecimal(otherEntry.time);
              
              // Clock out should be after clock in
              if (clockOutDecimal !== null && clockInDecimal !== null && clockOutDecimal > clockInDecimal) {
                hours = Math.round((clockOutDecimal - clockInDecimal) * 100) / 100;
                pairedEntry = { entry: otherEntry, index: j };
                break;
              }
            }
          }

          // Generate a unique pair ID for visual grouping
          const pairId = pairedEntry ? `pair-${index}-${pairedEntry.index}` : null;

          // Add the clock-in entry with hours
          processedEntries.push({
            ...entry,
            type: 'clock-in',
            hours: hours,
            displayDate: formatEntryDate(entry),
            displayTime: formatEntryTime(entry),
            isPaired: !!pairedEntry,
            pairId: pairId,
            pairPosition: pairedEntry ? 'start' : null
          });
          usedIndices.add(index);

          // Add the paired clock-out entry (without hours to avoid double counting)
          if (pairedEntry) {
            processedEntries.push({
              ...pairedEntry.entry,
              type: 'clock-out',
              hours: null, // Hours shown on IN row only
              displayDate: formatEntryDate(pairedEntry.entry),
              displayTime: formatEntryTime(pairedEntry.entry),
              isPaired: true,
              pairId: pairId,
              pairPosition: 'end'
            });
            totalHours += hours;
            usedIndices.add(pairedEntry.index);
          }
          return;
        }

        // For clock-out entries (not yet paired - orphan clock-outs)
        if (type === 'clock-out') {
          processedEntries.push({
            ...entry,
            type: 'clock-out',
            hours: null,
            displayDate: formatEntryDate(entry),
            displayTime: formatEntryTime(entry)
          });
          usedIndices.add(index);
          return;
        }

        // Unknown type
        processedEntries.push({
          ...entry,
          type: type || 'unknown',
          hours: null,
          displayDate: formatEntryDate(entry),
          displayTime: formatEntryTime(entry)
        });
        usedIndices.add(index);
      });
    });

    return { totalHours: Math.round(totalHours * 100) / 100, processedEntries };
  }

  function formatDisplayDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
  }

  function formatDisplayTime(timestamp) {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function renderUsersList() {
    const grid = document.getElementById('usersGrid');
    const empty = document.getElementById('usersEmptyState');
    const count = document.getElementById('userCount');
    const dateRangeEl = document.getElementById('listDateRange');
    
    if (!grid) return;

    // Show current date range
    const { startDate, endDate } = getDateRange();
    if (dateRangeEl) {
      dateRangeEl.textContent = `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
    }

    // Process each user's data
    const usersWithHours = allTimesheetData.map(user => {
      const { totalHours, processedEntries } = calculateUserHours(user.entries);
      return {
        ...user,
        totalHours,
        processedEntries
      };
    }).filter(user => user.processedEntries.length > 0); // Only show users with entries in date range

    console.log('[TIMESHEETS] Filtered users with entries:', usersWithHours.length);

    // Update count
    if (count) {
      count.textContent = `${usersWithHours.length} Member${usersWithHours.length !== 1 ? 's' : ''}`;
    }

    // Show empty state if no users
    if (usersWithHours.length === 0) {
      grid.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      return;
    }

    grid.style.display = 'grid';
    if (empty) empty.style.display = 'none';

    // Sort by total hours descending
    usersWithHours.sort((a, b) => b.totalHours - a.totalHours);

    // Render user cards
    grid.innerHTML = usersWithHours.map(user => {
      const initials = getInitials(user.userName);
      
      return `
        <div class="user-card" onclick="window.showUserDetail('${user.userId}')">
          <div class="user-card-header">
            <div class="user-avatar">${initials}</div>
            <div class="user-info">
              <h3 class="user-name">${escapeHtml(user.userName)}</h3>
              <span class="user-email">${escapeHtml(user.userEmail || '')}</span>
            </div>
          </div>
          <div class="user-card-stats">
            <div class="stat-item">
              <span class="stat-label">Total Hours</span>
              <span class="stat-value">${user.totalHours.toFixed(2)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Entries</span>
              <span class="stat-value entries">${user.processedEntries.length}</span>
            </div>
          </div>
          <button class="btn-view-timesheet">
            <span class="material-symbols-outlined">visibility</span>
            View Timesheet
          </button>
        </div>
      `;
    }).join('');
  }

  function showUserDetail(userId) {
    currentUserId = userId;
    
    const userData = allTimesheetData.find(u => u.userId === userId);
    if (!userData) {
      console.log('[TIMESHEETS] User not found:', userId);
      return;
    }

    const { totalHours, processedEntries } = calculateUserHours(userData.entries);
    console.log('[TIMESHEETS] Showing detail for', userData.userName, '- entries:', processedEntries.length, 'total hours:', totalHours);

    // Update header
    const nameEl = document.getElementById('detailUserName');
    const hoursEl = document.getElementById('detailTotalHours');
    
    if (nameEl) nameEl.textContent = `${userData.userName}'s Timesheet`;
    if (hoursEl) hoursEl.textContent = totalHours.toFixed(2);

    // Show date range in subtitle
    const { startDate, endDate } = getDateRange();
    const rangeLabel = document.getElementById('detailDateRange');
    if (rangeLabel) {
      rangeLabel.textContent = `${formatDisplayDate(startDate)} - ${formatDisplayDate(endDate)}`;
    }

    // Render table
    renderTimesheetTable(processedEntries);

    // Show detail section, hide list
    document.getElementById('usersListSection').style.display = 'none';
    document.getElementById('userDetailSection').style.display = 'block';
  }

  function showUsersList() {
    currentUserId = null;
    document.getElementById('usersListSection').style.display = 'block';
    document.getElementById('userDetailSection').style.display = 'none';
  }

  function renderTimesheetTable(entries) {
    const tbody = document.getElementById('timesheetTableBody');
    const empty = document.getElementById('detailEmptyState');
    
    if (!tbody) return;

    if (!entries || entries.length === 0) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (empty) empty.style.display = 'none';

    tbody.innerHTML = entries.map((entry, index) => {
      const typeClass = getTypeClass(entry.type);
      const typeLabel = getTypeLabel(entry.type);
      const hoursDisplay = entry.hours !== null ? entry.hours.toFixed(2) : '';
      
      // Build row classes for paired styling
      const rowClasses = [];
      if (entry.isPaired) {
        rowClasses.push('paired-row');
        if (entry.pairPosition === 'start') rowClasses.push('pair-start');
        if (entry.pairPosition === 'end') rowClasses.push('pair-end');
      }

      // Serialize entry data for edit/delete (escape for HTML attribute)
      const entryData = encodeURIComponent(JSON.stringify({
        _id: entry._id,
        type: entry.type,
        date: entry.date,
        time: entry.time,
        hours: entry.hours,
        notes: entry.notes
      }));
      
      return `
        <tr class="${rowClasses.join(' ')}" ${entry.pairId ? `data-pair-id="${entry.pairId}"` : ''}>
          <td>
            <span class="entry-type-badge ${typeClass}">${typeLabel}</span>
          </td>
          <td class="date-cell">${escapeHtml(entry.displayDate)}</td>
          <td class="time-cell ${!entry.displayTime || entry.displayTime === '-' ? 'empty' : ''}">${entry.displayTime}</td>
          <td class="hours-cell ${!hoursDisplay ? 'empty' : ''}">${hoursDisplay || ''}</td>
          <td class="notes-cell">${escapeHtml(entry.notes || '')}</td>
          <td class="actions-cell">
            <button class="btn-action edit" onclick="window.openEditModal('${entryData}')" title="Edit">
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button class="btn-action delete" onclick="window.openDeleteModal('${entryData}')" title="Delete">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function getTypeClass(type) {
    const typeStr = (type || '').toLowerCase().replace('_', '-');
    if (typeStr === 'clock-in' || typeStr === 'in' || typeStr === 'clockin') return 'clock-in';
    if (typeStr === 'clock-out' || typeStr === 'out' || typeStr === 'clockout') return 'clock-out';
    if (typeStr === 'travel' || typeStr === 'trv') return 'travel';
    return '';
  }

  function getTypeLabel(type) {
    const typeStr = (type || '').toLowerCase().replace('_', '-');
    if (typeStr === 'clock-in' || typeStr === 'in' || typeStr === 'clockin') return 'IN';
    if (typeStr === 'clock-out' || typeStr === 'out' || typeStr === 'clockout') return 'OUT';
    if (typeStr === 'travel' || typeStr === 'trv') return 'TRV';
    return type || '-';
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(p => p);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== EDIT/DELETE FUNCTIONALITY ====================
  
  let pendingDeleteEntry = null;

  function openEditModal(entryDataEncoded) {
    const entry = JSON.parse(decodeURIComponent(entryDataEncoded));
    console.log('[TIMESHEETS] Opening edit modal for entry:', entry);

    const modal = document.getElementById('editEntryModal');
    const form = document.getElementById('editEntryForm');
    const typeSelect = document.getElementById('editEntryType');
    const dateInput = document.getElementById('editEntryDate');
    const timeInput = document.getElementById('editEntryTime');
    const hoursInput = document.getElementById('editEntryHours');
    const notesInput = document.getElementById('editEntryNotes');
    const timeGroup = document.getElementById('editTimeGroup');
    const hoursGroup = document.getElementById('editHoursGroup');
    const entryIdInput = document.getElementById('editEntryId');
    const userIdInput = document.getElementById('editUserId');

    // Set entry ID and user ID
    entryIdInput.value = entry._id || '';
    userIdInput.value = currentUserId || '';

    // Set type (normalize the type string)
    const normalizedType = normalizeTypeForSelect(entry.type);
    typeSelect.value = normalizedType;
    toggleTimeHoursFields(normalizedType);

    // Set date
    if (entry.date) {
      const d = new Date(entry.date);
      dateInput.value = d.toISOString().split('T')[0];
    } else {
      dateInput.value = '';
    }

    // Set time
    timeInput.value = entry.time || '';

    // Set hours (for travel)
    hoursInput.value = entry.hours || 4;

    // Set notes
    notesInput.value = entry.notes || '';

    // Show modal
    modal.style.display = 'flex';

    // Handle type change
    typeSelect.onchange = () => toggleTimeHoursFields(typeSelect.value);

    // Handle form submit
    form.onsubmit = handleEditSubmit;
  }

  function normalizeTypeForSelect(type) {
    const t = (type || '').toLowerCase().replace('-', '_');
    if (t === 'clock_in' || t === 'clockin' || t === 'in') return 'clock_in';
    if (t === 'clock_out' || t === 'clockout' || t === 'out') return 'clock_out';
    if (t === 'travel' || t === 'trv') return 'travel';
    return 'clock_in';
  }

  function toggleTimeHoursFields(type) {
    const timeGroup = document.getElementById('editTimeGroup');
    const hoursGroup = document.getElementById('editHoursGroup');
    
    if (type === 'travel') {
      timeGroup.style.display = 'none';
      hoursGroup.style.display = 'block';
    } else {
      timeGroup.style.display = 'block';
      hoursGroup.style.display = 'none';
    }
  }

  function closeEditModal() {
    const modal = document.getElementById('editEntryModal');
    modal.style.display = 'none';
  }

  async function handleEditSubmit(e) {
    e.preventDefault();

    const entryId = document.getElementById('editEntryId').value;
    const userId = document.getElementById('editUserId').value;
    const type = document.getElementById('editEntryType').value;
    const date = document.getElementById('editEntryDate').value;
    const time = document.getElementById('editEntryTime').value;
    const hours = parseFloat(document.getElementById('editEntryHours').value) || 4;
    const notes = document.getElementById('editEntryNotes').value;

    console.log('[TIMESHEETS] Submitting edit:', { entryId, userId, type, date, time, hours, notes });

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/timesheets/entry`, {
        method: 'PUT',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          entryId,
          type,
          date,
          time: type === 'travel' ? null : time,
          hours: type === 'travel' ? hours : null,
          notes
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update entry');
      }

      console.log('[TIMESHEETS] Entry updated successfully');
      closeEditModal();
      
      // Reload data and refresh view
      await loadTimesheetData();
      if (currentUserId) {
        showUserDetail(currentUserId);
      }
    } catch (error) {
      console.error('[TIMESHEETS] Error updating entry:', error);
      alert('Failed to update entry: ' + error.message);
    }
  }

  function openDeleteModal(entryDataEncoded) {
    const entry = JSON.parse(decodeURIComponent(entryDataEncoded));
    console.log('[TIMESHEETS] Opening delete modal for entry:', entry);

    pendingDeleteEntry = entry;

    const modal = document.getElementById('deleteEntryModal');
    const preview = document.getElementById('deleteEntryPreview');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    // Show entry preview
    const typeLabel = getTypeLabel(entry.type);
    const dateStr = entry.date ? formatDisplayDate(new Date(entry.date)) : '-';
    const timeStr = entry.time || '-';
    preview.textContent = `${typeLabel} - ${dateStr} at ${timeStr}`;

    // Show modal
    modal.style.display = 'flex';

    // Handle confirm
    confirmBtn.onclick = handleDeleteConfirm;
  }

  function closeDeleteModal() {
    const modal = document.getElementById('deleteEntryModal');
    modal.style.display = 'none';
    pendingDeleteEntry = null;
  }

  async function handleDeleteConfirm() {
    if (!pendingDeleteEntry) return;

    const entryId = pendingDeleteEntry._id;
    const userId = currentUserId;

    console.log('[TIMESHEETS] Deleting entry:', { entryId, userId });

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE}/api/timesheets/entry`, {
        method: 'DELETE',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          entryId
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete entry');
      }

      console.log('[TIMESHEETS] Entry deleted successfully');
      closeDeleteModal();
      
      // Reload data and refresh view
      await loadTimesheetData();
      if (currentUserId) {
        showUserDetail(currentUserId);
      }
    } catch (error) {
      console.error('[TIMESHEETS] Error deleting entry:', error);
      alert('Failed to delete entry: ' + error.message);
    }
  }

  // Expose functions globally
  window.showUserDetail = showUserDetail;
  window.showUsersList = showUsersList;
  window.openEditModal = openEditModal;
  window.closeEditModal = closeEditModal;
  window.openDeleteModal = openDeleteModal;
  window.closeDeleteModal = closeDeleteModal;

})();
