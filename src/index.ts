#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { runMigration } from "./migrator";
import { setLogLevel } from "./utils/logger";

const program = new Command();

program
  .name("slack-to-teams")
  .description("Migrate messages from a Slack channel to a Microsoft Teams channel")
  .version("1.0.0")
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
      });
    } catch (err) {
      console.error(
        "\nMigration failed:",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });

program.parse();
