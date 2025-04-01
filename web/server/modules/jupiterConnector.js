// jupiterConnector.js - Integration with Jupiter DEX for token swaps
const axios = require('axios');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');

class JupiterConnector {
  constructor() {
    this.baseUrl = 'https://quote-api.jup.ag/v6';
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  }

  // Get quote for a token swap
  async getQuote(inputMint, outputMint, amount, slippageBps = 50) {
    try {
      const response = await axios.get(`${this.baseUrl}/quote`, {
        params: {
          inputMint,           // Input token mint address
          outputMint,          // Output token mint address
          amount,              // Amount in lamports or smallest unit
          slippageBps,         // Slippage tolerance in basis points
          onlyDirectRoutes: false,
          asLegacyTransaction: false,
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Error getting Jupiter quote:', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  // Get swap instructions
  async getSwapInstructions(quoteResponse, userPublicKey) {
    try {
      const transactions = await axios.post(`${this.baseUrl}/swap-instructions`, {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
      });

      return {
        success: true,
        data: transactions.data
      };
    } catch (error) {
      console.error('Error getting swap instructions:', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  // Execute a swap with a provided wallet
  async executeSwap(fromToken, toToken, amount, wallet) {
    try {
      console.log(`Preparing swap: ${fromToken} -> ${toToken}, amount: ${amount}`);
      
      // Get token mint addresses (using a simple mapping for demo)
      const tokenMints = {
        'SOL': 'So11111111111111111111111111111111111111112',
        'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      };

      // Convert token symbols to mint addresses
      const inputMint = tokenMints[fromToken] || fromToken;
      const outputMint = tokenMints[toToken] || toToken;

      if (!inputMint || !outputMint) {
        return {
          success: false,
          message: 'Invalid token symbols'
        };
      }

      // Step 1: Get quote
      const quoteResponse = await this.getQuote(inputMint, outputMint, amount);
      if (!quoteResponse.success) {
        return quoteResponse;
      }

      // Step 2: Get swap instructions
      const userPublicKey = wallet.publicKey.toString();
      const swapInstructions = await this.getSwapInstructions(quoteResponse.data, userPublicKey);
      if (!swapInstructions.success) {
        return swapInstructions;
      }

      // Step 3: Deserialize and sign the transaction
      const swapTransaction = Transaction.from(
        Buffer.from(swapInstructions.data.swapTransaction, 'base64')
      );

      // Step 4: Send and confirm transaction
      const signature = await this.connection.sendTransaction(swapTransaction, [wallet]);
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        success: true,
        signature,
        inAmount: quoteResponse.data.inAmount,
        outAmount: quoteResponse.data.outAmount,
        fromToken,
        toToken,
        message: 'Swap executed successfully'
      };
    } catch (error) {
      console.error('Error executing Jupiter swap:', error);
      return {
        success: false,
        message: `Swap failed: ${error.message}`
      };
    }
  }

  // Get token info
  async getTokenList() {
    try {
      const response = await axios.get('https://token.jup.ag/strict');
      return {
        success: true,
        tokens: response.data
      };
    } catch (error) {
      console.error('Error getting token list:', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = new JupiterConnector(); 