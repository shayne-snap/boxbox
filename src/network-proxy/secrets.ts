import type { NetworkConfig, SecretProtectionMode } from "../config/index.js";
import { matchesDomainPattern } from "../util/domain-match.js";
import type { ProxySecrets } from "./constants.js";
import { isValidHeaderName, isValidHeaderValue, stripUndefinedHeaders } from "./headers.js";

export function decideNetwork(host: string, config: NetworkConfig | undefined): { allowed: boolean; rule: string } {
  if (!config) return { allowed: false, rule: "no_config" };
  for (const pattern of config.deniedDomains) {
    if (matchesDomainPattern(host, pattern)) {
      return { allowed: false, rule: pattern };
    }
  }
  for (const pattern of config.allowedDomains) {
    if (matchesDomainPattern(host, pattern)) {
      return { allowed: true, rule: pattern };
    }
  }
  return { allowed: false, rule: "default-deny" };
}

function matchesAnyDomain(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesDomainPattern(host, pattern));
}

export function getMitmTarget(
  host: string,
  config: NetworkConfig | undefined
): { host: string; port: number } | null {
  const mitm = config?.mitmProxy;
  if (!mitm) return null;
  if (!matchesAnyDomain(host, mitm.domains)) return null;
  return { host: mitm.host, port: mitm.port };
}

export function collectSecretInjection(
  host: string,
  config: NetworkConfig | undefined,
  secrets: ProxySecrets | undefined
): {
  headers: Record<string, string>;
  headerNames: string[];
  secretNames: string[];
} | null {
  const rules = config?.secretInjection?.rules ?? [];
  const values = secrets?.values ?? {};
  if (!config || rules.length === 0 || Object.keys(values).length === 0) {
    return null;
  }

  const headerMap = new Map<string, { name: string; value: string }>();
  const secretNames: string[] = [];
  const seenSecretNames = new Set<string>();

  for (const rule of rules) {
    if (!matchesAnyDomain(host, rule.domains)) continue;
    for (const [headerName, secretName] of Object.entries(rule.headers)) {
      if (!isValidHeaderName(headerName)) continue;
      const value = values[secretName];
      if (typeof value !== "string") continue;
      if (!isValidHeaderValue(value)) continue;
      const headerKey = headerName.toLowerCase();
      if (headerMap.has(headerKey)) {
        headerMap.delete(headerKey);
      }
      headerMap.set(headerKey, { name: headerName, value });
      if (!seenSecretNames.has(secretName)) {
        secretNames.push(secretName);
        seenSecretNames.add(secretName);
      }
    }
  }

  if (headerMap.size === 0) return null;
  const headers: Record<string, string> = {};
  const headerNames: string[] = [];
  for (const entry of headerMap.values()) {
    headers[entry.name] = entry.value;
    headerNames.push(entry.name);
  }
  return { headers, headerNames, secretNames };
}

type PlaceholderReplacement = {
  placeholder: string;
  value: string;
  secretName: string;
};

export function collectPlaceholderReplacements(
  host: string,
  config: NetworkConfig | undefined,
  secrets: ProxySecrets | undefined
): PlaceholderReplacement[] {
  const scopes = config?.secrets;
  const values = secrets?.values ?? {};
  const placeholders = secrets?.placeholders ?? {};
  if (!config || !scopes || !secrets) return [];

  const replacements: PlaceholderReplacement[] = [];

  for (const [secretName, scope] of Object.entries(scopes)) {
    if (!matchesAnyDomain(host, scope.hosts)) continue;
    const placeholder = placeholders[secretName];
    const value = values[secretName];
    if (typeof placeholder !== "string" || placeholder.length === 0) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    if (!isValidHeaderValue(value)) continue;
    replacements.push({ placeholder, value, secretName });
  }

  return replacements;
}

