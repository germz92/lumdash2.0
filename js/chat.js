// AI Chat Widget JavaScript
class ChatWidget {
  constructor(tableId) {
    this.tableId = tableId;
    this.isOpen = false;
    this.isLoading = false;
    this.token = localStorage.getItem('token');
    this.API_BASE = window.API_BASE || '';
    this.conversationHistory = []; // Store conversation for context
    
    this.init();
  }

  init() {
    // Load chat HTML and CSS if not already loaded
    this.loadChatComponents().then(() => {
      this.setupEventListeners();
      this.addWelcomeMessage();
    });
  }

  async loadChatComponents() {
    // Load CSS if not already loaded
    if (!document.querySelector('link[href*="chat.css"]')) {
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      // Check if we're in a subdirectory (like pages/)
      const isInSubDir = window.location.pathname.includes('/pages/');
      cssLink.href = isInSubDir ? '../css/chat.css' : 'css/chat.css';
      document.head.appendChild(cssLink);
    }

    // Load HTML if not already loaded
    if (!document.getElementById('chatButton')) {
      try {
        // Check if we're in a subdirectory (like pages/)
        const isInSubDir = window.location.pathname.includes('/pages/');
        const chatHtmlPath = isInSubDir ? '../components/chat.html' : 'components/chat.html';
        const response = await fetch(chatHtmlPath);
        const html = await response.text();
        document.body.insertAdjacentHTML('beforeend', html);
      } catch (error) {
        console.error('Failed to load chat component:', error);
        // Fallback - create basic HTML
        this.createFallbackHTML();
      }
    }
  }

