# boxbox

Sandbox execution layer for [boxlite](https://github.com/boxlite-labs/boxlite) SimpleBox. boxbox is a library: your host app owns policy and approval logic, and calls `execute()` to run work inside a boxlite container.

**Key capabilities**
- Network allow/deny with a host-side proxy
- Filesystem allow/deny with volume policy
- Secret injection and response redaction
- Session reuse across calls
- Execution diagnostics for troubleshooting

## Install

From the repo root:

```bash
cd boxbox && pnpm install && pnpm run build
```

**Peer dependency**: `@boxlite-ai/boxlite`. The host app must add it from npm. If boxlite is not available, `loadBoxlite()` returns `null` and `execute()` will return `unavailable`.
**Module format**: ESM + CJS dual build. Use `import` or `require`.
**Subpath exports**: `boxbox/config`, `boxbox/exec`, `boxbox/network-proxy`, `boxbox/logging/sandbox-log`, `boxbox/fs/volumes`, `boxbox/util/domain-match`.

## Quick Start

```ts
import {
  execute,
  createDefaultSandboxConfig,
} from "boxbox";

const result = await execute({
  scopeId: "agentId",
  sessionId: params.sessionId,
  command: "npm",
  args: ["install"],
  cwd: "/app",
  env: { NODE_ENV: "test" },
  sandboxConfig: createDefaultSandboxConfig(),
});

if (result.outcome === "boxlite" && result.result) {
  // use result.result.exitCode, stdout, stderr
} else if (result.outcome === "unavailable") {
  // host app may fallback to host execution
} else if (result.outcome === "reject") {
  // invalid config or pty not allowed
}
```

## Full Example (Filesystem + Network + Secrets)

```ts
import {
  execute,
  createDefaultSandboxConfig,
  stopSession,
} from "boxbox";

const sandboxConfig = createDefaultSandboxConfig();
sandboxConfig.filesystem = {
  denyRead: ["/private", "/etc"],
  allowWrite: ["/app", "/tmp"],
  denyWrite: ["/app/secrets"],
};
sandboxConfig.network = {
  allowedDomains: ["registry.npmjs.org", "github.com", "*.pypi.org"],
  deniedDomains: ["example.bad"],
  proxyHost: "auto",
  secretProtectionMode: "strict",
  secretResponseRedaction: { enabled: true, maxBodyBytes: 1024 * 1024 },
  secrets: {
    NPM_TOKEN: { hosts: ["registry.npmjs.org"] },
  },
  secretInjection: {
    rules: [
      {
        domains: ["registry.npmjs.org"],
        headers: { Authorization: "NPM_TOKEN" },
      },
    ],
  },
};

const result = await execute({
  scopeId: "agentId",
  sessionId: params.sessionId,
  command: "npm",
  args: ["install"],
  cwd: "/app",
  env: { NODE_ENV: "test" },
  sandboxConfig,
  secrets: {
    NPM_TOKEN: process.env.NPM_TOKEN ?? "",
  },
});

// On disconnect:
stopSession(scopeId);
```

Placeholder mode (optional)

When `network.secrets` is set, boxbox injects placeholder values into the sandbox
environment and replaces them at the proxy boundary. This keeps real secrets out
of the sandbox env while still allowing outbound auth via the proxy.

Example (inside the sandbox):

```bash
curl -H "Authorization: Bearer $NPM_TOKEN" https://registry.npmjs.org/
```

## Configuration Model

**Filesystem**
- `denyRead`: do not mount any path in or under these.
- `allowWrite`: paths to mount as writable (when empty, everything is read-only).
- `denyWrite`: paths mounted read-only (takes precedence over `allowWrite`).

**Network**
- `allowedDomains`: outbound allowlist (empty = block all when network is set).
- `deniedDomains`: outbound denylist (checked first, takes precedence).
- `proxyHost`: host address used by sandbox to reach the proxy.
- `proxyHost = "auto"`: resolves host IPv4 from the default route interface.

**Secrets**
- `secretInjection`: injects secret headers for allowed domains.
- `secrets`: host scopes for placeholder injection.
- `secretProtectionMode = "strict"` requires `secretResponseRedaction.enabled = true`
  and a built-in proxy (no external proxy ports).

## How It Works

boxbox runs commands inside boxlite and enforces network policy via a host-side HTTP proxy.
When secrets are enabled, boxbox can inject placeholders into the sandbox environment and
swap them for real values at the proxy boundary. Response headers/bodies can be redacted
to avoid secret leakage, depending on `secretProtectionMode`.

## Example Use Case

Install dependencies while limiting outbound traffic:

1. Allow only `registry.npmjs.org` and `github.com`.
2. Inject an `Authorization` header from `NPM_TOKEN`.
3. Block writes to `/app/secrets`.

## Limitations / Notes

- File-level rules like `.git/config` cannot be enforced because boxlite volumes are directory-based.
- If `proxyHost = "auto"` is used, the `default-gateway` dependency must be available.
- Default image is `python:slim`. It includes Python, but does **not** include all common CLI tools (for example, `curl`) by default.
- When network policy is enabled, the proxy host-gateway defaults to `192.168.127.1` and can be overridden with `sandboxConfig.network.proxyHost`.
- Set `sandboxConfig.network.proxyHost = "auto"` to resolve host IPv4 from the default route interface at runtime (via `default-gateway`).

## License

Apache-2.0.
