export interface MigrationConfig {
  slackChannel: string;
  teamsTeamId: string;
  teamsChannelId: string;
  oldest?: string;
  latest?: string;
}

export interface MessageRecord {
  teamsMessageId: string;
  isThreadParent: boolean;
  migratedAt: string;
}

export interface ReplyRecord {
  teamsReplyId: string;
  parentTeamsMessageId: string;
  migratedAt: string;
}

export interface FileRecord {
  sharePointUrl: string;
  sharePointItemId: string;
  migratedAt: string;
}

export interface ErrorRecord {
  slackTs: string;
  error: string;
  timestamp: string;
  retryable: boolean;
}

export interface MigrationStats {
  totalSlackMessages: number;
  totalSlackReplies: number;
  migratedMessages: number;
  migratedReplies: number;
  skippedMessages: number;
  skippedReplies: number;
  failedMessages: number;
  filesUploaded: number;
  startedAt: string;
  lastUpdatedAt: string;
}

export interface MigrationState {
  version: 1;
  config: MigrationConfig;
  status: "in_progress" | "completed" | "failed";
  migrationModeActive: boolean;
  messages: Record<string, MessageRecord>;
  replies: Record<string, ReplyRecord>;
  files: Record<string, FileRecord>;
  errors: ErrorRecord[];
  stats: MigrationStats;
}

export interface NormalizedSlackMessage {
  ts: string;
  threadTs?: string;
  user: string;
  text: string;
  subtype?: string;
  files?: SlackFile[];
  reactions?: SlackReaction[];
  replyCount?: number;
  isThreadParent: boolean;
  botId?: string;
}

export interface SlackFile {
  id: string;
  name: string;
  urlPrivate: string;
  mimetype: string;
  size: number;
}

export interface SlackReaction {
  name: string;
  count: number;
  users: string[];
}

export interface ThreadedChannel {
  topLevelMessages: NormalizedSlackMessage[];
  threads: Map<string, NormalizedSlackMessage[]>;
}

export interface TeamsMessagePayload {
  createdDateTime?: string;
  from?: {
    user: {
      id?: string;
      displayName: string;
      userIdentityType: string;
    };
  };
  body: {
    contentType: "html";
    content: string;
  };
  attachments?: TeamsAttachment[];
}

export interface TeamsAttachment {
  id: string;
  contentType: string;
  contentUrl: string;
  name: string;
}
