// Soul-Bot Trading Dashboard - Main Application Script

// Add debugging at the top of the file
function logDebug(message, data) {
  console.log(`%c${message}`, 'background: #222; color: #bada55', data || '');
}

// Make sure the Socket.IO connection is working
console.log("Initializing Socket.IO connection...");

// Debug the socket object
let socket;

function initializeSocket() {
  console.log("Setting up Socket.IO connection...");
  
  // Create the socket with explicit debugging enabled
  socket = io({
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 10000,
    transports: ['websocket', 'polling'],
    debug: true
  });
  
  // Store it in the window object so other scripts can access it
  window.socket = socket;
  
  // Set up connection event handlers
  socket.on('connect', () => {
    console.log("Socket.IO CONNECTED! ID:", socket.id);
    document.body.classList.add('socket-connected');
  });
  
  socket.on('connect_error', (error) => {
    console.error("Socket.IO Connection Error:", error);
  });
  
  socket.on('disconnect', (reason) => {
    console.warn("Socket.IO Disconnected. Reason:", reason);
    document.body.classList.remove('socket-connected');
  });
  
  // Debug listener for all events
  socket.onAny((event, ...args) => {
    console.log(`[Socket.IO Event] ${event}:`, args);
  });
}

// Initialize Socket.IO when the page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM loaded, initializing Socket.IO...");
  initializeSocket();

  // Setup Start button event handler
  const startButton = document.getElementById('start-btn');
  if (startButton) {
    console.log("Start button found, setting up click handler");
    
    startButton.addEventListener('click', () => {
      console.log("START BUTTON CLICKED!");
      
      // Check if already trading (button is in stop mode)
      if (startButton.classList.contains('btn-danger')) {
        console.log("Stopping trading");
        window.socket.emit('stop_trading');
        
        // Update button appearance
        startButton.innerHTML = '<i class="fas fa-play me-2"></i>Start';
        startButton.classList.remove('btn-danger');
        startButton.classList.add('btn-success');
      } else {
        // Get trading mode (demo/live)
        const mode = document.getElementById('trading-mode')?.value || 'demo';
        console.log(`Starting trading in ${mode} mode`);
        
        // Reset metrics to zero before starting
        resetPortfolioMetrics();
        
        // Clear any existing trades when starting new session
        window.trades = [];
        updateTradesTable([]);
        
        // Send start_trading event with mode
        window.socket.emit('start_trading', { mode });
        console.log("start_trading event sent to server");
        
        // Update button appearance
        startButton.innerHTML = '<i class="fas fa-stop me-2"></i>Stop';
        startButton.classList.remove('btn-success');
        startButton.classList.add('btn-danger');
      }
    });
    
    console.log("Start button handler set up successfully");
  } else {
    console.error("Start button not found in the DOM!");
  }
});

