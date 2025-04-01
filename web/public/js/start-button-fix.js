// Direct fix for the start/stop button
document.addEventListener('DOMContentLoaded', function() {
  console.log('Start button fix script loaded');
  
  // Find the start button
  const startButton = document.getElementById('start-btn');
  
  if (!startButton) {
    console.error('Start button not found! Cannot attach event handler');
    return;
  }
  
  console.log('Found start button, attaching direct click handler');
  
  // Clean up any existing event listeners to avoid double firing
  const newButton = startButton.cloneNode(true);
  startButton.parentNode.replaceChild(newButton, startButton);
  
  // Set up a clean handler
  newButton.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    console.log('START/STOP BUTTON CLICKED - CLEAN HANDLER');
    
    // Get trading mode
    const modeElement = document.getElementById('trading-mode');
    const mode = modeElement ? modeElement.value : 'demo';
    
    // Check if already in stop mode (trading is active)
    if (this.classList.contains('btn-danger')) {
      console.log('STOPPING trading - button is in stop mode');
      
      // Send stop_trading event with a flag to avoid confusion
      window.socket.emit('stop_trading', { explicit: true });
      console.log('stop_trading event sent to server');
      
      // Update button appearance to start mode
      this.innerHTML = '<i class="fas fa-play me-2"></i>Start';
      this.classList.remove('btn-danger');
      this.classList.add('btn-success');
    } else {
      console.log('STARTING trading - button is in start mode');
      
      // Send start_trading event with mode
      window.socket.emit('start_trading', { mode: mode, explicit: true });
      console.log('start_trading event sent to server with mode:', mode);
      
      // Update button appearance to stop mode
      this.innerHTML = '<i class="fas fa-stop me-2"></i>Stop';
      this.classList.remove('btn-success');
      this.classList.add('btn-danger');
    }
    
    return false;
  });
  
  console.log('Clean click handler attached to start button');
  
  // Make sure we don't have any other start/stop button elements
  const stopButton = document.getElementById('stop-btn');
  if (stopButton) {
    console.log('Found separate stop button, removing/disabling it to avoid conflicts');
    stopButton.style.display = 'none';
    stopButton.disabled = true;
  }
}); 