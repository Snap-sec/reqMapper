# ReqMapper Chrome Extension

A Chrome extension that monitors HTTP requests and sends them to a webhook in Postman format.

## Features

- 🔗 **Webhook Integration**: Send captured requests to your specified webhook URL
- 🎯 **Domain Scoping**: Filter requests by specific domains or use wildcards
- 🔄 **Real-time Monitoring**: Capture requests as they happen in your browser
- 📋 **Postman Format**: Convert requests to Postman collection format
- 🎨 **Modern UI**: Beautiful, responsive popup interface

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The ReqMapper icon should appear in your Chrome toolbar

## Usage

1. Click the ReqMapper icon in your Chrome toolbar
2. Enter your webhook URL (e.g., `https://your-webhook-url.com/endpoint`)
3. Specify domain scope (comma-separated, e.g., `example.com, api.example.com`)
   - Leave empty to capture all domains
   - Use `*.example.com` for wildcard matching
4. Toggle the switch to enable/disable monitoring
5. Click "Save Settings"

## Webhook Payload Format

The extension sends requests in the following format:

```json
{
  "source": "ReqMapper",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "request": {
    "name": "GET /api/users",
    "request": {
      "method": "GET",
      "header": [
        {
          "key": "Content-Type",
          "value": "application/json"
        }
      ],
      "url": {
        "raw": "https://api.example.com/users?page=1",
        "protocol": "https",
        "host": ["api", "example", "com"],
        "path": ["users"],
        "query": [
          {
            "key": "page",
            "value": "1"
          }
        ]
      },
      "body": null
    },
    "response": {
      "status": 200,
      "code": 200,
      "header": [
        {
          "key": "Content-Type",
          "value": "application/json"
        }
      ],
      "body": ""
    },
    "timestamp": 1704110400000,
    "tabId": 123
  }
}
```

## Permissions

- `webRequest`: Required to monitor HTTP requests
- `storage`: Required to save extension settings
- `activeTab`: Required for tab information
- `tabs`: Required for tab management
- `<all_urls>`: Required to monitor requests from all websites

## Development

To modify the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the ReqMapper extension
4. Test your changes

## File Structure

```
ReqMapper/
├── manifest.json          # Extension manifest
├── popup.html             # Extension popup UI
├── popup.js               # Popup functionality
├── background.js          # Background service worker
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

## Security Notes

- The extension only sends request metadata, not response bodies
- All data is processed locally before sending to webhook
- No data is stored permanently by the extension
- Webhook URLs are stored in Chrome's sync storage

## Troubleshooting

- **Extension not working**: Check if the webhook URL is valid and accessible
- **No requests captured**: Verify domain scope settings and ensure monitoring is enabled
- **Webhook not receiving data**: Check network connectivity and webhook endpoint status

## License

MIT License - Feel free to modify and distribute as needed.
