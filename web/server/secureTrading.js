/**
 * Secure Trading Module for Soul-Bot
 * Handles secure transaction creation, signing, and submission
 * with proper error handling and security practices
 */

const axios = require('axios');
const { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  sendAndConfirmTransaction,
  sendAndConfirmRawTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const bs58 = require('bs58');
const nacl = require('tweetnacl');
const crypto = require('crypto');
const winston = require('winston');

// If in a Node.js environment, load environment variables
if (typeof process !== 'undefined') {
  require('dotenv').config();
}

// Setup logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: 'logs/secure-trading.log'
    })
  ]
});

class SecureTrading {
  constructor(config = {}) {
    // Configuration
    this.config = {
      rpcEndpoint: config.rpcEndpoint || process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      jupiterApiBaseUrl: config.jupiterApiBaseUrl || 'https://quote-api.jup.ag/v6',
      slippageBps: config.slippageBps || parseInt(process.env.SLIPPAGE_BPS) || 50,
      priorityFeeLamports: config.priorityFeeLamports || parseInt(process.env.PRIORITY_FEE_LAMPORTS) || 10000,
      minBalanceSOL: config.minBalanceSOL || parseFloat(process.env.MIN_SOL_BALANCE) || 0.05,
      confirmationCommitment: config.confirmationCommitment || 'confirmed',
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000, // ms
      encryptionKey: config.encryptionKey || process.env.ENCRYPTION_KEY || null,
      enableAutomaticSigning: config.enableAutomaticSigning !== undefined ? 
        config.enableAutomaticSigning : process.env.ENABLE_AUTOMATIC_SIGNING === 'true'
    };

    // Connect to Solana network
    this.connection = new Connection(this.config.rpcEndpoint, this.config.confirmationCommitment);
    
    // Wallet management
    this.keyPair = null;
    this.publicKey = null;
    this.encryptedPrivateKey = config.encryptedPrivateKey || process.env.ENCRYPTED_PRIVATE_KEY || null;
    
    // Security checks
    this.initialized = false;
    
    logger.info(`SecureTrading initialized with endpoint: ${this.config.rpcEndpoint}`);
    logger.info(`Automatic signing is ${this.config.enableAutomaticSigning ? 'enabled' : 'disabled'}`);
    
    // Initialize wallet if encrypted key and encryption key are provided
    if (this.config.enableAutomaticSigning && this.encryptedPrivateKey && this.config.encryptionKey) {
      this.initializeWallet()
        .then(success => {
          if (success) {
            logger.info(`Wallet initialized with public key: ${this.publicKey.toString()}`);
          } else {
            logger.error('Failed to initialize wallet.');
          }
        })
        .catch(error => {
          logger.error(`Error initializing wallet: ${error.message}`);
        });
    }
  }

  /**
   * Securely initializes the wallet from encrypted private key
   * @returns {Promise<boolean>} Success status
   */
  async initializeWallet() {
    try {
      if (!this.encryptedPrivateKey || !this.config.encryptionKey) {
        logger.warn('Missing encrypted private key or encryption key.');
        return false;
      }

      // Decrypt the private key
      const privateKeyBytes = this.decryptPrivateKey(this.encryptedPrivateKey, this.config.encryptionKey);
      if (!privateKeyBytes) {
        logger.error('Failed to decrypt private key.');
        return false;
      }

      // Create Solana keypair from private key
      this.keyPair = Keypair.fromSecretKey(privateKeyBytes);
      this.publicKey = this.keyPair.publicKey;
      
      // Verify the wallet has sufficient SOL
      const balance = await this.getWalletBalance();
      if (balance < this.config.minBalanceSOL) {
        logger.warn(`Wallet balance (${balance} SOL) is below minimum threshold (${this.config.minBalanceSOL} SOL).`);
      }
      
      this.initialized = true;
      return true;
    } catch (error) {
      logger.error(`Error initializing wallet: ${error.message}`);
      this.keyPair = null;
      this.publicKey = null;
      this.initialized = false;
      return false;
    }
  }

