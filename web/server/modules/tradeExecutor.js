// tradeExecutor.js - Executes trades automatically based on strategy
const walletManager = require('./walletManager');
const dexConnector = require('./dexConnector');

class TradeExecutor {
  constructor() {
    this.isRunning = false;
    this.tradingJobs = {};
    this.tradingInterval = 60000; // 1 minute between trades by default
    this.tradingStrategies = {
      'default': this.defaultStrategy,
      'conservative': this.conservativeStrategy,
      'aggressive': this.aggressiveStrategy
    };
  }

  // Start the trade executor
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('Trade executor started');
    
    // Start processing trades
    this.processTradingJobs();
    
    return { success: true, message: 'Trade executor started' };
  }

  // Stop the trade executor
  stop() {
    this.isRunning = false;
    console.log('Trade executor stopped');
    return { success: true, message: 'Trade executor stopped' };
  }

  // Add a user to the trading queue
  addTradingJob(userWalletAddress, settings = {}) {
    // Default settings
    const defaultSettings = {
      strategy: 'default',
      tradeSize: 10, // Default trade size in USD
      maxTrades: 10, // Maximum number of trades per day
      tradingPairs: ['SOL/USDC', 'ETH/USDC', 'BTC/USDC', 'BONK/USDC', 'JUP/USDC'],
      stopLoss: 5, // 5% stop loss
      takeProfit: 10, // 10% take profit
      tradeInterval: this.tradingInterval // Use default interval
    };
    
    // Merge with user settings
    const mergedSettings = { ...defaultSettings, ...settings };
    
    // Add to trading jobs
    this.tradingJobs[userWalletAddress] = {
      settings: mergedSettings,
      lastTradeTime: 0,
      active: true,
      trades: 0,
      dailyProfit: 0
    };
    
    console.log(`Trading job added for ${userWalletAddress}`);
    return { success: true, message: 'Trading job added', settings: mergedSettings };
  }

  // Remove a user from the trading queue
  removeTradingJob(userWalletAddress) {
    if (this.tradingJobs[userWalletAddress]) {
      delete this.tradingJobs[userWalletAddress];
      console.log(`Trading job removed for ${userWalletAddress}`);
      return { success: true, message: 'Trading job removed' };
    }
    
    return { success: false, message: 'Trading job not found' };
  }

  // Process all trading jobs
  async processTradingJobs() {
    if (!this.isRunning) return;
    
    console.log('Processing trading jobs');
    const now = Date.now();
    
    // Process each job
    for (const [userWalletAddress, job] of Object.entries(this.tradingJobs)) {
      if (!job.active) continue;
      
      // Check if enough time has passed since last trade
      if (now - job.lastTradeTime < job.settings.tradeInterval) continue;
      
      // Check if max trades reached
      if (job.trades >= job.settings.maxTrades) continue;
      
      try {
        // Get user balance
        const balanceInfo = await walletManager.getUserBalance(userWalletAddress);
        if (!balanceInfo.success || balanceInfo.balance.available < job.settings.tradeSize) {
          console.log(`Insufficient balance for ${userWalletAddress}`);
          continue;
        }
        
        // Execute trade based on strategy
        const strategy = this.tradingStrategies[job.settings.strategy] || this.defaultStrategy;
        const tradeResult = await strategy.call(this, userWalletAddress, job);
        
        if (tradeResult.success) {
          // Update job stats
          job.lastTradeTime = now;
          job.trades++;
          job.dailyProfit += tradeResult.profit;
          
          console.log(`Trade executed for ${userWalletAddress}: ${tradeResult.fromToken} -> ${tradeResult.toToken}, profit: ${tradeResult.profit}`);
        }
      } catch (error) {
        console.error(`Error processing trading job for ${userWalletAddress}:`, error);
      }
    }
    
    // Schedule next processing
    setTimeout(() => this.processTradingJobs(), 5000); // Check every 5 seconds
  }

  // Default trading strategy
  async defaultStrategy(userWalletAddress, job) {
    try {
      // Select random trading pair
      const { tradingPairs, tradeSize } = job.settings;
      const randomPairIndex = Math.floor(Math.random() * tradingPairs.length);
      const pair = tradingPairs[randomPairIndex];
      const [fromToken, toToken] = pair.split('/');
      
      // Execute trade
      return await walletManager.executeTrade(userWalletAddress, fromToken, toToken, tradeSize);
    } catch (error) {
      console.error('Error in default strategy:', error);
      return { success: false, message: 'Strategy execution failed' };
    }
  }

  // Conservative trading strategy
  async conservativeStrategy(userWalletAddress, job) {
    try {
      // Select stable pairs
      const stablePairs = ['USDC/USDT', 'SOL/USDC', 'ETH/USDC'];
      const randomPairIndex = Math.floor(Math.random() * stablePairs.length);
      const pair = stablePairs[randomPairIndex];
      const [fromToken, toToken] = pair.split('/');
      
      // Execute trade with smaller size
      const tradeSize = job.settings.tradeSize * 0.7; // 70% of default size
      
      return await walletManager.executeTrade(userWalletAddress, fromToken, toToken, tradeSize);
    } catch (error) {
      console.error('Error in conservative strategy:', error);
      return { success: false, message: 'Strategy execution failed' };
    }
  }

  // Aggressive trading strategy
  async aggressiveStrategy(userWalletAddress, job) {
    try {
      // Select volatile pairs for higher returns
      const volatilePairs = ['BONK/USDC', 'SAMO/USDC', 'JUP/USDC', 'RAY/USDC'];
      const randomPairIndex = Math.floor(Math.random() * volatilePairs.length);
      const pair = volatilePairs[randomPairIndex];
      const [fromToken, toToken] = pair.split('/');
      
      // Execute trade with larger size
      const tradeSize = job.settings.tradeSize * 1.5; // 150% of default size
      
      return await walletManager.executeTrade(userWalletAddress, fromToken, toToken, tradeSize);
    } catch (error) {
      console.error('Error in aggressive strategy:', error);
      return { success: false, message: 'Strategy execution failed' };
    }
  }

  // Get trading status for a user
  getTradingStatus(userWalletAddress) {
    if (!this.tradingJobs[userWalletAddress]) {
      return {
        success: false,
        message: 'No active trading job'
      };
    }
    
    const job = this.tradingJobs[userWalletAddress];
    return {
      success: true,
      active: job.active,
      trades: job.trades,
      dailyProfit: job.dailyProfit,
      lastTradeTime: job.lastTradeTime,
      settings: job.settings
    };
  }

  // Update trading settings for a user
  updateTradingSettings(userWalletAddress, newSettings) {
    if (!this.tradingJobs[userWalletAddress]) {
      return {
        success: false,
        message: 'No active trading job'
      };
    }
    
    // Update settings
    this.tradingJobs[userWalletAddress].settings = {
      ...this.tradingJobs[userWalletAddress].settings,
      ...newSettings
    };
    
    return {
      success: true,
      message: 'Trading settings updated',
      settings: this.tradingJobs[userWalletAddress].settings
    };
  }
}

module.exports = new TradeExecutor(); 