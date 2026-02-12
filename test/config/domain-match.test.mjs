/**
 * Unit tests for matchesDomainPattern (aligned with sandbox-runtime).
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesDomainPattern } from "../../dist/esm/util/domain-match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// *.example.com matches subdomains only
assert.equal(matchesDomainPattern("api.example.com", "*.example.com"), true);
assert.equal(matchesDomainPattern("foo.bar.example.com", "*.example.com"), true);
assert.equal(matchesDomainPattern("example.com", "*.example.com"), false);

// Exact match, case-insensitive
assert.equal(matchesDomainPattern("Example.COM", "example.com"), true);
assert.equal(matchesDomainPattern("example.com", "Example.COM"), true);
assert.equal(matchesDomainPattern("other.com", "example.com"), false);

// Non-matching
assert.equal(matchesDomainPattern("evil.example.com", "example.com"), false);
assert.equal(matchesDomainPattern("notexample.com", "*.example.com"), false);
