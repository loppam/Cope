# COPE Logo Assets

This directory contains the source logo images for the COPE application.

## Source Images

- **cope-logo.png** - Full COPE logo with text (used for PWA icons)
- **cope-icon.png** - Icon-only version (C with controller)

## Generated Icons

All PWA icons have been generated from `cope-logo.png` and are located in `/public/icons/`:

- `icon-72x72.png` - 72×72px
- `icon-96x96.png` - 96×96px
- `icon-128x128.png` - 128×128px
- `icon-144x144.png` - 144×144px
- `icon-152x152.png` - 152×152px
- `icon-192x192.png` - 192×192px (required for Android)
- `icon-384x384.png` - 384×384px
- `icon-512x512.png` - 512×512px (required for Android)
- `apple-touch-icon.png` - 180×180px (for iOS)

## Favicon

The favicon has been generated and is located at `/public/favicon.ico`.

## Regenerating Icons

If you need to regenerate icons (e.g., after updating the logo):

### Option 1: Using Sharp (Recommended)
```bash
npm install -D sharp
node scripts/generate-icons.js assets/cope-logo.png
```

### Option 2: Using macOS sips (if Sharp is not available)
```bash
mkdir -p public/icons
for size in 72 96 128 144 152 192 384 512; do
  sips -z $size $size assets/cope-logo.png --out "public/icons/icon-${size}x${size}.png"
done
sips -z 180 180 assets/cope-logo.png --out "public/icons/apple-touch-icon.png"
```

## Icon Usage

These icons are used in:
- `/public/manifest.json` - PWA manifest configuration
- `/index.html` - HTML meta tags and favicon links
- `/vite.config.ts` - Service worker asset inclusion
