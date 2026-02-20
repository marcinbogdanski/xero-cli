import { XeroClient } from "xero-node";

function installPipeSafety(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }
    throw error;
  });
}

function isApiClient(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function listApiMethods(apiClient: Record<string, unknown>): string[] {
  const prototype = Object.getPrototypeOf(apiClient);
  if (!prototype) {
    return [];
  }

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor")
    .filter((name) => typeof prototype[name] === "function")
    .sort((a, b) => a.localeCompare(b));
}

function main(): void {
  installPipeSafety();

  const client = new XeroClient();
  const apiProperties = Object.keys(client)
    .filter((key) => key.endsWith("Api"))
    .sort((a, b) => a.localeCompare(b));

  for (const apiProperty of apiProperties) {
    const apiClient = (client as unknown as Record<string, unknown>)[apiProperty];
    if (!isApiClient(apiClient)) {
      continue;
    }

    const methods = listApiMethods(apiClient);
    for (const method of methods) {
      console.log(`${apiProperty}.${method}`);
    }
  }
}

main();
