import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireClientCredentialsToken,
  logoutAuth,
  resolveAuthFilePath,
  resolveAuthStatus,
  resolveClientCredentials,
  resolveStoredAuthConfig,
  storeClientCredentials,
  storeOAuthConfig,
  storeOAuthTokenSet,
} from "../src/auth";

let configRoot: string;
const TEST_KEYRING_PASSWORD = "test-keyring-password";

function makeEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    XDG_CONFIG_HOME: configRoot,
    XERO_KEYRING_PASSWORD: TEST_KEYRING_PASSWORD,
    ...overrides,
  };
}

beforeEach(() => {
  configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xero-cli-auth-test-"));
});

afterEach(() => {
  fs.rmSync(configRoot, { recursive: true, force: true });
});

describe("resolveAuthStatus", () => {
  it("returns not configured when env vars are missing", () => {
    const status = resolveAuthStatus(makeEnv());
    expect(status).toEqual({
      authMode: null,
      hasClientId: false,
      hasClientSecret: false,
      isConfigured: false,
      credentialSource: null,
      tokenExpiresAt: null,
      authFilePath: resolveAuthFilePath(makeEnv()),
    });
  });

  it("returns configured when both credentials exist", () => {
    const status = resolveAuthStatus(
      makeEnv({
        XERO_CLIENT_ID: "client-id",
        XERO_CLIENT_SECRET: "client-secret",
      }),
    );
    expect(status).toEqual({
      authMode: "client_credentials",
      hasClientId: true,
      hasClientSecret: true,
      isConfigured: true,
      credentialSource: "env",
      tokenExpiresAt: null,
      authFilePath: resolveAuthFilePath(makeEnv()),
    });
  });

  it("loads configured credentials from file", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());

    const status = resolveAuthStatus(makeEnv());
    expect(status).toEqual({
      authMode: "client_credentials",
      hasClientId: true,
      hasClientSecret: true,
      isConfigured: true,
      credentialSource: "file",
      tokenExpiresAt: null,
      authFilePath: resolveAuthFilePath(makeEnv()),
    });
  });

  it("does not fall back to file when env values are incomplete", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());

    const status = resolveAuthStatus(
      makeEnv({
        XERO_CLIENT_ID: "   ",
        XERO_CLIENT_SECRET: "secret",
      }),
    );
    expect(status).toEqual({
      authMode: null,
      hasClientId: false,
      hasClientSecret: true,
      isConfigured: false,
      credentialSource: null,
      tokenExpiresAt: null,
      authFilePath: resolveAuthFilePath(makeEnv()),
    });
  });

  it("reports oauth mode and token expiry from stored file metadata", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    storeOAuthConfig(
      {
        clientId: "oauth-client-id",
        clientSecret: "oauth-client-secret",
        redirectUri: "http://127.0.0.1:53535/callback",
        scopes: ["offline_access", "accounting.transactions.read"],
      },
      makeEnv(),
    );
    storeOAuthTokenSet(
      {
        access_token: "oauth-access",
        refresh_token: "oauth-refresh",
        token_type: "Bearer",
        expires_at: expiresAt,
        scope: "accounting.transactions",
      },
      makeEnv(),
    );

    const status = resolveAuthStatus(makeEnv());
    expect(status).toEqual({
      authMode: "oauth",
      hasClientId: true,
      hasClientSecret: true,
      isConfigured: true,
      credentialSource: "file",
      tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
      authFilePath: resolveAuthFilePath(makeEnv()),
    });
  });
});

describe("acquireClientCredentialsToken", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests token and maps response fields", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token-value",
          token_type: "Bearer",
          expires_in: 1800,
          scope: "accounting.transactions",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const token = await acquireClientCredentialsToken({
      XDG_CONFIG_HOME: configRoot,
      XERO_CLIENT_ID: "client-id",
      XERO_CLIENT_SECRET: "client-secret",
      XERO_SCOPES: "accounting.transactions accounting.reports.read",
    });

    expect(token).toEqual({
      mode: "client_credentials",
      accessToken: "access-token-value",
      tokenType: "Bearer",
      expiresIn: 1800,
      scope: "accounting.transactions",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://identity.xero.com/connect/token");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    const expectedCredentials = Buffer.from("client-id:client-secret").toString(
      "base64",
    );
    expect(headers.Authorization).toBe(`Basic ${expectedCredentials}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Accept).toBe("application/json");

    const params = new URLSearchParams(String(init.body));
    expect(params.get("grant_type")).toBe("client_credentials");
    expect(params.get("scope")).toBe(
      "accounting.transactions accounting.reports.read",
    );
  });

  it("throws when required credentials are missing", async () => {
    await expect(
      acquireClientCredentialsToken(
        makeEnv({ XERO_CLIENT_SECRET: "secret" }),
      ),
    ).rejects.toThrow(
      "Incomplete client credentials in environment. Set both XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses stored file credentials when env credentials are missing", async () => {
    storeClientCredentials("file-client-id", "file-client-secret", makeEnv());

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token-value",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await acquireClientCredentialsToken(makeEnv());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expectedCredentials = Buffer.from(
      "file-client-id:file-client-secret",
    ).toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expectedCredentials}`);
  });

  it("throws when token endpoint returns JSON error", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_description: "invalid_client" }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      acquireClientCredentialsToken({
        XERO_CLIENT_ID: "client-id",
        XERO_CLIENT_SECRET: "bad-secret",
      }),
    ).rejects.toThrow(
      "Token request failed (401 Unauthorized): invalid_client",
    );
  });

  it("throws when success response does not contain access_token", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ token_type: "Bearer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      acquireClientCredentialsToken({
        XERO_CLIENT_ID: "client-id",
        XERO_CLIENT_SECRET: "client-secret",
      }),
    ).rejects.toThrow("Token request succeeded but access_token is missing.");
  });
});

