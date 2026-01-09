/**
 * Admin Notes - Google Keep Style
 * Only accessible by admins and event owners
 */

(function() {
// Use global API_BASE from config.js - wrapped in IIFE to prevent redeclaration errors
const NOTES_API_BASE = window.API_BASE || (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://lumdash2-0.onrender.com');

let notes = [];
let currentEditingNote = null;
let isOwnerOrAdmin = false;
let newNotePinned = false;

// Initialize page
window.initPage = async function(eventId) {
  console.log('[ADMIN-NOTES] Initializing with eventId:', eventId);
  
  const tableId = eventId || localStorage.getItem('eventId');
  if (!tableId) {
    alert('Event ID missing.');
    return;
  }
  
  // Setup sidebar
  setupSidebar();
  loadSidebarUser();
  
  // Check permissions
  await checkPermissions(tableId);
  
  if (!isOwnerOrAdmin) {
    showAccessDenied();
    return;
  }
  
  // Load event title
  await loadEventTitle(tableId);
  
  // Load notes
  await loadNotes(tableId);
  
  // Setup event listeners
  setupEventListeners();
  
  console.log('[ADMIN-NOTES] Initialization complete');
};

// Check if user is owner or admin
async function checkPermissions(tableId) {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      isOwnerOrAdmin = false;
      return;
    }
    
    // Decode JWT token to get user info
    let userId, userRole;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.id || payload._id || payload.userId;
      userRole = payload.role;
    } catch (e) {
      console.error('[ADMIN-NOTES] Failed to decode token:', e);
      isOwnerOrAdmin = false;
      return;
    }
    
    // Get table info
    const tableRes = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}`, {
      headers: { Authorization: token }
    });
    const table = await tableRes.json();
    
    // Check if admin or owner
    const isAdmin = userRole === 'admin';
    const isOwner = table.owners && table.owners.includes(userId);
    
    isOwnerOrAdmin = isAdmin || isOwner;
    console.log('[ADMIN-NOTES] Permission check:', { userId, userRole, isAdmin, isOwner, isOwnerOrAdmin, owners: table.owners });
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Permission check failed:', err);
    isOwnerOrAdmin = false;
  }
}

// Show access denied message
function showAccessDenied() {
  const main = document.querySelector('.admin-notes-main');
  if (main) {
    main.innerHTML = `
      <div class="access-denied">
        <span class="material-symbols-outlined">lock</span>
        <h2>Access Denied</h2>
        <p>Only event owners and admins can access notes.</p>
        <button class="btn-primary" onclick="window.navigate('general')">Go to Event Home</button>
      </div>
    `;
  }
}

// Load event title
async function loadEventTitle(tableId) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}`, {
      headers: { Authorization: token }
    });
    const table = await res.json();
    
    const titleEl = document.getElementById('eventTitle');
    if (titleEl) {
      titleEl.textContent = table.title || 'Event';
    }
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to load event title:', err);
  }
}

