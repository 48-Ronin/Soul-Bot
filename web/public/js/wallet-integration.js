/**
 * Wallet Integration Module for Soul-Bot
 * Handles wallet connections, disconnects, and fund withdrawals
 */

// Initialize socket connection if not already done
const socket = window.socket || io();

// Make socket available globally
window.socket = socket;

// Wallet state
let walletConnected = false;
let walletAddress = null;
let walletProvider = null;
let preferredWithdrawalToken = 'USDC';
let solanaNetwork = 'mainnet-beta'; // Default to mainnet-beta

// Init function - called when page loads
async function initWalletIntegration() {
  console.log('Initializing wallet integration...');
  updateWalletUI();
  setupEventListeners();
  checkForWalletProviders();
  
  // Add network selector if missing
  addNetworkSelector();
}

// Add network selector to the UI if it doesn't exist
function addNetworkSelector() {
  const controlPanel = document.querySelector('.wallet-container');
  if (!controlPanel) return;
  
  if (!document.getElementById('solana-network-select')) {
    const networkContainer = document.createElement('div');
    networkContainer.className = 'network-selector';
    networkContainer.innerHTML = `
      <label for="solana-network-select">Solana Network:</label>
      <select id="solana-network-select" class="form-select form-select-sm">
        <option value="mainnet-beta">Mainnet</option>
        <option value="devnet">Devnet</option>
        <option value="testnet">Testnet</option>
      </select>
    `;
    
    // Insert before the mode toggle
    const modeToggle = controlPanel.querySelector('.mode-toggle');
    if (modeToggle) {
      controlPanel.insertBefore(networkContainer, modeToggle);
    } else {
      controlPanel.appendChild(networkContainer);
    }
    
    // Add event listener
    const networkSelect = document.getElementById('solana-network-select');
    if (networkSelect) {
      networkSelect.addEventListener('change', (e) => {
        solanaNetwork = e.target.value;
        console.log(`Switched to Solana ${solanaNetwork}`);
        
        // If wallet is connected, update balance
        if (walletConnected) {
          updateWalletBalance();
        }
      });
    }
  }
}

// Helper function to get RPC endpoint for the selected network
function getEndpoint() {
  switch (solanaNetwork) {
    case 'devnet':
      return 'https://api.devnet.solana.com';
    case 'testnet':
      return 'https://api.testnet.solana.com';
    case 'mainnet-beta':
    default:
      return 'https://api.mainnet-beta.solana.com';
  }
}

// Update wallet balance from the blockchain
async function updateWalletBalance() {
  if (!walletConnected || !walletAddress) return;
  
  try {
    const endpoint = getEndpoint();
    console.log(`Fetching balance from ${endpoint}`);
    
    const connection = new solanaWeb3.Connection(endpoint, 'confirmed');
    const pubkey = new solanaWeb3.PublicKey(walletAddress);
    
    const balance = await connection.getBalance(pubkey);
    const solBalance = balance / solanaWeb3.LAMPORTS_PER_SOL;
    
    console.log(`Wallet SOL balance on ${solanaNetwork}: ${solBalance}`);
    
    // Update UI with actual balance
    const walletBalanceEl = document.getElementById('wallet-balance');
    if (walletBalanceEl) {
      walletBalanceEl.innerHTML = `SOL Balance: ${solBalance.toFixed(4)}`;
    }
    
    return solBalance;
  } catch (error) {
    console.error(`Error updating balance: ${error.message}`);
    return 0;
  }
}

