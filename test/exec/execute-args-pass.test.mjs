/**
 * execute() should pass command/args without shell-joining.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultSandboxConfig } from "../../dist/esm/config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const moduleDir = path.join(repoRoot, "node_modules", "@boxlite-ai", "boxlite");

const moduleIndex = `
let lastExec = null;
let stdoutChunks = [];
let stderrChunks = [];
export function __getLastExec() { return lastExec; }
export function __setStdout(chunks) { stdoutChunks = Array.isArray(chunks) ? chunks : []; }
export function __setStderr(chunks) { stderrChunks = Array.isArray(chunks) ? chunks : []; }
function makeStream(chunks) {
  let i = 0;
  return { next: async () => (i < chunks.length ? String(chunks[i++]) : null) };
}
export const JsBoxlite = {
  withDefaultConfig() {
    return {
      async create() {
        return {
          async exec(command, args, env, tty) {
            lastExec = { command, args, env, tty };
            return {
              async stdout() { return makeStream(stdoutChunks); },
              async stderr() { return makeStream(stderrChunks); },
              async wait() { return { exitCode: 0 }; },
            };
          },
          async stop() {},
        };
      },
    };
  },
};
export const SimpleBox = class {};
`;

const modulePkg = {
  name: "@boxlite-ai/boxlite",
  version: "0.0.0-test",
  type: "module",
  exports: "./index.js",
};

fs.mkdirSync(moduleDir, { recursive: true });
fs.writeFileSync(path.join(moduleDir, "package.json"), JSON.stringify(modulePkg, null, 2));
fs.writeFileSync(path.join(moduleDir, "index.js"), moduleIndex);

try {
  const { execute } = await import("../../dist/esm/exec/index.js");
  const { __getLastExec, __setStdout, __setStderr } = await import("@boxlite-ai/boxlite");

  const args = ["hello world", 'a"b', "c;rm -rf /", "$HOME", "`whoami`"];
  const result = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args,
    sandboxConfig: createDefaultSandboxConfig(),
  });

  assert.equal(result.outcome, "boxlite");
  const last = __getLastExec();
  assert.ok(last, "expected exec to be called");
  assert.equal(last.command, "echo");
  assert.deepEqual(last.args, args);

  // maxOutputBytes should truncate per stream
  __setStdout(["12345", "67890"]);
  __setStderr(["abc", "def"]);
  const limited = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args: ["hi"],
    maxOutputBytes: 6,
    sandboxConfig: createDefaultSandboxConfig(),
  });
  assert.equal(limited.outcome, "boxlite");
  assert.equal(limited.result?.stdout, "123456");
  assert.equal(limited.result?.stdoutTruncated, true);
  assert.equal(limited.result?.stderr, "abcdef".slice(0, 6));
  assert.equal(limited.result?.stderrTruncated, false);

  // errorCode should be stable for invalid config
  const invalid = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args: ["hi"],
    sandboxConfig: {
      ...createDefaultSandboxConfig(),
      network: { allowedDomains: ["http://example.com"], deniedDomains: [] },
    },
  });
  assert.equal(invalid.outcome, "reject");
  assert.equal(invalid.errorCode, "invalid_config");
} finally {
  fs.rmSync(path.join(repoRoot, "node_modules", "@boxlite-ai"), {
    recursive: true,
    force: true,
  });
}
