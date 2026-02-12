# Validate Boxbox Core Capabilities Inside Box (P0)

This checklist is for verifying that `boxbox` core capabilities work correctly when used in the `box` app:
- sandbox routing and image
- network allowlist
- proxy observability
- secret injection (both modes)
- filesystem policies
- host fallback

After any sandbox config change, start a new session before testing to avoid cached results.

## Prerequisites

1. Set a test secret on the host (example):
   - `export BOXBOX_TEST_API_KEY="boxbox-test-123"`
2. Recommended initial sandbox config for `box`:
   - `image: "buildpack-deps:bookworm"`
   - `network.proxyHost: "auto"`

Current regression baseline (do not forget):
- Image: `buildpack-deps:bookworm`
- Filesystem example (7B writable config):
```json
{
  "enabled": true,
  "image": "buildpack-deps:bookworm",
  "filesystem": {
    "denyRead": [],
    "allowWrite": ["/Users/goranka/Engineer/ai/acp/box"],
    "denyWrite": []
  }
}
```

## Case 1: Sandbox Routing and Image

Status:
- Passed (2026-02-11)

Config:
- `enabled: true`
- `image: "buildpack-deps:bookworm"`

Commands:
- `uname -a`
- `which curl`
- `which python3`

Expected:
- Panel `decision` shows `backend=boxlite`
- Panel shows `image=buildpack-deps:bookworm`
- All three commands succeed

## Case 2: Network Allowlist Blocking

Status:
- Passed (2026-02-11)

Config:
- `network.allowedDomains: ["postman-echo.com"]`
- `network.deniedDomains: []`
- `network.proxyHost: "auto"`

Commands:
- `echo "$HTTP_PROXY"`
- `curl -sS http://postman-echo.com/headers`
- `curl -iS --max-time 10 http://example.com`

Expected:
- `HTTP_PROXY` is not empty
- `postman-echo.com` request succeeds
- `example.com` is blocked (403 or proxy rejection)

## Case 3: Proxy Observability

Status:
- Passed (2026-02-11)

Config:
- Same as Case 2

Command:
- Any `curl` request (recommended: `curl -sS http://postman-echo.com/headers`)

Expected (panel execution decision/result):
- `image`
- `proxyHost`
- `proxyHostSource`
- `HTTP_PROXY` / `ALL_PROXY`
- `proxyConnectivity`
- `injectRules`

## Case 4: Deno-like Placeholder Mode (`network.secrets`)

Status:
- Passed (2026-02-11)
- Note: pure `network.secrets` mode validated (`injectRules` absent; `request · placeholder_replace` hit)

Config:
- `secretEnv: { "API_KEY": "BOXBOX_TEST_API_KEY" }`
- `network.secrets: { "API_KEY": { "hosts": ["postman-echo.com"] } }`
- Do not set `network.secretInjection.rules`

Commands:
- `echo "$API_KEY"`
- `curl -sS http://postman-echo.com/headers -H "X-Test-Secret: $API_KEY"`

Expected:
- `echo "$API_KEY"` outputs `BOXBOX_SECRET_PLACEHOLDER_...`
- Requests to `postman-echo.com` have `X-Test-Secret` replaced by the real secret at the proxy

## Case 5: Secret Host Scope (No Replace on Mismatch)

Status:
- Passed (2026-02-11)
- Note: when `postman-echo.com` is out of scope, placeholder stays, no `request · placeholder_replace` / `request · inject`

Config:
- `secretEnv: { "API_KEY": "BOXBOX_TEST_API_KEY" }`
- `network.secrets: { "API_KEY": { "hosts": ["example.com"] } }`
- Do not set `network.secretInjection.rules`

Command:
- `curl -sS http://postman-echo.com/headers -H "X-Test-Secret: $API_KEY"`

Expected:
- `postman-echo.com` is out of scope, header must not be replaced with the real value
- Echoed header should remain placeholder (or your original value), not the secret

## Case 6: `secretInjection.rules` Regression

Status:
- Passed (2026-02-11)
- Note: `echo "$API_KEY"` is empty; log hits `request · inject`, response hits `response · redact`

Config:
- `secretEnv: { "API_KEY": "BOXBOX_TEST_API_KEY" }`
- `network.secretInjection.rules: [{ "domains": ["postman-echo.com"], "headers": { "X-Api-Key": "API_KEY" } }]`

Commands:
- `echo "$API_KEY"`
- `curl -sS http://postman-echo.com/headers`

Expected:
- `echo "$API_KEY"` is empty or undefined (real secret is not placed in the process env)
- Response shows `x-api-key` (this mode injects real headers at the proxy)

## Case 7: Filesystem Policy (Read-only and Writable)

Status:
- Passed (2026-02-12)
- Note: Step A (read-only) and Step B (allowWrite enabled) both validated

Step A (read-only):
- Config: `filesystem: { denyRead: [], allowWrite: [], denyWrite: [] }`
- Run: `pwd`
- Run: `sh -c 'echo hi > .bb_fs_test'`

Expected A:
- Write fails (cwd is read-only)

Step B (allow cwd write):
- Add the absolute path from `pwd` to `allowWrite`
- Run: `sh -c 'echo hi > .bb_fs_test && cat .bb_fs_test'`

Expected B:
- Write and read succeed

## Case 8: Host Fallback

Status:
- Passed (2026-02-11)

Step A (force host):
- Config: `enabled: false`
- Run: `uname -a`

Expected A:
- Panel `decision` shows `backend=host`

Step B (restore sandbox):
- Config: `enabled: true`
- Run `uname -a` again

Expected B:
- Panel `decision` returns to `backend=boxlite`

Additional verification (2026-02-11):
- When `enabled: false`, a `Run on host?` prompt appears
- Permissions example: `selected · host_fallback · uname -a · sandbox_disabled`
- When `excludedCommands: ["uname"]`, `uname -a` also triggers host fallback
- Permissions example: `selected · host_fallback · uname -a · excluded_command`
- Execution example: `decision · host · excluded_command`

## Case 9: Permission Prompt Policy (Box Integration)

Notes:
- This case validates `box` integration with ACP permission requests and sandbox decisions, not the boxbox core API itself.
- It directly affects boxbox usability in the product, so it should be regressed alongside the core cases.
