/**
 * AI Wallet Agent - Full Featured Frontend
 * Tech UI with all original functionality
 */

// ============================================
// Configuration & State
// ============================================
const API_BASE = '';

let isInitialized = false;
let isProcessing = false;
let hasPendingTx = false;

// Voice
let voiceEnabled = localStorage.getItem('voice_enabled') !== 'false';
let selectedVoice = localStorage.getItem('tts_voice') || 'zhixiaobai';
let currentAudio = null;
let isListening = false;
let speechRecognition = null;

// Wallet
let currentWalletType = 'eoa';
let smartWalletProvider = null;

// Storage keys
const STORAGE = {
  LOCAL_WALLETS: 'coinbase_agent_local_wallets',
  ACTIVE_WALLET_ID: 'coinbase_agent_active_wallet_id',
  ACTIVE_SOURCE: 'coinbase_agent_active_wallet_source',
  TRACKED_TOKENS: 'coinbase_agent_tracked_tokens',
  TRACKED_NFTS: 'coinbase_agent_tracked_nfts',
  ADDRESS_BOOK: 'coinbase_agent_address_book',
};

// ============================================
// DOM Helper
// ============================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================
// Initialize
// ============================================
async function init() {
  setupTabs();
  setupEventListeners();
  initVoice();
  loadPreferences();
  
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const status = await res.json();
    
    if (status.initialized) {
      setStatus('connected', 'Connected');
      updateWalletDisplay(status.wallet, status.llmProvider);
      updateClientWallet(status.clientWallet);
      isInitialized = true;
    } else {
      setStatus('connecting', 'Initializing...');
      const initRes = await fetch(`${API_BASE}/api/initialize`, { method: 'POST' });
      const data = await initRes.json();
      
      if (data.success) {
        setStatus('connected', 'Connected');
        updateWalletDisplay(data.wallet, data.llmProvider);
        updateClientWallet(data.clientWallet);
        isInitialized = true;
      } else {
        throw new Error(data.error);
      }
    }
    
    loadLocalWallets();
    loadAssets();
    loadAddressBook();
    refreshHistory();
    updateReceiveAddress();
    updateSendMode();
    addActivity('Agent connected.');
    
  } catch (error) {
    console.error('Init error:', error);
    setStatus('error', `Error: ${error.message}`);
    addActivity('Initialization failed.');
  }
  
  // Check for browser wallet
  if (!window.ethereum) {
    const btn = $('connectWalletBtn');
    if (btn) {
      btn.disabled = true;
      btn.title = 'No wallet provider found';
    }
  }
  
  // Listen for wallet changes
  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', async (accounts) => {
      if (accounts?.[0]) {
        localStorage.setItem(STORAGE.ACTIVE_SOURCE, 'browser');
        await setClientWalletOnServer(accounts[0]);
        addActivity(`Wallet changed: ${shorten(accounts[0])}`);
      } else {
        await disconnectBrowserWallet();
      }
    });
  }
}

// ============================================
// Tabs
// ============================================
function setupTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      $$('.tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${target}`));
    });
  });
  
  $$('.asset-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.asset;
      $$('.asset-tab').forEach(t => t.classList.toggle('active', t === tab));
      $('tokenList')?.classList.toggle('hidden', target !== 'tokens');
      $('nftList')?.classList.toggle('hidden', target !== 'nfts');
    });
  });
}

