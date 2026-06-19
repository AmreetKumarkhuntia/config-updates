// Writes the previous version of a config object to a local backup file
// before it is overwritten in the bucket.

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getBackupDir } from "./config";
import { createLogger } from "./logger";

const log = createLogger("backup");

/**
 * Backs up `content` to `${BACKUP_DIR}/${bucket}/${dirname(path)}/${basename(path)}.<timestamp>.bak`.
 * Returns the absolute path of the written backup file.
 */
export async function writeLocalBackup(
  bucket: string,
  path: string,
  content: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safePath = path.replace(/^\/+/, ""); // strip any leading slashes
  const targetDir = resolve(getBackupDir(), bucket, dirname(safePath));
  await mkdir(targetDir, { recursive: true });
  const file = join(targetDir, `${basename(safePath)}.${timestamp}.bak`);
  await writeFile(file, content, "utf-8");
  log.info("backup written", {
    bucket,
    path,
    backupPath: file,
    bytes: Buffer.byteLength(content, "utf-8"),
  });
  return file;
}
