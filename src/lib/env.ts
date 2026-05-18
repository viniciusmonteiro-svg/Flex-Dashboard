/**
 * env.ts
 *
 * Single place for loading and accessing environment variables.
 * - In Next.js (app routes / server components): Next.js loads .env.local automatically.
 * - In CLI scripts (tsx scripts/...): this file calls dotenv.config() explicitly.
 *
 * Always import env accessors from here — never read process.env directly.
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env.local when running outside the Next.js lifecycle (e.g. CLI scripts).
// When Next.js is running, this is a no-op (already loaded).
dotenv.config({
  path: path.resolve(process.cwd(), '.env.local'),
});

/**
 * Returns the value of an environment variable or throws a clear error.
 */
export function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Environment variable "${key}" is not set or is empty.\n` +
        `Add it to .env.local in the project root.\n` +
        `See .env.example for the expected format.`
    );
  }
  return value.trim();
}

/**
 * Returns the configured source data path.
 * Throws if SOURCE_DATA_PATH is missing or empty.
 */
export function getSourceDataPath(): string {
  return getEnvOrThrow('SOURCE_DATA_PATH');
}