function setupSocketHandlers() {
  // Connection event handlers
  socket.on('connect', () => {
    console.log('Connected to Soul-Bot trading server!');
    showNotification('Connected to trading server', 'success');
    isConnected = true;
    
    // Request initial data
    socket.emit('get_trades');
    socket.emit('get_portfolio');
    socket.emit('get_performance');
    
    // Get the current trading status
    socket.emit('get_trading_status');
  });
  
  socket.on('connection_established', (data) => {
    console.log('Connection established with server:', data);
    isConnected = true;
  });
  
  socket.on('pong', (data) => {
    console.log('Received pong from server:', data.serverTime);
    if (data.tradingActive !== undefined) {
      updateBotStatus(data.tradingActive);
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    showNotification('Connection error: ' + error.message, 'error');
    updateBotStatus(false);
    isConnected = false;
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from trading server');
    showNotification('Disconnected from trading server', 'error');
    updateBotStatus(false);
    isConnected = false;
  });

  // Socket event handlers
  socket.on('status', (status) => {
    console.log('Received status update:', status);
    updateBotStatus(status.isRunning);
  });

  // Handle trading status response
  socket.on('trading_status', (data) => {
    console.log('Received trading status:', data);
    updateBotStatus(data.isRunning);
  });

  // Combined status update handler
  socket.on('state_update', (data) => {
    console.log('Received status update:', data);
    try {
      if (data.portfolio) {
        updatePortfolioUI(data.portfolio);
      }
      if (data.performance) {
        updatePerformanceMetrics(data.performance);
      }
      if (data.botStatus) {
        updateBotStatus(data.botStatus === 'active');
      }
      if (data.tradingControl && data.tradingControl.isRunning !== undefined) {
        updateBotStatus(data.tradingControl.isRunning);
      }
      
      // Store the data in a global variable for other components
      window.state = data;
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  });
  
  // Handle ML stats updates with the processor
  socket.on('ml_params_update', processMlStats);
  socket.on('ml-stats', processMlStats);

  // Handle new trade event
  socket.on('new_trade', function(trade) {
    handleNewTrade(trade);
  });

  // Handle token discovery events
  socket.on('token_discovered', function(token) {
    console.log('New token discovered:', token);
    
    // Show notification about the new token
    showNotification(`Discovered new token: ${token.symbol} (${token.name})`, 'info');
    
    // Add to discovered tokens list in UI
    addDiscoveredTokenToUI(token);
    
    // Store in local storage
    const discoveredTokens = JSON.parse(localStorage.getItem('soul_bot_discovered_tokens') || '[]');
    discoveredTokens.push({
      ...token,
      discoveryTime: Date.now()
    });
    localStorage.setItem('soul_bot_discovered_tokens', JSON.stringify(discoveredTokens));
  });

  // Get ML parameters on connect
  socket.on('connect', () => {
    setTimeout(() => {
      // Request ML parameters after connection
      console.log('Requesting ML parameters...');
      socket.emit('get_ml_params');
    }, 1000);
  });
}

// Global variables
let trades = [];
const MAX_TRADES = 20; // Maximum number of trades to keep in memory
let botRunning = false;
let tradingData = {
  trades: [],
  portfolio: {
    value: 50,
    change: 0,
    pnl: 0
  }
};

// Trade pagination variables
let currentPage = 1;
const pageSize = 20; // Change from 10 to 20 trades per page
let allTrades = [];
let filteredTrades = [];

// Wallet state
const wallet = {
  connected: false,
  publicKey: null,
  balance: 0,
  provider: null,
  
  async connect() {
    try {
      if (window.solana) {
        this.provider = window.solana;
        
        // Ensure wallet is connected
        if (!this.provider.isConnected) {
          const response = await this.provider.connect();
          this.publicKey = response.publicKey.toString();
        } else {
          this.publicKey = this.provider.publicKey.toString();
        }
        
        this.connected = true;
        
        // Get SOL balance
        if (window.solanaWeb3) {
          const connection = new solanaWeb3.Connection('https://api.mainnet-beta.solana.com');
          const balance = await connection.getBalance(this.provider.publicKey);
          this.balance = balance / 1000000000; // Convert lamports to SOL
        }
        
        this.updateUI();
        
        // Notify server about wallet connection
        socket.emit('connect_wallet', {
          address: this.publicKey,
          balance: this.balance
        });
        
        // Store wallet info globally for trading
        window.connectedWallet = this.publicKey;
        window.walletBalance = this.balance;
        
        // Ensure trading mode is updated
        const modeSelect = document.getElementById('trading-mode');
        if (modeSelect) {
          // Enable live trading option if not already enabled
          const liveOption = Array.from(modeSelect.options).find(opt => opt.value === 'live');
          if (liveOption) {
            liveOption.disabled = false;
          }
        }
        
        showNotification('Wallet connected successfully', 'success');
        return true;
      } else {
        showNotification('Please install Phantom wallet extension', 'error');
        return false;
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      showNotification('Error connecting wallet: ' + error.message, 'error');
      return false;
    }
  },
  
  async disconnect() {
    try {
      if (this.provider && this.connected) {
        await this.provider.disconnect();
        this.connected = false;
        this.publicKey = null;
        this.balance = 0;
        this.updateUI();
        
        // Notify server about wallet disconnection
        socket.emit('disconnect_wallet');
        
        // Clear global wallet info
        window.connectedWallet = null;
        window.walletBalance = null;
        
        // Update trading mode options
        const modeSelect = document.getElementById('trading-mode');
        if (modeSelect) {
          // Disable live trading option when wallet disconnected
          const liveOption = Array.from(modeSelect.options).find(opt => opt.value === 'live');
          if (liveOption) {
            liveOption.disabled = true;
          }
          // Switch to demo mode if currently on live
          if (modeSelect.value === 'live') {
            modeSelect.value = 'demo';
          }
        }
        
        showNotification('Wallet disconnected', 'info');
      }
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  },
  
  updateUI() {
    const connectBtn = document.getElementById('connect-wallet-btn');
    if (connectBtn) {
      if (this.connected) {
        const shortAddress = this.publicKey.substring(0, 4) + '...' + this.publicKey.substring(this.publicKey.length - 4);
        connectBtn.innerHTML = `<i class="fas fa-wallet me-2"></i>${shortAddress} (${this.balance.toFixed(2)} SOL)`;
        connectBtn.classList.add('btn-success');
        connectBtn.classList.remove('btn-light');
      } else {
        connectBtn.innerHTML = '<i class="fas fa-wallet me-2"></i>Connect Wallet';
        connectBtn.classList.remove('btn-success');
        connectBtn.classList.add('btn-light');
      }
    }
    
    // Update trading mode option
    const modeSelect = document.getElementById('trading-mode');
    if (modeSelect) {
      const liveOption = Array.from(modeSelect.options).find(opt => opt.value === 'live');
      if (liveOption) {
        liveOption.disabled = !this.connected;
      }
    }
    
    // Update debug UI if available
    const walletStatus = document.getElementById('wallet-status');
    if (walletStatus) {
      if (this.connected) {
        walletStatus.textContent = `Connected: ${this.publicKey.substring(0, 8)}...`;
        walletStatus.className = 'text-success';
      } else {
        walletStatus.textContent = 'Disconnected';
        walletStatus.className = 'text-danger';
      }
    }
  }
};

// DOM Elements
const startButton = document.getElementById('start-btn');
const stopButton = document.getElementById('stop-btn');
const scanButton = document.getElementById('scan-btn');
const portfolioValue = document.getElementById('portfolio-value');
const totalPnL = document.getElementById('total-pnl');
const dailyPnL = document.getElementById('daily-pnl');
const tradesBody = document.getElementById('trades-body');
const botStatus = document.getElementById('bot-status');

// Connection event handlers
socket.on('connect', () => {
  console.log('Connected to Soul-Bot trading server!');
  showNotification('Connected to trading server', 'success');
  // Don't mark the bot as running by default, check the actual state first
  updateBotStatus(false);
  isConnected = true;
  
  // Request initial data
  socket.emit('get_trades');
  socket.emit('get_portfolio');
  socket.emit('get_performance');
  
  // Get the current trading status
  socket.emit('get_trading_status');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  showNotification('Connection error: ' + error.message, 'error');
  updateBotStatus(false);
  isConnected = false;
});

socket.on('disconnect', () => {
  console.log('Disconnected from trading server');
  showNotification('Disconnected from trading server', 'error');
  updateBotStatus(false);
  isConnected = false;
});

// Socket event handlers
socket.on('status', (status) => {
  updateBotStatus(status.isRunning);
});

// Handle trading status response
socket.on('trading_status', (data) => {
  console.log('Received trading status:', data);
  updateBotStatus(data.isRunning);
});

// Combined status update handler
socket.on('state_update', (data) => {
  console.log('Received status update:', data);
  try {
    if (data.portfolio) {
      updatePortfolioUI(data.portfolio);
    }
    if (data.performance) {
      updatePerformanceMetrics(data.performance);
    }
    if (data.botStatus) {
      updateBotStatus(data.botStatus === 'active');
    }
    
    // Store the data in a global variable for other components
    window.state = data;
  } catch (error) {
    console.error('Error handling status update:', error);
  }
});

// Handle new trade event
socket.on('new_trade', function(trade) {
  handleNewTrade(trade);
});

// Handle bulk trades loading (initial load and updates)
socket.on('recent_trades', function(trades) {
  console.log('Recent trades received:', trades.length);
  if (trades && trades.length > 0) {
    window.trades = trades;
    updateTradesTable(window.trades);
    
    // Save trades to localStorage
    try {
      const storableTrades = window.trades.slice(-50); // Keep storage size reasonable
      localStorage.setItem('soul_bot_trades', JSON.stringify(storableTrades));
      console.log('Trades saved to localStorage after bulk load');
    } catch (storageError) {
      console.error('Error saving trades to localStorage:', storageError);
    }
  }
});

// Handle trades from API endpoint
socket.on('trades', function(trades) {
  console.log('Trades received from API:', trades.length);
  if (trades && trades.length > 0) {
    window.trades = trades;
    updateTradesTable(window.trades);
    
    // Save trades to localStorage
    try {
      const storableTrades = window.trades.slice(-50); // Keep storage size reasonable
      localStorage.setItem('soul_bot_trades', JSON.stringify(storableTrades));
      console.log('Trades saved to localStorage after API load');
    } catch (storageError) {
      console.error('Error saving trades to localStorage:', storageError);
    }
  }
});

// Handle portfolio updates
socket.on('portfolio', function(data) {
  console.log('Portfolio update received:', data);
  updatePortfolioUI(data);
});

// Handle the Start button to make it clearly show when trading has started
startButton.addEventListener('click', () => {
  if (!isConnected) {
    showNotification('Not connected to trading server', 'error');
    // Try to reconnect
    initializeSocket();
    return;
  }
  
  // If already running (button is in stop mode), stop trading
  if (startButton.classList.contains('btn-danger')) {
    console.log('Stopping trading (via start/stop button)');
    socket.emit('stop_trading');
    
    // Update button state back to start mode
    startButton.innerHTML = '<i class="fas fa-play me-2"></i>Start';
    startButton.classList.remove('btn-danger');
    startButton.classList.add('btn-success');
    
    showNotification('Stopping trading bot...', 'info');
    return;
  }
  
  const mode = document.getElementById('trading-mode').value;
  console.log('Starting trading in mode:', mode);
  
  // Reset metrics to zero before starting
  resetPortfolioMetrics();
  
  // Clear any existing trades when starting new session
  window.trades = [];
  updateTradesTable([]);
  
  // Include wallet address if connected
  const walletInfo = {
    mode: mode || 'demo'
  };
  
  console.log('Sending start_trading event with data:', walletInfo);
  
  // Update button immediately to provide feedback
  startButton.innerHTML = '<i class="fas fa-stop me-2"></i>Stop';
  startButton.classList.remove('btn-success');
  startButton.classList.add('btn-danger');
  
  // Also immediately show a loading indicator in the trades section
  const tradesTableBody = document.getElementById('trades-table-body');
  if (tradesTableBody) {
    tradesTableBody.innerHTML = '<tr><td colspan="5" class="text-center">Starting trading... <div class="spinner-border spinner-border-sm text-primary" role="status"></div></td></tr>';
  }
  
  // Highlight the trades section to draw attention
  const tradesSection = document.querySelector('.card-header');
  if (tradesSection) {
    tradesSection.classList.add('highlight-section');
    setTimeout(() => {
      tradesSection.classList.remove('highlight-section');
    }, 3000);
  }
  
  // Send the start_trading event to the server
  socket.emit('start_trading', walletInfo);
  
  showNotification('Starting trading bot...', 'info');
});

// Handle stop button (though we'll now prefer using the start/stop toggle button)
if (stopButton) {
  stopButton.addEventListener('click', () => {
    if (!isConnected) {
      showNotification('Not connected to trading server', 'error');
      return;
    }
    
    console.log('Stopping trading (via separate stop button)');
    socket.emit('stop_trading');
    
    // Update button state
    startButton.innerHTML = '<i class="fas fa-play me-2"></i>Start Trading';
    startButton.classList.remove('btn-danger');
    startButton.classList.add('btn-success');
    
    showNotification('Stopping trading bot...', 'info');
  });
  
  // Hide the separate stop button initially since we're using the toggle approach
  stopButton.style.display = 'none';
}

scanButton.addEventListener('click', () => {
  if (!isConnected) {
    showNotification('Not connected to trading server', 'error');
    return;
  }
  
  socket.emit('scan_tokens');
  showNotification('Scanning for new tokens...', 'info');
});

// Set up filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    const filter = this.getAttribute('data-filter');
    filterTrades(filter);
    
    // Update active class
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
  });
});

// UI Update Functions

// Update bot status display
function updateBotStatus(isRunning) {
  if (isRunning) {
    botStatus.classList.remove('offline');
    botStatus.classList.add('online');
    botStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span>Online</span>';
    
    // Update start button to be a stop button
    startButton.innerHTML = '<i class="fas fa-stop me-2"></i>Stop Trading';
    startButton.classList.remove('btn-success');
    startButton.classList.add('btn-danger');
    
    // Hide the separate stop button as we're using the toggle approach
    if (stopButton) {
      stopButton.style.display = 'none';
    }
  } else {
    botStatus.classList.remove('online');
    botStatus.classList.add('offline');
    botStatus.innerHTML = '<i class="fas fa-pause-circle"></i> <span>Offline</span>';
    
    // Update start button to be a start button
    startButton.innerHTML = '<i class="fas fa-play me-2"></i>Start Trading';
    startButton.classList.remove('btn-danger');
    startButton.classList.add('btn-success');
  }
  
  // Request latest ML stats to ensure accuracy is up to date
  if (socket && socket.connected) {
    setTimeout(() => {
      socket.emit('get_ml_params');
    }, 500);
  }
}

