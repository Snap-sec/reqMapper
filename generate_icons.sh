# Simple icon generation script
# This creates basic SVG icons that can be converted to PNG

# Create a simple SVG icon for the extension
cat > icons/icon.svg << 'EOF'
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="20" fill="url(#grad1)"/>
  <text x="64" y="45" font-family="Arial, sans-serif" font-size="24" font-weight="bold" text-anchor="middle" fill="white">R</text>
  <text x="64" y="70" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="white">Req</text>
  <text x="64" y="90" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="white">Mapper</text>
  <circle cx="64" cy="100" r="3" fill="white"/>
</svg>
EOF

echo "SVG icon created. You can convert it to PNG using online tools or ImageMagick:"
echo "convert icons/icon.svg -resize 16x16 icons/icon16.png"
echo "convert icons/icon.svg -resize 48x48 icons/icon48.png"
echo "convert icons/icon.svg -resize 128x128 icons/icon128.png"
