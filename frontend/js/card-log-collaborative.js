// =============================================================================
// CARD LOG COLLABORATIVE SYSTEM
// =============================================================================
// Real-time collaborative editing for the card log page
// Based on the schedule collaborative system but adapted for card log specific needs

console.log('🚀 Loading Card Log Collaborative System...');

// =============================================================================
// GLOBAL STATE
// =============================================================================

let cardLogCollaborationManager;
let currentUserId;
let currentUserName;
let currentEventId;

// Presence system for tracking active users and field editing
const cardLogPresenceSystem = {
  activeUsers: new Map(),
  fieldEditors: new Map(), // fieldId -> {userId, userName, color}
  colorAssignments: new Map(),
  userColors: [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#FFB347', '#87CEEB', '#98D8C8', '#F7DC6F'
  ]
};

// =============================================================================
// SOCKET CONNECTION
// =============================================================================

function ensureCardLogSocketConnection() {
  if (!window.socket) {
    console.log('📡 Socket.IO not available for card log collaboration');
    return false;
  }
  
  if (!window.socket.connected) {
    console.log('📡 Reconnecting socket for card log...');
    window.socket.connect();
  }
  
  return true;
}

// =============================================================================
// OPERATIONAL TRANSFORM SYSTEM
// =============================================================================

