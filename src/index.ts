#!/usr/bin/env node

import { Command } from "commander";
import { resolveAuthStatus, resolveAuthTokenSummary } from "./auth";
import { invokeXeroMethod } from "./invoke";
import { listTenants } from "./tenants";

const program = new Command();

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
  .command("token")
  .description("Acquire access token using client credentials")
  .action(async () => {
    const summary = await resolveAuthTokenSummary(process.env);
    console.log(JSON.stringify(summary, null, 2));
  });

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
