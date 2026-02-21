import { TokenSet, XeroClient } from "xero-node";
import { acquireClientCredentialsToken } from "./auth";

function parseScopes(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

export async function createAuthenticatedClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<XeroClient> {
  const token = await acquireClientCredentialsToken(env);

  const client = new XeroClient({
    clientId: env.XERO_CLIENT_ID?.trim() ?? "",
    clientSecret: env.XERO_CLIENT_SECRET?.trim() ?? "",
    grantType: "client_credentials",
    scopes: parseScopes(env.XERO_SCOPES),
  });

  client.setTokenSet(
    new TokenSet({
      access_token: token.accessToken,
      token_type: token.tokenType ?? "Bearer",
      expires_in: token.expiresIn ?? undefined,
    }),
  );

  return client;
}
