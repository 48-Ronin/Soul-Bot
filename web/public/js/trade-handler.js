// Trade handler for Soul-Bot
document.addEventListener('DOMContentLoaded', function() {
  // If socket isn't defined yet, wait for it
  const waitForSocket = setInterval(() => {
    if (window.socket) {
      clearInterval(waitForSocket);
      setupTradeHandlers(window.socket);
    }
  }, 100);
  
  // Set up trade handlers
  function setupTradeHandlers(socket) {
    console.log('Setting up trade handlers');
    
    // Handle new trades
    socket.on('new_trade', function(trade) {
      console.log('NEW TRADE RECEIVED:', trade);
      displayTrade(trade);
      
      // Update page title with notification
      const oldTitle = document.title;
      document.title = '🔔 New Trade! - Soul-Bot';
      setTimeout(() => {
        document.title = oldTitle;
      }, 3000);
      
      // Flash the trades section
      const tradesCard = document.querySelector('.card');
      if (tradesCard) {
        tradesCard.classList.add('highlight-section');
        setTimeout(() => {
          tradesCard.classList.remove('highlight-section');
        }, 2000);
      }
    });
    
    // Handle existing trades
    socket.on('trades', function(trades) {
      console.log('TRADES RECEIVED:', trades);
      if (trades && trades.length > 0) {
        displayTrades(trades);
      }
    });
  }
  
  // Display a single trade
  function displayTrade(trade) {
    const tradesTableBody = document.getElementById('trades-table-body');
    if (!tradesTableBody) return;
    
    // Format date
    const date = new Date(trade.timestamp);
    const formattedTime = date.toLocaleTimeString();
    
    // Create row for the trade
    const row = document.createElement('tr');
    row.className = trade.success ? 'success-trade' : 'failed-trade';
    
    // Set row HTML
    row.innerHTML = `
      <td>${formattedTime}</td>
      <td>${trade.route || `${trade.fromSymbol || trade.fromToken} → ${trade.toSymbol || trade.toToken}`}</td>
      <td>$${parseFloat(trade.amount).toFixed(2)}</td>
      <td class="${trade.profit >= 0 ? 'text-success' : 'text-danger'}">$${trade.profit.toFixed(2)}</td>
      <td><span class="badge ${trade.success ? 'bg-success' : 'bg-danger'}">${trade.success ? 'Success' : 'Failed'}</span></td>
    `;
    
    // Add to top of table
    if (tradesTableBody.firstChild) {
      tradesTableBody.insertBefore(row, tradesTableBody.firstChild);
    } else {
      tradesTableBody.appendChild(row);
    }
    
    // Update trade count
    updateTradeCount();
  }
  
  // Display multiple trades
  function displayTrades(trades) {
    const tradesTableBody = document.getElementById('trades-table-body');
    if (!tradesTableBody) return;
    
    // Clear existing content
    tradesTableBody.innerHTML = '';
    
    // Display each trade
    trades.forEach(trade => {
      const date = new Date(trade.timestamp);
      const formattedTime = date.toLocaleTimeString();
      
      const row = document.createElement('tr');
      row.className = trade.success ? 'success-trade' : 'failed-trade';
      
      row.innerHTML = `
        <td>${formattedTime}</td>
        <td>${trade.route || `${trade.fromSymbol || trade.fromToken} → ${trade.toSymbol || trade.toToken}`}</td>
        <td>$${parseFloat(trade.amount).toFixed(2)}</td>
        <td class="${trade.profit >= 0 ? 'text-success' : 'text-danger'}">$${trade.profit.toFixed(2)}</td>
        <td><span class="badge ${trade.success ? 'bg-success' : 'bg-danger'}">${trade.success ? 'Success' : 'Failed'}</span></td>
      `;
      
      tradesTableBody.appendChild(row);
    });
    
    // Update trade count
    updateTradeCount();
  }
  
  // Update trade count display
  function updateTradeCount() {
    const tradesCount = document.getElementById('trades-count');
    const tradesTableBody = document.getElementById('trades-table-body');
    
    if (tradesCount && tradesTableBody) {
      const count = tradesTableBody.children.length;
      tradesCount.textContent = `Total: ${count} trades`;
    }
  }
}); 