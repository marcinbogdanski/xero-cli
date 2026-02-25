#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { XeroClient } from "xero-node";
import {
  logoutAuth,
  resolveAuthStatus,
  storeClientCredentials,
  storeOAuthConfig,
  storeOAuthTokenSet,
} from "./auth";
import { createAuthenticatedClient } from "./client";
import { invokeXeroMethod } from "./invoke";
import { PROXY_HOST, PROXY_PORT, startProxyServer } from "./proxy";
import { renderOAuthScopesHelpText, resolveOAuthScopes } from "./scopes";
import { listTenants } from "./tenants";

const program = new Command();
const green = (value: string): string => `\u001b[32m${value}\u001b[0m`;

async function promptRequiredValue(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    for (;;) {
      const value = (await rl.question(prompt)).trim();
      if (value.length > 0) {
        return value;
      }
      console.error("Value cannot be empty.");
    }
  } finally {
    rl.close();
  }
}

async function promptRequiredValueHidden(prompt: string): Promise<string> {
  const ttyInput = input as NodeJS.ReadStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => void;
  };

  if (!ttyInput.isTTY || typeof ttyInput.setRawMode !== "function") {
    return promptRequiredValue(prompt);
  }

  for (;;) {
    output.write(prompt);
    const wasRaw = Boolean(ttyInput.isRaw);

    const value = await new Promise<string>((resolve, reject) => {
      let current = "";

      const cleanup = (): void => {
        ttyInput.off("data", onData);
        ttyInput.setRawMode?.(wasRaw);
        ttyInput.pause();
      };

      const onData = (chunk: Buffer | string): void => {
        const raw = chunk.toString("utf8");
        for (const char of raw) {
          if (char === "\u0003") {
            cleanup();
            output.write("\n");
            reject(new Error("Interrupted"));
            return;
          }

          if (char === "\r" || char === "\n") {
            cleanup();
            output.write("\n");
            resolve(current);
            return;
          }

          if (char === "\u007f" || char === "\b" || char === "\u0008") {
            if (current.length > 0) {
              current = current.slice(0, -1);
            }
            continue;
          }

          current += char;
        }
      };

      try {
        ttyInput.setRawMode(true);
        ttyInput.resume();
        ttyInput.on("data", onData);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    console.error("Value cannot be empty.");
  }
}

async function ensureRuntimeKeyringPassword(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.XERO_CLIENT_ID !== undefined || env.XERO_CLIENT_SECRET !== undefined) {
    return;
  }

  if (resolveAuthStatus(env).credentialSource !== "file") {
    return;
  }

  const fromEnv = env.XERO_KEYRING_PASSWORD?.trim();
  if (fromEnv) {
    process.env.XERO_KEYRING_PASSWORD = fromEnv;
    return;
  }

  process.env.XERO_KEYRING_PASSWORD = await promptRequiredValueHidden(
    "Keyring password: ",
  );
}

async function resolveLoginKeyringPassword(
  explicitPassword: string | undefined,
): Promise<string> {
  const fromOption = explicitPassword?.trim();
  if (fromOption) {
    return fromOption;
  }

  const fromEnv = process.env.XERO_KEYRING_PASSWORD?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  for (;;) {
    const created = await promptRequiredValueHidden("Create keyring password: ");
    const confirmed = await promptRequiredValueHidden(
      "Confirm keyring password: ",
    );
    if (created === confirmed) {
      return created;
    }
    console.error("Keyring passwords do not match. Please try again.");
  }
}

function resolveProxyInvokePayload(rawParams: string[]): {
  rawParams: string[];
  uploadedFiles?: Record<string, string>;
} {
  // In proxy mode, expand local .json args and upload local binary files.
  const uploadedFiles: Record<string, string> = {};
  const proxyRawParams = rawParams.map((token) => {
    if (!token.startsWith("--")) {
      return token;
    }

    const separatorIndex = token.indexOf("=");
    if (separatorIndex <= 0) {
      return token;
    }

    const name = token.slice(2, separatorIndex).trim();
    if (!name) {
      return token;
    }

    const value = token.slice(separatorIndex + 1).trim();
    if (!value.toLowerCase().endsWith(".json")) {
      if (existsSync(value)) {
        const stats = statSync(value);
        if (stats.isFile()) {
          uploadedFiles[name] = readFileSync(value).toString("base64");
        }
      }
      return token;
    }

    if (!existsSync(value)) {
      throw new Error(`Proxy JSON file does not exist: "${value}".`);
    }

    const stats = statSync(value);
    if (!stats.isFile()) {
      throw new Error(`Proxy JSON path is not a file: "${value}".`);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(readFileSync(value, "utf8"));
    } catch {
      throw new Error(`Proxy JSON file is invalid: "${value}".`);
    }

    return `${token.slice(0, separatorIndex + 1)}${JSON.stringify(parsedJson)}`;
  });

  return {
    rawParams: proxyRawParams,
    uploadedFiles:
      Object.keys(uploadedFiles).length > 0 ? uploadedFiles : undefined,
  };
}

program
  .name("xero")
  .description("Thin CLI wrapper around xero-node")
  .version("0.1.0");

program
  .command("about")
  .description("Show project summary")
  .action(() => {
    console.log("xero: thin CLI wrapper around xero-node");
  });

program
  .command("doctor")
  .description("Check direct/proxy chain and auth")
  .action(async () => {
    const proxyUrl = process.env.XERO_PROXY_URL?.trim();
    console.log("Checking app mode:");
    console.log(`  env var XERO_PROXY_URL: ${proxyUrl || "not set"}`);

    if (!proxyUrl) {
      console.log(`  app mode: ${green("direct")}`);
      console.log("");
      console.log("Keyring password:");
      await ensureRuntimeKeyringPassword(process.env);
      console.log("");

      console.log("Testing authentication:");
      const status = resolveAuthStatus(process.env);
      const client = await createAuthenticatedClient(process.env);
      const token = client.readTokenSet();
      const tokenExpiresAt =
        typeof token.expires_at === "number"
          ? new Date(token.expires_at * 1000).toISOString()
          : null;
      const scope =
        Array.isArray(token.scope)
          ? token.scope.join(" ")
          : (token.scope ?? null);
      console.log(`  result: ${green("success")}`);
      console.log(`  mode: ${status.authMode ?? "unknown"}`);
      console.log(`  credential source: ${status.credentialSource ?? "unknown"}`);
      console.log(`  token type: ${token.token_type ?? "unknown"}`);
      console.log(`  token expires at: ${tokenExpiresAt ?? "unknown"}`);
      console.log(`  scope: ${scope ?? "unknown"}`);
      console.log("");

      console.log("Testing token validity by calling xero.com endpoint:");
      const connections = await client.updateTenants(false);
      const connectionsCount = Array.isArray(connections)
        ? connections.length
        : 0;
      console.log(`  request: ${green("success")}`);
      console.log(`  connections found: ${connectionsCount}`);
      console.log("  token valid: yes");
      console.log("");
      console.log("Doctor summary:");
      console.log(`  status: ${green("ready")}`);
      console.log("  xero-cli is configured correctly and ready for commands.");
      return;
    }

    const proxyBaseUrl = proxyUrl.replace(/\/+$/, "");
    console.log("  app mode: proxy");
    console.log(`  proxy url: ${proxyBaseUrl}`);
    console.log("");
    console.log("Testing proxy reachability:");

    try {
      const health = await fetch(`${proxyBaseUrl}/healthz`);
      if (!health.ok) {
        throw new Error(`health check failed (${health.status})`);
      }
      console.log(`  result: ${green("success")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Testing proxy reachability failed: ${message}`);
    }
    console.log("");
    console.log("Testing server authentication:");

    const response = await fetch(`${proxyBaseUrl}/v1/doctor`, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    const raw = await response.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      if (
        parsed &&
        typeof parsed === "object" &&
        "error" in parsed &&
        typeof (parsed as { error?: unknown }).error === "string"
      ) {
        throw new Error(
          `Testing server authentication failed: ${(parsed as { error: string }).error}`,
        );
      }
      throw new Error(`Testing server authentication failed (${response.status}).`);
    }

    const doctor =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    const mode =
      "mode" in doctor && typeof doctor.mode === "string"
        ? doctor.mode
        : "unknown";
    const credentialSource =
      "credentialSource" in doctor &&
      typeof doctor.credentialSource === "string"
        ? doctor.credentialSource
        : "unknown";
    const tokenType =
      "tokenType" in doctor && typeof doctor.tokenType === "string"
        ? doctor.tokenType
        : "unknown";
    const tokenExpiresAt =
      "tokenExpiresAt" in doctor && typeof doctor.tokenExpiresAt === "string"
        ? doctor.tokenExpiresAt
        : "unknown";
    const scope =
      "scope" in doctor && typeof doctor.scope === "string"
        ? doctor.scope
        : "unknown";
    const connectionsCount =
      "connections" in doctor && typeof doctor.connections === "number"
        ? doctor.connections
        : null;

    console.log(`  result: ${green("success")}`);
    console.log(`  mode: ${mode}`);
    console.log(`  credential source: ${credentialSource}`);
    console.log(`  token type: ${tokenType}`);
    console.log(`  token expires at: ${tokenExpiresAt}`);
    console.log(`  scope: ${scope}`);
    console.log("");
    console.log("Testing server token validity by calling xero.com endpoint:");
    console.log(`  request: ${green("success")}`);
    console.log(
      `  connections found: ${connectionsCount === null ? "unknown" : connectionsCount}`,
    );
    console.log("  token valid: yes");
    console.log("");
    console.log("Doctor summary:");
    console.log(`  status: ${green("ready")}`);
    console.log("  xero-cli is configured correctly and ready for commands.");
  });

const auth = program
  .command("auth")
  .description("Authentication commands");

auth.action(() => {
  auth.outputHelp();
});

auth
  .command("status")
  .description("Show current auth configuration status")
  .action(() => {
    const status = resolveAuthStatus(process.env);
    console.log("Authentication status:");
    console.log(`  configured: ${status.isConfigured ? "yes" : "no"}`);
    console.log(`  mode: ${status.authMode ?? "none"}`);
    console.log(`  credential source: ${status.credentialSource ?? "none"}`);
    console.log(`  client id: ${status.hasClientId ? "present" : "missing"}`);
    console.log(
      `  client secret: ${status.hasClientSecret ? "present" : "missing"}`,
    );
    if (status.tokenExpiresAt) {
      console.log(`  token expires at: ${status.tokenExpiresAt}`);
    }
    console.log(`  auth file: ${status.authFilePath}`);
  });

auth
  .command("logout")
  .description("Remove stored authentication file")
  .action(() => {
    const result = logoutAuth(process.env);
    if (result.deleted) {
      console.log("Removed stored authentication file.");
    } else {
      console.log("No stored authentication file to remove.");
    }
    console.log(`Auth file: ${result.authFilePath}`);
  });

auth
  .command("scopes")
  .description("List OAuth scope profiles and known scope tokens")
  .action(() => {
    process.stdout.write(renderOAuthScopesHelpText());
  });

auth
  .command("login")
  .description(
    "Store authentication credentials (missing values are prompted interactively)",
  )
  .option("--mode <mode>", "Authentication mode", "client_credentials")
  .option(
    "--client-id <id>",
    "Client ID from Xero Developer app (must match configured app)",
  )
  .option(
    "--client-secret <secret>",
    "Client secret from Xero Developer app (must match configured app)",
  )
  .option(
    "--redirect-uri <uri>",
    "OAuth redirect URI (must exactly match callback URL configured in Xero Developer app)",
  )
  .option(
    "--scopes <scopes>",
    "OAuth scopes profile or comma-separated scopes",
    "core-read-only",
  )
  .option(
    "--keyring-password <password>",
    "New keyring password for encrypted local auth file (or existing password to reuse)",
  )
  .action(
    async (options: {
      mode: string;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      scopes?: string;
      keyringPassword?: string;
    }) => {
      const mode = options.mode.trim().toLowerCase();
      if (mode === "client_credentials") {
        const clientId =
          options.clientId?.trim() ??
          (await promptRequiredValue("Xero client ID: "));
        const clientSecret =
          options.clientSecret?.trim() ??
          (await promptRequiredValueHidden("Xero client secret: "));
        const keyringPassword = await resolveLoginKeyringPassword(
          options.keyringPassword,
        );

        const authFilePath = storeClientCredentials(
          clientId,
          clientSecret,
          process.env,
          keyringPassword,
        );
        console.log("Client credentials login complete.");
        console.log(`Auth file: ${authFilePath}`);
        return;
      }

      if (mode === "oauth") {
        const clientId =
          options.clientId?.trim() ??
          (await promptRequiredValue("Xero client ID: "));
        const clientSecret =
          options.clientSecret?.trim() ??
          (await promptRequiredValueHidden("Xero client secret: "));
        const redirectUri =
          options.redirectUri?.trim() ??
          process.env.XERO_REDIRECT_URI?.trim() ??
          (await promptRequiredValue("OAuth redirect URI: "));
        const resolvedScopes = resolveOAuthScopes(options.scopes);
        for (const warning of resolvedScopes.warnings) {
          console.error(`Warning: ${warning}`);
        }
        const scopes = resolvedScopes.scopes;
        const keyringPassword = await resolveLoginKeyringPassword(
          options.keyringPassword,
        );

        const oauthClient = new XeroClient({
          clientId,
          clientSecret,
          grantType: "authorization_code",
          redirectUris: [redirectUri],
          scopes,
        });

        await oauthClient.initialize();
        const consentUrl = await oauthClient.buildConsentUrl();
        const authFilePath = storeOAuthConfig(
          {
            clientId,
            clientSecret,
            redirectUri,
            scopes,
          },
          process.env,
          keyringPassword,
        );

        console.log("OAuth login initialized.");
        console.log("Open this URL in your browser to grant access:");
        console.log("");
        console.log(consentUrl);
        console.log("");
        const callbackUrl = await promptRequiredValue("Paste full callback URL: ");
        const tokenSet = await oauthClient.apiCallback(callbackUrl);
        storeOAuthTokenSet(tokenSet, process.env, keyringPassword);
        console.log("OAuth login complete.");
        return;
      }

      throw new Error(
        `Unsupported auth mode "${options.mode}". Supported: client_credentials, oauth.`,
      );
    },
  );

const tenants = program
  .command("tenants")
  .description("Tenant commands");

tenants.action(() => {
  tenants.outputHelp();
});

tenants
  .command("list")
  .description("List connected Xero tenants")
  .action(async () => {
    await ensureRuntimeKeyringPassword(process.env);
    const results = await listTenants(process.env);
    console.log(JSON.stringify(results, null, 2));
  });

program
  .command("proxy")
  .description(`Run invoke proxy server on ${PROXY_HOST}:${PROXY_PORT}`)
  .action(async () => {
    await ensureRuntimeKeyringPassword(process.env);
    await startProxyServer(process.env);
  });

program
  .command("invoke")
  .description('Invoke xero-node API method (pass params after "--")')
  .argument("<api>", "API alias (for example: accounting)")
  .argument("<method>", "Method name (for example: getOrganisations)")
  .option("--tenant-id <id>", "Tenant ID override")
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(
    async (
      api: string,
      method: string,
      options: { tenantId?: string },
      command: Command,
    ) => {
      const rawParams = command.args.slice(2);

      const proxyUrl = process.env.XERO_PROXY_URL?.trim();
      if (proxyUrl) {
        const proxyPayload = resolveProxyInvokePayload(rawParams);
        const response = await fetch(
          `${proxyUrl.replace(/\/+$/, "")}/v1/invoke`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              api,
              method,
              tenantId: options.tenantId,
              rawParams: proxyPayload.rawParams,
              uploadedFiles: proxyPayload.uploadedFiles,
            }),
          },
        );
        const raw = await response.text();
        let parsed: unknown = null;
        try {
          parsed = raw ? (JSON.parse(raw) as unknown) : null;
        } catch {
          parsed = null;
        }

        if (!response.ok) {
          if (
            parsed &&
            typeof parsed === "object" &&
            "error" in parsed &&
            typeof (parsed as { error?: unknown }).error === "string"
          ) {
            throw new Error((parsed as { error: string }).error);
          }
          throw new Error(raw || `Proxy request failed (${response.status}).`);
        }

        if (parsed === null && raw) {
          console.log(raw);
          return;
        }

        console.log(JSON.stringify(parsed, null, 2));
        return;
      }

      await ensureRuntimeKeyringPassword(process.env);
      const result = await invokeXeroMethod(
        {
          api,
          method,
          tenantId: options.tenantId,
          rawParams,
        },
        process.env,
      );
      console.log(JSON.stringify(result, null, 2));
    },
  );

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

if (process.env.XERO_PROXY_URL?.trim()) {
  const topLevelCommand = process.argv[2];
  if (topLevelCommand === "auth" || topLevelCommand === "tenants") {
    console.error(
      `Command "${topLevelCommand}" is disabled when XERO_PROXY_URL is set.`,
    );
    process.exit(1);
  }
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
