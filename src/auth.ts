export interface AuthStatus {
  authMode: "client_credentials" | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  isConfigured: boolean;
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

function hasValue(input: string | undefined): boolean {
  return typeof input === "string" && input.trim().length > 0;
}

function getRequiredEnvVar(
  env: NodeJS.ProcessEnv,
  name: "XERO_CLIENT_ID" | "XERO_CLIENT_SECRET",
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
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
  const clientId = getRequiredEnvVar(env, "XERO_CLIENT_ID");
  const clientSecret = getRequiredEnvVar(env, "XERO_CLIENT_SECRET");
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
  const hasClientId = hasValue(env.XERO_CLIENT_ID);
  const hasClientSecret = hasValue(env.XERO_CLIENT_SECRET);
  const isConfigured = hasClientId && hasClientSecret;

  return {
    authMode: isConfigured ? "client_credentials" : null,
    hasClientId,
    hasClientSecret,
    isConfigured,
  };
}
