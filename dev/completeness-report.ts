import { XeroClient } from "xero-node";
import fs from "node:fs";
import path from "node:path";

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

interface MethodParameter {
  name: string;
  type: string;
}

interface MethodSignature {
  methodName: string;
  parameters: MethodParameter[];
}

const EXCLUDED_METHODS = new Set(["setApiKey", "setDefaultAuthentication"]);

const ANSI = {
  reset: "\x1b[0m",
  orange: "\x1b[38;5;214m",
};

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

function colorizeMethodName(name: string): string {
  if (!supportsColor()) {
    return name;
  }
  return `${ANSI.orange}${name}${ANSI.reset}`;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitParameterList(raw: string): string[] {
  if (!raw.trim()) {
    return [];
  }

  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let stringQuote = "";

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      current += ch;
      if (ch === stringQuote && raw[i - 1] !== "\\") {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringQuote = ch;
      current += ch;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
      depth -= 1;
    }

    if (ch === "," && depth === 0) {
      const item = current.trim();
      if (item) {
        result.push(item);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    result.push(tail);
  }

  return result;
}

function splitAtTopLevel(raw: string, delimiter: string): [string, string] {
  let depth = 0;
  let inString = false;
  let stringQuote = "";

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (ch === stringQuote && raw[i - 1] !== "\\") {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      inString = true;
      stringQuote = ch;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
      depth -= 1;
      continue;
    }

    if (ch === delimiter && depth === 0) {
      return [raw.slice(0, i), raw.slice(i + 1)];
    }
  }

  return [raw, ""];
}

function parseParameter(raw: string): MethodParameter {
  const [declaration] = splitAtTopLevel(raw, "=");
  const [left, type] = splitAtTopLevel(declaration, ":");
  const name = left.trim().replace(/\?$/, "");

  return {
    name,
    type: type.trim() || "unknown",
  };
}

function parseMethodSignatures(fileContent: string): MethodSignature[] {
  const signatures: MethodSignature[] = [];
  const regex = /public async (\w+)\s*\(([\s\S]*?)\)\s*:\s*Promise/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(fileContent)) !== null) {
    const methodName = match[1];
    const rawParameters = splitParameterList(match[2]);
    signatures.push({
      methodName,
      parameters: rawParameters.map(parseParameter),
    });
  }

  return signatures;
}

function loadGeneratedSignatureMap(
  apiProperties: string[],
): Map<string, MethodSignature> {
  const apiDir = path.resolve(process.cwd(), "other-repos/xero-node/src/gen/api");
  const files = fs
    .readdirSync(apiDir)
    .filter((name) => name.endsWith("Api.ts"))
    .map((name) => ({
      fileName: name,
      filePath: path.join(apiDir, name),
      normalized: normalizeKey(name.replace(/\.ts$/, "")),
    }));

  const output = new Map<string, MethodSignature>();

  for (const apiProperty of apiProperties) {
    const normalizedProperty = normalizeKey(apiProperty);
    const matchedFile = files.find((file) => file.normalized === normalizedProperty);
    if (!matchedFile) {
      continue;
    }

    const content = fs.readFileSync(matchedFile.filePath, "utf8");
    for (const signature of parseMethodSignatures(content)) {
      output.set(`${apiProperty}.${signature.methodName}`, signature);
    }
  }

  return output;
}

function listApiMethods(apiClient: Record<string, unknown>): string[] {
  const prototype = Object.getPrototypeOf(apiClient);
  if (!prototype) {
    return [];
  }

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor")
    .filter((name) => typeof prototype[name] === "function")
    // These are SDK configuration helpers, not real Xero API operations.
    .filter((name) => !EXCLUDED_METHODS.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function main(): void {
  installPipeSafety();

  const client = new XeroClient();
  const apiProperties = Object.keys(client)
    .filter((key) => key.endsWith("Api"))
    .sort((a, b) => a.localeCompare(b));
  const signatureMap = loadGeneratedSignatureMap(apiProperties);

  for (const apiProperty of apiProperties) {
    const apiClient = (client as unknown as Record<string, unknown>)[apiProperty];
    if (!isApiClient(apiClient)) {
      continue;
    }

    const methods = listApiMethods(apiClient);
    for (const method of methods) {
      const signature = signatureMap.get(`${apiProperty}.${method}`);
      const params = signature?.parameters ?? [];
      const renderedParams = params
        .map((parameter) => `${parameter.name}: ${parameter.type}`)
        .join("; ");
      const methodLabel = `${apiProperty}.${colorizeMethodName(method)}`;
      console.log(
        renderedParams.length > 0
          ? `[ ] ${methodLabel} | ${renderedParams}`
          : `[ ] ${methodLabel}`,
      );
    }
  }
}

main();