class CardLogOperationalTransform {
  static createOperation(type, data, userId, timestamp = Date.now()) {
    return {
      id: `op_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      userId,
      timestamp
    };
  }

  static transform(op1, op2) {
    // Handle transformation conflicts between two operations
    if (op1.data.date === op2.data.date && op1.data.rowIndex === op2.data.rowIndex && op1.data.field === op2.data.field) {
      // Same field being edited - use timestamp and user priority to determine resolution
      console.log(`🔀 Conflict detected: ${op1.userId} vs ${op2.userId} on ${op1.data.field}`);
      
      // If same user, keep latest
      if (op1.userId === op2.userId) {
        return op1.timestamp > op2.timestamp ? op1 : op2;
      }
      
      // Different users - merge values intelligently
      const mergedValue = this.mergeValues(op1.data.value, op2.data.value, op1.userId, op2.userId);
      
      return {
        ...op2,
        data: { ...op2.data, value: mergedValue },
        transformed: true,
        originalConflict: { op1: op1.data.value, op2: op2.data.value }
      };
    }
    return op2; // No conflict
  }

  static mergeValues(val1, val2, user1, user2) {
    // Enhanced merge strategy for card log fields
    if (val1 === val2) return val1;
    
    // Handle empty values
    if (!val1 || val1.trim() === '') return val2;
    if (!val2 || val2.trim() === '') return val1;
    
    // For card numbers, try to keep the most recent non-empty value
    if (this.isCardNumber(val1) && this.isCardNumber(val2)) {
      // Keep the longer/more complete value
      return val1.length >= val2.length ? val1 : val2;
    }
    
    // For other fields, create a merged value with conflict indicator
    return `${val1} / ${val2}`;
  }
  
  static isCardNumber(value) {
    if (!value) return false;
    // Check if it looks like a card number (digits, letters, common card formats)
    return /^[0-9a-zA-Z\-_cf]+$/i.test(value.toString().trim());
  }
}

// =============================================================================
// COLLABORATION MANAGER
// =============================================================================

class CardLogCollaborationManager {
  constructor() {
    this.pendingOperations = [];
    this.operationQueue = [];
    this.debounceTimers = new Map();
  }

  async initializeWithRetry(retries = 5) {
    console.log(`🔄 Initializing card log collaboration (attempt ${6-retries})`);
    
    if (!ensureCardLogSocketConnection()) {
      console.log('❌ Socket connection failed for card log collaboration');
      return false;
    }

    try {
      await this.initialize();
      console.log('✅ Card log collaboration initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Card log collaboration initialization failed:', error);
      if (retries > 0) {
        setTimeout(() => this.initializeWithRetry(retries - 1), 1000);
      }
      return false;
    }
  }

  async initialize() {
    try {
      console.log('🔧 Initializing card log collaboration...');
      
      // Get current event and user info
      currentEventId = localStorage.getItem('eventId');
      currentUserId = this.getCurrentUserId();
      currentUserName = this.getCurrentUserName();
      
      if (!currentEventId) {
        console.warn('❌ No current event ID found');
        return false;
      }
      
      console.log(`📋 Card log collaboration context: Event ${currentEventId}, User ${currentUserName} (${currentUserId})`);
      
      // Setup socket listeners and field tracking
      this.setupSocketListeners();
      this.setupFieldTracking();
      this.addCollaborativeStyles();
      
      // Listen for owner status changes from main system
      window.addEventListener('ownerStatusChanged', (event) => {
        console.log('[COLLAB] Owner status changed:', event.detail.isOwner);
        // Force refresh all row access control when owner status changes
        if (typeof refreshAllRowAccessControl === 'function') {
          refreshAllRowAccessControl();
        }
      });
      
      console.log('✅ Card log collaboration initialized successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize card log collaboration:', error);
      return false;
    }
  }

  setupSocketListeners() {
    console.log('👂 Setting up card log socket listeners...');

    // Handle incoming card log operations
    window.socket.on('cardLogOperationReceived', (data) => {
      // Safety check: Only process if on card-log page
      if (!document.querySelector('.card-log-page') && !document.querySelector('#card-log-container')) {
        return;
      }
      
      console.log('📨 Received card log operation:', data);
      this.handleIncomingOperation(data);
    });

    // Handle user presence updates (card-log specific)
    window.socket.on('cardLogUserJoined', (data) => this.handleUserJoined(data));
    window.socket.on('cardLogUserLeft', (data) => this.handleUserLeft(data));
    window.socket.on('presenceUpdate', (data) => this.handlePresenceUpdate(data));

    // Handle field editing indicators
    window.socket.on('fieldEditStart', (data) => this.handleFieldEditingUpdate(data, 'start'));
    window.socket.on('fieldEditStop', (data) => this.handleFieldEditingUpdate(data, 'stop'));
  }

  setupFieldTracking() {
    console.log('🎯 Setting up card log field tracking...');

    // Use event delegation for dynamic content
    document.addEventListener('focus', (e) => {
      if (this.isCardLogField(e.target)) {
        this.onFieldFocus(e.target);
      }
    }, true);

    document.addEventListener('blur', (e) => {
      if (this.isCardLogField(e.target)) {
        this.onFieldBlur(e.target);
      }
    }, true);

    document.addEventListener('input', (e) => {
      if (this.isCardLogField(e.target)) {
        this.onFieldInput(e.target);
      }
    }, true);
  }

  isCardLogField(element) {
    return (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') &&
           element.closest('.card-log-row');
  }

  onFieldFocus(field) {
    const { date, rowIndex, fieldName } = this.getFieldIdentifiers(field);
    if (!date || rowIndex === null || !fieldName) return;

    // Check if user can edit this row
    const row = field.closest('.card-log-row');
    const rowUser = row ? row.getAttribute('data-user') : '';
    if (!this.canEditRow(rowUser)) {
      field.blur(); // Remove focus if user can't edit
      this.showAccessDeniedMessage(rowUser);
      return;
    }

    const fieldId = `${date}-${rowIndex}-${fieldName}`;
    console.log(`🎯 Field focused: ${fieldName} in row ${rowIndex} on ${date}`);

    // Broadcast that we're starting to edit this field
    window.socket.emit('startFieldEdit', {
      eventId: currentEventId,
      fieldId: fieldId,
      userId: currentUserId,
      userName: currentUserName,
      timestamp: Date.now()
    });
  }

  onFieldBlur(field) {
    const { date, rowIndex, fieldName } = this.getFieldIdentifiers(field);
    if (!date || rowIndex === null || !fieldName) return;

    const fieldId = `${date}-${rowIndex}-${fieldName}`;
    console.log(`🎯 Field blurred: ${fieldName} in row ${rowIndex} on ${date}`);

    // Broadcast that we're stopping to edit this field
    window.socket.emit('stopFieldEdit', {
      eventId: currentEventId,
      fieldId: fieldId,
      userId: currentUserId,
      userName: currentUserName,
      timestamp: Date.now()
    });
  }

  onFieldInput(field) {
    const { date, rowIndex, fieldName } = this.getFieldIdentifiers(field);
    if (!date || rowIndex === null || !fieldName) return;

    const newValue = field.type === 'checkbox' ? field.checked : field.value;
    const oldValue = this.getCurrentFieldValue(date, rowIndex, fieldName);

    console.log(`⌨️ Field input: ${fieldName} = ${newValue} (was: ${oldValue})`);

    if (newValue !== oldValue) {
      const operation = CardLogOperationalTransform.createOperation('UPDATE_FIELD', {
        date: date,
        rowIndex: rowIndex,
        field: fieldName,
        value: newValue,
        oldValue: oldValue
      }, currentUserId);

      // Apply locally first
      this.applyOperationLocally(operation);

      // Send to server with debouncing
      this.debouncedSendOperation(operation);
    }
  }

  debouncedSendOperation(operation) {
    const fieldKey = `${operation.data.date}-${operation.data.rowIndex}-${operation.data.field}`;
    
    // Clear existing timer for this field
    if (this.debounceTimers.has(fieldKey)) {
      clearTimeout(this.debounceTimers.get(fieldKey));
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.sendOperationToServer(operation);
      this.debounceTimers.delete(fieldKey);
    }, 300); // 300ms debounce

    this.debounceTimers.set(fieldKey, timer);
  }

  applyOperationLocally(operation) {
    console.log(`🔄 Applying card log operation locally:`, operation);
    
    // Update the local data structure if it exists
    // This prevents conflicts with incoming socket updates
    this.updateLocalCardLogData(operation.data.date, operation.data.rowIndex, operation.data.field, operation.data.value);
  }

  async sendOperationToServer(operation) {
    try {
      console.log(`📡 Sending card log operation to server:`, operation);

      window.socket.emit('cardLogOperation', {
        eventId: currentEventId,
        operation: operation,
        userId: currentUserId,
        userName: currentUserName
      });

    } catch (error) {
      console.error('❌ Failed to send card log operation:', error);
    }
  }

  handleIncomingOperation(data) {
    // Safety check: Only process if on card-log page
    if (!document.querySelector('.card-log-page') && !document.querySelector('#card-log-container')) {
      return;
    }
    
    if (data.userId === currentUserId) {
      console.log('🔄 Ignoring own operation');
      return;
    }

    console.log(`📨 Processing incoming card log operation from ${data.userName}:`, data.operation);

    // Apply the operation to the UI
    this.updateFieldInUI(data.operation.data.date, data.operation.data.rowIndex, data.operation.data.field, data.operation.data.value);
    
    // Show notification
    this.showChangeNotification(data.userName, data.operation);
  }

  updateFieldInUI(date, rowIndex, field, value) {
    const fieldElement = document.querySelector(
      `[data-date="${date}"] .card-log-row[data-row-index="${rowIndex}"] [data-field="${field}"]`
    );
    
    if (fieldElement) {
      const isCurrentlyActive = document.activeElement === fieldElement;
      
      if (!isCurrentlyActive) {
        if (fieldElement.type === 'checkbox') {
          fieldElement.checked = value;
        } else {
          fieldElement.value = value || '';
        }
        
        console.log(`✅ Updated card log field ${field}: row ${rowIndex} on ${date}`);
        
        // Visual feedback
        fieldElement.style.background = '#e8f5e8';
        setTimeout(() => {
          fieldElement.style.background = '';
        }, 1000);
      } else {
        console.log(`⏸️ Skipped update - field is currently being edited`);
      }
    } else {
      console.warn(`❌ Card log field element not found: [data-date="${date}"] row ${rowIndex} field ${field}`);
    }
  }

  showChangeNotification(userName, operation) {
    const isConflict = operation.transformed && operation.originalConflict;
    
    const notification = document.createElement('div');
    notification.className = `collaboration-notification ${isConflict ? 'conflict-notification' : ''}`;
    
    if (isConflict) {
      notification.innerHTML = `
        <div class="conflict-header">⚠️ Conflict Resolved</div>
        <div class="conflict-details">
          ${userName} and you edited the same field.<br>
          <small>Original values: "${operation.originalConflict.op1}" / "${operation.originalConflict.op2}"</small><br>
          <small>Merged to: "${operation.data.value}"</small>
        </div>
      `;
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #FF9800;
        color: white;
        padding: 12px 16px;
        border-radius: 6px;
        z-index: 10000;
        font-size: 13px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 300px;
        border-left: 4px solid #F57C00;
      `;
    } else {
      notification.textContent = `${userName} updated ${operation.data.field}`;
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 10px 15px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
    }
    
    document.body.appendChild(notification);
    
    // Show conflicts longer than regular notifications
    const timeout = isConflict ? 8000 : 3000;
    setTimeout(() => {
      notification.remove();
    }, timeout);
  }

