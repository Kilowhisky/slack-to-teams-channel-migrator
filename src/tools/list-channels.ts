import { SlackClient } from "../slack/client";
import { TeamsClient } from "../teams/client";
import { logger } from "../utils/logger";

export interface ListChannelsOptions {
  slackToken?: string;
  teamsTenantId?: string;
  teamsClientId?: string;
  teamsClientSecret?: string;
  search?: string;
}

interface SlackChannelInfo {
  id: string;
  name: string;
  isPrivate: boolean;
  numMembers: number;
  topic: string;
}

interface TeamsChannelInfo {
  teamName: string;
  teamId: string;
  channelName: string;
  channelId: string;
  membershipType: string;
}

export async function listChannels(options: ListChannelsOptions): Promise<void> {
  const hasSlack = !!options.slackToken;
  const hasTeams = !!(options.teamsTenantId && options.teamsClientId && options.teamsClientSecret);

  if (!hasSlack && !hasTeams) {
    console.error(
      "Provide at least --slack-token or --teams-tenant-id/--teams-client-id/--teams-client-secret"
    );
    process.exitCode = 1;
    return;
  }

  if (hasSlack) {
    await listSlackChannels(options.slackToken!, options.search);
  }

  if (hasTeams) {
    await listTeamsChannels(
      options.teamsTenantId!,
      options.teamsClientId!,
      options.teamsClientSecret!,
      options.search
    );
  }
}

async function listSlackChannels(token: string, search?: string): Promise<void> {
  const client = new SlackClient({ token });
  const channels: SlackChannelInfo[] = [];
  let cursor: string | undefined;

  try {
    do {
      const result = await client.limiter.schedule(() =>
        client.web.conversations.list({
          types: "public_channel,private_channel",
          limit: 200,
          cursor,
          exclude_archived: true,
        })
      );

      if (result.channels) {
        for (const ch of result.channels) {
          channels.push({
            id: ch.id as string,
            name: ch.name as string,
            isPrivate: !!(ch.is_private),
            numMembers: (ch.num_members as number) || 0,
            topic: ((ch.topic as Record<string, unknown>)?.value as string) || "",
          });
        }
      }

      cursor =
        (result.response_metadata as Record<string, string> | undefined)?.next_cursor || undefined;
    } while (cursor);
  } catch (err) {
    console.error(`Failed to list Slack channels: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  // Filter by search
  let filtered = channels;
  if (search) {
    const pattern = search.toLowerCase();
    filtered = channels.filter(
      (ch) =>
        ch.name.toLowerCase().includes(pattern) ||
        ch.topic.toLowerCase().includes(pattern)
    );
  }

  // Sort by name
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n=== Slack Channels (${filtered.length}) ===`);
  if (filtered.length === 0) {
    console.log("  No channels found.");
    return;
  }

  // Calculate column widths
  const maxName = Math.max(...filtered.map((ch) => ch.name.length + 1), 10);
  const maxId = Math.max(...filtered.map((ch) => ch.id.length), 10);

  for (const ch of filtered) {
    const name = `#${ch.name}`.padEnd(maxName + 1);
    const id = ch.id.padEnd(maxId);
    const type = ch.isPrivate ? "private" : "public";
    const members = `${ch.numMembers} members`;
    console.log(`  ${name}  ${id}  (${type}, ${members})`);
  }
}

async function listTeamsChannels(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  search?: string
): Promise<void> {
  const client = new TeamsClient({ tenantId, clientId, clientSecret });
  const allChannels: TeamsChannelInfo[] = [];

  try {
    // List teams using application permissions
    const teamsResult = await client.graph
      .api("/groups")
      .filter("resourceProvisioningOptions/Any(x:x eq 'Team')")
      .select("id,displayName")
      .top(999)
      .get();

    const teams = teamsResult.value as Array<{ id: string; displayName: string }>;

    for (const team of teams) {
      try {
        const channelsResult = await client.graph
          .api(`/teams/${team.id}/channels`)
          .get();

        const channels = channelsResult.value as Array<{
          id: string;
          displayName: string;
          membershipType: string;
        }>;

        for (const ch of channels) {
          allChannels.push({
            teamName: team.displayName,
            teamId: team.id,
            channelName: ch.displayName,
            channelId: ch.id,
            membershipType: ch.membershipType || "standard",
          });
        }
      } catch (err) {
        logger.debug(`Failed to list channels for team ${team.displayName}: ${err}`);
      }
    }
  } catch (err) {
    console.error(`Failed to list Teams: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return;
  }

  // Filter by search
  let filtered = allChannels;
  if (search) {
    const pattern = search.toLowerCase();
    filtered = allChannels.filter(
      (ch) =>
        ch.teamName.toLowerCase().includes(pattern) ||
        ch.channelName.toLowerCase().includes(pattern)
    );
  }

  // Sort by team name, then channel name
  filtered.sort((a, b) => {
    const teamCmp = a.teamName.localeCompare(b.teamName);
    return teamCmp !== 0 ? teamCmp : a.channelName.localeCompare(b.channelName);
  });

  console.log(`\n=== Teams Channels (${filtered.length}) ===`);
  if (filtered.length === 0) {
    console.log("  No channels found.");
    return;
  }

  // Calculate column widths
  const maxLabel = Math.max(
    ...filtered.map((ch) => `${ch.teamName} / ${ch.channelName}`.length),
    20
  );

  for (const ch of filtered) {
    const label = `${ch.teamName} / ${ch.channelName}`.padEnd(maxLabel);
    console.log(`  ${label}  ${ch.channelId}  (${ch.membershipType})`);
  }

  // Also print team IDs for reference
  const uniqueTeams = [...new Map(filtered.map((ch) => [ch.teamId, ch.teamName])).entries()];
  if (uniqueTeams.length > 0) {
    console.log(`\n  Team IDs:`);
    for (const [id, name] of uniqueTeams) {
      console.log(`    ${name}: ${id}`);
    }
  }
}