export function applyPlaceholderReplacements(
  headers: Record<string, string | string[] | undefined>,
  replacements: PlaceholderReplacement[]
): { headers: Record<string, string | string[]>; headerNames: string[]; secretNames: string[] } | null {
  if (replacements.length === 0) return null;
  const nextHeaders: Record<string, string | string[] | undefined> = { ...headers };
  const headerNames: string[] = [];
  const secretNamesSet = new Set<string>();

  for (const [headerName, value] of Object.entries(nextHeaders)) {
    if (typeof value === "undefined") continue;
    if (typeof value === "string") {
      let updated = value;
      let touched = false;
      for (const replacement of replacements) {
        if (updated.includes(replacement.placeholder)) {
          updated = updated.split(replacement.placeholder).join(replacement.value);
          touched = true;
          secretNamesSet.add(replacement.secretName);
        }
      }
      if (touched) {
        nextHeaders[headerName] = updated;
        headerNames.push(headerName);
      }
    } else if (Array.isArray(value)) {
      let touched = false;
      const updatedValues = value.map((entry) => {
        let nextValue = entry;
        for (const replacement of replacements) {
          if (nextValue.includes(replacement.placeholder)) {
            nextValue = nextValue.split(replacement.placeholder).join(replacement.value);
            touched = true;
            secretNamesSet.add(replacement.secretName);
          }
        }
        return nextValue;
      });
      if (touched) {
        nextHeaders[headerName] = updatedValues;
        headerNames.push(headerName);
      }
    }
  }

  if (headerNames.length === 0) return null;
  return {
    headers: stripUndefinedHeaders(nextHeaders),
    headerNames,
    secretNames: Array.from(secretNamesSet),
  };
}

type SecretRedaction = {
  secretName: string;
  value: string;
  replacement: string;
};

export function collectSecretRedactions(
  host: string,
  config: NetworkConfig | undefined,
  secrets: ProxySecrets | undefined
): SecretRedaction[] {
  const values = secrets?.values ?? {};
  if (!config || Object.keys(values).length === 0) return [];

  const scopedSecrets = config.secrets ?? {};
  const injectionRules = config.secretInjection?.rules ?? [];
  const placeholders = secrets?.placeholders ?? {};
  const byName = new Map<string, SecretRedaction>();

  const pushSecret = (secretName: string) => {
    if (byName.has(secretName)) return;
    const value = values[secretName];
    if (typeof value !== "string" || value.length === 0) return;
    const placeholder = placeholders[secretName];
    const replacement =
      typeof placeholder === "string" && placeholder.length > 0
        ? placeholder
        : `BOXBOX_SECRET_REDACTED_${secretName}`;
    byName.set(secretName, {
      secretName,
      value,
      replacement,
    });
  };

  for (const [secretName, scope] of Object.entries(scopedSecrets)) {
    if (matchesAnyDomain(host, scope.hosts)) {
      pushSecret(secretName);
    }
  }

  for (const rule of injectionRules) {
    if (!matchesAnyDomain(host, rule.domains)) continue;
    for (const secretName of Object.values(rule.headers)) {
      pushSecret(secretName);
    }
  }

  return Array.from(byName.values());
}

export function isLikelyTextContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("javascript") ||
    normalized.includes("x-www-form-urlencoded")
  );
}

function replaceSecretValues(value: string, redactions: SecretRedaction[]): string {
  let updated = value;
  for (const redaction of redactions) {
    if (updated.includes(redaction.value)) {
      updated = updated.split(redaction.value).join(redaction.replacement);
    }
  }
  return updated;
}

export function redactResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
  redactions: SecretRedaction[]
): { headers: Record<string, string | string[]>; redacted: boolean } {
  const sanitized: Record<string, string | string[]> = {};
  let redacted = false;
  for (const [headerName, value] of Object.entries(headers)) {
    if (typeof value === "undefined") continue;
    if (typeof value === "string") {
      const updated = replaceSecretValues(value, redactions);
      if (updated !== value) redacted = true;
      sanitized[headerName] = updated;
      continue;
    }
    if (Array.isArray(value)) {
      const updatedValues = value.map((entry) => replaceSecretValues(entry, redactions));
      if (updatedValues.some((entry, index) => entry !== value[index])) {
        redacted = true;
      }
      sanitized[headerName] = updatedValues;
      continue;
    }
    sanitized[headerName] = value;
  }
  return { headers: sanitized, redacted };
}

export function resolveSecretProtectionMode(config: NetworkConfig | undefined): SecretProtectionMode {
  return config?.secretProtectionMode ?? "best_effort";
}

export function shouldRedactResponses(
  config: NetworkConfig | undefined,
  redactions: SecretRedaction[]
): boolean {
  if (redactions.length === 0) return false;
  const mode = resolveSecretProtectionMode(config);
  if (mode === "off") return false;
  const explicitEnabled = config?.secretResponseRedaction?.enabled;
  if (typeof explicitEnabled === "boolean") {
    return explicitEnabled;
  }
  return true;
}