// Check if Phantom or other Solana wallets are available
function checkForWalletProviders() {
  // Find wallet button
  const connectBtn = document.getElementById('wallet-connect-btn');
  const walletStatusEl = document.getElementById('wallet-status');
  
  console.log('Checking for wallet providers...', { 
    phantom: !!window.phantom, 
    solana: !!window.solana, 
    solflare: !!window.solflare 
  });
  
  // First try the preferred modern detection method
  if (window.phantom?.solana) {
    console.log('Phantom wallet detected (modern method)');
    walletProvider = window.phantom.solana;
    console.log('Phantom provider details:', { 
      isPhantom: walletProvider.isPhantom,
      isConnected: walletProvider.isConnected 
    });
  } 
  // Legacy Phantom detection
  else if (window.solana?.isPhantom) {
    console.log('Legacy Phantom wallet detected');
    walletProvider = window.solana;
    console.log('Legacy Phantom provider details:', { 
      isPhantom: walletProvider.isPhantom,
      isConnected: walletProvider.isConnected 
    });
  } 
  // Solflare wallet detection
  else if (window.solflare?.isSolflare) {
    console.log('Solflare wallet detected');
    walletProvider = window.solflare;
    console.log('Solflare provider details:', { 
      isSolflare: walletProvider.isSolflare,
      isConnected: walletProvider.isConnected 
    });
  }
  else {
    console.log('No Solana wallet detected, checking if wallets need to be injected');
    
    // Delayed check for late-injected wallet providers
    setTimeout(() => {
      console.log('Re-checking for wallet providers after delay');
      if (window.phantom?.solana || window.solana?.isPhantom || window.solflare?.isSolflare) {
        console.log('Wallet provider detected after delay, running check again');
        checkForWalletProviders();
      } else {
        console.log('Still no wallet providers after delay');
      }
    }, 1000);
  }
  
  // Update UI based on wallet provider
  if (walletProvider) {
    // Enable connect button
    if (connectBtn) {
      connectBtn.disabled = false;
      console.log('Enabled wallet connect button');
    }
    
    if (walletStatusEl) {
      const providerName = walletProvider.isPhantom ? "Phantom" : (walletProvider.isSolflare ? "Solflare" : "Unknown");
      walletStatusEl.innerHTML = `${providerName} wallet detected`;
      walletStatusEl.className = "wallet-status detected";
    }
  } else {
    console.log('No Solana wallet provider available after checks');
    
    // Disable connect button
    if (connectBtn) {
      connectBtn.disabled = false; // Keep enabled so we can show helpful error
      console.log('Button will show error message on click when no provider found');
    }
    
    if (walletStatusEl) {
      walletStatusEl.innerHTML = 
        "No wallet detected. <a href='https://phantom.app/' target='_blank'>Install Phantom</a> or <a href='https://solflare.com/' target='_blank'>Solflare</a>";
      walletStatusEl.className = "wallet-status not-detected";
    }
  }
}

// Connect to wallet - simplified direct implementation
async function connectWallet() {
  try {
    console.log('Simple wallet connect attempt');
    
    // Direct provider checks
    let provider = null;
    
    if (window.phantom?.solana) {
      provider = window.phantom.solana;
      console.log('Using Phantom provider (modern)');
    } else if (window.solana?.isPhantom) {
      provider = window.solana;
      console.log('Using Phantom provider (legacy)');
    } else if (window.solflare) {
      provider = window.solflare;
      console.log('Using Solflare provider');
    } else {
      alert('No wallet detected. Please install Phantom or Solflare.');
      console.error('No wallet detected');
      return;
    }
    
    console.log('Connecting to wallet...');
    const result = await provider.connect();
    console.log('Connection result:', result);
    
    if (!result.publicKey) {
      alert('Failed to get wallet public key');
      return;
    }
    
    // Set state
    walletAddress = result.publicKey.toString();
    walletProvider = provider;
    walletConnected = true;
    window.walletAddress = walletAddress;
    
    console.log('Connected to wallet:', walletAddress);
    
    // Update UI
    updateWalletUI();
    
    // Enable the live mode toggle as wallet is connected
    const liveModeToggle = document.getElementById('live-mode-toggle');
    if (liveModeToggle) {
      // By default, after connecting, we don't automatically enable live mode
      // User must explicitly choose to enable live mode
      liveModeToggle.disabled = false;
    }
    
    // Notify server
    socket.emit('connect_wallet', { address: walletAddress });
    
    // Show notification
    showNotification('Wallet connected successfully', 'success');
    
  } catch (error) {
    console.error('Wallet connection error:', error);
    alert('Error connecting wallet: ' + error.message);
  }
}

