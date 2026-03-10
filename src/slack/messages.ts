import { SlackClient } from "./client";
import { logger } from "../utils/logger";
import type {
  NormalizedSlackMessage,
  ThreadedChannel,
  SlackFile,
  SlackReaction,
} from "../state/types";

export interface FetchOptions {
  channel: string;
  oldest?: string;
  latest?: string;
}

function normalizeMessage(msg: Record<string, unknown>): NormalizedSlackMessage {
  const files: SlackFile[] = Array.isArray(msg.files)
    ? msg.files.map((f: Record<string, unknown>) => ({
        id: f.id as string,
        name: (f.name as string) || "untitled",
        urlPrivate: f.url_private as string,
        mimetype: (f.mimetype as string) || "application/octet-stream",
        size: (f.size as number) || 0,
      }))
    : [];

  const reactions: SlackReaction[] = Array.isArray(msg.reactions)
    ? msg.reactions.map((r: Record<string, unknown>) => ({
        name: r.name as string,
        count: r.count as number,
        users: (r.users as string[]) || [],
      }))
    : [];

  const ts = msg.ts as string;
  const threadTs = msg.thread_ts as string | undefined;
  const replyCount = (msg.reply_count as number) || 0;

  return {
    ts,
    threadTs,
    user: (msg.user as string) || (msg.bot_id as string) || "unknown",
    text: (msg.text as string) || "",
    subtype: msg.subtype as string | undefined,
    files: files.length > 0 ? files : undefined,
    reactions: reactions.length > 0 ? reactions : undefined,
    replyCount: replyCount > 0 ? replyCount : undefined,
    isThreadParent: replyCount > 0 || (threadTs === ts && replyCount > 0),
    botId: msg.bot_id as string | undefined,
  };
}

export async function fetchChannelHistory(
  client: SlackClient,
  options: FetchOptions
): Promise<NormalizedSlackMessage[]> {
  const messages: NormalizedSlackMessage[] = [];
  let cursor: string | undefined;

  logger.info(`Fetching messages from Slack channel ${options.channel}...`);

  do {
    const result = await client.limiter.schedule(() =>
      client.web.conversations.history({
        channel: options.channel,
        oldest: options.oldest,
        latest: options.latest,
        inclusive: true,
        limit: 200,
        cursor,
      })
    );

    if (result.messages) {
      for (const msg of result.messages) {
        messages.push(normalizeMessage(msg as Record<string, unknown>));
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
    logger.debug(`Fetched ${messages.length} messages so far...`);
  } while (cursor);

  // Sort chronologically (oldest first)
  messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  logger.info(`Fetched ${messages.length} total messages from channel`);
  return messages;
}

export async function fetchThreadReplies(
  client: SlackClient,
  channel: string,
  threadTs: string
): Promise<NormalizedSlackMessage[]> {
  const replies: NormalizedSlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.limiter.schedule(() =>
      client.web.conversations.replies({
        channel,
        ts: threadTs,
        limit: 200,
        cursor,
      })
    );

    if (result.messages) {
      for (const msg of result.messages) {
        const normalized = normalizeMessage(msg as Record<string, unknown>);
        // Skip the parent message (first message in replies is the parent)
        if (normalized.ts !== threadTs) {
          replies.push(normalized);
        }
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  // Sort chronologically
  replies.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

  return replies;
}

export async function buildThreadedChannel(
  client: SlackClient,
  options: FetchOptions
): Promise<ThreadedChannel> {
  const allMessages = await fetchChannelHistory(client, options);

  // Separate top-level messages from reply_broadcast messages
  const topLevelMessages: NormalizedSlackMessage[] = [];
  const threadParentTs = new Set<string>();

  for (const msg of allMessages) {
    // Identify thread parents
    if (msg.replyCount && msg.replyCount > 0) {
      threadParentTs.add(msg.ts);
      msg.isThreadParent = true;
    }

    // Only include truly top-level messages (not thread replies that appeared in channel)
    if (!msg.threadTs || msg.threadTs === msg.ts) {
      topLevelMessages.push(msg);
    }
  }

  // Fetch thread replies for each thread parent
  const threads = new Map<string, NormalizedSlackMessage[]>();
  const threadParents = [...threadParentTs];

  if (threadParents.length > 0) {
    logger.info(`Fetching replies for ${threadParents.length} threads...`);
  }

  for (const parentTs of threadParents) {
    const replies = await fetchThreadReplies(client, options.channel, parentTs);
    if (replies.length > 0) {
      threads.set(parentTs, replies);
    }
    logger.debug(`Thread ${parentTs}: ${replies.length} replies`);
  }

  const totalReplies = [...threads.values()].reduce((sum, r) => sum + r.length, 0);
  logger.info(
    `Channel structure: ${topLevelMessages.length} top-level messages, ` +
      `${threads.size} threads with ${totalReplies} total replies`
  );

  return { topLevelMessages, threads };
}
