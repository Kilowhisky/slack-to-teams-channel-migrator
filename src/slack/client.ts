import { WebClient } from "@slack/web-api";
import Bottleneck from "bottleneck";
import { createSlackLimiter } from "../utils/rate-limiter";

export interface SlackClientOptions {
  token: string;
}

export class SlackClient {
  readonly web: WebClient;
  readonly limiter: Bottleneck;

  constructor(options: SlackClientOptions) {
    this.web = new WebClient(options.token, {
      retryConfig: {
        retries: 3,
      },
    });
    this.limiter = createSlackLimiter();
  }

  async testAuth(): Promise<string> {
    const result = await this.web.auth.test();
    if (!result.ok) {
      throw new Error("Slack authentication failed");
    }
    return result.team as string;
  }
}
