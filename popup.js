// Popup script for ReqMapper Chrome Extension
document.addEventListener('DOMContentLoaded', function() {
  const webhookUrlInput = document.getElementById('webhookUrl');
  const domainScopeInput = document.getElementById('domainScope');
  const methodFilterInput = document.getElementById('methodFilter');
  const pathRegexInput = document.getElementById('pathRegex');
  const toggle = document.getElementById('toggle');
  const status = document.getElementById('status');
  const toggleLabel = document.getElementById('toggleLabel');
  
  // Debounce timer for input fields
  let saveTimeout = null;
  
  // Update status labels
  function updateStatusLabels(isActive) {
    if (isActive) {
      status.textContent = 'Monitoring: ON';
      status.className = 'status active';
      toggleLabel.textContent = 'Monitoring: ON';
    } else {
      status.textContent = 'Monitoring: OFF';
      status.className = 'status inactive';
      toggleLabel.textContent = 'Monitoring: OFF';
    }
  }
  
  // Load saved settings
  chrome.storage.sync.get(['webhookUrl', 'domainScope', 'methodFilter', 'pathRegex', 'isEnabled'], function(result) {
    webhookUrlInput.value = result.webhookUrl || '';
    domainScopeInput.value = result.domainScope || '';
    methodFilterInput.value = result.methodFilter || '';
    pathRegexInput.value = result.pathRegex || '';
    
    if (result.isEnabled) {
      toggle.classList.add('active');
      updateStatusLabels(true);
    } else {
      toggle.classList.remove('active');
      updateStatusLabels(false);
    }
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
  
  // Save settings function
  function saveSettings(showStatusUpdate = false) {
    const webhookUrl = webhookUrlInput.value.trim();
    const domainScope = domainScopeInput.value.trim();
    const methodFilter = methodFilterInput.value;
    const pathRegex = pathRegexInput.value.trim();
    const isEnabled = toggle.classList.contains('active');
    
    // Validate webhook URL only if monitoring is enabled
    if (isEnabled && webhookUrl && !isValidUrl(webhookUrl)) {
      // Don't show alert on auto-save, just return
      if (showStatusUpdate) {
        alert('Please enter a valid webhook URL');
      }
      return;
    }
    
    // Validate regex if provided
    if (pathRegex) {
      try {
        new RegExp(pathRegex);
      } catch (e) {
        if (showStatusUpdate) {
          alert('Invalid regex pattern. Please enter a valid regex.');
        }
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
      
      // Show brief status update
      if (showStatusUpdate) {
        const originalStatus = status.textContent;
        status.textContent = isEnabled ? '✓ Monitoring Enabled' : '✓ Monitoring Disabled';
        status.style.opacity = '0.8';
        setTimeout(() => {
          status.textContent = originalStatus;
          status.style.opacity = '1';
        }, 2000);
      }
    });
  }
  
  // Toggle functionality with auto-save
  toggle.addEventListener('click', function() {
    toggle.classList.toggle('active');
    const isActive = toggle.classList.contains('active');
    
    // Update both status labels
    updateStatusLabels(isActive);
    
    // Auto-save immediately when toggle changes
    saveSettings(true);
  });
  
  // Auto-save on input changes (with debouncing)
  function setupAutoSave(inputElement) {
    inputElement.addEventListener('input', function() {
      // Clear existing timeout
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      
      // Set new timeout to save after user stops typing (500ms delay)
      saveTimeout = setTimeout(function() {
        saveSettings();
      }, 500);
    });
    
    // Also save on blur (when user leaves the field)
    inputElement.addEventListener('blur', function() {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveSettings();
    });
  }
  
  // Setup auto-save for all input fields
  setupAutoSave(webhookUrlInput);
  setupAutoSave(domainScopeInput);
  setupAutoSave(pathRegexInput);
  
  // Auto-save on select change (immediate, no debounce needed)
  methodFilterInput.addEventListener('change', function() {
    saveSettings();
  });
});
