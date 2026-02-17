import fs from 'fs';
import path from 'path';

import { BACKUP_DIR } from './constants.js';

function getBackupDir(): string {
  return path.join(process.cwd(), BACKUP_DIR);
}

export function createBackup(filePaths: string[]): void {
  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  for (const filePath of filePaths) {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) continue;

    const relativePath = path.relative(process.cwd(), absPath);
    const backupPath = path.join(backupDir, relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(absPath, backupPath);
  }
}

export function restoreBackup(): void {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const relativePath = path.relative(backupDir, fullPath);
        const originalPath = path.join(process.cwd(), relativePath);
        fs.mkdirSync(path.dirname(originalPath), { recursive: true });
        fs.copyFileSync(fullPath, originalPath);
      }
    }
  };

  walk(backupDir);
}

export function clearBackup(): void {
  const backupDir = getBackupDir();
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
