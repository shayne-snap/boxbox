/**
 * Proxy session behavior tests (sessionKey reuse / isolation).
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import { ensureProxyRunning, stopProxy } from "../../dist/esm/network-proxy/index.js";

const baseConfig = {
  allowedDomains: ["example.com"],
  deniedDomains: [],
};

function parsePort(proxyUrl) {
  return parseInt(proxyUrl.split(":")[2], 10);
}

// Same sessionKey should reuse the same proxy server/port.
{
  const out1 = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s1" });
  const out2 = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s1" });
  assert.ok(out1 && out2);
  assert.equal(parsePort(out1.proxyUrl), parsePort(out2.proxyUrl));
  stopProxy("s1");
}

// Different sessionKeys should use different proxy servers/ports.
{
  const out1 = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s1" });
  const out2 = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s2" });
  assert.ok(out1 && out2);
  assert.notEqual(parsePort(out1.proxyUrl), parsePort(out2.proxyUrl));
  stopProxy("s1");
  stopProxy("s2");
}

// stopProxy(sessionKey) should only stop that session.
{
  const out1 = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s1" });
  const out2 = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s2" });
  assert.ok(out1 && out2);
  const port1 = parsePort(out1.proxyUrl);
  const port2 = parsePort(out2.proxyUrl);

  stopProxy("s1");
  const out1b = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s1" });
  const out2b = await ensureProxyRunning(() => baseConfig, undefined, { sessionKey: "s2" });
  assert.ok(out1b && out2b);
  assert.notEqual(parsePort(out1b.proxyUrl), port1);
  assert.equal(parsePort(out2b.proxyUrl), port2);

  stopProxy("s1");
  stopProxy("s2");
}
