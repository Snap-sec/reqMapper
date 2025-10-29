// Background script for ReqMapper Chrome Extension
let isMonitoringEnabled = false;
let webhookUrl = '';
let domainScope = [];
let methodFilter = '';
let pathRegex = '';
let pathRegexPattern = null;
let listenersRegistered = false;

// Initialize settings from storage
chrome.storage.sync.get(['webhookUrl', 'domainScope', 'methodFilter', 'pathRegex', 'isEnabled'], function(result) {
  webhookUrl = result.webhookUrl || '';
  domainScope = result.domainScope ? result.domainScope.split(',').map(d => d.trim()) : [];
  methodFilter = result.methodFilter || '';
  pathRegex = result.pathRegex || '';
  isMonitoringEnabled = result.isEnabled || false;
  
  // Compile regex pattern if provided
  if (pathRegex) {
    try {
      pathRegexPattern = new RegExp(pathRegex);
    } catch (e) {
      console.error('Invalid regex pattern:', pathRegex);
    }
  }
  
  // Clean up old request signatures from persistent storage on startup
  cleanupOldSignatures();
  
  updateMonitoringState();
});

// Clean up old request signatures from persistent storage
async function cleanupOldSignatures() {
  try {
    const result = await chrome.storage.local.get(['sentRequestSignatures']);
    const signatures = result.sentRequestSignatures || {};
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    
    let cleaned = false;
    for (const key in signatures) {
      if (now - signatures[key] > maxAge) {
        delete signatures[key];
        cleaned = true;
      }
    }
    
    if (cleaned) {
      await chrome.storage.local.set({ sentRequestSignatures: signatures });
    }
  } catch (e) {
    console.error('Error cleaning up old signatures:', e);
  }
}

// Listen for settings updates from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    webhookUrl = request.settings.webhookUrl || '';
    domainScope = request.settings.domainScope ? 
      request.settings.domainScope.split(',').map(d => d.trim()) : [];
    methodFilter = request.settings.methodFilter || '';
    pathRegex = request.settings.pathRegex || '';
    isMonitoringEnabled = request.settings.isEnabled || false;
    
    // Compile regex pattern if provided
    if (pathRegex) {
      try {
        pathRegexPattern = new RegExp(pathRegex);
      } catch (e) {
        console.error('Invalid regex pattern:', pathRegex);
        pathRegexPattern = null;
      }
    } else {
      pathRegexPattern = null;
    }
    
    updateMonitoringState();
    sendResponse({success: true});
  }
  return true; // Keep message channel open for async response
});