  handleUserJoined(data) {
    // Safety check: Only process if on card-log page
    if (!document.querySelector('.card-log-page') && !document.querySelector('#card-log-container')) {
      return;
    }
    
    console.log(`👋 User joined card log: ${data.userName}`);
    
    cardLogPresenceSystem.activeUsers.set(data.userId, {
      name: data.userName,
      color: this.assignUserColor(data.userId)
    });
    
    this.updatePresenceIndicators();
  }

  handleUserLeft(data) {
    // Safety check: Only process if on card-log page
    if (!document.querySelector('.card-log-page') && !document.querySelector('#card-log-container')) {
      return;
    }
    
    console.log(`👋 User left card log: ${data.userName}`);
    
    cardLogPresenceSystem.activeUsers.delete(data.userId);
    this.updatePresenceIndicators();
  }

  handlePresenceUpdate(data) {
    // Safety check: Only process if on card-log page
    if (!document.querySelector('.card-log-page') && !document.querySelector('#card-log-container')) {
      return;
    }
    
    if (data.userId !== currentUserId) {
      cardLogPresenceSystem.activeUsers.set(data.userId, {
        name: data.userName,
        color: this.assignUserColor(data.userId)
      });
      this.updatePresenceIndicators();
    }
  }

  handleFieldEditingUpdate(data, action) {
    // Safety check: Only process if on card-log page
    if (!document.querySelector('.card-log-page') && !document.querySelector('#card-log-container')) {
      return;
    }
    
    const { fieldId, userId, userName } = data;
    
    if (userId === currentUserId) return; // Don't show our own editing indicators

    if (action === 'start') {
      cardLogPresenceSystem.fieldEditors.set(fieldId, {
        userId,
        userName,
        color: this.assignUserColor(userId)
      });
      this.showFieldEditingIndicator(fieldId, userName, this.getUserColor(userId));
    } else if (action === 'stop') {
      cardLogPresenceSystem.fieldEditors.delete(fieldId);
      this.hideFieldEditingIndicator(fieldId);
    }
  }

