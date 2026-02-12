import { createHash } from "node:crypto";
import type { NetworkConfig, SecretProtectionMode } from "../config/index.js";
import type { ProxySecrets } from "../network-proxy/index.js";

function buildSecretPlaceholder(secretName: string, sessionId: string): string {
  const hash = createHash("sha256")
    .update(`${sessionId}:${secretName}`)
    .digest("hex");
  return `BOXBOX_SECRET_PLACEHOLDER_${hash}`;
}

export function buildSecretPlaceholderData(
  config: NetworkConfig | undefined,
  secrets: Record<string, string> | undefined,
  sessionId: string
): { envPlaceholders?: Record<string, string>; proxySecrets?: ProxySecrets } {
  if (!secrets || Object.keys(secrets).length === 0) return {};
  const proxySecrets: ProxySecrets = { values: secrets };
  const scopes = config?.secrets;
  if (!scopes || Object.keys(scopes).length === 0) {
    return { proxySecrets };
  }

  const envPlaceholders: Record<string, string> = {};
  const placeholders: Record<string, string> = {};

  for (const secretName of Object.keys(scopes)) {
    const value = secrets[secretName];
    if (typeof value !== "string" || value.length === 0) continue;
    const placeholder = buildSecretPlaceholder(secretName, sessionId);
    envPlaceholders[secretName] = placeholder;
    placeholders[secretName] = placeholder;
  }

  if (Object.keys(placeholders).length > 0) {
    proxySecrets.placeholders = placeholders;
    proxySecrets.scopes = scopes;
  }

  return {
    envPlaceholders: Object.keys(envPlaceholders).length > 0 ? envPlaceholders : undefined,
    proxySecrets,
  };
}

function collectProtectedDomains(config: NetworkConfig): string[] {
  const domains = new Set<string>();
  for (const scope of Object.values(config.secrets ?? {})) {
    for (const hostPattern of scope.hosts) {
      domains.add(hostPattern);
    }
  }
  for (const rule of config.secretInjection?.rules ?? []) {
    for (const domain of rule.domains) {
      domains.add(domain);
    }
  }
  return Array.from(domains);
}

export function getSecretProtectionMode(config: NetworkConfig): SecretProtectionMode {
  return config.secretProtectionMode ?? "best_effort";
}

export function validateStrictSecretProtection(
  config: NetworkConfig
): { ok: true } | { ok: false; reason: string } {
  const mode = getSecretProtectionMode(config);
  if (mode !== "strict") return { ok: true };

  if (config.secretResponseRedaction?.enabled === false) {
    return {
      ok: false,
      reason: "secretProtectionMode=strict requires secretResponseRedaction.enabled to be true",
    };
  }

  const protectedDomains = collectProtectedDomains(config);
  if (protectedDomains.length === 0) {
    return { ok: true };
  }

  if (config.httpProxyPort !== undefined || config.socksProxyPort !== undefined) {
    return {
      ok: false,
      reason:
        "secretProtectionMode=strict requires built-in proxy; external httpProxyPort/socksProxyPort is not supported",
    };
  }

  if (!config.mitmProxy) {
    return {
      ok: false,
      reason: "secretProtectionMode=strict requires network.mitmProxy",
    };
  }

  const mitmDomains = new Set(config.mitmProxy.domains);
  const uncovered = protectedDomains.filter((domain) => !mitmDomains.has(domain));
  if (uncovered.length > 0) {
    return {
      ok: false,
      reason: `secretProtectionMode=strict requires mitmProxy.domains to cover protected domains: ${uncovered.join(", ")}`,
    };
  }

  return { ok: true };
}
