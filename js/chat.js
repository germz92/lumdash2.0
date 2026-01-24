// Luma AI Chat Widget JavaScript
// Supports both event-specific and global dashboard modes

class ChatWidget {
  constructor(options = {}) {
    this.tableId = options.tableId || null;
    this.mode = this.tableId ? 'event' : 'global'; // 'event' or 'global'
    this.isOpen = false;
    this.isLoading = false;
    this.token = localStorage.getItem('token');
    this.API_BASE = window.API_BASE || '';
    this.conversationHistory = [];
    
    this.init();
  }

  init() {
    // Load components synchronously for reliability
    this.loadChatComponentsSync();
    this.setupEventListeners();
    this.updateSubtitle();
    this.addWelcomeMessage();
    this.updatePosition();
    console.log('[Chat] Widget initialized, mode:', this.mode);
  }
  
  loadChatComponentsSync() {
    // Determine path based on current location
    const isInSubDir = window.location.pathname.includes('/pages/');
    const basePath = isInSubDir ? '../' : '';
    
    // Load CSS if not already loaded
    if (!document.querySelector('link[href*="chat.css"]')) {
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = `${basePath}css/chat.css`;
      document.head.appendChild(cssLink);
    }

    // Create HTML if button doesn't exist
    if (!document.getElementById('chatButton')) {
      console.log('[Chat] Creating chat button...');
      this.createFallbackHTML();
    }
  }

  // Update chat position based on whether bottom nav is visible
  updatePosition() {
    const chatButton = document.getElementById('chatButton');
    const chatPanel = document.getElementById('chatPanel');
    const bottomNav = document.getElementById('bottomNav');
    
    // Check if bottom nav exists and is visible
    const hasVisibleBottomNav = bottomNav && 
      bottomNav.style.display !== 'none' && 
      getComputedStyle(bottomNav).display !== 'none';
    
    // Also check if we're on a dashboard-style page (no bottom nav)
    const isDashboardPage = document.querySelector('.events-page') || 
                           document.querySelector('.dashboard-layout') ||
                           document.querySelector('.dashboard-sidebar') ||
                           window.location.hash.includes('events') ||
                           !bottomNav;
    
    if (chatButton && chatPanel) {
      if (hasVisibleBottomNav && !isDashboardPage) {
        chatButton.classList.add('above-nav');
        chatPanel.classList.add('above-nav');
      } else {
        chatButton.classList.remove('above-nav');
        chatPanel.classList.remove('above-nav');
      }
    }
  }