  showFieldEditingIndicator(fieldId, userName, userColor) {
    const [date, rowIndex, fieldName] = fieldId.split('-');
    const fieldElement = document.querySelector(
      `[data-date="${date}"] .card-log-row[data-row-index="${rowIndex}"] [data-field="${fieldName}"]`
    );

    if (!fieldElement) return;

    // Remove existing indicator
    this.hideFieldEditingIndicator(fieldId);

    // Create editing indicator
    const indicator = document.createElement('div');
    indicator.className = 'cardlog-editing-indicator';
    indicator.innerHTML = `
      <div class="editor-avatar" style="background-color: ${userColor}">
        ${userName.charAt(0).toUpperCase()}
      </div>
      <span class="editor-name">${userName}</span>
    `;
    indicator.style.cssText = `
      position: absolute;
      top: -8px;
      right: -8px;
      background: ${userColor};
      color: white;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: bold;
      z-index: 1000;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 4px;
    `;

    // Style the field
    fieldElement.style.borderColor = userColor;
    fieldElement.style.boxShadow = `0 0 0 2px ${userColor}40`;

    // Position relative if needed
    if (getComputedStyle(fieldElement.parentElement).position === 'static') {
      fieldElement.parentElement.style.position = 'relative';
    }

    fieldElement.parentElement.appendChild(indicator);
  }

