// User Management Page Logic - Wrapped in IIFE to prevent variable redeclaration
(function() {
  'use strict';
  
  // Get API base
if (typeof window.API_BASE === 'undefined') {
  window.API_BASE = localStorage.getItem('API_BASE') || '';
}
  
  // Get token helper
  function getUsersToken() {
    return window.token || localStorage.getItem('token');
  }

  // Local variables (scoped to this IIFE)
let messageArea, userTableBody, userModal, closeModalBtn, cancelModalBtn, userForm, modalTitle;
let userIdInput, userNameInput, userEmailInput, userRoleInput, passwordGroup, userPasswordInput, resetPasswordBtn;
let users = [];
let editingUserId = null;
  let userToDelete = null;

  // Initialize page function - called by SPA navigation
  function initUsersPage() {
    console.log('initUsersPage called');
  
    // Always re-initialize DOM elements on each navigation
  messageArea = document.getElementById('messageArea');
  userTableBody = document.getElementById('userTableBody');
  userModal = document.getElementById('userModal');
  closeModalBtn = document.getElementById('closeModalBtn');
  cancelModalBtn = document.getElementById('cancelModalBtn');
  userForm = document.getElementById('userForm');
  modalTitle = document.getElementById('modalTitle');
  userIdInput = document.getElementById('userId');
  userNameInput = document.getElementById('userName');
  userEmailInput = document.getElementById('userEmail');
  userRoleInput = document.getElementById('userRole');
  passwordGroup = document.getElementById('passwordGroup');
  userPasswordInput = document.getElementById('userPassword');
  resetPasswordBtn = document.getElementById('resetPasswordBtn');
  
    console.log('DOM Elements:', { userTableBody: !!userTableBody, userModal: !!userModal });
    
    if (!userTableBody) {
      console.warn('userTableBody not found, page may not be ready');
      return;
    }
  
  // Setup modal event handlers
  if (closeModalBtn) closeModalBtn.onclick = closeModal;
  if (cancelModalBtn) cancelModalBtn.onclick = closeModal;
    if (userForm) userForm.onsubmit = handleFormSubmit;
  if (resetPasswordBtn) {
    resetPasswordBtn.onclick = function() {
      if (passwordGroup) passwordGroup.style.display = '';
      resetPasswordBtn.style.display = 'none';
      if (userPasswordInput) userPasswordInput.value = '';
      if (modalTitle) modalTitle.textContent = 'Reset Password';
    };
  }
  
    // Setup delete modal handlers
    const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteUserModal = document.getElementById('deleteUserModal');
    
    if (closeDeleteModalBtn) closeDeleteModalBtn.onclick = closeDeleteModal;
    if (cancelDeleteBtn) cancelDeleteBtn.onclick = closeDeleteModal;
    if (confirmDeleteBtn) {
      confirmDeleteBtn.onclick = function() {
        if (userToDelete) deleteUser(userToDelete);
      };
    }
    
    // Window click handler for modals
  window.onclick = function(event) {
    if (event.target === userModal) closeModal();
      if (event.target === deleteUserModal) closeDeleteModal();
    };
    
    // Inject and initialize shared dashboard sidebar
    const layoutContainer = document.getElementById('usersPageLayout');
    if (layoutContainer && typeof window.injectDashboardSidebar === 'function') {
      window.injectDashboardSidebar(layoutContainer, { 
        position: 'prepend',
        activePage: 'users'
      });
    } else if (typeof window.initDashboardSidebar === 'function') {
      // Fallback: sidebar HTML already exists, just initialize
      window.initDashboardSidebar();
    } else {
      // Final fallback if sidebar script not loaded
      updateSidebarUserInfo();
      fixPageContainer();
    }
    
    // Setup search functionality
    setupSearch();
    
    // Setup external navigation links (inline onclick doesn't work reliably in SPA)
    setupExternalNavigation();
    
    // Setup Add User button
    const addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
      addUserBtn.onclick = function() {
        // Reset form for new user
        if (userIdInput) userIdInput.value = '';
        if (userNameInput) userNameInput.value = '';
        if (userEmailInput) userEmailInput.value = '';
        if (userRoleInput) userRoleInput.value = 'user';
        if (passwordGroup) passwordGroup.style.display = '';
        if (userPasswordInput) {
          userPasswordInput.value = '';
          userPasswordInput.required = true;
        }
        if (resetPasswordBtn) resetPasswordBtn.style.display = 'none';
        
        // Change password label to "Password" for new users
        const passwordLabel = passwordGroup?.querySelector('label');
        if (passwordLabel) passwordLabel.textContent = 'Password';
        
        editingUserId = null;
        openModal('Add New User');
      };
    }
    
    console.log('Users page initialized, checking admin role...');
  
  if (checkAdminRole()) {
    loadUsers();
    
      // Setup Socket.IO (only once)
      if (!window._usersSocketInitialized) {
    setupSocketIO();
        window._usersSocketInitialized = true;
  }
    }
  }
  
  // Setup search with debounce
  function setupSearch() {
    const searchInput = document.getElementById('searchUsersInput');
    if (!searchInput) return;
    
    let timeout;
    searchInput.oninput = function() {
      clearTimeout(timeout);
      const value = this.value;
      timeout = setTimeout(() => searchUsers(value), 300);
    };
  }
  
  // Search users in the table
  function searchUsers(query) {
    const tableBody = document.getElementById('userTableBody');
    if (!tableBody) return;
    
    const rows = tableBody.querySelectorAll('tr');
    const lowerQuery = query.toLowerCase();
    
    let visibleCount = 0;
    rows.forEach(row => {
      // Skip loading row
      if (row.querySelector('.loading-cell')) return;
      
      const name = row.querySelector('td:first-child')?.textContent?.toLowerCase() || '';
      const email = row.querySelector('td:nth-child(2)')?.textContent?.toLowerCase() || '';
      
      if (name.includes(lowerQuery) || email.includes(lowerQuery) || !query) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });
    
    // Update count display (uses the existing updateUsersCount function)
    const countEl = document.getElementById('usersCount');
    if (countEl) {
      countEl.textContent = `Showing ${visibleCount} user${visibleCount !== 1 ? 's' : ''}`;
    }
  }
  
  // Update sidebar user info
  function updateSidebarUserInfo() {
    let userName = 'User';
    
    // Method 1: Check for fullName (set by login.js)
    const fullName = localStorage.getItem('fullName');
    if (fullName) {
      userName = fullName;
    }
    
    // Method 2: Check for user object
    if (userName === 'User') {
      try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (user.name) userName = user.name;
        else if (user.email) userName = user.email;
      } catch (e) {}
    }
    
    // Method 3: Decode from token
    if (userName === 'User') {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload.name) userName = payload.name;
          else if (payload.email) userName = payload.email;
          else if (payload.fullName) userName = payload.fullName;
        } catch (e) {}
      }
    }
    
    const sidebarUserName = document.getElementById('sidebarUserName');
    if (sidebarUserName) {
      sidebarUserName.textContent = userName;
    }
  }
  
  // Fix page container for proper scrolling
  function fixPageContainer() {
    const pageContainer = document.getElementById('page-container');
    if (pageContainer) {
      pageContainer.style.padding = '0';
      pageContainer.style.overflow = 'hidden';
      pageContainer.style.height = '100vh';
    }
    
    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) {
      bottomNav.style.display = 'none';
    }
  }
  
  // Setup external navigation links (since inline onclick doesn't work reliably in SPA)
  function setupExternalNavigation() {
    const externalLinks = document.querySelectorAll('.nav-external');
    console.log('Setting up external navigation for', externalLinks.length, 'links');
    
    externalLinks.forEach(link => {
      // Remove any existing listeners by cloning
      const newLink = link.cloneNode(true);
      link.parentNode.replaceChild(newLink, link);
      
      newLink.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const href = newLink.getAttribute('href');
        console.log('External nav clicked:', href);
        window.location.href = href;
      });
    });
  }
  
  // Setup Socket.IO
