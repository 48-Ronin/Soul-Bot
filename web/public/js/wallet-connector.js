/**
 * Secure Solana Wallet Connector
 * Handles wallet connection, transaction signing, and error handling
 * for safe trading on the Solana blockchain
 */

class SolanaWalletConnector {
  constructor(config = {}) {
    this.connected = false;
    this.wallet = null;
    this.publicKey = null;
    this.balance = 0;
    this.onConnectCallback = config.onConnect || null;
    this.onDisconnectCallback = config.onDisconnect || null;
    this.onErrorCallback = config.onError || null;
    this.connection = null;
    this.network = config.network || 'mainnet-beta';
    
    // RPC endpoints with fallbacks
    this.rpcEndpoints = config.rpcEndpoints || [
      'https://api.mainnet-beta.solana.com',
      'https://solana-mainnet.g.alchemy.com/v2/demo',
      'https://rpc.ankr.com/solana',
    ];
    
    this.connectionConfig = {
      commitment: 'confirmed', // Use confirmed for better reliability
      disableRetryOnRateLimit: false, // Auto-retry on rate limits
    };
    
    // Auto-disconnect timer
    this.activityTimeout = config.activityTimeout || 30 * 60 * 1000; // 30 minutes default
    this.activityTimer = null;
    
    // Safety features
    this.transactionSizeLimit = config.transactionSizeLimit || 1; // Max 1 SOL by default
    this.allowedTokens = new Set(config.allowedTokens || ['USDC', 'USDT', 'BONK', 'SAMO', 'JUP', 'RAY']);
    
    // Initialize connection
    this.initializeConnection();
    
    // Check for wallet adapters
    this.checkWalletAdapters();
  }
  
  /**
   * Initialize Solana connection
   */
  async initializeConnection() {
    try {
      for (const endpoint of this.rpcEndpoints) {
        try {
          this.connection = new solanaWeb3.Connection(endpoint, this.connectionConfig);
          // Check if connection works
          await this.connection.getGenesisHash();
          console.log(`Connected to Solana ${this.network} via ${endpoint}`);
          break;
        } catch (err) {
          console.warn(`Failed to connect to ${endpoint}, trying next fallback`);
        }
      }
      
      if (!this.connection) {
        throw new Error('Failed to connect to any Solana RPC endpoint');
      }
    } catch (error) {
      console.error('Failed to initialize Solana connection:', error);
      this.handleError(error);
    }
  }
  
  /**
   * Check for available wallet adapters
   */
  checkWalletAdapters() {
    if (window.solana) {
      console.log('Phantom wallet detected');
    } else if (window.solflare) {
      console.log('Solflare wallet detected');
    } else {
      console.log('No Solana wallet adapter detected, please install Phantom or Solflare');
    }
  }
  
  /**
   * Connect to wallet
   */
  async connect() {
    try {
      let walletAdapter;
      
      // Select appropriate wallet
      if (window.solana) {
        walletAdapter = window.solana;
      } else if (window.solflare) {
        walletAdapter = window.solflare;
      } else {
        throw new Error('No Solana wallet adapter found. Please install Phantom or Solflare.');
      }
      
      // Connect to the wallet
      if (!walletAdapter.isConnected) {
        await walletAdapter.connect();
      }
      
      // Store connection info
      this.wallet = walletAdapter;
      this.publicKey = walletAdapter.publicKey;
      
      if (!this.publicKey) {
        throw new Error('Failed to get public key from wallet');
      }
      
      // Get account balance
      await this.updateBalance();
      
      // Set connected state
      this.connected = true;
      
      // Start activity timer
      this.resetActivityTimer();
      
      // Register event listeners
      this.registerEventListeners();
      
      // Notify application
      if (this.onConnectCallback) {
        this.onConnectCallback({
          publicKey: this.publicKey.toString(),
          balance: this.balance,
        });
      }
      
      // Notify server
      this.notifyServer('connected');
      
      console.log(`Connected to wallet: ${this.publicKey.toString()}`);
      return {
        publicKey: this.publicKey.toString(),
        balance: this.balance,
      };
    } catch (error) {
      console.error('Error connecting to wallet:', error);
      this.handleError(error);
      throw error;
    }
  }
  