// Filter trades by type
function filterTrades(filter) {
  if (!window.trades || window.trades.length === 0) {
    updateTradesTable([]);
    return;
  }
  
  let filteredTrades;
  
  if (filter === 'all') {
    filteredTrades = window.trades;
  } else if (filter === 'success') {
    filteredTrades = window.trades.filter(trade => trade.success);
  } else if (filter === 'failed') {
    filteredTrades = window.trades.filter(trade => !trade.success);
  } else {
    filteredTrades = window.trades;
  }
  
  updateTradesTable(filteredTrades);
}

// Update ML accuracy display
function updateMLAccuracy(accuracy) {
  const mlAccuracyElement = document.getElementById('ml-accuracy');
  if (!mlAccuracyElement) return;
  
  console.log('Updating ML accuracy to:', accuracy);
  
  // Parse the accuracy value safely
  const accuracyVal = parseFloat(accuracy);
  
  // Format the accuracy value
  const formattedAccuracy = isNaN(accuracyVal) ? '0.0' : accuracyVal.toFixed(1);
  
  // Update the element text
  mlAccuracyElement.textContent = `${formattedAccuracy}%`;
  
  // Set the appropriate class based on accuracy level
  if (accuracyVal >= 70) {
    mlAccuracyElement.className = 'positive';
    mlAccuracyElement.setAttribute('data-ml-status', 'excellent');
  } else if (accuracyVal >= 50) {
    mlAccuracyElement.className = '';
    mlAccuracyElement.setAttribute('data-ml-status', 'good');
  } else {
    mlAccuracyElement.className = 'negative';
    mlAccuracyElement.setAttribute('data-ml-status', 'needs-improvement');
  }
  
  // Add additional ML details to the tooltip if available
  if (window.state && window.state.mlStats) {
    const totalPredictions = window.state.mlStats.predictions || 0;
    const correctPredictions = window.state.mlStats.correct || 0;
    const lastTraining = window.state.mlStats.lastTraining ? 
      new Date(window.state.mlStats.lastTraining).toLocaleString() : 'Never';
    
    // Create a tooltip with detailed ML stats
    mlAccuracyElement.setAttribute('title', 
      `ML Performance: ${formattedAccuracy}% accuracy\n` +
      `Correct predictions: ${correctPredictions}/${totalPredictions}\n` +
      `Last model training: ${lastTraining}`
    );
    
    // Update learning progress bar
    const learningProgressBar = document.getElementById('ml-learning-progress');
    if (learningProgressBar) {
      // Calculate progress based on number of predictions (max out at 1000)
      const progressPercentage = Math.min(100, (totalPredictions / 1000) * 100);
      learningProgressBar.style.width = `${progressPercentage}%`;
      
      // Add color indication based on accuracy
      if (accuracyVal >= 70) {
        learningProgressBar.style.backgroundColor = '#10b981'; // Green for excellent
      } else if (accuracyVal >= 50) {
        learningProgressBar.style.backgroundColor = '#f59e0b'; // Yellow/orange for good
      } else {
        learningProgressBar.style.backgroundColor = '#ef4444'; // Red for needs improvement
      }
    }
    
    // Add a visual indicator of ML learning progress
    const learningProgress = totalPredictions > 0 ? Math.min(100, totalPredictions / 10) : 0;
    mlAccuracyElement.style.backgroundImage = 
      `linear-gradient(to right, rgba(106, 90, 205, 0.1) ${learningProgress}%, transparent ${learningProgress}%)`;
  }
  
  // Add a subtle animation to show the value has been updated
  mlAccuracyElement.classList.add('value-updated');
  setTimeout(() => {
    mlAccuracyElement.classList.remove('value-updated');
  }, 1000);
}

// Ensure ML updates are processed properly
function processMlStats(stats) {
  try {
    console.log('Processing ML stats:', stats);
    
    // Store updated stats in global state
    if (!window.state) window.state = {};
    if (!window.state.mlStats) window.state.mlStats = {};
    
    // Update all available stats
    Object.keys(stats).forEach(key => {
      window.state.mlStats[key] = stats[key];
    });
    
    // Handle accuracy specifically
    if (stats.accuracy !== undefined) {
      const accuracy = parseFloat(stats.accuracy);
      window.state.mlStats.accuracy = accuracy;
      
      // Update the UI
      updateMLAccuracy(accuracy);
      
      // Display ML improvement notification if accuracy improved
      if (window.previousMlAccuracy && accuracy > window.previousMlAccuracy + 5) {
        showNotification(`ML accuracy improved to ${accuracy.toFixed(1)}%`, 'success');
      }
      window.previousMlAccuracy = accuracy;
    }
    
    // Update ML prediction count
    if (stats.predictions !== undefined) {
      window.state.mlStats.predictions = stats.predictions;
      
      // Show milestone notification for prediction count
      if (stats.predictions % 100 === 0 && stats.predictions > 0) {
        showNotification(`ML system reached ${stats.predictions} predictions`, 'info');
      }
    }
    
    // Update correct prediction count
    if (stats.correct !== undefined) {
      window.state.mlStats.correct = stats.correct;
    }
    
    // Update last training timestamp
    if (stats.lastTraining !== undefined) {
      window.state.mlStats.lastTraining = stats.lastTraining;
    }
    
    // Update test accuracy if available
    if (stats.testAccuracy !== undefined) {
      window.state.mlStats.testAccuracy = stats.testAccuracy;
    }
    
    // Update ML parameters if available
    const entryThreshold = document.getElementById('entry-threshold');
    if (entryThreshold && stats.entryThreshold !== undefined) {
      entryThreshold.value = stats.entryThreshold;
    }
    
    const exitThreshold = document.getElementById('exit-threshold');
    if (exitThreshold && stats.exitThreshold !== undefined) {
      exitThreshold.value = stats.exitThreshold;
    }
    
    const stopLoss = document.getElementById('stop-loss');
    if (stopLoss && stats.stopLoss !== undefined) {
      stopLoss.value = stats.stopLoss;
    }
    
    const takeProfit = document.getElementById('take-profit');
    if (takeProfit && stats.takeProfit !== undefined) {
      takeProfit.value = stats.takeProfit;
    }
    
    // Show notification if parameters were optimized for wallet
    if (stats.isOptimized && stats.walletOptimized) {
      showNotification('ML parameters optimized for wallet trading', 'success');
    }
    
    // Update ML debug panel if it exists
    const mlDebugElement = document.getElementById('ml-debug-details');
    if (mlDebugElement) {
      const details = [
        `Accuracy: ${(stats.accuracy || 0).toFixed(1)}%`,
        `Predictions: ${stats.predictions || 0}`,
        `Correct: ${stats.correct || 0}`,
        `Training size: ${stats.trainingDataSize || 0} records`,
        `Last training: ${stats.lastTraining ? new Date(stats.lastTraining).toLocaleString() : 'Never'}`
      ].join('<br>');
      
      mlDebugElement.innerHTML = details;
    }
    
    // Save the updated ML stats to localStorage immediately
    try {
      localStorage.setItem('soul_bot_ml_stats', JSON.stringify(window.state.mlStats));
      console.log('ML stats saved to localStorage after update');
    } catch (storageError) {
      console.error('Error saving ML stats to localStorage:', storageError);
    }
    
  } catch (error) {
    console.error('Error processing ML stats:', error);
  }
}

// Update portfolio stats UI
function updatePortfolioUI(portfolio) {
  if (!portfolio) return;
  
  console.log('Updating portfolio UI with data:', portfolio);
  
  // Update portfolio balance
  if (portfolioValue && portfolio.balance !== undefined) {
    portfolioValue.textContent = `$${parseFloat(portfolio.balance).toFixed(2)}`;
  }
  
  // Update total P&L
  if (totalPnL && portfolio.totalPnL !== undefined) {
    const pnlValue = parseFloat(portfolio.totalPnL);
    const formattedPnL = pnlValue.toFixed(2);
    const pnlClass = pnlValue >= 0 ? 'positive' : 'negative';
    totalPnL.textContent = `$${formattedPnL}`;
    totalPnL.className = pnlClass;
  }
  
  // Update daily return
  if (dailyPnL && portfolio.dailyReturn !== undefined) {
    const dailyValue = parseFloat(portfolio.dailyReturn);
    const formattedDaily = dailyValue.toFixed(2);
    const dailyClass = dailyValue >= 0 ? 'positive' : 'negative';
    dailyPnL.textContent = `${formattedDaily}%`;
    dailyPnL.className = dailyClass;
  }
  
  // Update ML accuracy using the dedicated function
  if (portfolio.mlAccuracy !== undefined) {
    updateMLAccuracy(portfolio.mlAccuracy);
  }
}

