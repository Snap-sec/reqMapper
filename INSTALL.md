# ReqMapper Chrome Extension - Installation Guide

## Quick Start

1. **Load the Extension in Chrome:**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `/Users/imran/Desktop/SendHTTPRequestx` folder
   - The ReqMapper icon should appear in your toolbar

2. **Configure the Extension:**
   - Click the ReqMapper icon in your Chrome toolbar
   - Enter your webhook URL (e.g., `https://webhook.site/your-unique-url`)
   - Set domain scope (optional):
     - Leave empty to capture all domains
     - Enter specific domains: `example.com, api.example.com`
     - Use wildcards: `*.example.com`
   - Toggle the switch to enable monitoring
   - Click "Save Settings"

3. **Test the Extension:**
   - Visit any website (or one in your domain scope)
   - Check your webhook endpoint for incoming requests
   - Requests will be sent in Postman format

## Webhook Testing

For testing, you can use:
- **Webhook.site**: https://webhook.site (provides a unique URL)
- **RequestBin**: https://requestbin.com
- **ngrok**: For local testing with `ngrok http 3000`

## Example Webhook Payload

```json
{
  "source": "ReqMapper",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "request": {
    "name": "GET /api/users",
    "request": {
      "method": "GET",
      "header": [
        {"key": "Accept", "value": "application/json"},
        {"key": "User-Agent", "value": "Mozilla/5.0..."}
      ],
      "url": {
        "raw": "https://api.example.com/users?page=1",
        "protocol": "https",
        "host": ["api", "example", "com"],
        "path": ["users"],
        "query": [
          {"key": "page", "value": "1"}
        ]
      },
      "body": null
    },
    "response": {
      "status": 200,
      "code": 200,
      "header": [
        {"key": "Content-Type", "value": "application/json"}
      ],
      "body": ""
    },
    "timestamp": 1704110400000,
    "tabId": 123
  }
}
```

## Troubleshooting

- **Extension not loading**: Check Chrome console for errors
- **No requests captured**: Verify webhook URL and domain scope
- **Webhook not receiving data**: Check network connectivity
- **Permission errors**: Ensure all required permissions are granted

## Development Notes

- The extension uses Chrome's `webRequest` API to monitor requests
- Only request metadata is captured (no response bodies)
- Data is processed locally before sending to webhook
- Settings are stored in Chrome's sync storage

## File Structure

```
SendHTTPRequestx/
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup UI
├── popup.js               # Popup functionality
├── background.js          # Background service worker
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md              # Documentation
└── INSTALL.md             # This installation guide
```
