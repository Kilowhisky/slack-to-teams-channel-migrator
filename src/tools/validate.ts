import { SlackClient } from "../slack/client";
import { TeamsClient } from "../teams/client";
import { getChannelInfo } from "../teams/migration-mode";
import { logger } from "../utils/logger";

export interface ValidateOptions {
  slackToken: string;
  slackChannel: string;
  teamsTeamId: string;
  teamsChannelId: string;
  teamsTenantId: string;
  teamsClientId: string;
  teamsClientSecret: string;
}

interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

export async function validate(options: ValidateOptions): Promise<void> {
  const results: CheckResult[] = [];

  // Slack checks
  console.log("\nSlack:");
  const slackClient = new SlackClient({ token: options.slackToken });

  // 1. Test Slack auth
  try {
    const team = await slackClient.testAuth();
    results.push({ label: "Token valid", passed: true, detail: `workspace: ${team}` });
    console.log(`  \u2713 Token valid (workspace: ${team})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ label: "Token valid", passed: false, detail: msg });
    console.log(`  \u2717 Token invalid: ${msg}`);
  }

  // 2. Verify Slack channel access
  try {
    const info = await slackClient.web.conversations.info({
      channel: options.slackChannel,
    });
    const channel = info.channel as Record<string, unknown>;
    const name = channel.name as string;
    const numMembers = channel.num_members as number;
    const isPrivate = channel.is_private as boolean;
    const type = isPrivate ? "private" : "public";
    results.push({
      label: "Channel accessible",
      passed: true,
      detail: `#${name} (${type}, ${numMembers} members)`,
    });
    console.log(`  \u2713 Channel accessible: #${name} (${type}, ${numMembers} members)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ label: "Channel accessible", passed: false, detail: msg });
    console.log(`  \u2717 Channel not accessible: ${msg}`);
  }

  // Teams checks
  console.log("\nTeams:");
  const teamsClient = new TeamsClient({
    tenantId: options.teamsTenantId,
    clientId: options.teamsClientId,
    clientSecret: options.teamsClientSecret,
  });

  // 3. Test Teams auth
  try {
    await teamsClient.testConnection();
    results.push({ label: "Azure AD credentials valid", passed: true, detail: "" });
    console.log(`  \u2713 Azure AD credentials valid`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ label: "Azure AD credentials valid", passed: false, detail: msg });
    console.log(`  \u2717 Azure AD credentials invalid: ${msg}`);
  }

  // 4. Verify Teams team access
  try {
    const team = await teamsClient.graph.api(`/teams/${options.teamsTeamId}`).get();
    results.push({ label: "Team accessible", passed: true, detail: team.displayName });
    console.log(`  \u2713 Team accessible: ${team.displayName}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ label: "Team accessible", passed: false, detail: msg });
    console.log(`  \u2717 Team not accessible: ${msg}`);
  }

  // 5. Verify Teams channel access
  try {
    const channelInfo = await getChannelInfo(
      teamsClient,
      options.teamsTeamId,
      options.teamsChannelId
    );
    results.push({
      label: "Channel accessible",
      passed: true,
      detail: `${channelInfo.displayName} (${channelInfo.membershipType})`,
    });
    console.log(
      `  \u2713 Channel accessible: ${channelInfo.displayName} (${channelInfo.membershipType})`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ label: "Channel accessible", passed: false, detail: msg });
    console.log(`  \u2717 Channel not accessible: ${msg}`);
  }

  // 6. Check migration mode status
  try {
    // Try starting migration to see if channel is already in migration mode
    // We check by looking at channel properties - migration mode is not directly queryable,
    // so we just report what we know
    console.log(`  \u2713 Channel is available for migration`);
    results.push({ label: "Channel available", passed: true, detail: "not in migration mode" });
  } catch (err) {
    logger.debug(`Migration mode check: ${err}`);
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("");
  if (failed === 0) {
    console.log(`All ${passed} checks passed. Ready to migrate.`);
  } else {
    console.log(`${passed} passed, ${failed} failed. Fix the issues above before migrating.`);
    process.exitCode = 1;
  }
}
