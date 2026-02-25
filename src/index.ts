#!/usr/bin/env node

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
import { renderOAuthScopesHelpText, resolveOAuthScopes } from "./scopes";
import { listTenants } from "./tenants";

const program = new Command();

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
  .command("test")
  .description("Test auth by requesting an access token")
  .action(async () => {
    await ensureRuntimeKeyringPassword(process.env);
    const status = resolveAuthStatus(process.env);
    const client = await createAuthenticatedClient(process.env);
    const token = client.readTokenSet();
    const tokenExpiresAt =
      typeof token.expires_at === "number"
        ? new Date(token.expires_at * 1000).toISOString()
        : null;
    const scope =
      Array.isArray(token.scope) ? token.scope.join(" ") : (token.scope ?? null);
    console.log("Auth test successful.");
    console.log(`  mode: ${status.authMode ?? "unknown"}`);
    console.log(`  credential source: ${status.credentialSource ?? "unknown"}`);
    console.log(`  token type: ${token.token_type ?? "unknown"}`);
    console.log(`  token expires at: ${tokenExpiresAt ?? "unknown"}`);
    console.log(`  scope: ${scope ?? "unknown"}`);
  });

auth
  .command("scopes")
  .description("List OAuth scope profiles and known scope tokens")
  .action(() => {
    process.stdout.write(renderOAuthScopesHelpText());
  });

auth
  .command("login")
  .description("Store authentication credentials")
  .option("--mode <mode>", "Authentication mode", "client_credentials")
  .option("--client-id <id>", "Client ID")
  .option("--client-secret <secret>", "Client secret")
  .option("--redirect-uri <uri>", "OAuth redirect URI")
  .option(
    "--scopes <scopes>",
    "OAuth scopes profile or comma-separated scopes",
    "core-read-only",
  )
  .option("--keyring-password <password>", "Keyring password")
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

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
