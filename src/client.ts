import { TokenSet, XeroClient } from "xero-node";
import {
  OAuthTokenSetInput,
  acquireClientCredentialsTokenForCredentials,
  resolveEnvClientCredentials,
  resolveStoredAuthConfig,
  storeOAuthTokenSet,
} from "./auth";

function parseScopes(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function createClientCredentialsClient(
  clientId: string,
  clientSecret: string,
  scopeValue: string | undefined,
  token: {
    accessToken: string;
    tokenType: string | null;
    expiresIn: number | null;
  },
): XeroClient {
  const client = new XeroClient({
    clientId,
    clientSecret,
    grantType: "client_credentials",
    scopes: parseScopes(scopeValue),
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

export async function createAuthenticatedClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<XeroClient> {
  const envCredentials = resolveEnvClientCredentials(env);
  if (envCredentials) {
    const token = await acquireClientCredentialsTokenForCredentials(
      envCredentials,
      env.XERO_SCOPES,
    );
    return createClientCredentialsClient(
      envCredentials.clientId,
      envCredentials.clientSecret,
      env.XERO_SCOPES,
      token,
    );
  }

  const storedAuth = resolveStoredAuthConfig(env);
  if (!storedAuth) {
    throw new Error(
      "Missing authentication configuration. Set XERO_CLIENT_ID/XERO_CLIENT_SECRET or run `xero auth login`.",
    );
  }

  if (storedAuth.mode === "client_credentials") {
    const token = await acquireClientCredentialsTokenForCredentials(
      {
        clientId: storedAuth.clientId,
        clientSecret: storedAuth.clientSecret,
      },
      env.XERO_SCOPES,
    );
    return createClientCredentialsClient(
      storedAuth.clientId,
      storedAuth.clientSecret,
      env.XERO_SCOPES,
      token,
    );
  } else if (storedAuth.mode === "oauth") {
    const client = new XeroClient({
      clientId: storedAuth.clientId,
      clientSecret: storedAuth.clientSecret,
      grantType: "authorization_code",
      redirectUris: [storedAuth.redirectUri],
      scopes: storedAuth.scopes,
    });

    await client.initialize();

    if (!storedAuth.tokenSet?.access_token) {
      throw new Error(
        "Stored OAuth token is missing. Run `xero auth callback --url ...` after OAuth login.",
      );
    }

    const normalizedTokenSet = {
      ...storedAuth.tokenSet,
      scope: Array.isArray(storedAuth.tokenSet.scope)
        ? storedAuth.tokenSet.scope.join(" ")
        : storedAuth.tokenSet.scope,
    };
    let tokenSet = new TokenSet(normalizedTokenSet);
    client.setTokenSet(tokenSet);

    const isExpired =
      typeof tokenSet.expired === "function"
        ? tokenSet.expired()
        : typeof tokenSet.expires_at === "number"
          ? tokenSet.expires_at * 1000 <= Date.now()
          : false;

    if (isExpired) {
      tokenSet = await client.refreshToken();
      storeOAuthTokenSet(tokenSet as unknown as OAuthTokenSetInput, env);
      client.setTokenSet(tokenSet);
    }

    return client;
  }

  throw new Error("Unsupported stored auth mode.");
}
