import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

export interface AuthStatus {
  authMode: "client_credentials" | "oauth" | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  isConfigured: boolean;
  credentialSource: "env" | "file" | null;
  tokenExpiresAt: string | null;
  authFilePath: string;
}

export interface AuthLogoutResult {
  deleted: boolean;
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

export interface BasicClientCredentials {
  clientId: string;
  clientSecret: string;
}

interface StoredClientCredentialsState {
  mode: "client_credentials";
  clientId: string;
  clientSecret: string;
  savedAt: string;
}

export interface OAuthTokenSetInput {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
  expires_in?: number;
  scope?: string | string[];
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface StoredOAuthState {
  mode: "oauth";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  tokenSet?: OAuthTokenSetInput;
  savedAt: string;
}

type StoredAuthState = StoredClientCredentialsState | StoredOAuthState;

export type StoredAuthConfig =
  | {
      mode: "client_credentials";
      clientId: string;
      clientSecret: string;
    }
  | {
      mode: "oauth";
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scopes: string[];
      tokenSet?: OAuthTokenSetInput;
    };

interface EncryptedAuthFile {
  version: 1;
  kdf: "scrypt";
  mode: "client_credentials" | "oauth";
  tokenExpiresAt?: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
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

function resolveKeyringPassword(
  env: NodeJS.ProcessEnv,
  explicitPassword?: string,
): string {
  const password =
    trimNonEmpty(explicitPassword) ?? trimNonEmpty(env.XERO_KEYRING_PASSWORD);
  if (!password) {
    throw new Error("Missing XERO_KEYRING_PASSWORD.");
  }
  return password;
}

function serializeEncryptedAuthFile(
  payload: StoredAuthState,
  keyringPassword: string,
): EncryptedAuthFile {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(keyringPassword, salt, 32);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const tokenExpiresAt =
    payload.mode === "oauth"
      ? resolveOAuthTokenExpiryIso(payload.tokenSet)
      : undefined;

  return {
    version: 1,
    kdf: "scrypt",
    mode: payload.mode,
    tokenExpiresAt: tokenExpiresAt ?? undefined,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function resolveOAuthTokenExpiryIso(
  tokenSet: OAuthTokenSetInput | undefined,
): string | null {
  if (!tokenSet) {
    return null;
  }
  if (typeof tokenSet.expires_at === "number" && Number.isFinite(tokenSet.expires_at)) {
    return new Date(tokenSet.expires_at * 1000).toISOString();
  }
  return null;
}

function normalizeOAuthScopes(raw: string[]): string[] {
  const scopes = raw
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  if (scopes.length === 0) {
    throw new Error("OAuth scopes cannot be empty.");
  }

  return scopes;
}

function parseEncryptedAuthFile(
  raw: string,
  filePath: string,
): EncryptedAuthFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse auth file "${filePath}".`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Auth file "${filePath}" must contain an object.`);
  }

  const value = parsed as Partial<EncryptedAuthFile>;
  if (value.version !== 1 || value.kdf !== "scrypt") {
    throw new Error(`Unsupported auth file format in "${filePath}".`);
  }

  const mode = value.mode ?? "client_credentials";
  if (mode !== "client_credentials" && mode !== "oauth") {
    throw new Error(`Auth file "${filePath}" has unsupported mode.`);
  }

  if (
    value.tokenExpiresAt !== undefined &&
    typeof value.tokenExpiresAt !== "string"
  ) {
    throw new Error(`Auth file "${filePath}" has invalid token expiry metadata.`);
  }

  if (
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error(`Auth file "${filePath}" is missing encrypted fields.`);
  }