  createFallbackHTML() {
    // Remove any existing elements first to prevent duplicates
    const existingButton = document.getElementById('chatButton');
    const existingPanel = document.getElementById('chatPanel');
    if (existingButton) existingButton.remove();
    if (existingPanel) existingPanel.remove();
    
    const chatHTML = `
      <div id="chatButton" class="chat-button" title="Ask Luma">
        <span class="material-symbols-outlined">lightbulb_2</span>
      </div>
      <div id="chatPanel" class="chat-panel">
        <div class="chat-header">
          <div class="chat-header-icon">
            <span class="material-symbols-outlined">lightbulb_2</span>
          </div>
          <div class="chat-header-info">
            <div class="chat-header-title">Luma</div>
            <div class="chat-subtitle" id="chatSubtitle">AI Assistant</div>
          </div>
          <button id="closeChatBtn" class="close-chat-btn">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div id="chatMessages" class="chat-messages"></div>
        <div class="chat-input-container">
          <input id="chatInput" type="text" placeholder="Ask Luma anything..." class="chat-input" autocomplete="off">
          <button id="sendBtn" class="send-btn">
            <span class="material-symbols-outlined">arrow_upward</span>
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', chatHTML);
    
    // Verify button was created
    const newButton = document.getElementById('chatButton');
    if (newButton) {
      console.log('[Chat] Button successfully added to DOM');
      // Force visibility
      newButton.style.display = 'flex';
      newButton.style.visibility = 'visible';
    } else {
      console.error('[Chat] Failed to add button to DOM!');
    }
  }

  setupEventListeners() {
    const chatButton = document.getElementById('chatButton');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const sendBtn = document.getElementById('sendBtn');
    const chatInput = document.getElementById('chatInput');
    const chatPanel = document.getElementById('chatPanel');

    if (chatButton) {
      chatButton.addEventListener('click', () => this.toggleChat());
    }

    if (closeChatBtn) {
      closeChatBtn.addEventListener('click', () => this.closeChat());
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }

    if (chatInput) {
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !this.isLoading) {
          this.sendMessage();
        }
      });
    }

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closeChat();
      }
    });

    // Close when clicking outside (optional)
    document.addEventListener('click', (e) => {
      if (this.isOpen && chatPanel && chatButton) {
        if (!chatPanel.contains(e.target) && !chatButton.contains(e.target)) {
          // Uncomment to enable click-outside-to-close
          // this.closeChat();
        }
      }
    });
  }

  updateSubtitle() {
    const subtitle = document.getElementById('chatSubtitle');
    if (subtitle) {
      if (this.mode === 'event') {
        const eventTitle = document.getElementById('eventTitle')?.textContent || 
                          document.querySelector('.event-title')?.textContent ||
                          'Event Assistant';
        subtitle.textContent = eventTitle;
      } else {
        subtitle.textContent = 'Your AI Assistant';
      }
    }
  }

  toggleChat() {
    if (this.isOpen) {
      this.closeChat();
    } else {
      this.openChat();
    }
  }

  openChat() {
    const chatPanel = document.getElementById('chatPanel');
    const chatButton = document.getElementById('chatButton');
    
    if (chatPanel) {
      chatPanel.style.display = 'flex';
      chatPanel.classList.add('open');
      this.isOpen = true;
      
      // Update button state
      if (chatButton) {
        chatButton.classList.add('active');
      }
      
      // Focus on input
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        setTimeout(() => chatInput.focus(), 100);
      }
    }
  }

  closeChat() {
    const chatPanel = document.getElementById('chatPanel');
    const chatButton = document.getElementById('chatButton');
    
    if (chatPanel) {
      chatPanel.classList.remove('open');
      chatPanel.style.display = 'none';
      this.isOpen = false;
      
      // Update button state
      if (chatButton) {
        chatButton.classList.remove('active');
      }
    }
  }

  addWelcomeMessage() {
    let welcomeMessage;
    
    if (this.mode === 'event') {
      const eventTitle = document.getElementById('eventTitle')?.textContent || 'this event';
      welcomeMessage = `Hi! I'm Luma, your AI assistant for **${eventTitle}**. I can help you find information about schedules, crew, gear, travel, and more. What would you like to know?`;
    } else {
      welcomeMessage = `Hi! I'm Luma, your AI assistant. I can help you with:\n\n• **Event dates** - "What day is the GuidePoint Event?"\n• **Staff schedules** - "Is Germaine working on Feb 25?"\n• **Your upcoming events** - "What events do I have this month?"\n\nWhat would you like to know?`;
    }
    
