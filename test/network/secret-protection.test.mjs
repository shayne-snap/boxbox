/**
 * execute() strict secret protection combinations.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { createDefaultSandboxConfig } from "../../dist/esm/config/index.js";
import { execute } from "../../dist/esm/exec/index.js";

const baseConfig = createDefaultSandboxConfig();

async function runStrict(config) {
  return await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args: ["hi"],
    sandboxConfig: {
      ...baseConfig,
      network: config,
    },
    secrets: { API_KEY: "test-secret" },
  });
}

// strict + secretResponseRedaction disabled => reject
{
  const result = await runStrict({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    secretProtectionMode: "strict",
    secretResponseRedaction: { enabled: false, maxBodyBytes: 1024 },
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "secret_protection_unavailable");
}

// strict + external httpProxyPort => reject
{
  const result = await runStrict({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    secretProtectionMode: "strict",
    secretResponseRedaction: { enabled: true, maxBodyBytes: 1024 },
    secrets: { API_KEY: { hosts: ["example.com"] } },
    mitmProxy: { host: "127.0.0.1", port: 8080, domains: ["example.com"] },
    httpProxyPort: 3128,
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "secret_protection_unavailable");
}

// strict + external socksProxyPort => reject
{
  const result = await runStrict({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    secretProtectionMode: "strict",
    secretResponseRedaction: { enabled: true, maxBodyBytes: 1024 },
    secrets: { API_KEY: { hosts: ["example.com"] } },
    mitmProxy: { host: "127.0.0.1", port: 8080, domains: ["example.com"] },
    socksProxyPort: 1080,
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "secret_protection_unavailable");
}

// strict + mitmProxy domains missing protected domains => reject
{
  const result = await runStrict({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    secretProtectionMode: "strict",
    secretResponseRedaction: { enabled: true, maxBodyBytes: 1024 },
    secrets: { API_KEY: { hosts: ["api.example.com"] } },
    mitmProxy: { host: "127.0.0.1", port: 8080, domains: ["example.com"] },
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "secret_protection_unavailable");
}