  hideFieldEditingIndicator(fieldId) {
    const [date, rowIndex, fieldName] = fieldId.split('-');
    const fieldElement = document.querySelector(
      `[data-date="${date}"] .card-log-row[data-row-index="${rowIndex}"] [data-field="${fieldName}"]`
    );

    if (fieldElement) {
      fieldElement.style.borderColor = '';
      fieldElement.style.boxShadow = '';

      const indicator = fieldElement.parentElement.querySelector('.cardlog-editing-indicator');
      if (indicator) {
        indicator.remove();
      }
    }
  }

  updatePresenceIndicators() {
    let container = document.getElementById('cardlog-presence-indicators');
    if (!container) {
      container = document.createElement('div');
      container.id = 'cardlog-presence-indicators';
      container.className = 'cardlog-presence-container';
      
      const cardlogContainer = document.getElementById('table-container');
      if (cardlogContainer) {
        cardlogContainer.parentNode.insertBefore(container, cardlogContainer);
      }
    }

    container.innerHTML = '<h4>Active Users:</h4>';
    
    cardLogPresenceSystem.activeUsers.forEach((user, userId) => {
      const indicator = document.createElement('div');
      indicator.className = 'cardlog-user-presence';
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

  getFieldIdentifiers(field) {
    const row = field.closest('.card-log-row');
    const daySection = field.closest('[data-date]');
    
    if (!row || !daySection) {
      console.warn('❌ Could not find row or day section for field:', field);
      return {};
    }

    const date = daySection.getAttribute('data-date');
    const rowIndex = parseInt(row.getAttribute('data-row-index'), 10);
    const fieldName = field.getAttribute('data-field') || field.name || field.className.split(' ')[0];

    return { date, rowIndex, fieldName };
  }

  getCurrentFieldValue(date, rowIndex, fieldName) {
    // This would need to be implemented based on your card log data structure
    // For now, return empty string
    return '';
  }

  updateLocalCardLogData(date, rowIndex, field, value) {
    // Update local data structure to prevent conflicts
    console.log(`📊 Updating local card log data: ${date} row ${rowIndex} ${field} = ${value}`);
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
    if (!cardLogPresenceSystem.colorAssignments.has(userId)) {
      const colorIndex = cardLogPresenceSystem.colorAssignments.size % cardLogPresenceSystem.userColors.length;
      cardLogPresenceSystem.colorAssignments.set(userId, cardLogPresenceSystem.userColors[colorIndex]);
    }
    return cardLogPresenceSystem.colorAssignments.get(userId);
  }

  getUserColor(userId) {
    return cardLogPresenceSystem.colorAssignments.get(userId) || '#cccccc';
  }

  // Check if current user can edit a specific row
  canEditRow(rowUser) {
    if (!rowUser) return true; // Allow if no user is set
    
    // Check if user is owner (can edit all rows) - check both window.isOwner and call the main system
    if (window.isOwner) return true;
    
    // Also check if the main card log system allows editing (as a fallback)
    if (typeof window.canEditRow === 'function') {
      const mainSystemResult = window.canEditRow(rowUser);
      if (mainSystemResult) return true;
    }
    
    // Non-owners can only edit their own rows
    const currentUser = this.getCurrentUserName();
    return rowUser === currentUser;
  }

  // Show access denied message
  showAccessDeniedMessage(rowUser) {
    const notification = document.createElement('div');
    notification.className = 'access-denied-notification';
    notification.textContent = `This row belongs to ${rowUser} and cannot be edited`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff4444;
      color: white;
      padding: 10px 15px;
      border-radius: 4px;
      z-index: 10000;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

      addCollaborativeStyles() {
      if (document.getElementById('cardlog-collaborative-styles')) return;

      const style = document.createElement('style');
      style.id = 'cardlog-collaborative-styles';
      style.textContent = `
        .cardlog-presence-container {
          background: #f8f9fa;
          padding: 10px;
          border-radius: 6px;
          margin-bottom: 15px;
          display: flex;
          align-items: center;
          gap: 15px;
          flex-wrap: wrap;
        }

        .cardlog-presence-container h4 {
          margin: 0;
          font-size: 14px;
          color: #666;
        }

        .cardlog-user-presence {
          display: flex;
          align-items: center;
          gap: 6px;
          background: white;
          padding: 4px 8px;
          border-radius: 15px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          font-size: 12px;
        }

        .cardlog-user-presence .user-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 10px;
      }

      .cardlog-editing-indicator .editor-avatar {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
        font-size: 8px;
      }

      .field-being-edited {
        animation: collaborativePulse 2s infinite;
      }

      @keyframes collaborativePulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .collaboration-notification {
        animation: slideInFromRight 0.3s ease-out;
      }

      @keyframes slideInFromRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    
    document.head.appendChild(style);
  }
}

// =============================================================================
// INITIALIZATION & CLEANUP
// =============================================================================

async function loadCardLogCollaborativeSystem() {
  console.log('🚀 Loading card log collaborative system...');
  
  if (cardLogCollaborationManager) {
    console.log('♻️ Card log collaboration already loaded');
    return;
  }

  cardLogCollaborationManager = new CardLogCollaborationManager();
  const success = await cardLogCollaborationManager.initializeWithRetry();
  
  if (success) {
    console.log('✅ Card log collaborative system loaded successfully');
  } else {
    console.error('❌ Failed to load card log collaborative system');
  }
}

function cleanupCardLogCollaborativeSystem() {
  console.log('🧹 Cleaning up card log collaborative features...');
  
  if (cardLogCollaborationManager && window.socket) {
    // Leave the event room
    if (currentEventId) {
      window.socket.emit('leaveEventRoom', {
        eventId: currentEventId,
        userId: currentUserId
      });
    }
    
    // Remove socket listeners
    window.socket.off('cardLogOperation');
    window.socket.off('userJoined');
    window.socket.off('userLeft');
    window.socket.off('presenceUpdate');
    window.socket.off('fieldEditStart');
    window.socket.off('fieldEditStop');
  }
  
  // Remove presence indicators
  const presenceContainer = document.getElementById('cardlog-presence-indicators');
  if (presenceContainer) {
    presenceContainer.remove();
  }
  
  // Remove styles
  const styles = document.getElementById('cardlog-collaborative-styles');
  if (styles) {
    styles.remove();
  }
  
  cardLogCollaborationManager = null;
  window.__cardLogEventRoomJoined = false;
  console.log('✅ Card log collaborative features cleaned up');
}

// =============================================================================
// GLOBAL EXPORTS
// =============================================================================

window.loadCardLogCollaborativeSystem = loadCardLogCollaborativeSystem;
window.cleanupCardLogCollaborativeSystem = cleanupCardLogCollaborativeSystem;

// Debug function to test collaborative system access control
window.testCollaborativeAccess = function() {
  console.log('[COLLAB-TEST] Testing collaborative system access control...');
  
  if (!cardLogCollaborationManager) {
    console.log('[COLLAB-TEST] ❌ Collaborative system not loaded');
    return;
  }
  
  console.log(`[COLLAB-TEST] window.isOwner: ${window.isOwner}`);
  console.log(`[COLLAB-TEST] window.canEditRow function exists: ${typeof window.canEditRow === 'function'}`);
  
  const testUsers = ['Chris Angeles', 'Elizabeth Schultz', 'Gabby Mostamand', 'Tammy B'];
  testUsers.forEach(user => {
    const canEdit = cardLogCollaborationManager.canEditRow(user);
    console.log(`[COLLAB-TEST] Can edit row owned by "${user}": ${canEdit}`);
    
    if (typeof window.canEditRow === 'function') {
      const mainSystemResult = window.canEditRow(user);
      console.log(`[COLLAB-TEST] Main system says can edit "${user}": ${mainSystemResult}`);
    }
  });
};

console.log('✅ Card log collaborative system module loaded'); 