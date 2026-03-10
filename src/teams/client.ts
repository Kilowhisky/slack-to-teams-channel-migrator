import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import Bottleneck from "bottleneck";
import { createTeamsLimiter } from "../utils/rate-limiter";

export interface TeamsClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class TeamsClient {
  readonly graph: Client;
  readonly limiter: Bottleneck;

  constructor(options: TeamsClientOptions) {
    const credential = new ClientSecretCredential(
      options.tenantId,
      options.clientId,
      options.clientSecret
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });

    this.graph = Client.initWithMiddleware({
      authProvider,
    });

    this.limiter = createTeamsLimiter();
  }

  async testConnection(): Promise<void> {
    // Verify we can access the Graph API
    await this.graph.api("/organization").get();
  }
}
