import { createConnection } from "node:net";
import { URL } from "node:url";
import type { ProxyConnectivityCheck } from "./types.js";

function parseProxyTarget(urlValue: string): { host: string; port: number; target: string } {
  const parsed = new URL(urlValue);
  const port =
    parsed.port.length > 0
      ? parseInt(parsed.port, 10)
      : parsed.protocol.startsWith("socks")
        ? 1080
        : 80;
  if (!parsed.hostname || Number.isNaN(port)) {
    throw new Error(`invalid proxy url: ${urlValue}`);
  }
  return { host: parsed.hostname, port, target: `${parsed.hostname}:${port}` };
}

export async function checkProxyConnectivity(urlValue?: string): Promise<ProxyConnectivityCheck> {
  if (!urlValue) {
    return { scope: "host", status: "skipped" };
  }

  let target: { host: string; port: number; target: string };
  try {
    target = parseProxyTarget(urlValue);
  } catch (error) {
    return {
      scope: "host",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return await new Promise((resolve) => {
    const started = Date.now();
    const socket = createConnection({
      host: target.host,
      port: target.port,
    });
    let settled = false;

    const finish = (payload: Omit<ProxyConnectivityCheck, "scope">) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        scope: "host",
        ...payload,
      });
    };

    socket.setTimeout(1500);
    socket.on("connect", () => {
      finish({
        status: "ok",
        target: target.target,
        latencyMs: Date.now() - started,
      });
    });
    socket.on("timeout", () => {
      finish({
        status: "error",
        target: target.target,
        error: "tcp connect timeout",
      });
    });
    socket.on("error", (error) => {
      finish({
        status: "error",
        target: target.target,
        error: error.message,
      });
    });
  });
}