// ============================================
// Event Listeners
// ============================================
function setupEventListeners() {
  // Chat
  $('sendBtn')?.addEventListener('click', sendMessage);
  $('messageInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  $('clearBtn')?.addEventListener('click', clearHistory);
  
  // Voice
  $('voiceBtn')?.addEventListener('click', toggleVoice);
  $('voiceToggle')?.addEventListener('change', (e) => {
    voiceEnabled = e.target.checked;
    localStorage.setItem('voice_enabled', voiceEnabled);
    if (!voiceEnabled) stopSpeaking();
  });
  $('voiceSelect')?.addEventListener('change', (e) => {
    selectedVoice = e.target.value;
    localStorage.setItem('tts_voice', selectedVoice);
  });
  $('stopSpeakBtn')?.addEventListener('click', stopSpeaking);
  
  // Wallet buttons
  $('refreshWalletBtn')?.addEventListener('click', refreshWallet);
  $('copyWalletBtn')?.addEventListener('click', () => copyText($('walletAddress')?.textContent));
  $('connectWalletBtn')?.addEventListener('click', connectBrowserWallet);
  $('disconnectWalletBtn')?.addEventListener('click', disconnectWallet);
  $('connectSmartWalletBtn')?.addEventListener('click', connectSmartWallet);
  
  // Local wallet management
  $('walletSelect')?.addEventListener('change', handleWalletSwitch);
  $('createWalletBtn')?.addEventListener('click', handleCreateWallet);
  $('importWalletBtn')?.addEventListener('click', handleImportWallet);
  $('exportWalletBtn')?.addEventListener('click', handleExportWallet);
  $('deleteWalletBtn')?.addEventListener('click', handleDeleteWallet);
  
  // Send/Receive
  $('sendAssetType')?.addEventListener('change', updateSendMode);
  $('sendSubmitBtn')?.addEventListener('click', handleSend);
  $('copyReceiveBtn')?.addEventListener('click', () => copyText($('receiveAddress')?.textContent));
  
  // Approvals
  $('approveSubmitBtn')?.addEventListener('click', handleApprove);
  $('allowanceCheckBtn')?.addEventListener('click', handleCheckAllowance);
  
  // Assets
  $('refreshAssetsBtn')?.addEventListener('click', renderAssets);
  $('addTokenBtn')?.addEventListener('click', handleAddToken);
  $('addNftBtn')?.addEventListener('click', handleAddNft);
  
  // History
  $('refreshHistoryBtn')?.addEventListener('click', refreshHistory);
  
  // Address book
  $('addAddressBtn')?.addEventListener('click', handleAddAddress);
  
  // Modal
  $('modalClose')?.addEventListener('click', closeModal);
  $('modal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
}

function loadPreferences() {
  const voiceToggle = $('voiceToggle');
  const voiceSelect = $('voiceSelect');
  if (voiceToggle) voiceToggle.checked = voiceEnabled;
  if (voiceSelect) voiceSelect.value = selectedVoice;
}

// ============================================
// Status & Display
// ============================================
function setStatus(type, text) {
  const badge = $('status');
  const statusText = $('statusText');
  if (badge) {
    badge.className = 'status-badge';
    if (type === 'connected') badge.classList.add('connected');
    if (type === 'error') badge.classList.add('error');
  }
  if (statusText) statusText.textContent = text;
}

function updateWalletDisplay(wallet, llmProvider) {
  if (!wallet) return;
  const balance = wallet.balance?.includes('ETH') ? wallet.balance : `${wallet.balance || '0'} ETH`;
  
  if ($('walletAddress')) $('walletAddress').textContent = wallet.address || '-';
  if ($('walletBalance')) $('walletBalance').textContent = balance;
  if ($('networkName')) $('networkName').textContent = wallet.network || 'base-sepolia';
  if ($('llmProvider')) $('llmProvider').textContent = llmProvider || '-';
  
  updateReceiveAddress();
}

function updateClientWallet(address) {
  const display = address || 'Not connected';
  if ($('clientWalletAddress')) $('clientWalletAddress').textContent = display;
  updateReceiveAddress();
  
  if (isInitialized) {
    renderTokenAssets();
    refreshHistory();
  }
}

function updateReceiveAddress() {
  const clientAddr = $('clientWalletAddress')?.textContent;
  const serverAddr = $('walletAddress')?.textContent;
  const active = isAddress(clientAddr) ? clientAddr : (isAddress(serverAddr) ? serverAddr : '-');
  if ($('receiveAddress')) $('receiveAddress').textContent = active;
}

function updateWalletTypeBadge(type) {
  const badge = $('walletTypeBadge');
  if (badge) {
    badge.textContent = type === 'smart' ? 'Smart Wallet' : (type === 'eoa' ? 'EOA' : '-');
  }
}

// ============================================
// Chat Functions
// ============================================
async function sendMessage() {
  const input = $('messageInput');
  const message = input?.value.trim();
  if (!message || isProcessing || !isInitialized) return;
  
  input.value = '';
  addMessage('user', message);
  isProcessing = true;
  
  showLoading();
  
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    
    removeLoading();
    const data = await res.json();
    
    if (data.pendingTransaction) {
      hasPendingTx = true;
      showPendingTransaction(data.pendingTransaction, data.message);
    } else {
      addMessage('assistant', data.message, data.toolCalls);
      if (voiceEnabled) speakText(data.message);
      
      if (shouldRefreshWallet(data.toolCalls)) {
        await refreshWallet();
      }
    }
  } catch (error) {
    removeLoading();
    addMessage('assistant', `Error: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

function addMessage(role, content, toolCalls = null) {
  const container = $('chatMessages');
  if (!container) return;
  
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';
  
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  
  content.split('\n').filter(p => p.trim()).forEach(text => {
    const p = document.createElement('p');
    p.textContent = text;
    bubble.appendChild(p);
  });
  
  if (toolCalls?.length) {
    const tools = document.createElement('div');
    tools.className = 'tool-calls';
    tools.innerHTML = `<small style="color:var(--text-muted)">Tools: ${toolCalls.map(t => t.name).join(', ')}</small>`;
    bubble.appendChild(tools);
  }
  
  msg.appendChild(avatar);
  msg.appendChild(bubble);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function showLoading() {
  const container = $('chatMessages');
  if (!container) return;
  
  const msg = document.createElement('div');
  msg.className = 'message assistant';
  msg.id = 'loadingMsg';
  msg.innerHTML = `
    <div class="avatar">🤖</div>
    <div class="bubble">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>
  `;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function removeLoading() {
  $('loadingMsg')?.remove();
}

function showPendingTransaction(tx, message) {
  const container = $('chatMessages');
  if (!container) return;
  
  const msg = document.createElement('div');
  msg.className = 'message assistant pending';
  msg.id = 'pendingTxMsg';
  msg.innerHTML = `
    <div class="avatar">⚠️</div>
    <div class="bubble">
      <p><strong>Transaction Confirmation Required</strong></p>
      <div class="tx-details">${tx.description || message}</div>
      <div class="tx-actions">
        <button class="tx-btn cancel" onclick="cancelTransaction()">Cancel</button>
        <button class="tx-btn confirm" onclick="confirmTransaction()">Confirm</button>
      </div>
    </div>
  `;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  addActivity('Transaction pending confirmation.');
}

async function confirmTransaction() {
  if (!hasPendingTx) return;
  
  const pendingMsg = $('pendingTxMsg');
  const actions = pendingMsg?.querySelector('.tx-actions');
  if (actions) actions.innerHTML = '<p>Processing...</p>';
  
  try {
    const res = await fetch(`${API_BASE}/api/confirm`, { method: 'POST' });
    const data = await res.json();
    
    pendingMsg?.remove();
    hasPendingTx = false;
    
    addMessage('assistant', data.message, data.toolCalls);
    if (voiceEnabled) speakText(data.message);
    if (data.wallet) updateWalletDisplay(data.wallet);
    addActivity('Transaction confirmed.');
  } catch (error) {
    addMessage('assistant', `Error: ${error.message}`);
  }
}

async function cancelTransaction() {
  if (!hasPendingTx) return;
  
  try {
    await fetch(`${API_BASE}/api/cancel`, { method: 'POST' });
    $('pendingTxMsg')?.remove();
    hasPendingTx = false;
    addMessage('assistant', 'Transaction cancelled.');
    addActivity('Transaction cancelled.');
  } catch (error) {
    console.error('Cancel error:', error);
  }
}

async function clearHistory() {
  if (!confirm('Clear conversation history?')) return;
  
  try {
    await fetch(`${API_BASE}/api/clear`, { method: 'POST' });
    const container = $('chatMessages');
    if (container) {
      container.innerHTML = `
        <div class="message assistant">
          <div class="avatar">🤖</div>
          <div class="bubble"><p>History cleared. How can I help?</p></div>
        </div>
      `;
    }
    addActivity('History cleared.');
  } catch (error) {
    showToast('Failed to clear history', 'error');
  }
}

function shouldRefreshWallet(toolCalls = []) {
  return toolCalls?.some(tc => /transfer|wrap|unwrap|swap|faucet/i.test(tc.name));
}

// ============================================
// Wallet Functions
// ============================================
async function refreshWallet() {
  try {
    const res = await fetch(`${API_BASE}/api/wallet/refresh`);
    const data = await res.json();
    if (data.success) {
      updateWalletDisplay(data.wallet, data.llmProvider);
      updateClientWallet(data.clientWallet);
      showToast('Balance updated', 'success');
    }
  } catch (error) {
    showToast('Failed to refresh', 'error');
  }
}

async function connectBrowserWallet() {
  if (!window.ethereum) {
    showToast('No wallet provider found', 'error');
    return;
  }
  
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (accounts?.[0]) {
      await setClientWalletOnServer(accounts[0]);
      localStorage.setItem(STORAGE.ACTIVE_SOURCE, 'browser');
      currentWalletType = 'eoa';
      updateWalletTypeBadge('eoa');
      addMessage('assistant', `✅ Wallet connected: ${accounts[0]}`);
      addActivity(`Browser wallet: ${shorten(accounts[0])}`);
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function connectSmartWallet() {
  try {
    addActivity('Connecting Coinbase Wallet...');
    
    let provider = null;
    
    // Check for Coinbase Wallet
    if (window.ethereum?.isCoinbaseWallet) {
      provider = window.ethereum;
    } else if (window.ethereum?.providers) {
      provider = window.ethereum.providers.find(p => p.isCoinbaseWallet);
    }
    
    if (!provider && window.ethereum) {
      provider = window.ethereum;
    }
    
    if (!provider) {
      showToast('Please install Coinbase Wallet', 'warning');
      return;
    }
    
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    
    if (accounts?.[0]) {
      const address = accounts[0];
      smartWalletProvider = provider;
      
      // Check if smart wallet
      try {
        const code = await provider.request({
          method: 'eth_getCode',
          params: [address, 'latest'],
        });
        currentWalletType = code && code !== '0x' ? 'smart' : 'eoa';
      } catch {
        currentWalletType = 'eoa';
      }
      
      await setClientWalletOnServer(address);
      localStorage.setItem(STORAGE.ACTIVE_SOURCE, 'smart');
      updateWalletTypeBadge(currentWalletType);
      
      const typeText = currentWalletType === 'smart' ? 'Smart Wallet (ERC-4337)' : 'Coinbase Wallet';
      addMessage('assistant', `✅ ${typeText} connected!\n\nAddress: ${address}`);
      addActivity(`Connected: ${shorten(address)}`);
      
      provider.on?.('accountsChanged', async (accs) => {
        if (accs?.[0]) {
          await setClientWalletOnServer(accs[0]);
        } else {
          await disconnectWallet();
        }
      });
    }
  } catch (error) {
    console.error('Connect error:', error);
    addMessage('assistant', `❌ Connection failed: ${error.message}`);
  }
}

async function disconnectWallet() {
  if (currentWalletType === 'smart' && smartWalletProvider?.disconnect) {
    try { await smartWalletProvider.disconnect(); } catch {}
  }
  
  smartWalletProvider = null;
  currentWalletType = 'eoa';
  
  await clearClientWalletOnServer();
  localStorage.removeItem(STORAGE.ACTIVE_SOURCE);
  updateWalletTypeBadge(null);
  addActivity('Wallet disconnected.');
}

async function disconnectBrowserWallet() {
  await clearClientWalletOnServer();
  localStorage.removeItem(STORAGE.ACTIVE_SOURCE);
  addActivity('Browser wallet disconnected.');
}

async function setClientWalletOnServer(address) {
  try {
    const res = await fetch(`${API_BASE}/api/client_wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    const data = await res.json();
    if (data.success) updateClientWallet(data.clientWallet);
  } catch (error) {
    console.error('Set client wallet error:', error);
  }
}

async function clearClientWalletOnServer() {
  try {
    const res = await fetch(`${API_BASE}/api/client_wallet`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) updateClientWallet(null);
  } catch (error) {
    console.error('Clear client wallet error:', error);
  }
}

// ============================================
// Local Wallet Management
// ============================================
function getLocalWallets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.LOCAL_WALLETS) || '[]');
  } catch {
    return [];
  }
}