// Update performance metrics
function updatePerformanceMetrics(performance) {
  if (!performance) return;
  
  // Update Total P&L
  if (performance.totalProfitLoss !== undefined) {
    const pnlValue = parseFloat(performance.totalProfitLoss);
    const formattedPnL = pnlValue.toFixed(2);
    const pnlClass = pnlValue >= 0 ? 'positive' : 'negative';
    totalPnL.textContent = `$${formattedPnL}`;
    totalPnL.className = pnlClass;
  }
  
  // Update Daily P&L
  if (performance.dailyProfitLoss !== undefined) {
    const dailyValue = parseFloat(performance.dailyProfitLoss);
    const formattedDaily = dailyValue.toFixed(2);
    const dailyClass = dailyValue >= 0 ? 'positive' : 'negative';
    dailyPnL.textContent = `${formattedDaily}%`;
    dailyPnL.className = dailyClass;
  }
  
  // Update ML Accuracy
  const mlAccuracy = document.getElementById('ml-accuracy');
  if (mlAccuracy && performance.mlAccuracy !== undefined) {
    mlAccuracy.textContent = `${parseFloat(performance.mlAccuracy).toFixed(1)}%`;
  }
}

// Update trades table with pagination
function updateTradesTable(trades) {
  console.log('Updating trades table with', trades ? trades.length : 0, 'trades');
  
  // Define token mapping
  const tokenMap = {
    'So11111111111111111111111111111111111111112': 'SOL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU': 'SAMO',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP', 
    'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': 'ORCA',
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLZYQJB9ihCn3': 'WIF',
    '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx': 'JITO',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL'
  };
  
  // Helper function to get token symbol
  function getSymbolFromAnyField(trade, type) {
    const prefix = type === 'from' ? 'from' : 'to';
    
    // First check for direct symbol
    if (trade[`${prefix}Symbol`] && trade[`${prefix}Symbol`].length < 10) {
      return trade[`${prefix}Symbol`];
    }
    
    // Then check for address mapping
    if (trade[`${prefix}Token`] && tokenMap[trade[`${prefix}Token`]]) {
      return tokenMap[trade[`${prefix}Token`]];
    }
    
    // Check direct address field
    if (trade[prefix] && tokenMap[trade[prefix]]) {
      return tokenMap[trade[prefix]];
    }
    
    // Check for token name
    if (trade[`${prefix}TokenName`]) {
      return trade[`${prefix}TokenName`];
    }
    
    // Last resort - if it's a known address itself
    if (typeof trade[`${prefix}Symbol`] === 'string' && tokenMap[trade[`${prefix}Symbol`]]) {
      return tokenMap[trade[`${prefix}Symbol`]];
    }
    
    // Fallback
    return 'Unknown';
  }
  
  // Store all trades for pagination
  if (trades && trades.length > 0) {
    allTrades = [...trades]; // Make a copy of all trades
  } else {
    allTrades = [];
  }
  
  // Apply current filter if there is one
  filteredTrades = allTrades;
  
  const tableBody = document.getElementById('trades-table-body');
  if (!tableBody) {
    console.error('trades-table-body element not found');
    return;
  }
  
  // Clear existing content
  tableBody.innerHTML = '';
  
  // Handle empty trades array
  if (!trades || trades.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="5" class="text-center">No trades yet</td>';
    tableBody.appendChild(row);
    
    // Update pagination info
    const countElement = document.getElementById('trades-count');
    if (countElement) countElement.textContent = 'Total: 0 trades';
    
    const pageInfoElement = document.getElementById('trades-page-info');
    if (pageInfoElement) pageInfoElement.textContent = 'Page 1 of 1';
    
    // Disable pagination buttons
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    
    // Hide pagination if no trades
    const paginationContainer = document.querySelector('.trades-pagination');
    if (paginationContainer) paginationContainer.style.display = 'none';
    
    return;
  }
  
  // Show pagination if we have trades
  const paginationContainer = document.querySelector('.trades-pagination');
  if (paginationContainer) paginationContainer.style.display = 'flex';
  
  // Calculate pagination
  const totalPages = Math.ceil(trades.length / pageSize);
  
  // Adjust current page if it's out of bounds after filtering
  if (currentPage > totalPages) {
    currentPage = Math.max(1, totalPages);
  }
  
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, trades.length);
  
  // Update pagination controls
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');
  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
    prevBtn.classList.toggle('btn-outline-secondary', currentPage <= 1);
    prevBtn.classList.toggle('btn-outline-primary', currentPage > 1);
  }
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.classList.toggle('btn-outline-secondary', currentPage >= totalPages);
    nextBtn.classList.toggle('btn-outline-primary', currentPage < totalPages);
  }
  
  // Update counter text with more visible styling
  const countElement = document.getElementById('trades-count');
  if (countElement) {
    countElement.textContent = `Total: ${trades.length} trades`;
    countElement.style.fontWeight = 'bold';
  }
  
  // Update page info with more visible styling
  const pageInfoElement = document.getElementById('trades-page-info');
  if (pageInfoElement) {
    pageInfoElement.textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
    pageInfoElement.style.fontWeight = 'bold';
    
    // Add visual cue for multiple pages
    if (totalPages > 1) {
      pageInfoElement.classList.add('multi-page');
    } else {
      pageInfoElement.classList.remove('multi-page');
    }
  }
  
  // Display trades for current page
  const pageTrades = trades.slice(startIndex, endIndex);
  
  pageTrades.forEach(trade => {
    try {
      // Create a new row
      const row = document.createElement('tr');
      
      // Get token symbols with our helper function
      const fromSymbol = getSymbolFromAnyField(trade, 'from');
      const toSymbol = getSymbolFromAnyField(trade, 'to');
      
      // Format data
      const timestamp = new Date(trade.timestamp).toLocaleTimeString();
      const amount = parseFloat(trade.amount || 0).toFixed(2);
      const profit = parseFloat(trade.profit || 0);
      const isProfitable = profit >= 0;
      const profitClass = isProfitable ? 'text-success' : 'text-danger';
      const isSuccess = trade.success || trade.isSuccess || false;
      const statusClass = isSuccess ? 'badge bg-success' : 'badge bg-danger';
      const statusText = isSuccess ? 'Success' : 'Failed';
      
      // Create row content
      row.innerHTML = `
        <td>${timestamp}</td>
        <td><strong>${fromSymbol}</strong> → <strong>${toSymbol}</strong></td>
        <td>$${amount}</td>
        <td class="${profitClass}">${profit >= 0 ? '+' : ''}$${Math.abs(profit).toFixed(2)}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
      `;
      
      // Highlight new trades
      if (trade.isNew) {
        row.classList.add('new-trade');
        setTimeout(() => {
          row.classList.remove('new-trade');
          trade.isNew = false;
        }, 3000);
      }
      
      // Add row to table
      tableBody.appendChild(row);
    } catch (error) {
      console.error('Error creating trade row:', error);
    }
  });
  
  // Add some CSS for better pagination styling
  const style = document.getElementById('pagination-styles') || document.createElement('style');
  style.id = 'pagination-styles';
  style.innerHTML = `
    .trades-pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 10px;
      gap: 10px;
    }
    .multi-page {
      color: #007bff;
      font-weight: bold;
    }
    .new-trade {
      animation: highlightRow 3s;
    }
    @keyframes highlightRow {
      0% { background-color: rgba(0, 123, 255, 0.2); }
      100% { background-color: transparent; }
    }
  `;
  if (!document.getElementById('pagination-styles')) {
    document.head.appendChild(style);
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const container = document.getElementById('notification-container');
  if (!container) return;
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  container.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 500);
  }, 4500);
}

// Add handler for bot notifications
socket.on('bot_notification', (data) => {
  console.log('Bot notification received:', data);
  showNotification(data.message, data.type || 'info');
  
  // If the bot has started trading, update UI to clearly indicate this
  if (data.message.includes('started trading')) {
    // Make sure start button is in stop mode
    startButton.innerHTML = '<i class="fas fa-stop me-2"></i>Stop';
    startButton.classList.remove('btn-success');
    startButton.classList.add('btn-danger');
    
    // Update bot status
    updateBotStatus(true);
    
    // Show "Trading Active" indicator somewhere prominent
    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'trading-active-indicator';
    statusIndicator.innerHTML = '<i class="fas fa-robot"></i> Trading Active';
    document.body.appendChild(statusIndicator);
    
    // Remove after a while
    setTimeout(() => {
      statusIndicator.classList.add('fade-out');
      setTimeout(() => {
        statusIndicator.remove();
      }, 1000);
    }, 5000);
  }
});

// When trading is started by the server
socket.on('trading_started', (data) => {
  logDebug('Server confirmed trading started:', data);
  showNotification(`Trading started in ${data.mode || 'demo'} mode`, 'success');
  
  // Update bot status to active
  updateBotStatus(true);
  
  // Update button state
  const startButton = document.getElementById('start-btn');
  if (startButton) {
    startButton.innerHTML = '<i class="fas fa-stop me-2"></i>Stop';
    startButton.classList.remove('btn-success');
    startButton.classList.add('btn-danger');
  }
  
  // Add a CSS class to the body to indicate trading is active
  document.body.classList.add('trading-active');
});

