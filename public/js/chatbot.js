// Lexi AI Chatbot Integration for ExplainMe

document.addEventListener('DOMContentLoaded', () => {
  injectChatbot();
});

function injectChatbot() {
  // Check if chatbot is already injected
  if (document.getElementById('lexi-chatbot-root')) return;

  const root = document.createElement('div');
  root.id = 'lexi-chatbot-root';
  root.className = 'chatbot-widget';

  root.innerHTML = `
    <button class="chatbot-btn" id="chatbot-toggle" title="Chat with Lexi AI">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
      </svg>
    </button>
    <div class="chat-window" id="chatbot-window">
      <div class="chat-header">
        <div class="chat-header-info">
          <span class="chat-header-name">Lexi AI</span>
          <span class="chat-header-status">Legal & Contract Assistant</span>
        </div>
        <button class="chat-close-btn" id="chatbot-close" title="Close Chat">
          <svg style="width:18px;height:18px" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="chat-messages" id="chatbot-messages">
        <div class="chat-bubble bot">
          Hello, I am Lexi AI. I can help explain contracts, identify risks, summarize agreements, and answer document-related questions.
        </div>
        <div class="chat-options" id="chatbot-presets">
          <button class="chat-option-btn" data-query="Summarize NDA">Summarize NDA</button>
          <button class="chat-option-btn" data-query="Analyze Liability Clause">Analyze Liability Clause</button>
          <button class="chat-option-btn" data-query="Find termination risks">Find termination risks</button>
          <button class="chat-option-btn" data-query="Is my contract standard?">Is my contract standard?</button>
        </div>
      </div>
      <div class="chat-input-area">
        <input type="text" class="chat-input" id="chatbot-input" placeholder="Ask Lexi a question..." autocomplete="off">
        <button class="chat-send-btn" id="chatbot-send" title="Send Message">
          <svg style="width:16px;height:16px" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // Bind Events
  const toggleBtn = document.getElementById('chatbot-toggle');
  const closeBtn = document.getElementById('chatbot-close');
  const chatWindow = document.getElementById('chatbot-window');
  const chatInput = document.getElementById('chatbot-input');
  const sendBtn = document.getElementById('chatbot-send');
  const messagesContainer = document.getElementById('chatbot-messages');
  const presetsContainer = document.getElementById('chatbot-presets');

  toggleBtn.addEventListener('click', () => {
    chatWindow.classList.toggle('open');
  });

  closeBtn.addEventListener('click', () => {
    chatWindow.classList.remove('open');
  });

  sendBtn.addEventListener('click', () => {
    handleUserMessage();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleUserMessage();
    }
  });

  // Bind presets
  presetsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('chat-option-btn')) {
      const query = e.target.getAttribute('data-query');
      presetsContainer.style.display = 'none'; // hide presets after first interaction
      sendUserQuery(query);
    }
  });

  function handleUserMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    
    // Hide presets
    presetsContainer.style.display = 'none';
    
    chatInput.value = '';
    sendUserQuery(text);
  }

  function sendUserQuery(text) {
    // Append User Bubble
    appendBubble(text, 'user');
    
    // Simulate typing delay
    appendTypingIndicator();
    
    setTimeout(() => {
      removeTypingIndicator();
      const response = getBotResponse(text);
      appendBubble(response, 'bot');
    }, 1000);
  }

  function appendBubble(text, sender) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender}`;
    bubble.innerHTML = text.replace(/\n/g, '<br>');
    messagesContainer.appendChild(bubble);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function appendTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'lexi-typing';
    indicator.className = 'chat-bubble bot';
    indicator.style.color = '#94A3B8';
    indicator.textContent = 'Lexi is analyzing...';
    messagesContainer.appendChild(indicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('lexi-typing');
    if (indicator) indicator.remove();
  }

  function getBotResponse(query) {
    const q = query.toLowerCase();

    if (q.includes('summarize nda') || q.includes('nda')) {
      return `**NDA Contract Summary Overview:**
• **Type**: Mutual Non-Disclosure Agreement
• **Purpose**: Evaluation of potential technical partnership and service integration.
• **Term**: 3 Years confidentiality restriction from effective date.
• **Core Definition**: Encompasses proprietary algorithms, API schemas, and customer metrics.
• **Key Risks**: 
  - Exclusions from confidentiality are slightly narrow.
  - Return of materials clause requires execution within 5 business days of request (strict).`;
    }

    if (q.includes('liability')) {
      return `**Liability & Indemnity Analysis:**
• **Standard Check**: Linear and Notion enterprise baselines recommend capping mutual liability at fees paid in the last 12-month period.
• **Risk Detected**: Clause 8.2 states the vendor has uncapped liability for general breaches.
• **Recommendation**: Negotiate a bilateral cap limiting aggregate liability to 1x fees paid or a fixed corporate limit (e.g., $100,000) to protect enterprise solvency.`;
    }

    if (q.includes('termination')) {
      return `**Termination Clause Review:**
• **Current Status**: Termination for convenience requires a 60-day advance written notice.
• **Risk Detected**: Intellectual Property licenses do not explicitly survive termination, leaving a risk of IP lockout.
• **Recommendation**: Ensure license survival provisions are added to Clause 12 (Survival Section).`;
    }

    if (q.includes('standard')) {
      return `Most standard commercial SaaS contracts include:
1. Mutual Intellectual Property ownership declarations.
2. Standard 1-year liability limitation.
3. 30-day notice for material breach cures.
4. Choice of Law (typically Delaware/New York for US entities).
  
Use the **Upload Contract** page in the left workspace menu to let me perform a detailed page-by-page risk inspection.`;
    }

    // Default response
    return `I've analyzed your query regarding: *"${query}"*. 
    
I can assist with specific clause definitions, risk mitigations, or summary statistics. Please write a specific question like "What is the liability cap?" or upload a document to your **ExplainMe Workspace** for a full audit report.`;
  }
}
