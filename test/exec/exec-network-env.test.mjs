/**
 * Test that proxy env built for execute() has HTTP_PROXY pointing to 192.168.127.1 and NO_PROXY with private ranges.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProxyEnv, NO_PROXY_VALUE } from "../../dist/esm/exec/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// buildProxyEnv(proxyUrl) produces HTTP_PROXY and NO_PROXY
const env = buildProxyEnv("http://192.168.127.1:3128");
assert.equal(env.HTTP_PROXY, "http://192.168.127.1:3128");
assert.equal(env.HTTPS_PROXY, "http://192.168.127.1:3128");
assert.ok(env.NO_PROXY.includes("192.168"));
assert.ok(env.NO_PROXY.includes("10.0.0.0"));
assert.ok(NO_PROXY_VALUE.includes("192.168.0.0/16"));

// buildProxyEnv(undefined, socksProxyUrl) produces ALL_PROXY and SOCKS-related vars
const envSocks = buildProxyEnv(undefined, "socks5h://192.168.127.1:1080");
assert.equal(envSocks.ALL_PROXY, "socks5h://192.168.127.1:1080");
assert.equal(envSocks.all_proxy, "socks5h://192.168.127.1:1080");
assert.equal(envSocks.FTP_PROXY, "socks5h://192.168.127.1:1080");
assert.ok(envSocks.GIT_SSH_COMMAND.includes("192.168.127.1 1080"));
assert.equal(envSocks.HTTP_PROXY, undefined);

// buildProxyEnv(proxyUrl, socksProxyUrl) produces both HTTP and SOCKS vars
const envBoth = buildProxyEnv("http://192.168.127.1:3128", "socks5h://192.168.127.1:1080");
assert.equal(envBoth.HTTP_PROXY, "http://192.168.127.1:3128");
assert.equal(envBoth.ALL_PROXY, "socks5h://192.168.127.1:1080");
