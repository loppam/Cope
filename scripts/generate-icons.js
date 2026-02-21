#!/usr/bin/env node

/**
 * Icon Generator Script
 *
 * Generates all required PWA icons from public/icons/icon.png.
 *
 * Usage:
 *   node scripts/generate-icons.js              # uses public/icons/icon.png
 *   node scripts/generate-icons.js <path>       # use custom source image
 *
 * Requirements:
 *   npm install -D sharp
 */

import sharp from "sharp";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const outputDir = join(__dirname, "../public/icons");

const iconSizes = [
  { name: "icon-32x32.png", size: 32 },
  { name: "icon-72x72.png", size: 72 },
  { name: "icon-96x96.png", size: 96 },
  { name: "icon-128x128.png", size: 128 },
  { name: "icon-144x144.png", size: 144 },
  { name: "icon-152x152.png", size: 152 },
  { name: "icon-192x192.png", size: 192 },
  { name: "icon-384x384.png", size: 384 },
  { name: "icon-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

const defaultSource = join(outputDir, "icon.png");

function cleanOldIcons() {
  console.log("Cleaning old generated icons...");
  for (const icon of iconSizes) {
    const path = join(outputDir, icon.name);
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`  Removed ${icon.name}`);
    }
  }
}

async function generateIcons(sourceImagePath) {
  if (!existsSync(sourceImagePath)) {
    console.error(`Error: Source image not found at ${sourceImagePath}`);
    console.error(
      "Place your icon at public/icons/icon.png or pass a custom path."
    );
    process.exit(1);
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  cleanOldIcons();

  console.log(`\nGenerating icons from ${sourceImagePath}...`);

  // Theme green to match the icon background
  const background = { r: 18, g: 213, b: 133, alpha: 1 }; // #12d585

  for (const icon of iconSizes) {
    const outputPath = join(outputDir, icon.name);

    try {
      await sharp(sourceImagePath)
        .resize(icon.size, icon.size, {
          fit: "contain",
          background,
        })
        .png()
        .toFile(outputPath);

      console.log(`✓ Generated ${icon.name} (${icon.size}x${icon.size})`);
    } catch (error) {
      console.error(`✗ Failed to generate ${icon.name}:`, error.message);
    }
  }

  console.log("\n✓ All icons generated successfully!");
  console.log(`Icons saved to: ${outputDir}`);
}

const sourceImage = process.argv[2] || defaultSource;
generateIcons(sourceImage).catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
