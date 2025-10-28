// Background script for ReqMapper Chrome Extension
let isMonitoringEnabled = false;
let webhookUrl = '';
let domainScope = [];

// Initialize settings from storage
chrome.storage.sync.get(['webhookUrl', 'domainScope', 'isEnabled'], function(result) {
  webhookUrl = result.webhookUrl || '';
  domainScope = result.domainScope ? result.domainScope.split(',').map(d => d.trim()) : [];
  isMonitoringEnabled = result.isEnabled || false;
  
  updateMonitoringState();
});

// Listen for settings updates from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    webhookUrl = request.settings.webhookUrl || '';
    domainScope = request.settings.domainScope ? 
      request.settings.domainScope.split(',').map(d => d.trim()) : [];
    isMonitoringEnabled = request.settings.isEnabled || false;
    
    updateMonitoringState();
    sendResponse({success: true});
  }
});

// Update monitoring state based on current settings
function updateMonitoringState() {
  if (isMonitoringEnabled && webhookUrl) {
    // Add listeners for HTTP requests
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
  } else {
    // Remove listeners
    chrome.webRequest.onBeforeRequest.removeListener(handleRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(handleRequestHeaders);
    chrome.webRequest.onCompleted.removeListener(handleResponse);
  }
}

// Store request data for processing
const requestData = new Map();

// Handle request initiation
function handleRequest(details) {
  if (!isMonitoringEnabled || !webhookUrl) return;
  
  // Check if request is in scope
  if (!isRequestInScope(details.url)) return;
  
  const requestId = details.requestId;
  requestData.set(requestId, {
    method: details.method,
    url: details.url,
    requestBody: details.requestBody,
    timestamp: Date.now(),
    tabId: details.tabId
  });
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
  if (requestData.has(requestId)) {
    const request = requestData.get(requestId);
    request.statusCode = details.statusCode;
    request.responseHeaders = details.responseHeaders;
    
    // Convert to Postman format and send to webhook
    const postmanRequest = convertToPostmanFormat(request);
    sendToWebhook(postmanRequest);
    
    // Clean up
    requestData.delete(requestId);
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
  } catch (error) {
    console.error('Error sending request to webhook:', error);
  }
}