function saveLocalWallets(wallets) {
  localStorage.setItem(STORAGE.LOCAL_WALLETS, JSON.stringify(wallets));
}

function loadLocalWallets() {
  const wallets = getLocalWallets();
  updateWalletSelect(wallets);
  updateActiveLocalInfo(wallets);
  
  const activeId = localStorage.getItem(STORAGE.ACTIVE_WALLET_ID);
  const activeSource = localStorage.getItem(STORAGE.ACTIVE_SOURCE);
  
  if (activeSource === 'local' && activeId) {
    const wallet = wallets.find(w => w.id === activeId);
    if (wallet) setClientWalletOnServer(wallet.address);
  }
}

function updateWalletSelect(wallets) {
  const select = $('walletSelect');
  if (!select) return;
  
  const activeId = localStorage.getItem(STORAGE.ACTIVE_WALLET_ID);
  select.innerHTML = '<option value="" disabled>Select wallet...</option>';
  
  wallets.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = `${w.alias} (${shorten(w.address)})`;
    if (w.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });
}

function updateActiveLocalInfo(wallets) {
  const activeId = localStorage.getItem(STORAGE.ACTIVE_WALLET_ID);
  const wallet = wallets.find(w => w.id === activeId);
  if ($('activeLocalAlias')) $('activeLocalAlias').textContent = wallet?.alias || '-';
  if ($('activeLocalAddress')) $('activeLocalAddress').textContent = wallet?.address || '-';
}