// When trading is stopped by the server
socket.on('trading_stopped', () => {
  logDebug('Server confirmed trading stopped');
  showNotification('Trading stopped', 'info');
  
  // Update bot status
  updateBotStatus(false);
  
  // Update button state
  const startButton = document.getElementById('start-btn');
  if (startButton) {
    startButton.innerHTML = '<i class="fas fa-play me-2"></i>Start';
    startButton.classList.remove('btn-danger');
    startButton.classList.add('btn-success');
  }
  
  // Remove trading active class
  document.body.classList.remove('trading-active');
  
  // Show clear indication that trading has stopped
  const statusIndicator = document.createElement('div');
  statusIndicator.className = 'trading-inactive-indicator';
  statusIndicator.innerHTML = '<i class="fas fa-pause-circle"></i> Trading Stopped';
  document.body.appendChild(statusIndicator);
  
  // Remove after a while
  setTimeout(() => {
    statusIndicator.classList.add('fade-out');
    setTimeout(() => {
      statusIndicator.remove();
    }, 1000);
  }, 3000);
});

// Add wallet connection button handler
document.addEventListener('DOMContentLoaded', function() {
  // Connect wallet button
  const connectBtn = document.getElementById('connect-wallet-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      try {
        console.log('Connect wallet button clicked');
        // Call the connectWallet function from wallet-integration.js
        if (typeof connectWallet === 'function') {
          await connectWallet();
        } else {
          console.error('connectWallet function not found');
          // Try alternative approach
          if (window.walletProvider) {
            const resp = await window.walletProvider.connect();
            console.log('Connected to wallet:', resp.publicKey.toString());
            socket.emit('connect_wallet', { address: resp.publicKey.toString() });
          } else {
            alert('No wallet provider found. Please install Phantom or Solflare wallet.');
          }
        }
      } catch (error) {
        console.error('Error connecting wallet:', error);
        alert('Failed to connect wallet: ' + error.message);
      }
    });
  }
  
  // ... existing code ...
});

// Function to optimize ML parameters for more profitable trades with connected wallets
function optimizeMLParamsForWallet() {
  if (!socket || !socket.connected) return;
  
  // Emit request to optimize ML parameters with wallet-connected flag
  socket.emit('optimize_ml_params', {
    walletConnected: wallet.connected,
    aggressive: true,  // More aggressive strategy for wallet users
    riskTolerance: 0.8 // Higher risk tolerance (0-1)
  });
  
  console.log('Requested ML parameter optimization for wallet trading');
  showNotification('Optimizing trading strategy for your wallet', 'info');
}

// Call optimization when wallet connects
if (wallet.connected) {
  setTimeout(optimizeMLParamsForWallet, 2000);
}

// Function to request ML data from server
function fetchMLData() {
  if (!socket || !socket.connected) {
    console.warn('Socket not connected, cannot fetch ML data');
    return;
  }

  console.log('Fetching ML data from server');
  socket.emit('get_ml_params');
  
  // Also request a debug trade to trigger ML stats update
  if (window.debugMode) {
    socket.emit('debug_generate_trade');
  }
}

// Add event listeners after DOM content loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing Soul-Bot dashboard...');
  
  // Set up ML parameter handlers
  const saveParamsBtn = document.getElementById('save-params-btn');
  if (saveParamsBtn) {
    saveParamsBtn.addEventListener('click', () => {
      const params = {
        entryThreshold: parseFloat(document.getElementById('entry-threshold').value) || 0,
        exitThreshold: parseFloat(document.getElementById('exit-threshold').value) || 0,
        stopLoss: parseFloat(document.getElementById('stop-loss').value) || 0,
        takeProfit: parseFloat(document.getElementById('take-profit').value) || 0,
        walletConnected: wallet.connected, // Pass wallet state to server
        aggressive: wallet.connected // More aggressive strategy if wallet connected
      };
      
      socket.emit('update_ml_params', params);
      showNotification('ML parameters updated successfully', 'success');
    });
  }
  
  // Request initial data
  socket.emit('get_portfolio');
  socket.emit('get_trades');
  socket.emit('get_ml_params');
  
  // Check wallet connection state on load
  if (window.solana && window.solana.isConnected) {
    wallet.connect().then(() => {
      console.log('Wallet auto-connected on page load');
      // Optimize for wallet after connection
      setTimeout(optimizeMLParamsForWallet, 1000);
    }).catch(err => {
      console.error('Failed to auto-connect wallet:', err);
    });
  }
  
  // Set up all-trades button
  const allTradesBtn = document.getElementById('all-trades-btn');
  if (allTradesBtn) {
    allTradesBtn.addEventListener('click', () => {
      filterTrades('all');
      allTradesBtn.classList.add('active');
      document.getElementById('successful-trades-btn').classList.remove('active');
      document.getElementById('failed-trades-btn').classList.remove('active');
    });
  }
  
  // Set up successful-trades button
  const successfulTradesBtn = document.getElementById('successful-trades-btn');
  if (successfulTradesBtn) {
    successfulTradesBtn.addEventListener('click', () => {
      filterTrades('success');
      successfulTradesBtn.classList.add('active');
      document.getElementById('all-trades-btn').classList.remove('active');
      document.getElementById('failed-trades-btn').classList.remove('active');
    });
  }
  
  // Set up failed-trades button
  const failedTradesBtn = document.getElementById('failed-trades-btn');
  if (failedTradesBtn) {
    failedTradesBtn.addEventListener('click', () => {
      filterTrades('failed');
      failedTradesBtn.classList.add('active');
      document.getElementById('all-trades-btn').classList.remove('active');
      document.getElementById('successful-trades-btn').classList.remove('active');
    });
  }

  // Pagination event listeners
  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      updateTradesTable(filteredTrades);
    }
  });

  document.getElementById('next-page-btn').addEventListener('click', () => {
    const totalPages = Math.ceil(filteredTrades.length / pageSize);
    if (currentPage < totalPages) {
      currentPage++;
      updateTradesTable(filteredTrades);
    }
  });

  // Add ML Debug button if debug element exists
  const mlDebugBtn = document.getElementById('ml-debug-btn');
  if (mlDebugBtn) {
    mlDebugBtn.addEventListener('click', () => {
      fetchMLData();
      showNotification('Refreshing ML data...', 'info');
    });
  }
  
  // Auto-fetch ML data when page loads
  setTimeout(fetchMLData, 2000);

  // Document ready function to ensure ML accuracy is displayed
  console.log('Document ready, requesting ML data...');
  
  // Request ML data immediately
  setTimeout(() => {
    if (socket && socket.connected) {
      console.log('Requesting initial ML data');
      socket.emit('get_ml_params');
      
      // Force an ML update display
      const mlAccuracy = document.getElementById('ml-accuracy');
      if (mlAccuracy) {
        // Make sure this element is visible with a highlight effect
        mlAccuracy.style.transition = 'background-color 1s';
        mlAccuracy.style.backgroundColor = 'rgba(106, 90, 205, 0.2)';
        setTimeout(() => {
          mlAccuracy.style.backgroundColor = 'transparent';
        }, 1500);
      }
    }
  }, 1000);
  
  // Setup periodic ML data refresh
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('get_ml_params');
    }
  }, 15000); // Every 15 seconds
});

// Initialize portfolio metrics to zero in demo mode
function resetPortfolioMetrics() {
  // Update portfolio balance
  if (portfolioValue) {
    portfolioValue.textContent = '$50.00';
  }
  
  // Update total P&L
  if (totalPnL) {
    totalPnL.textContent = '$0.00';
    totalPnL.className = '';
  }
  
  // Update daily return
  if (dailyPnL) {
    dailyPnL.textContent = '0.00%';
    dailyPnL.className = '';
  }
  
  // Update ML accuracy
  const mlAccuracy = document.getElementById('ml-accuracy');
  if (mlAccuracy) {
    mlAccuracy.textContent = '0.0%';
    mlAccuracy.className = '';
  }
  
  console.log('Portfolio metrics reset to zero for demo mode');
}

// DOM ready function
document.addEventListener('DOMContentLoaded', function() {
  console.log('Soul-Bot Trading Dashboard loaded');
  
  // Load state from localStorage when page loads
  loadStateFromStorage();
  
  // Save state to localStorage before page unloads
  window.addEventListener('beforeunload', saveStateToStorage);
  
  // Reset metrics on first load
  const modeSelect = document.getElementById('trading-mode');
  if (modeSelect && modeSelect.value === 'demo') {
    resetPortfolioMetrics();
  }
  
  // Add trading mode change handler to reset metrics in demo mode
  if (modeSelect) {
    modeSelect.addEventListener('change', function(e) {
      const newMode = e.target.value;
      console.log(`Trading mode changed to: ${newMode}`);
      
      // Reset metrics when switching to demo mode
      if (newMode === 'demo') {
        resetPortfolioMetrics();
      }
      
      // Notify the server about the mode change
      socket.emit('set_trading_mode', { mode: newMode });
      
      // Update live mode toggle if it exists
      const liveModeToggle = document.getElementById('live-mode-toggle');
      if (liveModeToggle) {
        liveModeToggle.checked = newMode === 'live';
      }
      
      // Update display to indicate mode
      const modeText = document.getElementById('mode-text');
      if (modeText) {
        modeText.textContent = newMode === 'live' ? 'Live' : 'Demo';
        modeText.className = `mode-text ${newMode === 'live' ? 'live' : 'demo'}`;
      }
      
      showNotification(`Switched to ${newMode.toUpperCase()} mode`, 'info');
    });
  }
  
  // ... existing event bindings ...
});