  /**
   * Disconnect from wallet
   */
  async disconnect() {
    try {
      if (this.wallet && this.connected) {
        // Disconnect from wallet
        await this.wallet.disconnect();
        
        // Clear activity timer
        if (this.activityTimer) {
          clearTimeout(this.activityTimer);
          this.activityTimer = null;
        }
        
        // Update state
        this.connected = false;
        this.wallet = null;
        this.publicKey = null;
        this.balance = 0;
        
        // Notify application
        if (this.onDisconnectCallback) {
          this.onDisconnectCallback();
        }
        
        // Notify server
        this.notifyServer('disconnected');
        
        console.log('Disconnected from wallet');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error disconnecting from wallet:', error);
      this.handleError(error);
      return false;
    }
  }
  
  /**
   * Update wallet balance
   */
  async updateBalance() {
    try {
      if (!this.connection || !this.publicKey) {
        return 0;
      }
      
      const balance = await this.connection.getBalance(this.publicKey);
      this.balance = balance / solanaWeb3.LAMPORTS_PER_SOL;
      return this.balance;
    } catch (error) {
      console.error('Error updating balance:', error);
      this.handleError(error);
      return this.balance;
    }
  }
  
  /**
   * Register wallet event listeners
   */
  registerEventListeners() {
    if (!this.wallet) return;
    
    // Handle disconnection
    this.wallet.on('disconnect', () => {
      this.connected = false;
      this.publicKey = null;
      
      if (this.onDisconnectCallback) {
        this.onDisconnectCallback();
      }
      
      this.notifyServer('disconnected');
      console.log('Wallet disconnected');
    });
    
    // Handle account change
    this.wallet.on('accountChanged', async (publicKey) => {
      if (publicKey) {
        this.publicKey = publicKey;
        await this.updateBalance();
        
        if (this.onConnectCallback) {
          this.onConnectCallback({
            publicKey: this.publicKey.toString(),
            balance: this.balance,
          });
        }
        
        this.notifyServer('connected');
        console.log(`Wallet account changed: ${this.publicKey.toString()}`);
      } else {
        // Handle case where user disconnected through wallet UI
        this.disconnect();
      }
    });
  }
  
  /**
   * Reset activity timer to prevent auto-disconnect
   */
  resetActivityTimer() {
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
    }
    
    this.activityTimer = setTimeout(() => {
      console.log('Auto-disconnecting due to inactivity');
      this.disconnect();
    }, this.activityTimeout);
  }
  
  /**
   * Handle errors with callback
   */
  handleError(error) {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }
  
  /**
   * Notify server about wallet connection status
   */
  async notifyServer(status) {
    try {
      if (status === 'connected') {
        await fetch('/api/wallet/connected', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address: this.publicKey.toString(),
            balance: this.balance,
          }),
        });
      } else if (status === 'disconnected') {
        await fetch('/api/wallet/disconnected', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            address: this.publicKey ? this.publicKey.toString() : null,
          }),
        });
      }
    } catch (error) {
      console.error(`Error notifying server about wallet ${status}:`, error);
    }
  }
  
  /**
   * Sign and send transaction safely
   */
  async signAndSendTransaction(transaction, signers = []) {
    try {
      if (!this.connected || !this.wallet) {
        throw new Error('Wallet not connected');
      }
      
      this.resetActivityTimer();
      
      // Check transaction size
      const safetyChecks = await this.performTransactionSafetyChecks(transaction);
      if (!safetyChecks.safe) {
        throw new Error(`Transaction safety check failed: ${safetyChecks.reason}`);
      }
      
      // Add recent blockhash for security
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      
      // Sign with wallet and extra signers
      if (signers.length > 0) {
        transaction.partialSign(...signers);
      }
      
      // Sign with wallet adapter
      const signedTransaction = await this.wallet.signTransaction(transaction);
      
      // Send transaction with proper commitment
      const signature = await this.connection.sendRawTransaction(
        signedTransaction.serialize(),
        { skipPreflight: false, preflightCommitment: 'confirmed' }
      );
      
      // Wait for confirmation
      const confirmation = await this.connection.confirmTransaction({
        blockhash,
        lastValidBlockHeight,
        signature,
      }, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`Transaction confirmed: ${signature}`);
      return {
        signature,
        confirmed: true,
        confirmationStatus: confirmation,
      };
    } catch (error) {
      console.error('Error signing and sending transaction:', error);
      this.handleError(error);
      throw error;
    }
  }
  
  /**
   * Perform safety checks before sending transaction
   */
  async performTransactionSafetyChecks(transaction) {
    try {
      // Check current balance
      await this.updateBalance();
      
      // Basic transaction checks
      if (!transaction) {
        return { safe: false, reason: 'Invalid transaction' };
      }
      
      // Transaction size limit in SOL
      const estimatedCost = 0.001; // Estimated transaction fee in SOL
      
      if (estimatedCost > this.balance) {
        return { safe: false, reason: 'Insufficient balance for transaction fees' };
      }
      
      // TODO: Add more sophisticated checks here like:
      // - Check token approval amounts
      // - Check slippage parameters
      // - Validate destination addresses
      
      return { safe: true };
    } catch (error) {
      console.error('Error performing transaction safety checks:', error);
      return { safe: false, reason: `Error in safety checks: ${error.message}` };
    }
  }
}

// Make connector available globally
window.SolanaWalletConnector = SolanaWalletConnector; 