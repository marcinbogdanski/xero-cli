import { XeroClient } from "xero-node";
import fs from "node:fs";
import path from "node:path";

interface MethodParameter {
  name: string;
  declaredType: string;
  isOptional: boolean;
  hasDefaultValue: boolean;
  isRequired: boolean;
}

interface MethodSignature {
  methodName: string;
  parameters: MethodParameter[];
}

interface ManifestMethod {
  name: string;
  signatureFound: boolean;
  params: MethodParameter[];
}

interface ManifestApi {
  name: string;
  methods: ManifestMethod[];
}

interface ManifestDocument {
  schemaVersion: number;
  generatedAt: string;
  sdk: {
    name: string;
    version: string;
  };
  apis: ManifestApi[];
}

const EXCLUDED_METHODS = new Set(["setApiKey", "setDefaultAuthentication"]);
const DEFAULT_MANIFEST_PATH = path.resolve("resources/xero-api-manifest.json");

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isApiClient(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const [declaration, defaultValue] = splitAtTopLevel(raw, "=");
  const [left, declaredType] = splitAtTopLevel(declaration, ":");
  const leftTrimmed = left.trim();
  const isOptional = leftTrimmed.endsWith("?");
  const name = leftTrimmed.replace(/\?$/, "");
  const hasDefaultValue = defaultValue.trim().length > 0;

  return {
    name,
    declaredType: declaredType.trim().replace(/\s+/g, " ") || "unknown",
    isOptional,
    hasDefaultValue,
    isRequired: !isOptional && !hasDefaultValue,
  };
}

function extractMethodParameterBlock(signature: string): string | null {
  const start = signature.indexOf("(");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  for (let i = start; i < signature.length; i += 1) {
    const ch = signature[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return signature.slice(start + 1, i);
      }
    }
  }

  return null;
}

function parseMethodSignatures(fileContent: string): MethodSignature[] {
  const signatures: MethodSignature[] = [];
  const lines = fileContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const methodMatch = lines[i].match(/^\s*(\w+)\s*\(/);
    if (!methodMatch) {
      continue;
    }

    const firstLine = lines[i].trimEnd();
    if (firstLine.includes(";") && !/\)\s*:\s*Promise/.test(firstLine)) {
      continue;
    }

    const methodName = methodMatch[1];
    if (methodName === "constructor") {
      continue;
    }

    let signature = firstLine;
    let j = i;
    while (!/\)\s*:\s*Promise/.test(signature) && j + 1 < lines.length) {
      j += 1;
      signature += `\n${lines[j].trimEnd()}`;
    }

    i = j;

    if (!/\)\s*:\s*Promise/.test(signature)) {
      continue;
    }

    const parameterBlock = extractMethodParameterBlock(signature);
    if (parameterBlock === null) {
      continue;
    }

    const rawParameters = splitParameterList(parameterBlock);
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
  const apiDir = getInstalledApiDir();
  const files = fs
    .readdirSync(apiDir)
    .filter((name) => name.endsWith("Api.d.ts"))
    .map((name) => ({
      filePath: path.join(apiDir, name),
      normalized: normalizeKey(name.replace(/\.d\.ts$/, "")),
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
    .filter((name) => !EXCLUDED_METHODS.has(name))
    .sort((a, b) => a.localeCompare(b));
}

function getSdkVersion(): string {
  try {
    const packageJsonPath = require.resolve("xero-node/package.json");
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    ) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function getInstalledApiDir(): string {
  const apisDeclPath = require.resolve("xero-node/dist/gen/api/apis.d.ts");
  return path.dirname(apisDeclPath);
}

function getOutputPathFromArgv(): string {
  const provided = process.argv[2];
  if (provided && provided.trim().length > 0) {
    return path.resolve(provided);
  }
  return DEFAULT_MANIFEST_PATH;
}

function buildManifest(): ManifestDocument {
  const client = new XeroClient();
  const apiProperties = Object.keys(client)
    .filter((key) => key.endsWith("Api"))
    .sort((a, b) => a.localeCompare(b));
  const signatureMap = loadGeneratedSignatureMap(apiProperties);

  const apis: ManifestApi[] = [];

  for (const apiProperty of apiProperties) {
    const apiClient = (client as unknown as Record<string, unknown>)[apiProperty];
    if (!isApiClient(apiClient)) {
      continue;
    }

    const methods = listApiMethods(apiClient);
    const manifestMethods: ManifestMethod[] = methods.map((methodName) => {
      const signature = signatureMap.get(`${apiProperty}.${methodName}`);
      return {
        name: methodName,
        signatureFound: Boolean(signature),
        params: signature?.parameters ?? [],
      };
    });

    apis.push({
      name: apiProperty,
      methods: manifestMethods,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sdk: {
      name: "xero-node",
      version: getSdkVersion(),
    },
    apis,
  };
}

function main(): void {
  const outputPath = getOutputPathFromArgv();
  const manifest = buildManifest();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const apiCount = manifest.apis.length;
  const methodCount = manifest.apis.reduce(
    (total, api) => total + api.methods.length,
    0,
  );
  console.log(`Wrote manifest: ${outputPath}`);
  console.log(
    `APIs: ${apiCount}, Methods: ${methodCount}, SDK: ${manifest.sdk.version}`,
  );
}

main();
