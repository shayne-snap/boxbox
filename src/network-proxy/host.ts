import { networkInterfaces } from "node:os";
import type { NetworkConfig } from "../config/index.js";
import { DEFAULT_PROXY_HOST, type ProxyHostSource } from "./constants.js";

function isAutoProxyHost(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "auto";
}

function resolveInterfaceIpv4(interfaceName: string | undefined): string | undefined {
  if (!interfaceName) return undefined;
  const entries = networkInterfaces()[interfaceName];
  if (!entries) return undefined;
  const ipv4 = entries.find((entry) => entry.family === "IPv4" && !entry.internal);
  return ipv4?.address;
}

async function resolveAutoProxyHost(): Promise<{
  host: string;
  interfaceName?: string;
  gateway?: string;
}> {
  const gatewayModuleName = "default-gateway";
  let gatewayModule: { gateway4async?: () => Promise<{ gateway: string; int?: string | null }> };
  try {
    gatewayModule = (await import(gatewayModuleName)) as {
      gateway4async?: () => Promise<{ gateway: string; int?: string | null }>;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`proxyHost=auto requires dependency "default-gateway": ${message}`);
  }
  if (typeof gatewayModule.gateway4async !== "function") {
    throw new Error("default-gateway module is unavailable");
  }
  const gatewayInfo = await gatewayModule.gateway4async();
  const interfaceName =
    typeof gatewayInfo.int === "string" && gatewayInfo.int.length > 0
      ? gatewayInfo.int
      : undefined;
  const hostIp = resolveInterfaceIpv4(interfaceName);
  if (!hostIp) {
    throw new Error(
      interfaceName
        ? `unable to resolve IPv4 address for default route interface ${interfaceName}`
        : "unable to resolve IPv4 address for default route interface"
    );
  }
  return {
    host: hostIp,
    interfaceName,
    gateway: gatewayInfo.gateway,
  };
}

export async function resolveProxyHost(config: NetworkConfig): Promise<{
  requestedProxyHost?: string;
  proxyHost: string;
  proxyHostSource: ProxyHostSource;
  autoInterface?: string;
  autoGateway?: string;
}> {
  const requestedProxyHost = config.proxyHost?.trim();
  if (requestedProxyHost && !isAutoProxyHost(requestedProxyHost)) {
    return {
      requestedProxyHost,
      proxyHost: requestedProxyHost,
      proxyHostSource: "config",
    };
  }

  if (isAutoProxyHost(requestedProxyHost)) {
    const auto = await resolveAutoProxyHost();
    return {
      requestedProxyHost,
      proxyHost: auto.host,
      proxyHostSource: "auto",
      autoInterface: auto.interfaceName,
      autoGateway: auto.gateway,
    };
  }

  return {
    requestedProxyHost,
    proxyHost: DEFAULT_PROXY_HOST,
    proxyHostSource: "default",
  };
}
