/**
 * execute() argument escaping boundary tests.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { createDefaultSandboxConfig } from "../../dist/esm/config/index.js";
import { execute } from "../../dist/esm/exec/index.js";

const baseConfig = createDefaultSandboxConfig();

// execute() builds commandLine by joining args with spaces (no shell escaping).
{
  const args = [
    "hello world",
    'a"b',
    "c;rm -rf /",
    "$HOME",
    "`whoami`",
  ];
  const result = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args,
    sandboxConfig: {
      ...baseConfig,
      network: { allowedDomains: ["http://example.com"], deniedDomains: [] }, // invalid config to force early reject
    },
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "invalid_config");
  assert.equal(result.approvalRequest?.command, `echo ${args.join(" ")}`);
}
