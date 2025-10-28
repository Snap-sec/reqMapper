// Popup script for ReqMapper Chrome Extension
document.addEventListener('DOMContentLoaded', function() {
  const webhookUrlInput = document.getElementById('webhookUrl');
  const domainScopeInput = document.getElementById('domainScope');
  const toggle = document.getElementById('toggle');
  const status = document.getElementById('status');
  const saveBtn = document.getElementById('saveBtn');
  
  // Load saved settings
  chrome.storage.sync.get(['webhookUrl', 'domainScope', 'isEnabled'], function(result) {
    webhookUrlInput.value = result.webhookUrl || '';
    domainScopeInput.value = result.domainScope || '';
    
    if (result.isEnabled) {
      toggle.classList.add('active');
      status.textContent = 'Monitoring: ON';
      status.className = 'status active';
    } else {
      toggle.classList.remove('active');
      status.textContent = 'Monitoring: OFF';
      status.className = 'status inactive';
    }
  });
  
  // Toggle functionality
  toggle.addEventListener('click', function() {
    toggle.classList.toggle('active');
    const isActive = toggle.classList.contains('active');
    
    if (isActive) {
      status.textContent = 'Monitoring: ON';
      status.className = 'status active';
    } else {
      status.textContent = 'Monitoring: OFF';
      status.className = 'status inactive';
    }
  });
  
  // Save settings
  saveBtn.addEventListener('click', function() {
    const webhookUrl = webhookUrlInput.value.trim();
    const domainScope = domainScopeInput.value.trim();
    const isEnabled = toggle.classList.contains('active');
    
    // Validate webhook URL
    if (isEnabled && webhookUrl && !isValidUrl(webhookUrl)) {
      alert('Please enter a valid webhook URL');
      return;
    }
    
    // Save to chrome storage
    chrome.storage.sync.set({
      webhookUrl: webhookUrl,
      domainScope: domainScope,
      isEnabled: isEnabled
    }, function() {
      // Send message to background script to update monitoring state
      chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings: {
          webhookUrl: webhookUrl,
          domainScope: domainScope,
          isEnabled: isEnabled
        }
      });
      
      // Show success feedback
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      saveBtn.style.background = 'rgba(76, 175, 80, 0.3)';
      
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = 'rgba(255, 255, 255, 0.2)';
      }, 1500);
    });
  });
  
  // Helper function to validate URL
  function isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
});
