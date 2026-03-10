#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { runMigration } from "./migrator";
import { generateUserMap } from "./tools/generate-user-map";
import { validate } from "./tools/validate";
import { listChannels } from "./tools/list-channels";
import { unlockChannel } from "./tools/unlock-channel";
import { showStatus } from "./tools/status";
import { setLogLevel } from "./utils/logger";

const program = new Command();

program
  .name("slack-to-teams")
  .description("Migrate messages from a Slack channel to a Microsoft Teams channel")
  .version("1.0.0");

// Default command: migrate
program
  .command("migrate", { isDefault: true })
  .description("Run the channel migration")
  .requiredOption(
    "--slack-token <token>",
    "Slack Bot token (xoxb-...) [env: SLACK_TOKEN]",
    process.env.SLACK_TOKEN
  )
  .requiredOption(
    "--slack-channel <id>",
    "Slack channel ID [env: SLACK_CHANNEL]",
    process.env.SLACK_CHANNEL
  )
  .requiredOption(
    "--teams-team-id <id>",
    "Teams team GUID [env: TEAMS_TEAM_ID]",
    process.env.TEAMS_TEAM_ID
  )
  .requiredOption(
    "--teams-channel-id <id>",
    "Teams channel ID [env: TEAMS_CHANNEL_ID]",
    process.env.TEAMS_CHANNEL_ID
  )
  .requiredOption(
    "--teams-tenant-id <id>",
    "Azure AD tenant ID [env: TEAMS_TENANT_ID]",
    process.env.TEAMS_TENANT_ID
  )
  .requiredOption(
    "--teams-client-id <id>",
    "Azure AD app client ID [env: TEAMS_CLIENT_ID]",
    process.env.TEAMS_CLIENT_ID
  )
  .requiredOption(
    "--teams-client-secret <secret>",
    "Azure AD app client secret [env: TEAMS_CLIENT_SECRET]",
    process.env.TEAMS_CLIENT_SECRET
  )
  .option(
    "--oldest <date>",
    "Earliest message date (ISO 8601 or Unix timestamp)"
  )
  .option(
    "--latest <date>",
    "Latest message date (ISO 8601 or Unix timestamp)"
  )
  .option(
    "--state-file <path>",
    "Path to migration state file",
    "./migration-state.json"
  )
  .option(
    "--user-map-file <path>",
    "Path to JSON file mapping Slack user IDs to Azure AD user IDs"
  )
  .option("--dry-run", "Fetch and transform messages without posting to Teams", false)
  .option("--concurrency <n>", "Number of concurrent Teams API requests for replies (1-5)", "1")
  .option("--verbose", "Enable debug logging", false)
  .action(async (opts) => {
    if (opts.verbose) {
      setLogLevel("debug");
    }

    try {
      await runMigration({
        slackToken: opts.slackToken,
        slackChannel: opts.slackChannel,
        teamsTeamId: opts.teamsTeamId,
        teamsChannelId: opts.teamsChannelId,
        teamsTenantId: opts.teamsTenantId,
        teamsClientId: opts.teamsClientId,
        teamsClientSecret: opts.teamsClientSecret,
        oldest: opts.oldest,
        latest: opts.latest,
        stateFile: opts.stateFile,
        userMapFile: opts.userMapFile,
        dryRun: opts.dryRun,
        concurrency: parseInt(opts.concurrency, 10),
      });
    } catch (err) {
      console.error(
        "\nMigration failed:",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });

// Subcommand: generate-user-map
program
  .command("generate-user-map")
  .description(
    "Generate a user mapping file by matching Slack users to Azure AD accounts via email address"
  )
  .requiredOption(
    "--slack-token <token>",
    "Slack Bot token (xoxb-...) [env: SLACK_TOKEN]",
    process.env.SLACK_TOKEN
  )
  .requiredOption(
    "--teams-tenant-id <id>",
    "Azure AD tenant ID [env: TEAMS_TENANT_ID]",
    process.env.TEAMS_TENANT_ID
  )
  .requiredOption(
    "--teams-client-id <id>",
    "Azure AD app client ID [env: TEAMS_CLIENT_ID]",
    process.env.TEAMS_CLIENT_ID
  )
  .requiredOption(
    "--teams-client-secret <secret>",
    "Azure AD app client secret [env: TEAMS_CLIENT_SECRET]",
    process.env.TEAMS_CLIENT_SECRET
  )
  .option(
    "-o, --output <path>",
    "Output file path for the user mapping JSON",
    "./user-map.json"
  )
  .option("--verbose", "Enable debug logging", false)
  .action(async (opts) => {
    if (opts.verbose) {
      setLogLevel("debug");
    }

    try {
      await generateUserMap({
        slackToken: opts.slackToken,
        teamsTenantId: opts.teamsTenantId,
        teamsClientId: opts.teamsClientId,
        teamsClientSecret: opts.teamsClientSecret,
        outputFile: opts.output,
        verbose: opts.verbose,
      });
    } catch (err) {
      console.error(
        "\nUser map generation failed:",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });

// Subcommand: validate
program
  .command("validate")
  .description("Preflight check: test credentials and verify channel access")
  .requiredOption(
    "--slack-token <token>",
    "Slack Bot token (xoxb-...) [env: SLACK_TOKEN]",
    process.env.SLACK_TOKEN
  )
  .requiredOption(
    "--slack-channel <id>",
    "Slack channel ID [env: SLACK_CHANNEL]",
    process.env.SLACK_CHANNEL
  )
  .requiredOption(
    "--teams-team-id <id>",
    "Teams team GUID [env: TEAMS_TEAM_ID]",
    process.env.TEAMS_TEAM_ID
  )
  .requiredOption(
    "--teams-channel-id <id>",
    "Teams channel ID [env: TEAMS_CHANNEL_ID]",
    process.env.TEAMS_CHANNEL_ID
  )
  .requiredOption(
    "--teams-tenant-id <id>",
    "Azure AD tenant ID [env: TEAMS_TENANT_ID]",
    process.env.TEAMS_TENANT_ID
  )
  .requiredOption(
    "--teams-client-id <id>",
    "Azure AD app client ID [env: TEAMS_CLIENT_ID]",
    process.env.TEAMS_CLIENT_ID
  )
  .requiredOption(
    "--teams-client-secret <secret>",
    "Azure AD app client secret [env: TEAMS_CLIENT_SECRET]",
    process.env.TEAMS_CLIENT_SECRET
  )
  .option("--verbose", "Enable debug logging", false)
  .action(async (opts) => {
    if (opts.verbose) setLogLevel("debug");
    try {
      await validate({
        slackToken: opts.slackToken,
        slackChannel: opts.slackChannel,
        teamsTeamId: opts.teamsTeamId,
        teamsChannelId: opts.teamsChannelId,
        teamsTenantId: opts.teamsTenantId,
        teamsClientId: opts.teamsClientId,
        teamsClientSecret: opts.teamsClientSecret,
      });
    } catch (err) {
      console.error("\nValidation failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Subcommand: list-channels
program
  .command("list-channels")
  .description("List Slack channels and/or Teams channels to find IDs")
  .option(
    "--slack-token <token>",
    "Slack Bot token (xoxb-...) [env: SLACK_TOKEN]",
    process.env.SLACK_TOKEN
  )
  .option(
    "--teams-tenant-id <id>",
    "Azure AD tenant ID [env: TEAMS_TENANT_ID]",
    process.env.TEAMS_TENANT_ID
  )
  .option(
    "--teams-client-id <id>",
    "Azure AD app client ID [env: TEAMS_CLIENT_ID]",
    process.env.TEAMS_CLIENT_ID
  )
  .option(
    "--teams-client-secret <secret>",
    "Azure AD app client secret [env: TEAMS_CLIENT_SECRET]",
    process.env.TEAMS_CLIENT_SECRET
  )
  .option("-s, --search <pattern>", "Filter channels by name")
  .option("--json", "Output as JSON", false)
  .option("--verbose", "Enable debug logging", false)
  .action(async (opts) => {
    if (opts.verbose) setLogLevel("debug");
    try {
      await listChannels({
        slackToken: opts.slackToken,
        teamsTenantId: opts.teamsTenantId,
        teamsClientId: opts.teamsClientId,
        teamsClientSecret: opts.teamsClientSecret,
        search: opts.search,
        json: opts.json,
      });
    } catch (err) {
      console.error("\nFailed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Subcommand: unlock-channel
program
  .command("unlock-channel")
  .description("Force-unlock a Teams channel stuck in migration mode")
  .requiredOption(
    "--teams-team-id <id>",
    "Teams team GUID [env: TEAMS_TEAM_ID]",
    process.env.TEAMS_TEAM_ID
  )
  .requiredOption(
    "--teams-channel-id <id>",
    "Teams channel ID [env: TEAMS_CHANNEL_ID]",
    process.env.TEAMS_CHANNEL_ID
  )
  .requiredOption(
    "--teams-tenant-id <id>",
    "Azure AD tenant ID [env: TEAMS_TENANT_ID]",
    process.env.TEAMS_TENANT_ID
  )
  .requiredOption(
    "--teams-client-id <id>",
    "Azure AD app client ID [env: TEAMS_CLIENT_ID]",
    process.env.TEAMS_CLIENT_ID
  )
  .requiredOption(
    "--teams-client-secret <secret>",
    "Azure AD app client secret [env: TEAMS_CLIENT_SECRET]",
    process.env.TEAMS_CLIENT_SECRET
  )
  .option("--state-file <path>", "Also update state file if provided")
  .option("--verbose", "Enable debug logging", false)
  .action(async (opts) => {
    if (opts.verbose) setLogLevel("debug");
    try {
      await unlockChannel({
        teamsTeamId: opts.teamsTeamId,
        teamsChannelId: opts.teamsChannelId,
        teamsTenantId: opts.teamsTenantId,
        teamsClientId: opts.teamsClientId,
        teamsClientSecret: opts.teamsClientSecret,
        stateFile: opts.stateFile,
      });
    } catch (err) {
      console.error("\nFailed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Subcommand: status
program
  .command("status")
  .description("Show migration progress from the state file")
  .option(
    "--state-file <path>",
    "Path to migration state file",
    "./migration-state.json"
  )
  .option("--json", "Output as JSON", false)
  .action(async (opts) => {
    try {
      await showStatus({ stateFile: opts.stateFile, json: opts.json });
    } catch (err) {
      console.error("\nFailed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
