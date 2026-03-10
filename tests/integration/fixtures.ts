// ── Raw Slack API response shapes (snake_case, pre-normalization) ────

export interface RawSlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
  files?: RawSlackFile[];
  reactions?: Array<{ name: string; count: number; users: string[] }>;
}

export interface RawSlackFile {
  id: string;
  name: string;
  url_private: string;
  mimetype: string;
  size: number;
}

// ── Factories ───────────────────────────────────────────────────────

export function makeRawSlackMessage(
  overrides: Partial<RawSlackMessage> = {}
): RawSlackMessage {
  return {
    ts: "1705432800.000100",
    user: "U001",
    text: "Hello world",
    reply_count: 0,
    ...overrides,
  };
}

export function makeRawSlackFile(
  overrides: Partial<RawSlackFile> = {}
): RawSlackFile {
  return {
    id: "F001",
    name: "document.pdf",
    url_private: "https://files.slack.com/files-pri/T123/F001/document.pdf",
    mimetype: "application/pdf",
    size: 2048,
    ...overrides,
  };
}

// ── Slack API response wrappers ─────────────────────────────────────

export function makeSlackHistoryResponse(
  messages: RawSlackMessage[],
  nextCursor = ""
) {
  return {
    ok: true,
    messages,
    response_metadata: { next_cursor: nextCursor },
  };
}

export function makeSlackRepliesResponse(
  messages: RawSlackMessage[],
  nextCursor = ""
) {
  return {
    ok: true,
    messages,
    response_metadata: { next_cursor: nextCursor },
  };
}

export function makeSlackUserResponse(
  userId: string,
  displayName: string
) {
  return {
    ok: true,
    user: {
      id: userId,
      profile: {
        display_name: displayName,
        real_name: displayName,
      },
      name: displayName.toLowerCase().replace(/\s+/g, "."),
    },
  };
}