  return {
    version: 1,
    kdf: "scrypt",
    mode,
    tokenExpiresAt: value.tokenExpiresAt,
    salt: value.salt,
    iv: value.iv,
    tag: value.tag,
    ciphertext: value.ciphertext,
  };
}

function decryptStoredAuthState(
  encrypted: EncryptedAuthFile,
  keyringPassword: string,
  filePath: string,
): StoredAuthState {
  try {
    const salt = Buffer.from(encrypted.salt, "base64");
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    const key = scryptSync(keyringPassword, salt, 32);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(plaintext) as Partial<StoredAuthState>;
    if (parsed.mode === "client_credentials") {
      const clientId = trimNonEmpty(parsed.clientId);
      const clientSecret = trimNonEmpty(parsed.clientSecret);
      if (!clientId || !clientSecret) {
        throw new Error("payload_invalid");
      }

      return {
        mode: "client_credentials",
        clientId,
        clientSecret,
        savedAt: parsed.savedAt ?? new Date(0).toISOString(),
      };
    }

    if (parsed.mode === "oauth") {
      const clientId = trimNonEmpty(parsed.clientId);
      const clientSecret = trimNonEmpty(parsed.clientSecret);
      const redirectUri = trimNonEmpty(parsed.redirectUri);
      const scopes = Array.isArray(parsed.scopes)
        ? normalizeOAuthScopes(parsed.scopes.filter((item): item is string => typeof item === "string"))
        : null;
      if (!clientId || !clientSecret || !redirectUri || !scopes) {
        throw new Error("payload_invalid");
      }

      const tokenSet =
        parsed.tokenSet && typeof parsed.tokenSet === "object"
          ? (parsed.tokenSet as OAuthTokenSetInput)
          : undefined;

      return {
        mode: "oauth",
        clientId,
        clientSecret,
        redirectUri,
        scopes,
        tokenSet,
        savedAt: parsed.savedAt ?? new Date(0).toISOString(),
      };
    }

    throw new Error("payload_invalid");
  } catch {
    throw new Error(`Failed to decrypt auth file "${filePath}".`);
  }
}

function readStoredAuthState(
  env: NodeJS.ProcessEnv = process.env,
  keyringPasswordRaw?: string,
): StoredAuthState | null {
  const filePath = resolveAuthFilePath(env);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const keyringPassword = resolveKeyringPassword(env, keyringPasswordRaw);
  const raw = fs.readFileSync(filePath, "utf8");
  const encrypted = parseEncryptedAuthFile(raw, filePath);
  return decryptStoredAuthState(encrypted, keyringPassword, filePath);
}

function writeStoredAuthState(
  payload: StoredAuthState,
  env: NodeJS.ProcessEnv = process.env,
  keyringPasswordRaw?: string,
): string {
  const keyringPassword = resolveKeyringPassword(env, keyringPasswordRaw);
  const authFilePath = resolveAuthFilePath(env);
  fs.mkdirSync(path.dirname(authFilePath), { recursive: true });

  const encrypted = serializeEncryptedAuthFile(payload, keyringPassword);
  fs.writeFileSync(authFilePath, `${JSON.stringify(encrypted, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.chmodSync(authFilePath, 0o600);

  return authFilePath;
}

export function resolveEnvClientCredentials(
  env: NodeJS.ProcessEnv = process.env,
): BasicClientCredentials | null {
  const envProvided =
    env.XERO_CLIENT_ID !== undefined || env.XERO_CLIENT_SECRET !== undefined;

  if (!envProvided) {
    return null;
  }

  const clientId = trimNonEmpty(env.XERO_CLIENT_ID);
  const clientSecret = trimNonEmpty(env.XERO_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error(
      "Incomplete client credentials in environment. Set both XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
    );
  }

  return { clientId, clientSecret };
}

export function resolveStoredAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  keyringPasswordRaw?: string,
): StoredAuthConfig | null {
  const state = readStoredAuthState(env, keyringPasswordRaw);
  if (!state) {
    return null;
  }

  if (state.mode === "client_credentials") {
    return {
      mode: "client_credentials",
      clientId: state.clientId,
      clientSecret: state.clientSecret,
    };
  }

  return {
    mode: "oauth",
    clientId: state.clientId,
    clientSecret: state.clientSecret,
    redirectUri: state.redirectUri,
    scopes: state.scopes,
    tokenSet: state.tokenSet,
  };
}

export function storeClientCredentials(
  clientIdRaw: string,
  clientSecretRaw: string,
  env: NodeJS.ProcessEnv = process.env,
  keyringPasswordRaw?: string,
): string {
  const clientId = trimNonEmpty(clientIdRaw);
  const clientSecret = trimNonEmpty(clientSecretRaw);
  if (!clientId) {
    throw new Error("Client ID cannot be empty.");
  }
  if (!clientSecret) {
    throw new Error("Client secret cannot be empty.");
  }

  const payload: StoredClientCredentialsState = {
    mode: "client_credentials",
    clientId,
    clientSecret,
    savedAt: new Date().toISOString(),
  };

  return writeStoredAuthState(payload, env, keyringPasswordRaw);
}

export function storeOAuthConfig(
  config: OAuthClientConfig,
  env: NodeJS.ProcessEnv = process.env,
  keyringPasswordRaw?: string,
): string {
  const clientId = trimNonEmpty(config.clientId);
  const clientSecret = trimNonEmpty(config.clientSecret);
  const redirectUri = trimNonEmpty(config.redirectUri);
  const scopes = normalizeOAuthScopes(config.scopes);

  if (!clientId) {
    throw new Error("OAuth client ID cannot be empty.");
  }
  if (!clientSecret) {
    throw new Error("OAuth client secret cannot be empty.");
  }
  if (!redirectUri) {
    throw new Error("OAuth redirect URI cannot be empty.");
  }

  const payload: StoredOAuthState = {
    mode: "oauth",
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    savedAt: new Date().toISOString(),
  };

  return writeStoredAuthState(payload, env, keyringPasswordRaw);
}

export function storeOAuthTokenSet(
  tokenSet: OAuthTokenSetInput,
  env: NodeJS.ProcessEnv = process.env,
  keyringPasswordRaw?: string,
): string {
  const state = readStoredAuthState(env, keyringPasswordRaw);
  if (!state || state.mode !== "oauth") {
    throw new Error(
      "OAuth config is missing. Run `xero auth login --mode oauth` first.",
    );
  }

  const payload: StoredOAuthState = {
    mode: "oauth",
    clientId: state.clientId,
    clientSecret: state.clientSecret,
    redirectUri: state.redirectUri,
    scopes: state.scopes,
    tokenSet,
    savedAt: new Date().toISOString(),
  };

  return writeStoredAuthState(payload, env, keyringPasswordRaw);
}

export function resolveClientCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ClientCredentials {
  const envCredentials = resolveEnvClientCredentials(env);
  if (envCredentials) {
    return {
      clientId: envCredentials.clientId,
      clientSecret: envCredentials.clientSecret,
      source: "env",
    };
  }

  const stored = resolveStoredAuthConfig(env);
  if (!stored) {
    throw new Error(
      "Missing client credentials. Set XERO_CLIENT_ID/XERO_CLIENT_SECRET or run `xero auth login --mode client_credentials`.",
    );
  }
  if (stored.mode !== "client_credentials") {
    throw new Error(
      `Stored auth mode is "${stored.mode}". Stored file does not contain client_credentials.`,
    );
  }

  return {
    clientId: stored.clientId,
    clientSecret: stored.clientSecret,
    source: "file",
  };
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

export async function acquireClientCredentialsTokenForCredentials(
  credentials: BasicClientCredentials,
  scopeValue: string | undefined,
): Promise<ClientCredentialsToken> {
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  const scopes = scopeValue?.trim();
  if (scopes) {
    body.set("scope", scopes);
  }

  const encoded = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  const response = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new Error(
      `Token request failed (${response.status} ${response.statusText}): ${detail}`,
    );
  }

  const token = (await response.json()) as RawTokenResponse;
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

export async function acquireClientCredentialsToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ClientCredentialsToken> {
  const { clientId, clientSecret } = resolveClientCredentials(env);
  return acquireClientCredentialsTokenForCredentials(
    { clientId, clientSecret },
    env.XERO_SCOPES,
  );
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
      tokenExpiresAt: null,
      authFilePath,
    };
  }

  if (fs.existsSync(authFilePath)) {
    const encrypted = parseEncryptedAuthFile(
      fs.readFileSync(authFilePath, "utf8"),
      authFilePath,
    );
    return {
      authMode: encrypted.mode,
      hasClientId: true,
      hasClientSecret: true,
      isConfigured: true,
      credentialSource: "file",
      tokenExpiresAt: encrypted.tokenExpiresAt ?? null,
      authFilePath,
    };
  }

  return {
    authMode: null,
    hasClientId: false,
    hasClientSecret: false,
    isConfigured: false,
    credentialSource: null,
    tokenExpiresAt: null,
    authFilePath,
  };
}

export function logoutAuth(
  env: NodeJS.ProcessEnv = process.env,
): AuthLogoutResult {
  const authFilePath = resolveAuthFilePath(env);
  if (!fs.existsSync(authFilePath)) {
    return {
      deleted: false,
      authFilePath,
    };
  }

  fs.unlinkSync(authFilePath);
  return {
    deleted: true,
    authFilePath,
  };
}
