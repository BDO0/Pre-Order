const fs = require('fs');
const sharp = require('sharp');

async function buildMasterBrandAssets() {
  const rawSvg = fs.readFileSync('public/images/test-symmetric-trace.svg', 'utf8');
  const match = rawSvg.match(/d="([^"]+)"/);
  if (!match) {
    throw new Error('No path found in test-symmetric-trace.svg');
  }

  const pathData = match[1];

  // Save path string for easy reference
  fs.writeFileSync('public/images/emblem-path.txt', pathData);
  console.log('Saved emblem-path.txt (length:', pathData.length, ')');

  // Master Standalone SVG
  const tightViewBox = '384 246 1220 910';
  const masterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tightViewBox}" fill="none">
  <path
    d="${pathData}"
    fill="currentColor"
    fill-rule="evenodd"
  />
</svg>
`;

  fs.writeFileSync('public/images/tudungpeople-emblem.svg', masterSvg);
  console.log('Saved public/images/tudungpeople-emblem.svg');

  // Master Transparent PNG with white/gold emblem for high-DPI displays & external embedding
  const whiteSvg = masterSvg.replace('fill="currentColor"', 'fill="#FFFFFF"');
  await sharp(Buffer.from(whiteSvg))
    .resize(610, 455)
    .png()
    .toFile('public/images/tudungpeople-emblem.png');
  console.log('Saved public/images/tudungpeople-emblem.png (610x455 alpha transparent)');

  // Also save a rose-gold version
  const roseGoldSvg = masterSvg.replace('fill="currentColor"', 'fill="#f8c8d8"');
  await sharp(Buffer.from(roseGoldSvg))
    .resize(610, 455)
    .png()
    .toFile('public/images/tudungpeople-emblem-rose.png');
  console.log('Saved public/images/tudungpeople-emblem-rose.png');
}

buildMasterBrandAssets().catch(console.error);
