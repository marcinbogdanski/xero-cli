import fs from "node:fs";
import path from "node:path";

export interface AuthStatus {
  authMode: "client_credentials" | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  isConfigured: boolean;
  credentialSource: "env" | "file" | null;
  authFilePath: string;
}

export interface ClientCredentialsToken {
  mode: "client_credentials";
  accessToken: string;
  tokenType: string | null;
  expiresIn: number | null;
  scope: string | string[] | null;
}

interface RawTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string | string[];
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
  source: "env" | "file";
}

function trimNonEmpty(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value && value.length > 0 ? value : undefined;
}

function resolveConfigHome(env: NodeJS.ProcessEnv): string {
  const xdgConfigHome = trimNonEmpty(env.XDG_CONFIG_HOME);
  if (xdgConfigHome) {
    return xdgConfigHome;
  }

  const home = trimNonEmpty(env.HOME);
  if (!home) {
    throw new Error("Cannot resolve config directory. Set HOME or XDG_CONFIG_HOME.");
  }

  return path.join(home, ".config");
}

export function resolveAuthFilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveConfigHome(env), "xero-cli", "auth.json");
}

function readStoredCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } | null {
  const filePath = resolveAuthFilePath(env);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(`Failed to parse auth file "${filePath}".`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Auth file "${filePath}" must contain an object.`);
  }

  const data = parsed as { clientId?: string; clientSecret?: string };
  const clientId = trimNonEmpty(data.clientId);
  const clientSecret = trimNonEmpty(data.clientSecret);
  if (!clientId || !clientSecret) {
    throw new Error(`Auth file "${filePath}" is missing credentials.`);
  }

  return {
    clientId,
    clientSecret,
  };
}

export function storeClientCredentials(
  clientIdRaw: string,
  clientSecretRaw: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const clientId = trimNonEmpty(clientIdRaw);
  const clientSecret = trimNonEmpty(clientSecretRaw);
  if (!clientId) {
    throw new Error("Client ID cannot be empty.");
  }
  if (!clientSecret) {
    throw new Error("Client secret cannot be empty.");
  }

  const authFilePath = resolveAuthFilePath(env);
  fs.mkdirSync(path.dirname(authFilePath), { recursive: true });

  const payload = {
    mode: "client_credentials",
    clientId,
    clientSecret,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(authFilePath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(authFilePath, 0o600);

  return authFilePath;
}

export function resolveClientCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ClientCredentials {
  const envProvided =
    env.XERO_CLIENT_ID !== undefined || env.XERO_CLIENT_SECRET !== undefined;

  if (envProvided) {
    const envClientId = trimNonEmpty(env.XERO_CLIENT_ID);
    const envClientSecret = trimNonEmpty(env.XERO_CLIENT_SECRET);
    if (!envClientId || !envClientSecret) {
      throw new Error(
        "Incomplete client credentials in environment. Set both XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
      );
    }

    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      source: "env",
    };
  }

  const stored = readStoredCredentials(env);
  if (stored) {
    return {
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      source: "file",
    };
  }

  throw new Error(
    "Missing client credentials. Set XERO_CLIENT_ID/XERO_CLIENT_SECRET or run `xero auth login --mode client_credentials`.",
  );
}

function buildTokenRequestBody(env: NodeJS.ProcessEnv): string {
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");

  const scopes = env.XERO_SCOPES?.trim();
  if (scopes) {
    body.set("scope", scopes);
  }

  return body.toString();
}

async function parseErrorDetail(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) {
    return "No response body";
  }

  try {
    const parsed = JSON.parse(raw) as {
      error_description?: string;
      error?: string;
      message?: string;
    };
    return (
      parsed.error_description ??
      parsed.error ??
      parsed.message ??
      raw
    );
  } catch {
    return raw;
  }
}

async function requestClientCredentialsToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RawTokenResponse> {
  const { clientId, clientSecret } = resolveClientCredentials(env);
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: buildTokenRequestBody(env),
  });

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new Error(
      `Token request failed (${response.status} ${response.statusText}): ${detail}`,
    );
  }

  return (await response.json()) as RawTokenResponse;
}

export async function acquireClientCredentialsToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClientCredentialsToken> {
  const token = await requestClientCredentialsToken(env);
  if (!token.access_token) {
    throw new Error("Token request succeeded but access_token is missing.");
  }

  return {
    mode: "client_credentials",
    accessToken: token.access_token,
    tokenType: token.token_type ?? null,
    expiresIn: token.expires_in ?? null,
    scope: token.scope ?? null,
  };
}

export function resolveAuthStatus(
  env: NodeJS.ProcessEnv = process.env,
): AuthStatus {
  const authFilePath = resolveAuthFilePath(env);
  const envProvided =
    env.XERO_CLIENT_ID !== undefined || env.XERO_CLIENT_SECRET !== undefined;

  if (envProvided) {
    const hasClientId = Boolean(trimNonEmpty(env.XERO_CLIENT_ID));
    const hasClientSecret = Boolean(trimNonEmpty(env.XERO_CLIENT_SECRET));
    const isConfigured = hasClientId && hasClientSecret;
    return {
      authMode: isConfigured ? "client_credentials" : null,
      hasClientId,
      hasClientSecret,
      isConfigured,
      credentialSource: isConfigured ? "env" : null,
      authFilePath,
    };
  }

  const stored = readStoredCredentials(env);
  if (stored) {
    return {
      authMode: "client_credentials",
      hasClientId: true,
      hasClientSecret: true,
      isConfigured: true,
      credentialSource: "file",
      authFilePath,
    };
  }

  return {
    authMode: null,
    hasClientId: false,
    hasClientSecret: false,
    isConfigured: false,
    credentialSource: null,
    authFilePath,
  };
}
