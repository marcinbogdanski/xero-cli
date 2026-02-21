#!/usr/bin/env node

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { resolveAuthStatus, storeClientCredentials } from "./auth";
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
  .command("login")
  .description("Store authentication credentials")
  .option("--mode <mode>", "Authentication mode", "client_credentials")
  .option("--client-id <id>", "Client ID")
  .option("--client-secret <secret>", "Client secret")
  .action(
    async (options: {
      mode: string;
      clientId?: string;
      clientSecret?: string;
    }) => {
      const mode = options.mode.trim().toLowerCase();
      if (mode !== "client_credentials") {
        throw new Error(
          `Unsupported auth mode "${options.mode}". Supported: client_credentials.`,
        );
      }

      const clientId =
        options.clientId?.trim() ??
        (await promptRequiredValue("Xero client ID: "));
      const clientSecret =
        options.clientSecret?.trim() ??
        (await promptRequiredValue("Xero client secret: "));

      const authFilePath = storeClientCredentials(
        clientId,
        clientSecret,
        process.env,
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
