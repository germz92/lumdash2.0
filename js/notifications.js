/**
 * notifications.js - Notification system for the dashboard
 * Handles fetching, displaying, and managing user notifications.
 * Uses REST API as the reliable backbone + Socket.IO for real-time push.
 */

(function() {
  'use strict';

  const API_BASE = window.API_BASE || '';
  let unreadCount = 0;
  let notifications = [];
  let dropdownOpen = false;
  let initialized = false;
  let fetchInProgress = false;

  // Icon mapping per notification type
  const TYPE_CONFIG = {
    task_assigned:          { icon: 'assignment_ind',   color: '#3b82f6' },
    task_updated:           { icon: 'edit_note',        color: '#8b5cf6' },
    flight_request:         { icon: 'flight',           color: '#f59e0b' },
    flight_booked:          { icon: 'flight_takeoff',   color: '#22c55e' },
    owner_request:          { icon: 'admin_panel_settings', color: '#ef4444' },
    owner_request_approved: { icon: 'check_circle',     color: '#22c55e' },
    owner_request_denied:   { icon: 'cancel',           color: '#ef4444' },
    event_shared:           { icon: 'group_add',        color: '#06b6d4' },
    reimbursement_submitted:{ icon: 'receipt_long',     color: '#10b981' },
    post_production_assigned: { icon: 'movie_edit',      color: '#6366f1' },
    post_production_status_changed: { icon: 'sync_alt',  color: '#f59e0b' },
    general:                { icon: 'notifications',    color: '#6b7280' }
  };

  // ── Get auth token ──────────────────────────────────
  function getToken() {
    return localStorage.getItem('token');
  }

  // ── Fetch notifications from API (reliable baseline) ──
  async function fetchNotifications() {
    if (fetchInProgress) return;
    fetchInProgress = true;

    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/notifications?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        console.warn('🔔 Failed to fetch notifications:', res.status);
        return;
      }

      const data = await res.json();
      notifications = data.notifications || [];
      unreadCount = data.unreadCount || 0;
      console.log(`🔔 Loaded ${notifications.length} notifications (${unreadCount} unread)`);
      updateBadge();
      if (dropdownOpen) renderDropdown();
    } catch (err) {
      console.error('🔔 Error fetching notifications:', err);
    } finally {
      fetchInProgress = false;
    }
  }

  // ── Update the bell icon badge ──────────────────────
  function updateBadge() {
    const btn = document.getElementById('notificationsBtn');
    if (!btn) return;

    // Ensure relative positioning for the badge
    btn.style.position = 'relative';

    let badge = btn.querySelector('.notification-badge');

    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'notification-badge';
        btn.appendChild(badge);
      }
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.style.display = 'flex';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // ── Real-time push handler ──────────────────────────
  function setupSocketListener() {
    if (!window.socket || window.socket._reimbursementNotifListenerAttached) return;
    window.socket._reimbursementNotifListenerAttached = true;

    window.socket.on('new-notification', (notification) => {
      console.log('🔔 Real-time notification received:', notification.type, notification.title);

      // Add to the top of the list
      notifications.unshift(notification);
      unreadCount++;
      updateBadge();
      if (dropdownOpen) renderDropdown();

      // Show toast for instant feedback
      if (typeof window.showToast === 'function') {
        window.showToast(notification.title, 'info', 5000);
      }
    });

    // Re-fetch on reconnect to catch anything missed
    window.socket.on('reconnect', () => {
      console.log('🔔 Socket reconnected, refreshing notifications...');
      fetchNotifications();
    });
  }

  // ── Render the dropdown panel ───────────────────────
  function renderDropdown() {
    const list = document.getElementById('notificationList');
    if (!list) return;

    if (notifications.length === 0) {
      list.innerHTML = `
        <div class="notification-empty">
          <span class="material-symbols-outlined">notifications_off</span>
          <p>No notifications yet</p>
        </div>
      `;
      return;
    }

    list.innerHTML = notifications.map(n => {
      const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.general;
      const timeAgo = getTimeAgo(new Date(n.createdAt));
      const actorName = n.actor?.fullName || '';
      const unreadClass = n.read ? '' : 'unread';

      // Render approve/deny action buttons for pending owner requests
      let actionsHtml = '';
      if (n.type === 'owner_request' && !n.read && n.metadata?.requestId && n.eventId) {
        actionsHtml = `
          <div class="notification-actions" onclick="event.stopPropagation()">
            <button class="notif-action-btn notif-approve" onclick="window.notificationSystem.approveOwner('${n.eventId}', '${n.metadata.requestId}', '${n._id}')">
              <span class="material-symbols-outlined">check</span> Approve
            </button>
            <button class="notif-action-btn notif-deny" onclick="window.notificationSystem.denyOwner('${n.eventId}', '${n.metadata.requestId}', '${n._id}')">
              <span class="material-symbols-outlined">close</span> Deny
            </button>
          </div>
        `;
      }

      return `
        <div class="notification-item ${unreadClass}" data-id="${n._id}" onclick="window.notificationSystem.handleClick('${n._id}')">
          <div class="notification-item-icon" style="color: ${config.color}">
            <span class="material-symbols-outlined">${config.icon}</span>
          </div>
          <div class="notification-item-content">
            <div class="notification-item-title">${escapeHtml(n.title)}</div>
            ${n.message ? `<div class="notification-item-message">${escapeHtml(n.message)}</div>` : ''}
            <div class="notification-item-meta">
              ${actorName ? `<span class="notification-actor">${escapeHtml(actorName)}</span> · ` : ''}
              <span class="notification-time">${timeAgo}</span>
            </div>
            ${actionsHtml}
          </div>
          ${!n.read ? '<div class="notification-item-dot"></div>' : ''}
        </div>
      `;
    }).join('');
  }

  // ── Toggle dropdown open/close ──────────────────────
  function toggleDropdown(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) {
      createDropdownElement();
      return toggleDropdown();
    }

    dropdownOpen = !dropdownOpen;

    if (dropdownOpen) {
      dropdown.classList.add('show');
      renderDropdown();
      // Refresh from API when opening
      fetchNotifications();
    } else {
      dropdown.classList.remove('show');
    }
  }

  // ── Create the dropdown DOM element ─────────────────
  function createDropdownElement() {
    // Find the notification button to position the dropdown relative to it
    const btn = document.getElementById('notificationsBtn');
    if (!btn) return;

    // Create wrapper around button if not already wrapped
    let wrapper = btn.closest('.notification-wrapper');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'notification-wrapper';
      btn.parentNode.insertBefore(wrapper, btn);
      wrapper.appendChild(btn);
    }

    const dropdown = document.createElement('div');
    dropdown.className = 'notification-dropdown';
    dropdown.id = 'notificationDropdown';
    dropdown.innerHTML = `
      <div class="notification-header">
        <h3>Notifications</h3>
        <div class="notification-header-actions">
          <button class="notification-header-btn" onclick="window.notificationSystem.markAllRead()" title="Mark all as read">
            <span class="material-symbols-outlined">done_all</span>
          </button>
          <button class="notification-header-btn" onclick="window.notificationSystem.clearAll()" title="Clear all">
            <span class="material-symbols-outlined">delete_sweep</span>
          </button>
        </div>
      </div>
      <div class="notification-list" id="notificationList">
        <div class="notification-empty">
          <span class="material-symbols-outlined">notifications_off</span>
          <p>No notifications yet</p>
        </div>
      </div>
    `;

    // Prevent dropdown clicks from closing it
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    wrapper.appendChild(dropdown);
  }

  // Standalone pages that live outside the SPA router (full HTML documents)
  const STANDALONE_PAGES = {
    'flights':          '/pages/flights.html',
    'crew-planner':     '/pages/crew-planner.html',
    'crew-calendar':    '/pages/crew-calendar.html',
    'event-calendar':   '/pages/event-calendar.html',
    'admin-timesheets': '/pages/admin-timesheets.html'
  };

  // ── Handle notification click ───────────────────────
  async function handleClick(notificationId) {
    const notification = notifications.find(n => n._id === notificationId);
    if (!notification) return;

    // Mark as read
    if (!notification.read) {
      await markAsRead(notificationId);
    }

    // Navigate if link is provided
    if (notification.link && notification.link.page) {
      // Close dropdown
      dropdownOpen = false;
      const dropdown = document.getElementById('notificationDropdown');
      if (dropdown) dropdown.classList.remove('show');

      const page = notification.link.page;

      // Standalone pages need a full page redirect (not SPA navigation)
      if (STANDALONE_PAGES[page]) {
        let url = STANDALONE_PAGES[page];
        // Append any link params as query string (e.g. ?flightId=abc123)
        if (notification.link.params && Object.keys(notification.link.params).length > 0) {
          const qs = new URLSearchParams(notification.link.params).toString();
          url += '?' + qs;
        }
        window.location.href = url;
      } else if (typeof window.navigate === 'function') {
        if (notification.link.params?.reimbursementId) {
          sessionStorage.setItem('openReimbursementId', notification.link.params.reimbursementId);
        }
        if (notification.link.params?.itemId) {
          sessionStorage.setItem('openPostProductionItemId', notification.link.params.itemId);
        }
        window.navigate(page, notification.link.eventId || null);
      }
    }
  }

  // ── Mark a single notification as read ──────────────
  async function markAsRead(notificationId) {
    try {
      const token = getToken();
      if (!token) return;

      await fetch(`${API_BASE}/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // Update local state
      const notification = notifications.find(n => n._id === notificationId);
      if (notification && !notification.read) {
        notification.read = true;
        unreadCount = Math.max(0, unreadCount - 1);
        updateBadge();
        if (dropdownOpen) renderDropdown();
      }
    } catch (err) {
      console.error('🔔 Error marking notification as read:', err);
    }
  }

  // ── Mark all as read ────────────────────────────────
  async function markAllRead() {
    try {
      const token = getToken();
      if (!token) return;

      await fetch(`${API_BASE}/api/notifications/read-all`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      // Update local state
      notifications.forEach(n => n.read = true);
      unreadCount = 0;
      updateBadge();
      if (dropdownOpen) renderDropdown();
    } catch (err) {
      console.error('🔔 Error marking all as read:', err);
    }
  }

  // ── Clear all notifications ─────────────────────────
  async function clearAll() {
    try {
      const token = getToken();
      if (!token) return;

      await fetch(`${API_BASE}/api/notifications`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      notifications = [];
      unreadCount = 0;
      updateBadge();
      if (dropdownOpen) renderDropdown();
    } catch (err) {
      console.error('🔔 Error clearing notifications:', err);
    }
  }

  // ── Owner access request actions ────────────────────
  async function approveOwner(eventId, requestId, notificationId) {
    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/tables/${eventId}/owner-requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        if (typeof window.showToast === 'function') {
          window.showToast('Owner access approved!', 'success');
        }
        // Mark the notification as read and refresh
        await markAsRead(notificationId);
        renderDropdown();
      } else {
        const data = await res.json();
        if (typeof window.showToast === 'function') {
          window.showToast(data.error || 'Failed to approve', 'error');
        }
      }
    } catch (err) {
      console.error('🔔 Error approving owner request:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to approve request', 'error');
      }
    }
  }

  async function denyOwner(eventId, requestId, notificationId) {
    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/tables/${eventId}/owner-requests/${requestId}/deny`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });

      if (res.ok) {
        if (typeof window.showToast === 'function') {
          window.showToast('Owner access denied', 'info');
        }
        await markAsRead(notificationId);
        renderDropdown();
      } else {
        const data = await res.json();
        if (typeof window.showToast === 'function') {
          window.showToast(data.error || 'Failed to deny', 'error');
        }
      }
    } catch (err) {
      console.error('🔔 Error denying owner request:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to deny request', 'error');
      }
    }
  }

  // ── Utility: relative time ──────────────────────────
  function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Utility: escape HTML ────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Close dropdown when clicking outside ────────────
  document.addEventListener('click', () => {
    if (dropdownOpen) {
      dropdownOpen = false;
      const dropdown = document.getElementById('notificationDropdown');
      if (dropdown) dropdown.classList.remove('show');
    }
  });

  // ── Initialize ──────────────────────────────────────
  function init() {
    if (initialized) {
      // Re-attach to new DOM elements after SPA navigation
      attachButton();
      fetchNotifications();
      return;
    }

    console.log('🔔 Initializing notification system...');
    initialized = true;

    attachButton();
    setupSocketListener();
    fetchNotifications();
    logNotificationDebug();
  }

  async function logNotificationDebug() {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/users/me/notification-debug`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      console.log('🔔 Notification debug:', data);
      if (!data.isListedAsSystemAdmin && data.sessionRole === 'admin') {
        console.warn('🔔 Your JWT says admin but you are NOT in the system admin list. Log out and back in, or check for duplicate accounts.');
      }
      if (data.isListedAsSystemAdmin && data.reimbursementNotificationsForYou === 0) {
        console.warn('🔔 You are a system admin but have no reimbursement notifications. Submit a new test or call resend-notifications.');
      }
    } catch (err) {
      console.warn('🔔 Notification debug failed:', err);
    }
  }

  function attachButton() {
    const btn = document.getElementById('notificationsBtn');
    if (btn && !btn._notificationListenerAttached) {
      btn.addEventListener('click', toggleDropdown);
      btn._notificationListenerAttached = true;
    }
  }

  // ── Expose public API ───────────────────────────────
  window.notificationSystem = {
    init,
    fetchNotifications,
    updateBadge,
    handleClick,
    markAllRead,
    clearAll,
    approveOwner,
    denyOwner
  };

  // Auto-init: try now and also on navigation
  function tryInit() {
    if (document.getElementById('notificationsBtn')) {
      init();
    }
  }

  // Try immediately
  tryInit();

  // Also try after a short delay (for initial page load timing)
  setTimeout(tryInit, 500);
  setTimeout(tryInit, 1500);

  // Watch for the notification button appearing in the DOM after SPA navigation.
  // pushState-based SPA routers don't fire hashchange, so we use a MutationObserver
  // to reliably detect when a new #notificationsBtn is injected.
  const pageContainer = document.getElementById('page-container');
  if (pageContainer) {
    const observer = new MutationObserver(() => {
      const btn = document.getElementById('notificationsBtn');
      if (btn && !btn._notificationListenerAttached) {
        init();
      }
    });
    observer.observe(pageContainer, { childList: true, subtree: true });
  }

  // Fallback: also re-init on hashchange (covers edge cases)
  window.addEventListener('hashchange', () => {
    setTimeout(tryInit, 300);
  });

  console.log('🔔 Notification system module loaded');
})();
