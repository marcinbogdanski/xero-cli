#!/usr/bin/env node

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  acquireClientCredentialsToken,
  logoutAuth,
  resolveAuthStatus,
  storeClientCredentials,
} from "./auth";
import { invokeXeroMethod } from "./invoke";
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
    console.log(JSON.stringify(status, null, 2));
  });

auth
  .command("logout")
  .description("Remove stored authentication file")
  .action(() => {
    const result = logoutAuth(process.env);
    console.log(JSON.stringify(result, null, 2));
  });

auth
  .command("test")
  .description("Test auth by requesting an access token")
  .action(async () => {
    await ensureRuntimeKeyringPassword(process.env);
    const status = resolveAuthStatus(process.env);
    const token = await acquireClientCredentialsToken(process.env);
    const result = {
      ok: true,
      mode: token.mode,
      credentialSource: status.credentialSource,
      tokenType: token.tokenType,
      expiresIn: token.expiresIn,
      scope: token.scope,
    };
    console.log(JSON.stringify(result, null, 2));
  });

auth
  .command("login")
  .description("Store authentication credentials")
  .option("--mode <mode>", "Authentication mode", "client_credentials")
  .option("--client-id <id>", "Client ID")
  .option("--client-secret <secret>", "Client secret")
  .option("--keyring-password <password>", "Keyring password")
  .action(
    async (options: {
      mode: string;
      clientId?: string;
      clientSecret?: string;
      keyringPassword?: string;
    }) => {
      const mode = options.mode.trim().toLowerCase();
      if (mode === "oauth") {
        throw new Error(
          "OAuth login scaffold: not implemented yet. TODO: consent URL + callback flow.",
        );
      }

      if (mode !== "client_credentials") {
        throw new Error(
          `Unsupported auth mode "${options.mode}". Supported: client_credentials, oauth.`,
        );
      }

      const clientId =
        options.clientId?.trim() ??
        (await promptRequiredValue("Xero client ID: "));
      const clientSecret =
        options.clientSecret?.trim() ??
        (await promptRequiredValueHidden("Xero client secret: "));
      const keyringPassword =
        options.keyringPassword?.trim() ??
        process.env.XERO_KEYRING_PASSWORD?.trim() ??
        (await promptRequiredValueHidden("Keyring password: "));

      const authFilePath = storeClientCredentials(
        clientId,
        clientSecret,
        process.env,
        keyringPassword,
      );
      console.log(
        JSON.stringify(
          {
            mode: "client_credentials",
            credentialSource: "file",
            authFilePath,
          },
          null,
          2,
        ),
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
