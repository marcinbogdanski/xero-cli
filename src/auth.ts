export interface AuthStatus {
  authMode: "client_credentials" | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  isConfigured: boolean;
}

function hasValue(input: string | undefined): boolean {
  return typeof input === "string" && input.trim().length > 0;
}

export function resolveAuthStatus(
  env: NodeJS.ProcessEnv = process.env,
): AuthStatus {
  const hasClientId = hasValue(env.XERO_CLIENT_ID);
  const hasClientSecret = hasValue(env.XERO_CLIENT_SECRET);
  const isConfigured = hasClientId && hasClientSecret;

  return {
    authMode: isConfigured ? "client_credentials" : null,
    hasClientId,
    hasClientSecret,
    isConfigured,
  };
}