async function handleWalletSwitch(e) {
  const walletId = e.target.value;
  if (!walletId) return;
  
  const wallets = getLocalWallets();
  const wallet = wallets.find(w => w.id === walletId);
  if (!wallet) return;
  
  localStorage.setItem(STORAGE.ACTIVE_WALLET_ID, walletId);
  localStorage.setItem(STORAGE.ACTIVE_SOURCE, 'local');
  
  await setClientWalletOnServer(wallet.address);
  updateActiveLocalInfo(wallets);
  addMessage('assistant', `Switched to: ${wallet.alias}`);
  addActivity(`Local wallet: ${shorten(wallet.address)}`);
}

async function handleCreateWallet() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label>Wallet Name</label>
      <input id="newWalletName" class="input" placeholder="My Wallet" />
    </div>
  `;
  
  openModal('Create Wallet', body, [
    { text: 'Cancel', action: closeModal },
    { text: 'Create', primary: true, action: async () => {
      const name = $('newWalletName')?.value.trim();
      if (!name) { showToast('Name required', 'warning'); return; }
      
      try {
        const { generatePrivateKey, privateKeyToAccount } = await import('https://esm.sh/viem@2.21.3/accounts');
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);
        
        const wallets = getLocalWallets();
        const newWallet = {
          id: Math.random().toString(36).slice(2),
          alias: name,
          address: account.address,
          privateKey,
          createdAt: new Date().toISOString(),
        };
        wallets.push(newWallet);
        saveLocalWallets(wallets);
        
        localStorage.setItem(STORAGE.ACTIVE_WALLET_ID, newWallet.id);
        localStorage.setItem(STORAGE.ACTIVE_SOURCE, 'local');
        await setClientWalletOnServer(newWallet.address);
        
        updateWalletSelect(wallets);
        updateActiveLocalInfo(wallets);
        closeModal();
        addActivity(`Created: ${shorten(newWallet.address)}`);
      } catch (error) {
        showToast('Failed to create wallet', 'error');
      }
    }},
  ]);
}

async function handleImportWallet() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label>Wallet Name</label>
      <input id="importWalletName" class="input" placeholder="Imported Wallet" />
    </div>
    <div class="form-group">
      <label>Private Key</label>
      <input id="importWalletKey" class="input" placeholder="0x..." type="password" />
    </div>
  `;
  
  openModal('Import Wallet', body, [
    { text: 'Cancel', action: closeModal },
    { text: 'Import', primary: true, action: async () => {
      const name = $('importWalletName')?.value.trim();
      const pk = $('importWalletKey')?.value.trim();
      if (!name || !pk) { showToast('All fields required', 'warning'); return; }
      
      try {
        const { privateKeyToAccount } = await import('https://esm.sh/viem@2.21.3/accounts');
        const normalized = pk.startsWith('0x') ? pk : `0x${pk}`;
        const account = privateKeyToAccount(normalized);
        
        const wallets = getLocalWallets();
        const newWallet = {
          id: Math.random().toString(36).slice(2),
          alias: name,
          address: account.address,
          privateKey: normalized,
          createdAt: new Date().toISOString(),
        };
        wallets.push(newWallet);
        saveLocalWallets(wallets);
        
        localStorage.setItem(STORAGE.ACTIVE_WALLET_ID, newWallet.id);
        localStorage.setItem(STORAGE.ACTIVE_SOURCE, 'local');
        await setClientWalletOnServer(newWallet.address);
        
        updateWalletSelect(wallets);
        updateActiveLocalInfo(wallets);
        closeModal();
        addActivity(`Imported: ${shorten(newWallet.address)}`);
      } catch (error) {
        showToast('Invalid private key', 'error');
      }
    }},
  ]);
}