function setupSocketIO() {
  if (typeof io !== 'undefined') {
    try {
      const socketServerUrl = localStorage.getItem('SOCKET_SERVER') || window.API_BASE;
      window.socket = io(socketServerUrl);
      window.socket.on('usersChanged', () => {
        console.log('Users data changed, reloading...');
        loadUsers();
      });
    } catch (err) {
      console.error('Socket.IO initialization error:', err);
    }
  }
}

  // Check admin role
function checkAdminRole() {
  try {
      const token = getUsersToken();
      if (!token) {
        console.error('No token found');
        return false;
      }
    const payload = JSON.parse(atob(token.split('.')[1]));
    console.log('User role:', payload.role);
      
      if (payload.role !== 'admin' && payload.role !== 'owner') {
      if (messageArea) {
        messageArea.innerHTML = `
          <div class="msg msg-error">
            You don't have admin privileges. Redirecting to events page in 3 seconds.
          </div>
        `;
      }
      setTimeout(() => {
          if (typeof window.navigate === 'function') {
            window.navigate('events');
          } else {
        window.location.href = '../dashboard.html#events';
          }
      }, 3000);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error checking admin role:', err);
    return false;
  }
}

function showMessage(text, type = 'error') {
  if (messageArea) {
    messageArea.innerHTML = `<div class="msg msg-${type}">${text}</div>`;
    setTimeout(() => { messageArea.innerHTML = ''; }, 5000);
  }
}

async function loadUsers() {
  if (userTableBody) {
      userTableBody.innerHTML = '<tr><td colspan="4" class="loading-cell">Loading users...</td></tr>';
  }
  try {
      console.log('Loading users from:', `${window.API_BASE}/api/users`);
    
    const res = await fetch(`${window.API_BASE}/api/users`, {
        headers: { Authorization: getUsersToken() }
    });
    
    if (!res.ok) {
        throw new Error(`Failed to load users: ${res.status}`);
    }
    
    users = await res.json();
      console.log('Users loaded:', users.length);
    renderUsers();
  } catch (err) {
      console.error('Error loading users:', err);
    showMessage(err.message, 'error');
    if (userTableBody) {
        userTableBody.innerHTML = '<tr><td colspan="4" class="loading-cell">Error loading users</td></tr>';
    }
  }
}

function renderUsers() {
  if (!userTableBody) return;
  
  if (!users.length) {
      userTableBody.innerHTML = '<tr><td colspan="4" class="loading-cell">No users found</td></tr>';
      updateUsersCount(0);
    return;
  }
    
    const isDarkTheme = document.querySelector('.users-page.dark-theme');
    
    if (isDarkTheme) {
      userTableBody.innerHTML = users.map(user => {
        const roleClass = user.role === 'admin' ? 'admin' : user.role === 'owner' ? 'owner' : 'user';
        const initials = getInitials(user.name || user.email);
        return `
          <tr data-user-id="${user._id}">
            <td>
              <div class="user-cell">
                <div class="user-avatar">
                  <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=2a2a2a&color=fff&size=36" alt="${escapeHtml(user.name)}">
                </div>
                <span class="user-name">${escapeHtml(user.name)}</span>
              </div>
            </td>
            <td>${escapeHtml(user.email)}</td>
            <td><span class="role-badge ${roleClass}">${escapeHtml(user.role)}</span></td>
            <td>
              <div class="user-actions">
                <button class="user-action-btn edit" onclick="window._usersEditUser('${user._id}')">
                  <span class="material-symbols-outlined">edit</span>
                  <span>Edit</span>
                </button>
                <button class="user-action-btn reset" onclick="window._usersResetPassword('${user._id}')">
                  <span class="material-symbols-outlined">lock_reset</span>
                  <span>Reset</span>
                </button>
                <button class="user-action-btn delete" onclick="window._usersConfirmDelete('${user._id}')">
                  <span class="material-symbols-outlined">delete</span>
                  <span>Delete</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } else {
  userTableBody.innerHTML = users.map(user => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td class="action-buttons">
            <button class="action-btn btn-edit btn-text" onclick="window._usersEditUser('${user._id}')">Edit</button>
            <button class="action-btn btn-delete btn-text" onclick="window._usersDeleteUser('${user._id}')">Delete</button>
            <button class="action-btn btn-reset btn-text" onclick="window._usersResetPassword('${user._id}')">Reset Password</button>
      </td>
    </tr>
  `).join('');
}

    updateUsersCount(users.length);
  }
  
  function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  
  function updateUsersCount(count) {
    const countEl = document.getElementById('usersCount');
    if (countEl) {
      countEl.textContent = `Showing ${count} user${count !== 1 ? 's' : ''}`;
    }
  }
  
function openModal(title) {
  if (modalTitle) modalTitle.textContent = title;
  if (userModal) {
    userModal.classList.add('show');
      document.body.style.overflow = 'hidden';
  }
}

function closeModal() {
  if (userModal) {
    userModal.classList.remove('show');
      document.body.style.overflow = '';
  }
  if (userForm) userForm.reset();
  if (passwordGroup) passwordGroup.style.display = 'none';
    if (resetPasswordBtn) resetPasswordBtn.style.display = '';
  editingUserId = null;
}

  function editUser(id) {
  const user = users.find(u => u._id === id);
    if (!user) return;
    
  editingUserId = id;
  if (userIdInput) userIdInput.value = user._id;
  if (userNameInput) userNameInput.value = user.name;
  if (userEmailInput) userEmailInput.value = user.email;
  if (userRoleInput) userRoleInput.value = user.role;
  if (userPasswordInput) userPasswordInput.value = '';
  if (passwordGroup) passwordGroup.style.display = 'none';
  if (resetPasswordBtn) resetPasswordBtn.style.display = '';
  openModal('Edit User');
  }
  
  function confirmDeleteUser(id) {
    userToDelete = id;
    const user = users.find(u => u._id === id);
    const deleteModal = document.getElementById('deleteUserModal');
    const deleteMessage = document.getElementById('deleteModalMessage');
    
    if (deleteMessage && user) {
      deleteMessage.textContent = `Are you sure you want to delete ${user.name || user.email}? This action cannot be undone.`;
    }
    
    if (deleteModal) {
      deleteModal.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  }
  
  function closeDeleteModal() {
    const deleteModal = document.getElementById('deleteUserModal');
    if (deleteModal) {
      deleteModal.classList.remove('show');
      document.body.style.overflow = '';
    }
    userToDelete = null;
  }
  
  async function deleteUser(id) {
  try {
    const res = await fetch(`${window.API_BASE}/api/users/${id}`, {
      method: 'DELETE',
        headers: { Authorization: getUsersToken() }
    });
    if (!res.ok) throw new Error('Failed to delete user');
    showMessage('User deleted successfully!', 'success');
      closeDeleteModal();
    await loadUsers();
  } catch (err) {
    showMessage(err.message, 'error');
  }
  }

  function resetPassword(id) {
  editingUserId = id;
  const user = users.find(u => u._id === id);
    if (!user) return;
    
  if (userIdInput) userIdInput.value = user._id;
  if (userNameInput) userNameInput.value = user.name;
  if (userEmailInput) userEmailInput.value = user.email;
  if (userRoleInput) userRoleInput.value = user.role;
    if (userPasswordInput) {
      userPasswordInput.value = '';
      userPasswordInput.required = true;
    }
    if (passwordGroup) {
      passwordGroup.style.display = '';
      // Change label to "New Password" for password reset
      const passwordLabel = passwordGroup.querySelector('label');
      if (passwordLabel) passwordLabel.textContent = 'New Password';
    }
  if (resetPasswordBtn) resetPasswordBtn.style.display = 'none';
  openModal('Reset Password');
  }

async function handleFormSubmit(e) {
  e.preventDefault();
    if (!userNameInput || !userEmailInput) return;
  
    const id = userIdInput ? userIdInput.value : '';
  const name = userNameInput.value.trim();
    const email = userEmailInput.value.trim().toLowerCase();
    const role = userRoleInput ? userRoleInput.value : 'user';
  const password = userPasswordInput ? userPasswordInput.value : '';
    const isNewUser = !id;
    const isReset = !isNewUser && passwordGroup && passwordGroup.style.display !== 'none' && password;
    
    // Validation
    if (!name || !email) {
      showMessage('Please fill in name and email.', 'error');
      return;
    }
    
    if (isNewUser && !password) {
      showMessage('Password is required for new users.', 'error');
      return;
    }
    
    if (password && password.length < 6) {
      showMessage('Password must be at least 6 characters.', 'error');
      return;
    }
  
  try {
    let res;
      
      if (isNewUser) {
        // Create new user using the same endpoint as register.js
        res = await fetch(`${window.API_BASE}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: getUsersToken() },
          body: JSON.stringify({ 
            email, 
            fullName: name, 
            password,
            role // Include role if the backend supports it
          })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.message || 'Failed to create user');
        }
        
        showMessage('User created successfully!', 'success');
      } else if (isReset) {
      // Reset password
      res = await fetch(`${window.API_BASE}/api/users/${id}/reset-password`, {
        method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: getUsersToken() },
        body: JSON.stringify({ password })
      });
      if (!res.ok) throw new Error('Failed to reset password');
      showMessage('Password reset successfully!', 'success');
    } else {
        // Update existing user
      res = await fetch(`${window.API_BASE}/api/users/${id}`, {
        method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: getUsersToken() },
        body: JSON.stringify({ name, email, role })
      });
      if (!res.ok) throw new Error('Failed to update user');
      showMessage('User updated successfully!', 'success');
    }
      
    closeModal();
    await loadUsers();
  } catch (err) {
    showMessage(err.message, 'error');
  }
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
} 
  
  // Expose functions globally for onclick handlers and SPA navigation
  window.initPage = initUsersPage;
  window._usersEditUser = editUser;
  window._usersResetPassword = resetPassword;
  window._usersConfirmDelete = confirmDeleteUser;
  window._usersDeleteUser = deleteUser;
  
  // For backwards compatibility
  window.editUser = editUser;
  window.resetPassword = resetPassword;
  window.confirmDeleteUser = confirmDeleteUser;
  window.deleteUser = deleteUser;
  
  // Auto-initialize if DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initUsersPage, 0);
  } else {
    document.addEventListener('DOMContentLoaded', initUsersPage);
  }
  
})();
