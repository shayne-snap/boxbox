import type { SecretProtectionMode, SandboxConfig } from "../config/index.js";
import type { BoxboxErrorCode } from "../errors.js";

export interface ExecuteOptions {
  scopeId: string;
  sessionId: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Secrets for proxy-side header injection (not passed to the sandbox env). */
  secrets?: Record<string, string>;
  /** Request a pseudo-terminal (pty/tty) for the command (default: false). */
  tty?: boolean;
  /** Max bytes to collect per stream (stdout/stderr). When set, output may be truncated. */
  maxOutputBytes?: number;
  sandboxConfig: SandboxConfig;
}

export interface ApprovalRequest {
  command: string;
  args: string[];
  reason: string;
}

export type ExecuteOutcome = "boxlite" | "unavailable" | "reject";

export interface ExecuteResult {
  outcome: ExecuteOutcome;
  result?: {
    exitCode: number;
    stdout: string;
    stderr: string;
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
  };
  approvalRequest?: ApprovalRequest;
  error?: string;
  errorCode?: BoxboxErrorCode;
  diagnostics?: ExecuteDiagnostics;
}

export interface ProxyConnectivityCheck {
  scope: "host";
  status: "ok" | "error" | "skipped";
  target?: string;
  latencyMs?: number;
  error?: string;
}

export interface ExecuteDiagnostics {
  image: string;
  httpProxy?: string;
  socksProxy?: string;
  proxyHost?: string;
  proxyHostSource?: "config" | "auto" | "default";
  requestedProxyHost?: string;
  autoInterface?: string;
  autoGateway?: string;
  proxyConnectivity?: ProxyConnectivityCheck;
  secretInjectionRules?: Array<{ domains: string[]; headers: string[] }>;
  secretProtectionMode?: SecretProtectionMode;
  secretProtectionStatus?: "off" | "best_effort" | "strict_enforced" | "strict_unavailable";
  secretProtectionReason?: string;
}