function handleExportWallet() {
  const walletId = $('walletSelect')?.value;
  if (!walletId) { showToast('Select a wallet first', 'warning'); return; }
  if (!confirm('This will display your private key. Continue?')) return;
  
  const wallets = getLocalWallets();
  const wallet = wallets.find(w => w.id === walletId);
  if (wallet) {
    prompt('Private Key (copy and save securely):', wallet.privateKey);
    addActivity('Private key exported.');
  }
}

function handleDeleteWallet() {
  const walletId = $('walletSelect')?.value;
  if (!walletId) { showToast('Select a wallet first', 'warning'); return; }
  if (!confirm('Delete this wallet? This cannot be undone.')) return;
  
  const wallets = getLocalWallets().filter(w => w.id !== walletId);
  saveLocalWallets(wallets);
  
  if (localStorage.getItem(STORAGE.ACTIVE_WALLET_ID) === walletId) {
    localStorage.removeItem(STORAGE.ACTIVE_WALLET_ID);
    localStorage.removeItem(STORAGE.ACTIVE_SOURCE);
    clearClientWalletOnServer();
  }
  
  updateWalletSelect(wallets);
  updateActiveLocalInfo(wallets);
  addActivity('Wallet deleted.');
}

// ============================================
// Send/Receive
// ============================================
function updateSendMode() {
  const type = $('sendAssetType')?.value;
  const tokenInput = $('sendTokenAddress');
  if (tokenInput) tokenInput.disabled = type !== 'token';
}

async function handleSend() {
  const type = $('sendAssetType')?.value;
  const to = $('sendTo')?.value.trim();
  const amount = $('sendAmount')?.value.trim();
  const token = $('sendTokenAddress')?.value.trim();
  
  if (!isAddress(to)) { showToast('Invalid recipient', 'warning'); return; }
  if (!amount) { showToast('Amount required', 'warning'); return; }
  
  let message;
  if (type === 'token') {
    if (!isAddress(token)) { showToast('Invalid token address', 'warning'); return; }
    message = `Transfer ${amount} tokens (${token}) to ${to}`;
  } else {
    message = `Transfer ${amount} ETH to ${to}`;
  }
  
  $('messageInput').value = message;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'agent'));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-agent'));
  sendMessage();
}

async function handleApprove() {
  const token = $('approveTokenAddress')?.value.trim();
  const spender = $('approveSpenderAddress')?.value.trim();
  const amount = $('approveAmount')?.value.trim();
  
  if (!isAddress(token) || !isAddress(spender) || !amount) {
    showToast('All fields required', 'warning');
    return;
  }
  
  $('messageInput').value = `Approve ${spender} to spend ${amount} tokens (${token})`;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'agent'));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-agent'));
  sendMessage();
}

