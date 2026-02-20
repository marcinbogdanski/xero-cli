#!/usr/bin/env node

import { Command } from "commander";
import { resolveAuthStatus, resolveAuthTokenSummary } from "./auth";
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

const tenants = program.command("tenants").description("Tenant commands");

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

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
