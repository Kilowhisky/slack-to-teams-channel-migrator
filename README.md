# Slack to Teams Channel Migrator

A CLI tool that migrates message history from a Slack channel to a Microsoft Teams channel using the Teams Migration API. Preserves original timestamps, author attribution, threaded conversations, and file attachments.

> This project was built and is maintained with the assistance of [Claude](https://claude.ai), an AI assistant by Anthropic.

## Features

- **Preserves message fidelity** - Original timestamps and author names are maintained via the Teams Migration API
- **Threaded conversations** - Slack threads are mapped to Teams reply threads
- **File attachments** - Files are downloaded from Slack and re-uploaded to the Teams channel's SharePoint folder
- **Idempotent** - Safe to interrupt and re-run; a state file tracks progress and prevents duplicate messages
- **Formatting conversion** - Slack mrkdwn is converted to Teams-compatible HTML (bold, italic, code, links, mentions, blockquotes, emoji)
- **Date range filtering** - Migrate a specific time window with `--oldest` and `--latest`
- **Dry-run mode** - Preview what would be migrated without posting anything
- **Private channel support** - Works with both public and private Slack channels

## Prerequisites

- **Node.js** >= 18
- **Slack Bot Token** with the following scopes:
  - `channels:history` (public channels)
  - `groups:history` (private channels)
  - `users:read` (resolve user display names)
  - `files:read` (download file attachments)
- **Azure AD App Registration** with application permissions:
  - `Teamwork.Migrate.All` (import messages with custom timestamps/authors)
  - `Files.ReadWrite.All` (upload file attachments to SharePoint)
  - Admin consent granted for both permissions

## Installation

```bash
npm install -g slack-to-teams-channel-migrator
```

Or clone and build from source:

```bash
git clone https://github.com/yourusername/slack-to-teams-channel-migrator.git
cd slack-to-teams-channel-migrator
npm install
npm run build
```

## Quick Start

```bash
slack-to-teams \
  --slack-token xoxb-your-slack-bot-token \
  --slack-channel C01ABCDEF \
  --teams-team-id your-teams-team-guid \
  --teams-channel-id "19:your-channel-id@thread.tacv2" \
  --teams-tenant-id your-azure-tenant-guid \
  --teams-client-id your-azure-app-client-id \
  --teams-client-secret your-azure-app-client-secret
```

Or use environment variables (supports `.env` files):

```bash
cp .env.example .env
# Edit .env with your credentials
slack-to-teams
```

## Configuration

### Slack Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:history`
   - `groups:history`
   - `users:read`
   - `files:read`
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
5. Get your channel ID: right-click the channel in Slack > **View channel details** > copy the ID at the bottom
6. For private channels, invite the bot to the channel first

### Azure AD / Teams Setup

1. Go to [Azure Portal > App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and create a new registration
2. Under **API permissions**, add:
   - Microsoft Graph > Application permissions > `Teamwork.Migrate.All`
   - Microsoft Graph > Application permissions > `Files.ReadWrite.All`
3. Click **Grant admin consent** for your organization
4. Under **Certificates & secrets**, create a new client secret
5. Note down: **Application (client) ID**, **Directory (tenant) ID**, and the **client secret value**
6. Get your Teams IDs:
   - Team ID: In Teams, click the three dots on the team > **Get link to team** > extract the `groupId` parameter
   - Channel ID: Click the three dots on the channel > **Get link to channel** > extract the channel ID (format: `19:...@thread.tacv2`)

### User Mapping (Optional)

To attribute messages to the correct Teams users, create a JSON file mapping Slack user IDs to Azure AD user IDs:

```json
{
  "U012AB3CD": "aad-user-guid-for-alice",
  "U098ZYX": "aad-user-guid-for-bob"
}
```

Pass it with `--user-map-file user-map.json`. Without this file, messages will show the correct display name but won't be linked to Teams user accounts.

## CLI Reference

```
slack-to-teams [options]

Required:
  --slack-token <token>          Slack Bot token (xoxb-...) [env: SLACK_TOKEN]
  --slack-channel <id>           Slack channel ID [env: SLACK_CHANNEL]
  --teams-team-id <id>           Teams team GUID [env: TEAMS_TEAM_ID]
  --teams-channel-id <id>        Teams channel ID [env: TEAMS_CHANNEL_ID]
  --teams-tenant-id <id>         Azure AD tenant ID [env: TEAMS_TENANT_ID]
  --teams-client-id <id>         Azure AD app client ID [env: TEAMS_CLIENT_ID]
  --teams-client-secret <secret> Azure AD app client secret [env: TEAMS_CLIENT_SECRET]

Optional:
  --oldest <date>                Earliest message date (ISO 8601 or Unix timestamp)
  --latest <date>                Latest message date (ISO 8601 or Unix timestamp)
  --state-file <path>            Path to state file (default: ./migration-state.json)
  --user-map-file <path>         Slack-to-Teams user ID mapping JSON file
  --dry-run                      Fetch and transform without posting to Teams
  --verbose                      Enable debug logging
  --version                      Display version
  --help                         Display help
```

## How It Works

The migration runs in 5 phases:

1. **Initialize** - Validate credentials, connect to both APIs, load/create state file
2. **Fetch** - Pull all messages and thread replies from the Slack channel (with pagination)
3. **Transform** - Convert Slack mrkdwn to HTML, download file attachments
4. **Post** - Start Teams migration mode (locks channel), import messages and replies chronologically, upload files to SharePoint, then complete migration (unlocks channel)
5. **Report** - Print summary of migrated, skipped, and failed messages

### Important: Channel Locking

The Teams Migration API **locks the target channel** during import (no one can send messages). The channel is unlocked when migration completes. If the process is interrupted, re-run the tool to resume and eventually unlock the channel.

### Resuming After Interruption

Simply re-run the same command. The state file tracks every migrated message, so:
- Already-migrated messages are skipped
- The migration continues from where it left off
- No duplicate messages are created

## Date Range Examples

```bash
# Migrate messages from 2024 onwards
slack-to-teams --oldest 2024-01-01T00:00:00Z ...

# Migrate a specific month
slack-to-teams --oldest 2024-03-01T00:00:00Z --latest 2024-04-01T00:00:00Z ...

# Using Unix timestamps
slack-to-teams --oldest 1704067200 ...
```

## Limitations

- **Reactions** are rendered as text in the message body (Teams migration API doesn't support programmatic reaction import)
- **Block Kit messages** use the plain text fallback
- **User @mentions** show as bold display names but are not clickable Teams mentions
- **Slack-specific features** (workflows, canvas, huddle recordings) are not migrated
- **DMs and group chats** are not supported (channel messages only)
- **Message edits** - only the latest version of each message is migrated

## Troubleshooting

### "Forbidden" or 403 error from Teams
- Ensure `Teamwork.Migrate.All` and `Files.ReadWrite.All` have admin consent
- Verify the Azure AD app has the correct permissions (Application, not Delegated)

### "Channel not found" error
- Double-check the team ID and channel ID format
- The channel ID should look like `19:abc123@thread.tacv2`

### Channel stuck in migration mode
If the process crashes and the channel remains locked, re-run the migration tool. It will detect the active migration and continue. Alternatively, you can call the `completeMigration` API manually.

### Rate limiting
The tool automatically handles rate limits with exponential backoff. Slack allows ~50 requests/minute, Teams allows 5 messages/second per channel. Large channels will take time.

## Contributing

Contributions are welcome! Please open an issue or pull request.

```bash
# Development
npm install
npm run dev -- --help

# Run tests
npm test

# Build
npm run build
```

## License

MIT
