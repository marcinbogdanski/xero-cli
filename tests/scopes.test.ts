import { describe, expect, it } from "vitest";
import { renderOAuthScopesHelpText, resolveOAuthScopes } from "../src/scopes";

describe("renderOAuthScopesHelpText", () => {
  it("renders scopes and profiles as plain text help", () => {
    const text = renderOAuthScopesHelpText();

    expect(text).toContain(
      "OAuth scopes for `xero auth login --mode oauth --scopes=...`.",
    );
    expect(text).toContain("Date scraped: 2026-02-22");
    expect(text).toContain(
      "Source URL: https://developer.xero.com/documentation/guides/oauth2/scopes",
    );
    expect(text).toContain("Scopes:");
    expect(text).toContain(
      "  accounting.transactions.read - View your business transactions",
    );
    expect(text).toContain("Profile core-read-only:");
    expect(text).toContain("Profile payroll-read-only:");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("includes profile entries with descriptions when available", () => {
    const text = renderOAuthScopesHelpText();

    expect(text).toContain("  offline_access");
    expect(text).toContain("  payroll.settings.read - View your payroll settings");
  });
});

describe("resolveOAuthScopes", () => {
  it("defaults to core-read-only profile", () => {
    const result = resolveOAuthScopes(undefined);

    expect(result.scopes).toContain("offline_access");
    expect(result.scopes).toContain("accounting.transactions.read");
    expect(result.warnings).toEqual([]);
  });

  it("expands profile tokens and explicit scopes with dedupe", () => {
    const result = resolveOAuthScopes(
      "core-read-only,accounting.invoices,accounting.transactions.read",
    );

    expect(result.scopes).toContain("accounting.invoices");
    expect(
      result.scopes.filter((scope) => scope === "accounting.transactions.read"),
    ).toHaveLength(1);
  });

  it("warns and passes through unknown scopes", () => {
    const result = resolveOAuthScopes("core-read-only,my.custom.scope");

    expect(result.scopes).toContain("my.custom.scope");
    expect(
      result.warnings.some((warning) => warning.includes('Scope "my.custom.scope"')),
    ).toBe(true);
  });

  it("warns when offline_access is missing", () => {
    const result = resolveOAuthScopes("accounting.transactions.read");

    expect(result.warnings).toContain(
      'Scope "offline_access" is not requested; no refresh token expected.',
    );
  });
});
