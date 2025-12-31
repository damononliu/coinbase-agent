/**
 * Frontend JavaScript for Coinbase AgentKit Web UI
 */

const API_BASE = '';

let isInitialized = false;
let isProcessing = false;
let hasPendingTransaction = false;

// DOM elements
const statusElement = document.getElementById('status');
const statusText = document.getElementById('statusText');
const statusDot = statusElement.querySelector('.status-dot');
const walletInfo = document.getElementById('walletInfo');
const walletAddress = document.getElementById('walletAddress');
const network = document.getElementById('network');
const llmProvider = document.getElementById('llmProvider');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const clearButton = document.getElementById('clearButton');

// Initialize
async function init() {
  try {
    // Check status
    const statusResponse = await fetch(`${API_BASE}/api/status`);
    const status = await statusResponse.json();

    if (status.initialized) {
      updateStatus('connected', 'Connected');
      updateWalletInfo(status.wallet, status.llmProvider);
      isInitialized = true;
      fetchWallets();
    } else {
      // Try to initialize
      updateStatus('initializing', 'Initializing...');
      const initResponse = await fetch(`${API_BASE}/api/initialize`, {
        method: 'POST',
      });

      if (!initResponse.ok) {
        const error = await initResponse.json();
        throw new Error(error.error || 'Failed to initialize');
      }

      const data = await initResponse.json();
      updateStatus('connected', 'Connected');
      updateWalletInfo(data.wallet, data.llmProvider);
      isInitialized = true;
    }
  } catch (error) {
    console.error('Initialization error:', error);
    updateStatus('error', `Error: ${error.message}`);
  }
}

function updateStatus(type, text) {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  if (type === 'connected') {
    statusDot.classList.add('connected');
  } else if (type === 'error') {
    statusDot.classList.add('error');
  }
}

function updateWalletInfo(wallet, provider) {
  walletAddress.textContent = wallet.address;
  network.textContent = wallet.network;
  llmProvider.textContent = provider || 'groq';
  walletInfo.style.display = 'flex';
}

function addMessage(role, content, toolCalls = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  // Split content by newlines and create paragraphs
  const paragraphs = content.split('\n').filter(p => p.trim());
  paragraphs.forEach(text => {
    const p = document.createElement('p');
    p.textContent = text;
    contentDiv.appendChild(p);
  });

  // Add tool calls if present
  if (toolCalls && toolCalls.length > 0) {
    const toolCallsDiv = document.createElement('div');
    toolCallsDiv.className = 'tool-calls';
    const title = document.createElement('div');
    title.className = 'tool-calls-title';
    title.textContent = 'Tools used:';
    toolCallsDiv.appendChild(title);

    toolCalls.forEach(tc => {
      const item = document.createElement('div');
      item.className = 'tool-call-item';
      item.textContent = `• ${tc.name}`;
      toolCallsDiv.appendChild(item);
    });

    contentDiv.appendChild(toolCallsDiv);
  }

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addLoadingMessage() {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message assistant';
  messageDiv.id = 'loading-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = '🤖';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  const p = document.createElement('p');
  const loading = document.createElement('span');
  loading.className = 'loading';
  p.appendChild(loading);
  p.appendChild(document.createTextNode(' Thinking...'));
  contentDiv.appendChild(p);

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(contentDiv);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeLoadingMessage() {
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) {
    loadingMessage.remove();
  }
}

/**
 * Add transaction confirmation buttons to a message
 */
function addTransactionConfirmation(messageDiv) {
  hasPendingTransaction = true;

  const confirmDiv = document.createElement('div');
  confirmDiv.className = 'transaction-confirm';
  confirmDiv.id = 'transaction-confirm';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'confirm-btn';
  confirmBtn.textContent = '✅ 确认执行';
  confirmBtn.onclick = confirmTransaction;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel-btn';
  cancelBtn.textContent = '❌ 取消';
  cancelBtn.onclick = cancelTransaction;

  confirmDiv.appendChild(confirmBtn);
  confirmDiv.appendChild(cancelBtn);

  messageDiv.querySelector('.message-content').appendChild(confirmDiv);
}

/**
 * Confirm pending transaction
 */
async function confirmTransaction() {
  if (!hasPendingTransaction || isProcessing) return;

  isProcessing = true;
  const confirmDiv = document.getElementById('transaction-confirm');
  if (confirmDiv) {
    confirmDiv.innerHTML = '<span class="loading"></span> 正在执行交易...';
  }

  try {
    const response = await fetch(`${API_BASE}/api/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    if (confirmDiv) {
      confirmDiv.remove();
    }

    hasPendingTransaction = false;
    addMessage('assistant', data.message, data.toolCalls);
  } catch (error) {
    console.error('Error confirming transaction:', error);
    if (confirmDiv) {
      confirmDiv.innerHTML = `<p class="error-message">确认失败: ${error.message}</p>`;
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Cancel pending transaction
 */
async function cancelTransaction() {
  if (!hasPendingTransaction || isProcessing) return;

  isProcessing = true;

  try {
    const response = await fetch(`${API_BASE}/api/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    const confirmDiv = document.getElementById('transaction-confirm');
    if (confirmDiv) {
      confirmDiv.remove();
    }

    hasPendingTransaction = false;
    addMessage('assistant', data.message);
  } catch (error) {
    console.error('Error cancelling transaction:', error);
  } finally {
    isProcessing = false;
  }
}

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || isProcessing || !isInitialized) {
    return;
  }

  // Add user message
  addMessage('user', message);
  messageInput.value = '';
  adjustTextareaHeight();

  // Disable input
  isProcessing = true;
  messageInput.disabled = true;
  sendButton.disabled = true;

  // Add loading message
  addLoadingMessage();

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    removeLoadingMessage();

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }

    const data = await response.json();

    // Check if there's a pending transaction requiring confirmation
    if (data.pendingTransaction) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant transaction-pending';
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = '🤖';
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';

      // Parse markdown-like content
      const lines = data.message.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          const p = document.createElement('p');
          // Simple markdown parsing for bold
          p.innerHTML = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          contentDiv.appendChild(p);
        }
      });

      messageDiv.appendChild(avatar);
      messageDiv.appendChild(contentDiv);
      chatMessages.appendChild(messageDiv);

      // Add confirmation buttons
      addTransactionConfirmation(messageDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    // Check if it's an error message
    else if (data.message.startsWith('Error:')) {
      const errorP = document.createElement('p');
      errorP.className = 'error-message';
      errorP.textContent = data.message;
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = '🤖';
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.appendChild(errorP);
      messageDiv.appendChild(avatar);
      messageDiv.appendChild(contentDiv);
      chatMessages.appendChild(messageDiv);
    } else {
      addMessage('assistant', data.message, data.toolCalls);
    }
  } catch (error) {
    removeLoadingMessage();
    console.error('Error sending message:', error);
    const errorP = document.createElement('p');
    errorP.className = 'error-message';
    errorP.textContent = `Error: ${error.message}`;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🤖';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.appendChild(errorP);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
  } finally {
    // Re-enable input
    isProcessing = false;
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
  }
}

