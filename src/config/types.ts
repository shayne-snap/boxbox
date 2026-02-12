import type { z } from "zod";

export const DEFAULT_SANDBOX_IMAGE = "python:slim";

/** Filesystem restriction config (aligned with sandbox-runtime). */
export interface FilesystemConfig {
  /** Paths denied for reading. */
  denyRead: string[];
  /** Paths allowed for writing. */
  allowWrite: string[];
  /** Paths denied for writing (takes precedence over allowWrite). */
  denyWrite: string[];
  /** Allow writes to .git/config (default: false). */
  allowGitConfig?: boolean;
}

/** Network restriction config (aligned with sandbox-runtime). */
export interface NetworkConfig {
  /** Domains allowed for outbound connections (e.g. ["github.com", "*.npmjs.org"]). Empty = block all when network is set. */
  allowedDomains: string[];
  /** Domains denied (checked first, takes precedence over allowedDomains). */
  deniedDomains: string[];
  /**
   * Host address used by sandboxed processes to reach host-side proxy.
   * Use "auto" to resolve from the host default route interface at runtime.
   * Default when omitted: 192.168.127.1.
   */
  proxyHost?: string;
  /** Use external HTTP proxy on host at this port instead of built-in; proxy must enforce allow/deny. */
  httpProxyPort?: number;
  /** Use external SOCKS proxy on host at this port; proxy must enforce allow/deny. */
  socksProxyPort?: number;
  /** Optional MITM proxy routing for specific domains (TCP host/port). */
  mitmProxy?: MitmProxyConfig;
  /** Optional secret injection rules for outbound HTTP requests. */
  secretInjection?: SecretInjectionConfig;
  /** Optional secret host scopes for placeholder-based injection. */
  secrets?: Record<string, SecretScope>;
  /**
   * Secret protection behavior:
   * - off: no response redaction.
   * - best_effort: redact secret values in proxied HTTP response headers/bodies when possible.
   * - strict: require redaction prerequisites at startup, otherwise reject execution.
   */
  secretProtectionMode?: SecretProtectionMode;
  /** Optional tuning for response redaction in proxy responses. */
  secretResponseRedaction?: SecretResponseRedactionConfig;
}

/** Security options forwarded to boxlite when supported by the SDK. */
export interface SecurityConfig {
  /** Enable jailer isolation (Linux/macOS). */
  jailerEnabled?: boolean;
  /** Enable seccomp syscall filtering (Linux only). */
  seccompEnabled?: boolean;
}

export interface MitmProxyConfig {
  /** MITM proxy host (e.g. "127.0.0.1"). */
  host: string;
  /** MITM proxy port. */
  port: number;
  /** Domains routed through the MITM proxy. */
  domains: string[];
}

export interface SecretInjectionRule {
  /** Domains for which secret headers are injected. */
  domains: string[];
  /** Map of header name -> secret name. */
  headers: Record<string, string>;
}

export interface SecretInjectionConfig {
  /** List of secret injection rules. */
  rules: SecretInjectionRule[];
}

export interface SecretScope {
  /** Hosts allowed to receive this secret. */
  hosts: string[];
}

export type SecretProtectionMode = "off" | "best_effort" | "strict";

export interface SecretResponseRedactionConfig {
  /** Enable response redaction for this network policy (default depends on secretProtectionMode). */
  enabled?: boolean;
  /** Max buffered response body size for redaction in bytes. */
  maxBodyBytes?: number;
}

export interface SandboxConfig {
  /** Allow pseudo-terminal (pty/tty) execution inside boxlite (default: false). */
  allowPty?: boolean;
  /** OCI image used for the boxlite container. */
  image?: string;
  /** Security options (forwarded to boxlite SDK when supported). */
  security?: SecurityConfig;
  /** Filesystem restrictions: denyRead, allowWrite, denyWrite. Enforced via boxlite volumes when present. */
  filesystem?: FilesystemConfig;
  /** Network restrictions: allowedDomains, deniedDomains. Enforced via proxy + env when present. */
  network?: NetworkConfig;
}

// Re-export zod type helper for schema module typing without runtime dependency.
export type ZodSchema = z.ZodTypeAny;
