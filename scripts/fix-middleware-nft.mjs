// Generates the missing middleware.js.nft.json that Vercel's Next.js adapter
// expects but Turbopack doesn't emit. Reads middleware-manifest.json to find
// the actual edge chunk files, then writes a minimal NFT descriptor pointing
// to them so Vercel can bundle the middleware correctly.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const manifestPath = path.join(root, '.next/server/middleware-manifest.json');
const nftPath = path.join(root, '.next/server/middleware.js.nft.json');

if (!fs.existsSync(manifestPath)) {
  console.log('No middleware-manifest.json found — skipping NFT fix.');
  process.exit(0);
}

if (fs.existsSync(nftPath)) {
  console.log('middleware.js.nft.json already exists — skipping.');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const middleware = manifest?.middleware?.['/'];

if (!middleware?.files?.length) {
  console.log('No middleware files found — writing empty NFT.');
  fs.writeFileSync(nftPath, JSON.stringify({ version: 1, files: [] }));
  process.exit(0);
}

// Convert server-relative paths to paths relative to .next/server/
const files = middleware.files.map(f => f);

fs.writeFileSync(nftPath, JSON.stringify({ version: 1, files }, null, 2));
console.log(`Created middleware.js.nft.json with ${files.length} files.`);
