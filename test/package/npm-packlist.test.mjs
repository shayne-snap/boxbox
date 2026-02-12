/**
 * Validate npm pack list against publishing expectations.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
});
const parsed = JSON.parse(output);
const files = Array.isArray(parsed) && parsed[0]?.files
  ? parsed[0].files.map((entry) => entry.path)
  : [];

assert.ok(files.length > 0, "npm pack --dry-run returned no files");

// Must include these top-level files.
assert.ok(files.includes("README.md"));
assert.ok(files.includes("LICENSE"));
assert.ok(files.some((f) => f.startsWith("dist/")));

// Must exclude these.
assert.ok(!files.some((f) => f.startsWith("src/")), "src/ should not be packed");
assert.ok(!files.some((f) => f.startsWith("test/")), "test/ should not be packed");
assert.ok(!files.some((f) => f.startsWith("node_modules/")), "node_modules/ should not be packed");
