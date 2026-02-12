/**
 * Unit tests for config validation and execute() rejection paths.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { createDefaultSandboxConfig, validateSandboxConfig } from "../../dist/esm/config/index.js";
import { execute } from "../../dist/esm/exec/index.js";

const baseConfig = createDefaultSandboxConfig();

// Base config is valid
assert.equal(validateSandboxConfig(baseConfig).success, true);

// Network: valid domain patterns
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["example.com"], deniedDomains: [] },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["*.npmjs.org"], deniedDomains: [] },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["localhost"], deniedDomains: [] },
  }).success,
  true
);

// Network: invalid domain patterns
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["http://example.com"], deniedDomains: [] },
  }).success,
  false
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["example.com:443"], deniedDomains: [] },
  }).success,
  false
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["*.com"], deniedDomains: [] },
  }).success,
  false
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["*example.com"], deniedDomains: [] },
  }).success,
  false
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["*."], deniedDomains: [] },
  }).success,
  false
);

// Network: wildcard domains (valid)
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["*.co.uk"], deniedDomains: [] },
  }).success,
  true
);

// Network: invalid ports
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["example.com"], deniedDomains: [], httpProxyPort: 0 },
  }).success,
  false
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["example.com"], deniedDomains: [], socksProxyPort: 70000 },
  }).success,
  false
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["example.com"], deniedDomains: [], httpProxyPort: 1 },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: { allowedDomains: ["example.com"], deniedDomains: [], socksProxyPort: 65535 },
  }).success,
  true
);

// Network: proxy host
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      proxyHost: "host.docker.internal",
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      proxyHost: "auto",
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      proxyHost: "",
    },
  }).success,
  false
);

// Network: MITM proxy config
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      mitmProxy: { host: "127.0.0.1", port: 8080, domains: ["example.com"] },
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      mitmProxy: { host: "127.0.0.1", port: 0, domains: ["example.com"] },
    },
  }).success,
  false
);

// Network: secret injection config
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secretInjection: {
        rules: [
          { domains: ["example.com"], headers: { "X-Api-Key": "API_KEY" } },
        ],
      },
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secretInjection: {
        rules: [
          { domains: ["example.com"], headers: { "Bad Header": "API_KEY" } },
        ],
      },
    },
  }).success,
  false
);

// Network: secret scopes config
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secrets: {
        OPENAI_API_KEY: { hosts: ["api.openai.com"] },
      },
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secrets: {
        OPENAI_API_KEY: { hosts: ["*.com"] },
      },
    },
  }).success,
  false
);

// Network: secret protection mode
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secretProtectionMode: "best_effort",
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secretProtectionMode: "strict",
      secretResponseRedaction: { enabled: true, maxBodyBytes: 1024 },
    },
  }).success,
  true
);
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    network: {
      allowedDomains: ["example.com"],
      deniedDomains: [],
      secretProtectionMode: "broken",
    },
  }).success,
  false
);

// Filesystem: empty path rejected
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    filesystem: { denyRead: [""], allowWrite: [], denyWrite: [] },
  }).success,
  false
);

// Security: accepted shape
assert.equal(
  validateSandboxConfig({
    ...baseConfig,
    security: { jailerEnabled: true, seccompEnabled: false },
  }).success,
  true
);

// execute() rejects invalid config before touching boxlite
{
  const result = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args: ["hi"],
    sandboxConfig: {
      ...baseConfig,
      network: { allowedDomains: ["http://example.com"], deniedDomains: [] },
    },
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "invalid_config");
}

// allowPty false => reject tty request
{
  const result = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args: ["hi"],
    tty: true,
    sandboxConfig: baseConfig,
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "pty_not_allowed");
}

// secretProtectionMode=strict without MITM should reject before touching boxlite
{
  const result = await execute({
    scopeId: "scope",
    sessionId: "session",
    command: "echo",
    args: ["hi"],
    sandboxConfig: {
      ...baseConfig,
      network: {
        allowedDomains: ["postman-echo.com"],
        deniedDomains: [],
        secretProtectionMode: "strict",
        secrets: {
          API_KEY: { hosts: ["postman-echo.com"] },
        },
      },
    },
    secrets: { API_KEY: "test-secret" },
  });
  assert.equal(result.outcome, "reject");
  assert.equal(result.approvalRequest?.reason, "secret_protection_unavailable");
}
