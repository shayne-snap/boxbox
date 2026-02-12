export const DEFAULT_PROXY_HOST = "192.168.127.1";
export const DEFAULT_SESSION_KEY = "__default__";
export const DEFAULT_MAX_REDACTION_BODY_BYTES = 1024 * 1024;

export const HEADER_NAME_REGEX = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export type ProxyHostSource = "config" | "auto" | "default";

export interface ProxySecrets {
  values: Record<string, string>;
  placeholders?: Record<string, string>;
  scopes?: Record<string, { hosts: string[] }>;
}

export interface ProxyUrls {
  proxyUrl?: string;
  socksProxyUrl?: string;
  proxyHost: string;
  proxyHostSource: ProxyHostSource;
  requestedProxyHost?: string;
  autoInterface?: string;
  autoGateway?: string;
}

export interface EnsureProxyOptions {
  sessionKey?: string;
}