// Disconnect wallet
async function disconnectWallet() {
  try {
    console.log("Direct disconnect wallet function called");
    
    if (!window.walletProvider) {
      console.log("No wallet provider to disconnect");
      return;
    }
    
    try {
      // Disconnect wallet
      window.walletProvider.disconnect();
      
      // Reset global state
      window.walletProvider = null;
      window.walletAddress = null;
      window.walletConnected = false;
      
      // Update UI
      document.getElementById('wallet-status').textContent = "Detected, not connected";
      document.getElementById('wallet-status').className = "wallet-status detected";
      
      const addressEl = document.getElementById('wallet-address');
      if (addressEl) {
        addressEl.style.display = "none";
      }
      
      // Show connect button, hide disconnect
      document.getElementById('wallet-connect-btn').style.display = "inline-block";
      document.getElementById('wallet-disconnect-btn').style.display = "none";
      
      // Disable live mode toggle and reset to Demo
      const liveModeToggle = document.getElementById('live-mode-toggle');
      const modeText = document.getElementById('mode-text');
      
      if (liveModeToggle) {
        liveModeToggle.checked = false;
        liveModeToggle.disabled = true;
      }
      
      if (modeText) {
        modeText.textContent = 'Demo';
        modeText.className = 'mode-text demo';
      }
      
      // Tell server we're now in demo mode
      socket.emit('set_trading_mode', { mode: 'demo' });
      
      // Hide withdrawal section
      const withdrawalSection = document.getElementById('withdrawal-section');
      if (withdrawalSection) {
        withdrawalSection.style.display = "none";
      }
      
      // Notify server
      if (window.socket) {
        window.socket.emit('disconnect_wallet');
      }
      
      // Show notification
      showNotification('Wallet disconnected', 'info');
      
      console.log("Wallet disconnected successfully");
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
    }
  } catch (error) {
    console.error("Error in disconnectWallet function:", error);
  }
}

// Show notification
function showNotification(message, type = 'info') {
  if (window.showNotification) {
    window.showNotification(message, type);
  } else {
    // Fallback notification if global function is not available
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = message;
    
    container.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => {
        container.removeChild(notification);
      }, 500);
    }, 5000);
  }
}

// Update UI based on wallet connection state
function updateWalletUI() {
  // Get wallet buttons
  const connectBtn = document.getElementById('wallet-connect-btn');
  const disconnectBtn = document.getElementById('wallet-disconnect-btn');
  const walletStatusEl = document.getElementById('wallet-status');
  const walletAddressEl = document.getElementById('wallet-address');
  
  if (walletConnected) {
    // Hide connect button and show disconnect button
    if (connectBtn) {
      connectBtn.style.display = 'none';
      console.log('Hiding connect button');
    }
    
    if (disconnectBtn) {
      disconnectBtn.style.display = 'inline-block';
      console.log('Showing disconnect button');
    }
    
    if (walletStatusEl) {
      walletStatusEl.innerHTML = 'Connected';
      walletStatusEl.className = 'wallet-status connected';
    }
    
    // Format address for display (show first 6 and last 4 chars)
    const formattedAddress = formatWalletAddress(walletAddress);
    
    if (walletAddressEl) {
      walletAddressEl.innerHTML = formattedAddress;
      walletAddressEl.style.display = 'block';
    }
    
    // Enable withdrawal functionality
    const withdrawBtn = document.getElementById('withdraw-button');
    if (withdrawBtn) withdrawBtn.disabled = false;
    
    // Update the balance from blockchain
    updateWalletBalance();
    
  } else {
    // Show connect button and hide disconnect button
    if (connectBtn) {
      connectBtn.style.display = 'inline-block';
      connectBtn.innerHTML = `<i class="fas fa-wallet me-2"></i>Connect Wallet`;
      console.log('Showing connect button');
    }
    
    if (disconnectBtn) {
      disconnectBtn.style.display = 'none';
      console.log('Hiding disconnect button');
    }
    
    if (walletStatusEl) {
      walletStatusEl.innerHTML = walletProvider ? 'Detected, not connected' : 'No wallet detected';
      walletStatusEl.className = walletProvider ? 'wallet-status detected' : 'wallet-status not-detected';
    }
    
    if (walletAddressEl) walletAddressEl.style.display = 'none';
    
    // Disable withdrawal functionality
    const withdrawBtn = document.getElementById('withdraw-button');
    if (withdrawBtn) withdrawBtn.disabled = true;
  }
}

