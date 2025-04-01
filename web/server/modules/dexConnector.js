const axios = require('axios');
const SecureTrading = require('./secureTrading');

// Jupiter API V6 Endpoints
const JUPITER_API_BASE_URL = 'https://quote-api.jup.ag/v6';

class DexConnector {
  constructor(config = {}) {
    this.connected = true; // Assume connected if class is instantiated
    this.jupiterApiKey = config.apiKey || process.env.JUPITER_API_KEY; // Optional API key for higher rate limits
    this.minProfitThreshold = config.minProfitThreshold || 0.5; // Default 0.5%
    this.slippageBps = config.slippageBps || 50; // Default 50 bps (0.5%)
    this.priorityFeeLamports = config.priorityFeeLamports || 10000; // Default priority fee
    this.tokenListCache = null; // Cache for Jupiter token list
    this.tokenListLastUpdated = 0;
    this.priceCache = new Map(); // Simple cache for token prices
    this.priceCacheTTL = 60 * 1000; // Cache prices for 60 seconds
    
    // Helius Configuration - Use explicitly passed config first, then environment vars
    this.heliusApiKey = config.heliusApiKey || process.env.HELIUS_API_KEY || '8d7f2c65-f029-45c5-9aa8-de2dfb41078f';
    this.heliusRpcUrl = config.heliusRpcUrl || process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com';
    this.heliusConfigured = !!this.heliusApiKey; // If we have an API key, we're configured

    // Initialize the secure trading module for live trading
    this.secureTrading = new SecureTrading({
      slippageBps: this.slippageBps,
      priorityFeeLamports: this.priorityFeeLamports,
      enableAutomaticSigning: config.enableAutomaticSigning !== undefined ? 
        config.enableAutomaticSigning : process.env.ENABLE_AUTOMATIC_SIGNING === 'true'
    });

    console.log('DexConnector initialized with Jupiter V6 API');
    if (this.heliusConfigured) {
      console.log(`Helius API configured: Using ${this.heliusRpcUrl}`);
    } else {
      console.log('Helius API not configured. Set HELIUS_API_KEY and HELIUS_RPC_URL environment variables to enable.');
    }
    console.log(`Automatic signing: ${this.secureTrading.config.enableAutomaticSigning ? 'enabled' : 'disabled'}`);
  }

  getStatus() {
    const secureStatus = {
      automaticSigning: this.secureTrading.config.enableAutomaticSigning,
      walletInitialized: this.secureTrading.initialized,
      publicKey: this.secureTrading.publicKey ? this.secureTrading.publicKey.toString() : null
    };
    
    return { 
      connected: this.connected, 
      apiBaseUrl: JUPITER_API_BASE_URL,
      secureTrading: secureStatus
    };
  }

