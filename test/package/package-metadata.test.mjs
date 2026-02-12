/**
 * Package metadata expectations for publishing.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

// Must be publishable.
assert.notEqual(pkg.private, true);

// Publish contents should be controlled.
assert.ok(Array.isArray(pkg.files), "package.json files[] is required");
assert.ok(pkg.files.includes("dist"));
assert.ok(pkg.files.includes("README.md"));
assert.ok(pkg.files.includes("LICENSE"));

// Explicit exports map required for NodeNext consumers.
assert.ok(pkg.exports, "package.json exports is required");
assert.ok(pkg.exports["."], "exports must include '.' entry");
assert.ok(pkg.exports["./config"], "exports must include './config'");
assert.ok(pkg.exports["./exec"], "exports must include './exec'");
assert.ok(pkg.exports["./network-proxy"], "exports must include './network-proxy'");

// Prepack should build before publishing/packing.
assert.ok(pkg.scripts?.prepack, "prepack script is required");

// Public metadata.
assert.ok(pkg.license, "license is required");
assert.ok(pkg.repository, "repository is required");
assert.ok(pkg.bugs, "bugs is required");
assert.ok(pkg.homepage, "homepage is required");
assert.ok(pkg.keywords, "keywords is required");
