// =============================================================================
// REAL-TIME COLLABORATIVE SCHEDULE SYSTEM
// Google Sheets-like collaborative editing for LumDash Schedule
// =============================================================================

(function() {
// Guard to prevent multiple initializations
if (window.__collaborativeScheduleLoaded) {
  console.log('Collaborative schedule already loaded');
  return;
}
window.__collaborativeScheduleLoaded = true;

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

let tableData = { programs: [] };
let isOwner = false;
let currentEventId = null;
let searchQuery = '';
let filterDate = 'all';

// Collaborative state
const collaborativeState = {
  isEditing: false,
  activeField: null,
  version: 0,
  pendingOperations: [],
  acknowledgedOps: new Set()
};

// User presence tracking
const presenceSystem = {
  activeUsers: new Map(),
  fieldEditors: new Map(), // fieldKey -> {userId, userName, color, timestamp}
  userColors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff'],
  colorAssignments: new Map()
};

// =============================================================================
// SOCKET.IO CONNECTION MANAGEMENT
// =============================================================================

function ensureSocketConnection() {
  console.log('🔌 Checking Socket.IO connection...');
  
  if (window.socket) {
    console.log('✅ Socket.IO already available:', window.socket.connected ? 'connected' : 'disconnected');
    return Promise.resolve(window.socket);
  }
  
  // Try to initialize Socket.IO if not available
  if (typeof io !== 'undefined') {
    console.log('🔌 Initializing Socket.IO connection...');
    window.socket = io();
    
    window.socket.on('connect', () => {
      console.log('✅ Socket.IO connected successfully');
      // Join the event room for collaborative features
      if (currentEventId) {
        const userId = getCurrentUserId();
        const userName = getCurrentUserName();
        const userColor = getUserColor(userId);
        
        window.socket.emit('joinEventRoom', {
          eventId: currentEventId,
          userId,
          userName,
          userColor
        });
        console.log(`🏠 Joined event room for collaborative editing: ${currentEventId}`);
      }
    });
    
    window.socket.on('disconnect', () => {
      console.log('❌ Socket.IO disconnected');
    });
    
    return Promise.resolve(window.socket);
  } else {
    console.warn('❌ Socket.IO library not available - collaborative features disabled');
    return Promise.reject('Socket.IO not available');
  }
}

// =============================================================================
// OPERATIONAL TRANSFORM ENGINE
// =============================================================================

class OperationalTransform {
  static createOperation(type, data, userId, timestamp = Date.now()) {
    return {
      id: `op_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      userId,
      timestamp,
      version: collaborativeState.version + 1
    };
  }

  static transform(op1, op2) {
    // Operations on different programs don't conflict
    if (op1.data.programId !== op2.data.programId) {
      return { op1, op2 };
    }

    // Same field conflict - resolve by timestamp
    if (op1.data.field === op2.data.field) {
      if (op1.timestamp === op2.timestamp) {
        // Simultaneous edit - merge values
        const merged = this.mergeValues(op1.data.value, op2.data.value, op1.userId, op2.userId);
        return { 
          op1: { ...op1, data: { ...op1.data, value: merged } }, 
          op2: null 
        };
      }
      // Later timestamp wins
      return op1.timestamp > op2.timestamp ? { op1, op2: null } : { op1: null, op2 };
    }

    // Different fields - both can apply
    return { op1, op2 };
  }

  static mergeValues(val1, val2, user1, user2) {
    if (val1 === val2) return val1;
    if (!val1) return val2;
    if (!val2) return val1;
    return `${val1} [${user1}] | ${val2} [${user2}]`;
  }
}

// =============================================================================
// REAL-TIME COLLABORATION MANAGER
// =============================================================================

class CollaborationManager {
  constructor() {
    this.isInitialized = false;
    this.initializeWithRetry();
  }

  async initializeWithRetry(retries = 5) {
    try {
      await ensureSocketConnection();
      this.setupSocketListeners();
      this.setupFieldTracking();
      this.isInitialized = true;
      console.log('✅ Collaboration manager initialized successfully');
    } catch (error) {
      console.warn(`❌ Failed to initialize collaboration manager: ${error}`);
      if (retries > 0) {
        console.log(`🔄 Retrying in 2 seconds... (${retries} attempts left)`);
        setTimeout(() => this.initializeWithRetry(retries - 1), 2000);
      } else {
        console.error('❌ All retry attempts failed - collaborative features disabled');
      }
    }
  }

  setupSocketListeners() {
    if (!window.socket) {
      console.warn('❌ Socket.IO not available - collaborative listeners not registered');
      return;
    }

    console.log('🎧 Setting up collaborative socket listeners...');

    // Listen for operations from other users
    window.socket.on('programOperationReceived', (data) => {
      console.log('📨 Received program operation:', data);
      this.handleIncomingOperation(data);
    });

    // Listen for presence updates
    window.socket.on('presenceUpdated', (data) => {
      console.log('👥 Presence update:', data);
      this.handlePresenceUpdate(data);
    });

    // Listen for field editing status
    window.socket.on('fieldEditStarted', (data) => {
      console.log('✏️ Field edit started:', data);
      this.handleFieldEditingUpdate({ ...data, action: 'start' });
    });

    window.socket.on('fieldEditStopped', (data) => {
      console.log('🛑 Field edit stopped:', data);
      this.handleFieldEditingUpdate({ ...data, action: 'stop' });
    });

    // Listen for user presence
    window.socket.on('userJoined', (data) => {
      console.log('👋 User joined:', data);
      this.handleUserJoined(data);
    });

    window.socket.on('userLeft', (data) => {
      console.log('👋 User left:', data);
      this.handleUserLeft(data);
    });

    console.log('✅ Collaborative socket listeners registered');
  }

  setupFieldTracking() {
    console.log('🔍 Setting up field tracking...');
    
    // Track focus/blur events for all schedule fields
    document.addEventListener('focusin', (e) => {
      if (this.isScheduleField(e.target)) {
        console.log('🎯 Field focused:', e.target.getAttribute('data-field'));
        this.onFieldFocus(e.target);
      }
    });

    document.addEventListener('focusout', (e) => {
      if (this.isScheduleField(e.target)) {
        console.log('🎯 Field blurred:', e.target.getAttribute('data-field'));
        this.onFieldBlur(e.target);
      }
    });

    // Track input changes
    document.addEventListener('input', (e) => {
      if (this.isScheduleField(e.target)) {
        console.log('⌨️ Field input:', e.target.getAttribute('data-field'), '=', e.target.value);
        this.onFieldInput(e.target);
      }
    });

    console.log('✅ Field tracking setup complete');
  }

  isScheduleField(element) {
    const isInProgramEntry = element.closest('.program-entry');
    const isInputField = element.matches('input, textarea, select');
    const hasDataField = element.hasAttribute('data-field');
    
    const result = isInProgramEntry && isInputField && hasDataField;
    
    if (isInputField && !result) {
      console.log('🔍 Field not detected as schedule field:', {
        element: element.tagName,
        dataField: element.getAttribute('data-field'),
        isInProgramEntry: !!isInProgramEntry,
        hasDataField
      });
    }
    
    return result;
  }

  onFieldFocus(field) {
    if (!this.isInitialized) return;
    
    const programId = this.getProgramId(field);
    const fieldName = field.getAttribute('data-field');
    const fieldKey = `${programId}-${fieldName}`;

    console.log('🎯 Starting field edit:', fieldKey);

    collaborativeState.isEditing = true;
    collaborativeState.activeField = fieldKey;

    // Assign color to current user if not already assigned
    const userId = this.getCurrentUserId();
    const userColor = this.assignUserColor(userId);
    
    // Show field as being edited by current user
    this.markFieldAsEditing(field, 'You', userColor);

    // Broadcast editing status
    if (window.socket && window.socket.connected) {
      window.socket.emit('startFieldEdit', {
        eventId: currentEventId,
        fieldId: fieldKey,
        userId: userId,
        userName: this.getCurrentUserName(),
        userColor: userColor
      });
      console.log('📡 Broadcast field edit start:', fieldKey, 'by', this.getCurrentUserName());
    } else {
      console.warn('⚠️ Socket not connected - cannot broadcast field edit');
    }
  }

  onFieldBlur(field) {
    if (!this.isInitialized) return;
    
    const programId = this.getProgramId(field);
    const fieldName = field.getAttribute('data-field');
    const fieldKey = `${programId}-${fieldName}`;

    // Only if this was the active field
    if (collaborativeState.activeField === fieldKey) {
      console.log('🛑 Stopping field edit:', fieldKey);
      
      collaborativeState.isEditing = false;
      collaborativeState.activeField = null;

      // Clear editing indication
      this.clearFieldEditing(field);

      // Broadcast stop editing
      if (window.socket && window.socket.connected) {
        window.socket.emit('stopFieldEdit', {
          eventId: currentEventId,
          fieldId: fieldKey,
          userId: this.getCurrentUserId()
        });
        console.log('📡 Broadcast field edit stop:', fieldKey);
      }
    }
  }

  onFieldInput(field) {
    if (!this.isInitialized) return;
    
    const programId = this.getProgramId(field);
    const fieldName = field.getAttribute('data-field');
    const newValue = field.type === 'checkbox' ? field.checked : field.value;
    const oldValue = this.getCurrentFieldValue(programId, fieldName);

    console.log(`📝 Field input detected:`, {
      programId,
      fieldName,
      newValue,
      oldValue
    });

    // Create operation
    const operation = OperationalTransform.createOperation('UPDATE_FIELD', {
      programId,
      field: fieldName,
      value: newValue,
      oldValue: oldValue
    }, this.getCurrentUserId());

    console.log(`🔄 Created operation:`, operation);

    // Apply locally first (optimistic update)
    this.applyOperationLocally(operation);

    // Send to server with debouncing to avoid too many updates
    this.debouncedSendOperation(operation);
  }

  // Debounced sending to avoid flooding the server
  debouncedSendOperation(operation) {
    const fieldKey = `${operation.data.programId}-${operation.data.field}`;
    
    // Clear any existing timeout for this field
    if (this.sendTimeouts && this.sendTimeouts[fieldKey]) {
      clearTimeout(this.sendTimeouts[fieldKey]);
    }
    
    if (!this.sendTimeouts) {
      this.sendTimeouts = {};
    }
    
    // Set new timeout
    this.sendTimeouts[fieldKey] = setTimeout(() => {
      this.sendOperationToServer(operation);
      delete this.sendTimeouts[fieldKey];
    }, 500); // 500ms delay
  }

  applyOperationLocally(operation) {
    const { programId, field, value } = operation.data;
    
    console.log(`🔄 Applying operation locally:`, { programId, field, value });
    
    // Find and update the program
    const program = tableData.programs.find(p => p._id === programId);
    if (program) {
      const oldValue = program[field];
      program[field] = value;
      collaborativeState.version = operation.version;
      
      console.log(`📊 Updated program data: ${field} from "${oldValue}" to "${value}"`);
      
      // Update UI if needed (avoid if user is editing this field)
      const fieldKey = `${programId}-${field}`;
      if (collaborativeState.activeField !== fieldKey) {
        console.log(`🖼️ Updating UI for field: ${fieldKey}`);
        this.updateFieldInUI(programId, field, value);
      } else {
        console.log(`⏸️ Skipping UI update - user is currently editing this field`);
      }
    } else {
      console.warn(`❌ Program not found for operation: ${programId}`);
    }
  }

  async sendOperationToServer(operation) {
    console.log(`📡 Sending operation to server:`, operation);
    
    if (!window.socket || !window.socket.connected) {
      console.warn('⚠️ Socket not connected, falling back to REST API');
      await this.sendViaRestAPI(operation);
      return;
    }

    try {
      collaborativeState.pendingOperations.push(operation);
      
      const payload = {
        eventId: currentEventId,
        operation: operation,
        userId: this.getCurrentUserId(),
        userName: this.getCurrentUserName()
      };
      
      console.log(`📤 Emitting programOperation:`, payload);
      
      window.socket.emit('programOperation', payload);

      // Mark as acknowledged after a short delay (simulate server response)
      setTimeout(() => {
        collaborativeState.acknowledgedOps.add(operation.id);
        collaborativeState.pendingOperations = 
          collaborativeState.pendingOperations.filter(op => op.id !== operation.id);
      }, 100);

    } catch (error) {
      console.error('❌ Failed to send operation:', error);
      // Remove from pending
      collaborativeState.pendingOperations = 
        collaborativeState.pendingOperations.filter(op => op.id !== operation.id);
    }
  }

  async sendViaRestAPI(operation) {
    try {
      // Update the entire program
      const program = tableData.programs.find(p => p._id === operation.data.programId);
      if (!program) return;

      const response = await fetch(`${API_BASE}/api/tables/${currentEventId}/program-schedule`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': localStorage.getItem('token')
        },
        body: JSON.stringify({ programSchedule: tableData.programs })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log('✅ Program saved via REST API');
    } catch (error) {
      console.error('❌ Failed to save via REST API:', error);
      // Could show user notification here
    }
  }

  handleIncomingOperation(data) {
    const { operation, userId, userName } = data;
    
    console.log('📨 Received operation from server:', { operation, userId, userName });
    
    // Ignore our own operations
    if (userId === this.getCurrentUserId()) {
      console.log('🔄 Ignoring own operation');
      return;
    }
    
    if (collaborativeState.acknowledgedOps.has(operation.id)) {
      collaborativeState.acknowledgedOps.delete(operation.id);
      console.log('🔄 Operation already acknowledged');
      return;
    }

    console.log(`📨 Processing operation from ${userName}:`, operation);

    // Check for conflicts with pending operations
    const conflicts = collaborativeState.pendingOperations.filter(pendingOp => 
      this.operationsConflict(pendingOp, operation)
    );

    if (conflicts.length > 0) {
      console.log('⚠️ Operation conflicts detected, resolving...');
      this.resolveConflicts(conflicts, operation);
    } else {
      console.log('✅ No conflicts, applying operation directly');
      // No conflicts, apply directly
      this.applyOperationLocally(operation);
      
      // Show a subtle notification that another user made a change
      this.showChangeNotification(userName, operation);
    }
  }

  showChangeNotification(userName, operation) {
    console.log(`💬 ${userName} changed ${operation.data.field} to: ${operation.data.value}`);
    
    // You could add a toast notification here if desired
    // For now, just log it
  }

  operationsConflict(op1, op2) {
    return op1.data.programId === op2.data.programId && 
           op1.data.field === op2.data.field;
  }

  resolveConflicts(localOps, serverOp) {
    localOps.forEach(localOp => {
      const { op1: resolvedLocal, op2: resolvedServer } = 
        OperationalTransform.transform(localOp, serverOp);

      // Remove conflicting local operation
      collaborativeState.pendingOperations = 
        collaborativeState.pendingOperations.filter(op => op.id !== localOp.id);

      // Apply resolved operations
      if (resolvedServer) {
        this.applyOperationLocally(resolvedServer);
        
        // Show conflict notification if values were merged
        if (resolvedServer.data.value !== serverOp.data.value) {
          this.showConflictNotification(localOp, serverOp, resolvedServer);
        }
      }
    });
  }

  showConflictNotification(localOp, serverOp, resolvedOp) {
    const notification = document.createElement('div');
    notification.className = 'conflict-notification';
    notification.innerHTML = `
      <div class="conflict-content">
        <strong>⚠️ Editing Conflict Resolved</strong>
        <p>Your change and another user's change were merged for field "${localOp.data.field}"</p>
        <button onclick="this.parentElement.parentElement.remove()">Dismiss</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => notification.remove(), 5000);
  }

  handleUserJoined(data) {
    const { userId, userName, userColor } = data;
    
    // Assign the user's color to our local color assignments
    if (userColor && !presenceSystem.colorAssignments.has(userId)) {
      presenceSystem.colorAssignments.set(userId, userColor);
    }
    
    presenceSystem.activeUsers.set(userId, {
      name: userName,
      color: userColor || presenceSystem.colorAssignments.get(userId),
      lastSeen: Date.now()
    });
    this.updatePresenceIndicators();
    console.log(`👋 ${userName} joined the collaborative session with color ${userColor}`);
  }

  handleUserLeft(data) {
    const { userId } = data;
    presenceSystem.activeUsers.delete(userId);
    // Clear any field editing indicators for this user
    for (const [fieldKey, editor] of presenceSystem.fieldEditors.entries()) {
      if (editor.userId === userId) {
        presenceSystem.fieldEditors.delete(fieldKey);
      }
    }
    this.updatePresenceIndicators();
    console.log(`👋 User ${userId} left the collaborative session`);
  }

  handlePresenceUpdate(data) {
    const { userId, userName, isActive } = data;
    
    if (isActive) {
      presenceSystem.activeUsers.set(userId, {
        name: userName,
        color: this.assignUserColor(userId),
        lastSeen: Date.now()
      });
    } else {
      presenceSystem.activeUsers.delete(userId);
    }
    
    this.updatePresenceIndicators();
  }

  handleFieldEditingUpdate(data) {
    const { fieldId, userId, userName, userColor, action } = data;
    
    // Assign user color if provided and not already assigned
    if (userColor && !presenceSystem.colorAssignments.has(userId)) {
      presenceSystem.colorAssignments.set(userId, userColor);
    }
    
    if (action === 'start') {
      const finalColor = userColor || this.assignUserColor(userId);
      presenceSystem.fieldEditors.set(fieldId, {
        userId,
        userName,
        color: finalColor,
        timestamp: Date.now()
      });
      console.log(`✏️ ${userName} started editing ${fieldId} with color ${finalColor}`);
    } else if (action === 'stop') {
      presenceSystem.fieldEditors.delete(fieldId);
      console.log(`🛑 ${userName} stopped editing ${fieldId}`);
    }
    
    // Update field editing indicators
    const [programId, fieldName] = fieldId.split('-');
    this.updateFieldEditingIndicators(programId, fieldName);
  }

  // =============================================================================
  // UI MANAGEMENT
  // =============================================================================

  markFieldAsEditing(field, editorName, userColor = '#007bff') {
    // Don't show indicator for current user
    if (editorName === 'You') {
      console.log(`🙈 Skipping indicator for current user: ${editorName}`);
      return;
    }
    
    field.classList.add('field-being-edited');
    field.style.borderColor = userColor;
    field.style.boxShadow = `0 0 0 2px ${userColor}40`; // 40 for transparency
    
    // Remove any existing editing indicator
    const existingIndicator = field.parentNode.querySelector('.editing-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    // Add Google Sheets-style editing indicator
    const indicator = document.createElement('div');
    indicator.className = 'editing-indicator';
    indicator.innerHTML = `
      <div class="editor-avatar" style="background-color: ${userColor}">
        ${editorName.charAt(0).toUpperCase()}
      </div>
      <span class="editor-name">${editorName}</span>
    `;
    indicator.style.borderColor = userColor;
    
    // Position the indicator relative to the field
    field.parentNode.style.position = 'relative';
    field.parentNode.appendChild(indicator);
    
    console.log(`👤 Marked field as being edited by: ${editorName}`);
  }

  clearFieldEditing(field) {
    field.classList.remove('field-being-edited');
    field.style.borderColor = '';
    
    const indicator = field.parentNode.querySelector('.editing-indicator');
    if (indicator) indicator.remove();
  }

  updateFieldEditingIndicators(programId, fieldName) {
    const fieldElement = document.querySelector(
      `[data-program-id="${programId}"] [data-field="${fieldName}"]`
    );
    if (!fieldElement) {
      console.warn(`Field element not found: [data-program-id="${programId}"] [data-field="${fieldName}"]`);
      return;
    }

    const fieldKey = `${programId}-${fieldName}`;
    const editor = presenceSystem.fieldEditors.get(fieldKey);

    if (editor && editor.userId !== this.getCurrentUserId()) {
      console.log(`🖊️ Showing ${editor.userName} is editing ${fieldName}`);
      this.markFieldAsEditing(fieldElement, editor.userName, editor.color);
    } else {
      this.clearFieldEditing(fieldElement);
    }
  }

  updateFieldInUI(programId, field, value) {
    const fieldElement = document.querySelector(
      `[data-program-id="${programId}"] [data-field="${field}"]`
    );
    
    console.log(`🎯 Looking for field element:`, `[data-program-id="${programId}"] [data-field="${field}"]`);
    console.log(`🎯 Found element:`, fieldElement);
    
    if (fieldElement) {
      const isCurrentlyActive = document.activeElement === fieldElement;
      console.log(`🎯 Field currently active:`, isCurrentlyActive);
      
      if (!isCurrentlyActive) {
        const oldValue = fieldElement.type === 'checkbox' ? fieldElement.checked : fieldElement.value;
        
        if (fieldElement.type === 'checkbox') {
          fieldElement.checked = value;
        } else {
          fieldElement.value = value || '';
        }
        
        console.log(`✅ Updated field ${field}: "${oldValue}" → "${value}"`);
        
        // Trigger visual feedback
        fieldElement.style.background = '#e8f5e8';
        setTimeout(() => {
          fieldElement.style.background = '';
        }, 1000);
        
        // Dispatch change event to notify other systems
        fieldElement.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        console.log(`⏸️ Skipped update - field is currently being edited`);
      }
    } else {
      console.warn(`❌ Field element not found: [data-program-id="${programId}"] [data-field="${field}"]`);
      
      // Debug: list all available fields
      const allFields = document.querySelectorAll('[data-field]');
      console.log(`🔍 Available fields:`, Array.from(allFields).map(f => ({
        programId: f.closest('[data-program-id]')?.getAttribute('data-program-id'),
        field: f.getAttribute('data-field'),
        element: f
      })));
    }
  }

  updatePresenceIndicators() {
    let container = document.getElementById('presence-indicators');
    if (!container) {
      container = document.createElement('div');
      container.id = 'presence-indicators';
      container.className = 'presence-container';
      
      // Insert at top of schedule container
      const scheduleContainer = document.getElementById('programSections');
      if (scheduleContainer) {
        scheduleContainer.parentNode.insertBefore(container, scheduleContainer);
      }
    }

    container.innerHTML = '<h4>Active Users:</h4>';
    
    presenceSystem.activeUsers.forEach((user, userId) => {
      const indicator = document.createElement('div');
      indicator.className = 'user-presence';
      indicator.innerHTML = `
        <div class="user-avatar" style="background-color: ${user.color}">
          ${user.name.charAt(0).toUpperCase()}
        </div>
        <span>${user.name}</span>
      `;
      container.appendChild(indicator);
    });
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  getProgramId(field) {
    const programEntry = field.closest('.program-entry');
    const programId = programEntry?.getAttribute('data-program-id');
    
    if (!programId) {
      console.warn('🚨 No program ID found for field:', field, 'Program entry:', programEntry);
    }
    
    return programId;
  }

  getCurrentFieldValue(programId, fieldName) {
    console.log(`🔍 Looking for program with ID: ${programId}`);
    console.log(`📊 Available programs:`, tableData.programs);
    
    const program = tableData.programs.find(p => p._id === programId);
    const value = program ? program[fieldName] : '';
    
    console.log(`📊 Found program:`, program);
    console.log(`📊 Field value for ${fieldName}:`, value);
    
    return value;
  }

  getCurrentUserId() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.userId || payload.id || payload.sub;
    } catch {
      return null;
    }
  }

  getCurrentUserName() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return 'Anonymous';
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.fullName || payload.name || 'Unknown User';
    } catch {
      return 'Anonymous';
    }
  }

  assignUserColor(userId) {
    if (!presenceSystem.colorAssignments.has(userId)) {
      const colorIndex = presenceSystem.colorAssignments.size % presenceSystem.userColors.length;
      presenceSystem.colorAssignments.set(userId, presenceSystem.userColors[colorIndex]);
    }
    return presenceSystem.colorAssignments.get(userId);
  }

  getUserColor(userId) {
    return presenceSystem.colorAssignments.get(userId) || '#cccccc';
  }
}

