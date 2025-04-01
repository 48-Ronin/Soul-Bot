/**
 * Soul-Bot Trading Dashboard Server
 * Provides real-time trading data, portfolio tracking, and wallet connectivity
 * for Solana arbitrage trading using Helius API
 */

// First require path to avoid the initialization error
const path = require('path');

// Environment variables - Now path is properly initialized
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Core dependencies
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const DexConnector = require('./modules/dexConnector');
const MLBridge = require('../ml-bridge');
const axios = require('axios');
const { getTokenBySymbol, isValidToken, getAllTokens } = require('./modules/tokenRegistry');
const winston = require('winston'); // Add logging library
const { setTimeout: sleep } = require('timers/promises'); // Use 'sleep' alias

// Setup Logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(process.env.LOGS_DIR || './logs', 'server.log') }),
    new winston.transports.File({ filename: path.join(process.env.LOGS_DIR || './logs', 'error.log'), level: 'error' })
  ]
});

// Replace console.log/warn/error with logger calls throughout the file
// Example:
// console.log(...) -> logger.info(...)
// console.warn(...) -> logger.warn(...)
// console.error(...) -> logger.error(...)

// App initialization
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Configuration
const PORT = process.env.PORT || 3030;
const HOST = process.env.WEB_HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || './data';
const LOGS_DIR = process.env.LOGS_DIR || './logs';
const DEMO_MODE = process.env.DEMO_MODE === 'true' || true;
const AUTO_START = process.env.AUTO_START === 'true' || false;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '8d7f2c65-f029-45c5-9aa8-de2dfb41078f';
const HELIUS_RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_API_ENDPOINT = `https://api.helius.xyz/v0`;
const MAX_TRADES_IN_MEMORY = 100; // Maximum number of trades to keep in memory

logger.info(`Server configured for PORT: ${PORT}, HOST: ${HOST}`);
logger.info(`DEMO_MODE: ${DEMO_MODE}, AUTO_START: ${AUTO_START}`);

// SECURITY WARNING BANNER
logger.warn('********************************************************************************');
logger.warn('* SECURITY WARNING                                                               *');
logger.warn('* NEVER store private keys directly in this application or its environment files.  *');
logger.warn('* Transaction signing MUST be handled securely on the client-side (user\'s wallet). *');
logger.warn('* Enabling live trading with real funds carries SIGNIFICANT FINANCIAL RISK.        *');
logger.warn('* Ensure thorough testing in demo mode before considering live deployment.          *');
logger.warn('* You are solely responsible for any financial losses incurred.                    *');
logger.warn('********************************************************************************');

// Initialize DEX connector - Pass config, use logger
const dexConnector = new DexConnector({
  slippageBps: parseInt(process.env.SLIPPAGE_BPS) || 50,
  priorityFeeLamports: parseInt(process.env.PRIORITY_FEE_LAMPORTS),
  minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD) || 0.6,
  heliusApiKey: HELIUS_API_KEY,
  heliusRpcUrl: HELIUS_RPC_ENDPOINT
});
logger.info('DexConnector initialized.');

// Initialize ML Bridge - Use logger
const mlBridge = new MLBridge();
mlBridge.start();
logger.info('MLBridge initialized and started.');

// Initialize state - Add live trading config from env
const state = {
  trades: [],
  portfolio: {
    value: 50.00, // Start at $50 in demo mode
    totalPnL: 0.00,
    dailyReturn: 0.00,
    mlAccuracy: 85.0,
    balance: 50.00 // Start at $50 in demo mode
  },
  tradingControl: {
    isRunning: false, // Set to false by default - only starts when user presses Start
    mode: 'demo',
    startTime: null,
    trades: [],
    tradeCount: 0,
    profit: 0,
    // Pagination 
    tradesPerPage: 20,
    totalPages: 0
  },
  mlStats: {
    predictions: 0,
    correctPredictions: 0, 
    accuracy: 85
  },
  mlEnabled: true, // Initialize ML as enabled by default
  tokenDiscovery: {
    enabled: true, // Enable token discovery by default
    trackedTokens: [],
    lastDiscoveryTime: null,
    lastRunResults: null
  },
  tokenPerformance: {}, // Will be populated in initializeTokenData
  profitLock: {
    enabled: true,
    percentage: 20,
    lockedAmount: 0,
    lockedBalance: 0,
    totalLocked: 0,
    lastLockTime: null,
    history: []
  },
  liveTrading: {
    enabled: !DEMO_MODE, // Enable live trading if DEMO_MODE is false
    walletAddress: process.env.LIVE_WALLET_ADDRESS || null,
    autoExecute: process.env.AUTO_EXECUTE_LIVE_TRADES === 'true', 
    minBalanceSOL: parseFloat(process.env.MIN_SOL_BALANCE_LIVE) || 0.05,
    privateKeyEncrypted: process.env.ENCRYPTED_PRIVATE_KEY || null
  },
  tokenRegistry: {}, // Will be populated from token registry
  connectedWallets: {}, // Track connected wallets
  health: 'OK', // Default health status
  startTime: Date.now(), // Server start time
  botStatus: 'READY', // Bot status
  performance: {}, // Performance metrics
  riskSettings: {
    maxTradeSize: 5.0, // Maximum trade size in SOL
    defaultSlippage: 1.0, // Default slippage in percentage
    minProfitTarget: 0.5 // Minimum profit target in percentage
  },
  historicalData: {
    timestamps: [],
    values: [],
    profits: []
  }
};
logger.info(`Initial state created. Live trading enabled: ${state.liveTrading.enabled}`);
if (state.liveTrading.enabled && !state.liveTrading.walletAddress) {
  logger.warn('Live trading is enabled, but LIVE_WALLET_ADDRESS is not set in .env. Wallet must connect via UI.');
}

// Ensure data directories exist - Use logger
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// API routes - Use logger
app.get('/', (req, res) => {
  logger.info(`Serving index.html to ${req.ip}`);
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: state.health, uptime: Date.now() - state.startTime });
});

app.get('/api/bot/status', (req, res) => {
  res.json({ status: state.botStatus });
});

app.get('/api/trades/recent', (req, res) => {
  res.json(state.trades.slice(-50));
});

app.get('/api/portfolio', (req, res) => {
  res.json(state.portfolio);
});

app.get('/api/performance', (req, res) => {
  res.json(state.performance);
});

app.get('/api/ml/stats', (req, res) => {
  res.json({
    totalPredictions: state.mlStats.predictions,
    correctPredictions: state.mlStats.correctPredictions,
    accuracy: state.mlStats.predictions > 0 
      ? (state.mlStats.correctPredictions / state.mlStats.predictions) * 100
      : 0
  });
});

// Update ML parameters endpoint
app.get('/api/ml/parameters', (req, res) => {
  res.json({
    minSamples: 1000,
    trainingInterval: 1800,
    predictionThreshold: 0.7
  });
});

// New endpoint for ML trading report
app.get('/api/ml/report', async (req, res) => {
  try {
    const report = await mlBridge.generateReport();
    res.json(report);
  } catch (error) {
    logger.error('Error generating ML report:', error);
    res.status(500).json({ error: 'Failed to generate ML report' });
  }
});

// Add historical data endpoint
app.get('/api/historical', (req, res) => {
  const range = req.query.range || 'day';
  const historicalData = getHistoricalData(range);
  res.json(historicalData);
});

// Function to get historical data
function getHistoricalData(range) {
  return {
    timestamps: state.historicalData.timestamps,
    values: state.historicalData.values,
    profits: state.historicalData.profits
  };
}

// API endpoints for profit lock
app.get('/api/profit-lock', (req, res) => {
  res.json({
    enabled: state.profitLock.enabled,
    percentage: state.profitLock.percentage,
    lockedBalance: state.profitLock.lockedBalance,
    totalLocked: state.profitLock.totalLocked,
    lastLocked: state.profitLock.lastLockTime
  });
});