// Update monitoring state based on current settings
function updateMonitoringState() {
  // Remove existing listeners first to avoid duplicates
  try {
    chrome.webRequest.onBeforeRequest.removeListener(handleRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(handleRequestHeaders);
    chrome.webRequest.onCompleted.removeListener(handleResponse);
  } catch (e) {
    // Listeners might not exist, which is fine
  }
  
  listenersRegistered = false;
  
  if (isMonitoringEnabled && webhookUrl) {
    // Add listeners for HTTP requests only if not already registered
    try {
      chrome.webRequest.onBeforeRequest.addListener(
        handleRequest,
        {urls: ["<all_urls>"]},
        ["requestBody"]
      );
      
      chrome.webRequest.onBeforeSendHeaders.addListener(
        handleRequestHeaders,
        {urls: ["<all_urls>"]},
        ["requestHeaders"]
      );
      
      chrome.webRequest.onCompleted.addListener(
        handleResponse,
        {urls: ["<all_urls>"]}
      );
      
      listenersRegistered = true;
    } catch (e) {
      console.error('Error registering listeners:', e);
    }
  }
  
  // Clear request data when monitoring is disabled
  if (!isMonitoringEnabled) {
    requestData.clear();
    sentRequests.clear();
    requestStartTimes.clear();
  }
}

// Store request data for processing
const requestData = new Map();
// Track requests that have already been sent to prevent duplicates (in-memory cache)
const sentRequests = new Set();
// Track request start times to clean up stale requests
const requestStartTimes = new Map();

// Create a unique signature for a request to prevent duplicates
// Uses URL + method + timestamp + request body hash
function createRequestSignature(request) {
  const url = request.url;
  const method = request.method;
  const timestamp = request.timestamp;
  
  // Create a simple hash of the request body if present
  let bodyHash = '';
  if (request.requestBody) {
    try {
      const bodyStr = JSON.stringify(request.requestBody);
      // Simple hash function
      let hash = 0;
      for (let i = 0; i < bodyStr.length; i++) {
        const char = bodyStr.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      bodyHash = Math.abs(hash).toString(16);
    } catch (e) {
      bodyHash = 'none';
    }
  }
  
  return `${method}:${url}:${timestamp}:${bodyHash}`;
}

// Clean up stale requests every 30 seconds
setInterval(() => {
  const now = Date.now();
  const maxAge = 60000; // 1 minute
  
  // Clean up old request data
  for (const [requestId, startTime] of requestStartTimes.entries()) {
    if (now - startTime > maxAge) {
      requestData.delete(requestId);
      requestStartTimes.delete(requestId);
    }
  }
  
  // Clean up old signatures from persistent storage
  cleanupOldSignatures();
}, 30000); // Run every 30 seconds

// Handle request initiation
function handleRequest(details) {
  if (!isMonitoringEnabled || !webhookUrl) return;
  
  // Check if request is in scope
  if (!isRequestInScope(details.url)) return;
  
  // Check method filter
  if (methodFilter && details.method !== methodFilter) return;
  
  // Check path regex filter
  if (pathRegexPattern) {
    try {
      const url = new URL(details.url);
      const path = url.pathname;
      if (!pathRegexPattern.test(path)) return;
    } catch (e) {
      console.error('Error parsing URL:', details.url);
      return;
    }
  }
  
  const requestId = details.requestId;
  const timestamp = Date.now();
  
  requestData.set(requestId, {
    method: details.method,
    url: details.url,
    requestBody: details.requestBody,
    timestamp: timestamp,
    tabId: details.tabId
  });
  
  // Track when this request started
  requestStartTimes.set(requestId, timestamp);
}

// Handle request headers
function handleRequestHeaders(details) {
  if (!isMonitoringEnabled || !webhookUrl) return;
  
  const requestId = details.requestId;
  if (requestData.has(requestId)) {
    requestData.get(requestId).headers = details.requestHeaders;
  }
}

// Check if a request signature has already been sent (checks both memory and persistent storage)
async function hasRequestBeenSent(signature) {
  // First check in-memory cache
  if (sentRequests.has(signature)) {
    return true;
  }
  
  // Then check persistent storage
  try {
    const result = await chrome.storage.local.get(['sentRequestSignatures']);
    const signatures = result.sentRequestSignatures || {};
    return signatures.hasOwnProperty(signature);
  } catch (e) {
    console.error('Error checking persistent storage:', e);
    return false;
  }
}

// Mark a request signature as sent (both memory and persistent storage)
async function markRequestAsSent(signature) {
  // Mark in memory
  sentRequests.add(signature);
  
  // Mark in persistent storage with timestamp
  try {
    const result = await chrome.storage.local.get(['sentRequestSignatures']);
    const signatures = result.sentRequestSignatures || {};
    signatures[signature] = Date.now();
    
    // Clean up old entries (older than 5 minutes)
    const now = Date.now();
    const maxAge = 300000; // 5 minutes
    for (const key in signatures) {
      if (now - signatures[key] > maxAge) {
        delete signatures[key];
      }
    }
    
    await chrome.storage.local.set({ sentRequestSignatures: signatures });
  } catch (e) {
    console.error('Error saving to persistent storage:', e);
  }
}

// Handle response completion
async function handleResponse(details) {
  if (!isMonitoringEnabled || !webhookUrl) return;
  
  const requestId = details.requestId;
  
  if (!requestData.has(requestId)) {
    // Request data not found - might have been cleaned up or not captured
    return;
  }
  
  const request = requestData.get(requestId);
  request.statusCode = details.statusCode;
  request.responseHeaders = details.responseHeaders;
  
  // Create unique signature for this request
  const requestSignature = createRequestSignature(request);
  
  // Check if we've already sent this exact request
  const alreadySent = await hasRequestBeenSent(requestSignature);
  if (alreadySent) {
    // Already sent this request - skip it
    console.log('Skipping duplicate request:', requestSignature);
    requestData.delete(requestId);
    requestStartTimes.delete(requestId);
    return;
  }
  
  // Mark as sent IMMEDIATELY before sending to prevent race conditions
  await markRequestAsSent(requestSignature);
  
  // Convert to Postman format and send to webhook
  const postmanRequest = convertToPostmanFormat(request);
  
  // Send to webhook - note: we don't retry on failure
  sendToWebhook(postmanRequest)
    .then((response) => {
      if (response && response.ok) {
        console.log('Request sent to webhook successfully:', request.url);
      }
    })
    .catch((error) => {
      // Log error but don't retry - request already marked as sent
      console.error('Failed to send request to webhook (not retrying):', error);
    })
    .finally(() => {
      // Clean up request data after sending (whether success or failure)
      requestData.delete(requestId);
      requestStartTimes.delete(requestId);
    });
}

// Check if request URL is in scope
function isRequestInScope(url) {
  if (domainScope.length === 0) return true; // No scope means all domains
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    return domainScope.some(domain => {
      // Handle wildcard domains
      if (domain.startsWith('*.')) {
        const baseDomain = domain.substring(2);
        return hostname.endsWith('.' + baseDomain) || hostname === baseDomain;
      }
      return hostname === domain || hostname.endsWith('.' + domain);
    });
  } catch (e) {
    return false;
  }
}

// Convert request to Postman format
function convertToPostmanFormat(request) {
  const url = new URL(request.url);
  
  // Convert headers
  const headers = {};
  if (request.headers) {
    request.headers.forEach(header => {
      headers[header.name] = header.value;
    });
  }
  
  // Convert request body
  let body = null;
  if (request.requestBody && request.requestBody.formData) {
    body = {
      mode: 'urlencoded',
      urlencoded: Object.entries(request.requestBody.formData).map(([key, value]) => ({
        key: key,
        value: Array.isArray(value) ? value[0] : value
      }))
    };
  } else if (request.requestBody && request.requestBody.raw) {
    body = {
      mode: 'raw',
      raw: request.requestBody.raw.map(raw => raw.bytes).join('')
    };
  }
  
  // Convert query parameters
  const queryParams = [];
  url.searchParams.forEach((value, key) => {
    queryParams.push({
      key: key,
      value: value
    });
  });
  
  return {
    name: `${request.method} ${url.pathname}`,
    request: {
      method: request.method,
      header: Object.entries(headers).map(([key, value]) => ({
        key: key,
        value: value
      })),
      url: {
        raw: request.url,
        protocol: url.protocol.replace(':', ''),
        host: url.hostname.split('.'),
        port: url.port || '',
        path: url.pathname.split('/').filter(p => p),
        query: queryParams
      },
      body: body
    },
    response: {
      status: request.statusCode,
      code: request.statusCode,
      header: request.responseHeaders ? 
        request.responseHeaders.map(h => ({ key: h.name, value: h.value })) : [],
      body: '' // Response body not available in webRequest API
    },
    timestamp: request.timestamp,
    tabId: request.tabId
  };
}

// Send request data to webhook
// NOTE: This function does NOT retry on failure. Each browser request is sent exactly once.
async function sendToWebhook(postmanRequest) {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ReqMapper-Chrome-Extension/1.0'
      },
      body: JSON.stringify({
        source: 'ReqMapper',
        timestamp: new Date().toISOString(),
        request: postmanRequest
      })
    });
    
    if (!response.ok) {
      // Log error but don't retry - the request is already marked as sent
      console.error(`Webhook returned ${response.status} ${response.statusText} - request will NOT be retried`);
    }
    return response;
  } catch (error) {
    // Log error but don't retry - the request is already marked as sent
    console.error('Network error sending to webhook (not retrying):', error.message);
    throw error; // Re-throw to ensure promise chain works
  }
}
