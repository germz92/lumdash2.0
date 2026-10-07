/**
 * Hotel Management
 * Same workflow as Flight Management: request, book, change, and sync
 * booked stays into the event accommodation list.
 */
(function() {
  'use strict';

  const API_BASE = window.API_BASE || '';
  const ROOM_LABELS = {
    any: 'Any',
    king: 'King',
    queen: 'Queen',
    double: 'Double',
    two_beds: 'Two beds',
    suite: 'Suite',
    connecting: 'Connecting rooms'
  };

  let requests = [];
  let bookedStays = [];
  let guests = [];
  let users = [];
  let selectedGuests = [];
  let bookingGuests = [];
  let viewGuests = [];
  let editGuests = [];
  let currentRequest = null;
  let currentChangeStay = null;
  let approvingChangeId = null;
  let approvingCancels = false;
  let pendingView = 'cards';
  let bookedView = 'cards';
  let guestTarget = 'request';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseCost(value) {
    const n = parseFloat(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function debounce(func, wait) {
    let timeout;
    return function executed(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function guardSubmit(handler) {
    let busy = false;
    return async function guarded(e) {
      if (busy) {
        if (e && e.preventDefault) e.preventDefault();
        return;
      }
      busy = true;
      const target = e && e.currentTarget;
      const control = target && target.tagName === 'BUTTON'
        ? target
        : (target && target.querySelector ? target.querySelector('button[type="submit"]') : null);
      if (control) control.disabled = true;
      try {
        return await handler.call(this, e);
      } catch (err) {
        console.error(err);
        alert(err.message || 'Something went wrong. Please try again.');
      } finally {
        busy = false;
        if (control) control.disabled = false;
      }
    };
  }

  function authHeaders() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : ''
    };
  }

  async function apiRequest(endpoint, options = {}) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  function parseStayDate(value) {
    if (!value) return null;
    const raw = String(value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  }

  function formatDateDisplay(value) {
    const date = parseStayDate(value);
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  }

  function formatDateTable(value) {
    const date = parseStayDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateInput(value) {
    const date = parseStayDate(value);
    if (!date) return '';
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
  }

  function formatTime(value) {
    if (!value) return '';
    const [h, m] = String(value).split(':');
    const hour = Number(h);
    if (!Number.isFinite(hour)) return value;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m || '00'} ${suffix}`;
  }

  function roomLabel(value) {
    return ROOM_LABELS[value] || value || 'Any';
  }

  function locationLabel(stay) {
    const city = [stay.city, stay.state].filter(Boolean).join(', ');
    return stay.area ? `${city}${city ? ' · ' : ''}${stay.area}` : city;
  }

  function eventName(stay, fallback = 'Hotel') {
    return stay?.eventId?.title || stay?.eventName || fallback;
  }

  function guestName(person) {
    return person.fullName || `${person.firstName || ''} ${person.lastName || ''}`.trim();
  }

  function nightsBetween(checkIn, checkOut) {
    const a = parseStayDate(checkIn);
    const b = parseStayDate(checkOut);
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  function upcomingCutoff() {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cutoff.setDate(cutoff.getDate() - 1);
    return cutoff;
  }

  async function loadGuests() {
    try {
      guests = await apiRequest('/api/passengers');
    } catch (err) {
      guests = [];
    }
  }

  async function loadUsers() {
    try {
      users = await apiRequest('/api/users');
    } catch (err) {
      users = [];
    }
  }

  async function loadStays() {
    const [pending, booked] = await Promise.all([
      apiRequest('/api/hotels/pending'),
      apiRequest('/api/hotels/booked')
    ]);
    requests = pending;
    bookedStays = booked;
  }

  function fillGuestSelect(select) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Select guest...</option>';
    guests.forEach(person => {
      const option = document.createElement('option');
      option.value = person._id;
      option.textContent = guestName(person);
      select.appendChild(option);
    });
    select.value = current || '';
  }

  function fillAllGuestSelects() {
    ['guestSelect', 'bookingGuestSelect', 'viewGuestSelect', 'editGuestSelect'].forEach(id => {
      fillGuestSelect(document.getElementById(id));
    });
  }

  function fillUserSelect() {
    const select = document.getElementById('newGuestUserId');
    if (!select) return;
    select.innerHTML = '<option value="">No linked user</option>';
    users.forEach(user => {
      const option = document.createElement('option');
      option.value = user._id;
      const name = user.name && user.name.trim() ? user.name : user.fullName;
      option.textContent = name ? `${name} (${user.email})` : user.email;
      select.appendChild(option);
    });
  }

  function renderChips(container, list, onRemove) {
    if (!container) return;
    container.innerHTML = list.map(person => `
      <div class="selected-passenger-chip">
        <span class="material-symbols-outlined">person</span>
        <span>${esc(person.name)}</span>
        <button type="button" class="remove-passenger" data-id="${esc(person.passengerId)}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `).join('');
    container.querySelectorAll('.remove-passenger').forEach(btn => {
      btn.addEventListener('click', () => onRemove(btn.dataset.id));
    });
  }

  function addGuestTo(list, passengerId, rerender) {
    if (!passengerId) return list;
    if (list.some(g => g.passengerId === passengerId)) return list;
    const person = guests.find(g => g._id === passengerId);
    if (!person) return list;
    list.push({ passengerId: person._id, name: guestName(person) });
    rerender();
    return list;
  }

  function bindEventSearch(input, suggestions, onPick) {
    if (!input || !suggestions) return;
    input.addEventListener('input', debounce(async () => {
      delete input.dataset.eventId;
      const value = input.value.trim();
      if (value.length < 2) {
        suggestions.classList.remove('show');
        return;
      }
      try {
        const events = await apiRequest(`/api/hotels/events/search?q=${encodeURIComponent(value)}`);
        if (!events.length) {
          suggestions.classList.remove('show');
          return;
        }
        suggestions.innerHTML = events.map(event => {
          const start = event.general?.startDate ? formatDateDisplay(event.general.startDate) : '';
          const end = event.general?.endDate ? formatDateDisplay(event.general.endDate) : '';
          const range = start && end ? `${start} - ${end}` : start;
          return `
            <div class="suggestion-item" data-event-id="${esc(event._id)}" data-event-name="${esc(event.title)}" data-start="${esc(event.general?.startDate || '')}" data-end="${esc(event.general?.endDate || '')}">
              <span class="event-title">${esc(event.title)}</span>
              <span class="event-date">${esc(range)}</span>
            </div>
          `;
        }).join('');
        suggestions.classList.add('show');
        suggestions.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.eventName;
            input.dataset.eventId = item.dataset.eventId;
            suggestions.classList.remove('show');
            if (onPick) onPick(item.dataset);
          });
        });
      } catch (err) {
        suggestions.classList.remove('show');
      }
    }, 200));
  }

  function applyEventDates(dataset, checkInId, checkOutId) {
    const checkIn = document.getElementById(checkInId);
    const checkOut = document.getElementById(checkOutId);
    if (checkIn && !checkIn.value && dataset.start) checkIn.value = formatDateInput(dataset.start);
    if (checkOut && !checkOut.value && dataset.end) checkOut.value = formatDateInput(dataset.end);
  }

  function filterStays(list, searchEl, filterEl, sortEl, dateField) {
    const search = (searchEl?.value || '').toLowerCase().trim();
    const filter = filterEl?.value || 'upcoming';
    const sort = sortEl?.value || 'soonest';
    const cutoff = upcomingCutoff();
    const filtered = list.filter(stay => {
      if (search) {
        const haystack = [
          eventName(stay, ''),
          stay.city,
          stay.state,
          stay.area,
          stay.preferredHotel,
          stay.bookedDetails?.hotelName,
          stay.bookedDetails?.confirmationCode,
          stay.notes,
          ...(stay.guests || []).map(g => g.name)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (filter !== 'all') {
        const date = parseStayDate(stay[dateField]);
        if (date) {
          date.setHours(0, 0, 0, 0);
          if (filter === 'upcoming' && date < cutoff) return false;
          if (filter === 'past' && date >= cutoff) return false;
        }
      }
      return true;
    });
    filtered.sort((a, b) => {
      const da = parseStayDate(a.checkInDate) || new Date(0);
      const db = parseStayDate(b.checkInDate) || new Date(0);
      return sort === 'latest' ? db - da : da - db;
    });
    return filtered;
  }

  function renderPending() {
    const grid = document.getElementById('pendingRequestsGrid');
    const table = document.getElementById('pendingRequestsTable');
    const empty = document.getElementById('pendingEmptyState');
    const count = document.getElementById('pendingCount');
    if (!grid) return;
    const filtered = filterStays(
      requests,
      document.getElementById('pendingSearch'),
      document.getElementById('pendingFilter'),
      document.getElementById('pendingSort'),
      'checkOutDate'
    );
    grid.innerHTML = '';
    if (!filtered.length) {
      grid.style.display = 'none';
      table.style.display = 'none';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      if (pendingView === 'table') {
        grid.style.display = 'none';
        table.style.display = 'block';
        renderPendingTable(filtered);
      } else {
        grid.style.display = 'grid';
        table.style.display = 'none';
        filtered.forEach(stay => grid.appendChild(pendingCard(stay)));
      }
    }
    const total = requests.length;
    const search = document.getElementById('pendingSearch')?.value;
    const filter = document.getElementById('pendingFilter')?.value;
    count.textContent = (search || filter !== 'all')
      ? `${filtered.length} of ${total} Request${total === 1 ? '' : 's'}`
      : `${total} Request${total === 1 ? '' : 's'}`;
  }

  function renderBooked() {
    const grid = document.getElementById('bookedHotelsGrid');
    const table = document.getElementById('bookedHotelsTable');
    const empty = document.getElementById('bookedEmptyState');
    const count = document.getElementById('bookedCount');
    if (!grid) return;
    const filtered = filterStays(
      bookedStays,
      document.getElementById('bookedSearch'),
      document.getElementById('bookedFilter'),
      document.getElementById('bookedSort'),
      'checkOutDate'
    );
    grid.innerHTML = '';
    if (!filtered.length) {
      grid.style.display = 'none';
      table.style.display = 'none';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      if (bookedView === 'table') {
        grid.style.display = 'none';
        table.style.display = 'block';
        renderBookedTable(filtered);
      } else {
        grid.style.display = 'grid';
        table.style.display = 'none';
        filtered.forEach(stay => grid.appendChild(bookedCard(stay)));
      }
    }
    const total = bookedStays.length;
    count.textContent = `${filtered.length === total ? total : `${filtered.length} of ${total}`} Stay${total === 1 ? '' : 's'}`;
  }

  function guestChips(stay) {
    return (stay.guests || []).map(g => `<span class="table-passenger-chip">${esc(g.name || 'Unknown')}</span>`).join('');
  }

  function pendingCard(stay) {
    const card = document.createElement('div');
    const isChange = stay.status === 'change_requested';
    card.className = `flight-card${isChange ? ' change-request-card' : ''}`;
    const changes = stay.changeDetails?.requestedChanges || {};
    const changed = [];
    if (changes.cancelStay) changed.push('Cancel Stay');
    if (changes.checkInDate) changed.push('Check-In');
    if (changes.checkOutDate) changed.push('Check-Out');
    if (changes.roomPreference) changed.push('Room');
    if (changes.preferredHotel) changed.push('Hotel');
    const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
    card.innerHTML = `
      <div class="flight-card-header">
        <h3 class="flight-event-name">${esc(eventName(stay, 'Hotel Request'))}</h3>
        <div class="flight-card-badges">
          ${isChange ? '<span class="flight-change-badge">Change Request</span>' : ''}
          <span class="flight-type-badge">${esc(roomLabel(stay.roomPreference))}</span>
        </div>
      </div>
      <div class="flight-card-body">
        ${isChange ? `
          <div class="change-request-info">
            <span class="material-symbols-outlined">${changes.cancelStay ? 'block' : 'edit_calendar'}</span>
            <div class="change-request-details">
              <span class="change-request-label">${changes.cancelStay ? 'Cancellation Requested' : 'Changes Requested:'}</span>
              <span class="change-request-fields">${esc(changes.cancelStay ? '' : (changed.join(', ') || 'See details'))}</span>
            </div>
          </div>
          ${stay.changeDetails?.changeReason ? `<div class="change-request-reason"><span class="material-symbols-outlined">comment</span><span>${esc(stay.changeDetails.changeReason)}</span></div>` : ''}
        ` : ''}
        <div class="flight-info-row">
          <div class="flight-dates">
            <div class="flight-date-info"><span class="date-label">Check-In</span><span class="date-value">${esc(formatDateDisplay(stay.checkInDate))}</span></div>
            <div class="flight-date-info"><span class="date-label">Check-Out</span><span class="date-value">${esc(formatDateDisplay(stay.checkOutDate))}</span></div>
          </div>
        </div>
        <div class="flight-info-row">
          <div class="stay-summary">
            <div class="stay-place">
              <span class="stay-city">${esc([stay.city, stay.state].filter(Boolean).join(', ') || 'City TBD')}</span>
              ${stay.area ? `<span class="stay-area">${esc(stay.area)}</span>` : ''}
            </div>
            <div class="stay-side">
              <span class="stay-nights"><span class="material-symbols-outlined">hotel</span>${nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Dates TBD'}</span>
              <span class="stay-hotel">${esc(stay.preferredHotel || 'No hotel preference')}</span>
            </div>
          </div>
        </div>
        <div class="flight-passengers">
          <div class="passengers-label">Guests</div>
          <div class="passenger-list">
            ${(stay.guests || []).map(g => `<div class="passenger-item"><span class="material-symbols-outlined">person</span><span>${esc(g.name)}</span></div>`).join('')}
          </div>
        </div>
        ${stay.notes ? `<div class="flight-notes"><span class="material-symbols-outlined">sticky_note_2</span><span>${esc(stay.notes)}</span></div>` : ''}
      </div>
      <div class="flight-card-footer">
        ${isChange ? `
          <div class="change-request-actions">
            <button class="btn-approve-change" type="button"><span class="material-symbols-outlined">check_circle</span><span>Approve</span></button>
            <button class="btn-reject-change" type="button"><span class="material-symbols-outlined">cancel</span><span>Reject</span></button>
          </div>
        ` : `
          <button class="btn-view-request" type="button"><span>View Request</span><span class="material-symbols-outlined">chevron_right</span></button>
        `}
      </div>
    `;
    if (isChange) {
      card.querySelector('.btn-approve-change')?.addEventListener('click', () => openApprove(stay._id));
      card.querySelector('.btn-reject-change')?.addEventListener('click', () => rejectChange(stay._id));
    } else {
      card.querySelector('.btn-view-request')?.addEventListener('click', () => openView(stay));
    }
    return card;
  }

  function bookedCard(stay) {
    const card = document.createElement('div');
    const cancelled = stay.status === 'cancelled';
    const details = stay.bookedDetails || {};
    card.className = `booked-flight-card${cancelled ? ' cancelled' : ''}`;
    const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
    const cost = parseCost(stay.cost);
    card.innerHTML = `
      <div class="booked-flight-header">
        <span class="booked-event-name">${esc(eventName(stay))}</span>
        <div class="booked-menu-wrapper">
          <button class="booked-menu-btn" type="button" title="More options"><span class="material-symbols-outlined">more_vert</span></button>
          <div class="booked-menu-dropdown">
            ${cancelled ? `
              <button class="booked-menu-item restore" type="button" data-action="restore"><span class="material-symbols-outlined">undo</span><span>Restore Stay</span></button>
            ` : `
              <button class="booked-menu-item" type="button" data-action="request-change"><span class="material-symbols-outlined">edit_calendar</span><span>Request Change</span></button>
              <button class="booked-menu-item" type="button" data-action="edit"><span class="material-symbols-outlined">edit</span><span>Edit</span></button>
              <button class="booked-menu-item cancel-flight" type="button" data-action="cancel"><span class="material-symbols-outlined">block</span><span>Mark as Cancelled</span></button>
            `}
            <button class="booked-menu-item delete" type="button" data-action="delete"><span class="material-symbols-outlined">delete</span><span>Delete</span></button>
          </div>
        </div>
      </div>
      <div class="booked-flight-subheader">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="flight-direction-badge outbound">${nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Stay'}</span>
          ${cancelled ? '<span class="flight-cancelled-badge">Cancelled</span>' : ''}
        </div>
        <div class="confirmation-code">
          <strong>${esc(details.confirmationCode || 'N/A')}</strong>
          ${details.confirmationCode ? `<button class="copy-btn" type="button" title="Copy confirmation"><span class="material-symbols-outlined">content_copy</span></button>` : ''}
        </div>
      </div>
      <div class="booked-flight-body">
        <div class="booked-flight-info-row">
          <div class="booked-airline">${esc(details.hotelName || stay.preferredHotel || 'Hotel')}</div>
          <div class="booked-date"><span class="material-symbols-outlined">calendar_today</span><span>${esc(formatDateDisplay(stay.checkInDate))} – ${esc(formatDateDisplay(stay.checkOutDate))}</span></div>
        </div>
        <div class="stay-summary">
          <div class="stay-place">
            <span class="stay-city">${esc(stay.city || 'City TBD')}</span>
            <span class="stay-area">${esc(details.address || [stay.state, stay.area].filter(Boolean).join(' · '))}</span>
          </div>
          <div class="stay-side">
            <span class="stay-nights">${esc(details.roomType || roomLabel(stay.roomPreference))}</span>
            <span class="stay-hotel">${details.numberOfRooms ? `${details.numberOfRooms} room${details.numberOfRooms === 1 ? '' : 's'}` : ''}${details.checkInTime || details.checkOutTime ? ` · ${esc(formatTime(details.checkInTime) || 'Check-in')} – ${esc(formatTime(details.checkOutTime) || 'Check-out')}` : ''}</span>
          </div>
        </div>
        <div class="flight-passengers">
          <div class="passengers-label">Guests</div>
          <div class="passenger-list">${(stay.guests || []).map(g => `<div class="passenger-item"><span class="material-symbols-outlined">person</span><span>${esc(g.name)}</span></div>`).join('')}</div>
        </div>
        ${cost > 0 ? `<div class="booked-flight-notes"><span class="material-symbols-outlined">payments</span><span>$${cost.toFixed(2)}</span></div>` : ''}
        ${stay.notes ? `<div class="booked-flight-notes"><span class="material-symbols-outlined">sticky_note_2</span><span>${esc(stay.notes)}</span></div>` : ''}
      </div>
    `;
    card.querySelector('.copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(details.confirmationCode || '');
    });
    const menu = card.querySelector('.booked-menu-dropdown');
    card.querySelector('.booked-menu-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.booked-menu-dropdown.show').forEach(open => {
        if (open !== menu) open.classList.remove('show');
      });
      menu.classList.toggle('show');
    });
    menu?.querySelectorAll('.booked-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.remove('show');
        const action = item.dataset.action;
        if (action === 'request-change') openChange(stay);
        else if (action === 'edit') openEdit(stay);
        else if (action === 'cancel') cancelStay(stay);
        else if (action === 'restore') restoreStay(stay);
        else if (action === 'delete') deleteStay(stay);
      });
    });
    return card;
  }

  function renderPendingTable(list) {
    document.getElementById('pendingRequestsTable').innerHTML = `
      <table class="flights-table">
        <thead><tr>
          <th>Type</th><th>Guests</th><th>Check-In</th><th>Check-Out</th><th>City</th><th>Room</th><th>Preferred Hotel</th><th>Event</th>
        </tr></thead>
        <tbody>
          ${list.map(stay => `
            <tr class="${stay.status === 'change_requested' ? 'change-request-row' : ''}" data-id="${esc(stay._id)}">
              <td>${stay.status === 'change_requested' ? '<span class="table-change-badge">Change</span>' : '<span class="table-pending-badge">New</span>'}</td>
              <td><div class="table-passengers">${guestChips(stay)}</div></td>
              <td class="table-date">${esc(formatDateTable(stay.checkInDate))}</td>
              <td class="table-date">${esc(formatDateTable(stay.checkOutDate))}</td>
              <td>${esc(locationLabel(stay))}</td>
              <td>${esc(roomLabel(stay.roomPreference))}</td>
              <td>${esc(stay.preferredHotel || '—')}</td>
              <td class="table-event">${esc(eventName(stay, ''))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.querySelectorAll('#pendingRequestsTable tbody tr').forEach(row => {
      row.addEventListener('click', () => {
        const stay = requests.find(item => item._id === row.dataset.id);
        if (!stay) return;
        if (stay.status === 'change_requested') openApprove(stay._id);
        else openView(stay);
      });
    });
  }

  function renderBookedTable(list) {
    document.getElementById('bookedHotelsTable').innerHTML = `
      <table class="flights-table">
        <thead><tr>
          <th>Guests</th><th>Check-In</th><th>Check-Out</th><th>Hotel</th><th>City</th><th>Confirmation</th><th>Event</th>
        </tr></thead>
        <tbody>
          ${list.map(stay => `
            <tr data-id="${esc(stay._id)}">
              <td><div class="table-passengers">${guestChips(stay)}</div></td>
              <td class="table-date">${esc(formatDateTable(stay.checkInDate))}</td>
              <td class="table-date">${esc(formatDateTable(stay.checkOutDate))}</td>
              <td>${esc(stay.bookedDetails?.hotelName || stay.preferredHotel || '—')}</td>
              <td>${esc(locationLabel(stay))}</td>
              <td class="table-confirmation">${esc(stay.bookedDetails?.confirmationCode || '—')}</td>
              <td class="table-event">${esc(eventName(stay, ''))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.querySelectorAll('#bookedHotelsTable tbody tr').forEach(row => {
      row.addEventListener('click', () => {
        const stay = bookedStays.find(item => item._id === row.dataset.id);
        if (stay) openEdit(stay);
      });
    });
  }

  function showModal(id) { document.getElementById(id)?.classList.add('show'); }
  function hideModal(id) { document.getElementById(id)?.classList.remove('show'); }

  function openCreate() {
    selectedGuests = [];
    renderRequestGuests();
    document.getElementById('createRequestForm')?.reset();
    const eventInput = document.getElementById('eventName');
    if (eventInput) delete eventInput.dataset.eventId;
    showModal('createRequestModal');
  }

  function renderRequestGuests() {
    renderChips(document.getElementById('selectedGuests'), selectedGuests, (id) => {
      selectedGuests = selectedGuests.filter(g => g.passengerId !== id);
      renderRequestGuests();
    });
  }

  async function submitRequest(e) {
    e.preventDefault();
    const eventInput = document.getElementById('eventName');
    const payload = {
      eventName: eventInput.value || 'Hotel Request',
      eventId: eventInput.dataset.eventId || null,
      city: document.getElementById('requestCity').value.trim(),
      state: document.getElementById('requestState').value.trim(),
      area: document.getElementById('requestArea').value.trim(),
      preferredHotel: document.getElementById('requestPreferredHotel').value.trim(),
      checkInDate: document.getElementById('requestCheckIn').value,
      checkOutDate: document.getElementById('requestCheckOut').value,
      roomPreference: document.getElementById('requestRoomPreference').value,
      guests: selectedGuests,
      notes: document.getElementById('createNotes').value.trim(),
      status: 'pending'
    };
    if (!payload.city || !payload.checkInDate || !payload.checkOutDate) {
      alert('City, check-in, and check-out are required.');
      return;
    }
    if (!payload.guests.length) {
      alert('Add at least one guest.');
      return;
    }
    const created = await apiRequest('/api/hotels', { method: 'POST', body: JSON.stringify(payload) });
    requests.unshift(created);
    renderPending();
    hideModal('createRequestModal');
  }

  function openBooking() {
    bookingGuests = [];
    renderBookingGuests();
    document.getElementById('createBookingForm')?.reset();
    delete document.getElementById('bookingEventName').dataset.eventId;
    showModal('createBookingModal');
  }

  function renderBookingGuests() {
    renderChips(document.getElementById('bookingSelectedGuests'), bookingGuests, (id) => {
      bookingGuests = bookingGuests.filter(g => g.passengerId !== id);
      renderBookingGuests();
    });
  }

  async function submitBooking(e) {
    e.preventDefault();
    const eventInput = document.getElementById('bookingEventName');
    if (!bookingGuests.length) {
      alert('Add at least one guest.');
      return;
    }
    const payload = {
      eventName: eventInput.value || 'Hotel',
      eventId: eventInput.dataset.eventId || null,
      city: document.getElementById('bookingCity').value.trim(),
      state: document.getElementById('bookingState').value.trim(),
      preferredHotel: document.getElementById('bookingHotelName').value.trim(),
      checkInDate: document.getElementById('bookingCheckIn').value,
      checkOutDate: document.getElementById('bookingCheckOut').value,
      guests: bookingGuests,
      notes: document.getElementById('bookingNotes').value.trim(),
      cost: parseCost(document.getElementById('bookingCost').value),
      status: 'booked',
      bookedDetails: {
        hotelName: document.getElementById('bookingHotelName').value.trim(),
        confirmationCode: document.getElementById('bookingConfirmationNumber').value.trim(),
        address: document.getElementById('bookingAddress').value.trim(),
        roomType: document.getElementById('bookingRoomType').value.trim(),
        checkInTime: document.getElementById('bookingCheckInTime').value,
        checkOutTime: document.getElementById('bookingCheckOutTime').value,
        numberOfRooms: Number(document.getElementById('bookingRooms').value) || 1
      }
    };
    const created = await apiRequest('/api/hotels', { method: 'POST', body: JSON.stringify(payload) });
    bookedStays.unshift(created);
    renderBooked();
    hideModal('createBookingModal');
  }

  function setEventField(input, stay) {
    const title = stay.eventId?.title || stay.eventName || '';
    const id = stay.eventId?._id || (typeof stay.eventId === 'string' ? stay.eventId : '');
    input.value = title;
    if (id) input.dataset.eventId = id;
    else delete input.dataset.eventId;
  }

  function openView(stay) {
    currentRequest = stay;
    viewGuests = (stay.guests || []).map(g => ({ passengerId: g.passengerId, name: g.name }));
    setEventField(document.getElementById('viewEventName'), stay);
    document.getElementById('viewCity').value = stay.city || '';
    document.getElementById('viewState').value = stay.state || '';
    document.getElementById('viewArea').value = stay.area || '';
    document.getElementById('viewPreferredHotel').value = stay.preferredHotel || '';
    document.getElementById('viewCheckIn').value = formatDateInput(stay.checkInDate);
    document.getElementById('viewCheckOut').value = formatDateInput(stay.checkOutDate);
    document.getElementById('viewRoomPreference').value = stay.roomPreference || 'any';
    document.getElementById('viewNotes').value = stay.notes || '';
    renderViewGuests();
    const meta = document.getElementById('viewRequestCreatedBy');
    if (stay.createdBy) {
      const name = stay.createdBy.fullName || stay.createdBy.email || 'Unknown';
      meta.innerHTML = `<span class="material-symbols-outlined">person_edit</span><span>Created by <strong>${esc(name)}</strong></span>`;
      meta.style.display = 'flex';
    } else {
      meta.style.display = 'none';
    }
    document.getElementById('bookingSection').style.display = 'none';
    showModal('viewRequestModal');
  }

  function renderViewGuests() {
    renderChips(document.getElementById('viewSelectedGuests'), viewGuests, (id) => {
      viewGuests = viewGuests.filter(g => g.passengerId !== id);
      renderViewGuests();
    });
  }

  async function saveView(e) {
    e.preventDefault();
    if (!currentRequest) return;
    const updated = await apiRequest(`/api/hotels/${currentRequest._id}`, {
      method: 'PUT',
      body: JSON.stringify(viewPayload())
    });
    const index = requests.findIndex(item => item._id === updated._id);
    if (index !== -1) requests[index] = updated;
    renderPending();
    hideModal('viewRequestModal');
  }

  function showBookingSection() {
    const preferred = document.getElementById('viewPreferredHotel').value;
    document.getElementById('confirmHotelName').value = preferred || '';
    document.getElementById('confirmConfirmation').value = '';
    document.getElementById('confirmAddress').value = '';
    document.getElementById('confirmRoomType').value = '';
    document.getElementById('confirmRooms').value = '1';
    document.getElementById('confirmCheckInTime').value = '';
    document.getElementById('confirmCheckOutTime').value = '';
    document.getElementById('confirmCost').value = '';
    document.getElementById('bookingSection').style.display = 'block';
    document.querySelector('#viewRequestModal .modal-footer-actions')?.classList.add('hidden');
  }

  function hideBookingSection() {
    document.getElementById('bookingSection').style.display = 'none';
    document.querySelector('#viewRequestModal .modal-footer-actions')?.classList.remove('hidden');
  }

  function viewPayload() {
    const eventInput = document.getElementById('viewEventName');
    return {
      eventName: eventInput.value,
      eventId: eventInput.dataset.eventId || null,
      city: document.getElementById('viewCity').value.trim(),
      state: document.getElementById('viewState').value.trim(),
      area: document.getElementById('viewArea').value.trim(),
      preferredHotel: document.getElementById('viewPreferredHotel').value.trim(),
      checkInDate: document.getElementById('viewCheckIn').value,
      checkOutDate: document.getElementById('viewCheckOut').value,
      roomPreference: document.getElementById('viewRoomPreference').value,
      guests: viewGuests,
      notes: document.getElementById('viewNotes').value.trim()
    };
  }

  async function confirmBooking() {
    if (!currentRequest) return;
    const confirmation = document.getElementById('confirmConfirmation').value.trim();
    const hotelName = document.getElementById('confirmHotelName').value.trim();
    if (!confirmation || !hotelName) {
      alert('Hotel name and confirmation number are required.');
      return;
    }
    await apiRequest(`/api/hotels/${currentRequest._id}`, {
      method: 'PUT',
      body: JSON.stringify(viewPayload())
    });
    const guestsOnRequest = viewGuests.length ? viewGuests : (currentRequest.guests || []);
    const booked = await apiRequest(`/api/hotels/${currentRequest._id}/book`, {
      method: 'PATCH',
      body: JSON.stringify({
        cost: parseCost(document.getElementById('confirmCost').value),
        bookedDetails: {
          hotelName,
          confirmationCode: confirmation,
          address: document.getElementById('confirmAddress').value.trim(),
          roomType: document.getElementById('confirmRoomType').value.trim(),
          checkInTime: document.getElementById('confirmCheckInTime').value,
          checkOutTime: document.getElementById('confirmCheckOutTime').value,
          numberOfRooms: Number(document.getElementById('confirmRooms').value) || 1
        }
      })
    });
    requests = requests.filter(item => item._id !== currentRequest._id);
    bookedStays.unshift(booked);
    renderPending();
    renderBooked();
    hideModal('viewRequestModal');
    showConfirmed(guestsOnRequest);
  }

  function showConfirmed(stayGuests) {
    const list = document.getElementById('guestEmailsList');
    const empty = document.getElementById('noEmailsMessage');
    const emails = [];
    (stayGuests || []).forEach(guest => {
      const person = guests.find(item => item._id === guest.passengerId) || {};
      const email = person.email || person.userId?.email || users.find(u => u._id === person.userId)?.email;
      if (email && !emails.some(row => row.email === email)) {
        emails.push({ name: guest.name || guestName(person), email });
      }
    });
    if (emails.length) {
      list.innerHTML = emails.map(row => `
        <div class="email-row">
          <div class="email-info">
            <span class="passenger-name">${esc(row.name)}</span>
            <span class="passenger-email">${esc(row.email)}</span>
          </div>
          <button class="btn-copy-email" type="button" data-email="${esc(row.email)}"><span class="material-symbols-outlined">content_copy</span></button>
        </div>
      `).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
      list.querySelectorAll('.btn-copy-email').forEach(btn => {
        btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.email));
      });
    } else {
      list.style.display = 'none';
      empty.style.display = 'flex';
    }
    showModal('bookingConfirmedModal');
  }

  async function deleteRequest() {
    if (!currentRequest || !confirm('Delete this hotel request?')) return;
    await apiRequest(`/api/hotels/${currentRequest._id}`, { method: 'DELETE' });
    requests = requests.filter(item => item._id !== currentRequest._id);
    renderPending();
    hideModal('viewRequestModal');
  }

  function openEdit(stay) {
    currentRequest = stay;
    editGuests = (stay.guests || []).map(g => ({ passengerId: g.passengerId, name: g.name }));
    const details = stay.bookedDetails || {};
    setEventField(document.getElementById('editBookedEventName'), stay);
    document.getElementById('editCity').value = stay.city || '';
    document.getElementById('editState').value = stay.state || '';
    document.getElementById('editHotelName').value = details.hotelName || '';
    document.getElementById('editConfirmation').value = details.confirmationCode || '';
    document.getElementById('editAddress').value = details.address || '';
    document.getElementById('editCheckIn').value = formatDateInput(stay.checkInDate);
    document.getElementById('editCheckOut').value = formatDateInput(stay.checkOutDate);
    document.getElementById('editCheckInTime').value = details.checkInTime || '';
    document.getElementById('editCheckOutTime').value = details.checkOutTime || '';
    document.getElementById('editRoomType').value = details.roomType || '';
    document.getElementById('editRooms').value = details.numberOfRooms || 1;
    document.getElementById('editCost').value = parseCost(stay.cost) > 0 ? parseCost(stay.cost).toFixed(2) : '';
    document.getElementById('editNotes').value = stay.notes || '';
    const meta = document.getElementById('editBookedByInfo');
    if (details.bookedBy) {
      meta.innerHTML = `<span class="material-symbols-outlined">check_circle</span><span>Booked by <strong>${esc(details.bookedBy.fullName || details.bookedBy.email || 'Unknown')}</strong></span>`;
      meta.style.display = 'flex';
    } else meta.style.display = 'none';
    renderEditGuests();
    showModal('editBookedModal');
  }

  function renderEditGuests() {
    renderChips(document.getElementById('editSelectedGuests'), editGuests, (id) => {
      editGuests = editGuests.filter(g => g.passengerId !== id);
      renderEditGuests();
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!currentRequest) return;
    const eventInput = document.getElementById('editBookedEventName');
    const priorDetails = { ...(currentRequest.bookedDetails || {}) };
    const bookedById = priorDetails.bookedBy?._id || priorDetails.bookedBy;
    delete priorDetails.bookedBy;
    delete priorDetails.bookedAt;
    if (bookedById) priorDetails.bookedBy = bookedById;
    const updated = await apiRequest(`/api/hotels/${currentRequest._id}`, {
      method: 'PUT',
      body: JSON.stringify({
        eventName: eventInput.value,
        eventId: eventInput.dataset.eventId || null,
        city: document.getElementById('editCity').value.trim(),
        state: document.getElementById('editState').value.trim(),
        preferredHotel: document.getElementById('editHotelName').value.trim(),
        checkInDate: document.getElementById('editCheckIn').value,
        checkOutDate: document.getElementById('editCheckOut').value,
        guests: editGuests,
        notes: document.getElementById('editNotes').value.trim(),
        cost: parseCost(document.getElementById('editCost').value),
        bookedDetails: {
          ...priorDetails,
          hotelName: document.getElementById('editHotelName').value.trim(),
          confirmationCode: document.getElementById('editConfirmation').value.trim(),
          address: document.getElementById('editAddress').value.trim(),
          roomType: document.getElementById('editRoomType').value.trim(),
          checkInTime: document.getElementById('editCheckInTime').value,
          checkOutTime: document.getElementById('editCheckOutTime').value,
          numberOfRooms: Number(document.getElementById('editRooms').value) || 1
        }
      })
    });
    const index = bookedStays.findIndex(item => item._id === updated._id);
    if (index !== -1) bookedStays[index] = updated;
    renderBooked();
    hideModal('editBookedModal');
  }

  async function cancelStay(stay) {
    if (!confirm(`Mark this stay as cancelled?\n\n${eventName(stay)}\n${stay.bookedDetails?.confirmationCode || ''}`)) return;
    await apiRequest(`/api/hotels/${stay._id}/cancel`, { method: 'PATCH' });
    const index = bookedStays.findIndex(item => item._id === stay._id);
    if (index !== -1) bookedStays[index] = { ...bookedStays[index], status: 'cancelled' };
    renderBooked();
  }

  async function restoreStay(stay) {
    const updated = await apiRequest(`/api/hotels/${stay._id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'booked' })
    });
    const index = bookedStays.findIndex(item => item._id === stay._id);
    if (index !== -1) bookedStays[index] = updated;
    renderBooked();
  }

  async function deleteStay(stay) {
    if (!confirm('Delete this booked stay? It will be removed from the event accommodations.')) return;
    await apiRequest(`/api/hotels/${stay._id}`, { method: 'DELETE' });
    bookedStays = bookedStays.filter(item => item._id !== stay._id);
    renderBooked();
    hideModal('editBookedModal');
  }

  function openChange(stay) {
    currentChangeStay = stay;
    const details = stay.bookedDetails || {};
    document.getElementById('changeCurrentSummary').innerHTML = `
      <div class="change-summary-row">
        <div class="change-summary-route"><span class="change-summary-code">${esc(details.hotelName || stay.city || 'Hotel')}</span></div>
        <span class="change-summary-event">${esc(eventName(stay, ''))}</span>
      </div>
      <div class="change-summary-details">
        <div class="change-summary-item"><span class="change-summary-label">Dates</span><span class="change-summary-value">${esc(formatDateDisplay(stay.checkInDate))} – ${esc(formatDateDisplay(stay.checkOutDate))}</span></div>
        <div class="change-summary-item"><span class="change-summary-label">Confirmation</span><span class="change-summary-value">${esc(details.confirmationCode || 'N/A')}</span></div>
        <div class="change-summary-item"><span class="change-summary-label">Guests</span><span class="change-summary-value">${esc((stay.guests || []).map(g => g.name).join(', '))}</span></div>
      </div>
    `;
    document.getElementById('requestChangeForm')?.reset();
    ['changeCheckInGroup', 'changeCheckOutGroup', 'changeRoomGroup', 'changeHotelGroup'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    showModal('requestChangeModal');
  }

  function toggleChangeField(e) {
    const map = {
      checkInDate: 'changeCheckInGroup',
      checkOutDate: 'changeCheckOutGroup',
      roomPreference: 'changeRoomGroup',
      preferredHotel: 'changeHotelGroup'
    };
    const group = map[e.target.value];
    if (group) document.getElementById(group).style.display = e.target.checked ? 'block' : 'none';
  }

  async function submitChange(e) {
    e.preventDefault();
    if (!currentChangeStay) return;
    const checked = [...document.querySelectorAll('#requestChangeForm input[name="changeField"]:checked')].map(el => el.value);
    if (!checked.length) {
      alert('Choose what needs to change.');
      return;
    }
    const requestedChanges = { cancelStay: checked.includes('cancelStay') };
    if (checked.includes('checkInDate')) requestedChanges.checkInDate = document.getElementById('changeCheckIn').value || null;
    if (checked.includes('checkOutDate')) requestedChanges.checkOutDate = document.getElementById('changeCheckOut').value || null;
    if (checked.includes('roomPreference')) requestedChanges.roomPreference = document.getElementById('changeRoomPreference').value;
    if (checked.includes('preferredHotel')) requestedChanges.preferredHotel = document.getElementById('changePreferredHotel').value.trim();
    const created = await apiRequest(`/api/hotels/${currentChangeStay._id}/request-change`, {
      method: 'POST',
      body: JSON.stringify({
        changeReason: document.getElementById('changeReason').value.trim(),
        requestedChanges
      })
    });
    requests.unshift(created);
    renderPending();
    hideModal('requestChangeModal');
  }

  function openApprove(id) {
    const change = requests.find(item => item._id === id);
    if (!change) return;
    approvingChangeId = id;
    const changes = change.changeDetails?.requestedChanges || {};
    approvingCancels = !!changes.cancelStay;
    const originalId = change.changeDetails?.originalHotelId?._id || change.changeDetails?.originalHotelId;
    const original = bookedStays.find(item => item._id === originalId);
    const details = original?.bookedDetails || {};
    const lines = [];
    if (changes.cancelStay) lines.push('Cancel this stay');
    if (changes.checkInDate) lines.push(`Check-in → ${formatDateDisplay(change.checkInDate)}`);
    if (changes.checkOutDate) lines.push(`Check-out → ${formatDateDisplay(change.checkOutDate)}`);
    if (changes.roomPreference) lines.push(`Room → ${roomLabel(change.roomPreference)}`);
    if (changes.preferredHotel) lines.push(`Hotel → ${change.preferredHotel}`);
    document.getElementById('approveChangeSummary').innerHTML = `
      <div class="approve-change-header">
        <div class="approve-route"><span class="approve-route-code">${esc(details.hotelName || change.city || 'Hotel')}</span></div>
        <span class="approve-event">${esc(eventName(change))}</span>
      </div>
      <div class="approve-changes-list">
        ${lines.map(line => `<div class="approve-change-item"><span class="material-symbols-outlined">arrow_right</span><span>${esc(line)}</span></div>`).join('')}
        ${change.changeDetails?.changeReason ? `<div class="approve-change-reason"><span class="material-symbols-outlined">comment</span><span>${esc(change.changeDetails.changeReason)}</span></div>` : ''}
      </div>
    `;
    document.getElementById('approveBookingFields').style.display = approvingCancels ? 'none' : 'block';
    document.getElementById('approveHotelName').value = details.hotelName || '';
    document.getElementById('approveConfirmation').value = details.confirmationCode || '';
    document.getElementById('approveAddress').value = details.address || '';
    document.getElementById('approveRoomType').value = details.roomType || '';
    document.getElementById('approveRooms').value = details.numberOfRooms || 1;
    document.getElementById('approveCheckInTime').value = details.checkInTime || '';
    document.getElementById('approveCheckOutTime').value = details.checkOutTime || '';
    document.getElementById('approveCost').value = parseCost(original?.cost) > 0 ? parseCost(original.cost).toFixed(2) : '';
    showModal('approveChangeModal');
  }

  async function confirmApprove(e) {
    e.preventDefault();
    if (!approvingChangeId) return;
    const body = approvingCancels
      ? { cancelStay: true }
      : {
          cost: parseCost(document.getElementById('approveCost').value),
          updatedBookedDetails: {
            hotelName: document.getElementById('approveHotelName').value.trim(),
            confirmationCode: document.getElementById('approveConfirmation').value.trim(),
            address: document.getElementById('approveAddress').value.trim(),
            roomType: document.getElementById('approveRoomType').value.trim(),
            checkInTime: document.getElementById('approveCheckInTime').value,
            checkOutTime: document.getElementById('approveCheckOutTime').value,
            numberOfRooms: Number(document.getElementById('approveRooms').value) || 1
          }
        };
    const updated = await apiRequest(`/api/hotels/${approvingChangeId}/approve-change`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
    requests = requests.filter(item => item._id !== approvingChangeId);
    if (updated && updated._id) {
      const index = bookedStays.findIndex(item => item._id === updated._id);
      if (index !== -1) bookedStays[index] = updated;
    }
    renderPending();
    renderBooked();
    hideModal('approveChangeModal');
    approvingChangeId = null;
  }

  async function rejectChange(id) {
    if (!confirm('Reject this change request? It will be removed.')) return;
    await apiRequest(`/api/hotels/${id}/reject-change`, { method: 'PATCH' });
    requests = requests.filter(item => item._id !== id);
    renderPending();
  }

  function openAddGuest(target) {
    guestTarget = target;
    document.getElementById('addGuestForm')?.reset();
    showModal('addGuestModal');
  }

  async function submitGuest(e) {
    e.preventDefault();
    const created = await apiRequest('/api/passengers', {
      method: 'POST',
      body: JSON.stringify({
        firstName: document.getElementById('newGuestFirst').value.trim(),
        lastName: document.getElementById('newGuestLast').value.trim(),
        userId: document.getElementById('newGuestUserId').value || null
      })
    });
    guests.push(created);
    fillAllGuestSelects();
    const entry = { passengerId: created._id, name: guestName(created) };
    if (guestTarget === 'booking') {
      bookingGuests.push(entry);
      renderBookingGuests();
    } else if (guestTarget === 'edit') {
      editGuests.push(entry);
      renderEditGuests();
    } else if (guestTarget === 'view') {
      viewGuests.push(entry);
      renderViewGuests();
    } else if (guestTarget !== 'manage') {
      selectedGuests.push(entry);
      renderRequestGuests();
    }
    hideModal('addGuestModal');
    if (guestTarget === 'manage') renderGuestTable(guests);
  }

  function renderGuestTable(list) {
    const body = document.getElementById('guestsTableBody');
    const empty = document.getElementById('guestsEmptyState');
    if (!list.length) {
      body.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    body.innerHTML = list.map(person => {
      const linked = person.userId && typeof person.userId === 'object'
        ? (person.userId.fullName || person.userId.email)
        : (users.find(u => u._id === person.userId)?.email || '');
      return `
        <tr>
          <td>${esc(guestName(person))}</td>
          <td>${esc(linked || '—')}</td>
          <td><button type="button" class="btn-delete-passenger" data-id="${esc(person._id)}">Remove</button></td>
        </tr>
      `;
    }).join('');
    body.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this guest from the directory?')) return;
        await apiRequest(`/api/passengers/${btn.dataset.id}`, { method: 'DELETE' });
        guests = guests.filter(person => person._id !== btn.dataset.id);
        fillAllGuestSelects();
        renderGuestTable(filteredGuests());
      });
    });
  }

  function filteredGuests() {
    const q = (document.getElementById('guestSearchInput')?.value || '').toLowerCase().trim();
    if (!q) return guests;
    return guests.filter(person => guestName(person).toLowerCase().includes(q));
  }

  function openDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const hotelId = params.get('hotelId');
    const eventId = params.get('eventId');
    if (hotelId) {
      const pending = requests.find(item => item._id === hotelId);
      const booked = bookedStays.find(item => item._id === hotelId);
      if (pending && pending.status !== 'change_requested') openView(pending);
      else if (pending) openApprove(pending._id);
      else if (booked) openEdit(booked);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (eventId) {
      const matches = requests.filter(item => String(item.eventId?._id || item.eventId || '') === String(eventId));
      if (matches.length === 1 && matches[0].status !== 'change_requested') openView(matches[0]);
      else if (matches.length) {
        const search = document.getElementById('pendingSearch');
        search.value = eventName(matches[0], '');
        renderPending();
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  function setup() {
    document.getElementById('createRequestBtn')?.addEventListener('click', openCreate);
    document.getElementById('closeCreateModal')?.addEventListener('click', () => hideModal('createRequestModal'));
    document.getElementById('createRequestForm')?.addEventListener('submit', guardSubmit(submitRequest));
    document.getElementById('guestSelect')?.addEventListener('change', (e) => {
      addGuestTo(selectedGuests, e.target.value, renderRequestGuests);
      e.target.value = '';
    });
    document.getElementById('addGuestBtn')?.addEventListener('click', () => openAddGuest('request'));

    document.getElementById('createBookingBtn')?.addEventListener('click', openBooking);
    document.getElementById('closeCreateBookingModal')?.addEventListener('click', () => hideModal('createBookingModal'));
    document.getElementById('cancelCreateBookingBtn')?.addEventListener('click', () => hideModal('createBookingModal'));
    document.getElementById('createBookingForm')?.addEventListener('submit', guardSubmit(submitBooking));
    document.getElementById('bookingGuestSelect')?.addEventListener('change', (e) => {
      addGuestTo(bookingGuests, e.target.value, renderBookingGuests);
      e.target.value = '';
    });
    document.getElementById('bookingAddGuestBtn')?.addEventListener('click', () => openAddGuest('booking'));

    document.getElementById('closeViewModal')?.addEventListener('click', () => hideModal('viewRequestModal'));
    document.getElementById('cancelViewBtn')?.addEventListener('click', () => hideModal('viewRequestModal'));
    document.getElementById('viewRequestForm')?.addEventListener('submit', guardSubmit(saveView));
    document.getElementById('viewGuestSelect')?.addEventListener('change', (e) => {
      addGuestTo(viewGuests, e.target.value, renderViewGuests);
      e.target.value = '';
    });
    document.getElementById('bookStayBtn')?.addEventListener('click', showBookingSection);
    document.getElementById('closeBookingSection')?.addEventListener('click', hideBookingSection);
    document.getElementById('cancelBookingBtn')?.addEventListener('click', hideBookingSection);
    document.getElementById('confirmBookingBtn')?.addEventListener('click', guardSubmit(confirmBooking));
    document.getElementById('deleteRequestBtn')?.addEventListener('click', guardSubmit(deleteRequest));

    document.getElementById('closeEditBookedModal')?.addEventListener('click', () => hideModal('editBookedModal'));
    document.getElementById('cancelEditBookedBtn')?.addEventListener('click', () => hideModal('editBookedModal'));
    document.getElementById('editBookedForm')?.addEventListener('submit', guardSubmit(saveEdit));
    document.getElementById('editGuestSelect')?.addEventListener('change', (e) => {
      addGuestTo(editGuests, e.target.value, renderEditGuests);
      e.target.value = '';
    });
    document.getElementById('deleteBookedBtn')?.addEventListener('click', () => {
      if (currentRequest) deleteStay(currentRequest);
    });

    document.getElementById('manageGuestsBtn')?.addEventListener('click', () => {
      renderGuestTable(guests);
      showModal('manageGuestsModal');
    });
    document.getElementById('closeManageGuestsModal')?.addEventListener('click', () => hideModal('manageGuestsModal'));
    document.getElementById('guestSearchInput')?.addEventListener('input', () => renderGuestTable(filteredGuests()));
    document.getElementById('addGuestFromManageBtn')?.addEventListener('click', () => {
      hideModal('manageGuestsModal');
      openAddGuest('manage');
    });
    document.getElementById('closeAddGuestModal')?.addEventListener('click', () => hideModal('addGuestModal'));
    document.getElementById('cancelAddGuestBtn')?.addEventListener('click', () => hideModal('addGuestModal'));
    document.getElementById('addGuestForm')?.addEventListener('submit', guardSubmit(submitGuest));

    document.getElementById('closeBookingConfirmedModal')?.addEventListener('click', () => hideModal('bookingConfirmedModal'));
    document.getElementById('closeBookingConfirmedBtn')?.addEventListener('click', () => hideModal('bookingConfirmedModal'));

    document.getElementById('closeRequestChangeModal')?.addEventListener('click', () => hideModal('requestChangeModal'));
    document.getElementById('cancelRequestChangeBtn')?.addEventListener('click', () => hideModal('requestChangeModal'));
    document.getElementById('requestChangeForm')?.addEventListener('submit', guardSubmit(submitChange));
    document.querySelectorAll('#requestChangeForm input[name="changeField"]').forEach(box => {
      box.addEventListener('change', toggleChangeField);
    });

    document.getElementById('closeApproveChangeModal')?.addEventListener('click', () => hideModal('approveChangeModal'));
    document.getElementById('cancelApproveChangeBtn')?.addEventListener('click', () => hideModal('approveChangeModal'));
    document.getElementById('approveChangeForm')?.addEventListener('submit', guardSubmit(confirmApprove));

    document.getElementById('pendingSearch')?.addEventListener('input', debounce(renderPending, 200));
    document.getElementById('pendingFilter')?.addEventListener('change', renderPending);
    document.getElementById('pendingSort')?.addEventListener('change', renderPending);
    document.getElementById('bookedSearch')?.addEventListener('input', debounce(renderBooked, 200));
    document.getElementById('bookedFilter')?.addEventListener('change', renderBooked);
    document.getElementById('bookedSort')?.addEventListener('change', renderBooked);
    document.getElementById('pendingCardsViewBtn')?.addEventListener('click', () => {
      pendingView = 'cards';
      document.getElementById('pendingCardsViewBtn').classList.add('active');
      document.getElementById('pendingTableViewBtn').classList.remove('active');
      renderPending();
    });
    document.getElementById('pendingTableViewBtn')?.addEventListener('click', () => {
      pendingView = 'table';
      document.getElementById('pendingTableViewBtn').classList.add('active');
      document.getElementById('pendingCardsViewBtn').classList.remove('active');
      renderPending();
    });
    document.getElementById('bookedCardsViewBtn')?.addEventListener('click', () => {
      bookedView = 'cards';
      document.getElementById('bookedCardsViewBtn').classList.add('active');
      document.getElementById('bookedTableViewBtn').classList.remove('active');
      renderBooked();
    });
    document.getElementById('bookedTableViewBtn')?.addEventListener('click', () => {
      bookedView = 'table';
      document.getElementById('bookedTableViewBtn').classList.add('active');
      document.getElementById('bookedCardsViewBtn').classList.remove('active');
      renderBooked();
    });

    bindEventSearch(document.getElementById('eventName'), document.getElementById('eventSuggestions'), (data) => {
      applyEventDates(data, 'requestCheckIn', 'requestCheckOut');
    });
    bindEventSearch(document.getElementById('bookingEventName'), document.getElementById('bookingEventSuggestions'), (data) => {
      applyEventDates(data, 'bookingCheckIn', 'bookingCheckOut');
    });
    bindEventSearch(document.getElementById('viewEventName'), document.getElementById('viewEventSuggestions'));
    bindEventSearch(document.getElementById('editBookedEventName'), document.getElementById('editBookedEventSuggestions'));

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.form-group')) {
        document.querySelectorAll('.event-suggestions').forEach(el => el.classList.remove('show'));
      }
      if (!e.target.closest('.booked-menu-wrapper')) {
        document.querySelectorAll('.booked-menu-dropdown.show').forEach(el => el.classList.remove('show'));
      }
      if (e.target.classList.contains('dark-modal')) e.target.classList.remove('show');
    });
  }

  async function init() {
    const grid = document.getElementById('pendingRequestsGrid');
    if (grid) grid.innerHTML = '<div class="loading-indicator"><div class="spinner"></div><p>Loading hotels...</p></div>';
    let loadError = null;
    try {
      await Promise.all([loadGuests(), loadUsers(), loadStays()]);
    } catch (err) {
      loadError = err;
      console.error(err);
      requests = [];
      bookedStays = [];
    }
    fillAllGuestSelects();
    fillUserSelect();
    renderPending();
    renderBooked();
    setup();
    if (loadError) {
      if (grid) {
        grid.style.display = 'grid';
        grid.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">error</span><p>${esc(loadError.message || 'Failed to load hotel data.')}</p></div>`;
      }
      return;
    }
    openDeepLink();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