// Add profit lock event handlers
document.addEventListener('DOMContentLoaded', function() {
  // Get profit lock elements
  const profitLockToggle = document.getElementById('profit-lock-toggle');
  const profitLockPercentage = document.getElementById('profit-lock-percentage');
  const lockedBalanceEl = document.getElementById('locked-balance');
  const withdrawAmountEl = document.getElementById('withdraw-amount');
  const withdrawBtn = document.getElementById('withdraw-btn');
  const profitLockProgress = document.getElementById('profit-lock-progress');
  
  // Initialize profit lock state
  let profitLockState = {
    enabled: true,
    percentage: 20,
    lockedBalance: 0,
    totalLocked: 0
  };
  
  // Toggle profit lock - auto-save on change
  profitLockToggle.addEventListener('change', function() {
    const enabled = profitLockToggle.checked;
    
    // Update the server
    socket.emit('update_profit_lock', {
      enabled: enabled,
      percentage: parseFloat(profitLockPercentage.value)
    });
    
    showNotification(`Auto profit lock ${enabled ? 'enabled' : 'disabled'}`, 'info');
  });
  
  // Auto-save percentage on change
  profitLockPercentage.addEventListener('change', function() {
    const percentage = parseFloat(profitLockPercentage.value);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      showNotification('Please enter a valid percentage between 0 and 100', 'error');
      return;
    }
    
    // Update the server
    socket.emit('update_profit_lock', {
      enabled: profitLockToggle.checked,
      percentage: percentage
    });
    
    showNotification(`Profit lock percentage set to ${percentage}%`, 'info');
  });
  
  // Withdraw profits
  withdrawBtn.addEventListener('click', function() {
    const amount = parseFloat(withdrawAmountEl.value);
    if (isNaN(amount) || amount <= 0) {
      showNotification('Please enter a valid amount to withdraw', 'error');
      return;
    }
    
    if (amount > profitLockState.lockedBalance) {
      showNotification(`Cannot withdraw more than the locked balance ($${profitLockState.lockedBalance.toFixed(2)})`, 'error');
      return;
    }
    
    // Send withdrawal request to server
    socket.emit('withdraw_profit_lock', { amount: amount });
    
    // Clear input
    withdrawAmountEl.value = '';
  });
  
  // Listen for profit lock updates
  socket.on('profit_lock_updated', function(data) {
    console.log('Profit lock updated:', data);
    profitLockState = data;
    
    // Update UI
    profitLockToggle.checked = data.enabled;
    profitLockPercentage.value = data.percentage;
    lockedBalanceEl.textContent = `$${data.lockedBalance.toFixed(2)}`;
    
    // Update progress bar
    if (profitLockProgress) {
      // Calculate what percentage of portfolio is locked
      const portfolioValue = parseFloat(document.getElementById('portfolio-value')?.innerText.replace('$', '') || '0');
      const totalValue = portfolioValue + data.lockedBalance;
      
      if (totalValue > 0) {
        const percentage = (data.lockedBalance / totalValue) * 100;
        profitLockProgress.style.width = `${percentage}%`;
        profitLockProgress.setAttribute('aria-valuenow', percentage.toFixed(1));
      } else {
        profitLockProgress.style.width = '0%';
        profitLockProgress.setAttribute('aria-valuenow', '0');
      }
    }
    
    // Disable withdraw button if no locked balance
    if (data.lockedBalance <= 0) {
      withdrawBtn.disabled = true;
    } else {
      withdrawBtn.disabled = false;
    }
  });
  
  // Request initial profit lock state
  socket.on('connect', function() {
    socket.emit('get_profit_lock');
  });
  
  // Handle withdraw response
  socket.on('withdraw_profit_lock_response', function(data) {
    if (data.success) {
      showNotification(`Successfully withdrew $${data.withdrawn.toFixed(2)} to your balance`, 'success');
      
      // Update locked balance display
      lockedBalanceEl.textContent = `$${data.lockedBalance.toFixed(2)}`;
      
      // Update portfolio balance on the page
      const portfolioValue = document.getElementById('portfolio-value');
      if (portfolioValue) {
        portfolioValue.textContent = `$${data.portfolioBalance.toFixed(2)}`;
      }
    } else {
      showNotification(`Error: ${data.error}`, 'error');
    }
  });
});

// Remove ML Debug section 
document.addEventListener('DOMContentLoaded', function() {
  // Hide ML Parameters section if it exists
  const mlParametersSection = document.getElementById('ml-parameters-section');
  if (mlParametersSection) {
    mlParametersSection.style.display = 'none';
  }
  
  // Hide ML debug button if it exists
  const mlDebugBtn = document.getElementById('ml-debug-btn');
  if (mlDebugBtn) {
    mlDebugBtn.style.display = 'none';
  }
  
  // Disable auto-fetching ML data when page loads
  // Comment out the ML data auto-fetching
  /*
  setTimeout(fetchMLData, 2000);
  
  // Document ready function to ensure ML accuracy is displayed
  console.log('Document ready, requesting ML data...');
  
  // Request ML data immediately
  setTimeout(() => {
    if (socket && socket.connected) {
      console.log('Requesting initial ML data');
      socket.emit('get_ml_params');
      
      // Force an ML update display
      const mlAccuracy = document.getElementById('ml-accuracy');
      if (mlAccuracy) {
        // Make sure this element is visible with a highlight effect
        mlAccuracy.style.transition = 'background-color 1s';
        mlAccuracy.style.backgroundColor = 'rgba(106, 90, 205, 0.2)';
        setTimeout(() => {
          mlAccuracy.style.backgroundColor = 'transparent';
        }, 1500);
      }
    }
  }, 1000);
  
  // Setup periodic ML data refresh
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('get_ml_params');
    }
  }, 15000); // Every 15 seconds
  */
  
  // ... rest of existing code ...
});

// Function to save state to localStorage before page close
function saveStateToStorage() {
  try {
    console.log('Saving application state to localStorage');
    
    // Save ML stats if they exist
    if (window.state && window.state.mlStats) {
      localStorage.setItem('soul_bot_ml_stats', JSON.stringify(window.state.mlStats));
      console.log('ML stats saved to localStorage');
    }
    
    // Save trades if they exist
    if (window.trades && window.trades.length > 0) {
      // Only store the last 50 trades to avoid storage limits
      const storableTrades = window.trades.slice(-50);
      localStorage.setItem('soul_bot_trades', JSON.stringify(storableTrades));
      console.log(`${storableTrades.length} trades saved to localStorage`);
    }
    
    // Save portfolio data if it exists
    if (window.state && window.state.portfolio) {
      localStorage.setItem('soul_bot_portfolio', JSON.stringify(window.state.portfolio));
      console.log('Portfolio data saved to localStorage');
    }
    
    // Save profit lock state if it exists
    if (window.state && window.state.profitLock) {
      localStorage.setItem('soul_bot_profit_lock', JSON.stringify(window.state.profitLock));
      console.log('Profit lock data saved to localStorage');
    }
  } catch (error) {
    console.error('Error saving state to localStorage:', error);
  }
}