async function handleCheckAllowance() {
  const token = $('allowanceTokenAddress')?.value.trim();
  const spender = $('allowanceSpenderAddress')?.value.trim();
  const owner = $('walletAddress')?.textContent;
  
  if (!isAddress(token) || !isAddress(spender)) {
    showToast('Valid addresses required', 'warning');
    return;
  }
  
  try {
    const res = await fetch(`${API_BASE}/api/token/allowance?tokenAddress=${token}&spenderAddress=${spender}&ownerAddress=${owner}`);
    const data = await res.json();
    if ($('allowanceResult')) {
      $('allowanceResult').textContent = `Allowance: ${data.allowance} ${data.symbol || ''}`;
    }
  } catch (error) {
    if ($('allowanceResult')) $('allowanceResult').textContent = `Error: ${error.message}`;
  }
}

// ============================================
// Assets
// ============================================
function getTrackedTokens() {
  try { return JSON.parse(localStorage.getItem(STORAGE.TRACKED_TOKENS) || '[]'); }
  catch { return []; }
}

function saveTrackedTokens(tokens) {
  localStorage.setItem(STORAGE.TRACKED_TOKENS, JSON.stringify(tokens));
}

function getTrackedNfts() {
  try { return JSON.parse(localStorage.getItem(STORAGE.TRACKED_NFTS) || '[]'); }
  catch { return []; }
}

function saveTrackedNfts(nfts) {
  localStorage.setItem(STORAGE.TRACKED_NFTS, JSON.stringify(nfts));
}

function loadAssets() {
  renderAssets();
}

async function renderAssets() {
  await Promise.all([renderTokenAssets(), renderNftAssets()]);
}

async function renderTokenAssets() {
  const container = $('tokenList');
  if (!container) return;
  
  const tokens = getTrackedTokens();
  if (!tokens.length) {
    container.innerHTML = '<div class="empty-state">No tokens tracked.</div>';
    return;
  }
  
  container.innerHTML = '';
  const activeAddr = $('clientWalletAddress')?.textContent;
  
  for (const token of tokens) {
    let balance = '-';
    if (isAddress(activeAddr)) {
      try {
        const res = await fetch(`${API_BASE}/api/token/balance?tokenAddress=${token.address}&address=${activeAddr}`);
        const data = await res.json();
        balance = data.balance || '-';
      } catch {}
    }
    
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `
      <div class="asset-title">${token.symbol || 'TOKEN'}</div>
      <div class="asset-meta">${token.address}</div>
      <div class="asset-balance">Balance: ${balance}</div>
      <button class="btn-sm danger" style="margin-top:8px" data-remove="${token.address}">Remove</button>
    `;
    container.appendChild(card);
  }
  
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const addr = btn.dataset.remove;
      saveTrackedTokens(getTrackedTokens().filter(t => t.address !== addr));
      renderTokenAssets();
    });
  });
}

async function renderNftAssets() {
  const container = $('nftList');
  if (!container) return;
  
  const nfts = getTrackedNfts();
  if (!nfts.length) {
    container.innerHTML = '<div class="empty-state">No NFTs tracked.</div>';
    return;
  }
  
  container.innerHTML = '';
  
  for (const nft of nfts) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    card.innerHTML = `
      ${nft.image ? `<img class="nft-image" src="${nft.image}" alt="NFT" />` : ''}
      <div class="asset-title">${nft.name || 'NFT'} #${nft.tokenId}</div>
      <div class="asset-meta">${nft.contract}</div>
      <button class="btn-sm danger" style="margin-top:8px" data-remove="${nft.contract}|${nft.tokenId}">Remove</button>
    `;
    container.appendChild(card);
  }
  
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [contract, tokenId] = btn.dataset.remove.split('|');
      saveTrackedNfts(getTrackedNfts().filter(n => !(n.contract === contract && String(n.tokenId) === tokenId)));
      renderNftAssets();
    });
  });
}

