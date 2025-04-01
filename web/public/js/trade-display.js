// Simple dedicated script for displaying trades
document.addEventListener('DOMContentLoaded', function() {
  console.log("Trade display handler loaded");
  
  // Get the trades table body
  const tradesTableBody = document.getElementById('trades-table-body');
  // Get the trades container
  const tradesContainer = document.getElementById('trades-container');
  
  if (!tradesTableBody) {
    console.error("Could not find trades-table-body element!");
    return;
  }
  
  // Set max height and scrolling for the trades container
  if (tradesContainer) {
    tradesContainer.style.maxHeight = '400px';
    tradesContainer.style.overflowY = 'auto';
  }
  
  // Make sure socket is available globally
  if (!window.socket) {
    console.error("Socket.IO not initialized! Check app.js");
    return;
  }
  
  // Handle new trade event
  window.socket.on('new_trade', function(trade) {
    console.log('New trade received:', trade);
    addTradeToTable(trade, true); // True indicates it's a new trade for animation
    
    // Limit number of displayed trades to prevent performance issues
    limitTradesDisplayed(100); // Keep only the 100 most recent trades
    
    // Also update portfolio (in case it wasn't sent separately)
    if (trade.portfolioBalance) {
      updatePortfolioFromTrade(trade);
    }
  });
  
  // Handle trades array event
  window.socket.on('trades', function(trades) {
    console.log('Trades array received:', trades);
    if (Array.isArray(trades) && trades.length > 0) {
      displayAllTrades(trades.slice(-100)); // Display only the last 100 trades
    }
  });
  
  // Function to add a single trade to the table
  function addTradeToTable(trade, isNew = false) {
    if (!trade) return;
    
    // Format the date
    const date = new Date(trade.timestamp);
    const formattedTime = date.toLocaleTimeString();
    
    // Create a new row
    const row = document.createElement('tr');
    row.className = trade.success ? 'table-success' : 'table-danger';
    
    // Add animation class for new trades
    if (isNew) {
      row.classList.add('new-trade');
    }
    
    // Set the HTML for the row
    row.innerHTML = `
      <td>${formattedTime}</td>
      <td>${trade.route || `${trade.fromSymbol || trade.fromToken} → ${trade.toSymbol || trade.toToken}`}</td>
      <td>$${parseFloat(trade.amount).toFixed(2)}</td>
      <td class="${trade.profit >= 0 ? 'text-success' : 'text-danger'}">$${parseFloat(trade.profit).toFixed(2)}</td>
      <td><span class="badge ${trade.success ? 'bg-success' : 'bg-danger'}">${trade.success ? 'Success' : 'Failed'}</span></td>
    `;
    
    // Add the row to the table at the beginning
    if (tradesTableBody.firstChild) {
      tradesTableBody.insertBefore(row, tradesTableBody.firstChild);
    } else {
      tradesTableBody.appendChild(row);
    }
    
    // Update the trade count
    updateTradeCount();
    
    // Scroll to top if new trade
    if (isNew && tradesContainer) {
      tradesContainer.scrollTop = 0;
    }
  }
  
  // Function to display all trades
  function displayAllTrades(trades) {
    // Clear the table
    tradesTableBody.innerHTML = '';
    
    // Add each trade, starting with most recent
    trades.slice().reverse().forEach(function(trade) {
      addTradeToTable(trade);
    });
    
    // Update the trade count
    updateTradeCount();
  }
  
  // Limit the number of displayed trades to prevent performance issues
  function limitTradesDisplayed(limit) {
    const rows = tradesTableBody.querySelectorAll('tr');
    if (rows.length > limit) {
      for (let i = limit; i < rows.length; i++) {
        tradesTableBody.removeChild(rows[i]);
      }
    }
  }
  
  // Update portfolio metrics from trade data
  function updatePortfolioFromTrade(trade) {
    // Only attempt update if portfolio metric elements exist
    const portfolioValue = document.getElementById('portfolio-value');
    const totalPnL = document.getElementById('total-pnl');
    
    if (portfolioValue && trade.portfolioBalance) {
      portfolioValue.textContent = `$${parseFloat(trade.portfolioBalance).toFixed(2)}`;
      portfolioValue.parentElement.classList.add('updated');
      setTimeout(() => {
        portfolioValue.parentElement.classList.remove('updated');
      }, 600);
    }
    
    if (totalPnL && trade.totalPnL) {
      const pnlValue = parseFloat(trade.totalPnL);
      totalPnL.textContent = `$${pnlValue.toFixed(2)}`;
      totalPnL.className = pnlValue >= 0 ? 'positive' : 'negative';
      totalPnL.parentElement.classList.add('updated');
      setTimeout(() => {
        totalPnL.parentElement.classList.remove('updated');
      }, 600);
    }
  }
  
  // Update the trade count
  function updateTradeCount() {
    const countElement = document.getElementById('trades-count');
    if (countElement) {
      const count = tradesTableBody.children.length;
      countElement.textContent = `Total: ${count} trades`;
    }
  }
  
  // Immediately request trades when the page loads
  console.log("Requesting existing trades...");
  window.socket.emit('get_trades');
}); 