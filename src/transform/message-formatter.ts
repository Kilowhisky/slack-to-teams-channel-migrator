import { convertMrkdwnToHtml, escapeHtml } from "./mrkdwn-to-html";
import type {
  NormalizedSlackMessage,
  TeamsMessagePayload,
  TeamsAttachment,
  SlackFile,
} from "../state/types";

export interface UserMapping {
  /** Slack user ID -> Azure AD user ID */
  aadIds: Map<string, string>;
  /** Slack user ID -> display name */
  displayNames: Map<string, string>;
}

function slackTsToIso(ts: string): string {
  const seconds = parseFloat(ts);
  return new Date(seconds * 1000).toISOString();
}

function formatReactionsHtml(
  reactions: NonNullable<NormalizedSlackMessage["reactions"]>
): string {
  const parts = reactions.map((r) => {
    const emoji = `:${r.name}:`;
    return `${emoji} ${r.count}`;
  });
  return `<p><small>Reactions: ${parts.join(", ")}</small></p>`;
}

function formatSubtypeMessage(msg: NormalizedSlackMessage, displayName: string): string {
  switch (msg.subtype) {
    case "channel_join":
      return `<i>${escapeHtml(displayName)} joined the channel</i>`;
    case "channel_leave":
      return `<i>${escapeHtml(displayName)} left the channel</i>`;
    case "channel_topic":
      return `<i>${escapeHtml(displayName)} set the channel topic: ${escapeHtml(msg.text)}</i>`;
    case "channel_purpose":
      return `<i>${escapeHtml(displayName)} set the channel purpose: ${escapeHtml(msg.text)}</i>`;
    case "channel_name":
      return `<i>${escapeHtml(displayName)} renamed the channel: ${escapeHtml(msg.text)}</i>`;
    case "me_message":
      return `<i>${escapeHtml(displayName)} ${escapeHtml(msg.text)}</i>`;
    case "bot_message":
      return null as unknown as string; // Process as normal message
    default:
      return null as unknown as string; // Process as normal message
  }
}

function formatFileAttachmentsHtml(
  files: SlackFile[],
  uploadedFiles?: Map<string, { url: string; name: string }>
): string {
  const parts = files.map((f) => {
    const uploaded = uploadedFiles?.get(f.id);
    if (uploaded) {
      return `<p>\u{1F4CE} <a href="${escapeHtml(uploaded.url)}">${escapeHtml(uploaded.name)}</a></p>`;
    }
    // Fallback to Slack URL (may expire)
    return `<p>\u{1F4CE} <a href="${escapeHtml(f.urlPrivate)}">${escapeHtml(f.name)}</a> (${formatBytes(f.size)})</p>`;
  });
  return parts.join("");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FormatOptions {
  userMapping: UserMapping;
  uploadedFiles?: Map<string, { url: string; name: string }>;
}

export function formatMessageForMigration(
  msg: NormalizedSlackMessage,
  options: FormatOptions
): TeamsMessagePayload {
  const displayName =
    options.userMapping.displayNames.get(msg.user) ?? msg.user;
  const aadId = options.userMapping.aadIds.get(msg.user);

  const userResolver = (userId: string) =>
    options.userMapping.displayNames.get(userId) ?? userId;

  // Handle special subtypes
  const subtypeHtml = formatSubtypeMessage(msg, displayName);
  let bodyContent: string;

  if (subtypeHtml) {
    bodyContent = subtypeHtml;
  } else {
    bodyContent = convertMrkdwnToHtml(msg.text, userResolver);
  }

  // Add file attachments
  if (msg.files && msg.files.length > 0) {
    bodyContent += formatFileAttachmentsHtml(msg.files, options.uploadedFiles);
  }

  // Add reactions
  if (msg.reactions && msg.reactions.length > 0) {
    bodyContent += formatReactionsHtml(msg.reactions);
  }

  const payload: TeamsMessagePayload = {
    createdDateTime: slackTsToIso(msg.ts),
    body: {
      contentType: "html",
      content: bodyContent,
    },
  };

  // Set the from user
  payload.from = {
    user: {
      ...(aadId ? { id: aadId } : {}),
      displayName,
      userIdentityType: aadId ? "aadUser" : "anonymousGuest",
    },
  };

  // Add Teams attachments for uploaded files
  if (msg.files && options.uploadedFiles) {
    const attachments: TeamsAttachment[] = [];
    for (const file of msg.files) {
      const uploaded = options.uploadedFiles.get(file.id);
      if (uploaded) {
        attachments.push({
          id: file.id,
          contentType: "reference",
          contentUrl: uploaded.url,
          name: uploaded.name,
        });
      }
    }
    if (attachments.length > 0) {
      payload.attachments = attachments;
    }
  }

  return payload;
}
