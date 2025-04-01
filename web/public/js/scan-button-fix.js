// Direct fix for Scan button to trigger token discovery
document.addEventListener('DOMContentLoaded', function() {
  console.log('Scan button fix script loaded');
  
  // Find the scan button
  const scanButton = document.getElementById('scan-btn');
  
  if (!scanButton) {
    console.error('Scan button not found! Cannot attach event handler');
    return;
  }
  
  console.log('Found scan button, attaching direct click handler');
  
  // Override any existing click handlers
  scanButton.onclick = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    console.log('SCAN BUTTON CLICKED - DIRECT HANDLER');
    
    // Show immediate feedback
    alert('Starting token discovery...');
    
    // Send scan_tokens event
    window.socket.emit('scan_tokens');
    console.log('scan_tokens event sent to server');
    
    // Add visual feedback
    this.disabled = true;
    this.innerHTML = '<i class="fas fa-sync-alt fa-spin me-2"></i>Scanning...';
    
    // Enable after 5 seconds
    setTimeout(() => {
      this.disabled = false;
      this.innerHTML = '<i class="fas fa-search me-2"></i>Scan';
    }, 5000);
    
    return false;
  };
  
  // Handle token discovery related events
  if (window.socket) {
    // Handle token discovery updates
    window.socket.on('token_discovery_update', function(data) {
      console.log('Token discovery update:', data);
      alert(`Token Discovery: ${data.message || data.status}`);
    });
    
    // Handle token discovery completion
    window.socket.on('token_discovery_complete', function(data) {
      console.log('Token discovery complete:', data);
      scanButton.disabled = false;
      scanButton.innerHTML = '<i class="fas fa-search me-2"></i>Scan';
      
      // Show completion message
      alert(`Token Discovery Complete! Found ${data.totalTokens} tokens.`);
      
      // Log discovered tokens to console
      if (data.tokens && data.tokens.length > 0) {
        console.log('Discovered tokens:');
        data.tokens.forEach((token, index) => {
          console.log(`${index + 1}. ${token.symbol}: ${token.name}`);
        });
      }
    });
  } else {
    console.error('Socket.IO not initialized! Token discovery will not work');
  }
  
  console.log('Scan button handler and token discovery events set up');
}); 