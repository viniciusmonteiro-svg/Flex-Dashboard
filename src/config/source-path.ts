/**
 * source-path.ts
 *
 * Single source of truth for "can we see the source data?"
 * Called at app startup and at the start of every ingestion run.
 *
 * Uses Node's `path` and `fs` modules exclusively — never string
 * concatenation — so spaces, ampersands, and backslashes in the
 * Drive path are handled correctly.
 */

import fs from 'fs';
import path from 'path';
import { getSourceDataPath } from '../lib/env';

export interface SourcePathResult {
  resolvedPath: string;
  entryCount: number;
  fileCount: number;
  folderCount: number;
}

/**
 * Validates that SOURCE_DATA_PATH exists, is a directory, and is readable.
 * Throws a descriptive Error for every failure mode.
 * On success, returns the resolved path and a directory entry summary.
 */
export function validateSourcePath(): SourcePathResult {
  // ── 1. Read env var ────────────────────────────────────────────────────────
  let rawPath: string;
  try {
    rawPath = getSourceDataPath();
  } catch (err) {
    throw err; // already has a clear message from getEnvOrThrow
  }

  // ── 2. Resolve to absolute path via path.resolve (handles backslashes) ────
  const resolvedPath = path.resolve(rawPath);

  // ── 3. Check existence ────────────────────────────────────────────────────
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      throw new Error(
        `Source path not found: ${resolvedPath}\n\n` +
          `Possible causes:\n` +
          `  • Google Drive for Desktop is not running\n` +
          `  • You are not signed in to Drive\n` +
          `  • The shared folder shortcut has not been added to "My Drive"\n` +
          `  • Drive hasn't finished syncing yet\n\n` +
          `Open File Explorer and verify the path exists before retrying.`
      );
    }

    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Cannot access source path: ${resolvedPath}\n\n` +
          `Permission denied. Check that your Windows user account has read access to this folder.`
      );
    }

    throw new Error(
      `Unexpected error checking source path: ${resolvedPath}\n\n` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  // ── 4. Confirm it is a directory ──────────────────────────────────────────
  if (!stat.isDirectory()) {
    throw new Error(
      `Source path exists but is not a folder: ${resolvedPath}\n\n` +
        `SOURCE_DATA_PATH must point to a directory, not a file.\n` +
        `Check the value in .env.local.`
    );
  }

  // ── 5. Confirm it is readable ─────────────────────────────────────────────
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;

    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(
        `Cannot read source folder: ${resolvedPath}\n\n` +
          `Permission denied. Check that your Windows user account has read access to this folder.`
      );
    }

    throw new Error(
      `Unexpected error reading source folder: ${resolvedPath}\n\n` +
        (err instanceof Error ? err.message : String(err))
    );
  }

  // ── 6. Return summary ─────────────────────────────────────────────────────
  const fileCount = entries.filter((e) => e.isFile()).length;
  const folderCount = entries.filter((e) => e.isDirectory()).length;

  return {
    resolvedPath,
    entryCount: entries.length,
    fileCount,
    folderCount,
  };
}