// Global helper functions to be available outside the class
function getCurrentUserId() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.userId || payload.id || payload.sub;
  } catch {
    return null;
  }
}

function getCurrentUserName() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return 'Anonymous';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.fullName || payload.name || 'Unknown User';
  } catch {
    return 'Anonymous';
  }
}

function getUserColor(userId) {
  return presenceSystem.colorAssignments.get(userId) || '#cccccc';
}

// =============================================================================
// INITIALIZATION
// =============================================================================

let collaborationManager = null;

// Initialize collaborative features when page loads
window.initCollaborativeSchedule = function(eventId, programs, userIsOwner) {
  currentEventId = eventId;
  tableData.programs = programs || [];
  isOwner = userIsOwner;
  
  console.log('🚀 Initializing collaborative schedule for event:', eventId);
  
  // Initialize collaboration manager
  collaborationManager = new CollaborationManager();
  
  // Wait a bit for socket connection and then join event room
  setTimeout(() => {
    if (window.socket && window.socket.connected) {
      const userId = getCurrentUserId();
      const userName = getCurrentUserName();
      const userColor = presenceSystem.colorAssignments.get(userId) || presenceSystem.userColors[0];
      
      // Assign color if not already assigned
      if (!presenceSystem.colorAssignments.has(userId)) {
        const colorIndex = presenceSystem.colorAssignments.size % presenceSystem.userColors.length;
        presenceSystem.colorAssignments.set(userId, presenceSystem.userColors[colorIndex]);
      }
      
      console.log('🏠 Joining event room with user:', { userId, userName, userColor });
      
      window.socket.emit('joinEventRoom', { 
        eventId,
        userId,
        userName,
        userColor: presenceSystem.colorAssignments.get(userId)
      });
      
      window.socket.emit('updatePresence', { 
        eventId, 
        isActive: true,
        userId,
        userName,
        userColor: presenceSystem.colorAssignments.get(userId)
      });
    } else {
      console.warn('⚠️ Socket not connected when trying to join event room');
    }
  }, 1000);
  
  // Add collaborative CSS
  addCollaborativeStyles();
  
  console.log('✅ Collaborative schedule initialized');
};

