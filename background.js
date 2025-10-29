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

// Check if request should be ignored (webhook URL or extension-originated)
function shouldIgnoreRequest(details) {
  // Ignore requests to browser-requests endpoints (prevent recursive loops)
  // Pattern: /apisec/api/v1/projects/{project-id}/browser-requests/{org-id}
  if (details.url) {
    try {
      const requestUrlObj = new URL(details.url);
      const requestPath = requestUrlObj.pathname;
      
      // Check for the specific browser-requests pattern
      // Matches: /apisec/api/v1/projects/{any-id}/browser-requests/{any-id}
      const browserRequestsPattern = /^\/apisec\/api\/v1\/projects\/[^\/]+\/browser-requests\/[^\/]+/i;
      if (browserRequestsPattern.test(requestPath)) {
        console.log('Ignoring browser-requests endpoint:', requestPath);
        return true;
      }
      
      // Also check for any path containing /browser-requests/ (case insensitive)
      // This catches variations like /browser-requests/ or /Browser-Requests/
      if (requestPath.match(/\/browser-requests\//i)) {
        console.log('Ignoring browser-requests endpoint (generic):', requestPath);
        return true;
      }
    } catch (e) {
      // URL parsing error, check simple string match as fallback
      if (details.url.match(/\/browser-requests\//i)) {
        return true;
      }
    }
  }
  
  // Ignore requests to our own webhook URL (prevent recursive loops)
  if (webhookUrl && details.url) {
    // Normalize URLs for comparison (remove trailing slashes, etc.)
    const normalizedWebhook = webhookUrl.trim().replace(/\/$/, '');
    const normalizedRequest = details.url.trim().replace(/\/$/, '');
    
    // Exact match check
    if (normalizedRequest === normalizedWebhook) {
      return true;
    }
    
    // Check if request URL starts with webhook URL (catches variations with IDs appended)
    // e.g., webhook: https://example.com/api/webhook/123
    // request: https://example.com/api/webhook/123/456
    if (normalizedRequest.startsWith(normalizedWebhook + '/')) {
      return true;
    }
    
    // More sophisticated check using URL objects
    try {
      const webhookUrlObj = new URL(normalizedWebhook);
      const requestUrlObj = new URL(normalizedRequest);
      
      // Same origin check (protocol + hostname + port)
      if (webhookUrlObj.origin === requestUrlObj.origin) {
        const webhookPath = webhookUrlObj.pathname;
        const requestPath = requestUrlObj.pathname;
        
        // Exact path match
        if (requestPath === webhookPath) {
          return true;
        }
        
        // If webhook path is a prefix of request path
        // e.g., webhook: /api/webhook, request: /api/webhook/12345
        if (webhookPath.length > 0 && requestPath.startsWith(webhookPath + '/')) {
          return true;
        }
        
        // If request path is a prefix of webhook path
        // e.g., webhook: /api/webhook/12345, request: /api/webhook
        if (requestPath.length > 0 && webhookPath.startsWith(requestPath + '/')) {
          return true;
        }
        
        // Extract base pattern from webhook URL
        // For webhook: /api/v1/projects/123/browser-requests/456
        // Find the "browser-requests" segment and use everything up to it
        const webhookPathParts = webhookPath.split('/').filter(p => p);
        let basePathEndIndex = webhookPathParts.length;
        
        // Find if "browser-requests" exists in webhook path
        const browserRequestsIndex = webhookPathParts.findIndex(part => 
          part === 'browser-requests' || part.startsWith('browser-requests')
        );
        
        if (browserRequestsIndex >= 0) {
          // Base path is everything up to and including "browser-requests"
          basePathEndIndex = browserRequestsIndex + 1;
        } else {
          // If no "browser-requests" found, use all but the last segment (assuming last is an ID)
          basePathEndIndex = Math.max(1, webhookPathParts.length - 1);
        }
        
        const basePathParts = webhookPathParts.slice(0, basePathEndIndex);
        const basePath = '/' + basePathParts.join('/');
        
        // Check if request path starts with base path
        if (requestPath.startsWith(basePath)) {
          return true;
        }
        
        // Also check if paths share significant common segments (catch variations)
        const requestPathParts = requestPath.split('/').filter(p => p);
        if (requestPathParts.length >= basePathParts.length) {
          let allMatch = true;
          for (let i = 0; i < basePathParts.length; i++) {
            if (requestPathParts[i] !== basePathParts[i]) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            return true;
          }
        }
      }
    } catch (e) {
      // URL parsing error, use simple string comparison as fallback
      if (normalizedRequest.includes(normalizedWebhook) || 
          normalizedWebhook.includes(normalizedRequest)) {
        return true;
      }
    }
  }
  
  // Ignore requests originating from the extension itself
  // tabId -1 typically indicates extension-originated requests
  if (details.tabId === -1) {
    console.log('Ignoring extension-originated request (tabId -1):', details.url);
    return true;
  }
  
  // Also ignore if the request has extension origin in initiator
  // This is a safety check for extension-originated requests
  if (details.initiator) {
    try {
      const initiatorUrl = new URL(details.initiator);
      if (initiatorUrl.protocol === 'chrome-extension:' || 
          initiatorUrl.protocol === 'moz-extension:' ||
          initiatorUrl.hostname === chrome.runtime.id) {
        console.log('Ignoring extension-originated request (initiator check):', details.url);
        return true;
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }
  
  return false;
}

// Handle request initiation
function handleRequest(details) {
  if (!isMonitoringEnabled || !webhookUrl) return;
  
  // IMPORTANT: Ignore requests from extension itself and to webhook URL
  if (shouldIgnoreRequest(details)) {
    return;
  }
  
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
  
  // Safety check: Ignore webhook requests and extension-originated requests
  // (This is a fallback in case they weren't caught in handleRequest)
  if (shouldIgnoreRequest({ url: request.url, tabId: request.tabId })) {
    console.log('Ignoring webhook/extension request in response handler:', request.url);
    requestData.delete(requestId);
    requestStartTimes.delete(requestId);
    return;
  }
  
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