// Load notes from server
async function loadNotes(tableId) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}`, {
      headers: { Authorization: token }
    });
    const table = await res.json();
    
    notes = table.adminNotes || [];
    renderNotes();
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to load notes:', err);
  }
}

// Render notes to grid
function renderNotes(searchTerm = '') {
  const pinnedGrid = document.getElementById('pinnedNotesGrid');
  const notesGrid = document.getElementById('notesGrid');
  const pinnedSection = document.getElementById('pinnedSection');
  const othersSection = document.getElementById('othersSection');
  const othersSectionLabel = document.getElementById('othersSectionLabel');
  const emptyState = document.getElementById('emptyState');
  
  // Filter by search term
  let filteredNotes = notes;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filteredNotes = notes.filter(note => 
      (note.title && note.title.toLowerCase().includes(term)) ||
      (note.content && note.content.toLowerCase().includes(term))
    );
  }
  
  // Separate pinned and unpinned
  const pinnedNotes = filteredNotes.filter(note => note.pinned);
  const otherNotes = filteredNotes.filter(note => !note.pinned);
  
  // Sort by date (newest first)
  pinnedNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  otherNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Show/hide sections
  if (pinnedNotes.length > 0) {
    pinnedSection.style.display = 'block';
    pinnedGrid.innerHTML = pinnedNotes.map(note => createNoteCard(note)).join('');
  } else {
    pinnedSection.style.display = 'none';
  }
  
  if (otherNotes.length > 0) {
    othersSection.style.display = 'block';
    othersSectionLabel.style.display = pinnedNotes.length > 0 ? 'block' : 'none';
    notesGrid.innerHTML = otherNotes.map(note => createNoteCard(note)).join('');
  } else if (pinnedNotes.length > 0) {
    othersSection.style.display = 'none';
  } else {
    notesGrid.innerHTML = '';
  }
  
  // Show empty state if no notes
  if (filteredNotes.length === 0) {
    emptyState.style.display = 'flex';
    if (searchTerm) {
      emptyState.querySelector('h3').textContent = 'No matching notes';
      emptyState.querySelector('p').textContent = 'Try a different search term';
    } else {
      emptyState.querySelector('h3').textContent = 'No notes yet';
      emptyState.querySelector('p').textContent = 'Click "Take a note..." to create your first note';
    }
  } else {
    emptyState.style.display = 'none';
  }
  
  // Add click listeners to note cards
  document.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't open modal if clicking pin button
      if (e.target.closest('.note-pin-btn')) return;
      
      const noteId = card.dataset.noteId;
      openEditModal(noteId);
    });
  });
  
  // Add click listeners to pin buttons
  document.querySelectorAll('.note-pin-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.closest('.note-card').dataset.noteId;
      await togglePin(noteId);
    });
  });
}

// Create note card HTML
function createNoteCard(note) {
  const date = new Date(note.createdAt);
  const formattedDate = date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  });
  const formattedTime = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit'
  });
  
  // Truncate content for preview - show more since cards are taller
  const previewContent = note.content ? 
    (note.content.length > 500 ? note.content.substring(0, 500) + '...' : note.content) : '';
  
  return `
    <div class="note-card" data-note-id="${note._id}">
      <button type="button" class="note-pin-btn ${note.pinned ? 'pinned' : ''}" title="${note.pinned ? 'Unpin' : 'Pin'}">
        <span class="material-symbols-outlined">${note.pinned ? 'push_pin' : 'push_pin'}</span>
      </button>
      ${note.title ? `<div class="note-card-title">${escapeHtml(note.title)}</div>` : ''}
      ${previewContent ? `<div class="note-card-content">${escapeHtml(previewContent).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="note-card-footer">
        <span class="note-card-date">${formattedDate} ${formattedTime}</span>
        ${note.createdByName ? `<span class="note-card-author">${escapeHtml(note.createdByName)}</span>` : ''}
      </div>
    </div>
  `;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Setup event listeners
function setupEventListeners() {
  // Note input expand/collapse
  const collapsedInput = document.getElementById('noteInputCollapsed');
  const expandedInput = document.getElementById('noteInputExpanded');
  const closeBtn = document.getElementById('closeNoteInputBtn');
  const saveBtn = document.getElementById('saveNoteBtn');
  const pinNewBtn = document.getElementById('pinNewNoteBtn');
  
  collapsedInput?.addEventListener('click', () => {
    collapsedInput.style.display = 'none';
    expandedInput.style.display = 'block';
    document.getElementById('noteTitleInput')?.focus();
  });
  
  closeBtn?.addEventListener('click', () => {
    closeNoteInput();
  });
  
  saveBtn?.addEventListener('click', async () => {
    await saveNewNote();
  });
  
  pinNewBtn?.addEventListener('click', () => {
    newNotePinned = !newNotePinned;
    pinNewBtn.classList.toggle('active', newNotePinned);
  });
  
  // Search input
  const searchInput = document.getElementById('notesSearchInput');
  searchInput?.addEventListener('input', (e) => {
    renderNotes(e.target.value);
  });
  
  // Edit modal
  const closeEditBtn = document.getElementById('closeEditModalBtn');
  const editPinBtn = document.getElementById('editNotePinBtn');
  const deleteBtn = document.getElementById('deleteNoteBtn');
  
  closeEditBtn?.addEventListener('click', () => {
    closeEditModal();
  });
  
  editPinBtn?.addEventListener('click', async () => {
    if (currentEditingNote) {
      await togglePin(currentEditingNote._id);
      updateEditModalPinState();
    }
  });
  
  deleteBtn?.addEventListener('click', () => {
    openDeleteConfirm();
  });
  
  // Delete confirmation modal
  const closeDeleteBtn = document.getElementById('closeDeleteModalBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  
  closeDeleteBtn?.addEventListener('click', closeDeleteConfirm);
  cancelDeleteBtn?.addEventListener('click', closeDeleteConfirm);
  confirmDeleteBtn?.addEventListener('click', async () => {
    if (currentEditingNote) {
      await deleteNote(currentEditingNote._id);
    }
  });
  
  // Close modals on backdrop click
  document.getElementById('noteEditModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'noteEditModal') {
      closeEditModal();
    }
  });
  
  document.getElementById('deleteConfirmModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'deleteConfirmModal') {
      closeDeleteConfirm();
    }
  });
  
  // Auto-save on edit modal content change
  let saveTimeout;
  document.getElementById('editNoteTitle')?.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => autoSaveNote(), 1000);
  });
  
  document.getElementById('editNoteContent')?.addEventListener('input', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => autoSaveNote(), 1000);
  });
  
  // Click outside note input to close
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('noteInputWrapper');
    const expanded = document.getElementById('noteInputExpanded');
    
    if (expanded?.style.display === 'block' && 
        !wrapper?.contains(e.target) &&
        !document.getElementById('noteTitleInput')?.value &&
        !document.getElementById('noteContentInput')?.value) {
      closeNoteInput();
    }
  });
}

// Close note input
function closeNoteInput() {
  const collapsedInput = document.getElementById('noteInputCollapsed');
  const expandedInput = document.getElementById('noteInputExpanded');
  
  collapsedInput.style.display = 'flex';
  expandedInput.style.display = 'none';
  
  // Clear inputs
  document.getElementById('noteTitleInput').value = '';
  document.getElementById('noteContentInput').value = '';
  newNotePinned = false;
  document.getElementById('pinNewNoteBtn')?.classList.remove('active');
}

