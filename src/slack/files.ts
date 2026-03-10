import * as fs from "fs/promises";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { logger } from "../utils/logger";
import type { SlackFile } from "../state/types";

export async function downloadSlackFile(
  file: SlackFile,
  token: string,
  destDir: string
): Promise<string> {
  await fs.mkdir(destDir, { recursive: true });

  // Use file ID in the filename to avoid collisions
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = path.join(destDir, `${file.id}_${safeName}`);

  // Check if already downloaded
  try {
    const stat = await fs.stat(destPath);
    if (stat.size > 0) {
      logger.debug(`File already downloaded: ${destPath}`);
      return destPath;
    }
  } catch {
    // File doesn't exist, proceed with download
  }

  logger.debug(`Downloading file: ${file.name} (${formatBytes(file.size)})`);

  return new Promise<string>((resolve, reject) => {
    const url = new URL(file.urlPrivate);
    const client = url.protocol === "https:" ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      async (res) => {
        // Handle redirects
        if (res.statusCode === 302 || res.statusCode === 301) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            try {
              const result = await downloadFromUrl(redirectUrl, destPath);
              resolve(result);
            } catch (err) {
              reject(err);
            }
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", async () => {
          try {
            await fs.writeFile(destPath, Buffer.concat(chunks));
            resolve(destPath);
          } catch (err) {
            reject(err);
          }
        });
        res.on("error", reject);
      }
    );

    req.on("error", reject);
  });
}

function downloadFromUrl(url: string, destPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;

    client.get(parsedUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download file: HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", async () => {
        try {
          await fs.writeFile(destPath, Buffer.concat(chunks));
          resolve(destPath);
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
