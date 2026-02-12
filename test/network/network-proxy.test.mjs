/**
 * Unit tests for network proxy (ensureProxyRunning, filter).
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { ensureProxyRunning, stopProxy } from "../../dist/esm/network-proxy/index.js";
import { subscribeNetworkLog, subscribeSecretInjectionLog } from "../../dist/esm/logging/sandbox-log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ensureProxyRunning(undefined getter) => null
{
  const out = await ensureProxyRunning(() => undefined);
  assert.equal(out, null);
}

// ensureProxyRunning with httpProxyPort => proxyUrl to default host gateway, no server started
{
  const out = await ensureProxyRunning(() => ({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    httpProxyPort: 9999,
  }));
  assert.ok(out);
  assert.equal(out.proxyUrl, "http://192.168.127.1:9999");
  assert.equal(out.socksProxyUrl, undefined);
  assert.equal(out.proxyHost, "192.168.127.1");
  assert.equal(out.proxyHostSource, "default");
}

// ensureProxyRunning with socksProxyPort => socksProxyUrl; with both ports => both URLs
{
  const out = await ensureProxyRunning(() => ({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    httpProxyPort: 8080,
    socksProxyPort: 1080,
  }));
  assert.ok(out);
  assert.equal(out.proxyUrl, "http://192.168.127.1:8080");
  assert.equal(out.socksProxyUrl, "socks5h://192.168.127.1:1080");
  assert.equal(out.proxyHost, "192.168.127.1");
  assert.equal(out.proxyHostSource, "default");
}

// ensureProxyRunning with custom proxyHost => proxy URLs use custom host
{
  const out = await ensureProxyRunning(() => ({
    allowedDomains: ["example.com"],
    deniedDomains: [],
    proxyHost: "host.docker.internal",
    httpProxyPort: 8081,
    socksProxyPort: 1081,
  }));
  assert.ok(out);
  assert.equal(out.proxyUrl, "http://host.docker.internal:8081");
  assert.equal(out.socksProxyUrl, "socks5h://host.docker.internal:1081");
  assert.equal(out.proxyHost, "host.docker.internal");
  assert.equal(out.proxyHostSource, "config");
  assert.equal(out.requestedProxyHost, "host.docker.internal");
}

// ensureProxyRunning with no httpProxyPort => starts server, returns proxyUrl with default host gateway
{
  const config = {
    allowedDomains: ["allowed.com"],
    deniedDomains: ["denied.com"],
  };
  const events = [];
  const unsubscribe = subscribeNetworkLog((event) => {
    events.push(event);
  });
  const out = await ensureProxyRunning(() => config);
  assert.ok(out);
  assert.ok(out.proxyUrl.startsWith("http://192.168.127.1:"));
  assert.equal(out.proxyHostSource, "default");
  const port = parseInt(out.proxyUrl.split(":")[2], 10);
  assert.ok(port > 0 && port < 65536);

  // CONNECT denied.com => 403
  const connDenied = await new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1", () => {
      socket.write("CONNECT denied.com:443 HTTP/1.1\r\nHost: denied.com:443\r\n\r\n");
    });
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(buf);
      }
    });
    socket.on("error", reject);
  });
  assert.ok(connDenied.includes("403"), "denied domain should get 403");
  assert.ok(connDenied.includes("blocked-by-allowlist"));
  await new Promise((r) => setTimeout(r, 10));
  const deniedEvent = events[events.length - 1];
  assert.equal(deniedEvent.decision, "deny");
  assert.equal(deniedEvent.host, "denied.com");
  assert.equal(deniedEvent.method, "CONNECT");

  // CONNECT allowed.com => 200 Connection Established
  const connAllowed = await new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1", () => {
      socket.write("CONNECT allowed.com:443 HTTP/1.1\r\nHost: allowed.com:443\r\n\r\n");
    });
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(buf);
      }
    });
    socket.on("error", reject);
  });
  assert.ok(connAllowed.includes("200"), "allowed domain should get 200");
  assert.ok(
    connAllowed.includes("Connection Established") || connAllowed.includes("200 OK"),
    "expected CONNECT success response"
  );
  await new Promise((r) => setTimeout(r, 10));
  const allowedEvent = events[events.length - 1];
  assert.equal(allowedEvent.decision, "allow");
  assert.equal(allowedEvent.host, "allowed.com");

  // Empty allowedDomains => CONNECT to any host blocked
  config.allowedDomains = [];
  config.deniedDomains = [];
  const connBlocked = await new Promise((resolve, reject) => {
    const socket = createConnection(port, "127.0.0.1", () => {
      socket.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    });
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      if (buf.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(buf);
      }
    });
    socket.on("error", reject);
  });
  assert.ok(connBlocked.includes("403"), "empty allowedDomains should block all");
  await new Promise((r) => setTimeout(r, 10));
  const defaultDenyEvent = events[events.length - 1];
  assert.equal(defaultDenyEvent.decision, "deny");
  assert.equal(defaultDenyEvent.rule, "default-deny");

  unsubscribe();
  stopProxy();
}

// Secret injection with MITM routing for HTTP requests
{
  let receivedHeaders = null;
  const mitm = createHttpServer((req, res) => {
    receivedHeaders = req.headers;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
  await new Promise((resolve) => mitm.listen(0, "127.0.0.1", resolve));
  const mitmAddress = mitm.address();
  const mitmPort =
    mitmAddress && typeof mitmAddress === "object" && "port" in mitmAddress
      ? mitmAddress.port
      : 0;
  assert.ok(mitmPort > 0);

  const config = {
    allowedDomains: ["example.com"],
    deniedDomains: [],
    mitmProxy: { host: "127.0.0.1", port: mitmPort, domains: ["example.com"] },
    secretInjection: {
      rules: [{ domains: ["example.com"], headers: { "X-Api-Key": "API_KEY" } }],
    },
  };
  const secrets = { values: { API_KEY: "secret123" } };
  const injectionEvents = [];
  const unsubscribe = subscribeSecretInjectionLog((event) => {
    injectionEvents.push(event);
  });

  const out = await ensureProxyRunning(() => config, () => secrets);
  assert.ok(out);
  const proxyPort = parseInt(out.proxyUrl.split(":")[2], 10);

  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: "http://example.com/hello",
        headers: { Host: "example.com" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk.toString()));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(response, "ok");
  assert.ok(receivedHeaders);
  assert.equal(receivedHeaders["x-api-key"], "secret123");
  assert.ok(injectionEvents.length > 0);
  assert.ok(injectionEvents[injectionEvents.length - 1].secretNames.includes("API_KEY"));

  unsubscribe();
  mitm.close();
  stopProxy();
}

// Placeholder replacement for HTTP requests routed via MITM
{
  let receivedAuth = null;
  const mitm = createHttpServer((req, res) => {
    receivedAuth = req.headers["authorization"] ?? null;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
  await new Promise((resolve) => mitm.listen(0, "127.0.0.1", resolve));
  const mitmAddress = mitm.address();
  const mitmPort =
    mitmAddress && typeof mitmAddress === "object" && "port" in mitmAddress
      ? mitmAddress.port
      : 0;
  assert.ok(mitmPort > 0);

  const placeholder = "BOXBOX_SECRET_PLACEHOLDER_TEST";
  const config = {
    allowedDomains: ["example.com"],
    deniedDomains: [],
    mitmProxy: { host: "127.0.0.1", port: mitmPort, domains: ["example.com"] },
    secrets: {
      API_KEY: { hosts: ["example.com"] },
    },
  };
  const secrets = {
    values: { API_KEY: "secret123" },
    placeholders: { API_KEY: placeholder },
    scopes: { API_KEY: { hosts: ["example.com"] } },
  };

  const out = await ensureProxyRunning(() => config, () => secrets);
  assert.ok(out);
  const proxyPort = parseInt(out.proxyUrl.split(":")[2], 10);

  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: "http://example.com/hello",
        headers: { Host: "example.com", Authorization: `Bearer ${placeholder}` },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk.toString()));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(response, "ok");
  assert.equal(receivedAuth, "Bearer secret123");

  mitm.close();
  stopProxy();
}

// Response redaction in best_effort mode for HTTP responses
{
  let receivedHeaders = null;
  const upstream = createHttpServer((req, res) => {
    receivedHeaders = req.headers;
    const reflectedSecret = String(req.headers["x-api-key"] ?? "");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-Upstream-Secret": reflectedSecret,
    });
    res.end(JSON.stringify({ secret: reflectedSecret }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  const upstreamPort =
    upstreamAddress && typeof upstreamAddress === "object" && "port" in upstreamAddress
      ? upstreamAddress.port
      : 0;
  assert.ok(upstreamPort > 0);

  const config = {
    allowedDomains: ["example.com"],
    deniedDomains: [],
    mitmProxy: { host: "127.0.0.1", port: upstreamPort, domains: ["example.com"] },
    secretInjection: {
      rules: [{ domains: ["example.com"], headers: { "X-Api-Key": "API_KEY" } }],
    },
    secretProtectionMode: "best_effort",
  };
  const secrets = { values: { API_KEY: "secret123" } };
  const secretEvents = [];
  const unsubscribe = subscribeSecretInjectionLog((event) => {
    secretEvents.push(event);
  });

  const out = await ensureProxyRunning(() => config, () => secrets);
  assert.ok(out);
  const proxyPort = parseInt(out.proxyUrl.split(":")[2], 10);

  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: "http://example.com/redact",
        headers: { Host: "example.com" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk.toString()));
        res.on("end", () => {
          resolve({
            body,
            header: res.headers["x-upstream-secret"],
          });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

  assert.ok(receivedHeaders);
  assert.equal(receivedHeaders["x-api-key"], "secret123");
  assert.ok(!response.body.includes("secret123"));
  assert.ok(String(response.header).includes("BOXBOX_SECRET_REDACTED_API_KEY"));
  assert.ok(response.body.includes("BOXBOX_SECRET_REDACTED_API_KEY"));

  const redactionEvent = secretEvents.find(
    (event) => event.direction === "response" && event.action === "redact"
  );
  assert.ok(redactionEvent, "expected response redaction log event");

  unsubscribe();
  upstream.close();
  stopProxy();
}

// Response redaction maxBodyBytes: best_effort should skip body redaction when too large
{
  const secretValue = "secret123";
  const largeBody = "x".repeat(64) + secretValue + "y".repeat(64);
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: largeBody }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  const upstreamPort =
    upstreamAddress && typeof upstreamAddress === "object" && "port" in upstreamAddress
      ? upstreamAddress.port
      : 0;
  assert.ok(upstreamPort > 0);

  const config = {
    allowedDomains: ["example.com"],
    deniedDomains: [],
    mitmProxy: { host: "127.0.0.1", port: upstreamPort, domains: ["example.com"] },
    secretInjection: {
      rules: [{ domains: ["example.com"], headers: { "X-Api-Key": "API_KEY" } }],
    },
    secretProtectionMode: "best_effort",
    secretResponseRedaction: { enabled: true, maxBodyBytes: 32 },
  };
  const secrets = { values: { API_KEY: secretValue } };

  const out = await ensureProxyRunning(() => config, () => secrets);
  assert.ok(out);
  const proxyPort = parseInt(out.proxyUrl.split(":")[2], 10);

  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: "http://example.com/large",
        headers: { Host: "example.com" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk.toString()));
        res.on("end", () => resolve({ statusCode: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });

  assert.equal(response.statusCode, 200);
  // body redaction skipped due to maxBodyBytes in best_effort mode
  assert.ok(response.body.includes(secretValue));

  upstream.close();
  stopProxy();
}

// Response redaction maxBodyBytes: best_effort should switch to streaming once limit is exceeded
{
  const secretValue = "secret123";
  const chunk1 = `{"first":"${"a".repeat(18)}"`;
  const chunk2 = `,"secret":"${secretValue}${"b".repeat(10)}"`;
  const chunk3 = `,"tail":"${"c".repeat(16)}"}`;
  let thirdChunkSent = false;

  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write(chunk1);
    setTimeout(() => {
      res.write(chunk2);
      setTimeout(() => {
        thirdChunkSent = true;
        res.write(chunk3);
        res.end();
      }, 80);
    }, 40);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  const upstreamPort =
    upstreamAddress && typeof upstreamAddress === "object" && "port" in upstreamAddress
      ? upstreamAddress.port
      : 0;
  assert.ok(upstreamPort > 0);

  const config = {
    allowedDomains: ["example.com"],
    deniedDomains: [],
    mitmProxy: { host: "127.0.0.1", port: upstreamPort, domains: ["example.com"] },
    secretInjection: {
      rules: [{ domains: ["example.com"], headers: { "X-Api-Key": "API_KEY" } }],
    },
    secretProtectionMode: "best_effort",
    secretResponseRedaction: { enabled: true, maxBodyBytes: 32 },
  };
  const secrets = { values: { API_KEY: secretValue } };

  const out = await ensureProxyRunning(() => config, () => secrets);
  assert.ok(out);
  const proxyPort = parseInt(out.proxyUrl.split(":")[2], 10);

  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: "http://example.com/chunked-large",
        headers: { Host: "example.com" },
      },
      (res) => {
        let body = "";
        let sawDataBeforeThirdChunk = false;
        res.on("data", (chunk) => {
          if (!thirdChunkSent) {
            sawDataBeforeThirdChunk = true;
          }
          body += chunk.toString();
        });
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            body,
            headers: res.headers,
            sawDataBeforeThirdChunk,
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes(secretValue), "best_effort fallback should skip body redaction");
  assert.equal(
    response.sawDataBeforeThirdChunk,
    true,
    "proxy should stream response before upstream fully ends once maxBodyBytes is exceeded"
  );
  assert.ok(
    !(
      response.headers["content-length"] !== undefined &&
      response.headers["transfer-encoding"] !== undefined
    ),
    "response must not include both Content-Length and Transfer-Encoding"
  );

  upstream.close();
  stopProxy();
}

// Response redaction maxBodyBytes: strict should block when body too large
{
  const secretValue = "secret123";
  const largeBody = "x".repeat(64) + secretValue + "y".repeat(64);
  const upstream = createHttpServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: largeBody }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  const upstreamPort =
    upstreamAddress && typeof upstreamAddress === "object" && "port" in upstreamAddress
      ? upstreamAddress.port
      : 0;
  assert.ok(upstreamPort > 0);

  const config = {
    allowedDomains: ["example.com"],
    deniedDomains: [],
    mitmProxy: { host: "127.0.0.1", port: upstreamPort, domains: ["example.com"] },
    secretInjection: {
      rules: [{ domains: ["example.com"], headers: { "X-Api-Key": "API_KEY" } }],
    },
    secretProtectionMode: "strict",
    secretResponseRedaction: { enabled: true, maxBodyBytes: 32 },
  };
  const secrets = { values: { API_KEY: secretValue } };

  const out = await ensureProxyRunning(() => config, () => secrets);
  assert.ok(out);
  const proxyPort = parseInt(out.proxyUrl.split(":")[2], 10);

  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: "http://example.com/large",
        headers: { Host: "example.com" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk.toString()));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            header: res.headers["x-proxy-error"],
            body,
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.header, "secret-redaction-body-too-large");
  assert.ok(response.body.includes("secret redaction body limit"));

  upstream.close();
  stopProxy();
}