// Add CSS for collaborative features
function addCollaborativeStyles() {
  if (document.getElementById('collaborative-styles')) return;
  
  const styles = document.createElement('style');
  styles.id = 'collaborative-styles';
  styles.textContent = `
    .field-being-edited {
      border: 2px solid !important;
      transition: all 0.2s ease;
    }
    
    .editing-indicator {
      position: absolute;
      top: -35px;
      right: 0px;
      background: white;
      border: 1px solid;
      border-radius: 16px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 500;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      white-space: nowrap;
    }
    
    .editor-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 10px;
      flex-shrink: 0;
    }
    
    .editor-name {
      color: #333;
      font-size: 11px;
    }
    
    .presence-container {
      padding: 10px;
      background: #f8f9fa;
      border-radius: 5px;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .user-presence {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    
    .user-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 14px;
    }
    
    .conflict-notification {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 5px;
      padding: 15px;
      max-width: 400px;
      z-index: 1000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .conflict-content button {
      margin-top: 10px;
      padding: 5px 10px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    
    .program-entry {
      position: relative;
    }
  `;
  
  document.head.appendChild(styles);
}

// Cleanup function
window.cleanupCollaborativeSchedule = function() {
  if (collaborationManager && window.socket) {
    window.socket.emit('updatePresence', { 
      eventId: currentEventId, 
      isActive: false,
      userId: collaborationManager.getCurrentUserId()
    });
    window.socket.emit('leaveEventRoom', { eventId: currentEventId });
  }
  
  collaborationManager = null;
  collaborativeState.isEditing = false;
  collaborativeState.activeField = null;
  presenceSystem.activeUsers.clear();
  presenceSystem.fieldEditors.clear();
  
  console.log('🧹 Collaborative schedule cleaned up');
};