  /**
   * Fetches a quote for a token swap from Jupiter API.
   * @param {string} inputMint - Mint address of the input token.
   * @param {string} outputMint - Mint address of the output token.
   * @param {number} amount - The amount of the input token in its smallest unit (lamports, etc.).
   * @param {number} [slippageBps] - Optional slippage tolerance in basis points.
   * @returns {Promise<object|null>} Quote data object or null if failed.
   */
  async getQuote(inputMint, outputMint, amount, slippageBps) {
    // Check if first parameter is actually an object (misused API pattern)
    if (typeof inputMint === 'object' && inputMint !== null) {
      console.error('getQuote: Parameters passed as a single object instead of individual arguments', inputMint);
      // Extract parameters from the object if possible
      const params = inputMint;
      inputMint = params.inputMint;
      outputMint = params.outputMint || outputMint;
      amount = params.amount || amount;
      slippageBps = params.slippageBps || slippageBps;
    }

    if (!inputMint || !outputMint || !amount || amount <= 0) {
      console.error('getQuote: Invalid parameters provided.', { inputMint, outputMint, amount });
      return null;
    }

    const url = `${JUPITER_API_BASE_URL}/quote`;
    const params = {
      inputMint: inputMint,
      outputMint: outputMint,
      amount: Math.round(amount), // Ensure amount is an integer
      slippageBps: slippageBps || this.slippageBps,
      computeUnitPriceMicroLamports: 100000 // Example: 0.0001 SOL
    };

    console.log(`Fetching Jupiter quote: ${inputMint} -> ${outputMint}, Amount: ${amount}`);

    try {
      const response = await axios.get(url, { params });
      if (response.status === 200 && response.data) {
        console.log(`Quote received successfully for ${inputMint} -> ${outputMint}`);
        // Add input amount to the quote data for easy reference
        response.data.inputAmount = amount; 
        return response.data;
      } else {
        console.warn(`Failed to get quote from Jupiter. Status: ${response.status}`, response.data);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching Jupiter quote (${inputMint} -> ${outputMint}):`, error.response ? error.response.data : error.message);
      return null;
    }
  }

  /**
   * Fetches swap instructions from Jupiter API based on a quote.
   * This prepares the transaction data but does NOT sign or send it.
   * @param {object} quoteResponse - The quote object received from getQuote.
   * @param {string} userPublicKey - The public key of the user's wallet initiating the swap.
   * @returns {Promise<object|null>} Swap instructions object or null if failed.
   */
  async getSwapInstructions(quoteResponse, userPublicKey) {
    if (!quoteResponse || !userPublicKey) {
      console.error('getSwapInstructions: Invalid parameters provided.', { quoteResponse, userPublicKey });
      return null;
    }

    const url = `${JUPITER_API_BASE_URL}/swap-instructions`;
    const data = {
      quoteResponse: quoteResponse,
      userPublicKey: userPublicKey,
      computeUnitPriceMicroLamports: 100000, // Example: 0.0001 SOL
      dynamicComputeUnitLimit: true // Allow dynamic CU limit estimation
    };

    console.log(`Fetching Jupiter swap instructions for user: ${userPublicKey}`);

    try {
      const response = await axios.post(url, data, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.status === 200 && response.data) {
        console.log('Swap instructions received successfully.');
        return response.data; // Contains transaction details needed for signing
      } else {
        console.warn(`Failed to get swap instructions from Jupiter. Status: ${response.status}`, response.data);
        return null;
      }
    } catch (error) {
      console.error('Error fetching Jupiter swap instructions:', error.response ? error.response.data : error.message);
      return null;
    }
  }

  /**
   * Executes a trade with automatic transaction signing
   * @param {object} quoteResponse - Quote from Jupiter API
   * @returns {Promise<object>} Trade result
   */
  async executeTrade(quoteResponse) {
    try {
      console.log('Executing trade with automatic signing...');
      
      if (!this.secureTrading.initialized) {
        console.error('Cannot execute trade: Secure trading not initialized.');
        return {
          success: false,
          error: 'Secure trading not initialized. Check wallet configuration.'
        };
      }
      
      if (!this.secureTrading.config.enableAutomaticSigning) {
        console.error('Cannot execute trade: Automatic signing is disabled.');
        return {
          success: false,
          error: 'Automatic signing is disabled. Enable in configuration or use client-side signing.'
        };
      }
      
      const result = await this.secureTrading.createAndSendTransaction(quoteResponse);
      console.log(`Trade execution result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      
      return {
        ...result,
        quoteDetails: {
          inputAmount: quoteResponse.inputAmount,
          outputAmount: quoteResponse.outAmount,
          inputToken: quoteResponse.inputMint,
          outputToken: quoteResponse.outputMint,
          price: quoteResponse.price,
          priceImpactPct: quoteResponse.priceImpactPct
        }
      };
    } catch (error) {
      console.error('Error executing trade:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fetches and caches the Jupiter token list if needed.
   * @returns {Promise<Array|null>} Cached token list or null if failed.
   */
  async _getOrUpdateTokenListCache() {
    const now = Date.now();
    // Update cache every hour
    if (!this.tokenListCache || now - this.tokenListLastUpdated > 3600 * 1000) {
      console.log('Updating Jupiter token list cache...');
      try {
        const response = await axios.get('https://token.jup.ag/all');
        if (response.status === 200 && Array.isArray(response.data)) {
          this.tokenListCache = response.data;
          this.tokenListLastUpdated = now;
          console.log(`Successfully cached ${this.tokenListCache.length} tokens.`);
        } else {
          console.warn(`Failed to fetch token list. Status: ${response.status}`);
          this.tokenListCache = null; // Invalidate cache on failure
        }
      } catch (error) {
        console.error('Error fetching Jupiter token list:', error.message);
        this.tokenListCache = null; // Invalidate cache on error
      }
    }
    return this.tokenListCache;
  }

  /**
   * Gets the number of decimals for a given token mint address.
   * Uses a cached token list.
   * @param {string} mintAddress - The mint address of the token.
   * @returns {Promise<number|null>} Number of decimals or null if not found.
   */
  async getTokenDecimals(mintAddress) {
    if (!mintAddress) return null;
    
    const tokenList = await this._getOrUpdateTokenListCache();
    if (!tokenList) {
        console.warn(`Could not get token decimals for ${mintAddress}: Token list unavailable.`);
        return null; // Return null if cache is unavailable
    }

    const tokenInfo = tokenList.find(token => token.address === mintAddress);
    if (tokenInfo && tokenInfo.decimals !== undefined) {
      return tokenInfo.decimals;
    } else {
      console.warn(`Could not find decimals for token ${mintAddress} in Jupiter token list.`);
      return null; // Return null if token not found or decimals missing
    }
  }

  /**
   * Gets the current USD price for a given token mint address.
   * Prioritizes Helius API if configured, otherwise falls back to Jupiter API.
   * Includes simple caching.
   * @param {string} mintAddress - The mint address of the token.
   * @returns {Promise<number|null>} USD price or null if failed.
   */
  async getTokenPrice(mintAddress) {
    if (!mintAddress) return null;

    const now = Date.now();
    // Check cache first
    if (this.priceCache.has(mintAddress)) {
      const cached = this.priceCache.get(mintAddress);
      if (now - cached.timestamp < this.priceCacheTTL) {
        // console.log(`Using cached price for ${mintAddress} from ${cached.source}`); // Debug log
        return cached.price;
      }
    }

    let price = null;
    let source = 'Unknown';

    // --- Try Helius First (if configured) ---
    if (this.heliusConfigured) {
      // Make sure URL parameter handling is consistent
      const heliusUrl = this.heliusRpcUrl.includes('?') ? 
        this.heliusRpcUrl : // URL already has parameters
        `${this.heliusRpcUrl}/?api-key=${this.heliusApiKey}`; // Add API key as parameter
        
      console.log(`Fetching price for ${mintAddress} via Helius...`); // Debug log
      try {
        const response = await axios.post(heliusUrl, {
          jsonrpc: '2.0',
          id: 'helius-getAsset-price',
          method: 'getAsset',
          params: {
            id: mintAddress
          },
        }, {
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.status === 200 && response.data && response.data.result) {
          const priceInfo = response.data.result.token_info?.price_info;
          if (priceInfo && priceInfo.price_per_token !== undefined) {
            price = priceInfo.price_per_token;
            source = 'Helius';
            console.log(`Helius price received for ${mintAddress}: ${price}`); // Debug log
          } else {
             console.warn(`Helius response OK but price data missing for ${mintAddress}`);
          }
        } else {
          console.warn(`Failed Helius price request for ${mintAddress}. Status: ${response.status}`, response.data);
        }
      } catch (error) {
        console.error(`Error fetching price from Helius for ${mintAddress}:`, error.response ? error.response.data : error.message);
        // Don't return null yet, allow fallback to Jupiter
      }
    }

    // --- Fallback to Jupiter API if Helius failed or not configured ---
    if (price === null) {
      const jupiterUrl = `${JUPITER_API_BASE_URL}/price`;
      const params = { ids: mintAddress };
      console.log(`Fetching price for ${mintAddress} via Jupiter (fallback)...`); // Debug log
      try {
        const response = await axios.get(jupiterUrl, { params });
        if (response.status === 200 && response.data && response.data.data && response.data.data[mintAddress]) {
          const priceData = response.data.data[mintAddress];
          price = priceData.price;
          source = 'Jupiter';
          console.log(`Jupiter price received for ${mintAddress}: ${price}`); // Debug log
        } else {
          console.warn(`Failed Jupiter price request for ${mintAddress}. Status: ${response.status}`, response.data);
          
          // Alternative Jupiter endpoint approach
          try {
            // Try a different approach with direct token address endpoint
            const directUrl = `${JUPITER_API_BASE_URL}/price?ids=${mintAddress}`;
            const directResponse = await axios.get(directUrl);
            
            if (directResponse.status === 200 && directResponse.data) {
              // Extract price from response
              const directData = directResponse.data.data;
              if (directData && directData[mintAddress] && directData[mintAddress].price) {
                price = directData[mintAddress].price;
                source = 'Jupiter-Direct';
                console.log(`Jupiter direct price received for ${mintAddress}: ${price}`);
              }
            }
          } catch (directError) {
            console.error(`Jupiter direct price fetch failed for ${mintAddress}:`, directError.message);
          }
        }
      } catch (error) {
        console.error(`Error fetching price from Jupiter for ${mintAddress}:`, error.response ? error.response.data : error.message);
         // Price remains null
      }
    }

    // --- Update Cache and Return ---
    if (price !== null && price > 0) {
      this.priceCache.set(mintAddress, { price: price, timestamp: now, source: source });
      return price;
    } else {
      console.error(`Failed to get price for ${mintAddress} from all sources.`);
      return null; // Explicitly return null if no price was found
    }
  }

  /**
   * Placeholder for fetching available token list.
   * @returns {Promise<Array>} List of tokens.
   */
  async getTokenList() {
    console.log('Fetching token list from Jupiter Token API...');
    try {
      const response = await axios.get('https://token.jup.ag/all');
      if (response.status === 200 && Array.isArray(response.data)) {
        console.log(`Successfully fetched ${response.data.length} tokens.`);
        return response.data;
      } else {
        console.warn(`Failed to fetch token list. Status: ${response.status}`);
        return [];
      }
    } catch (error) {
      console.error('Error fetching Jupiter token list:', error.message);
      return [];
    }
  }
  
  /**
   * Get a list of tokens with confirmed price data - these are the tradeable ones
   * @returns {Promise<Array>} List of tokens with price data
   */
  async getTokensWithPriceData() {
    console.log('Fetching tokens with price data...');
    try {
      // First try to use Helius API if configured
      if (this.heliusConfigured) {
        console.log('Using Helius API for token discovery...');
        
        // Define a list of primary tokens we know are tradeable
        const primaryTokens = [
          'So11111111111111111111111111111111111111112', // SOL 
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
          'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
          'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
          'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
          '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH (Wormhole)
          'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // ORCA
          'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLZYQJB9ihCn3', // WIF
          '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx', // JITO
          'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
          '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj'  // stSOL
        ];
        
        // Use Helius to get the top tokens by volume
        // Make sure URL parameter handling is consistent
        const heliusUrl = this.heliusRpcUrl.includes('?') ? 
          this.heliusRpcUrl : // URL already has parameters
          `${this.heliusRpcUrl}/?api-key=${this.heliusApiKey}`; // Add API key as parameter
          
        console.log('Fetching top tokens from Helius...');
        
        // We'll use the tokenMetadata feature to get batch info about our primary tokens
        try {
          const response = await axios.post(heliusUrl, {
            jsonrpc: '2.0',
            id: 'get-top-tokens',
            method: 'getAssetBatch',
            params: {
              ids: primaryTokens
            }
          });
          
          if (response.status === 200 && response.data && response.data.result) {
            const tokenResults = response.data.result;
            console.log(`Received data for ${tokenResults.length} tokens from Helius`);
            
            // Process the tokens with price data
            const tokensWithPrices = [];
            
            for (const tokenData of tokenResults) {
              // Only include tokens with the necessary data
              if (tokenData && tokenData.content && tokenData.id) {
                // Extract price from token info if available
                let price = null;
                
                try {
                  if (tokenData.token_info?.price_info?.price_per_token) {
                    price = tokenData.token_info.price_info.price_per_token;
                  }
                  
                  // If no price, try to get it from Jupiter as fallback
                  if (!price || price <= 0) {
                    price = await this.getTokenPrice(tokenData.id);
                  }
                  
                  // Only include tokens with valid prices
                  if (price && price > 0) {
                    tokensWithPrices.push({
                      symbol: tokenData.content?.metadata?.symbol || tokenData.symbol || 'Unknown',
                      name: tokenData.content?.metadata?.name || tokenData.name || 'Unknown Token',
                      address: tokenData.id,
                      decimals: tokenData.token_info?.decimals || 9,
                      price: price,
                      hasPriceData: true
                    });
                    
                    console.log(`Added ${tokensWithPrices[tokensWithPrices.length-1].symbol} with price $${price}`);
                  }
                } catch (priceError) {
                  console.error(`Error processing price for token ${tokenData.id}:`, priceError.message);
                }
              }
            }
            
            // Now let's get additional popular tokens to add variety
            // We'll use a different approach to find popular tokens by requesting recent or trending tokens
            try {
              // Get a set of popular tokens from Jupiter since Helius doesn't offer a direct "popular tokens" endpoint
              const jupResponse = await axios.get('https://token.jup.ag/strict');
              if (jupResponse.status === 200 && Array.isArray(jupResponse.data)) {
                // Take a sample of tokens from Jupiter's strict list (which are pre-filtered for quality)
                const popularCount = Math.min(jupResponse.data.length, 30);
                const popularSample = jupResponse.data
                  .sort(() => 0.5 - Math.random()) // Randomize to get different tokens each time
                  .slice(0, popularCount);
                
                console.log(`Found ${popularSample.length} additional tokens from Jupiter to evaluate`);
                
                // Process each token
                for (const token of popularSample) {
                  // Skip if we already have this token
                  if (tokensWithPrices.some(t => t.address === token.address)) {
                    continue;
                  }
                  
                  // Try to get price
                  try {
                    const price = await this.getTokenPrice(token.address);
                    if (price && price > 0) {
                      tokensWithPrices.push({
                        symbol: token.symbol || 'Unknown',
                        name: token.name || 'Unknown Token',
                        address: token.address,
                        decimals: token.decimals || 9,
                        price: price,
                        hasPriceData: true
                      });
                      
                      console.log(`Added additional token ${token.symbol} with price $${price}`);
                    }
                  } catch (priceError) {
                    console.error(`Error getting price for additional token ${token.symbol}:`, priceError.message);
                  }
                }
              }
            } catch (additionalError) {
              console.error('Error fetching additional tokens:', additionalError.message);
            }
            
            console.log(`Total tokens with price data: ${tokensWithPrices.length}`);
            return tokensWithPrices;
          } else {
            console.warn('Invalid response from Helius:', response.data);
          }
        } catch (heliusError) {
          console.error('Error fetching from Helius:', heliusError.message);
          // Fall back to Jupiter approach below
        }
      }
      
      // If Helius failed or not configured, fall back to Jupiter
      console.log('Falling back to Jupiter API for token discovery...');
      
      // First get the token list
      const allTokens = await this.getTokenList();
      if (!allTokens || allTokens.length === 0) {
        console.warn('No tokens found in Jupiter token list');
        return [];
      }
      
      console.log(`Retrieved ${allTokens.length} tokens from Jupiter token list`);
      
      // Select a subset of popular/known tokens to check for prices
      // This is more efficient than trying to get prices for all tokens
      const popularTokens = [
        'So11111111111111111111111111111111111111112', // SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
        'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
        'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // ORCA
        'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLZYQJB9ihCn3', // WIF
        '7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx', // JITO
        '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH (Wormhole)
        'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
        '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj'  // stSOL
      ];
      
      // Step 3: For each token in our list, get its price
      const tokensWithPrices = [];
      
      for (const tokenAddress of popularTokens) {
        try {
          // Try to get price using our getTokenPrice method (which now tries Helius first)
          const price = await this.getTokenPrice(tokenAddress);
          
          if (price !== null && price > 0) {
            // Find the token info from the full list
            const tokenInfo = allTokens.find(t => t.address === tokenAddress);
            
            if (tokenInfo) {
              tokensWithPrices.push({
                ...tokenInfo,
                price: price,
                hasPriceData: true
              });
              console.log(`Got price for ${tokenInfo.symbol || tokenAddress}: $${price}`);
            }
          }
        } catch (priceError) {
          console.error(`Error getting price for token ${tokenAddress}:`, priceError.message);
        }
      }
      
      console.log(`Successfully got prices for ${tokensWithPrices.length} tokens`);
      return tokensWithPrices;
    } catch (error) {
      console.error('Error fetching tokens with price data:', error.message);
      return [];
    }
  }
  
  /**
   * Verify if a token is tradeable by testing a quote against USDC.
   * @param {string} tokenAddress - The token's mint address to verify
   * @param {number} [minLiquidityUsd] - Minimum liquidity required in USD (optional)
   * @returns {Promise<object|null>} Result object with tradeable status and details or null if error
   */
  async isTokenTradeable(tokenAddress, minLiquidityUsd = 10000) {
    if (!tokenAddress) {
      console.error('isTokenTradeable: No token address provided');
      return { tradeable: false, reason: 'No token address provided' };
    }
    
    // Standard USDC mint address on Solana
    const USDC_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    try {
      // Step 1: Try to get token price to verify it exists and has price data
      const tokenPrice = await this.getTokenPrice(tokenAddress);
      if (!tokenPrice || tokenPrice <= 0) {
        return { 
          tradeable: false, 
          reason: 'No price data available',
          tokenAddress
        };
      }
      
      // Step 2: Try to get a quote for buying this token with USDC
      // This tests both directions of the trade
      const buyQuote = await this.getQuote(
        USDC_ADDRESS,       // from USDC
        tokenAddress,       // to Token
        1000000,            // 1 USDC (in smallest unit)
        100                 // 1% slippage
      );
      
      if (!buyQuote || !buyQuote.outAmount || buyQuote.outAmount <= 0) {
        return { 
          tradeable: false, 
          reason: 'Cannot get buy quote',
          tokenAddress
        };
      }
      
      // Step 3: Try to get a quote for selling this token back to USDC
      // Check the amount we would receive for the tokens from step 2
      const outAmount = parseInt(buyQuote.outAmount);
      const sellQuote = await this.getQuote(
        tokenAddress,       // from Token
        USDC_ADDRESS,       // to USDC
        outAmount,          // Amount from buy quote
        100                 // 1% slippage
      );
      
      if (!sellQuote || !sellQuote.outAmount || sellQuote.outAmount <= 0) {
        return { 
          tradeable: false, 
          reason: 'Cannot get sell quote',
          tokenAddress
        };
      }
      
      // Step 4: Calculate implied slippage to check liquidity
      // How much USDC we get back if we immediately sell
      const usdcReturned = parseInt(sellQuote.outAmount) / 1000000; // Convert to USDC units
      const impliedSlippage = 1 - usdcReturned;
      
      // If slippage is too high, liquidity is likely too low
      if (impliedSlippage > 0.10) { // More than 10% slippage
        return {
          tradeable: false,
          reason: 'Excessive slippage indicates low liquidity',
          tokenAddress,
          impliedSlippage: impliedSlippage * 100, // Convert to percentage
          price: tokenPrice
        };
      }
      
      // Token is tradeable!
      return {
        tradeable: true,
        tokenAddress,
        price: tokenPrice,
        impliedSlippage: impliedSlippage * 100, // Convert to percentage
        buyQuote: {
          inputMint: USDC_ADDRESS,
          outputMint: tokenAddress,
          inAmount: 1000000,
          outAmount: buyQuote.outAmount
        },
        sellQuote: {
          inputMint: tokenAddress,
          outputMint: USDC_ADDRESS,
          inAmount: outAmount,
          outAmount: sellQuote.outAmount
        }
      };
    } catch (error) {
      console.error(`Error verifying token tradeability for ${tokenAddress}:`, error.message);
      return {
        tradeable: false,
        reason: `Error: ${error.message}`,
        tokenAddress
      };
    }
  }
  
  /**
   * Set up encrypted private key for automatic trading
   * @param {string} privateKey - Base58 encoded private key
   * @param {string} encryptionKey - Key to use for encryption
   * @returns {Promise<object>} Setup result
   */
  async setupAutomaticTrading(privateKey, encryptionKey) {
    try {
      if (!privateKey || !encryptionKey) {
        throw new Error('Private key and encryption key are required');
      }
      
      // Create encrypted key
      const result = this.secureTrading.createEncryptedKey(privateKey, encryptionKey);
      
      console.log(`Automatic trading setup completed for public key: ${result.publicKey}`);
      
      // Don't return the plain private key for security reasons
      return {
        success: true,
        publicKey: result.publicKey,
        encryptedPrivateKey: result.encryptedPrivateKey
      };
    } catch (error) {
      console.error('Error setting up automatic trading:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Initialize wallet with encrypted private key
   * @param {string} encryptedPrivateKey - Encrypted private key
   * @param {string} encryptionKey - Key to decrypt the private key
   * @returns {Promise<boolean>} Success status
   */
  async initializeWallet(encryptedPrivateKey, encryptionKey) {
    try {
      // Set the encrypted private key and encryption key
      this.secureTrading.encryptedPrivateKey = encryptedPrivateKey;
      this.secureTrading.config.encryptionKey = encryptionKey;
      
      // Initialize the wallet
      const result = await this.secureTrading.initializeWallet();
      
      if (result) {
        console.log('Wallet initialized successfully for automatic trading');
        return true;
      } else {
        console.error('Failed to initialize wallet for automatic trading');
        return false;
      }
    } catch (error) {
      console.error('Error initializing wallet:', error.message);
      return false;
    }
  }
}

module.exports = DexConnector; 