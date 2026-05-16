// Run with: node generate-icons.js
// Requires: npm install canvas  (or use the pre-built SVG approach)
// This script generates PNG icons for the extension.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 48, 128];
const OUT_DIR = path.join(__dirname, 'icons');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

SIZES.forEach((size) => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#1877f2';
  ctx.fill();

  // Person silhouette (white)
  ctx.fillStyle = '#fff';
  const headR = size * 0.22;
  // Head
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.35, headR, 0, Math.PI * 2);
  ctx.fill();
  // Body arc
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.95, size * 0.38, Math.PI, 0);
  ctx.fill();

  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT_DIR, `icon${size}.png`), buf);
  console.log(`icon${size}.png written`);
});