    this.addMessage('assistant', welcomeMessage);
    this.conversationHistory.push({ role: 'assistant', content: welcomeMessage });
  }

  async sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (!message || this.isLoading) return;

    // Add user message to chat
    this.addMessage('user', message);
    chatInput.value = '';

    // Show typing indicator
    this.showTypingIndicator();
    this.isLoading = true;
    this.updateSendButton(false);

    // Show thinking message
    setTimeout(() => {
      if (this.isLoading) {
        this.hideTypingIndicator();
        const messageContainer = this.addStreamingMessage('assistant');
        messageContainer.innerHTML = 'Thinking<span class="thinking-dots">...</span>';
      }
    }, 200);

    try {
      // Determine endpoint based on mode
      const endpoint = this.mode === 'event' 
        ? `${this.API_BASE}/api/chat/${this.tableId}`
        : `${this.API_BASE}/api/chat/global`;

      // Gather context
      const pageContext = {
        currentPage: this.getCurrentPageName(),
        mode: this.mode,
        browserLanguage: navigator.language || 'en-US',
        pageData: this.getPageSpecificContext()
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token
        },
        body: JSON.stringify({ 
          message,
          conversationHistory: this.conversationHistory.slice(-6),
          pageContext 
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Add user message to history
      this.conversationHistory.push({ role: 'user', content: message });
      
      // Remove typing indicator
      this.hideTypingIndicator();
      
      // Get or reuse message container
      let messageContainer = document.querySelector('.chat-message.assistant:last-child .message-content');
      if (!messageContainer || !messageContainer.innerHTML.includes('Thinking')) {
        messageContainer = this.addStreamingMessage('assistant');
      }
      
      // Handle streaming response
      await this.handleStreamingResponse(response, messageContainer);

    } catch (error) {
      console.error('Chat error:', error);
      this.hideTypingIndicator();
      
      let errorMessage = 'Sorry, I encountered an error. Please try again.';
      if (error.message.includes('401') || error.message.includes('403')) {
        errorMessage = 'Please log in to use the chat feature.';
      } else if (error.message.includes('404')) {
        errorMessage = this.mode === 'event' 
          ? 'Event not found. Please refresh the page.'
          : 'Chat service unavailable. Please try again.';
      }
      
      this.addMessage('assistant', errorMessage);
    } finally {
      this.isLoading = false;
      this.updateSendButton(true);
    }
  }

  addMessage(sender, content) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    
    const senderLabel = sender === 'user' ? 'You' : 'Luma';
    
    messageDiv.innerHTML = `
      <div class="message-sender">${senderLabel}</div>
      <div class="message-content">${this.formatMessage(content)}</div>
    `;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return messageDiv;
  }

  addStreamingMessage(sender) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return null;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    
    const senderLabel = sender === 'user' ? 'You' : 'Luma';
    
    messageDiv.innerHTML = `
      <div class="message-sender">${senderLabel}</div>
      <div class="message-content"></div>
    `;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return messageDiv.querySelector('.message-content');
  }

  async handleStreamingResponse(response, messageContainer) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.error) {
                messageContainer.innerHTML = `<span style="color: #ef4444;">${data.error}</span>`;
                return;
              }
              
              if (data.content) {
                fullResponse += data.content;
                messageContainer.innerHTML = this.formatMessage(fullResponse) + '<span class="typing-cursor">|</span>';
                
                // Auto-scroll
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages) {
                  chatMessages.scrollTop = chatMessages.scrollHeight;
                }
              }
              
              if (data.done) {
                messageContainer.innerHTML = this.formatMessage(fullResponse);
                this.conversationHistory.push({ role: 'assistant', content: fullResponse });
                
                // Trim history
                if (this.conversationHistory.length > 10) {
                  this.conversationHistory = this.conversationHistory.slice(-10);
                }
                return;
              }
            } catch (parseError) {
              console.error('Error parsing streaming data:', parseError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      messageContainer.innerHTML = '<span style="color: #ef4444;">Connection error. Please try again.</span>';
    }
  }

  formatMessage(content) {
    return content
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace;">$1</code>');
  }

  showTypingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
      Luma is thinking
      <div class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
    `;

    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  hideTypingIndicator() {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }
    
    // Also remove any "thinking" messages
    const thinkingMessages = document.querySelectorAll('.message-content');
    thinkingMessages.forEach(msg => {
      if (msg.innerHTML.includes('Thinking<span class="thinking-dots">')) {
        msg.closest('.chat-message')?.remove();
      }
    });
  }

  updateSendButton(enabled) {
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.disabled = !enabled;
    }
  }

  getCurrentPageName() {
    const path = window.location.pathname;
    const hash = window.location.hash;
    
    // Dashboard pages
    if (path.includes('events') || hash.includes('events')) return 'events';
    if (path.includes('users') || hash.includes('users')) return 'users';
    if (path.includes('my-tasks') || hash.includes('my-tasks')) return 'my-tasks';
    if (path.includes('call-times') || hash.includes('call-times')) return 'call-times';
    if (path.includes('inventory')) return 'inventory';
    if (path.includes('crew-planner')) return 'crew-planner';
    if (path.includes('crew-calendar')) return 'crew-calendar';
    if (path.includes('event-calendar')) return 'event-calendar';
    if (path.includes('flights')) return 'flights';
    
    // Event pages
    if (hash.includes('general')) return 'general';
    if (hash.includes('schedule')) return 'schedule';
    if (hash.includes('crew')) return 'crew';
    if (hash.includes('shotlist')) return 'shotlist';
    if (hash.includes('gear')) return 'gear';
    if (hash.includes('tasks') || hash.includes('todos')) return 'tasks';
    if (hash.includes('travel')) return 'travel';
    if (hash.includes('card-log')) return 'card-log';
    if (hash.includes('documents')) return 'documents';
    if (hash.includes('notes')) return 'admin-notes';
    
    return 'dashboard';
  }

  getPageSpecificContext() {
    const currentPage = this.getCurrentPageName();
    return { page: currentPage, mode: this.mode };
  }

  // Update tableId dynamically (for SPA navigation)
  setTableId(tableId) {
    this.tableId = tableId;
    this.mode = tableId ? 'event' : 'global';
    this.updateSubtitle();
    this.updatePosition();
  }

  destroy() {
    const chatButton = document.getElementById('chatButton');
    const chatPanel = document.getElementById('chatPanel');
    
    if (chatButton) chatButton.remove();
    if (chatPanel) chatPanel.remove();
    
    console.log('Chat widget destroyed');
  }
}

// ========================================
// GLOBAL INITIALIZATION
// ========================================

// Initialize chat globally
window.initChat = function(tableId) {
  const chatButton = document.getElementById('chatButton');
  
  // If widget exists with same tableId and button is in DOM, just update
  if (window.chatWidget && chatButton && window.chatWidget.tableId === tableId) {
    window.chatWidget.updateSubtitle();
    window.chatWidget.updatePosition();
    return;
  }
  
  // Clean up existing if needed
  if (window.chatWidget) {
    window.chatWidget.destroy();
    window.chatWidget = null;
  }
  
  window.chatWidget = new ChatWidget({ tableId });
};

// Initialize global chat (for dashboard pages without tableId)
window.initGlobalChat = function() {
  const chatButton = document.getElementById('chatButton');
  console.log('[Chat] initGlobalChat called, button exists:', !!chatButton, 'widget exists:', !!window.chatWidget);
  
  // If widget exists in global mode and button is in DOM, just update position
  if (window.chatWidget && chatButton && window.chatWidget.mode === 'global') {
    console.log('[Chat] Already in global mode, updating position');
    window.chatWidget.updatePosition();
    return;
  }
  
  // Clean up existing if needed
  if (window.chatWidget) {
    console.log('[Chat] Destroying existing widget (switching modes)');
    window.chatWidget.destroy();
    window.chatWidget = null;
  }
  
  console.log('[Chat] Creating new ChatWidget in global mode');
  window.chatWidget = new ChatWidget({ tableId: null });
};

// Toggle chat from any page
window.toggleChat = function() {
  if (window.chatWidget) {
    window.chatWidget.toggleChat();
  } else {
    // Initialize if not exists
    window.initGlobalChat();
    setTimeout(() => window.chatWidget?.openChat(), 100);
  }
};

// Helper to get tableId from URL
function getTableIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return window.currentTableId || 
         urlParams.get('id') ||
         (window.location.hash.match(/id=([^&]+)/) || [])[1];
}

// Initialize chat based on current context
function initializeChatForCurrentPage() {
  const tableId = getTableIdFromUrl();
  const chatButton = document.getElementById('chatButton');
  
  console.log('[Chat] initializeChatForCurrentPage - tableId:', tableId, 'button:', !!chatButton, 'widget:', !!window.chatWidget);
  
  // Check if chat already exists, is correct mode, AND button is in DOM
  if (window.chatWidget && chatButton) {
    const currentMode = window.chatWidget.mode;
    const needsEvent = !!tableId;
    const needsGlobal = !tableId;
    
    // If mode matches and button exists, we're good
    if ((needsEvent && currentMode === 'event') || (needsGlobal && currentMode === 'global')) {
      console.log('[Chat] Mode matches and button exists, skipping init');
      window.chatWidget.updatePosition();
      return;
    }
  }
  
  // Clean up if widget exists but button is missing
  if (window.chatWidget && !chatButton) {
    console.log('[Chat] Widget exists but button missing, clearing widget reference');
    window.chatWidget = null;
  }
  
  // Initialize appropriate chat mode
  if (tableId) {
    console.log('[Chat] Initializing event mode with tableId:', tableId);
    window.initChat(tableId);
  } else {
    console.log('[Chat] Initializing global mode');
    window.initGlobalChat();
  }
}

// Auto-initialize based on page context
document.addEventListener('DOMContentLoaded', function() {
  // Delay initialization slightly to ensure page is ready
  setTimeout(initializeChatForCurrentPage, 300);
});

// Re-initialize on hash change (SPA navigation)
window.addEventListener('hashchange', function() {
  // Delay to allow page content to load
  setTimeout(initializeChatForCurrentPage, 400);
});

// Also listen for popstate (back/forward navigation)
window.addEventListener('popstate', function() {
  setTimeout(initializeChatForCurrentPage, 400);
});

// Periodic check to ensure chat button exists and is visible
let chatCheckInterval = null;
function startChatButtonMonitor() {
  if (chatCheckInterval) return;
  
  chatCheckInterval = setInterval(() => {
    const chatButton = document.getElementById('chatButton');
    
    if (!chatButton) {
      console.log('[Chat] Button not in DOM, reinitializing...');
      window.chatWidget = null;
      initializeChatForCurrentPage();
    } else {
      // Check if button is actually visible
      const style = getComputedStyle(chatButton);
      const isHidden = style.display === 'none' || 
                       style.visibility === 'hidden' || 
                       style.opacity === '0' ||
                       chatButton.offsetParent === null;
      
      if (isHidden) {
        console.log('[Chat] Button exists but is hidden, forcing visible');
        chatButton.style.display = 'flex';
        chatButton.style.visibility = 'visible';
        chatButton.style.opacity = '1';
      }
    }
  }, 1000);
}

// Start monitoring after initial load
setTimeout(startChatButtonMonitor, 500);

// Expose for manual initialization from other scripts
window.ensureChatInitialized = initializeChatForCurrentPage;
