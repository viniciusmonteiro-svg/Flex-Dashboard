import fs from 'fs';
import path from 'path';
import { getEnvOrThrow } from '@/lib/env';
import { queryOne } from '@/db/query';
import type { SourceDefinition, ClassifiedFile, PreviewResult } from './types';

function folderToMonthKey(folder: string): string {
  // '202401' → '2024-01'
  return `${folder.slice(0, 4)}-${folder.slice(4, 6)}`;
}

function monthKeyFromFilename(filename: string): string | null {
  // "CustomBudgetvs.Actual(Dept_VendorLevel)-01.2026.xls" → "2026-01"
  const match = filename.match(/(\d{2})\.(\d{4})\.[^.]+$/);
  if (!match) return null;
  return `${match[2]}-${match[1]}`;
}

export function buildSourcePath(source: SourceDefinition): string {
  const rootPath = getEnvOrThrow('SOURCE_DATA_PATH');
  return path.join(rootPath, source.subFolder);
}

async function classifyFile(
  filePath: string,
  fileName: string,
  parentFolder: string,
  monthKey: string
): Promise<ClassifiedFile> {
  const stat = fs.statSync(filePath);
  const fileMtime = stat.mtime;
  const fileSizeBytes = stat.size;

  const record = await queryOne<{ file_mtime: string | null }>(
    'SELECT file_mtime FROM ingested_files WHERE file_path = $1',
    [filePath]
  );

  let status: ClassifiedFile['status'];
  if (!record) {
    status = 'new';
  } else if (!record.file_mtime || fileMtime > new Date(record.file_mtime)) {
    status = 'updated';
  } else {
    status = 'unchanged';
  }

  return { path: filePath, monthKey, status, fileName, parentFolder, fileSizeBytes, fileMtime };
}

/** Flat file scan — files sit directly in sourceDir, no month subfolders. */
async function scanFlatSource(
  source: SourceDefinition,
  sourceDir: string
): Promise<ClassifiedFile[]> {
  const parentFolder = path.basename(sourceDir);

  const files = fs
    .readdirSync(sourceDir)
    .filter((f) => path.extname(f).toLowerCase() === source.fileExtension);

  const results: ClassifiedFile[] = [];
  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    results.push(await classifyFile(filePath, file, parentFolder, ''));
  }
  return results;
}

/** Month-folder scan — files sit inside YYYYMM (or YYYY) subdirectories. */
async function scanFolderSource(
  source: SourceDefinition,
  sourceDir: string
): Promise<ClassifiedFile[]> {
  const folders = fs
    .readdirSync(sourceDir)
    .filter((entry) => source.monthFolderPattern.test(entry))
    .filter((entry) => fs.statSync(path.join(sourceDir, entry)).isDirectory());

  const isYearFolder = /^\d{4}$/.test(folders[0] ?? '');
  const results: ClassifiedFile[] = [];

  for (const folder of folders) {
    const folderPath = path.join(sourceDir, folder);

    const files = fs
      .readdirSync(folderPath)
      .filter((f) => path.extname(f).toLowerCase() === source.fileExtension);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const monthKey = isYearFolder
        ? (monthKeyFromFilename(file) ?? folder)
        : folderToMonthKey(folder);
      results.push(await classifyFile(filePath, file, folder, monthKey));
    }
  }
  return results;
}

export async function scanSource(source: SourceDefinition): Promise<ClassifiedFile[]> {
  const sourceDir = buildSourcePath(source);

  if (!fs.existsSync(sourceDir)) {
    console.warn(`[scanner] Source directory not found: ${sourceDir}`);
    return [];
  }

  return source.flatFile
    ? scanFlatSource(source, sourceDir)
    : scanFolderSource(source, sourceDir);
}

export function buildPreview(source: SourceDefinition, files: ClassifiedFile[]): PreviewResult {
  const periods = [...new Set(files.map((f) => f.monthKey).filter(Boolean))].sort();
  return {
    source: source.name,
    label: source.label,
    files_new: files.filter((f) => f.status === 'new').length,
    files_updated: files.filter((f) => f.status === 'updated').length,
    files_unchanged: files.filter((f) => f.status === 'unchanged').length,
    periods,
  };
}