// Function to load state from localStorage on page load
function loadStateFromStorage() {
  try {
    console.log('Loading application state from localStorage');
    
    // Get the current trading mode
    const modeSelect = document.getElementById('trading-mode');
    const isDemo = !modeSelect || modeSelect.value === 'demo';
    
    // If in demo mode, reset everything to zero instead of loading from storage
    if (isDemo) {
      console.log('Demo mode detected - resetting all metrics to zero');
      resetPortfolioMetrics();
      
      // Clear trades in demo mode
      window.trades = [];
      updateTradesTable([]);
      
      // Initialize empty state
      if (!window.state) window.state = {};
      if (!window.state.mlStats) window.state.mlStats = {
        accuracy: 0,
        predictions: 0,
        correct: 0
      };
      
      // Update the ML accuracy display to show 0
      updateMLAccuracy(0);
      
      // Update the learning progress bar to 0
      updateMLLearningProgress();
      
      // Only proceed with loading if not in demo mode
      return;
    }
    
    // Initialize window.state if it doesn't exist
    if (!window.state) window.state = {};
    
    // Load ML stats
    const mlStats = localStorage.getItem('soul_bot_ml_stats');
    if (mlStats) {
      window.state.mlStats = JSON.parse(mlStats);
      console.log('ML stats loaded from localStorage:', window.state.mlStats);
      
      // Update UI with the loaded ML stats
      if (window.state.mlStats.accuracy !== undefined) {
        updateMLAccuracy(window.state.mlStats.accuracy);
      }
      
      // Update the learning progress bar
      updateMLLearningProgress();
    }
    
    // Load trades
    const trades = localStorage.getItem('soul_bot_trades');
    if (trades) {
      window.trades = JSON.parse(trades);
      console.log(`${window.trades.length} trades loaded from localStorage`);
      
      // Update trades table with loaded trades
      updateTradesTable(window.trades);
    } else {
      window.trades = [];
    }
    
    // Load portfolio data
    const portfolio = localStorage.getItem('soul_bot_portfolio');
    if (portfolio) {
      window.state.portfolio = JSON.parse(portfolio);
      console.log('Portfolio data loaded from localStorage');
      
      // Update UI with loaded portfolio data
      updatePortfolioUI(window.state.portfolio);
    }
    
    // Load profit lock state
    const profitLock = localStorage.getItem('soul_bot_profit_lock');
    if (profitLock) {
      window.state.profitLock = JSON.parse(profitLock);
      console.log('Profit lock data loaded from localStorage');
    }
  } catch (error) {
    console.error('Error loading state from localStorage:', error);
  }
}

// Function to handle incoming new trades and store to window.trades
function handleNewTrade(trade) {
  console.log('New trade received:', trade);
  
  // Initialize window.trades if it doesn't exist
  if (!window.trades) window.trades = [];
  
  // Add the new trade to our array
  window.trades.push(trade);
  
  // Keep only the latest 100 trades in memory
  if (window.trades.length > 100) {
    window.trades = window.trades.slice(-100);
  }
  
  // Update the trades table
  updateTradesTable(window.trades);
  
  // Save the updated trades to localStorage
  try {
    const storableTrades = window.trades.slice(-50); // Keep storage size reasonable
    localStorage.setItem('soul_bot_trades', JSON.stringify(storableTrades));
    console.log('Trades saved to localStorage after new trade');
  } catch (storageError) {
    console.error('Error saving trades to localStorage:', storageError);
  }
  
  // Show a notification for the new trade
  let notificationType = 'info';
  let profitText = '';
  
  if (trade.profit) {
    const profit = parseFloat(trade.profit);
    profitText = ` ($${Math.abs(profit).toFixed(2)} ${profit >= 0 ? 'profit' : 'loss'})`;
    notificationType = profit >= 0 ? 'success' : 'warning';
  }
  
  const fromSymbol = getSymbolFromAnyField(trade.fromToken || trade.from || trade.fromSymbol);
  const toSymbol = getSymbolFromAnyField(trade.toToken || trade.to || trade.toSymbol);
  showNotification(`New trade: ${fromSymbol} → ${toSymbol}${profitText}`, notificationType);
  
  // Update learning progress indicator if this trade affects ML
  if (trade.usedML && window.state && window.state.mlStats) {
    // Increment our local prediction count to match server
    if (!window.state.mlStats.predictions) {
      window.state.mlStats.predictions = 1;
    } else {
      window.state.mlStats.predictions++;
    }
    
    // Update the learning progress bar
    updateMLLearningProgress();
    
    // Save updated ML stats
    localStorage.setItem('soul_bot_ml_stats', JSON.stringify(window.state.mlStats));
  }
}

// Update ML learning progress visual indicator
function updateMLLearningProgress() {
  const learningProgressBar = document.getElementById('ml-learning-progress');
  if (!learningProgressBar) return;
  
  const mlStats = window.state?.mlStats || {};
  const totalPredictions = mlStats.predictions || 0;
  
  // Calculate progress based on number of predictions (max out at 1000)
  const progressPercentage = Math.min(100, (totalPredictions / 1000) * 100);
  learningProgressBar.style.width = `${progressPercentage}%`;
  
  // Also add a title attribute with details
  learningProgressBar.title = `ML Learning Progress: ${progressPercentage.toFixed(1)}%
Total Predictions: ${totalPredictions}
Correct Predictions: ${mlStats.correct || 0}
Last Training: ${mlStats.lastTraining ? new Date(mlStats.lastTraining).toLocaleString() : 'Not yet trained'}`;
  
  // Add color indication based on accuracy
  const accuracy = parseFloat(mlStats.accuracy || 0);
  if (accuracy >= 70) {
    learningProgressBar.style.backgroundColor = '#10b981'; // Green for excellent
  } else if (accuracy >= 50) {
    learningProgressBar.style.backgroundColor = '#f59e0b'; // Yellow/orange for good
  } else {
    learningProgressBar.style.backgroundColor = '#ef4444'; // Red for needs improvement
  }
}