function handleAddToken() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label>Token Address</label>
      <input id="addTokenAddress" class="input" placeholder="0x..." />
    </div>
  `;
  
  openModal('Add Token', body, [
    { text: 'Cancel', action: closeModal },
    { text: 'Add', primary: true, action: async () => {
      const addr = $('addTokenAddress')?.value.trim();
      if (!isAddress(addr)) { showToast('Invalid address', 'warning'); return; }
      
      try {
        const res = await fetch(`${API_BASE}/api/token/details?tokenAddress=${addr}`);
        const data = await res.json();
        
        const tokens = getTrackedTokens();
        if (tokens.some(t => t.address.toLowerCase() === addr.toLowerCase())) {
          showToast('Token already tracked', 'warning');
          return;
        }
        
        tokens.push({
          address: data.token.address,
          name: data.token.name,
          symbol: data.token.symbol,
          decimals: data.token.decimals,
        });
        saveTrackedTokens(tokens);
        await renderTokenAssets();
        closeModal();
        addActivity(`Token added: ${data.token.symbol}`);
      } catch (error) {
        showToast('Failed to add token', 'error');
      }
    }},
  ]);
}

function handleAddNft() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label>Contract Address</label>
      <input id="addNftContract" class="input" placeholder="0x..." />
    </div>
    <div class="form-group">
      <label>Token ID</label>
      <input id="addNftTokenId" class="input" placeholder="1" />
    </div>
  `;
  
  openModal('Add NFT', body, [
    { text: 'Cancel', action: closeModal },
    { text: 'Add', primary: true, action: async () => {
      const contract = $('addNftContract')?.value.trim();
      const tokenId = $('addNftTokenId')?.value.trim();
      if (!isAddress(contract) || !tokenId) { showToast('All fields required', 'warning'); return; }
      
      try {
        const res = await fetch(`${API_BASE}/api/nft/metadata?contract=${contract}&tokenId=${tokenId}`);
        const data = await res.json();
        
        const nfts = getTrackedNfts();
        nfts.push({
          contract: data.contract,
          tokenId: data.tokenId,
          name: data.name || data.metadata?.name,
          image: data.metadata?.image,
        });
        saveTrackedNfts(nfts);
        await renderNftAssets();
        closeModal();
        addActivity(`NFT added: #${tokenId}`);
      } catch (error) {
        showToast('Failed to add NFT', 'error');
      }
    }},
  ]);
}

// ============================================
// History
// ============================================
async function refreshHistory() {
  const container = $('historyList');
  if (!container) return;
  
  const address = $('clientWalletAddress')?.textContent;
  const tokens = getTrackedTokens();
  
  if (!isAddress(address) || !tokens.length) {
    container.innerHTML = '<div class="empty-state">No history available.</div>';
    return;
  }
  
  container.innerHTML = '<div class="empty-state">Loading...</div>';
  
  const allEvents = [];
  for (const token of tokens) {
    try {
      const res = await fetch(`${API_BASE}/api/token/history?tokenAddress=${token.address}&address=${address}`);
      const data = await res.json();
      (data.events || []).forEach(evt => {
        allEvents.push({ ...evt, symbol: token.symbol || 'TOKEN' });
      });
    } catch {}
  }
  
  allEvents.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));
  const limited = allEvents.slice(0, 20);
  
  if (!limited.length) {
    container.innerHTML = '<div class="empty-state">No transfers found.</div>';
    return;
  }
  
  container.innerHTML = '';
  limited.forEach(evt => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div><strong>${evt.symbol}</strong> ${evt.value}</div>
      <div>From: ${shorten(evt.from)} → To: ${shorten(evt.to)}</div>
      <div style="color:var(--text-muted);font-size:10px">Tx: ${shorten(evt.txHash)}</div>
    `;
    container.appendChild(item);
  });
}

// ============================================
// Address Book
// ============================================
function getAddressBook() {
  try { return JSON.parse(localStorage.getItem(STORAGE.ADDRESS_BOOK) || '[]'); }
  catch { return []; }
}

function saveAddressBook(entries) {
  localStorage.setItem(STORAGE.ADDRESS_BOOK, JSON.stringify(entries));
}

function loadAddressBook() {
  renderAddressBook();
}

function renderAddressBook() {
  const container = $('addressBookList');
  const datalist = $('addressBookOptions');
  if (!container) return;
  
  const entries = getAddressBook();
  
  // Update datalist
  if (datalist) {
    datalist.innerHTML = '';
    entries.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.address;
      opt.label = e.name;
      datalist.appendChild(opt);
    });
  }
  
  if (!entries.length) {
    container.innerHTML = '<div class="empty-state">No addresses saved.</div>';
    return;
  }
  
  container.innerHTML = '';
  entries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'address-item';
    item.innerHTML = `
      <div><strong>${entry.name}</strong></div>
      <div style="font-size:11px;color:var(--text-muted)">${entry.address}</div>
      <div class="card-actions" style="margin-top:8px">
        <button class="btn-sm" data-use="${entry.address}">Use</button>
        <button class="btn-sm" data-copy="${entry.address}">Copy</button>
        <button class="btn-sm danger" data-delete="${entry.address}">Delete</button>
      </div>
    `;
    container.appendChild(item);
  });
  
  container.querySelectorAll('[data-use]').forEach(btn => {
    btn.addEventListener('click', () => {
      if ($('sendTo')) $('sendTo').value = btn.dataset.use;
      showToast('Address filled', 'success');
    });
  });
  
  container.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => copyText(btn.dataset.copy));
  });
  
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveAddressBook(getAddressBook().filter(e => e.address !== btn.dataset.delete));
      renderAddressBook();
    });
  });
}

function handleAddAddress() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-group">
      <label>Name</label>
      <input id="addAddrName" class="input" placeholder="Exchange" />
    </div>
    <div class="form-group">
      <label>Address</label>
      <input id="addAddrValue" class="input" placeholder="0x..." />
    </div>
  `;
  
  openModal('Add Address', body, [
    { text: 'Cancel', action: closeModal },
    { text: 'Save', primary: true, action: () => {
      const name = $('addAddrName')?.value.trim();
      const address = $('addAddrValue')?.value.trim();
      if (!name || !isAddress(address)) { showToast('Valid name and address required', 'warning'); return; }
      
      const entries = getAddressBook();
      entries.push({ name, address });
      saveAddressBook(entries);
      renderAddressBook();
      closeModal();
      addActivity(`Address saved: ${name}`);
    }},
  ]);
}

