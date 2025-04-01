// Token data
const tokens = [
  { symbol: 'SOL', name: 'Solana', price: 120.45, volume: 1245000000, tags: ['defi', 'layer1'] },
  { symbol: 'ETH', name: 'Ethereum', price: 3120.78, volume: 15670000000, tags: ['defi', 'layer1'] },
  { symbol: 'BTC', name: 'Bitcoin', price: 42680.25, volume: 25890000000, tags: ['store-of-value'] },
  { symbol: 'BONK', name: 'Bonk', price: 0.00001245, volume: 14500000, tags: ['meme', 'solana-ecosystem'] },
  { symbol: 'JUP', name: 'Jupiter', price: 0.85, volume: 156000000, tags: ['dex', 'solana-ecosystem'] }
];

// Get all tokens
function getAllTokens() {
  return tokens;
}

// Get a token by symbol
function getTokenBySymbol(symbol) {
  return tokens.find(token => token.symbol === symbol) || null;
}

// Check if a token is valid
function isValidToken(symbol) {
  return tokens.some(token => token.symbol === symbol);
}

// Search tokens
function searchTokens(query) {
  const lowercaseQuery = query.toLowerCase();
  return tokens.filter(token => 
    token.symbol.toLowerCase().includes(lowercaseQuery) || 
    token.name.toLowerCase().includes(lowercaseQuery)
  );
}

// Get top tokens by volume
function getTopTokens(limit = 10) {
  return [...tokens]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit);
}

module.exports = {
  getAllTokens,
  getTokenBySymbol,
  isValidToken,
  searchTokens,
  getTopTokens
}; 