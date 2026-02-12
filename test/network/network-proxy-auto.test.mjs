/**
 * proxyHost=auto behavior.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { ensureProxyRunning, stopProxy } from "../../dist/esm/network-proxy/index.js";

try {
  const out = await ensureProxyRunning(() => ({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    proxyHost: "auto",
    httpProxyPort: 9999,
  }));
  assert.ok(out);
  assert.equal(out.proxyHostSource, "auto");
  assert.equal(out.requestedProxyHost, "auto");
  assert.ok(typeof out.proxyHost === "string" && out.proxyHost.length > 0);
  stopProxy();
} catch (error) {
  // If the host auto-resolution fails in this environment, the error should be explicit.
  const message = error instanceof Error ? error.message : String(error);
  assert.ok(
    message.includes("proxyHost=auto") || message.includes("default route interface"),
    `unexpected error for proxyHost=auto: ${message}`
  );
}