// Add ML toggle and token scan functionality
document.addEventListener('DOMContentLoaded', function() {
  // Create ML toggle button and add to dashboard
  const mlAccuracyBox = document.querySelector('.metric-box:nth-child(4)');
  if (mlAccuracyBox) {
    console.log('Found ML accuracy box, adding toggle');
    const mlToggle = document.createElement('div');
    mlToggle.className = 'form-check form-switch ml-toggle';
    mlToggle.innerHTML = `
      <input class="form-check-input" type="checkbox" id="ml-toggle" checked>
      <label class="form-check-label small" for="ml-toggle">ML Enabled</label>
    `;
    mlAccuracyBox.appendChild(mlToggle);
    
    // Add event listener for ML toggle
    const mlToggleInput = document.getElementById('ml-toggle');
    if (mlToggleInput) {
      mlToggleInput.addEventListener('change', function() {
        const isEnabled = this.checked;
        
        // Send ML toggle state to server
        if (socket && socket.connected) {
          socket.emit('toggle_ml', { enabled: isEnabled });
          console.log(`Sent ML toggle state to server: ${isEnabled ? 'Enabled' : 'Disabled'}`);
          
          // Show notification
          showNotification(`Machine Learning ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          
          // Update UI
          const mlAccuracyElement = document.getElementById('ml-accuracy');
          if (mlAccuracyElement) {
            mlAccuracyElement.style.opacity = isEnabled ? '1' : '0.5';
          }
          
          const learningProgress = document.getElementById('ml-learning-progress');
          if (learningProgress) {
            learningProgress.style.opacity = isEnabled ? '1' : '0.3';
          }
        }
      });
    }
  } else {
    console.log('ML accuracy box not found');
  }
  
  // Add token discovery toggle next to scan button
  const scanButtonContainer = document.getElementById('scan-btn').parentElement;
  if (scanButtonContainer) {
    console.log('Found scan button container, adding token discovery toggle');
    const discoveryToggle = document.createElement('div');
    discoveryToggle.className = 'form-check form-switch token-discovery-toggle ms-2';
    discoveryToggle.innerHTML = `
      <input class="form-check-input" type="checkbox" id="token-discovery-toggle" checked>
      <label class="form-check-label small" for="token-discovery-toggle">Discovery</label>
    `;
    scanButtonContainer.appendChild(discoveryToggle);
    
    // Add event listener for token discovery toggle
    const discoveryToggleInput = document.getElementById('token-discovery-toggle');
    if (discoveryToggleInput) {
      discoveryToggleInput.addEventListener('change', function() {
        const isEnabled = this.checked;
        
        // Send token discovery toggle state to server
        if (socket && socket.connected) {
          socket.emit('toggle_token_discovery', { enabled: isEnabled });
          console.log(`Sent token discovery toggle state to server: ${isEnabled ? 'Enabled' : 'Disabled'}`);
          
          // Show notification
          showNotification(`Token Discovery ${isEnabled ? 'enabled' : 'disabled'}`, 'info');
          
          // Update UI - disable scan button if token discovery is disabled
          const scanBtn = document.getElementById('scan-btn');
          if (scanBtn) {
            scanBtn.disabled = !isEnabled;
          }
        }
      });
    }
  } else {
    console.log('Scan button container not found');
  }
  
  // Remove ML data button in top right
  const mlDataBtn = document.getElementById('ml-data-btn');
  if (mlDataBtn) {
    mlDataBtn.style.display = 'none';
  }
  
  // Enhance scan button functionality
  const scanButton = document.getElementById('scan-btn');
  if (scanButton) {
    scanButton.addEventListener('click', function() {
      if (!socket || !socket.connected) {
        showNotification('Not connected to trading server', 'error');
        return;
      }
      
      // Show loading state
      scanButton.disabled = true;
      scanButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Scanning...';
      
      // Send token discovery request to server
      socket.emit('scan_tokens', { manual: true });
      
      showNotification('Scanning for new tokens...', 'info');
      
      // Reset button after 3 seconds
      setTimeout(() => {
        scanButton.disabled = false;
        scanButton.innerHTML = '<i class="fas fa-search me-2"></i>Scan Tokens';
      }, 3000);
    });
  }
});

// Handle response from server about token discovery
socket.on('token_discovery_result', function(data) {
  console.log('Token discovery result:', data);
  
  if (data.success) {
    if (data.newTokensCount > 0) {
      showNotification(`Found ${data.newTokensCount} new tokens!`, 'success');
    } else {
      showNotification('No new tokens found', 'info');
    }
    
    // Update token count if available
    const tokenCount = document.getElementById('token-count');
    if (tokenCount && data.totalTokens) {
      tokenCount.textContent = data.totalTokens;
    }
  } else {
    showNotification(`Token discovery failed: ${data.error || 'Unknown error'}`, 'error');
  }
  
  // Reset scan button
  const scanButton = document.getElementById('scan-btn');
  if (scanButton) {
    scanButton.disabled = false;
    scanButton.innerHTML = '<i class="fas fa-search me-2"></i>Scan Tokens';
  }
});

// Handle ML status updates
socket.on('ml_status', function(data) {
  console.log('Received ML status update:', data);
  
  // Update the ML toggle if it exists
  const mlToggle = document.getElementById('ml-toggle');
  if (mlToggle) {
    mlToggle.checked = data.enabled;
    
    // Update UI based on ML enabled status
    const mlAccuracyElement = document.getElementById('ml-accuracy');
    if (mlAccuracyElement) {
      mlAccuracyElement.style.opacity = data.enabled ? '1' : '0.5';
    }
    
    const learningProgress = document.getElementById('ml-learning-progress');
    if (learningProgress) {
      learningProgress.style.opacity = data.enabled ? '1' : '0.3';
    }
  }
  
  // Update ML stats in global state
  if (!window.state) window.state = {};
  if (!window.state.mlStats) window.state.mlStats = {};
  
  window.state.mlStats.enabled = data.enabled;
  
  if (data.accuracy !== undefined) {
    window.state.mlStats.accuracy = data.accuracy;
    updateMLAccuracy(data.accuracy);
  }
  
  if (data.predictions !== undefined) {
    window.state.mlStats.predictions = data.predictions;
  }
  
  if (data.correct !== undefined) {
    window.state.mlStats.correct = data.correct;
  }
  
  // Update learning progress
  updateMLLearningProgress();
});

// Handle token discovery statistics
socket.on('token_discovery_stats', function(data) {
  console.log('Received token discovery stats:', data);
  
  // Update token discovery toggle if it exists
  const discoveryToggle = document.getElementById('token-discovery-toggle');
  if (discoveryToggle) {
    discoveryToggle.checked = data.enabled;
    
    // Update scan button disabled state
    const scanBtn = document.getElementById('scan-btn');
    if (scanBtn) {
      scanBtn.disabled = !data.enabled;
    }
  }
  
  // Update token count display if it exists
  const tokenCount = document.getElementById('token-count');
  if (tokenCount && data.totalTokens) {
    tokenCount.textContent = data.totalTokens;
  }
  
  // Show last discovery time if element exists
  const lastDiscoveryTime = document.getElementById('last-discovery-time');
  if (lastDiscoveryTime && data.lastDiscoveryTime) {
    const date = new Date(data.lastDiscoveryTime);
    lastDiscoveryTime.textContent = date.toLocaleTimeString();
  }
});

// Function to add discovered token to UI
function addDiscoveredTokenToUI(token) {
  const tokensList = document.getElementById('discovered-tokens-list');
  if (!tokensList) {
    // Create the list if it doesn't exist
    createDiscoveredTokensUI();
    return addDiscoveredTokenToUI(token); // Try again after creating UI
  }
  
  // Check if this token is already in the list
  const existingToken = document.querySelector(`#discovered-tokens-list [data-token-address="${token.address}"]`);
  if (existingToken) {
    // Just update the existing entry
    const mlScore = existingToken.querySelector('.token-ml-score');
    if (mlScore && token.mlScore) {
      mlScore.textContent = `ML: ${parseFloat(token.mlScore).toFixed(1)}%`;
    }
    return;
  }
  
  // Create a new token card/item
  const tokenItem = document.createElement('div');
  tokenItem.className = 'discovered-token-item';
  tokenItem.setAttribute('data-token-address', token.address);
  
  // Format the discovery time
  const discoveryTime = new Date(token.discoveryTime).toLocaleTimeString();
  
  // Add ML score class based on value
  let mlScoreClass = 'neutral';
  if (token.mlScore) {
    const score = parseFloat(token.mlScore);
    if (score >= 70) mlScoreClass = 'positive';
    else if (score < 50) mlScoreClass = 'negative';
  }
  
  tokenItem.innerHTML = `
    <div class="token-symbol">${token.symbol}</div>
    <div class="token-name">${token.name}</div>
    <div class="token-ml-score ${mlScoreClass}">ML: ${token.mlScore ? parseFloat(token.mlScore).toFixed(1) : 'N/A'}%</div>
    <div class="token-time">Found: ${discoveryTime}</div>
  `;
  
  // Add to the tokens list
  tokensList.prepend(tokenItem); // Add to the beginning
  
  // Limit to 20 tokens in the UI
  const allTokenItems = tokensList.querySelectorAll('.discovered-token-item');
  if (allTokenItems.length > 20) {
    tokensList.removeChild(allTokenItems[allTokenItems.length - 1]);
  }
  
  // Highlight the token discovery section
  const discoverySection = document.getElementById('token-discovery-section');
  if (discoverySection) {
    discoverySection.classList.add('highlight-section');
    setTimeout(() => {
      discoverySection.classList.remove('highlight-section');
    }, 3000);
  }
}

// Function to create the UI for discovered tokens if it doesn't exist
function createDiscoveredTokensUI() {
  const tradingDashboard = document.querySelector('.dashboard-container');
  if (!tradingDashboard) return;
  
  // Check if section already exists
  if (document.getElementById('token-discovery-section')) return;
  
  // Create token discovery section
  const discoverySection = document.createElement('div');
  discoverySection.id = 'token-discovery-section';
  discoverySection.className = 'card mb-4';
  
  discoverySection.innerHTML = `
    <div class="card-header d-flex justify-content-between align-items-center">
      <h5 class="mb-0">Discovered Tokens</h5>
      <div>
        <button id="scan-more-tokens-btn" class="btn btn-sm btn-primary">
          <i class="fas fa-search me-1"></i> Scan More
        </button>
      </div>
    </div>
    <div class="card-body p-0">
      <div id="discovered-tokens-list" class="discovered-tokens-container">
        <div class="text-center py-3 text-muted">No tokens discovered yet</div>
      </div>
    </div>
  `;
  
  // Add to dashboard
  const portfolioCard = document.querySelector('.portfolio-card');
  if (portfolioCard && portfolioCard.parentNode) {
    portfolioCard.parentNode.insertBefore(discoverySection, portfolioCard.nextSibling);
  } else {
    tradingDashboard.appendChild(discoverySection);
  }
  
  // Add scan button event listener
  const scanButton = document.getElementById('scan-more-tokens-btn');
  if (scanButton) {
    scanButton.addEventListener('click', () => {
      if (!isConnected) {
        showNotification('Not connected to trading server', 'error');
        return;
      }
      
      socket.emit('scan_tokens');
      showNotification('Scanning for new tokens...', 'info');
    });
  }
  
  // Add styles
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    .discovered-tokens-container {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 15px;
      max-height: 300px;
      overflow-y: auto;
    }
    
    .discovered-token-item {
      background: rgba(0,0,0,0.05);
      border-radius: 8px;
      padding: 10px;
      flex: 0 0 calc(33.333% - 10px);
      transition: all 0.3s;
      border-left: 3px solid var(--bs-primary);
    }
    
    .discovered-token-item:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }
    
    .token-symbol {
      font-weight: bold;
      font-size: 18px;
      margin-bottom: 4px;
    }
    
    .token-name {
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .token-ml-score {
      font-size: 14px;
      margin-bottom: 4px;
    }
    
    .token-ml-score.positive {
      color: #10b981;
    }
    
    .token-ml-score.negative {
      color: #ef4444;
    }
    
    .token-time {
      font-size: 12px;
      color: #888;
    }
    
    .highlight-section {
      animation: highlight-pulse 1.5s;
    }
    
    @keyframes highlight-pulse {
      0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
      100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
    }
    
    @media (max-width: 992px) {
      .discovered-token-item {
        flex: 0 0 calc(50% - 10px);
      }
    }
    
    @media (max-width: 768px) {
      .discovered-token-item {
        flex: 0 0 100%;
      }
    }
  `;
  document.head.appendChild(styleElement);
  
  // Load previously discovered tokens from localStorage
  const discoveredTokens = JSON.parse(localStorage.getItem('soul_bot_discovered_tokens') || '[]');
  discoveredTokens.forEach(token => addDiscoveredTokenToUI(token));
}

// Initialize discovered tokens UI during page load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    createDiscoveredTokensUI();
  }, 1000); // Slight delay to ensure other UI components load first
}); 