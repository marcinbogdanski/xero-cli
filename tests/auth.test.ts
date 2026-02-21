import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireClientCredentialsToken, resolveAuthStatus } from "../src/auth";

describe("resolveAuthStatus", () => {
  it("returns not configured when env vars are missing", () => {
    const status = resolveAuthStatus({});
    expect(status).toEqual({
      authMode: null,
      hasClientId: false,
      hasClientSecret: false,
      isConfigured: false,
    });
  });

  it("returns configured when both credentials exist", () => {
    const status = resolveAuthStatus({
      XERO_CLIENT_ID: "client-id",
      XERO_CLIENT_SECRET: "client-secret",
    });
    expect(status).toEqual({
      authMode: "client_credentials",
      hasClientId: true,
      hasClientSecret: true,
      isConfigured: true,
    });
  });

  it("treats whitespace-only values as missing", () => {
    const status = resolveAuthStatus({
      XERO_CLIENT_ID: "   ",
      XERO_CLIENT_SECRET: "secret",
    });
    expect(status).toEqual({
      authMode: null,
      hasClientId: false,
      hasClientSecret: true,
      isConfigured: false,
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
      acquireClientCredentialsToken({ XERO_CLIENT_SECRET: "secret" }),
    ).rejects.toThrow("Missing XERO_CLIENT_ID.");
    expect(fetchMock).not.toHaveBeenCalled();
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
