import { SlackClient } from "../slack/client";
import { TeamsClient } from "../teams/client";
import { logger } from "../utils/logger";

export interface ListChannelsOptions {
  slackToken?: string;
  teamsTenantId?: string;
  teamsClientId?: string;
  teamsClientSecret?: string;
  search?: string;
  json?: boolean;
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

interface ListChannelsOutput {
  slack?: { channels: SlackChannelInfo[] };
  teams?: { channels: TeamsChannelInfo[] };
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

  const output: ListChannelsOutput = {};

  if (hasSlack) {
    const channels = await fetchSlackChannels(options.slackToken!, options.search);
    if (channels) output.slack = { channels };
  }

  if (hasTeams) {
    const channels = await fetchTeamsChannels(
      options.teamsTenantId!,
      options.teamsClientId!,
      options.teamsClientSecret!,
      options.search
    );
    if (channels) output.teams = { channels };
  }

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    if (output.slack) renderSlackText(output.slack.channels);
    if (output.teams) renderTeamsText(output.teams.channels);
  }
}

async function fetchSlackChannels(
  token: string,
  search?: string
): Promise<SlackChannelInfo[] | null> {
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
            isPrivate: !!ch.is_private,
            numMembers: (ch.num_members as number) || 0,
            topic: ((ch.topic as Record<string, unknown>)?.value as string) || "",
          });
        }
      }

      cursor =
        (result.response_metadata as Record<string, string> | undefined)?.next_cursor ||
        undefined;
    } while (cursor);
  } catch (err) {
    console.error(`Failed to list Slack channels: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return null;
  }

  let filtered = channels;
  if (search) {
    const pattern = search.toLowerCase();
    filtered = channels.filter(
      (ch) =>
        ch.name.toLowerCase().includes(pattern) ||
        ch.topic.toLowerCase().includes(pattern)
    );
  }

  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered;
}

async function fetchTeamsChannels(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  search?: string
): Promise<TeamsChannelInfo[] | null> {
  const client = new TeamsClient({ tenantId, clientId, clientSecret });
  const allChannels: TeamsChannelInfo[] = [];

  try {
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
    return null;
  }

  let filtered = allChannels;
  if (search) {
    const pattern = search.toLowerCase();
    filtered = allChannels.filter(
      (ch) =>
        ch.teamName.toLowerCase().includes(pattern) ||
        ch.channelName.toLowerCase().includes(pattern)
    );
  }

  filtered.sort((a, b) => {
    const teamCmp = a.teamName.localeCompare(b.teamName);
    return teamCmp !== 0 ? teamCmp : a.channelName.localeCompare(b.channelName);
  });

  return filtered;
}

function renderSlackText(channels: SlackChannelInfo[]): void {
  console.log(`\n=== Slack Channels (${channels.length}) ===`);
  if (channels.length === 0) {
    console.log("  No channels found.");
    return;
  }

  const maxName = Math.max(...channels.map((ch) => ch.name.length + 1), 10);
  const maxId = Math.max(...channels.map((ch) => ch.id.length), 10);

  for (const ch of channels) {
    const name = `#${ch.name}`.padEnd(maxName + 1);
    const id = ch.id.padEnd(maxId);
    const type = ch.isPrivate ? "private" : "public";
    const members = `${ch.numMembers} members`;
    console.log(`  ${name}  ${id}  (${type}, ${members})`);
  }
}

function renderTeamsText(channels: TeamsChannelInfo[]): void {
  console.log(`\n=== Teams Channels (${channels.length}) ===`);
  if (channels.length === 0) {
    console.log("  No channels found.");
    return;
  }

  const maxLabel = Math.max(
    ...channels.map((ch) => `${ch.teamName} / ${ch.channelName}`.length),
    20
  );

  for (const ch of channels) {
    const label = `${ch.teamName} / ${ch.channelName}`.padEnd(maxLabel);
    console.log(`  ${label}  ${ch.channelId}  (${ch.membershipType})`);
  }

  const uniqueTeams = [
    ...new Map(channels.map((ch) => [ch.teamId, ch.teamName])).entries(),
  ];
  if (uniqueTeams.length > 0) {
    console.log(`\n  Team IDs:`);
    for (const [id, name] of uniqueTeams) {
      console.log(`    ${name}: ${id}`);
    }
  }
}
