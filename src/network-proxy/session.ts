import type { Server } from "node:http";
import type { NetworkConfig } from "../config/index.js";
import { createProxyServer } from "./server.js";
import {
  DEFAULT_SESSION_KEY,
  type EnsureProxyOptions,
  type ProxySecrets,
  type ProxyUrls,
} from "./constants.js";
import { resolveProxyHost } from "./host.js";

interface ProxySession {
  server: Server;
  boundPort: number;
  getConfigRef: { current: () => NetworkConfig | undefined };
  getSecretsRef: { current: () => ProxySecrets | undefined };
}

const proxySessions = new Map<string, ProxySession>();
let legacyConfigGetter: (() => NetworkConfig | undefined) | null = null;

export function setNetworkConfigGetter(getter: () => NetworkConfig | undefined): void {
  legacyConfigGetter = getter;
}

function listenOnHost(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      const addr = server.address();
      if (addr && typeof addr === "object" && "port" in addr) {
        cleanup();
        resolve(addr.port);
      }
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.on("error", onError);
    server.on("listening", onListening);
    server.listen(0, host);
  });
}

async function listenProxyServer(server: Server): Promise<number> {
  try {
    return await listenOnHost(server, "0.0.0.0");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EADDRNOTAVAIL" && code !== "EACCES") {
      throw error;
    }
    return await listenOnHost(server, "127.0.0.1");
  }
}

export async function ensureProxyRunning(
  getConfig: () => NetworkConfig | undefined,
  getSecrets?: () => ProxySecrets | undefined,
  options?: EnsureProxyOptions
): Promise<ProxyUrls | null> {
  const effectiveGetConfig = () => getConfig() ?? legacyConfigGetter?.();
  const config = effectiveGetConfig();
  if (!config) return null;

  const hostResolution = await resolveProxyHost(config);
  const proxyHost = hostResolution.proxyHost;
  const metadata = {
    proxyHost,
    proxyHostSource: hostResolution.proxyHostSource,
    requestedProxyHost: hostResolution.requestedProxyHost,
    autoInterface: hostResolution.autoInterface,
    autoGateway: hostResolution.autoGateway,
  };

  if (config.httpProxyPort || config.socksProxyPort) {
    const proxyUrl = config.httpProxyPort
      ? `http://${proxyHost}:${config.httpProxyPort}`
      : undefined;
    const socksProxyUrl = config.socksProxyPort
      ? `socks5h://${proxyHost}:${config.socksProxyPort}`
      : undefined;
    return {
      ...metadata,
      proxyUrl,
      socksProxyUrl,
    };
  }

  const sessionKey = options?.sessionKey ?? DEFAULT_SESSION_KEY;
  const existing = proxySessions.get(sessionKey);
  if (existing) {
    existing.getConfigRef.current = effectiveGetConfig;
    existing.getSecretsRef.current = getSecrets ?? (() => undefined);
    return {
      ...metadata,
      proxyUrl: `http://${proxyHost}:${existing.boundPort}`,
      socksProxyUrl: `socks5h://${proxyHost}:${existing.boundPort}`,
    };
  }

  const getConfigRef = { current: effectiveGetConfig };
  const getSecretsRef = { current: getSecrets ?? (() => undefined) };
  const server = createProxyServer(() => getConfigRef.current(), () => getSecretsRef.current());
  const boundPort = await listenProxyServer(server);

  proxySessions.set(sessionKey, {
    server,
    boundPort,
    getConfigRef,
    getSecretsRef,
  });

  return {
    ...metadata,
    proxyUrl: `http://${proxyHost}:${boundPort}`,
    socksProxyUrl: `socks5h://${proxyHost}:${boundPort}`,
  };
}

export function stopProxy(sessionKey?: string): void {
  if (sessionKey) {
    const session = proxySessions.get(sessionKey);
    if (session) {
      session.server.close();
      proxySessions.delete(sessionKey);
    }
    return;
  }
  for (const [key, session] of proxySessions.entries()) {
    session.server.close();
    proxySessions.delete(key);
  }
}
