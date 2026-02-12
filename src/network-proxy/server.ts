import { createServer, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { URL } from "node:url";
import type { NetworkConfig } from "../config/index.js";
import { emitNetworkLog, emitSecretInjectionLog } from "../logging/sandbox-log.js";
import { DEFAULT_MAX_REDACTION_BODY_BYTES } from "./constants.js";
import { dropConflictingLengthHeaders, stripUndefinedHeaders } from "./headers.js";
import {
  applyPlaceholderReplacements,
  collectPlaceholderReplacements,
  collectSecretInjection,
  collectSecretRedactions,
  decideNetwork,
  getMitmTarget,
  isLikelyTextContentType,
  redactResponseHeaders,
  resolveSecretProtectionMode,
  shouldRedactResponses,
} from "./secrets.js";
import type { ProxySecrets } from "./constants.js";

export function createProxyServer(
  getConfig: () => NetworkConfig | undefined,
  getSecrets: () => ProxySecrets | undefined
): Server {
  const s = createServer();

  s.on("connect", (req, socket) => {
    socket.on("error", () => {});

    const [hostname, portStr] = (req.url ?? "").split(":");
    const port = portStr !== undefined ? parseInt(portStr, 10) : undefined;

    if (!hostname || port === undefined || Number.isNaN(port)) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    const config = getConfig();
    const secrets = getSecrets();
    const decision = decideNetwork(hostname, config);
    emitNetworkLog({
      timestamp: new Date().toISOString(),
      decision: decision.allowed ? "allow" : "deny",
      host: hostname,
      port,
      method: "CONNECT",
      url: `${hostname}:${port}`,
      rule: decision.rule,
    });

    if (!decision.allowed) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\n" +
          "Content-Type: text/plain\r\n" +
          "X-Proxy-Error: blocked-by-allowlist\r\n" +
          "\r\n" +
          "Connection blocked by network allowlist"
      );
      return;
    }

    const mitmTarget = getMitmTarget(hostname, config);
    const injection = mitmTarget ? collectSecretInjection(hostname, config, secrets) : null;
    const placeholderReplacements = mitmTarget
      ? collectPlaceholderReplacements(hostname, config, secrets)
      : [];

    if (mitmTarget) {
      const mitmSocket = connect(mitmTarget.port, mitmTarget.host, () => {
        let extraHeaders = "";
        if (injection) {
          extraHeaders = injection.headerNames
            .map((headerName) => {
              const value = injection.headers[headerName];
              return `X-Boxbox-Secret-${headerName}: ${value}\r\n`;
            })
            .join("");
        }
        if (placeholderReplacements.length > 0) {
          const placeholderPayload = placeholderReplacements.map((entry) => ({
            placeholder: entry.placeholder,
            value: entry.value,
          }));
          const encoded = Buffer.from(JSON.stringify(placeholderPayload), "utf8").toString("base64");
          extraHeaders += `X-Boxbox-Secret-Placeholders: ${encoded}\r\n`;
        }

        mitmSocket.write(
          `CONNECT ${hostname}:${port} HTTP/1.1\r\n` +
            `Host: ${hostname}:${port}\r\n` +
            extraHeaders +
            "\r\n"
        );

        if (injection) {
          emitSecretInjectionLog({
            timestamp: new Date().toISOString(),
            host: hostname,
            headersInjected: injection.headerNames,
            secretNames: injection.secretNames,
            direction: "request",
            action: "inject",
          });
        }
        if (placeholderReplacements.length > 0) {
          emitSecretInjectionLog({
            timestamp: new Date().toISOString(),
            host: hostname,
            headersInjected: placeholderReplacements.map((entry) => entry.placeholder),
            secretNames: placeholderReplacements.map((entry) => entry.secretName),
            direction: "request",
            action: "placeholder_replace",
          });
        }
      });

      mitmSocket.pipe(socket);
      socket.pipe(mitmSocket);
      mitmSocket.on("error", () => {
        socket.end();
      });
      return;
    }

    const serverSocket = connect(port, hostname, () => {
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      socket.pipe(serverSocket);
      serverSocket.pipe(socket);
    });

    serverSocket.on("error", () => {
      socket.end();
    });
  });

  s.on("request", (req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const hostname = url.hostname;
    const port = url.port
      ? parseInt(url.port, 10)
      : url.protocol === "https:"
        ? 443
        : 80;

    if (!hostname || Number.isNaN(port)) {
      res.writeHead(400);
      res.end("Invalid URL");
      return;
    }

    const config = getConfig();
    const secrets = getSecrets();
    const decision = decideNetwork(hostname, config);
    emitNetworkLog({
      timestamp: new Date().toISOString(),
      decision: decision.allowed ? "allow" : "deny",
      host: hostname,
      port,
      method: req.method ?? "GET",
      url: url.toString(),
      rule: decision.rule,
    });

    if (!decision.allowed) {
      res.writeHead(403, {
        "Content-Type": "text/plain",
        "X-Proxy-Error": "blocked-by-allowlist",
      });
      res.end("Connection blocked by network allowlist");
      return;
    }

    const mitmTarget = getMitmTarget(hostname, config);
    const injection = collectSecretInjection(hostname, config, secrets);
    const placeholderReplacements = collectPlaceholderReplacements(hostname, config, secrets);
    const responseRedactions = collectSecretRedactions(hostname, config, secrets);
    const redactResponses = shouldRedactResponses(config, responseRedactions);

    const baseHeaders = { ...req.headers, host: url.host };
    const replaced = applyPlaceholderReplacements(baseHeaders, placeholderReplacements);
    const baseWithPlaceholders = replaced ? replaced.headers : baseHeaders;
    const baseWithEncodingPolicy = redactResponses
      ? stripUndefinedHeaders({
          ...baseWithPlaceholders,
          "accept-encoding": "identity",
          "Accept-Encoding": undefined,
        })
      : baseWithPlaceholders;

    const requestFn = mitmTarget
      ? httpRequest
      : url.protocol === "https:"
        ? httpsRequest
        : httpRequest;
    const targetHost = mitmTarget?.host ?? hostname;
    const targetPort = mitmTarget?.port ?? port;
    const path = mitmTarget ? url.href : url.pathname + url.search;
    const headers = injection
      ? { ...baseWithEncodingPolicy, ...injection.headers }
      : baseWithEncodingPolicy;

    const proxyReq = requestFn(
      {
        hostname: targetHost,
        port: targetPort,
        path,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const redactedHeadersResult = redactResponses
          ? redactResponseHeaders(proxyRes.headers, responseRedactions)
          : { headers: stripUndefinedHeaders(proxyRes.headers), redacted: false };
        const redactedHeaders = redactedHeadersResult.headers;
        const headersRedacted = redactedHeadersResult.redacted;

        const contentType = Array.isArray(proxyRes.headers["content-type"])
          ? proxyRes.headers["content-type"][0]
          : proxyRes.headers["content-type"];
        const shouldRedactBody = redactResponses && isLikelyTextContentType(contentType);

        if (!shouldRedactBody) {
          const outgoingHeaders = dropConflictingLengthHeaders(redactedHeaders);
          if (headersRedacted) {
            emitSecretInjectionLog({
              timestamp: new Date().toISOString(),
              host: hostname,
              headersInjected: Object.keys(outgoingHeaders),
              secretNames: responseRedactions.map((entry) => entry.secretName),
              direction: "response",
              action: "redact",
              redacted: true,
              carrier: "headers",
            });
          }
          res.writeHead(proxyRes.statusCode ?? 500, outgoingHeaders);
          proxyRes.pipe(res);
          return;
        }

        const maxBodyBytes = config?.secretResponseRedaction?.maxBodyBytes ?? DEFAULT_MAX_REDACTION_BODY_BYTES;
        const protectionMode = resolveSecretProtectionMode(config);
        const chunks: Buffer[] = [];
        let bufferedBytes = 0;
        let responseHandled = false;

        const writeStrictOverflow = () => {
          if (responseHandled) return;
          responseHandled = true;
          res.writeHead(502, {
            "Content-Type": "text/plain",
            "X-Proxy-Error": "secret-redaction-body-too-large",
          });
          res.end("Response exceeds strict secret redaction body limit");
        };

        const startBestEffortPassthrough = () => {
          if (responseHandled) return;
          responseHandled = true;
          proxyRes.off("data", onData);
          proxyRes.off("end", onEnd);
          const outgoingHeaders = dropConflictingLengthHeaders(redactedHeaders);
          if (headersRedacted) {
            emitSecretInjectionLog({
              timestamp: new Date().toISOString(),
              host: hostname,
              headersInjected: Object.keys(outgoingHeaders),
              secretNames: responseRedactions.map((entry) => entry.secretName),
              direction: "response",
              action: "redact",
              redacted: true,
              carrier: "headers",
            });
          }
          res.writeHead(proxyRes.statusCode ?? 500, outgoingHeaders);
          for (const bufferedChunk of chunks) {
            res.write(bufferedChunk);
          }
          chunks.length = 0;
          proxyRes.pipe(res);
        };

        const onData = (chunk: Buffer | string) => {
          if (responseHandled) return;
          const bufferedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bufferedBytes += bufferedChunk.byteLength;

          if (bufferedBytes > maxBodyBytes) {
            if (protectionMode === "strict") {
              writeStrictOverflow();
              proxyRes.destroy();
              return;
            }
            chunks.push(bufferedChunk);
            startBestEffortPassthrough();
            return;
          }

          chunks.push(bufferedChunk);
        };

        const onEnd = () => {
          if (responseHandled) return;
          responseHandled = true;

          const originalBodyBuffer = Buffer.concat(chunks);
          const originalBody = originalBodyBuffer.toString("utf8");
          const redactedBody = responseRedactions.reduce(
            (acc, redaction) => acc.split(redaction.value).join(redaction.replacement),
            originalBody
          );
          const bodyChanged = redactedBody !== originalBody;
          const outgoingHeaders: Record<string, string | string[]> = { ...redactedHeaders };

          // We're buffering the full body under maxBodyBytes; always send a fixed
          // Content-Length and drop Transfer-Encoding to avoid header conflicts.
          delete outgoingHeaders["content-length"];
          delete outgoingHeaders["Content-Length"];
          delete outgoingHeaders["transfer-encoding"];
          delete outgoingHeaders["Transfer-Encoding"];
          if (bodyChanged) {
            delete outgoingHeaders["content-encoding"];
            delete outgoingHeaders["Content-Encoding"];
          }

          const bodyBuffer = bodyChanged
            ? Buffer.from(redactedBody, "utf8")
            : originalBodyBuffer;
          outgoingHeaders["content-length"] = String(bodyBuffer.byteLength);

          if (bodyChanged || headersRedacted) {
            emitSecretInjectionLog({
              timestamp: new Date().toISOString(),
              host: hostname,
              headersInjected: Object.keys(outgoingHeaders),
              secretNames: responseRedactions.map((entry) => entry.secretName),
              direction: "response",
              action: "redact",
              redacted: true,
              carrier: bodyChanged && headersRedacted
                ? "headers+body"
                : bodyChanged
                  ? "body"
                  : "headers",
            });
          }

          res.writeHead(proxyRes.statusCode ?? 500, outgoingHeaders);
          res.end(bodyBuffer);
        };

        proxyRes.on("data", onData);
        proxyRes.on("end", onEnd);
      }
    );

    proxyReq.on("error", () => {
      res.writeHead(502);
      res.end("Proxy request failed");
    });

    req.pipe(proxyReq);

    if (injection) {
      emitSecretInjectionLog({
        timestamp: new Date().toISOString(),
        host: hostname,
        headersInjected: injection.headerNames,
        secretNames: injection.secretNames,
        direction: "request",
        action: "inject",
      });
    }

    if (replaced) {
      emitSecretInjectionLog({
        timestamp: new Date().toISOString(),
        host: hostname,
        headersInjected: replaced.headerNames,
        secretNames: replaced.secretNames,
        direction: "request",
        action: "placeholder_replace",
      });
    }
  });

  return s;
}