// Handle withdrawal request
async function requestWithdrawal() {
  if (!walletConnected) {
    alert('Please connect your wallet first');
    return;
  }
  
  const amountInput = document.getElementById('withdrawal-amount');
  const amount = parseFloat(amountInput.value);
  
  if (isNaN(amount) || amount <= 0) {
    alert('Please enter a valid withdrawal amount');
    return;
  }
  
  const includeLocked = document.getElementById('include-locked-profits').checked;
  const token = document.getElementById('withdrawal-token').value || preferredWithdrawalToken;
  
  // Show processing status
  const withdrawalStatus = document.getElementById('withdrawal-status');
  withdrawalStatus.innerHTML = 'Processing withdrawal...';
  withdrawalStatus.className = 'withdrawal-status processing';
  
  // Disable withdraw button during processing
  document.getElementById('withdraw-button').disabled = true;
  
  // Send withdrawal request to server
  socket.emit('withdraw_funds', {
    amount: amount,
    token: token,
    address: walletAddress,
    includeLocked: includeLocked
  });
}

// Format wallet address for display
function formatWalletAddress(address) {
  if (!address) return '';
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Handle response to withdrawal request
function handleWithdrawalResponse(response) {
  const withdrawalStatus = document.getElementById('withdrawal-status');
  
  if (response.success) {
    withdrawalStatus.innerHTML = `Success! Transaction: ${response.withdrawal.txHash}`;
    withdrawalStatus.className = 'withdrawal-status success';
    
    // Show transaction in history
    addWithdrawalToHistory(response.withdrawal);
    
    // Clear input field
    document.getElementById('withdrawal-amount').value = '';
  } else {
    withdrawalStatus.innerHTML = `Error: ${response.error}`;
    withdrawalStatus.className = 'withdrawal-status error';
  }
  
  // Re-enable withdraw button
  document.getElementById('withdraw-button').disabled = false;
}

// Add a withdrawal to the history display
function addWithdrawalToHistory(withdrawal) {
  const historyContainer = document.getElementById('withdrawal-history');
  
  const historyItem = document.createElement('div');
  historyItem.className = 'withdrawal-history-item';
  
  const date = new Date(withdrawal.timestamp);
  const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  
  historyItem.innerHTML = `
    <div class="withdrawal-date">${formattedDate}</div>
    <div class="withdrawal-details">
      <div class="withdrawal-amount">${withdrawal.amount} ${withdrawal.token}</div>
      <div class="withdrawal-address">To: ${formatWalletAddress(withdrawal.address)}</div>
      <div class="withdrawal-tx">
        <a href="https://explorer.solana.com/tx/${withdrawal.txHash}?cluster=devnet" target="_blank">
          View Transaction
        </a>
      </div>
    </div>
  `;
  
  // Add to the top of the history
  if (historyContainer.firstChild) {
    historyContainer.insertBefore(historyItem, historyContainer.firstChild);
  } else {
    historyContainer.appendChild(historyItem);
  }
}

// Setup event listeners for socket events
function setupEventListeners() {
  // Wallet connection response
  socket.on('wallet_connected', (data) => {
    if (data.success) {
      console.log('Wallet connected confirmed by server:', data.address);
      const walletBalanceEl = document.getElementById('wallet-balance');
      const availableWithdrawalEl = document.getElementById('available-for-withdrawal');
      
      if (walletBalanceEl) {
        walletBalanceEl.innerHTML = `Balance: $${data.balance}`;
      }
      
      if (availableWithdrawalEl) {
        availableWithdrawalEl.innerHTML = `Available for withdrawal: $${data.availableForWithdrawal}`;
      }
    } else {
      console.error('Wallet connection rejected by server:', data.error);
      walletConnected = false;
      updateWalletUI();
    }
  });
  
  // Wallet disconnection response
  socket.on('wallet_disconnected', (data) => {
    console.log('Wallet disconnected confirmed by server');
  });
  
  // Withdrawal processing status
  socket.on('withdrawal_processing', (data) => {
    console.log('Withdrawal processing:', data);
    const withdrawalStatusEl = document.getElementById('withdrawal-status');
    if (withdrawalStatusEl) {
      withdrawalStatusEl.innerHTML = `Processing withdrawal of ${data.amount} ${data.token}...`;
    }
  });
  
  // Withdrawal response
  socket.on('withdrawal_response', (data) => {
    console.log('Withdrawal response:', data);
    handleWithdrawalResponse(data);
  });
  
  // Withdrawal history
  socket.on('withdrawal_history', (data) => {
    console.log('Received withdrawal history:', data);
    const historyContainer = document.getElementById('withdrawal-history');
    if (!historyContainer) return;
    
    historyContainer.innerHTML = '';
    
    // Add history items in reverse chronological order
    data.history.sort((a, b) => b.timestamp - a.timestamp)
      .forEach(item => addWithdrawalToHistory(item));
    
    // Add pending withdrawals at the top
    data.pending.sort((a, b) => b.timestamp - a.timestamp)
      .forEach(item => {
        const pendingItem = { 
          ...item, 
          txHash: 'pending', 
        };
        addWithdrawalToHistory(pendingItem);
      });
  });
  
  // Portfolio updates
  socket.on('portfolio', (data) => {
    if (walletConnected) {
      const walletBalanceEl = document.getElementById('wallet-balance');
      const availableWithdrawalEl = document.getElementById('available-for-withdrawal');
      
      if (walletBalanceEl) {
        walletBalanceEl.innerHTML = `Balance: $${data.balance}`;
      }
      
      if (availableWithdrawalEl) {
        availableWithdrawalEl.innerHTML = `Available for withdrawal: $${parseFloat(data.balance) + parseFloat(data.lockedProfit || 0)}`;
      }
    }
  });
  
  // Button event listeners - connect wallet and disconnect buttons
  const connectBtn = document.getElementById('wallet-connect-btn');
  if (connectBtn) {
    console.log('Setting up wallet connect button click event');
    
    // Remove any existing event listeners
    connectBtn.removeEventListener('click', connectWallet);
    
    // Add new click event listener with direct function reference
    connectBtn.addEventListener('click', function() {
      console.log('Wallet connect button clicked - initiating wallet connection');
      connectWallet();
    });
  } else {
    console.error('Wallet connect button not found with ID: wallet-connect-btn');
  }
  
  const disconnectBtn = document.getElementById('wallet-disconnect-btn');
  if (disconnectBtn) {
    console.log('Setting up wallet disconnect button click event');
    disconnectBtn.removeEventListener('click', disconnectWallet);
    disconnectBtn.addEventListener('click', disconnectWallet);
  } else {
    console.error('Wallet disconnect button not found with ID: wallet-disconnect-btn');
  }
  
  const withdrawBtn = document.getElementById('withdraw-button');
  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', requestWithdrawal);
  }
  
  const refreshHistoryBtn = document.getElementById('refresh-history-button');
  if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener('click', () => {
      if (walletConnected) {
        socket.emit('get_withdrawal_history');
      }
    });
  }
  
  // Token selection for withdrawal
  const withdrawalTokenSelect = document.getElementById('withdrawal-token');
  if (withdrawalTokenSelect) {
    withdrawalTokenSelect.addEventListener('change', (e) => {
      preferredWithdrawalToken = e.target.value;
      socket.emit('set_preferred_token', { token: preferredWithdrawalToken });
    });
  }
}

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded - initializing wallet integration');
  setTimeout(() => {
    console.log('Delayed wallet integration initialization to ensure DOM is fully loaded');
    initWalletIntegration();
    
    // Double-check wallet button setup after a short delay
    setTimeout(() => {
      const connectBtn = document.getElementById('wallet-connect-btn');
      if (connectBtn) {
        console.log('Re-checking wallet connect button setup');
        if (!connectBtn.hasAttribute('data-wallet-initialized')) {
          console.log('Wallet button not properly initialized, setting up again');
          connectBtn.setAttribute('data-wallet-initialized', 'true');
          connectBtn.addEventListener('click', function(e) {
            console.log('Direct wallet connect button click detected');
            e.preventDefault();
            connectWallet();
          });
        }
      }
    }, 1000);
  }, 500);
});

