/**
 * check-source.ts
 *
 * CLI smoke test: verifies that SOURCE_DATA_PATH resolves to a readable
 * Google Drive folder and prints a one-level directory listing.
 *
 * Usage:
 *   npm run check-source
 */

import fs from 'fs';
import path from 'path';
import { validateSourcePath } from '../src/config/source-path';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

function ok(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function fail(msg: string) {
  console.error(`${RED}✗ ${msg}${RESET}`);
}

function header(msg: string) {
  console.log(`\n${BOLD}${msg}${RESET}`);
}

// ── Run validation ─────────────────────────────────────────────────────────

header('Marketing Dashboard — Source Path Check');
console.log(DIM + '─'.repeat(52) + RESET);

try {
  const result = validateSourcePath();

  ok(`Path resolved: ${result.resolvedPath}`);
  ok(`Folder is readable`);
  ok(
    `${result.entryCount} entries found — ${result.fileCount} file(s), ${result.folderCount} subfolder(s)`
  );

  // ── One-level listing ──────────────────────────────────────────────────
  header('Contents:');

  const entries = fs.readdirSync(result.resolvedPath, { withFileTypes: true });

  if (entries.length === 0) {
    console.log(DIM + '  (folder is empty)' + RESET);
  } else {
    for (const entry of entries) {
      const entryPath = path.join(result.resolvedPath, entry.name);

      if (entry.isDirectory()) {
        console.log(`  ${BOLD}[DIR]${RESET}  ${entry.name}`);
      } else {
        const { size } = fs.statSync(entryPath);
        const kb = (size / 1024).toFixed(1);
        console.log(`  ${DIM}[FILE]${RESET} ${entry.name} ${DIM}(${kb} KB)${RESET}`);
      }
    }
  }

  console.log(`\n${GREEN}${BOLD}All checks passed.${RESET} Drive integration is ready.\n`);
  process.exit(0);
} catch (err) {
  fail('Source path validation failed:\n');
  console.error((err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
}