describe("storeClientCredentials / resolveClientCredentials", () => {
  it("stores credentials in auth file and resolves from file", () => {
    const authPath = storeClientCredentials(
      "stored-id",
      "stored-secret",
      makeEnv(),
    );

    expect(authPath).toBe(resolveAuthFilePath(makeEnv()));
    expect(fs.existsSync(authPath)).toBe(true);
    const raw = fs.readFileSync(authPath, "utf8");
    expect(raw).not.toContain("stored-id");
    expect(raw).not.toContain("stored-secret");

    const resolved = resolveClientCredentials(makeEnv());
    expect(resolved).toEqual({
      clientId: "stored-id",
      clientSecret: "stored-secret",
      source: "file",
    });
  });

  it("prefers environment credentials over file credentials", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());

    const resolved = resolveClientCredentials(
      makeEnv({
        XERO_CLIENT_ID: "env-id",
        XERO_CLIENT_SECRET: "env-secret",
      }),
    );
    expect(resolved).toEqual({
      clientId: "env-id",
      clientSecret: "env-secret",
      source: "env",
    });
  });

  it("throws for incomplete env credentials even when file exists", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());

    expect(() =>
      resolveClientCredentials(
        makeEnv({
          XERO_CLIENT_ID: "env-id",
        }),
      ),
    ).toThrow(
      "Incomplete client credentials in environment. Set both XERO_CLIENT_ID and XERO_CLIENT_SECRET.",
    );
  });

  it("throws when keyring password is missing for file credentials", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());

    expect(() =>
      resolveClientCredentials({
        XDG_CONFIG_HOME: configRoot,
      }),
    ).toThrow("Missing XERO_KEYRING_PASSWORD.");
  });

  it("throws when keyring password is wrong for file credentials", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());

    expect(() =>
      resolveClientCredentials({
        XDG_CONFIG_HOME: configRoot,
        XERO_KEYRING_PASSWORD: "wrong-password",
      }),
    ).toThrow(`Failed to decrypt auth file "${resolveAuthFilePath(makeEnv())}".`);
  });

  it("throws when stored mode is oauth and client credentials are requested", () => {
    storeOAuthConfig(
      {
        clientId: "oauth-client-id",
        clientSecret: "oauth-client-secret",
        redirectUri: "http://127.0.0.1:53535/callback",
        scopes: ["offline_access", "accounting.transactions.read"],
      },
      makeEnv(),
    );
    storeOAuthTokenSet(
      {
        access_token: "oauth-access",
        refresh_token: "oauth-refresh",
      },
      makeEnv(),
    );

    expect(() => resolveClientCredentials(makeEnv())).toThrow(
      'Stored auth mode is "oauth". Stored file does not contain client_credentials.',
    );
  });
});

describe("oauth storage scaffold", () => {
  it("stores and resolves oauth config without token set", () => {
    storeOAuthConfig(
      {
        clientId: "oauth-client-id",
        clientSecret: "oauth-client-secret",
        redirectUri: "http://127.0.0.1:53535/callback",
        scopes: ["offline_access", "accounting.transactions.read"],
      },
      makeEnv(),
    );

    const oauthState = resolveStoredAuthConfig(makeEnv());
    expect(oauthState).toEqual({
      mode: "oauth",
      clientId: "oauth-client-id",
      clientSecret: "oauth-client-secret",
      redirectUri: "http://127.0.0.1:53535/callback",
      scopes: ["offline_access", "accounting.transactions.read"],
      tokenSet: undefined,
    });
  });
});

describe("logoutAuth", () => {
  it("deletes stored auth file when it exists", () => {
    const authPath = storeClientCredentials(
      "stored-id",
      "stored-secret",
      makeEnv(),
    );
    expect(fs.existsSync(authPath)).toBe(true);

    const result = logoutAuth(makeEnv());
    expect(result).toEqual({
      deleted: true,
      authFilePath: authPath,
    });
    expect(fs.existsSync(authPath)).toBe(false);
  });

  it("returns deleted=false when auth file does not exist", () => {
    const authPath = resolveAuthFilePath(makeEnv());
    const result = logoutAuth(makeEnv());
    expect(result).toEqual({
      deleted: false,
      authFilePath: authPath,
    });
  });

  it("makes status unconfigured after logout (without env credentials)", () => {
    storeClientCredentials("stored-id", "stored-secret", makeEnv());
    expect(resolveAuthStatus(makeEnv()).isConfigured).toBe(true);

    logoutAuth(makeEnv());
    const status = resolveAuthStatus(makeEnv());
    expect(status.isConfigured).toBe(false);
    expect(status.credentialSource).toBe(null);
  });
});
