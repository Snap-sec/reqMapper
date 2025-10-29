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
  
  updateMonitoringState();
});

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
// Track requests that have already been sent to prevent duplicates
const sentRequests = new Set();
// Track request start times to clean up stale requests
const requestStartTimes = new Map();

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

// Handle response completion
function handleResponse(details) {
  if (!isMonitoringEnabled || !webhookUrl) return;
  
  const requestId = details.requestId;
  
  // Check if we've already processed this requestId
  if (sentRequests.has(requestId)) {
    // Already processed this request, ignore
    return;
  }
  
  if (requestData.has(requestId)) {
    const request = requestData.get(requestId);
    request.statusCode = details.statusCode;
    request.responseHeaders = details.responseHeaders;
    
    // Mark this requestId as being processed BEFORE sending to prevent duplicates
    sentRequests.add(requestId);
    
    // Convert to Postman format and send to webhook
    const postmanRequest = convertToPostmanFormat(request);
    sendToWebhook(postmanRequest).finally(() => {
      // Clean up request data after sending
      requestData.delete(requestId);
      requestStartTimes.delete(requestId);
      
      // Clean up sentRequests after a delay to prevent memory buildup
      // Keep track for 2 minutes to handle any edge cases
      setTimeout(() => {
        sentRequests.delete(requestId);
      }, 120000); // 2 minutes
    });
  } else {
    // Request data not found, but mark as processed to prevent duplicate handling
    sentRequests.add(requestId);
    requestStartTimes.delete(requestId);
    setTimeout(() => {
      sentRequests.delete(requestId);
    }, 120000);
  }
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
      console.error('Failed to send request to webhook:', response.status, response.statusText);
    }
    return response;
  } catch (error) {
    console.error('Error sending request to webhook:', error);
    throw error; // Re-throw to ensure promise chain works
  }
}