// Save new note
async function saveNewNote() {
  const title = document.getElementById('noteTitleInput')?.value?.trim();
  const content = document.getElementById('noteContentInput')?.value?.trim();
  
  if (!title && !content) {
    closeNoteInput();
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    const tableId = localStorage.getItem('eventId');
    
    const res = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}/admin-notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({
        title,
        content,
        pinned: newNotePinned
      })
    });
    
    if (!res.ok) throw new Error('Failed to save note');
    
    const result = await res.json();
    notes = result.adminNotes || [];
    renderNotes();
    closeNoteInput();
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to save note:', err);
    alert('Failed to save note. Please try again.');
  }
}

// Open edit modal
function openEditModal(noteId) {
  const note = notes.find(n => n._id === noteId);
  if (!note) return;
  
  currentEditingNote = note;
  
  document.getElementById('editNoteTitle').value = note.title || '';
  document.getElementById('editNoteContent').value = note.content || '';
  
  // Format timestamp
  const date = new Date(note.createdAt);
  const formatted = date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
  document.getElementById('editNoteTimestamp').textContent = `Created ${formatted}`;
  
  updateEditModalPinState();
  
  document.getElementById('noteEditModal').classList.add('show');
}

// Update pin state in edit modal
function updateEditModalPinState() {
  const pinBtn = document.getElementById('editNotePinBtn');
  if (currentEditingNote) {
    pinBtn?.classList.toggle('active', currentEditingNote.pinned);
  }
}

// Close edit modal
async function closeEditModal() {
  // Save any changes before closing
  if (currentEditingNote) {
    await autoSaveNote();
  }
  
  document.getElementById('noteEditModal').classList.remove('show');
  currentEditingNote = null;
}

// Auto-save note
async function autoSaveNote() {
  if (!currentEditingNote) return;
  
  const title = document.getElementById('editNoteTitle')?.value?.trim();
  const content = document.getElementById('editNoteContent')?.value?.trim();
  
  // Check if anything changed
  if (title === currentEditingNote.title && content === currentEditingNote.content) {
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    const tableId = localStorage.getItem('eventId');
    
    const res = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}/admin-notes/${currentEditingNote._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({
        title,
        content,
        pinned: currentEditingNote.pinned
      })
    });
    
    if (!res.ok) throw new Error('Failed to update note');
    
    const result = await res.json();
    notes = result.adminNotes || [];
    
    // Update current editing note reference
    currentEditingNote = notes.find(n => n._id === currentEditingNote._id);
    
    renderNotes(document.getElementById('notesSearchInput')?.value);
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to auto-save note:', err);
  }
}

// Toggle pin
async function togglePin(noteId) {
  const note = notes.find(n => n._id === noteId);
  if (!note) return;
  
  try {
    const token = localStorage.getItem('token');
    const tableId = localStorage.getItem('eventId');
    
    const res = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}/admin-notes/${noteId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token
      },
      body: JSON.stringify({
        title: note.title,
        content: note.content,
        pinned: !note.pinned
      })
    });
    
    if (!res.ok) throw new Error('Failed to toggle pin');
    
    const result = await res.json();
    notes = result.adminNotes || [];
    
    // Update current editing note if open
    if (currentEditingNote && currentEditingNote._id === noteId) {
      currentEditingNote = notes.find(n => n._id === noteId);
    }
    
    renderNotes(document.getElementById('notesSearchInput')?.value);
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to toggle pin:', err);
  }
}

// Open delete confirmation
function openDeleteConfirm() {
  document.getElementById('deleteConfirmModal').classList.add('show');
}

// Close delete confirmation
function closeDeleteConfirm() {
  document.getElementById('deleteConfirmModal').classList.remove('show');
}

// Delete note
async function deleteNote(noteId) {
  try {
    const token = localStorage.getItem('token');
    const tableId = localStorage.getItem('eventId');
    
    const res = await fetch(`${NOTES_API_BASE}/api/tables/${tableId}/admin-notes/${noteId}`, {
      method: 'DELETE',
      headers: { Authorization: token }
    });
    
    if (!res.ok) throw new Error('Failed to delete note');
    
    const result = await res.json();
    notes = result.adminNotes || [];
    
    closeDeleteConfirm();
    closeEditModal();
    renderNotes(document.getElementById('notesSearchInput')?.value);
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to delete note:', err);
    alert('Failed to delete note. Please try again.');
  }
}

// Setup sidebar
function setupSidebar() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('notesSidebar');
  const overlay = document.getElementById('notesSidebarOverlay');
  
  mobileMenuBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    overlay?.classList.toggle('show');
  });
  
  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('show');
  });
}

// Load sidebar user
function loadSidebarUser() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const payload = JSON.parse(atob(token.split('.')[1]));
    const userName = payload.name || payload.email || 'User';
    
    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = userName;
    
  } catch (err) {
    console.error('[ADMIN-NOTES] Failed to load sidebar user:', err);
  }
}

})(); // End of IIFE
