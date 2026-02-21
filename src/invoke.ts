import { readFileSync } from "node:fs";
import path from "node:path";
import { XeroClient } from "xero-node";
import { createAuthenticatedClient } from "./client";

type ApiProperty =
  | "accountingApi"
  | "assetApi"
  | "filesApi"
  | "projectApi"
  | "payrollAUApi"
  | "payrollNZApi"
  | "payrollUKApi"
  | "bankFeedsApi"
  | "appStoreApi"
  | "financeApi";

interface ApiMapping {
  alias: string;
  property: ApiProperty;
  requiresTenantId: boolean;
}

interface ManifestParam {
  name: string;
  declaredType: string;
  isOptional: boolean;
  hasDefaultValue: boolean;
  isRequired: boolean;
}

interface ManifestMethod {
  name: string;
  signatureFound: boolean;
  params: ManifestParam[];
}

interface ManifestApi {
  name: string;
  methods: ManifestMethod[];
}

interface XeroApiManifest {
  schemaVersion: number;
  apis: ManifestApi[];
}

const API_MAPPINGS: ApiMapping[] = [
  { alias: "accounting", property: "accountingApi", requiresTenantId: true },
  { alias: "asset", property: "assetApi", requiresTenantId: true },
  { alias: "files", property: "filesApi", requiresTenantId: true },
  { alias: "project", property: "projectApi", requiresTenantId: true },
  { alias: "payroll-au", property: "payrollAUApi", requiresTenantId: true },
  { alias: "payroll-nz", property: "payrollNZApi", requiresTenantId: true },
  { alias: "payroll-uk", property: "payrollUKApi", requiresTenantId: true },
  { alias: "bankfeeds", property: "bankFeedsApi", requiresTenantId: true },
  { alias: "appstore", property: "appStoreApi", requiresTenantId: false },
  { alias: "finance", property: "financeApi", requiresTenantId: true },
];

const SUPPORTED_SIMPLE_TYPE_LABEL = "string, number, boolean, Date, Array<string>";

const MANIFEST_PATH = path.resolve(__dirname, "../resources/xero-api-manifest.json");

let manifestCache: XeroApiManifest | null = null;

export interface InvokeInput {
  api: string;
  method: string;
  tenantId?: string;
  rawParams?: string[];
}

export interface InvokeResult {
  status: number | null;
  body: unknown;
}

function resolveTenantId(
  env: NodeJS.ProcessEnv,
  explicitTenantId?: string,
): string {
  const tenantId = explicitTenantId?.trim() || env.XERO_TENANT_ID_DEFAULT?.trim();
  if (!tenantId) {
    throw new Error(
      "Missing tenant ID. Set --tenant-id or XERO_TENANT_ID_DEFAULT.",
    );
  }
  return tenantId;
}

function resolveApiMapping(input: string): ApiMapping | undefined {
  const normalized = input.trim().toLowerCase();
  return API_MAPPINGS.find(
    (mapping) =>
      mapping.alias === normalized ||
      mapping.property.toLowerCase() === normalized,
  );
}

function loadManifest(): XeroApiManifest {
  if (manifestCache) {
    return manifestCache;
  }

  const raw = readFileSync(MANIFEST_PATH, "utf8");
  manifestCache = JSON.parse(raw) as XeroApiManifest;
  return manifestCache;
}

function resolveManifestMethod(
  apiProperty: ApiProperty,
  methodName: string,
): ManifestMethod | undefined {
  const manifest = loadManifest();
  const api = manifest.apis.find((item) => item.name === apiProperty);
  if (!api) {
    return undefined;
  }

  return api.methods.find((item) => item.name === methodName);
}

function parseRawNamedParams(rawParams: string[]): Map<string, string> {
  const parsed = new Map<string, string>();

  for (const token of rawParams) {
    if (!token.startsWith("--")) {
      throw new Error(
        `Invalid invoke argument "${token}". Use --<param-name>=<param-value> after "--".`,
      );
    }

    const pair = token.slice(2);
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(
        `Invalid invoke argument "${token}". Use --<param-name>=<param-value>.`,
      );
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1);

    if (parsed.has(name)) {
      throw new Error(`Duplicate parameter "--${name}" in invoke arguments.`);
    }

    parsed.set(name, value);
  }

  return parsed;
}

