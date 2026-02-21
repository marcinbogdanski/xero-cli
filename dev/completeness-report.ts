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
  hasDefaultValue: boolean;
  isOptional: boolean;
}

interface MethodSignature {
  methodName: string;
  parameters: MethodParameter[];
}

interface ManifestParameter {
  name: string;
  declaredType: string;
  isOptional: boolean;
  hasDefaultValue: boolean;
  isRequired: boolean;
}

interface ManifestMethod {
  name: string;
  signatureFound: boolean;
  params: ManifestParameter[];
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

type ParamSupportLevel =
  | "unsupported"
  | "partial"
  | "supported"
  | "tenant"
  | "ignored";

const EXCLUDED_METHODS = new Set(["setApiKey", "setDefaultAuthentication"]);
const DEFAULT_MANIFEST_PATH = path.resolve("resources/xero-api-manifest.json");

const ANSI = {
  reset: "\x1b[0m",
  orange: "\x1b[38;5;214m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

function supportsColor(): boolean {
  if (process.env.FORCE_COLOR !== undefined) {
    return true;
  }
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

function colorizeMethodName(name: string): string {
  if (!supportsColor()) {
    return name;
  }
  return `${ANSI.orange}${name}${ANSI.reset}`;
}

function colorizeSupportedParam(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI.green}${value}${ANSI.reset}`;
}

function colorizeTenantParam(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI.blue}${value}${ANSI.reset}`;
}

function colorizePartialMarker(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI.yellow}${value}${ANSI.reset}`;
}

function colorizeNeutralParam(value: string): string {
  if (!supportsColor()) {
    return value;
  }
  return `${ANSI.gray}${value}${ANSI.reset}`;
}

function normalizeType(type: string): string {
  return type.trim().toLowerCase();
}

function normalizeStructuralType(type: string): string {
  return type.replace(/[\s;]/g, "").toLowerCase();
}

function isStringArrayType(type: string): boolean {
  const normalized = normalizeStructuralType(type);
  return normalized === "array<string>" || normalized === "string[]";
}

function isBinaryStreamType(type: string): boolean {
  return normalizeStructuralType(type) === "fs.readstream|readable|buffer";
}

function isTenantParamName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "xerotenantid" || normalized === "xerotentantid";
}

function isDefaultOptionsHeadersParam(parameter: MethodParameter): boolean {
  const optionsHeadersType = "{headers: {[name: string]: string}}";
  return (
    parameter.name === "options" &&
    (parameter.hasDefaultValue || parameter.isOptional) &&
    normalizeStructuralType(parameter.type) ===
      normalizeStructuralType(optionsHeadersType)
  );
}

function isParamTypeExplicitlySupported(parameter: MethodParameter): boolean {
  const simpleTypes = new Set(["string", "number", "boolean", "date"]);
  return (
    simpleTypes.has(normalizeType(parameter.type)) ||
    isStringArrayType(parameter.type) ||
    isBinaryStreamType(parameter.type)
  );
}

function getParamSupportLevel(parameter: MethodParameter): ParamSupportLevel {
  // Precedence requested by user:
  // 1) start unsupported
  // 2) default/optional -> partial
  // 3) explicitly supported type -> supported
  // 4) xeroTenantId:string -> tenant (highest)
  let level: ParamSupportLevel = "unsupported";

  if (parameter.hasDefaultValue || parameter.isOptional) {
    level = "partial";
  }

  if (isParamTypeExplicitlySupported(parameter)) {
    level = "supported";
  }

  if (
    isTenantParamName(parameter.name) &&
    normalizeType(parameter.type) === "string"
  ) {
    level = "tenant";
  }

  if (isDefaultOptionsHeadersParam(parameter)) {
    level = "ignored";
  }

  return level;
}

function isParamSupported(parameter: MethodParameter): boolean {
  const level = getParamSupportLevel(parameter);
  return level === "supported" || level === "tenant" || level === "ignored";
}

function isParamInvokable(parameter: MethodParameter): boolean {
  return getParamSupportLevel(parameter) !== "unsupported";
}

function renderParameter(parameter: MethodParameter): string {
  let rendered = `${parameter.name}: ${parameter.type}`;
  if (parameter.hasDefaultValue) {
    rendered += " [default]";
  } else if (parameter.isOptional) {
    rendered += " [optional]";
  }

  const level = getParamSupportLevel(parameter);
  let colorized = rendered;

  if (level === "tenant") {
    colorized = colorizeTenantParam(rendered);
  }

  if (level === "supported") {
    colorized = colorizeSupportedParam(rendered);
  }

  if (level === "partial") {
    colorized = colorizePartialMarker(rendered);
  }

  if (level === "ignored") {
    return colorizeNeutralParam(`${rendered} [ignored]`);
  }

  return colorized;
}

function renderMethodCheckbox(parameters: MethodParameter[]): string {
  const isFullySupported = parameters.every((parameter) => isParamSupported(parameter));
  if (isFullySupported) {
    if (!supportsColor()) {
      return "[X]";
    }
    return `[${ANSI.green}X${ANSI.reset}]`;
  }

  const isInvokable = parameters.every((parameter) => isParamInvokable(parameter));
  if (isInvokable) {
    return colorizePartialMarker("[~]");
  }

  return "[ ]";
}

function getManifestPathFromArgv(): string {
  const provided = process.argv[2];
  if (provided && provided.trim().length > 0) {
    return path.resolve(provided);
  }
  return DEFAULT_MANIFEST_PATH;
}

function loadManifest(): ManifestDocument {
  const manifestPath = getManifestPathFromArgv();
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Manifest not found at ${manifestPath}. Run: npm run manifest`,
    );
  }

  const manifestRaw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(manifestRaw) as ManifestDocument;
}

function manifestMethodToSignature(method: ManifestMethod): MethodSignature {
  return {
    methodName: method.name,
    parameters: method.params.map((parameter) => ({
      name: parameter.name,
      type: parameter.declaredType,
      hasDefaultValue: parameter.hasDefaultValue,
      isOptional: parameter.isOptional,
    })),
  };
}

function loadGeneratedSignatureMap(manifest: ManifestDocument): Map<string, MethodSignature> {
  const output = new Map<string, MethodSignature>();
  for (const api of manifest.apis) {
    for (const method of api.methods) {
      output.set(
        `${api.name}.${method.name}`,
        manifestMethodToSignature(method),
      );
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
  const manifest = loadManifest();
  const signatureMap = loadGeneratedSignatureMap(manifest);

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
        .map((parameter) => renderParameter(parameter))
        .join("; ");
      const methodLabel = `${apiProperty}.${colorizeMethodName(method)}`;
      const checkbox = renderMethodCheckbox(params);
      console.log(
        renderedParams.length > 0
          ? `${checkbox} ${methodLabel} | ${renderedParams}`
          : `${checkbox} ${methodLabel}`,
      );
    }
  }
}

main();