async function clearHistory() {
  if (!confirm('Are you sure you want to clear the conversation history?')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/clear`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to clear history');
    }

    // Clear UI
    chatMessages.innerHTML = `
      <div class="message assistant">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <p>Conversation history cleared. How can I help you?</p>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Error clearing history:', error);
    alert(`Error: ${error.message}`);
  }
}

function adjustTextareaHeight() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// Event listeners
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// --- Wallet Management ---

async function fetchWallets() {
  try {
    const response = await fetch('/api/wallets');
    const data = await response.json();
    if (data.success) {
      updateWalletSelect(data.wallets);
    }
  } catch (error) {
    console.error('Failed to fetch wallets:', error);
  }
}

function updateWalletSelect(wallets) {
  const select = document.getElementById('wallet-select');
  const currentAddress = document.getElementById('walletAddress').textContent;

  select.innerHTML = '<option value="" disabled>Select Wallet...</option>';

  wallets.forEach(wallet => {
    const option = document.createElement('option');
    option.value = wallet.id;
    option.textContent = `${wallet.alias} (${wallet.address.substring(0, 6)}...)`;

    // Try to auto-select if matches current address
    if (currentAddress && currentAddress.toLowerCase() === wallet.address.toLowerCase()) {
      option.selected = true;
    }

    select.appendChild(option);
  });
}

async function handleWalletSwitch(event) {
  const walletId = event.target.value;
  if (!walletId) return;

  try {
    addMessage('assistant', 'Switching wallet...');

    const response = await fetch('/api/wallets/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: walletId })
    });

    const data = await response.json();

    if (data.success) {
      updateWalletInfo(data.wallet, 'alibaba');
      addMessage('assistant', `Switched to wallet: ${data.wallet.address}`);
    } else {
      addMessage('assistant', `Failed to switch: ${data.error}`);
    }
  } catch (error) {
    addMessage('assistant', `Error switching wallet: ${error.message}`);
  }
}

async function handleCreateWallet() {
  const alias = prompt('Enter name for new wallet:');
  if (!alias) return;

  try {
    const response = await fetch('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias })
    });

    const data = await response.json();
    if (data.success) {
      alert(`Wallet created! ${data.wallet.address}`);
      await fetchWallets(); // Refresh list
      // Auto switch
      const select = document.getElementById('wallet-select');
      // Find the new option and select it
      const options = Array.from(select.options);
      const newOption = options.find(opt => opt.text.includes(alias));
      if (newOption) {
        select.value = newOption.value;
        select.dispatchEvent(new Event('change'));
      }
    } else {
      alert('Failed to create wallet: ' + data.error);
    }
  } catch (error) {
    console.error(error);
  }
}

async function handleExportWallet() {
  const select = document.getElementById('wallet-select');
  const walletId = select.value;

  if (!walletId) {
    alert('Please select a wallet first.');
    return;
  }

  if (!confirm('WARNING: This will display your PRIVATE KEY. Ensure you are in a safe environment. Do you want to proceed?')) {
    return;
  }

  try {
    const response = await fetch('/api/wallets/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: walletId })
    });

    const data = await response.json();
    if (data.success) {
      prompt('Your Private Key (Copy and save it securely):', data.privateKey);
    } else {
      alert('Failed to export wallet: ' + data.error);
    }
  } catch (error) {
    console.error(error);
    alert('Error exporting wallet: ' + error.message);
  }
}

messageInput.addEventListener('input', adjustTextareaHeight);

clearButton.addEventListener('click', clearHistory);
document.getElementById('wallet-select').addEventListener('change', handleWalletSwitch);
document.getElementById('create-wallet-btn').addEventListener('click', handleCreateWallet);
document.getElementById('export-wallet-btn').addEventListener('click', handleExportWallet);

// Initialize on load
init();