function parseValueByType(
  declaredType: string,
  rawValue: string,
  name: string,
): unknown {
  if (declaredType === "string") {
    return rawValue;
  }

  if (declaredType === "number") {
    if (rawValue.trim().length === 0) {
      throw new Error(`Parameter "${name}" expects a number but received an empty value.`);
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Parameter "${name}" expects a number but received "${rawValue}".`);
    }
    return parsed;
  }

  if (declaredType === "boolean") {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }

    throw new Error(
      `Parameter "${name}" expects a boolean ("true" or "false") but received "${rawValue}".`,
    );
  }

  if (declaredType === "Date") {
    if (rawValue.trim().length === 0) {
      throw new Error(`Parameter "${name}" expects a date but received an empty value.`);
    }

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        `Parameter "${name}" expects a date but received "${rawValue}". Use ISO format, e.g. 2026-01-01T00:00:00Z.`,
      );
    }
    return parsed;
  }

  if (declaredType === "Array<string>") {
    const output: string[] = [];
    const items = rawValue
      .split(",")
      .map((item) => item.trim());

    for (const item of items) {
      if (item.length === 0) {
        throw new Error(
          `Parameter "${name}" expects a non-empty string array element.`,
        );
      }
      output.push(item);
    }

    if (output.length === 0) {
      throw new Error(`Parameter "${name}" expects at least one string value.`);
    }

    return output;
  }

  throw new Error(
    `Parameter "${name}" has unsupported type "${declaredType}". Supported types: ${SUPPORTED_SIMPLE_TYPE_LABEL}.`,
  );
}

function buildInvokeArgs(
  manifestMethod: ManifestMethod,
  tenantId: string | undefined,
  rawParams: string[],
): unknown[] {
  const providedParams = parseRawNamedParams(rawParams);
  const signatureParams = manifestMethod.params;
  const signatureParamNames = new Set(signatureParams.map((param) => param.name));
  const args: unknown[] = new Array(signatureParams.length).fill(undefined);

  for (const name of providedParams.keys()) {
    if (name === "xeroTenantId") {
      throw new Error(
        'Do not pass "--xeroTenantId". Use "--tenant-id" (before "--") or XERO_TENANT_ID_DEFAULT.',
      );
    }

    if (!signatureParamNames.has(name)) {
      throw new Error(
        `Unknown parameter "--${name}" for method "${manifestMethod.name}".`,
      );
    }
  }

  for (let index = 0; index < signatureParams.length; index += 1) {
    const param = signatureParams[index];

    if (param.name === "xeroTenantId") {
      args[index] = tenantId;
      continue;
    }

    const providedValue = providedParams.get(param.name);
    if (providedValue === undefined) {
      if (param.isRequired) {
        throw new Error(
          `Missing required parameter "--${param.name}=..." (${param.declaredType}).`,
        );
      }
      continue;
    }

    args[index] = parseValueByType(param.declaredType, providedValue, param.name);
  }

  while (args.length > 0 && args[args.length - 1] === undefined) {
    args.pop();
  }

  return args;
}

function toPrintableResult(result: unknown): InvokeResult {
  if (
    result &&
    typeof result === "object" &&
    "response" in result &&
    "body" in result
  ) {
    const value = result as {
      response?: { status?: number; statusCode?: number };
      body: unknown;
    };
    return {
      status: value.response?.status ?? value.response?.statusCode ?? null,
      body: value.body,
    };
  }

  return {
    status: null,
    body: result,
  };
}

export async function invokeXeroMethod(
  input: InvokeInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InvokeResult> {
  const mapping = resolveApiMapping(input.api);
  if (!mapping) {
    throw new Error(`Unknown API "${input.api}".`);
  }

  const tenantId = mapping.requiresTenantId
    ? resolveTenantId(env, input.tenantId)
    : undefined;

  const manifestMethod = resolveManifestMethod(mapping.property, input.method);

  if (!manifestMethod || !manifestMethod.signatureFound) {
    throw new Error(
      `No signature metadata for "${mapping.property}.${input.method}". Regenerate/expand resources/xero-api-manifest.json, or use a raw endpoint fallback when available.`,
    );
  }
  const args = buildInvokeArgs(manifestMethod, tenantId, input.rawParams ?? []);

  const client = await createAuthenticatedClient(env);
  const apiClient = (client as XeroClient)[mapping.property];
  if (!apiClient || typeof apiClient !== "object") {
    throw new Error(`API client "${mapping.alias}" is not available.`);
  }

  const method = (apiClient as unknown as Record<string, unknown>)[
    input.method
  ];
  if (typeof method !== "function") {
    throw new Error(
      `Unknown method "${input.method}" for API "${mapping.alias}".`,
    );
  }

  const result = await (method as Function).apply(apiClient, args);
  return toPrintableResult(result);
}