  createFallbackHTML() {
    const chatHTML = `
      <div id="chatButton" class="chat-button">
        <span class="material-symbols-outlined">smart_toy</span>
      </div>
      <div id="chatPanel" class="chat-panel">
        <div class="chat-header">
          <strong>Event Assistant</strong>
          <button id="closeChatBtn" class="close-chat-btn">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div id="chatMessages" class="chat-messages"></div>
        <div class="chat-input-container">
          <input id="chatInput" type="text" placeholder="Ask about this event..." class="chat-input">
          <button id="sendBtn" class="send-btn">
            <span class="material-symbols-outlined">send</span>
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', chatHTML);
  }

  setupEventListeners() {
    const chatButton = document.getElementById('chatButton');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const sendBtn = document.getElementById('sendBtn');
    const chatInput = document.getElementById('chatInput');

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
    if (chatPanel) {
      chatPanel.style.display = 'flex';
      this.isOpen = true;
      
      // Focus on input
      const chatInput = document.getElementById('chatInput');
      if (chatInput) {
        setTimeout(() => chatInput.focus(), 100);
      }
    }
  }

  closeChat() {
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) {
      chatPanel.style.display = 'none';
      this.isOpen = false;
    }
  }

  addWelcomeMessage() {
    const eventTitle = document.getElementById('eventTitle')?.textContent || 'this event';
    const welcomeMessage = `Hi! I'm Luma, your AI assistant for ${eventTitle}. I can help you find information about schedules, crew assignments, gear lists, travel details, and more. What would you like to know? 📸`;
    this.addMessage('assistant', welcomeMessage);
    
    // Add welcome message to conversation history
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

    // Show immediate thinking message for faster perceived response
    setTimeout(() => {
      if (this.isLoading) {
        this.hideTypingIndicator();
        const messageContainer = this.addStreamingMessage('assistant');
        messageContainer.innerHTML = 'Let me check that for you...<span class="thinking-dots">...</span>';
      }
    }, 200);

    try {
      // Gather comprehensive context about the current page/state
      const pageContext = {
        currentPage: this.getCurrentPageName(),
        activeTab: document.querySelector('.tab-button.active')?.textContent?.trim() || null,
        currentView: document.querySelector('.view-container.active')?.id || null,
        browserLanguage: navigator.language || 'en-US',
        pageData: this.getPageSpecificContext()
      };

      const response = await fetch(`${this.API_BASE}/api/chat/${this.tableId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': this.token
        },
        body: JSON.stringify({ 
          message,
          conversationHistory: this.conversationHistory,
          pageContext 
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Add user message to conversation history immediately
      this.conversationHistory.push({ role: 'user', content: message });
      
      // Remove typing indicator and prepare for streaming response
      this.hideTypingIndicator();
      
      // Check if we already have a thinking message, if so reuse it
      let messageContainer = document.querySelector('.chat-message.assistant:last-child .message-content');
      if (!messageContainer || !messageContainer.innerHTML.includes('Let me check')) {
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
        errorMessage = 'Event not found. Please refresh the page.';
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
                messageContainer.innerHTML = `<span style="color: #cc0007;">${data.error}</span>`;
                return;
              }
              
              if (data.content) {
                fullResponse += data.content;
                messageContainer.innerHTML = this.formatMessage(fullResponse) + '<span class="typing-cursor">|</span>';
                
                // Auto-scroll to bottom
                const chatMessages = document.getElementById('chatMessages');
                if (chatMessages) {
                  chatMessages.scrollTop = chatMessages.scrollHeight;
                }
              }
              
              if (data.done) {
                // Remove typing cursor and finalize message
                messageContainer.innerHTML = this.formatMessage(fullResponse);
                
                // Add to conversation history
                this.conversationHistory.push({ role: 'assistant', content: fullResponse });
                
                        // Keep only last 8 messages to avoid memory issues and improve speed
        if (this.conversationHistory.length > 8) {
          this.conversationHistory = this.conversationHistory.slice(-8);
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
      messageContainer.innerHTML = '<span style="color: #cc0007;">Connection error. Please try again.</span>';
    }
  }

  formatMessage(content) {
    // Basic formatting for AI responses
    return content
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  showTypingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
      Assistant is typing
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
  }

  updateSendButton(enabled) {
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.disabled = !enabled;
    }
  }

  getCurrentPageName() {
    // Try to detect current page from URL hash, body class, or nav
    const hash = window.location.hash;
    if (hash.includes('/general')) return 'general';
    if (hash.includes('/schedule')) return 'schedule';
    if (hash.includes('/crew')) return 'crew';
    if (hash.includes('/shotlist')) return 'shotlist';
    if (hash.includes('/gear')) return 'gear';
    if (hash.includes('/tasks')) return 'tasks';
    if (hash.includes('/travel')) return 'travel-accommodation';
    if (hash.includes('/card-log')) return 'card-log';
    if (hash.includes('/documents')) return 'documents';
    if (hash.includes('/notes')) return 'notes';
    if (hash.includes('/inventory')) return 'inventory-management';
    
    // Check active nav item
    const activeNav = document.querySelector('.bottom-nav-material a.active, nav a.active');
    if (activeNav) {
      const dataPage = activeNav.getAttribute('data-page');
      if (dataPage) return dataPage;
      
      const navText = activeNav.textContent?.toLowerCase().trim();
      if (navText) return navText;
    }
    
    // Check body class
    const bodyClass = document.body.className;
    if (bodyClass.includes('page-')) {
      const pageMatch = bodyClass.match(/page-(\w+)/);
      if (pageMatch) return pageMatch[1];
    }
    
    return 'dashboard';
  }

  getPageSpecificContext() {
    const currentPage = this.getCurrentPageName();
    const context = { page: currentPage };
    
    try {
      switch (currentPage) {
        case 'schedule':
          context.visibleSessions = this.getVisibleScheduleItems();
          context.currentDate = this.getCurrentScheduleDate();
          break;
          
        case 'crew':
          context.visibleCrew = this.getVisibleCrewMembers();
          context.selectedDate = this.getCurrentCrewDate();
          break;
          
        case 'gear':
          context.currentGearList = this.getCurrentGearList();
          context.gearCategory = this.getCurrentGearCategory();
          break;
          
        case 'tasks':
          context.taskFilter = this.getCurrentTaskFilter();
          break;
          
        case 'shotlist':
          context.currentShotlist = this.getCurrentShotlist();
          break;
          
        case 'card-log':
          context.selectedDate = this.getCurrentCardLogDate();
          break;
          
        default:
          break;
      }
    } catch (error) {
      // Silently handle errors in context gathering
      console.debug('Error gathering page context:', error);
    }
    
    return context;
  }

  getVisibleScheduleItems() {
    const scheduleItems = document.querySelectorAll('.schedule-item:not([style*="display: none"])');
    return Array.from(scheduleItems).slice(0, 5).map(item => ({
      name: item.querySelector('.session-name')?.textContent?.trim(),
      time: item.querySelector('.session-time')?.textContent?.trim(),
      location: item.querySelector('.session-location')?.textContent?.trim()
    })).filter(item => item.name);
  }

  getCurrentScheduleDate() {
    const dateSelector = document.querySelector('#scheduleDate, .date-selector input[type="date"]');
    return dateSelector?.value || new Date().toISOString().split('T')[0];
  }

  getVisibleCrewMembers() {
    const crewItems = document.querySelectorAll('.crew-row:not([style*="display: none"])');
    return Array.from(crewItems).slice(0, 5).map(item => ({
      name: item.querySelector('.crew-name')?.textContent?.trim(),
      role: item.querySelector('.crew-role')?.textContent?.trim(),
      date: item.querySelector('.crew-date')?.textContent?.trim()
    })).filter(item => item.name);
  }

  getCurrentCrewDate() {
    const dateSelector = document.querySelector('#crewDate, .crew-date-selector');
    return dateSelector?.value || new Date().toISOString().split('T')[0];
  }

  getCurrentGearList() {
    const activeList = document.querySelector('.gear-list-tab.active, .current-list-indicator');
    return activeList?.textContent?.trim() || 'Main List';
  }

  getCurrentGearCategory() {
    const activeCategory = document.querySelector('.gear-category.active, .category-tab.active');
    return activeCategory?.textContent?.trim() || 'All';
  }

  getCurrentTaskFilter() {
    const filterSelect = document.querySelector('#taskFilter, .task-filter-select');
    return filterSelect?.value || 'all';
  }

  getCurrentShotlist() {
    const activeShotlist = document.querySelector('.shotlist-tab.active, .current-shotlist');
    return activeShotlist?.textContent?.trim() || 'Main Shotlist';
  }

  getCurrentCardLogDate() {
    const dateSelector = document.querySelector('#cardLogDate, .card-log-date');
    return dateSelector?.value || new Date().toISOString().split('T')[0];
  }

  destroy() {
    // Remove chat elements from DOM
    const chatButton = document.getElementById('chatButton');
    const chatPanel = document.getElementById('chatPanel');
    
    if (chatButton) chatButton.remove();
    if (chatPanel) chatPanel.remove();
    
    // Remove chat CSS if no other instance needs it
    const chatCss = document.querySelector('link[href*="chat.css"]');
    if (chatCss) chatCss.remove();
    
    console.log('Chat widget destroyed');
  }
}

// Global function to initialize chat
window.initChat = function(tableId) {
  // Clean up existing chat widget
  if (window.chatWidget) {
    window.chatWidget.destroy();
    window.chatWidget = null;
  }
  
  if (tableId) {
    window.chatWidget = new ChatWidget(tableId);
  }
};

// Auto-initialize if tableId is available
document.addEventListener('DOMContentLoaded', function() {
  // Try to get tableId from various sources
  const tableId = window.currentTableId || 
                  new URLSearchParams(window.location.search).get('id') ||
                  (window.location.hash && window.location.hash.includes('#') ? 
                   window.location.hash.split('/')[1] : null);
  
  if (tableId) {
    window.initChat(tableId);
  }
}); 