  /**
   * Decrypts an encrypted private key
   * @param {string} encryptedPrivateKey - Base64 encoded encrypted private key
   * @param {string} encryptionKey - Encryption key
   * @returns {Uint8Array|null} Decrypted private key bytes or null on failure
   */
  decryptPrivateKey(encryptedPrivateKey, encryptionKey) {
    try {
      // Convert the encryption key to a fixed-length key using SHA-256
      const key = crypto.createHash('sha256').update(encryptionKey).digest();
      
      // Parse the encrypted data
      const encryptedData = Buffer.from(encryptedPrivateKey, 'base64');
      const iv = encryptedData.slice(0, 16);
      const encryptedPrivateKeyData = encryptedData.slice(16);
      
      // Create decipher
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      
      // Decrypt
      let decrypted = decipher.update(encryptedPrivateKeyData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      // Convert to private key bytes
      return Uint8Array.from(bs58.decode(decrypted.toString()));
    } catch (error) {
      logger.error(`Error decrypting private key: ${error.message}`);
      return null;
    }
  }

  /**
   * Encrypts a private key
   * @param {string} privateKeyBase58 - Private key in Base58 format
   * @param {string} encryptionKey - Encryption key
   * @returns {string|null} Base64 encoded encrypted private key or null on failure
   */
  encryptPrivateKey(privateKeyBase58, encryptionKey) {
    try {
      // Convert the encryption key to a fixed-length key using SHA-256
      const key = crypto.createHash('sha256').update(encryptionKey).digest();
      
      // Generate random initialization vector
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      
      // Encrypt
      let encrypted = cipher.update(privateKeyBase58, 'utf8', 'base64');
      encrypted = Buffer.from(encrypted + cipher.final('base64'), 'base64');
      
      // Combine IV and encrypted data
      const result = Buffer.concat([iv, encrypted]);
      
      return result.toString('base64');
    } catch (error) {
      logger.error(`Error encrypting private key: ${error.message}`);
      return null;
    }
  }

  /**
   * Gets the wallet balance in SOL
   * @returns {Promise<number>} Balance in SOL
   */
  async getWalletBalance() {
    try {
      if (!this.publicKey) {
        logger.error('Cannot get balance: Wallet not initialized.');
        return 0;
      }
      
      const balance = await this.connection.getBalance(this.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      logger.error(`Error getting wallet balance: ${error.message}`);
      return 0;
    }
  }

  /**
   * Simulates a transaction to estimate fees and check for errors
   * @param {Transaction} transaction - The transaction to simulate
   * @returns {Promise<object>} Simulation results
   */
  async simulateTransaction(transaction) {
    try {
      // Set recent blockhash if not already set
      if (!transaction.recentBlockhash) {
        const { blockhash } = await this.connection.getLatestBlockhash(this.config.confirmationCommitment);
        transaction.recentBlockhash = blockhash;
      }
      
      // Simulate transaction
      const simulation = await this.connection.simulateTransaction(transaction);
      return simulation;
    } catch (error) {
      logger.error(`Error simulating transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Creates and sends a transaction using Jupiter API and the wallet's private key
   * @param {object} quoteResponse - The quote response from Jupiter API
   * @returns {Promise<object>} Transaction result
   */
  async createAndSendTransaction(quoteResponse) {
    if (!this.initialized || !this.keyPair) {
      throw new Error('Wallet not initialized for transaction signing.');
    }
    
    if (!this.config.enableAutomaticSigning) {
      throw new Error('Automatic transaction signing is disabled. Use client-side signing instead.');
    }
    
    try {
      // 1. Get swap instructions from Jupiter API
      const swapInstructions = await this.getSwapInstructions(quoteResponse, this.publicKey.toString());
      if (!swapInstructions) {
        throw new Error('Failed to get swap instructions from Jupiter API.');
      }
      
      // 2. Create transaction from instructions
      const { blockhash } = await this.connection.getLatestBlockhash(this.config.confirmationCommitment);
      const transaction = Transaction.from(Buffer.from(swapInstructions.swapTransaction, 'base64'));
      
      // 3. Simulate transaction to check for errors and get fee estimate
      const simulationResult = await this.simulateTransaction(transaction);
      if (simulationResult.value.err) {
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulationResult.value.err)}`);
      }
      
      // 4. Sign transaction with private key
      transaction.sign(this.keyPair);
      
      // 5. Send and confirm transaction
      const signature = await sendAndConfirmRawTransaction(
        this.connection,
        transaction.serialize(),
        { commitment: this.config.confirmationCommitment }
      );
      
      logger.info(`Transaction sent successfully: ${signature}`);
      
      // 6. Return transaction details
      return {
        success: true,
        signature,
        inputAmount: quoteResponse.inputAmount,
        outputAmount: quoteResponse.outAmount,
        executionTime: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error creating and sending transaction: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Gets swap instructions from Jupiter API
   * @param {object} quoteResponse - The quote response from Jupiter API
   * @param {string} userPublicKey - The public key of the user
   * @returns {Promise<object|null>} Swap instructions or null on failure
   */
  async getSwapInstructions(quoteResponse, userPublicKey) {
    if (!quoteResponse || !userPublicKey) {
      logger.error('Invalid parameters for getSwapInstructions');
      return null;
    }

    try {
      const url = `${this.config.jupiterApiBaseUrl}/swap-instructions`;
      const data = {
        quoteResponse: quoteResponse,
        userPublicKey: userPublicKey,
        computeUnitPriceMicroLamports: 100000 // 0.0001 SOL per compute unit, adjust as needed
      };

      logger.info(`Fetching swap instructions for: ${userPublicKey}`);

      const response = await axios.post(url, data, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.status === 200 && response.data) {
        logger.info('Swap instructions received successfully');
        return response.data;
      } else {
        logger.warn(`Failed to get swap instructions. Status: ${response.status}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error fetching swap instructions: ${error.response ? error.response.data : error.message}`);
      return null;
    }
  }
  
  /**
   * Creates an encrypted private key from a plaintext private key
   * @param {string} privateKeyBase58 - Private key in Base58 format
   * @param {string} encryptionKey - Key to use for encryption
   * @returns {object} Object containing public key and encrypted private key
   */
  createEncryptedKey(privateKeyBase58, encryptionKey) {
    try {
      if (!privateKeyBase58 || !encryptionKey) {
        throw new Error('Private key and encryption key are required');
      }
      
      // Create keypair from private key
      const keyPair = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
      const publicKey = keyPair.publicKey.toString();
      
      // Encrypt the private key
      const encryptedPrivateKey = this.encryptPrivateKey(privateKeyBase58, encryptionKey);
      
      if (!encryptedPrivateKey) {
        throw new Error('Failed to encrypt private key');
      }
      
      return {
        publicKey,
        encryptedPrivateKey
      };
    } catch (error) {
      logger.error(`Error creating encrypted key: ${error.message}`);
      throw error;
    }
  }
}

module.exports = SecureTrading; 