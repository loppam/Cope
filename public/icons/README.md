# PWA Icons

This directory should contain the following icon files for the PWA:

## Required Icons

- `icon-72x72.png` - 72x72 pixels
- `icon-96x96.png` - 96x96 pixels
- `icon-128x128.png` - 128x128 pixels
- `icon-144x144.png` - 144x144 pixels
- `icon-152x152.png` - 152x152 pixels
- `icon-192x192.png` - 192x192 pixels (required for Android)
- `icon-384x384.png` - 384x384 pixels
- `icon-512x512.png` - 512x512 pixels (required for Android)
- `apple-touch-icon.png` - 180x180 pixels (for iOS)

## Generating Icons

### Option 1: Using Online Tools
1. Create a 512x512px square icon with your app logo
2. Use tools like:
   - https://realfavicongenerator.net/
   - https://www.pwabuilder.com/imageGenerator
   - https://favicon.io/favicon-generator/

### Option 2: Using ImageMagick (Command Line)
```bash
# If you have a source icon (icon-source.png) at 512x512:
convert icon-source.png -resize 72x72 public/icons/icon-72x72.png
convert icon-source.png -resize 96x96 public/icons/icon-96x96.png
convert icon-source.png -resize 128x128 public/icons/icon-128x128.png
convert icon-source.png -resize 144x144 public/icons/icon-144x144.png
convert icon-source.png -resize 152x152 public/icons/icon-152x152.png
convert icon-source.png -resize 192x192 public/icons/icon-192x192.png
convert icon-source.png -resize 384x384 public/icons/icon-384x384.png
convert icon-source.png -resize 512x512 public/icons/icon-512x512.png
convert icon-source.png -resize 180x180 public/icons/apple-touch-icon.png
```

### Option 3: Using Node.js Script
Run the provided `generate-icons.js` script (if available) or create one using sharp:
```bash
npm install -D sharp
node scripts/generate-icons.js
```

## Design Guidelines

- Use a square icon with rounded corners (optional, handled by OS)
- Keep important content within the center 80% to avoid cropping
- Use high contrast colors for visibility
- Ensure the icon looks good at small sizes (72x72)
- Use the app's brand colors (#14F195 and #9945FF)

## Current Status

⚠️ **Placeholder icons are currently in use. Replace with actual app icons before production deployment.**