// ============================================
// Voice
// ============================================
function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'zh-CN';
    
    speechRecognition.onresult = (e) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final && $('messageInput')) {
        $('messageInput').value = final;
        stopListening();
        setTimeout(sendMessage, 300);
      }
    };
    
    speechRecognition.onend = stopListening;
    speechRecognition.onerror = () => stopListening();
  }
  
  window.speechSynthesis?.getVoices();
}

function toggleVoice() {
  isListening ? stopListening() : startListening();
}

function startListening() {
  if (!speechRecognition) { showToast('Voice not supported', 'warning'); return; }
  try {
    speechRecognition.start();
    isListening = true;
    $('voiceBtn')?.classList.add('listening');
  } catch {}
}

function stopListening() {
  isListening = false;
  $('voiceBtn')?.classList.remove('listening');
  try { speechRecognition?.stop(); } catch {}
}

async function speakText(text) {
  if (!voiceEnabled || !text) return;
  stopSpeaking();
  
  const clean = text
    .replace(/[🤖💰📍✅❌⚠️🔄📦🪙🦊🧭◆◈👋❓👤]/g, '')
    .replace(/0x[a-fA-F0-9]{40}/g, '地址')
    .replace(/0x[a-fA-F0-9]{64}/g, '哈希')
    .replace(/\n+/g, '。')
    .slice(0, 200);
  
  if (!clean.trim()) return;
  
  // Mark speaking
  const msgs = $$('.message.assistant');
  msgs[msgs.length - 1]?.classList.add('speaking');
  
  try {
    const res = await fetch(`${API_BASE}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, voice: selectedVoice }),
    });
    const data = await res.json();
    
    if (data.audioUrl || data.audioBase64) {
      const src = data.audioUrl || `data:audio/mp3;base64,${data.audioBase64}`;
      currentAudio = new Audio(src);
      currentAudio.onended = removeSpeakingClass;
      currentAudio.onerror = () => { removeSpeakingClass(); speakWithBrowser(clean); };
      await currentAudio.play();
    } else {
      speakWithBrowser(clean);
    }
  } catch {
    speakWithBrowser(clean);
  }
}

function speakWithBrowser(text) {
  if (!window.speechSynthesis) { removeSpeakingClass(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.onend = removeSpeakingClass;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  currentAudio?.pause();
  currentAudio = null;
  window.speechSynthesis?.cancel();
  removeSpeakingClass();
}

function removeSpeakingClass() {
  $$('.message.speaking').forEach(m => m.classList.remove('speaking'));
}

// ============================================
// Modal
// ============================================
function openModal(title, body, actions) {
  if ($('modalTitle')) $('modalTitle').textContent = title;
  if ($('modalBody')) {
    $('modalBody').innerHTML = '';
    $('modalBody').appendChild(body);
  }
  if ($('modalActions')) {
    $('modalActions').innerHTML = '';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = `btn${a.primary ? ' primary' : ''}`;
      btn.textContent = a.text;
      btn.addEventListener('click', a.action);
      $('modalActions').appendChild(btn);
    });
  }
  $('modal')?.classList.remove('hidden');
}

function closeModal() {
  $('modal')?.classList.add('hidden');
}

// ============================================
// Utilities
// ============================================
function addActivity(text) {
  const container = $('activityList');
  if (!container) return;
  
  const item = document.createElement('div');
  item.className = 'activity-item';
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  item.textContent = `[${time}] ${text}`;
  container.prepend(item);
  
  // Keep only last 20
  while (container.children.length > 20) {
    container.lastChild.remove();
  }
}

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

function copyText(text) {
  if (!text || text === '-') { showToast('Nothing to copy', 'warning'); return; }
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied!', 'success'))
    .catch(() => prompt('Copy:', text));
}

function shorten(addr) {
  if (!addr || addr.length < 10) return addr || '-';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function isAddress(val) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(val || ''));
}

// ============================================
// Global functions for inline handlers
// ============================================
window.confirmTransaction = confirmTransaction;
window.cancelTransaction = cancelTransaction;

// ============================================
// Start
// ============================================
init();