// Export for use in main schedule file
window.CollaborativeSchedule = {
  init: window.initCollaborativeSchedule,
  cleanup: window.cleanupCollaborativeSchedule,
  // Debug function to test collaborative features
  test: function() {
    console.log('🧪 Testing collaborative features...');
    console.log('Socket.IO available:', typeof io !== 'undefined');
    console.log('Socket connected:', window.socket && window.socket.connected);
    console.log('Current event ID:', currentEventId);
    console.log('Collaboration manager:', !!collaborationManager);
    console.log('Active users:', presenceSystem.activeUsers.size);
    console.log('Field editors:', presenceSystem.fieldEditors.size);
    
    if (window.socket && window.socket.connected) {
      console.log('✅ Socket.IO is connected and ready');
      
      // Test joining event room
      const userId = getCurrentUserId();
      const userName = getCurrentUserName();
      const userColor = getUserColor(userId);
      
      console.log('User info:', { userId, userName, userColor });
      
      if (currentEventId) {
        window.socket.emit('joinEventRoom', {
          eventId: currentEventId,
          userId,
          userName,
          userColor
        });
        console.log('📡 Sent joinEventRoom event');
      }
    } else {
      console.log('❌ Socket.IO not connected');
    }
    
    return {
      socketAvailable: typeof io !== 'undefined',
      socketConnected: window.socket && window.socket.connected,
      eventId: currentEventId,
      collaborationManager: !!collaborationManager,
      activeUsers: presenceSystem.activeUsers.size,
      fieldEditors: presenceSystem.fieldEditors.size
    };
  }
};

})(); 