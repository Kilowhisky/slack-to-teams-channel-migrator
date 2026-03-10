# Contributing

Thanks for your interest in contributing to slack-to-teams-channel-migrator! This guide will help you get started.

## Getting Started

```bash
git clone https://github.com/yourusername/slack-to-teams-channel-migrator.git
cd slack-to-teams-channel-migrator
npm install
```

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Watch mode for tests
npm run test:watch

# Run the CLI in development (without building)
npm run dev -- --help

# Run a specific subcommand
npm run dev -- validate --verbose ...
```

## Project Structure

```
src/
  index.ts              CLI entry point (commander)
  migrator.ts           Main migration orchestrator
  slack/
    client.ts           Slack API client wrapper
    messages.ts         Fetch channel history and threads
    users.ts            Resolve Slack user display names
    files.ts            Download file attachments from Slack
  teams/
    client.ts           Microsoft Graph API client wrapper
    migration-mode.ts   Start/complete Teams migration mode
    poster.ts           Post messages via migration API
    files.ts            Upload files to Teams/SharePoint
  transform/
    mrkdwn-to-html.ts   Convert Slack mrkdwn to Teams HTML
    message-formatter.ts Build Teams message payloads
  state/
    state-manager.ts    Idempotency tracking (JSON state file)
    types.ts            TypeScript interfaces
  tools/
    validate.ts         Preflight credential checks
    list-channels.ts    Discover channel IDs
    unlock-channel.ts   Emergency channel recovery
    status.ts           Display migration progress
    generate-user-map.ts Auto-match Slack users to Azure AD
  utils/
    logger.ts           Leveled logger
    rate-limiter.ts     Bottleneck rate limiters
    retry.ts            Exponential backoff with retry
    progress.ts         Terminal progress display
tests/
  transform/            Tests for mrkdwn and message formatting
  state/                Tests for state manager
```

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm run build` to check for compile errors
4. Run `npm test` to make sure all tests pass
5. Open a pull request

## Writing Tests

Tests use [Vitest](https://vitest.dev/) and live in the `tests/` directory, mirroring the `src/` structure.

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run tests/transform/mrkdwn-to-html.test.ts

# Watch mode
npm run test:watch
```

When adding new functionality, add tests covering the expected behavior. The existing test files are good examples of the patterns used.

## Reporting Issues

When filing a bug report, please include:

- The command you ran (redact tokens/secrets)
- The error message or unexpected behavior
- Node.js version (`node --version`)
- OS and version

## Code Style

- TypeScript strict mode is enabled
- Keep functions focused and small
- Use the existing logger (`src/utils/logger.ts`) instead of `console.log` in library code
- CLI output (user-facing) can use `console.log` directly

## Releases

Releases are published to npm automatically when a GitHub release is created. See the [release workflow](.github/workflows/release.yml) for details. Only maintainers can create releases.
