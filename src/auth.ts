import fs from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

export interface AuthStatus {
  authMode: "client_credentials" | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  isConfigured: boolean;
  credentialSource: "env" | "file" | null;
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

interface StoredAuthState {
  mode: "client_credentials";
  clientId: string;
  clientSecret: string;
  savedAt: string;
}

interface EncryptedAuthFile {
  version: 1;
  kdf: "scrypt";
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

  return {
    version: 1,
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
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
    const clientId = trimNonEmpty(parsed.clientId);
    const clientSecret = trimNonEmpty(parsed.clientSecret);
    if (!clientId || !clientSecret || parsed.mode !== "client_credentials") {
      throw new Error("payload_invalid");
    }

    return {
      mode: "client_credentials",
      clientId,
      clientSecret,
      savedAt: parsed.savedAt ?? new Date(0).toISOString(),
    };
  } catch {
    throw new Error(`Failed to decrypt auth file "${filePath}".`);
  }
}

function readStoredCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } | null {
  const filePath = resolveAuthFilePath(env);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const keyringPassword = resolveKeyringPassword(env);
  const raw = fs.readFileSync(filePath, "utf8");
  const encrypted = parseEncryptedAuthFile(raw, filePath);
  const state = decryptStoredAuthState(encrypted, keyringPassword, filePath);

  return {
    clientId: state.clientId,
    clientSecret: state.clientSecret,
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
  const keyringPassword = resolveKeyringPassword(env, keyringPasswordRaw);

  if (!clientId) {
    throw new Error("Client ID cannot be empty.");
  }
  if (!clientSecret) {
    throw new Error("Client secret cannot be empty.");
  }

  const authFilePath = resolveAuthFilePath(env);
  fs.mkdirSync(path.dirname(authFilePath), { recursive: true });

  const payload: StoredAuthState = {
    mode: "client_credentials",
    clientId,
    clientSecret,
    savedAt: new Date().toISOString(),
  };

  const encrypted = serializeEncryptedAuthFile(payload, keyringPassword);
  fs.writeFileSync(authFilePath, `${JSON.stringify(encrypted, null, 2)}\n`, {
    encoding: "utf8",
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

  if (fs.existsSync(authFilePath)) {
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
