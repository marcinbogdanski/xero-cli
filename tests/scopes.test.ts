import { describe, expect, it } from "vitest";
import { renderOAuthScopesHelpText } from "../src/scopes";

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
