import fs from "node:fs";
import path from "node:path";

interface ScopeCatalogEntry {
  scope_name: string;
  description?: string | null;
}

interface ScopeCatalog {
  metadata?: {
    date_created?: string;
    source_url?: string;
  };
  scopes?: ScopeCatalogEntry[];
  profiles?: Record<string, string[]>;
}

function loadScopeCatalog(): ScopeCatalog {
  const filePath = path.resolve(__dirname, "../resources/xero-scopes.json");
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Failed to read scope catalog "${filePath}".`);
  }

  try {
    return JSON.parse(raw) as ScopeCatalog;
  } catch {
    throw new Error(`Failed to parse scope catalog "${filePath}".`);
  }
}

export function renderOAuthScopesHelpText(): string {
  const catalog = loadScopeCatalog();
  const dateCreated = catalog.metadata?.date_created ?? "unknown";
  const sourceURL = catalog.metadata?.source_url ?? "unknown";
  const scopes = catalog.scopes ?? [];
  const profiles = catalog.profiles ?? {};
  const descriptionByScope = new Map<string, string>();

  for (const scope of scopes) {
    if (!descriptionByScope.has(scope.scope_name)) {
      descriptionByScope.set(scope.scope_name, String(scope.description ?? ""));
    }
  }

  const lines: string[] = [
    "OAuth scopes for `xero auth login --mode oauth --scopes=...`.",
    "Use a profile name or a comma-separated list of scope tokens.",
    "Manually scraped from Xero Api Docs, treat as guidance only.",
    "",
    "Date scraped: " + dateCreated,
    "Source URL: " + sourceURL,
    "",
    "Scopes:",
  ];

  for (const scope of scopes) {
    const description = descriptionByScope.get(scope.scope_name) ?? "";
    if (!description) {
      lines.push(`  ${scope.scope_name}`);
    } else {
      lines.push(`  ${scope.scope_name} - ${description}`);
    }
  }

  for (const [profileName, profileScopes] of Object.entries(profiles)) {
    lines.push("");
    lines.push(`Profile ${profileName}:`);

    for (const scopeNameRaw of profileScopes) {
      const scopeName = scopeNameRaw.trim();
      if (!scopeName) {
        continue;
      }
      const description = descriptionByScope.get(scopeName) ?? "";
      if (!description) {
        lines.push(`  ${scopeName}`);
      } else {
        lines.push(`  ${scopeName} - ${description}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