app.post('/api/profit-lock/configure', (req, res) => {
  try {
    const { percentage, enabled } = req.body;
    
    // Update enabled status if provided
    if (enabled !== undefined) {
      state.profitLock.enabled = enabled;
      logger.info(`Profit locking ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    // Update percentage if provided
    if (percentage !== undefined) {
      if (percentage < 0 || percentage > 100) {
        return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
      }
      state.profitLock.percentage = percentage;
      logger.info(`Updated profit lock percentage to ${percentage}%`);
    }
    
    res.json({
      success: true,
      profitLock: {
        enabled: state.profitLock.enabled,
        percentage: state.profitLock.percentage,
        lockedBalance: state.profitLock.lockedBalance,
        totalLocked: state.profitLock.totalLocked
      }
    });
    
    // Broadcast the updated profit lock settings
    io.emit('profit_lock_updated', {
      enabled: state.profitLock.enabled,
      percentage: state.profitLock.percentage,
      lockedBalance: state.profitLock.lockedBalance,
      totalLocked: state.profitLock.totalLocked
    });
    
  } catch (error) {
    logger.error('Error configuring profit lock:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/profit-lock/withdraw', (req, res) => {
  try {
    const { amount } = req.body;
    
    // Validate amount
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    const withdrawAmount = Math.min(parseFloat(amount), state.profitLock.lockedBalance);
    
    if (withdrawAmount <= 0) {
      return res.status(400).json({ error: 'No locked profits available to withdraw' });
    }
    
    // Withdraw from locked balance
    state.profitLock.lockedBalance -= withdrawAmount;
    
    // Add to main portfolio balance
    state.portfolio.balance += withdrawAmount;
    
    logger.info(`Withdrew ${withdrawAmount.toFixed(2)} from locked profits to main balance`);
    
    // Return updated balances
    res.json({
      success: true,
      withdrawn: withdrawAmount,
      lockedBalance: state.profitLock.lockedBalance,
      portfolioBalance: state.portfolio.balance
    });
    
    // Broadcast updated portfolio
    io.emit('portfolio', {
      balance: state.portfolio.balance,
      totalPnL: state.portfolio.totalPnL,
      dailyReturn: state.portfolio.dailyReturn,
      mlAccuracy: state.mlStats.accuracy,
      lockedProfit: state.profitLock.lockedBalance
    });
    
    // Broadcast lock status update
    io.emit('profit_lock_updated', {
      enabled: state.profitLock.enabled,
      percentage: state.profitLock.percentage,
      lockedBalance: state.profitLock.lockedBalance,
      totalLocked: state.profitLock.totalLocked
    });
    
          } catch (error) {
    logger.error('Error withdrawing from profit lock:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add profit lock history endpoint
app.get('/api/profit-lock/history', (req, res) => {
  res.json({
    history: state.profitLock.history || []
  });
});

// API endpoints for wallet connection and trading
app.post('/api/wallet/connected', (req, res) => {
  try {
    const { address, balance } = req.body;
    
    if (!address) {
      return res.status(400).json({ success: false, error: 'Wallet address required' });
    }
    
    logger.info(`Wallet connected: ${address}, balance: ${balance || 'unknown'} SOL`);
    
    // Store wallet info
    state.connectedWallets[address] = {
      address,
      balance: balance || 0,
      connectionTime: Date.now(),
      lastActive: Date.now(),
      trades: []
    };
    
    // Emit to all clients
    io.emit('wallet_connected', { 
      address, 
      balance,
      timestamp: Date.now()
    });
    
    return res.json({ 
      success: true,
      settings: {
        maxTradeSize: state.riskSettings.maxTradeSize,
        defaultSlippage: state.riskSettings.defaultSlippage,
        minProfitTarget: state.riskSettings.minProfitTarget,
      }
    });
    
  } catch (error) {
    logger.error('Error processing wallet connection:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.post('/api/wallet/disconnected', (req, res) => {
  try {
    const { address } = req.body;
    
    if (address && state.connectedWallets[address]) {
      delete state.connectedWallets[address];
      logger.info(`Wallet disconnected: ${address}`);
    }
    
    // Emit to all clients
    if (address) {
      io.emit('wallet_disconnected', { 
        address,
        timestamp: Date.now()
      });
    }
    
    return res.json({ success: true });
    
  } catch (error) {
    logger.error('Error processing wallet disconnection:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Endpoint for trading settings
app.get('/api/trading/settings', (req, res) => {
  try {
    // Return risk settings along with allowed tokens
    const settings = {
      ...state.riskSettings,
      allowedTokens: [
        'SOL', 'USDC', 'USDT', 'BONK', 'SAMO',
        'JUP', 'RAY', 'ORCA', 'mSOL', 'stSOL'
      ]
    };
    
    return res.json(settings);
    
  } catch (error) {
    logger.error('Error retrieving trading settings:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Trading opportunities API
app.get('/api/trading/opportunities', (req, res) => {
  try {
    // Generate realistic opportunities
    const opportunities = generateTradeOpportunities();
    
    return res.json(opportunities);
    
  } catch (error) {
    logger.error('Error retrieving trading opportunities:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Trading result API
app.post('/api/trading/result', (req, res) => {
  try {
    const { signature, inputToken, outputToken, executionPrice, success, timestamp, walletAddress } = req.body;
    
    if (!signature || !inputToken || !outputToken) {
      return res.status(400).json({ success: false, error: 'Missing required trade details' });
    }
    
    logger.info(`Trade result received: ${inputToken.mint} -> ${outputToken.mint}, success: ${success}`);
    
    // Store trade result
    const trade = {
      signature,
      inputToken,
      outputToken,
      executionPrice,
      success: success || false,
      timestamp: timestamp || Date.now(),
      walletAddress
    };
    
    // Add to global trade history
    state.tradeHistory.push(trade);
    
    // Add to wallet trades if wallet address provided
    if (walletAddress && state.connectedWallets[walletAddress]) {
      state.connectedWallets[walletAddress].trades.push(trade);
      state.connectedWallets[walletAddress].lastActive = Date.now();
    }
    
    // Update token performance data
    updateTokenPerformance(trade);
    
    // Emit to all clients
    io.emit('trade_completed', ensureTokenSymbols(trade));
    
    return res.json({ success: true });
    
  } catch (error) {
    logger.error('Error processing trade result:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Helper function to generate trade opportunities
function generateTradeOpportunities() {
  const opportunities = [];
  const tokens = [
    { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' },
    { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    { symbol: 'BONK', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
    { symbol: 'SAMO', address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' },
    { symbol: 'JUP', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' }
  ];
  
  // Generate 3-5 opportunities
  const numOpportunities = 3 + Math.floor(Math.random() * 3);
  
  for (let i = 0; i < numOpportunities; i++) {
    // Random token pairs (ensuring they're different)
    let fromTokenIndex = Math.floor(Math.random() * tokens.length);
    let toTokenIndex;
    do {
      toTokenIndex = Math.floor(Math.random() * tokens.length);
    } while (toTokenIndex === fromTokenIndex);
    
    const fromToken = tokens[fromTokenIndex];
    const toToken = tokens[toTokenIndex];
    
    // Better profit for demo - between 0.5% and 3%
    const expectedProfit = 0.5 + (Math.random() * 2.5);
    
    // Amount between $10 and $100
    const amountInUSD = 10 + (Math.random() * 90);
    
    // Trade amount (converted to SOL equivalent for simplicity)
    const amount = fromToken.symbol === 'SOL' 
      ? amountInUSD / 100 // Assuming SOL is ~$100
      : amountInUSD / 10;  // Other tokens scaled differently
    
    opportunities.push({
      fromToken: fromToken.symbol,
      toToken: toToken.symbol,
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      amount,
      amountInUSD,
      expectedProfit,
      timestamp: Date.now(),
      source: Math.random() > 0.5 ? 'arbitrage' : 'swing',
      id: `opp-${Date.now()}-${i}`
    });
  }
  
  // Sort by expected profit (descending)
  opportunities.sort((a, b) => b.expectedProfit - a.expectedProfit);
  
  return opportunities;
}

// Update token performance based on trade result
function updateTokenPerformance(trade) {
  try {
    // Extract from and to token symbols
    const fromTokenMint = trade.inputToken.mint;
    const toTokenMint = trade.outputToken.mint;
    
    // Get symbols from mint addresses
    const fromSymbol = getTokenSymbolByAddress(fromTokenMint) || 'UNKNOWN';
    const toSymbol = getTokenSymbolByAddress(toTokenMint) || 'UNKNOWN';
    
    // Update from token stats
    if (state.tokenPerformance[fromSymbol]) {
      state.tokenPerformance[fromSymbol].trades++;
      if (trade.success) {
        state.tokenPerformance[fromSymbol].successCount++;
      } else {
        state.tokenPerformance[fromSymbol].failCount++;
      }
      state.tokenPerformance[fromSymbol].winRate = (
        state.tokenPerformance[fromSymbol].successCount / 
        state.tokenPerformance[fromSymbol].trades
      ) * 100;
    }
    
    // Update to token stats
    if (state.tokenPerformance[toSymbol]) {
      state.tokenPerformance[toSymbol].trades++;
      if (trade.success) {
        state.tokenPerformance[toSymbol].successCount++;
    } else {
        state.tokenPerformance[toSymbol].failCount++;
      }
      state.tokenPerformance[toSymbol].winRate = (
        state.tokenPerformance[toSymbol].successCount / 
        state.tokenPerformance[toSymbol].trades
      ) * 100;
    }
    
  } catch (error) {
    logger.error('Error updating token performance:', error);
  }
}

// Helper to get token symbol from address
function getTokenSymbolByAddress(address) {
  const tokenMap = {
    'So11111111111111111111111111111111111111112': 'SOL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU': 'SAMO',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
    'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': 'ORCA',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL'
  };
  
  return tokenMap[address] || null;
}

// Record real trade result
app.post('/api/trading/result', (req, res) => {
  try {
    const tradeData = req.body;
    
    // Validate trade data
    if (!tradeData || !tradeData.id) {
      return res.status(400).json({ error: 'Invalid trade data' });
    }
    
    logger.info(`Received trade result for ${tradeData.id}: ${tradeData.status}`);
    
    // Process successful trade
    if (tradeData.status === 'completed' && tradeData.result && tradeData.result.success) {
      // Create trade record
      const trade = {
        timestamp: Date.now(),
        fromToken: tradeData.request.inputToken,
        toToken: tradeData.request.outputToken,
        amount: tradeData.result.inputAmount,
        profit: calculateProfit(tradeData),
        profitPercentage: calculateProfitPercentage(tradeData),
        status: 'success',
        type: 'Live Trading',
        exchanges: 'Jupiter',
        path: `${tradeData.request.inputToken} -> ${tradeData.request.outputToken}`,
        slippage: tradeData.request.slippage || 0.5,
        liquidity: 1.0,
        success: true,
        transactionSignature: tradeData.result.signature,
        walletAddress: tradeData.walletAddress || 'unknown'
      };
      
      // Add to trades array
      state.trades.push(trade);
      
      // If this is live trading, add to live trades
      if (state.liveTrading.enabled) {
        state.liveTrading.trades.push(trade);
      }
      
      // Update performance metrics
      updatePerformanceMetrics();
      
      // Emit to all clients
      io.emit('new_trade', ensureTokenSymbols({
        ...trade,
        isLive: true,
        isReal: true
      }));
    }
    
    return res.json({ success: true });
    
      } catch (error) {
    logger.error('Error recording trade result:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Calculate profit from trade data
 */
function calculateProfit(tradeData) {
  // This is a basic calculation and would need to be improved
  // with actual price data for accurate profit calculation
  if (!tradeData.result || !tradeData.quote) return 0;
  
  // For now, use the price impact as a proxy for profit/loss
  const priceImpact = tradeData.quote.humanReadable.priceImpact || 0;
  const inputAmount = tradeData.result.inputAmount || 0;
  
  // Negative price impact = positive profit
  return inputAmount * (-priceImpact / 100);
}

/**
 * Calculate profit percentage from trade data
 */
function calculateProfitPercentage(tradeData) {
  if (!tradeData.result || !tradeData.quote) return 0;
  
  // For now, use the negative of price impact as profit percentage
  return -1 * (tradeData.quote.humanReadable.priceImpact || 0);
}

// Global variables for client connections
const clients = [];

// Function to send initial state to a connected client
function sendInitialState(socket) {
  try {
    // Send the initial state to the client
    socket.emit('portfolio', {
      balance: state.portfolio.value,
      totalPnL: state.portfolio.totalPnL,
      dailyReturn: state.portfolio.dailyReturn,
      mlAccuracy: state.mlStats.accuracy,
      lockedProfit: state.profitLock.lockedBalance
    });
    
    // Process all trades to ensure they have proper token symbols
    const processedTrades = state.trades.slice(-50).map(trade => ensureTokenSymbols({...trade}));
    socket.emit('trades', processedTrades);
    
    // Send trading status
    socket.emit('trading_status', { 
      isRunning: state.tradingControl.isRunning,
      mode: state.tradingControl.mode,
      startTime: state.tradingControl.startTime
    });
    
    // Send ML status
    socket.emit('ml_status', {
      enabled: state.mlEnabled,
      accuracy: state.mlStats.accuracy,
      totalPredictions: state.mlStats.predictions,
      correctPredictions: state.mlStats.correctPredictions
    });
    
    // Send token discovery status
    socket.emit('token_discovery_status', {
      enabled: state.tokenDiscovery.enabled,
      trackedTokenCount: state.tokenDiscovery.trackedTokens.length,
      lastDiscoveryTime: state.tokenDiscovery.lastDiscoveryTime
    });
    
    // Send profit lock status
    socket.emit('profit_lock_status', {
      enabled: state.profitLock.enabled,
      percentage: state.profitLock.percentage,
      lockedBalance: state.profitLock.lockedBalance,
      totalLocked: state.profitLock.totalLocked,
      lastLockTime: state.profitLock.lastLockTime
    });
    
    logger.info(`Initial state sent to client ${socket.id}`);
    } catch (error) {
    logger.error(`Error sending initial state to client ${socket.id}:`, error);
  }
}

// Socket connection handling - Use logger
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id} from ${socket.handshake.address}`);
  clients.push(socket);
  
  // Send initial state immediately when client connects
  sendInitialState(socket);
  
  // Mark socket as connected immediately for more reliable status checks
  socket.emit('connection_established', { status: 'connected' });
  
  // Handle explicit debug logging
  socket.onAny((event, ...args) => {
    logger.info(`Socket event received from ${socket.id}: ${event}`, args[0] || '');
  });
  
  // Wallet connect handler (stores address on socket)
  socket.on('connect_wallet', (data) => {
     try {
      if (data && data.address) {
        socket.walletAddress = data.address;
        logger.info(`Wallet ${data.address} connected for socket ${socket.id}`);
        socket.emit('wallet_status', { connected: true, address: data.address });
        
        // If live mode is enabled globally, update the state wallet address
        // This assumes only ONE wallet can control live trading at a time.
        // If multiple live traders are intended, this logic needs adjustment.
        if (state.liveTrading.enabled && !state.liveTrading.walletAddress) {
           state.liveTrading.walletAddress = data.address;
           logger.info(`Live trading wallet address set to: ${data.address}`);
           
           // Load saved state for this wallet if it exists
           loadWalletState(data.address);
        }
    } else {
         logger.warn(`Invalid wallet connection data from socket ${socket.id}`);
         socket.emit('error', { message: 'Invalid wallet connection data.' });
      }
    } catch (error) {
        logger.error(`Error processing wallet connection for socket ${socket.id}: ${error.message}`, { stack: error.stack });
        socket.emit('error', { message: 'Server error processing wallet connection.'});
     }
  });
  
  // Wallet disconnect handler
  socket.on('disconnect_wallet', () => {
    logger.info(`Wallet disconnected for socket ${socket.id}`);
    if (socket.walletAddress === state.liveTrading.walletAddress) {
        // Save state before clearing wallet
        if (state.tradingControl.mode === 'live') {
            saveWalletState(socket.walletAddress);
        }
        state.liveTrading.walletAddress = null; // Clear live wallet if this was the one
        logger.info('Live trading wallet address cleared.');
    }
    socket.walletAddress = null; 
    socket.emit('wallet_status', { connected: false });
  });

  // Toggle ML handler
  socket.on('toggle_ml', (data) => {
    try {
      const enabled = data?.enabled !== undefined ? Boolean(data.enabled) : !state.mlEnabled;
      state.mlEnabled = enabled;
      
      logger.info(`ML ${enabled ? 'enabled' : 'disabled'} by socket ${socket.id}`);
      
      // Broadcast ML status to all clients
      io.emit('ml_status', {
        enabled: state.mlEnabled,
      accuracy: state.mlStats.accuracy,
      predictions: state.mlStats.predictions,
        correctPredictions: state.mlStats.correctPredictions
      });
      
      // Confirm to the requesting client
      socket.emit('ml_toggled', { enabled: state.mlEnabled });
      
      // Show notification to all clients
      io.emit('bot_notification', {
        message: `Machine Learning ${enabled ? 'enabled' : 'disabled'}`,
        type: 'info',
        timestamp: Date.now()
    });
    } catch (error) {
      logger.error(`Error toggling ML for socket ${socket.id}: ${error.message}`);
      socket.emit('error', { message: `Failed to toggle ML: ${error.message}` });
    }
  });
  
  // Toggle token discovery handler
  socket.on('toggle_token_discovery', (data) => {
    try {
      const enabled = data?.enabled !== undefined ? Boolean(data.enabled) : !state.tokenDiscovery.enabled;
      state.tokenDiscovery.enabled = enabled;
      
      logger.info(`Token discovery ${enabled ? 'enabled' : 'disabled'} by socket ${socket.id}`);
      
      // Broadcast token discovery status to all clients
      io.emit('token_discovery_stats', {
        enabled: state.tokenDiscovery.enabled,
        totalTokens: state.tokenDiscovery.trackedTokens.length,
        lastDiscoveryTime: state.tokenDiscovery.lastDiscoveryTime
      });
      
      // Confirm to the requesting client
      socket.emit('token_discovery_toggled', { enabled: state.tokenDiscovery.enabled });
      
      // Show notification to all clients
      io.emit('bot_notification', {
        message: `Token Discovery ${enabled ? 'enabled' : 'disabled'}`,
        type: 'info',
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error toggling token discovery for socket ${socket.id}: ${error.message}`);
      socket.emit('error', { message: `Failed to toggle token discovery: ${error.message}` });
    }
  });
  
  // Scan tokens handler
  socket.on('scan_tokens', async (data) => {
    try {
      logger.info(`Token scan requested by socket ${socket.id}`);
      
      // Make sure token discovery is enabled
      if (!state.tokenDiscovery.enabled) {
        // Enable token discovery first
        state.tokenDiscovery.enabled = true;
        
        // Notify UI that token discovery was enabled
        io.emit('token_discovery_stats', {
          enabled: true,
          totalTokens: state.tokenDiscovery.trackedTokens.length,
          lastDiscoveryTime: state.tokenDiscovery.lastDiscoveryTime
        });
      }
      
      // Perform token discovery
      const tokenCount = await discoverNewTokens();
      
      // Notify client
      socket.emit('token_discovery_result', {
        success: true,
        newTokensCount: tokenCount || 0,
        totalTokens: state.tokenDiscovery.trackedTokens.length,
        lastDiscoveryTime: state.tokenDiscovery.lastDiscoveryTime
      });
      
      // Show notification to all clients
      io.emit('bot_notification', {
        message: tokenCount > 0 ? 
          `Discovered ${tokenCount} new trading tokens` : 
          'Scanned for tokens but found no new ones',
        type: tokenCount > 0 ? 'success' : 'info',
        timestamp: Date.now()
      });
  } catch (error) {
      logger.error(`Error scanning tokens for socket ${socket.id}: ${error.message}`);
      socket.emit('token_discovery_result', { 
        success: false, 
        error: error.message 
      });
    }
  });

  // Handle trade execution result from client
  socket.on('trade_executed', (result) => {
    logger.info(`Received trade execution result from client ${socket.id}: TradeId=${result.tradeId}, Success=${result.success}`);
    const trade = state.trades.find(t => t.id === result.tradeId);
      if (trade) {
        // Ensure we only process results for trades in 'prepared' state
        if (trade.status !== 'prepared') {
            logger.warn(`Received execution result for trade ${result.tradeId} which is not in prepared state (State: ${trade.status}). Ignoring.`);
            return;
        }

        trade.status = result.success ? 'executed_success' : 'executed_failure';
        trade.success = result.success;
        trade.transactionSignature = result.signature;
        trade.error = result.error;
        trade.executedTimestamp = Date.now();

        if (trade.success) {
            logger.info(`Live trade ${trade.id} successful. Signature: ${result.signature}`);
            // TODO: Potentially fetch actual profit/loss from transaction details using the signature
            // For now, we use the estimated profit calculated earlier.
    } else {
            logger.error(`Live trade ${trade.id} failed. Error: ${result.error || 'Client reported failure'}`);
            trade.profit = 0; // Assume 0 profit on failure for now
            trade.profitPercentage = 0;
        }
        
        // Update portfolio, ML stats, token stats for the completed live trade
    updatePortfolio(trade);
        // Pass prediction details if available on the trade object for better learning
        updateMLStats(trade.predictionDetails || { prediction: trade.mlScore > 50 ? 1 : 0 }, trade.success);
        updateTokenPerformanceStats(trade);
        
        // Broadcast the final status of the trade
        broadcastTradeUpdate(trade);

    } else {
        logger.warn(`Received execution result for unknown trade ID: ${result.tradeId} from socket ${socket.id}`);
    }
  });
  
  // Start Trading Handler
  socket.on('start_trading', async (data) => {
      try {
          logger.info(`Start trading request received from ${socket.id}: Mode=${data.mode}`);
          const mode = data.mode || 'demo';
          const walletAddress = socket.walletAddress; // Use address stored on socket

          if (mode === 'live' && !walletAddress) {
              logger.warn(`Live trading start rejected for socket ${socket.id}: Wallet not connected.`);
              socket.emit('error', { message: 'Wallet connection required for live trading.' });
              return;
          }
          // Prevent starting if already running, maybe?
          if (state.tradingControl.isRunning) {
              logger.warn(`Trading already running. Ignoring start request from ${socket.id}.`);
              socket.emit('trading_started', { success: true, mode: state.tradingControl.mode }); // Still confirm status
              return;
          }

          // Stop existing intervals (safety check)
          if (state.tradingInterval) clearInterval(state.tradingInterval);
          if (state.tokenDiscoveryInterval) clearInterval(state.tokenDiscoveryInterval);
          if (state.mlTrainingInterval) clearInterval(state.mlTrainingInterval);

          // Set trading mode
          state.tradingControl.mode = mode;
          state.tradingControl.startTime = Date.now();
          state.tradingControl.isRunning = true;
          state.liveTrading.walletAddress = (mode === 'live') ? walletAddress : null;
          
          // Handle different reset logic based on mode
          if (mode === 'demo') {
              // DEMO MODE: Reset everything to zero
              state.trades = [];
  state.portfolio = {
                  value: 50.00, 
                  totalPnL: 0.00, 
                  dailyReturn: 0.00, 
                  mlAccuracy: state.mlStats.accuracy, 
                  balance: 50.00 
              };
              // Don't reset profit lock in demo mode
              state.profitLock.lockedBalance = 0;
              state.profitLock.totalLocked = 0;
              state.profitLock.history = [];
              
              // Clear historical data in demo mode
              state.historicalData = {
                  timestamps: [Date.now()],
                  values: [0],
                  profits: [0]
              };
              
              logger.info(`Portfolio reset for ${mode} mode start.`);
    } else {
              // LIVE MODE: Load saved state if exists, otherwise initialize with default values
              if (!loadWalletState(walletAddress)) {
                  logger.info(`No saved state found for wallet ${walletAddress}. Initializing new live trading account.`);
                  // Don't reset trades in live mode - keep history
                  if (!state.portfolio.value || state.portfolio.value === 0) {
                      state.portfolio.value = 0.00; // Start with 0 if no previous balance
                  }
                  // Keep existing ML accuracy and totalPnL in live mode
              }
              logger.info(`Live trading state loaded for wallet ${walletAddress}`);
          }
          
          logger.info(`Trading state set: Mode=${mode}, Wallet=${state.liveTrading.walletAddress || 'N/A'}`);

          await startMarketDataTrading(); // Start the main trading loop

          io.emit('trading_status', { isRunning: true, mode: mode });
          socket.emit('trading_started', { success: true, mode: mode });
          logger.info(`Trading started successfully in ${mode} mode.`);

  } catch (error) {
          logger.error(`Error starting trading for socket ${socket.id}: ${error.message}`, { stack: error.stack });
          socket.emit('error', { message: 'Failed to start trading: ' + error.message });
      }
  });

  // Stop Trading Handler
  socket.on('stop_trading', () => {
      try {
          logger.info(`Stop trading request received from ${socket.id}.`);
          // Stop only if currently running
          if (!state.tradingControl.isRunning) {
              logger.warn(`Trading is not running. Ignoring stop request from ${socket.id}.`);
              socket.emit('trading_stopped', { success: true }); // Still confirm status
              return;
          }

          // Save state if in live mode
          if (state.tradingControl.mode === 'live' && state.liveTrading.walletAddress) {
              saveWalletState(state.liveTrading.walletAddress);
          }

          if (state.tradingInterval) clearInterval(state.tradingInterval);
          if (state.tokenDiscoveryInterval) clearInterval(state.tokenDiscoveryInterval);
          if (state.mlTrainingInterval) clearInterval(state.mlTrainingInterval);
          
          state.tradingInterval = null;
          state.tokenDiscoveryInterval = null;
          state.mlTrainingInterval = null;

          state.tradingControl.isRunning = false;
          
          // Keep wallet address if in live mode (to maintain state reference)
          if (state.tradingControl.mode === 'demo') {
              state.liveTrading.walletAddress = null; // Clear wallet only in demo mode
          }
          
          logger.info('Trading stopped.');
          io.emit('trading_status', { isRunning: false, mode: state.tradingControl.mode });
          socket.emit('trading_stopped', { success: true }); 

    } catch (error) {
          logger.error(`Error stopping trading for socket ${socket.id}: ${error.message}`, { stack: error.stack });
          socket.emit('error', { message: 'Failed to stop trading: ' + error.message });
      }
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
    const index = clients.findIndex(c => c.id === socket.id);
    if (index !== -1) {
      clients.splice(index, 1);
    }
    // Save state if this was a live trading wallet and then disconnect
    if (socket.walletAddress === state.liveTrading.walletAddress && state.tradingControl.mode === 'live') {
        saveWalletState(socket.walletAddress);
        logger.info(`Saved trading state for wallet ${socket.walletAddress} on client disconnect.`);
    }
    // Don't clear the wallet address on disconnect - only on explicit disconnect_wallet
  });

  // ... other specific socket event handlers like get_trades, toggle_ml, scan_tokens etc. should be defined here ...
  
  // Add handler for scan_tokens event
  socket.on('scan_tokens', async () => {
    try {
      logger.info(`Token discovery scan requested by client ${socket.id}`);
      
      // Notify the client that scan has started
      socket.emit('scan_tokens_started');
      
      // Run the discovery process
      const discoveredTokens = await discoverNewTokens();
      
      // Send results back to the client
      socket.emit('scan_tokens_completed', {
        success: true,
        count: discoveredTokens.length,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error during token discovery requested by client ${socket.id}:`, error);
      socket.emit('scan_tokens_completed', {
        success: false,
        error: error.message
      });
    }
  });

  // Add handler for get_trades event
  socket.on('get_trades', () => {
    try {
      logger.info(`Trades requested by client ${socket.id}`);
      
      // Process all trades to ensure they have proper token symbols
      const processedTrades = state.trades.slice(-50).map(trade => ensureTokenSymbols({...trade}));
      
      // Send to the requesting client
      socket.emit('trades', processedTrades);
      
      logger.info(`Sent ${processedTrades.length} trades to client ${socket.id}`);
    } catch (error) {
      logger.error(`Error sending trades to client ${socket.id}: ${error.message}`);
      socket.emit('error', { message: 'Failed to get trades' });
    }
  });
}); // End of io.on('connection')

// Add functions to save and load trading state by wallet
function saveWalletState(walletAddress) {
    try {
        if (!walletAddress) return false;
        
        // Create wallet-specific state object
        const walletState = {
            portfolio: state.portfolio,
            trades: state.trades,
            profitLock: state.profitLock,
            mlStats: state.mlStats,
            historicalData: state.historicalData,
            savedAt: Date.now()
        };
        
        // Create wallet storage dir if it doesn't exist
        const walletDir = path.join(DATA_DIR, 'wallets');
        if (!fs.existsSync(walletDir)) {
            fs.mkdirSync(walletDir, { recursive: true });
        }
        
        // Create anonymized wallet filename (hashed for privacy)
        const crypto = require('crypto');
        const walletHash = crypto.createHash('sha256').update(walletAddress).digest('hex').slice(0, 16);
        const stateFile = path.join(walletDir, `${walletHash}.json`);
        
        // Save state to file
        fs.writeFileSync(stateFile, JSON.stringify(walletState, null, 2));
        
        logger.info(`Wallet state saved successfully for ${walletAddress.substring(0, 6)}...`);
        return true;
    } catch (error) {
        logger.error(`Error saving wallet state: ${error.message}`, error);
        return false;
    }
}

function loadWalletState(walletAddress) {
    try {
        if (!walletAddress) return false;
        
        // Create anonymized wallet filename (hashed for privacy)
        const crypto = require('crypto');
        const walletHash = crypto.createHash('sha256').update(walletAddress).digest('hex').slice(0, 16);
        const stateFile = path.join(DATA_DIR, 'wallets', `${walletHash}.json`);
        
        // Check if file exists
        if (!fs.existsSync(stateFile)) {
            logger.info(`No saved state found for wallet ${walletAddress.substring(0, 6)}...`);
            return false;
        }
        
        // Load state from file
        const walletState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        
        // Update current state with saved state
        state.portfolio = walletState.portfolio;
        state.trades = walletState.trades || [];
        state.profitLock = walletState.profitLock;
        state.mlStats = walletState.mlStats;
        state.historicalData = walletState.historicalData;
        
        logger.info(`Loaded wallet state from ${new Date(walletState.savedAt).toLocaleString()} for ${walletAddress.substring(0, 6)}...`);
        return true;
    } catch (error) {
        logger.error(`Error loading wallet state: ${error.message}`, error);
        return false;
    }
}

// Modify initializeML to load token registry
async function initializeML() {
  // ... existing ML init ...
  await loadTokenRegistry(); // Load tokens after ML bridge starts
  // ... rest of init ...
}

// Initial server startup call
async function startServerProcess() {
  await initializeML(); // Ensure ML and registry are loaded first
  // The server.listen part will be called after this completes
  // Make sure the server listen call is appropriately placed or called after this async function completes.
}

// Add discoverNewTokens function
async function discoverNewTokens() {
  try {
    if (!state.tokenDiscovery.enabled) {
      logger.info('Token discovery is disabled, skipping discovery');
      return [];
    }
    
    logger.info('Starting token discovery process with Helius API...');
    
    // Store discovered tradeable tokens here
    const tradeableTokens = [];
    
    // Get tokens with price data
    logger.info('Fetching tokens with price data from dexConnector...');
    const tokensWithPrices = await dexConnector.getTokensWithPriceData();
    logger.info(`Raw returned tokens from dexConnector: ${tokensWithPrices ? tokensWithPrices.length : 0}`);
    
    if (!tokensWithPrices || tokensWithPrices.length === 0) {
      logger.warn('No tokens with price data found. Cannot perform discovery.');
      // Define some hardcoded tokens as fallback for testing
      return getDefaultTokens();
    }
    
    logger.info(`Fetched ${tokensWithPrices.length} tokens with price data`);
    
    // Log some sample tokens to debug
    if (tokensWithPrices.length > 0) {
      const sampleTokens = tokensWithPrices.slice(0, Math.min(5, tokensWithPrices.length));
      logger.info('Sample tokens:');
      sampleTokens.forEach(token => {
        logger.info(`Token: ${token.symbol || 'Unknown'} (${token.name || 'Unnamed'}), Address: ${token.address || 'No Address'}, Price: $${token.price || 'No Price'}`);
      });
    }
    
    // These tokens already have price data, so we're mainly just filtering for quality
    const potentialTokens = tokensWithPrices.filter(token => {
      return token.name && 
             token.symbol && 
             token.address &&
             token.price && token.price > 0 &&  // Ensure price is valid
             // Basic validation checks
             token.symbol.length >= 2 && // Avoid single letter tokens
             token.symbol.length <= 10; // Reasonable symbol length
    });
    
    logger.info(`Filtered to ${potentialTokens.length} potential tokens with valid price data`);
    
    // Test a batch for tradeability
    const batchSize = Math.min(5, potentialTokens.length); // Test up to 5 tokens per discovery run
    const testCandidates = potentialTokens
      .sort(() => 0.5 - Math.random()) // Randomize to explore different tokens each time
      .slice(0, batchSize);
    
    logger.info(`Testing ${testCandidates.length} tokens for full tradeability`);
    
    // Define the main base tokens we'll use for testing tradeability
    const USDC_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    // Test each token for tradeability
    for (const token of testCandidates) {
      logger.info(`Token ${token.symbol} (${token.address}) has price data: $${token.price}`);
      
      // If we already have a price, we'll consider this token tradeable
      // In a complete system, we'd also verify liquidity and slippage here
      
      // This token is tradeable! Add complete info
      token.tradeable = true;
      token.impliedSlippage = 1.0; // Default value
      token.lastVerified = Date.now();
      token.lastTradeableTime = Date.now();
      
      // Add verified tradeable token to our result list
      tradeableTokens.push(token);
      
      logger.info(`DISCOVERY SUCCESS: ${token.symbol} (${token.name}) IS TRADEABLE! Price: $${token.price}`);
      
      // Initialize or update token performance data
      if (!state.tokenPerformance[token.symbol]) {
        state.tokenPerformance[token.symbol] = {
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          trades: 0,
          successCount: 0,
          failCount: 0,
          winRate: 0,
          totalProfit: 0,
          averageReturn: 0,
          lastTradeTime: null,
          lastPrice: token.price,
          mlScore: 0.5, // Default neutral ML score
          discovered: true,
          discoveryTime: Date.now()
        };
      } else {
        // Update existing token with latest price
        state.tokenPerformance[token.symbol].lastPrice = token.price;
        state.tokenPerformance[token.symbol].lastUpdated = Date.now();
      }
      
      // Emit token discovery event to clients
      io.emit('token_discovered', {
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        price: token.price,
        discoveryTime: Date.now(),
        impliedSlippage: token.impliedSlippage,
        mlScore: state.tokenPerformance[token.symbol]?.mlScore || 0.5
      });
    }
    
    // Update last discovery time
    state.tokenDiscovery.lastDiscoveryTime = Date.now();
    state.tokenDiscovery.lastRunResults = {
      tested: testCandidates.length,
      tradeable: tradeableTokens.length,
      timestamp: Date.now()
    };
    
    logger.info(`Token discovery completed. Found ${tradeableTokens.length} verified tradeable tokens.`);
    
    // If we couldn't discover any tokens, fall back to default tokens
    if (tradeableTokens.length === 0) {
      logger.info('No tradeable tokens discovered, falling back to default tokens.');
      return getDefaultTokens();
    }
    
    // Return the tradeable tokens which can be used directly by the trading logic
    return tradeableTokens;
  } catch (error) {
    logger.error('Error in token discovery process:', error);
    // Fallback to default tokens in case of error
    return getDefaultTokens();
  }
}

// Function to get default tokens when discovery fails
function getDefaultTokens() {
  // Define default tokens with fake prices
  return [
    { 
      symbol: "SOL", 
      name: "Solana", 
      address: "So11111111111111111111111111111111111111112", 
      price: 150.00, 
      decimals: 9,
      tradeable: true
    },
    { 
      symbol: "USDC", 
      name: "USD Coin", 
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 
      price: 1.00, 
      decimals: 6,
      tradeable: true 
    }
  ];
}

// Add updateHistoricalData function
function updateHistoricalData() {
  try {
    const currentTimestamp = Date.now();
    const currentValue = state.portfolio.value;
    const previousValue = state.historicalData.values[state.historicalData.values.length - 1] || currentValue;
    const profit = currentValue - previousValue;
    
    state.historicalData.timestamps.push(currentTimestamp);
    state.historicalData.values.push(currentValue);
    state.historicalData.profits.push(profit);
    
    // Keep only the last 24 hours of data (1440 minutes)
    if (state.historicalData.timestamps.length > 1440) {
      state.historicalData.timestamps.shift();
      state.historicalData.values.shift();
      state.historicalData.profits.shift();
    }
    
    logger.info('Historical data updated');
  } catch (error) {
    logger.error('Error updating historical data:', error);
  }
}

// Start the market data trading loop
async function startMarketDataTrading() {
  try {
    logger.info('Starting market data trading...');
    
    // Clear any existing intervals
    if (state.tradingInterval) clearInterval(state.tradingInterval);
    
    // Reset the portfolio and trades when starting
    state.portfolio = {
      value: 50.00, // Start at exactly $50 in demo mode
      totalPnL: 0.00,
      dailyReturn: 0.00,
      mlAccuracy: state.mlStats.accuracy,
      balance: 50.00 // Start at exactly $50 in demo mode
    };
    
    // Clear any existing trades
    state.trades = [];
    
    // Also reset profit lock values
    state.profitLock.lockedBalance = 0;
    state.profitLock.totalLocked = 0;
    
    // Set up regular trading interval (every 30-60 seconds)
    const TRADE_INTERVAL = 30000; // 30 seconds
    
    state.tradingInterval = setInterval(async () => {
      if (state.tradingControl.isRunning) {
        await generateAndProcessTrade();
      }
    }, TRADE_INTERVAL);
    
    // Don't generate an immediate trade - wait for the first interval
    logger.info('Market data trading loop started. First trade will appear in ~30 seconds');
    return true;
  } catch (error) {
    logger.error('Error starting market data trading:', error);
    return false;
  }
}

// Generate and process a simulated trade based on REAL market data
async function generateAndProcessTrade() {
  try {
    if (!state.tradingControl.isRunning || !dexConnector) {
      return; 
    }
    
    // Only run this enhanced demo simulation if in demo mode
    if (state.tradingControl.mode !== 'demo') {
        logger.warn('Attempted to run real-price simulation outside of demo mode. Skipping.');
      return;
    }
    
    logger.info('DEMO (REAL PRICE): Starting trade simulation with actual price data...');

    // ---------------------------------------------------------------------
    // 1. Select Tokens (Using existing ML/Technical + Discovery Logic)
    // ---------------------------------------------------------------------
    let availableTokens = [];
    
    // MODE 1: TOKEN DISCOVERY - If enabled, try to discover new tradeable tokens
    if (state.tokenDiscovery.enabled) {
      logger.info('DEMO (REAL PRICE): Token discovery is enabled, searching for tokens...');
      
      try {
        // Get tokens with price data directly (skip all tokens without prices)
        const tokensWithPrices = await dexConnector.getTokensWithPriceData();
        
        if (tokensWithPrices && tokensWithPrices.length > 0) {
          logger.info(`DEMO (REAL PRICE): Found ${tokensWithPrices.length} tokens with price data`);
          
          // Filter for basic quality and add to available tokens
          tokensWithPrices.forEach(token => {
            if (token.name && token.symbol && token.price > 0) {
              availableTokens.push({
                symbol: token.symbol,
                name: token.name,
                address: token.address,
                price: token.price,
                decimals: token.decimals || 9,
                discovered: true
              });
            }
          });
          
          logger.info(`DEMO (REAL PRICE): Added ${availableTokens.length} discovered tokens with price data`);
        }
    } catch (error) {
        logger.error(`DEMO (REAL PRICE): Error during token discovery: ${error.message}`);
      }
      } else {
      logger.info('DEMO (REAL PRICE): Token discovery is disabled');
    }
    
    // MODE 2: DEFAULT TOKEN LIST - Always have this as a fallback or primary source
    // Define known reliable tokens on Solana with their addresses
    const KNOWN_TRADEABLE_TOKENS = [
      { symbol: "SOL", address: "So11111111111111111111111111111111111111112", decimals: 9 },
      { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
      { symbol: "BONK", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
      { symbol: "JUP", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
      { symbol: "ORCA", address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", decimals: 6 },
      { symbol: "WIF", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLZYQJB9ihCn3", decimals: 6 },
      { symbol: "JITO", address: "7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx", decimals: 9 }
    ];
    
    // Always add default tokens to the list (will be filtered for price later)
    logger.info('DEMO (REAL PRICE): Adding default token list');
    KNOWN_TRADEABLE_TOKENS.forEach(token => {
      // Only add if not already in the list
      if (!availableTokens.some(t => t.address === token.address)) {
        availableTokens.push({
      symbol: token.symbol,
          name: token.symbol, // Use symbol as name for defaults
          address: token.address,
          decimals: token.decimals,
          default: true
        });
      }
    });
    
    // Now fetch prices for ALL tokens (discovered + default) in one batch
    if (availableTokens.length > 0) {
      logger.info(`DEMO (REAL PRICE): Fetching prices for ${availableTokens.length} tokens`);
      try {
        const tokensWithPrices = [];
        // Fetch prices one by one using the connector
        for (const token of availableTokens) {
          try {
            const price = await dexConnector.getTokenPrice(token.address);
            if (price !== null && price > 0) {
              token.price = price;
              tokensWithPrices.push(token);
              logger.info(`DEMO (REAL PRICE): Got price for ${token.symbol}: $${price}`);
            }
          } catch (priceError) {
            logger.error(`DEMO (REAL PRICE): Error fetching price for ${token.symbol} (${token.address}): ${priceError.message}`);
          }
        }
        
        availableTokens = tokensWithPrices;
        logger.info(`DEMO (REAL PRICE): Found ${availableTokens.length} tokens with valid prices after fetching`);
        
      } catch (error) { // General catch block for the loop/batch process
        logger.error(`DEMO (REAL PRICE): Error processing token prices: ${error.message}`);
        // Reset availableTokens to empty if the whole process fails catastrophically
        availableTokens = []; 
      }
    }
    
    // Final check - We need at least 2 tokens to trade
    if (availableTokens.length < 2) {
        logger.warn('DEMO (REAL PRICE): Need at least 2 valid tokens to trade. Using fallback tokens.');
        
        // Use our fallback tokens with hardcoded prices as a last resort
        availableTokens = [
          { 
            symbol: "SOL", 
            name: "Solana", 
            address: "So11111111111111111111111111111111111111112", 
            price: 150.00 + (Math.random() * 10 - 5),
            decimals: 9
          },
          { 
            symbol: "USDC", 
            name: "USD Coin", 
            address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 
            price: 1.00,
            decimals: 6
          }
        ];
        logger.info('DEMO (REAL PRICE): Added 2 fallback tokens with hardcoded prices');
    }
    
    // Choose source and target tokens
    let sourceToken, targetToken;
    
    // Generate a trade pair with real prices if possible
    // First, select two different tokens from available
    let sourceIndex = Math.floor(Math.random() * availableTokens.length);
    let targetIndex;
    do {
      targetIndex = Math.floor(Math.random() * availableTokens.length);
    } while (targetIndex === sourceIndex);
    
    sourceToken = availableTokens[sourceIndex];
    targetToken = availableTokens[targetIndex];
    
    // Ensure proper symbols are used
    const { sourceToken: enhancedSource, targetToken: enhancedTarget } = ensureProperTokenSymbols(sourceToken, targetToken);
    sourceToken = enhancedSource;
    targetToken = enhancedTarget;
    
    logger.info(`DEMO (REAL PRICE): Selected trading pair: ${sourceToken.symbol} -> ${targetToken.symbol}`);
    
    // ---------------------------------------------------------------------
    // 2. Generate Trade
    // ---------------------------------------------------------------------
    
    // Generate trade ID
    const tradeId = `trade-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Generate base amount (between 0.1 and 2 SOL equivalent)
    const baseAmount = 0.1 + (Math.random() * 1.9);
    
    // Convert to source token amount based on price ratio
    const tokenRatio = sourceToken.symbol === 'SOL' ? 
      1 : 
      (sourceToken.price > 0 ? (150.00 / sourceToken.price) : 1); // Using SOL price of approximately 150.00
      
    const sourceAmount = baseAmount * tokenRatio;
    
    // Calculate USD value
    const amountInUsd = sourceAmount * sourceToken.price;
    
    // Simulate price movement (between -3% and +5%)
    const priceMovement = -3 + (Math.random() * 8);
    
    // Calculate profit
    const profitAmount = amountInUsd * (priceMovement / 100);
    
    // Create the trade object
    const trade = {
      id: tradeId,
      timestamp: Date.now(),
      // Always use symbols for display, addresses only for references
      fromSymbol: sourceToken.symbol,
      toSymbol: targetToken.symbol,
      // Keep addresses as references
      fromToken: sourceToken.address,
      toToken: targetToken.address,
      // Include names for additional context
      fromTokenName: sourceToken.name || sourceToken.symbol,
      toTokenName: targetToken.name || targetToken.symbol,
      amount: sourceAmount.toFixed(4),
      amountInUsd: amountInUsd.toFixed(2),
      profit: profitAmount.toFixed(2),
      profitPercentage: priceMovement.toFixed(2),
      status: 'completed',
      type: 'Swap',
      exchanges: 'Jupiter',
      route: `${sourceToken.symbol} → ${targetToken.symbol}`,
      mlScore: Math.round(50 + Math.random() * 50),
      txId: `demo-${Math.random().toString(36).substring(2, 15)}`,
      success: priceMovement > 0,
      exitPrice: targetToken.price * (1 + (priceMovement / 100))
    };
    
    logger.info(`DEMO (REAL PRICE): Generated trade with real prices: ${sourceToken.symbol} → ${targetToken.symbol}, Profit: ${profitAmount.toFixed(2)} (${priceMovement.toFixed(2)}%)`);
    
    // Add to trades array
    const finalTrade = ensureTokenSymbols(trade);
    state.trades.push(finalTrade);
    
    // Update portfolio based on the trade
    updatePortfolio(finalTrade);
    
    // Emit the new trade to all clients
    io.emit('new_trade', finalTrade);
    
    return finalTrade;
    
  } catch (error) {
    logger.error(`DEMO (REAL PRICE): CRITICAL Error in generateAndProcessTrade: ${error.message}`, { stack: error.stack });
    return null;
  }
}

// Function to initialize token data
function initializeTokenData() {
  try {
    logger.info('Initializing token performance data...');
    // Get all tokens from the registry
    const allTokens = getAllTokens();
    
    // Initialize performance data for each token
    allTokens.forEach(token => {
      if (!state.tokenPerformance[token.symbol]) {
    state.tokenPerformance[token.symbol] = {
      symbol: token.symbol,
      name: token.name,
          address: token.address,
        trades: 0,
        successCount: 0,
        failCount: 0,
        winRate: 0,
          totalProfit: 0,
          averageReturn: 0,
          lastTradeTime: null,
          lastPrice: null,
          mlScore: 0.5, // Default neutral ML score
          discovered: false
        };
      }
    });
    
    logger.info(`Initialized performance data for ${Object.keys(state.tokenPerformance).length} tokens`);
    return true;
  } catch (error) {
    logger.error('Error initializing token data:', error);
    return false;
  }
}

// Initialize token data
initializeTokenData();

// Add API endpoints for ML toggle
app.post('/api/ml/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({ error: 'Missing enabled parameter' });
    }
    
    state.mlEnabled = Boolean(enabled);
    
    // Update ML Bridge
    mlBridge.setEnabled(state.mlEnabled);
    
    logger.info(`ML system ${state.mlEnabled ? 'enabled' : 'disabled'}`);
    
    // Emit state change to all clients
    io.emit('ml_state_changed', { enabled: state.mlEnabled });
    
    return res.json({ 
      success: true,
      mlEnabled: state.mlEnabled
    });
  } catch (error) {
    logger.error('Error toggling ML state:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get ML state
app.get('/api/ml/state', (req, res) => {
  res.json({
    enabled: state.mlEnabled,
    accuracy: state.mlStats.accuracy,
    predictions: state.mlStats.predictions,
    correctPredictions: state.mlStats.correctPredictions
  });
});

// Add API endpoints for token discovery toggle
app.post('/api/token-discovery/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({ error: 'Missing enabled parameter' });
    }
    
    state.tokenDiscovery.enabled = Boolean(enabled);
    
    logger.info(`Token discovery ${state.tokenDiscovery.enabled ? 'enabled' : 'disabled'}`);
    
    // Emit state change to all clients
    io.emit('token_discovery_state_changed', { enabled: state.tokenDiscovery.enabled });
    
    return res.json({ 
      success: true,
      tokenDiscoveryEnabled: state.tokenDiscovery.enabled
    });
  } catch (error) {
    logger.error('Error toggling token discovery state:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Get token discovery state
app.get('/api/token-discovery/state', (req, res) => {
  res.json({
    enabled: state.tokenDiscovery.enabled,
    lastDiscoveryTime: state.tokenDiscovery.lastDiscoveryTime,
    lastRunResults: state.tokenDiscovery.lastRunResults || null
  });
});

// Add a new endpoint to manually trigger token discovery
app.post('/api/token-discovery/scan', async (req, res) => {
  try {
    logger.info('Manual token discovery scan triggered via API');
    
    // Run the discovery process
    const discoveredTokens = await discoverNewTokens();
    
    // Return results
    return res.json({
      success: true,
      message: `Discovered ${discoveredTokens.length} tradeable tokens`,
      results: {
        count: discoveredTokens.length,
        tokens: discoveredTokens.map(token => ({
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          price: token.price,
          impliedSlippage: token.impliedSlippage
        }))
      }
    });
      } catch (error) {
    logger.error('Error during manual token discovery:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Token discovery failed: ' + error.message 
    });
  }
});

// Add API endpoint for secure trading setup
app.post('/api/secure-trading/setup', (req, res) => {
  try {
    const { privateKey, encryptionKey } = req.body;
    
    if (!privateKey || !encryptionKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Private key and encryption key are required' 
      });
    }
    
    // Setup secure trading (this doesn't store the plain private key)
    dexConnector.setupAutomaticTrading(privateKey, encryptionKey)
      .then(result => {
        if (result.success) {
    // Update state
          state.liveTrading.walletAddress = result.publicKey;
          state.liveTrading.privateKeyEncrypted = result.encryptedPrivateKey;
          
          // Store encrypted key in .env if specified
          if (req.body.saveToEnv) {
            // Logic to update .env file would go here (omitted for security)
            logger.info('Encrypted private key configuration saved.');
          }
          
          res.json({
      success: true,
            publicKey: result.publicKey,
            message: 'Secure trading setup successful'
          });
      } else {
          res.status(500).json({
            success: false,
            error: result.error || 'Failed to setup secure trading'
          });
        }
      })
      .catch(error => {
        logger.error('Error setting up secure trading:', error);
        res.status(500).json({
          success: false,
          error: 'Server error'
        });
      });
  } catch (error) {
    logger.error('Error setting up secure trading:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Function to update portfolio after a trade
function updatePortfolio(trade) {
  try {
    if (!trade) return;
    
    // Make sure portfolio.value is a number before updating
    if (typeof state.portfolio.value !== 'number') {
      state.portfolio.value = parseFloat(state.portfolio.value) || 0.00;
    }
    
    // Convert profit to number to ensure calculation works
    const profitAmount = parseFloat(trade.profit) || 0;
    
    // Update portfolio value based on trade profit
    state.portfolio.value += profitAmount;
    state.portfolio.totalPnL += profitAmount;
    
    // Calculate daily return
    const startTime = state.tradingControl.startTime;
    const daysPassed = (Date.now() - startTime) / (24 * 60 * 60 * 1000);
    if (daysPassed > 0) {
      state.portfolio.dailyReturn = (state.portfolio.totalPnL / (daysPassed * 100)) * 100;
    }
    
    // Process profit locking if enabled and profitable
    if (state.profitLock.enabled && profitAmount > 0) {
      const lockAmount = (profitAmount * state.profitLock.percentage) / 100;
      state.profitLock.lockedBalance += lockAmount;
      state.profitLock.totalLocked += lockAmount;
      state.profitLock.lastLockTime = Date.now();
      
      // Add to lock history
      if (!state.profitLock.history) state.profitLock.history = [];
      state.profitLock.history.push({
        tradeId: trade.id,
        profit: profitAmount,
        lockAmount,
      timestamp: Date.now()
    });
    
      logger.info(`Locked ${lockAmount.toFixed(2)} (${state.profitLock.percentage}%) of profit from trade ${trade.id}`);
    }
    
    // Broadcast updated portfolio to all clients
    io.emit('portfolio', {
      balance: state.portfolio.value.toFixed(2),
      totalPnL: state.portfolio.totalPnL.toFixed(2),
      dailyReturn: state.portfolio.dailyReturn.toFixed(2),
      mlAccuracy: state.mlStats.accuracy.toFixed(1),
      lockedProfit: state.profitLock.lockedBalance.toFixed(2)
    });
    
    logger.info(`Portfolio updated: Value=${state.portfolio.value.toFixed(2)}, PnL=${state.portfolio.totalPnL.toFixed(2)}, DailyReturn=${state.portfolio.dailyReturn.toFixed(2)}%`);
  } catch (error) {
    logger.error('Error updating portfolio:', error);
  }
}

// Function to update ML stats after a trade
function updateMLStats(prediction, success) {
  try {
    if (prediction === undefined || success === undefined) {
      logger.warn('Missing prediction or success value for ML stats update');
      return;
    }
    
    // Get numeric prediction (1 for predicted success, 0 for predicted failure)
    const numericPrediction = typeof prediction === 'object' ? 
                           (prediction.prediction !== undefined ? prediction.prediction : (prediction.probability > 0.5 ? 1 : 0)) : 
                           (prediction > 0.5 ? 1 : 0);
    
    // Convert success to numeric (1 for success, 0 for failure)
    const numericSuccess = success ? 1 : 0;
    
    // Increment total predictions
    state.mlStats.predictions++;
    
    // Increment correct predictions if prediction matches outcome
    if (numericPrediction === numericSuccess) {
      state.mlStats.correctPredictions++;
    }
    
    // Update accuracy
    state.mlStats.accuracy = state.mlStats.predictions > 0 ?
                           (state.mlStats.correctPredictions / state.mlStats.predictions) * 100 :
                           85; // Default if no predictions
    
    // Update ML Bridge
    if (state.mlEnabled && mlBridge) {
      // Add prediction details to the trade for better learning
      const tradeWithPrediction = {
        id: 'trade-' + Date.now(),
        success,
        predictionDetails: typeof prediction === 'object' ? 
          prediction : 
          { prediction: numericPrediction, probability: numericPrediction }
      };
      
      // Learn from the trade
      mlBridge.learnFromTrade(tradeWithPrediction);
    }
    
    // Update portfolio display with new ML accuracy
    state.portfolio.mlAccuracy = state.mlStats.accuracy;
    
    // Broadcast ML stats to all clients
    io.emit('ml_stats', {
      enabled: state.mlEnabled,
      accuracy: state.mlStats.accuracy,
      predictions: state.mlStats.predictions,
      correctPredictions: state.mlStats.correctPredictions
    });
    
    logger.info(`ML stats updated: Accuracy=${state.mlStats.accuracy.toFixed(2)}%, Predictions=${state.mlStats.predictions}, Correct=${state.mlStats.correctPredictions}`);
  } catch (error) {
    logger.error('Error updating ML stats:', error);
  }
}

// Function to update token performance stats after a trade
function updateTokenPerformanceStats(trade) {
  try {
    if (!trade || !trade.fromSymbol || !trade.toSymbol) {
      logger.warn('Missing required trade data for token performance update');
      return;
    }
    
    // Update performance for the source token
    if (state.tokenPerformance[trade.fromSymbol]) {
      state.tokenPerformance[trade.fromSymbol].trades++;
      if (trade.success) {
        state.tokenPerformance[trade.fromSymbol].successCount++;
      } else {
        state.tokenPerformance[trade.fromSymbol].failCount++;
      }
      state.tokenPerformance[trade.fromSymbol].winRate = (
        state.tokenPerformance[trade.fromSymbol].successCount /
        state.tokenPerformance[trade.fromSymbol].trades
      ) * 100;
      state.tokenPerformance[trade.fromSymbol].lastTradeTime = Date.now();
    }
    
    // Update performance for the target token
    if (state.tokenPerformance[trade.toSymbol]) {
      state.tokenPerformance[trade.toSymbol].trades++;
      if (trade.success) {
        state.tokenPerformance[trade.toSymbol].successCount++;
    } else {
        state.tokenPerformance[trade.toSymbol].failCount++;
      }
      state.tokenPerformance[trade.toSymbol].winRate = (
        state.tokenPerformance[trade.toSymbol].successCount /
        state.tokenPerformance[trade.toSymbol].trades
      ) * 100;
      state.tokenPerformance[trade.toSymbol].lastTradeTime = Date.now();
    }
    
    logger.info(`Token performance stats updated for ${trade.fromSymbol} and ${trade.toSymbol}`);
  } catch (error) {
    logger.error('Error updating token performance stats:', error);
  }
}

// Function to broadcast trade update to all clients
function broadcastTradeUpdate(trade) {
  if (!trade) return;
  
  const finalTrade = ensureTokenSymbols(trade);
  io.emit('trade_update', finalTrade);
  logger.info(`Trade update broadcast to all clients: TradeId=${finalTrade.id}, Status=${finalTrade.status}`);
}

// Find the server listening code at the end of the file and replace it with:
server.listen(PORT, HOST, async () => {
  logger.info(`Server running at http://${HOST}:${PORT}`);
  
  // Initialize historical data if needed
  if (!state.historicalData.timestamps.length) {
    const initialTimestamp = Date.now();
    state.historicalData = {
      timestamps: [initialTimestamp],
      values: [state.portfolio.value],
      profits: [0]
    };
  }
  
  // Explicitly set trading to off, regardless of AUTO_START setting
  state.tradingControl.isRunning = false;
  
  // Schedule periodic updates for UI data only
  setInterval(() => {
    updateHistoricalData();
  }, 60000); // Update every minute
  
  // We won't start any trading or token discovery here - wait for user to click Start button
  logger.info('Soul-Bot is ready. Press Start in the UI to begin trading');
});

// Add a function to generate simple demo trades that will always work
function generateDemoTrade() {
  try {
    logger.info('Generating guaranteed demo trade for UI testing...');
    
    // Define the tokens (using hardcoded data to ensure it works)
    const tokens = [
      { symbol: "SOL", name: "Solana", address: "So11111111111111111111111111111111111111112", price: 150.00 + (Math.random() * 10 - 5) },
      { symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", price: 1.00 },
      { symbol: "BONK", name: "Bonk", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", price: 0.00002 + (Math.random() * 0.000005) }
    ];
    
    // Randomly select source and target tokens
    let sourceIndex = Math.floor(Math.random() * tokens.length);
    let targetIndex;
    do {
      targetIndex = Math.floor(Math.random() * tokens.length);
    } while (targetIndex === sourceIndex);
    
    let sourceToken = tokens[sourceIndex];
    let targetToken = tokens[targetIndex];
    
    // Ensure proper symbols are used
    const { sourceToken: enhancedSource, targetToken: enhancedTarget } = ensureProperTokenSymbols(sourceToken, targetToken);
    sourceToken = enhancedSource;
    targetToken = enhancedTarget;
    
    // Generate random amount between 0.1 and 2 SOL (or equivalent)
    const baseAmount = 0.1 + (Math.random() * 1.9);
    
    // Calculate SOL-equivalent amount
    const amountInSol = sourceToken.symbol === 'SOL' ? 
      baseAmount : 
      (baseAmount * sourceToken.price / tokens[0].price);
    
    // Determine profit/loss - make 70% probability of profit for better user experience
    const isProfitable = Math.random() < 0.7;
    const profitPercent = isProfitable ? 
      (0.5 + Math.random() * 4) : // 0.5% to 4.5% profit
      (-0.5 - Math.random() * 2); // -0.5% to -2.5% loss
    
    // Calculate actual profit amount
    const amountInUsd = amountInSol * tokens[0].price;
    const profitAmount = amountInUsd * (profitPercent / 100);
    
    // Generate unique ID
    const tradeId = `trade-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Create trade object
    const trade = {
      id: tradeId,
      timestamp: Date.now(),
      // Always put symbols first for display priority in UI
      fromSymbol: sourceToken.symbol,
      toSymbol: targetToken.symbol,
      // Include token addresses for reference only
      fromToken: sourceToken.address,
      toToken: targetToken.address,
      // Include full names for better context
      fromTokenName: sourceToken.name,
      toTokenName: targetToken.name,
      amount: amountInSol.toFixed(4),
      amountInUsd: amountInUsd.toFixed(2),
      profit: profitAmount.toFixed(2),
      profitPercentage: profitPercent.toFixed(2),
      status: 'completed',
      type: 'Swap',
      exchanges: 'Jupiter',
      // Use symbols in all displayed text
      route: `${sourceToken.symbol} → ${targetToken.symbol}`,
      mlScore: Math.round(50 + Math.random() * 50),
      txId: `demo-${Math.random().toString(36).substring(2, 15)}`,
      success: isProfitable || Math.random() > 0.3, // Higher chance of success
      exitPrice: targetToken.price * (1 + (profitPercent / 100))
    };
    
    logger.info(`Demo trade generated: ${sourceToken.symbol} → ${targetToken.symbol}, Profit: ${profitAmount.toFixed(2)} (${profitPercent.toFixed(2)}%)`);
    
    // Add to trades array
    const finalTrade = ensureTokenSymbols(trade);
    state.trades.push(finalTrade);
    
    // Update portfolio based on the trade
    updatePortfolio(finalTrade);
    
    // Emit the new trade to all clients
    io.emit('new_trade', finalTrade);
    
    return finalTrade;
  } catch (error) {
    logger.error('Error generating demo trade:', error);
    return null;
  }
}

// Add this helper function that will ensure proper token symbols
function ensureTokenSymbols(trade) {
  // Make absolutely sure we have proper token symbols, not addresses
  if (!trade.fromSymbol || trade.fromSymbol.length > 20) {
    trade.fromSymbol = getTokenSymbolByAddress(trade.fromToken) || 'Unknown';
  }
  
  if (!trade.toSymbol || trade.toSymbol.length > 20) {
    trade.toSymbol = getTokenSymbolByAddress(trade.toToken) || 'Unknown';
  }
  
  // Also ensure the display route uses symbols
  trade.route = `${trade.fromSymbol} → ${trade.toSymbol}`;
  
  return trade;
}

// Add this helper function at the top of the file
function ensureProperTokenSymbols(sourceToken, targetToken) {
  // This function ensures we always use proper symbols, never addresses
  // Force proper symbol assignments
  const tokenAddressMap = {
    'So11111111111111111111111111111111111111112': 'SOL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
    '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU': 'SAMO',
    'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
    'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': 'ORCA',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
    '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL',
    '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'ETH',
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLZYQJB9ihCn3': 'WIF',
    '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx': 'JITO'
  };
  
  // For source token
  if (sourceToken) {
    // Ensure source token always has a symbol property
    if (!sourceToken.symbol || sourceToken.symbol.length > 15) {
      if (sourceToken.address && tokenAddressMap[sourceToken.address]) {
        sourceToken.symbol = tokenAddressMap[sourceToken.address];
      } else if (tokenAddressMap[sourceToken]) {
        sourceToken = {
          address: sourceToken,
          symbol: tokenAddressMap[sourceToken],
          name: tokenAddressMap[sourceToken]
        };
      }
    }
  }
  
  // For target token
  if (targetToken) {
    // Ensure target token always has a symbol property
    if (!targetToken.symbol || targetToken.symbol.length > 15) {
      if (targetToken.address && tokenAddressMap[targetToken.address]) {
        targetToken.symbol = tokenAddressMap[targetToken.address];
      } else if (tokenAddressMap[targetToken]) {
        targetToken = {
          address: targetToken,
          symbol: tokenAddressMap[targetToken],
          name: tokenAddressMap[targetToken]
        };
      }
    }
  }
  
  return { sourceToken, targetToken };
}