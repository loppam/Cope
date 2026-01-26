#!/usr/bin/env node

/**
 * Icon Generator Script
 * 
 * This script generates all required PWA icons from a source image.
 * 
 * Usage:
 *   node scripts/generate-icons.js <source-image-path>
 * 
 * Example:
 *   node scripts/generate-icons.js assets/logo.png
 * 
 * Requirements:
 *   npm install -D sharp
 */

import sharp from 'sharp';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const iconSizes = [
  { name: 'icon-72x72.png', size: 72 },
  { name: 'icon-96x96.png', size: 96 },
  { name: 'icon-128x128.png', size: 128 },
  { name: 'icon-144x144.png', size: 144 },
  { name: 'icon-152x152.png', size: 152 },
  { name: 'icon-192x192.png', size: 192 },
  { name: 'icon-384x384.png', size: 384 },
  { name: 'icon-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

const outputDir = join(__dirname, '../public/icons');

async function generateIcons(sourceImagePath) {
  if (!existsSync(sourceImagePath)) {
    console.error(`Error: Source image not found at ${sourceImagePath}`);
    process.exit(1);
  }

  // Create output directory if it doesn't exist
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Generating icons from ${sourceImagePath}...`);

  for (const icon of iconSizes) {
    const outputPath = join(outputDir, icon.name);
    
    try {
      await sharp(sourceImagePath)
        .resize(icon.size, icon.size, {
          fit: 'contain',
          background: { r: 11, g: 11, b: 16, alpha: 1 } // #0B0B10
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Generated ${icon.name} (${icon.size}x${icon.size})`);
    } catch (error) {
      console.error(`✗ Failed to generate ${icon.name}:`, error.message);
    }
  }

  console.log('\n✓ All icons generated successfully!');
  console.log(`Icons saved to: ${outputDir}`);
}

// Get source image path from command line arguments
const sourceImage = process.argv[2];

if (!sourceImage) {
  console.error('Usage: node scripts/generate-icons.js <source-image-path>');
  console.error('Example: node scripts/generate-icons.js assets/logo.png');
  process.exit(1);
}

generateIcons(sourceImage).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