// Ensure wallet functionality is available globally
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;

// Log wallet transactions for security
function logTransaction(type, data) {
  console.log(`[WALLET] ${type} transaction:`, data);
  
  // Send transaction log to server for monitoring
  socket.emit('wallet_transaction_log', {
    type,
    data,
    timestamp: Date.now(),
    walletAddress: walletAddress
  });
  
  // For real trading, add additional security logging
  if (data.isLive) {
    console.warn(`[LIVE TRANSACTION] ${type}:`, data);
  }
}

// Deposit funds to trading wallet
async function depositFunds(amount, token = 'SOL') {
  if (!walletConnected || !walletProvider) {
    console.error('Wallet not connected');
    alert('Please connect your wallet first');
    return;
  }
  
  try {
    console.log(`Depositing ${amount} ${token}...`);
    
    // Get trading wallet address
    const tradingWalletAddress = localStorage.getItem('trading_wallet_address');
    if (!tradingWalletAddress) {
      console.error('Trading wallet address not found');
      alert('Trading wallet not set up. Please reconnect your wallet.');
      return;
    }
    
    // Build transaction
    const connection = new solanaWeb3.Connection(getEndpoint(), 'confirmed');
    const tradingWalletPublicKey = new solanaWeb3.PublicKey(tradingWalletAddress);
    const userWalletPublicKey = new solanaWeb3.PublicKey(walletAddress);
    
    // For SOL transfers
    if (token === 'SOL') {
      const transaction = new solanaWeb3.Transaction().add(
        solanaWeb3.SystemProgram.transfer({
          fromPubkey: userWalletPublicKey,
          toPubkey: tradingWalletPublicKey,
          lamports: amount * solanaWeb3.LAMPORTS_PER_SOL
        })
      );
      
      // Send transaction
      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      
      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');
      
      console.log('Deposit transaction sent:', signature);
      
      // Notify server
      socket.emit('process_deposit', {
        amount: amount,
        signature,
        token
      });
      
      return {
        success: true,
        signature,
        message: `Deposited ${amount} ${token} to trading wallet`
      };
    } else {
      // For token transfers (not implemented in this demo)
      alert('Token deposits not implemented in this demo');
      return {
        success: false,
        message: 'Token deposits not implemented'
      };
    }
  } catch (error) {
    console.error('Error depositing funds:', error);
    alert(`Error depositing funds: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Withdraw funds from trading wallet
async function withdrawFunds(amount, token = 'SOL') {
  if (!walletConnected) {
    console.error('Wallet not connected');
    alert('Please connect your wallet first');
    return;
  }
  
  try {
    console.log(`Withdrawing ${amount} ${token}...`);
    
    // Request withdrawal from server
    socket.emit('process_withdrawal', {
      amount,
      token
    });
    
    // Result will be handled by the socket.on('withdrawal_processed') event
    return {
      success: true,
      message: 'Withdrawal request sent'
    };
  } catch (error) {
    console.error('Error withdrawing funds:', error);
    alert(`Error withdrawing funds: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Start automated trading
function startAutomatedTrading(settings = {}) {
  if (!walletConnected) {
    console.error('Wallet not connected');
    alert('Please connect your wallet first');
    return;
  }
  
  try {
    console.log('Starting automated trading with settings:', settings);
    
    // Request start from server
    socket.emit('start_automated_trading', { settings });
    
    // Result will be handled by the socket.on('automated_trading_started') event
    return {
      success: true,
      message: 'Automated trading request sent'
    };
  } catch (error) {
    console.error('Error starting automated trading:', error);
    alert(`Error starting automated trading: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Stop automated trading
function stopAutomatedTrading() {
  if (!walletConnected) {
    console.error('Wallet not connected');
    alert('Please connect your wallet first');
    return;
  }
  
  try {
    console.log('Stopping automated trading');
    
    // Request stop from server
    socket.emit('stop_automated_trading');
    
    // Result will be handled by the socket.on('automated_trading_stopped') event
    return {
      success: true,
      message: 'Stop automated trading request sent'
    };
  } catch (error) {
    console.error('Error stopping automated trading:', error);
    alert(`Error stopping automated trading: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Execute a manual trade
function executeTrade(fromToken, toToken, amount) {
  if (!walletConnected) {
    console.error('Wallet not connected');
    alert('Please connect your wallet first');
    return;
  }
  
  try {
    console.log(`Executing trade: ${fromToken} -> ${toToken}, amount: ${amount}`);
    
    // Request trade from server
    socket.emit('execute_trade', {
      fromToken,
      toToken,
      amount
    });
    
    // Result will be handled by the socket.on('trade_executed') event
    return {
      success: true,
      message: 'Trade request sent'
    };
  } catch (error) {
    console.error('Error executing trade:', error);
    alert(`Error executing trade: ${error.message}`);
    return {
      success: false,
      message: error.message
    };
  }
}

// Setup event listeners for trading events
function setupTradingEventListeners() {
  // Wallet connection response
  socket.on('wallet_connected', (data) => {
    console.log('Wallet connection response:', data);
    
    if (data.success) {
      // Store trading wallet address
      if (data.tradingWallet) {
        localStorage.setItem('trading_wallet_address', data.tradingWallet);
      }
      
      // Update UI with balance info
      const balanceEl = document.getElementById('wallet-balance');
      if (balanceEl && data.balance) {
        balanceEl.textContent = `Balance: $${data.balance.toFixed(2)}`;
      }
      
      const withdrawalEl = document.getElementById('available-for-withdrawal');
      if (withdrawalEl && data.availableForWithdrawal) {
        withdrawalEl.textContent = `Available for withdrawal: $${data.availableForWithdrawal.toFixed(2)}`;
      }
      
      // Update UI
      updateWalletUI();
      
      showNotification('Wallet connected successfully', 'success');
    } else {
      console.error('Wallet connection failed:', data.error);
      showNotification(`Wallet connection failed: ${data.error}`, 'error');
    }
  });
  
  // Deposit response
  socket.on('deposit_processed', (data) => {
    console.log('Deposit response:', data);
    
    if (data.success) {
      // Update UI with new balance
      const balanceEl = document.getElementById('wallet-balance');
      if (balanceEl && data.balance) {
        balanceEl.textContent = `Balance: $${data.balance.deposited.toFixed(2)}`;
      }
      
      const withdrawalEl = document.getElementById('available-for-withdrawal');
      if (withdrawalEl && data.balance) {
        withdrawalEl.textContent = `Available for withdrawal: $${data.balance.available.toFixed(2)}`;
      }
      
      showNotification('Deposit processed successfully', 'success');
    } else {
      console.error('Deposit failed:', data.error || data.message);
      showNotification(`Deposit failed: ${data.error || data.message}`, 'error');
    }
  });
  
  // Withdrawal response
  socket.on('withdrawal_processed', (data) => {
    console.log('Withdrawal response:', data);
    
    if (data.success) {
      // Update UI with new balance (request updated balance)
      socket.emit('get_wallet_balance');
      
      showNotification('Withdrawal processed successfully', 'success');
    } else {
      console.error('Withdrawal failed:', data.error || data.message);
      showNotification(`Withdrawal failed: ${data.error || data.message}`, 'error');
    }
  });
  
  // Balance update
  socket.on('wallet_balance', (data) => {
    console.log('Balance update:', data);
    
    if (data.success) {
      const balanceEl = document.getElementById('wallet-balance');
      if (balanceEl) {
        balanceEl.textContent = `Balance: $${data.balance.deposited.toFixed(2)}`;
      }
      
      const withdrawalEl = document.getElementById('available-for-withdrawal');
      if (withdrawalEl) {
        withdrawalEl.textContent = `Available for withdrawal: $${data.balance.available.toFixed(2)}`;
      }
    }
  });
  
  // Automated trading started
  socket.on('automated_trading_started', (data) => {
    console.log('Automated trading response:', data);
    
    if (data.success) {
      showNotification('Automated trading started', 'success');
      
      // Update UI to show trading is active
      const startBtn = document.getElementById('start-trading-btn');
      const stopBtn = document.getElementById('stop-trading-btn');
      
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-block';
    } else {
      console.error('Failed to start automated trading:', data.error || data.message);
      showNotification(`Failed to start automated trading: ${data.error || data.message}`, 'error');
    }
  });
  
  // Automated trading stopped
  socket.on('automated_trading_stopped', (data) => {
    console.log('Automated trading stopped response:', data);
    
    if (data.success) {
      showNotification('Automated trading stopped', 'success');
      
      // Update UI to show trading is inactive
      const startBtn = document.getElementById('start-trading-btn');
      const stopBtn = document.getElementById('stop-trading-btn');
      
      if (startBtn) startBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'none';
    } else {
      console.error('Failed to stop automated trading:', data.error || data.message);
      showNotification(`Failed to stop automated trading: ${data.error || data.message}`, 'error');
    }
  });
  
  // Trade executed
  socket.on('trade_executed', (data) => {
    console.log('Trade executed response:', data);
    
    if (data.success) {
      showNotification(`Trade executed: ${data.fromToken} → ${data.toToken}`, 'success');
      
      // Request updated balance
      socket.emit('get_wallet_balance');
    } else {
      console.error('Trade failed:', data.error || data.message);
      showNotification(`Trade failed: ${data.error || data.message}`, 'error');
    }
  });
}

// Initialize additional event listeners
function initializeWalletIntegration() {
  // ... existing initialization ...
  
  // Setup trading event listeners
  setupTradingEventListeners();
  
  // Attach event listeners for trading controls
  const depositBtn = document.getElementById('deposit-btn');
  if (depositBtn) {
    depositBtn.addEventListener('click', () => {
      const amountInput = document.getElementById('deposit-amount');
      const tokenSelect = document.getElementById('deposit-token');
      
      if (amountInput && tokenSelect) {
        const amount = parseFloat(amountInput.value);
        const token = tokenSelect.value;
        
        if (amount && !isNaN(amount) && amount > 0) {
          depositFunds(amount, token);
        } else {
          alert('Please enter a valid amount');
        }
      }
    });
  }
  
  const withdrawBtn = document.getElementById('withdraw-button');
  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', () => {
      const amountInput = document.getElementById('withdrawal-amount');
      const tokenSelect = document.getElementById('withdrawal-token');
      
      if (amountInput && tokenSelect) {
        const amount = parseFloat(amountInput.value);
        const token = tokenSelect.value;
        
        if (amount && !isNaN(amount) && amount > 0) {
          withdrawFunds(amount, token);
        } else {
          alert('Please enter a valid amount');
        }
      }
    });
  }
  
  const startTradingBtn = document.getElementById('start-trading-btn');
  if (startTradingBtn) {
    startTradingBtn.addEventListener('click', () => {
      // Get settings from UI
      const settings = {
        strategy: document.getElementById('trading-strategy')?.value || 'default',
        tradeSize: parseFloat(document.getElementById('trade-size')?.value || '10'),
        maxTrades: parseInt(document.getElementById('max-trades')?.value || '10'),
      };
      
      startAutomatedTrading(settings);
    });
  }
  
  const stopTradingBtn = document.getElementById('stop-trading-btn');
  if (stopTradingBtn) {
    stopTradingBtn.addEventListener('click', () => {
      stopAutomatedTrading();
    });
  }
  
  const tradeBtn = document.getElementById('execute-trade-btn');
  if (tradeBtn) {
    tradeBtn.addEventListener('click', () => {
      const fromToken = document.getElementById('from-token')?.value;
      const toToken = document.getElementById('to-token')?.value;
      const amount = parseFloat(document.getElementById('trade-amount')?.value || '0');
      
      if (fromToken && toToken && amount > 0) {
        executeTrade(fromToken, toToken, amount);
      } else {
        alert('Please enter valid trade details');
      }
    });
  }
  
  // Live mode toggle
  const liveModeToggle = document.getElementById('live-mode-toggle');
  if (liveModeToggle) {
    liveModeToggle.addEventListener('change', (e) => {
      const modeText = document.getElementById('mode-text');
      
      if (e.target.checked) {
        // Switching to Live mode
        if (!walletConnected) {
          alert('Please connect your wallet to use live mode.');
          e.target.checked = false;
          return;
        }
        
        if (modeText) {
          modeText.textContent = 'Live';
          modeText.className = 'mode-text live';
        }
        
        // Tell server we're now in live mode
        socket.emit('set_trading_mode', { mode: 'live' });
        showNotification('Switched to Live mode', 'success');
      } else {
        // Switching to Demo mode
        if (modeText) {
          modeText.textContent = 'Demo';
          modeText.className = 'mode-text demo';
        }
        
        // Tell server we're now in demo mode
        socket.emit('set_trading_mode', { mode: 'demo' });
        showNotification('Switched to Demo mode', 'info');
      }
    });
  }
}

// Make functions available globally
window.depositFunds = depositFunds;
window.withdrawFunds = withdrawFunds;
window.startAutomatedTrading = startAutomatedTrading;
window.stopAutomatedTrading = stopAutomatedTrading;
window.executeTrade = executeTrade; 