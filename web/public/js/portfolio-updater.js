// Portfolio metrics updater script
document.addEventListener('DOMContentLoaded', function() {
  console.log('Portfolio updater script loaded');
  
  // Get portfolio elements
  const portfolioValue = document.getElementById('portfolio-value');
  const totalPnL = document.getElementById('total-pnl');
  const dailyReturn = document.getElementById('daily-pnl');
  const mlAccuracy = document.getElementById('ml-accuracy');
  
  // Check if elements exist
  if (!portfolioValue || !totalPnL || !dailyReturn || !mlAccuracy) {
    console.error('Could not find portfolio metric elements!');
    return;
  }
  
  // Initialize values to zero for demo mode
  const tradingMode = document.getElementById('trading-mode')?.value || 'demo';
  if (tradingMode === 'demo') {
    portfolioValue.innerText = '$0.00';
    totalPnL.innerText = '$0.00';
    dailyReturn.innerText = '0.00%';
    mlAccuracy.innerText = '0.0%';
    console.log('Portfolio metrics initialized to zero for demo mode');
  }
  
  // Save initial values for animations
  const initialValues = {
    portfolio: parseFloat(portfolioValue.innerText.replace('$', '')) || 0,
    totalPnL: parseFloat(totalPnL.innerText.replace('$', '')) || 0,
    dailyReturn: parseFloat(dailyReturn.innerText.replace('%', '')) || 0,
    mlAccuracy: parseFloat(mlAccuracy.innerText.replace('%', '')) || 0
  };
  
  // Log initial values
  console.log('Initial portfolio values:', {
    portfolio: portfolioValue.innerText,
    pnl: totalPnL.innerText,
    returnPct: dailyReturn.innerText,
    ml: mlAccuracy.innerText
  });
  
  // Make sure socket is available
  if (!window.socket) {
    console.error('Socket.IO not initialized! Portfolio updates will not work');
    return;
  }
  
  // Handle portfolio update event
  window.socket.on('portfolio_update', function(data) {
    console.log('Portfolio update received:', data);
    updatePortfolioDisplay(data);
  });
  
  // Also handle the portfolio event (alternate format)
  window.socket.on('portfolio', function(data) {
    console.log('Portfolio (alternate format) received:', data);
    
    // Convert to standard format if needed
    const standardData = {
      balance: data.balance,
      totalPnL: data.totalPnL || data.pnl,
      returnPercentage: data.dailyReturn || data.returnPercentage,
      mlAccuracy: data.mlAccuracy
    };
    
    updatePortfolioDisplay(standardData);
  });
  
  // Handle trading mode changes for resetting demo mode values
  window.socket.on('trading_mode_changed', function(data) {
    console.log('Trading mode changed:', data);
    
    // Reset metrics if in demo mode
    if (data.mode === 'demo') {
      portfolioValue.innerText = '$0.00';
      totalPnL.innerText = '$0.00';
      dailyReturn.innerText = '0.00%';
      mlAccuracy.innerText = '0.0%';
      
      // Reset classes
      totalPnL.className = '';
      dailyReturn.className = '';
      
      console.log('Portfolio metrics reset for demo mode');
    }
  });
  
  // Unified function to update all portfolio metrics
  function updatePortfolioDisplay(data) {
    // Skip updates if data is empty
    if (!data || Object.keys(data).length === 0) {
      console.log('Empty portfolio data received, skipping update');
      return;
    }
    
    // Get current trading mode
    const tradingMode = document.getElementById('trading-mode')?.value || 'demo';
    
    // If in demo mode with zero values, only update if values are explicitly non-zero
    if (tradingMode === 'demo' && 
        portfolioValue.innerText === '$0.00' && 
        (!data.balance || parseFloat(data.balance) === 0)) {
      console.log('Maintaining zero values for demo mode');
      return;
    }
    
    // Update portfolio balance with animation
    if (data.balance !== undefined && !isNaN(parseFloat(data.balance))) {
      const newBalance = parseFloat(data.balance);
      animateValue(portfolioValue, initialValues.portfolio, newBalance, '$', 2);
      initialValues.portfolio = newBalance;
    }
    
    // Update total P&L with animation
    if ((data.totalPnL !== undefined || data.pnl !== undefined) && 
        !isNaN(parseFloat(data.totalPnL || data.pnl))) {
      const pnlValue = parseFloat(data.totalPnL || data.pnl);
      animateValue(totalPnL, initialValues.totalPnL, pnlValue, '$', 2);
      totalPnL.className = pnlValue >= 0 ? 'positive' : 'negative';
      initialValues.totalPnL = pnlValue;
    }
    
    // Update return percentage with animation
    if ((data.returnPercentage !== undefined || data.dailyReturn !== undefined) && 
        !isNaN(parseFloat(data.returnPercentage || data.dailyReturn))) {
      const returnValue = parseFloat(data.returnPercentage || data.dailyReturn);
      animateValue(dailyReturn, initialValues.dailyReturn, returnValue, '%', 2);
      dailyReturn.className = returnValue >= 0 ? 'positive' : 'negative';
      initialValues.dailyReturn = returnValue;
    }
    
    // Update ML accuracy
    if (data.mlAccuracy !== undefined && !isNaN(parseFloat(data.mlAccuracy))) {
      const accuracyValue = parseFloat(data.mlAccuracy);
      animateValue(mlAccuracy, initialValues.mlAccuracy, accuracyValue, '%', 1);
      initialValues.mlAccuracy = accuracyValue;
    }
    
    console.log('Portfolio metrics updated successfully');
    
    // Also update wallet balance if available
    if (data.balance !== undefined && document.getElementById('wallet-balance')) {
      document.getElementById('wallet-balance').innerHTML = `Balance: $${parseFloat(data.balance).toFixed(2)}`;
    }
    
    // Update available for withdrawal if wallet connected
    if (window.walletConnected && data.balance !== undefined && 
        document.getElementById('available-for-withdrawal')) {
      const lockedProfit = data.lockedProfit || 0;
      document.getElementById('available-for-withdrawal').innerHTML = 
        `Available for withdrawal: $${(parseFloat(data.balance) + parseFloat(lockedProfit)).toFixed(2)}`;
    }
  }
  
  // Animate value changes for smoother transitions
  function animateValue(element, start, end, prefix = '', decimals = 2) {
    if (start === end) return;
    
    const duration = 800; // animation duration in ms
    const startTime = performance.now();
    
    const updateDisplay = (currentTime) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);
      
      // Easing function for smoother animation
      const easeOutQuad = progress * (2 - progress);
      const currentValue = start + (end - start) * easeOutQuad;
      
      // Update the element text
      element.innerText = `${prefix}${currentValue.toFixed(decimals)}`;
      
      // Continue animation if not complete
      if (progress < 1) {
        requestAnimationFrame(updateDisplay);
      }
    };
    
    requestAnimationFrame(updateDisplay);
  }
  
  // Poll for portfolio updates every 30 seconds to ensure data is fresh
  setInterval(() => {
    console.log('Requesting updated portfolio data...');
    window.socket.emit('get_portfolio');
  }, 30000);
  
  // Request initial portfolio data
  console.log('Requesting portfolio data...');
  window.socket.emit('get_portfolio');
}); 