/**
 * Proxy host fallback tests.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { ensureProxyRunning } from "../../dist/esm/network-proxy/index.js";

// blank proxyHost should fall back to default host gateway
{
  const out = await ensureProxyRunning(() => ({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    proxyHost: "   ",
    httpProxyPort: 9999,
  }));
  assert.ok(out);
  assert.equal(out.proxyUrl, "http://192.168.127.1:9999");
  assert.equal(out.proxyHost, "192.168.127.1");
  assert.equal(out.proxyHostSource, "default");
}
