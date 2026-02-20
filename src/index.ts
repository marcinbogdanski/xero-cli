#!/usr/bin/env node

import { Command } from "commander";
import { resolveAuthStatus } from "./auth";

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

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
