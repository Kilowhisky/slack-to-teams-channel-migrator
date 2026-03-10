import * as fs from "fs/promises";
import { TeamsClient } from "./client";
import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

const SMALL_FILE_THRESHOLD = 4 * 1024 * 1024; // 4MB

export interface UploadedFile {
  id: string;
  name: string;
  webUrl: string;
}

interface ChannelFilesFolder {
  driveId: string;
  folderId: string;
}

let cachedFilesFolder: ChannelFilesFolder | null = null;

export async function getChannelFilesFolder(
  client: TeamsClient,
  teamId: string,
  channelId: string
): Promise<ChannelFilesFolder> {
  if (cachedFilesFolder) return cachedFilesFolder;

  const folder = await client.graph
    .api(`/teams/${teamId}/channels/${channelId}/filesFolder`)
    .get();

  cachedFilesFolder = {
    driveId: folder.parentReference.driveId,
    folderId: folder.id,
  };

  return cachedFilesFolder;
}

export async function uploadFileToChannel(
  client: TeamsClient,
  teamId: string,
  channelId: string,
  localPath: string,
  fileName: string
): Promise<UploadedFile> {
  const folder = await getChannelFilesFolder(client, teamId, channelId);
  const fileBuffer = await fs.readFile(localPath);
  const fileSize = fileBuffer.length;

  // Sanitize filename
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");

  if (fileSize < SMALL_FILE_THRESHOLD) {
    return uploadSmallFile(client, folder, safeName, fileBuffer);
  } else {
    return uploadLargeFile(client, folder, safeName, localPath, fileSize);
  }
}

async function uploadSmallFile(
  client: TeamsClient,
  folder: ChannelFilesFolder,
  fileName: string,
  content: Buffer
): Promise<UploadedFile> {
  const result = await withRetry(async () => {
    return await client.graph
      .api(`/drives/${folder.driveId}/items/${folder.folderId}:/${fileName}:/content`)
      .putStream(content);
  });

  logger.debug(`Uploaded small file: ${fileName}`);

  return {
    id: result.id,
    name: result.name,
    webUrl: result.webUrl,
  };
}

async function uploadLargeFile(
  client: TeamsClient,
  folder: ChannelFilesFolder,
  fileName: string,
  localPath: string,
  fileSize: number
): Promise<UploadedFile> {
  // Create upload session
  const session = await client.graph
    .api(`/drives/${folder.driveId}/items/${folder.folderId}:/${fileName}:/createUploadSession`)
    .post({
      item: {
        "@microsoft.graph.conflictBehavior": "rename",
        name: fileName,
      },
    });

  const uploadUrl = session.uploadUrl;
  const fileBuffer = await fs.readFile(localPath);
  const chunkSize = 3.25 * 1024 * 1024; // 3.25MB chunks (must be multiple of 320KB)

  let offset = 0;
  let result: Record<string, unknown> | null = null;

  while (offset < fileSize) {
    const end = Math.min(offset + chunkSize, fileSize);
    const chunk = fileBuffer.subarray(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${fileSize}`;

    const response = await withRetry(async () => {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.length),
          "Content-Range": contentRange,
        },
        body: chunk,
      });

      if (!res.ok && res.status !== 202) {
        throw new Error(`Upload chunk failed: HTTP ${res.status}`);
      }

      return res.json();
    });

    offset = end;
    if (offset >= fileSize) {
      result = response as Record<string, unknown>;
    }

    logger.debug(`Uploaded chunk: ${contentRange}`);
  }

  if (!result) {
    throw new Error("Large file upload completed but no result returned");
  }

  logger.debug(`Uploaded large file: ${fileName}`);

  return {
    id: result.id as string,
    name: result.name as string,
    webUrl: result.webUrl as string,
  };
}
