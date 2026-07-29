import { describe, expect, it } from "vitest";
import {
  isPlaceholderOwner,
  normalizeRepoUrl,
  OWNER_PLACEHOLDER,
  REPO_URL,
  ruleDocUrl,
} from "../src/meta";

const FALLBACK = `https://github.com/${OWNER_PLACEHOLDER}/skillcheck`;

describe("normalizeRepoUrl", () => {
  it("strips npm's git+ prefix and .git suffix", () => {
    expect(normalizeRepoUrl("git+https://github.com/acme/skillcheck.git")).toBe(
      "https://github.com/acme/skillcheck",
    );
  });

  it("accepts a plain https url unchanged", () => {
    expect(normalizeRepoUrl("https://github.com/acme/skillcheck")).toBe(
      "https://github.com/acme/skillcheck",
    );
  });

  it("rewrites scp-style and ssh urls to browsable https", () => {
    expect(normalizeRepoUrl("git@github.com:acme/skillcheck.git")).toBe(
      "https://github.com/acme/skillcheck",
    );
    expect(normalizeRepoUrl("ssh://git@github.com/acme/skillcheck.git")).toBe(
      "https://github.com/acme/skillcheck",
    );
    expect(normalizeRepoUrl("git://github.com/acme/skillcheck.git")).toBe(
      "https://github.com/acme/skillcheck",
    );
  });

  it("drops trailing slashes", () => {
    expect(normalizeRepoUrl("https://github.com/acme/skillcheck///")).toBe(
      "https://github.com/acme/skillcheck",
    );
  });

  // A helpUri that isn't a URL is worse than one pointing at the placeholder:
  // GitHub renders it in the Security tab either way.
  it("falls back rather than emitting a non-http link", () => {
    for (const raw of ["github:acme/skillcheck", "./local/path", "", "   ", undefined]) {
      expect(normalizeRepoUrl(raw)).toBe(FALLBACK);
    }
  });
});

describe("REPO_URL", () => {
  it("is derived from this package's own repository field", () => {
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/skillcheck$/);
  });

  it("builds an anchored rule reference", () => {
    expect(ruleDocUrl("when-to-use")).toBe(`${REPO_URL}/blob/main/docs/rules.md#when-to-use`);
  });

  // Built from OWNER_PLACEHOLDER, never spelled out: a literal here is a string
  // `npm run set-owner` would rewrite on release day, turning this assertion
  // into its own opposite.
  it("reports whether the owner is still the placeholder", () => {
    expect(isPlaceholderOwner(FALLBACK)).toBe(true);
    expect(isPlaceholderOwner("https://github.com/acme/skillcheck")).toBe(false);
  });
});
