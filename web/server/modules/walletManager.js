// walletManager.js - Secure wallet management for automated trading
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Constants
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'server_wallet_default_encryption_key'; // Should be set in environment
const DATA_DIR = path.join(__dirname, '../data');
const WALLETS_FILE = path.join(DATA_DIR, 'trading_wallets.json');
const USER_BALANCES_FILE = path.join(DATA_DIR, 'user_balances.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
if (!fs.existsSync(WALLETS_FILE)) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(USER_BALANCES_FILE)) {
  fs.writeFileSync(USER_BALANCES_FILE, JSON.stringify({}, null, 2));
}

class WalletManager {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.tradingWallets = this.loadWallets();
    this.userBalances = this.loadUserBalances();
  }

  // Load encrypted wallets
  loadWallets() {
    try {
      const data = fs.readFileSync(WALLETS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading wallets:', error);
      return {};
    }
  }

  // Load user balances
  loadUserBalances() {
    try {
      const data = fs.readFileSync(USER_BALANCES_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading user balances:', error);
      return {};
    }
  }

  // Save encrypted wallets
  saveWallets() {
    try {
      fs.writeFileSync(WALLETS_FILE, JSON.stringify(this.tradingWallets, null, 2));
    } catch (error) {
      console.error('Error saving wallets:', error);
    }
  }

  // Save user balances
  saveUserBalances() {
    try {
      fs.writeFileSync(USER_BALANCES_FILE, JSON.stringify(this.userBalances, null, 2));
    } catch (error) {
      console.error('Error saving user balances:', error);
    }
  }

  // Encrypt private key
  encryptPrivateKey(privateKey) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
      let encrypted = cipher.update(Buffer.from(privateKey));
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      return { iv: iv.toString('hex'), encryptedData: encrypted.toString('hex') };
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt private key');
    }
  }

  // Decrypt private key
  decryptPrivateKey(encryptedData, iv) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), Buffer.from(iv, 'hex'));
      let decrypted = decipher.update(Buffer.from(encryptedData, 'hex'));
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt private key');
    }
  }

  // Create a new trading wallet for a user
  createTradingWallet(userWalletAddress) {
    try {
      // Check if user already has a trading wallet
      if (this.tradingWallets[userWalletAddress]) {
        return {
          success: true,
          publicKey: this.tradingWallets[userWalletAddress].publicKey,
          message: 'Trading wallet already exists'
        };
      }

      // Generate new keypair
      const newWallet = Keypair.generate();
      const publicKey = newWallet.publicKey.toString();
      
      // Encrypt private key
      const encryptedKey = this.encryptPrivateKey(Buffer.from(newWallet.secretKey).toString('hex'));
      
      // Store wallet info
      this.tradingWallets[userWalletAddress] = {
        publicKey,
        encryptedKey: encryptedKey.encryptedData,
        iv: encryptedKey.iv,
        created: new Date().toISOString()
      };
      
      // Initialize user balance
      if (!this.userBalances[userWalletAddress]) {
        this.userBalances[userWalletAddress] = {
          deposited: 0,
          available: 0,
          locked: 0,
          trades: []
        };
      }
      
      // Save changes
      this.saveWallets();
      this.saveUserBalances();
      
      return {
        success: true,
        publicKey,
        message: 'New trading wallet created'
      };
    } catch (error) {
      console.error('Error creating trading wallet:', error);
      return {
        success: false,
        message: 'Failed to create trading wallet'
      };
    }
  }

  // Get trading wallet keypair for a user
  async getTradingWallet(userWalletAddress) {
    try {
      const walletInfo = this.tradingWallets[userWalletAddress];
      if (!walletInfo) {
        throw new Error('Trading wallet not found');
      }
      
      // Decrypt private key
      const decryptedKey = this.decryptPrivateKey(walletInfo.encryptedKey, walletInfo.iv);
      
      // Convert hex to Uint8Array
      const secretKey = new Uint8Array(Buffer.from(decryptedKey.toString(), 'hex'));
      
      // Create keypair
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      console.error('Error getting trading wallet:', error);
      throw new Error('Failed to access trading wallet');
    }
  }

  // Process a deposit from user wallet to trading wallet
  async processDeposit(userWalletAddress, amount, signature) {
    try {
      // Verify the transaction on-chain
      const transaction = await this.connection.getTransaction(signature, {
        commitment: 'confirmed'
      });
      
      if (!transaction) {
        return {
          success: false,
          message: 'Transaction not found'
        };
      }
      
      // Get trading wallet info
      const walletInfo = this.tradingWallets[userWalletAddress];
      if (!walletInfo) {
        return {
          success: false,
          message: 'Trading wallet not found'
        };
      }
      
      // Verify transaction is a transfer to the trading wallet
      // In a real implementation, you would check transaction instruction details
      
      // Update user balance
      this.userBalances[userWalletAddress].deposited += amount;
      this.userBalances[userWalletAddress].available += amount;
      
      // Add deposit to transaction history
      this.userBalances[userWalletAddress].trades.push({
        type: 'deposit',
        amount,
        signature,
        timestamp: new Date().toISOString()
      });
      
      // Save changes
      this.saveUserBalances();
      
      return {
        success: true,
        message: 'Deposit processed successfully',
        balance: {
          deposited: this.userBalances[userWalletAddress].deposited,
          available: this.userBalances[userWalletAddress].available
        }
      };
    } catch (error) {
      console.error('Error processing deposit:', error);
      return {
        success: false,
        message: 'Failed to process deposit'
      };
    }
  }

  // Execute a trade using the trading wallet
  async executeTrade(userWalletAddress, fromToken, toToken, amount) {
    try {
      // Check if user has enough balance
      const userBalance = this.userBalances[userWalletAddress];
      if (!userBalance || userBalance.available < amount) {
        return {
          success: false,
          message: 'Insufficient balance'
        };
      }
      
      // Get trading wallet
      const tradingWallet = await this.getTradingWallet(userWalletAddress);
      
      // In a real implementation, you would:
      // 1. Create instructions for token swap using Jupiter SDK or similar
      // 2. Build the transaction
      // 3. Sign with trading wallet
      // 4. Submit to blockchain
      
      // Simulate a successful trade
      const expectedOutput = amount * 1.02; // 2% profit (in real implementation this would be actual swap result)
      const signature = 'simulated_transaction_' + Date.now();
      
      // Update user balance
      userBalance.available = userBalance.available - amount + expectedOutput;
      
      // Add trade to history
      userBalance.trades.push({
        type: 'trade',
        fromToken,
        toToken,
        amountIn: amount,
        amountOut: expectedOutput,
        profit: expectedOutput - amount,
        signature,
        timestamp: new Date().toISOString()
      });
      
      // Save changes
      this.saveUserBalances();
      
      return {
        success: true,
        message: 'Trade executed successfully',
        signature,
        fromToken,
        toToken,
        amountIn: amount,
        amountOut: expectedOutput,
        profit: expectedOutput - amount
      };
    } catch (error) {
      console.error('Error executing trade:', error);
      return {
        success: false,
        message: 'Failed to execute trade'
      };
    }
  }

  // Process a withdrawal from trading wallet to user wallet
  async processWithdrawal(userWalletAddress, amount) {
    try {
      // Check if user has enough balance
      const userBalance = this.userBalances[userWalletAddress];
      if (!userBalance || userBalance.available < amount) {
        return {
          success: false,
          message: 'Insufficient balance'
        };
      }
      
      // Get trading wallet
      const tradingWallet = await this.getTradingWallet(userWalletAddress);
      
      // In a real implementation, you would:
      // 1. Create a transaction to transfer tokens back to user wallet
      // 2. Sign with trading wallet
      // 3. Submit to blockchain
      
      // Simulate a successful withdrawal
      const signature = 'simulated_withdrawal_' + Date.now();
      
      // Update user balance
      userBalance.available -= amount;
      userBalance.deposited -= amount;
      
      // Add withdrawal to history
      userBalance.trades.push({
        type: 'withdrawal',
        amount,
        signature,
        timestamp: new Date().toISOString()
      });
      
      // Save changes
      this.saveUserBalances();
      
      return {
        success: true,
        message: 'Withdrawal processed successfully',
        signature,
        amount
      };
    } catch (error) {
      console.error('Error processing withdrawal:', error);
      return {
        success: false,
        message: 'Failed to process withdrawal'
      };
    }
  }

  // Get user balance and trading history
  getUserBalance(userWalletAddress) {
    const balance = this.userBalances[userWalletAddress];
    if (!balance) {
      return {
        success: false,
        message: 'User not found'
      };
    }
    
    return {
      success: true,
      balance: {
        deposited: balance.deposited,
        available: balance.available,
        locked: balance.locked
      },
      trades: balance.trades
    };
  }

  // Start automated trading for a user
  async startAutomatedTrading(userWalletAddress, settings = {}) {
    try {
      // Get user balance
      const userBalance = this.userBalances[userWalletAddress];
      if (!userBalance || userBalance.available <= 0) {
        return {
          success: false,
          message: 'Insufficient balance for trading'
        };
      }
      
      // In a real implementation, you would:
      // 1. Store trading settings
      // 2. Start a trading bot or add user to trading queue
      
      return {
        success: true,
        message: 'Automated trading started',
        settings
      };
    } catch (error) {
      console.error('Error starting automated trading:', error);
      return {
        success: false,
        message: 'Failed to start automated trading'
      };
    }
  }

  // Stop automated trading for a user
  async stopAutomatedTrading(userWalletAddress) {
    try {
      // In a real implementation, you would:
      // 1. Stop the trading bot or remove user from trading queue
      
      return {
        success: true,
        message: 'Automated trading stopped'
      };
    } catch (error) {
      console.error('Error stopping automated trading:', error);
      return {
        success: false,
        message: 'Failed to stop automated trading'
      };
    }
  }
}

module.exports = new WalletManager(); 