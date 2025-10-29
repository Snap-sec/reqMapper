// Popup script for ReqMapper Chrome Extension
document.addEventListener('DOMContentLoaded', function() {
  const webhookUrlInput = document.getElementById('webhookUrl');
  const domainScopeInput = document.getElementById('domainScope');
  const methodFilterInput = document.getElementById('methodFilter');
  const pathRegexInput = document.getElementById('pathRegex');
  const toggle = document.getElementById('toggle');
  const status = document.getElementById('status');
  const saveBtn = document.getElementById('saveBtn');
  
  // Load saved settings
  chrome.storage.sync.get(['webhookUrl', 'domainScope', 'methodFilter', 'pathRegex', 'isEnabled'], function(result) {
    webhookUrlInput.value = result.webhookUrl || '';
    domainScopeInput.value = result.domainScope || '';
    methodFilterInput.value = result.methodFilter || '';
    pathRegexInput.value = result.pathRegex || '';
    
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
    const methodFilter = methodFilterInput.value;
    const pathRegex = pathRegexInput.value.trim();
    const isEnabled = toggle.classList.contains('active');
    
    // Validate webhook URL
    if (isEnabled && webhookUrl && !isValidUrl(webhookUrl)) {
      alert('Please enter a valid webhook URL');
      return;
    }
    
    // Validate regex if provided
    if (pathRegex) {
      try {
        new RegExp(pathRegex);
      } catch (e) {
        alert('Invalid regex pattern. Please enter a valid regex.');
        return;
      }
    }
    
    // Save to chrome storage
    chrome.storage.sync.set({
      webhookUrl: webhookUrl,
      domainScope: domainScope,
      methodFilter: methodFilter,
      pathRegex: pathRegex,
      isEnabled: isEnabled
    }, function() {
      // Send message to background script to update monitoring state
      chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings: {
          webhookUrl: webhookUrl,
          domainScope: domainScope,
          methodFilter: methodFilter,
          pathRegex: pathRegex,
          isEnabled: isEnabled
        }
      });
      
      // Show success feedback
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ Saved!';
      saveBtn.classList.add('saved');
      
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.classList.remove('saved');
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
