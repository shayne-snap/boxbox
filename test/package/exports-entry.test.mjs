/**
 * Package exports entry should work for ESM and CJS consumers.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const pkgUrl = pathToFileURL(path.resolve("package.json"));
const requireFromPkg = createRequire(pkgUrl);

// CJS require should resolve via exports.require.
const cjs = requireFromPkg("boxbox");
assert.ok(typeof cjs.createDefaultSandboxConfig === "function");

// ESM import should resolve via exports.import.
const esm = await import("boxbox");
assert.ok(typeof esm.createDefaultSandboxConfig === "function");
