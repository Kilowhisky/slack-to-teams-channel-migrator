import * as fs from "fs/promises";
import { SlackClient } from "../slack/client";
import { TeamsClient } from "../teams/client";
import { logger } from "../utils/logger";

interface SlackUserProfile {
  id: string;
  email?: string;
  displayName: string;
  isBot: boolean;
  deleted: boolean;
}

interface UserMapEntry {
  slackId: string;
  slackName: string;
  email: string;
  aadId: string;
  aadDisplayName: string;
}

async function fetchSlackUsers(client: SlackClient): Promise<SlackUserProfile[]> {
  const users: SlackUserProfile[] = [];
  let cursor: string | undefined;

  logger.info("Fetching Slack workspace users...");

  do {
    const result = await client.limiter.schedule(() =>
      client.web.users.list({ cursor, limit: 200 })
    );

    if (result.members) {
      for (const member of result.members) {
        users.push({
          id: member.id as string,
          email: (member.profile as Record<string, unknown>)?.email as string | undefined,
          displayName:
            ((member.profile as Record<string, unknown>)?.display_name as string) ||
            ((member.profile as Record<string, unknown>)?.real_name as string) ||
            (member.name as string) ||
            (member.id as string),
          isBot: !!(member.is_bot || member.id === "USLACKBOT"),
          deleted: !!member.deleted,
        });
      }
    }

    cursor = (result.response_metadata as Record<string, string> | undefined)?.next_cursor || undefined;
  } while (cursor);

  logger.info(`Found ${users.length} Slack users`);
  return users;
}

async function lookupAadUserByEmail(
  client: TeamsClient,
  email: string
): Promise<{ id: string; displayName: string } | null> {
  try {
    // Try matching on mail first, then userPrincipalName
    const result = await client.limiter.schedule(() =>
      client.graph
        .api("/users")
        .filter(`mail eq '${escapeODataString(email)}' or userPrincipalName eq '${escapeODataString(email)}'`)
        .select("id,displayName,mail,userPrincipalName")
        .top(1)
        .get()
    );

    if (result.value && result.value.length > 0) {
      return {
        id: result.value[0].id,
        displayName: result.value[0].displayName,
      };
    }

    return null;
  } catch (err) {
    logger.debug(`Failed to look up AAD user for ${email}: ${err}`);
    return null;
  }
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}

export interface GenerateUserMapOptions {
  slackToken: string;
  teamsTenantId: string;
  teamsClientId: string;
  teamsClientSecret: string;
  outputFile: string;
  verbose: boolean;
}

export async function generateUserMap(options: GenerateUserMapOptions): Promise<void> {
  const slackClient = new SlackClient({ token: options.slackToken });
  const teamsClient = new TeamsClient({
    tenantId: options.teamsTenantId,
    clientId: options.teamsClientId,
    clientSecret: options.teamsClientSecret,
  });

  // Test connections
  const slackTeam = await slackClient.testAuth();
  logger.info(`Connected to Slack workspace: ${slackTeam}`);

  await teamsClient.testConnection();
  logger.info("Connected to Microsoft Graph API");

  // Fetch all Slack users
  const slackUsers = await fetchSlackUsers(slackClient);

  // Filter to real users with emails
  const usersWithEmail = slackUsers.filter(
    (u) => !u.isBot && !u.deleted && u.email
  );
  const botsSkipped = slackUsers.filter((u) => u.isBot).length;
  const deletedSkipped = slackUsers.filter((u) => u.deleted).length;
  const noEmailSkipped = slackUsers.filter(
    (u) => !u.isBot && !u.deleted && !u.email
  ).length;

  logger.info(
    `Users with email: ${usersWithEmail.length} ` +
      `(skipped: ${botsSkipped} bots, ${deletedSkipped} deleted, ${noEmailSkipped} no email)`
  );

  // Match against Azure AD
  const matched: UserMapEntry[] = [];
  const unmatched: { slackId: string; slackName: string; email: string }[] = [];

  logger.info("Matching Slack users to Azure AD accounts by email...");

  for (let i = 0; i < usersWithEmail.length; i++) {
    const user = usersWithEmail[i];
    process.stdout.write(
      `\r[${i + 1}/${usersWithEmail.length}] Looking up ${user.email}...`
    );

    const aadUser = await lookupAadUserByEmail(teamsClient, user.email!);

    if (aadUser) {
      matched.push({
        slackId: user.id,
        slackName: user.displayName,
        email: user.email!,
        aadId: aadUser.id,
        aadDisplayName: aadUser.displayName,
      });
    } else {
      unmatched.push({
        slackId: user.id,
        slackName: user.displayName,
        email: user.email!,
      });
    }
  }
  process.stdout.write("\n");

  // Build the mapping file (just slackId -> aadId)
  const mapping: Record<string, string> = {};
  for (const entry of matched) {
    mapping[entry.slackId] = entry.aadId;
  }

  await fs.writeFile(options.outputFile, JSON.stringify(mapping, null, 2), "utf-8");

  // Print results
  logger.info(`\n=== User Mapping Results ===`);
  logger.info(`Matched:   ${matched.length} users`);
  logger.info(`Unmatched: ${unmatched.length} users`);
  logger.info(`Output:    ${options.outputFile}`);

  if (matched.length > 0) {
    logger.info(`\nMatched users:`);
    for (const entry of matched) {
      logger.info(
        `  ${entry.slackName} (${entry.email}) -> ${entry.aadDisplayName} (${entry.aadId})`
      );
    }
  }

  if (unmatched.length > 0) {
    logger.info(`\nUnmatched users (no Azure AD account found for email):`);
    for (const entry of unmatched) {
      logger.info(`  ${entry.slackName} (${entry.email})`);
    }
    logger.info(
      `\nUnmatched users will appear with display names only (no Teams profile link).`
    );
  }

  logger.info(
    `\nUse this file with: slack-to-teams --user-map-file ${options.outputFile}`
  );
}
