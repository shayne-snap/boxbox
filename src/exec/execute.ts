/**
 * execute(): run command in boxlite only (no host policy).
 */

import {
  DEFAULT_SANDBOX_IMAGE,
  validateSandboxConfig,
} from "../config/index.js";
import { ensureProxyRunning } from "../network-proxy/index.js";
import { setSandboxLogContext } from "../logging/sandbox-log.js";
import * as session from "../runtime/session.js";
import { buildVolumesFromPolicy } from "../fs/volumes.js";
import { buildProxyEnv } from "./env.js";
import { checkProxyConnectivity } from "./connectivity.js";
import {
  buildSecretPlaceholderData,
  getSecretProtectionMode,
  validateStrictSecretProtection,
} from "./secrets.js";
import { execInBox } from "./stream.js";
import type { ExecuteDiagnostics, ExecuteOptions, ExecuteResult } from "./types.js";

export async function execute(options: ExecuteOptions): Promise<ExecuteResult> {
  const { scopeId, sessionId, command, args, cwd, env, secrets, tty, maxOutputBytes, sandboxConfig } = options;
  const commandLine = command + (args.length ? " " + args.join(" ") : "");
  const ttyRequested = tty === true;
  const resolvedImage = sandboxConfig.image ?? DEFAULT_SANDBOX_IMAGE;
  const diagnostics: ExecuteDiagnostics = { image: resolvedImage };
  if (sandboxConfig.network?.secretInjection?.rules?.length) {
    diagnostics.secretInjectionRules = sandboxConfig.network.secretInjection.rules.map((rule) => ({
      domains: [...rule.domains],
      headers: Object.keys(rule.headers),
    }));
  }

  const networkConfig = sandboxConfig.network;
  if (networkConfig) {
    diagnostics.secretProtectionMode = getSecretProtectionMode(networkConfig);
    diagnostics.secretProtectionStatus =
      diagnostics.secretProtectionMode === "strict"
        ? "strict_enforced"
        : diagnostics.secretProtectionMode === "off"
          ? "off"
          : "best_effort";
  }

  setSandboxLogContext({ scopeId, sessionId });

  const validation = validateSandboxConfig(sandboxConfig);
  if (!validation.success) {
    return {
      outcome: "reject",
      approvalRequest: { command: commandLine, args, reason: "invalid_config" },
      error: validation.error.message,
      errorCode: "invalid_config",
      diagnostics,
    };
  }

  if (ttyRequested && !sandboxConfig.allowPty) {
    return {
      outcome: "reject",
      approvalRequest: { command: commandLine, args, reason: "pty_not_allowed" },
      errorCode: "pty_not_allowed",
      diagnostics,
    };
  }

  if (networkConfig) {
    const strictCheck = validateStrictSecretProtection(networkConfig);
    if (!strictCheck.ok) {
      diagnostics.secretProtectionStatus = "strict_unavailable";
      diagnostics.secretProtectionReason = strictCheck.reason;
      return {
        outcome: "reject",
        approvalRequest: {
          command: commandLine,
          args,
          reason: "secret_protection_unavailable",
        },
        error: strictCheck.reason,
        errorCode: "secret_protection_unavailable",
        diagnostics,
      };
    }
  }

  try {
    const effectiveCwd = cwd ?? process.cwd();
    const volumes = buildVolumesFromPolicy(sandboxConfig, effectiveCwd);

    let mergedEnv = env;
    if (networkConfig) {
      const secretData = buildSecretPlaceholderData(
        networkConfig,
        secrets,
        sessionId
      );
      const proxyResult = await ensureProxyRunning(
        () => networkConfig,
        () => secretData.proxySecrets,
        { sessionKey: `${scopeId}:${sessionId}` }
      );
      if (proxyResult) {
        diagnostics.httpProxy = proxyResult.proxyUrl;
        diagnostics.socksProxy = proxyResult.socksProxyUrl;
        diagnostics.proxyHost = proxyResult.proxyHost;
        diagnostics.proxyHostSource = proxyResult.proxyHostSource;
        diagnostics.requestedProxyHost = proxyResult.requestedProxyHost;
        diagnostics.autoInterface = proxyResult.autoInterface;
        diagnostics.autoGateway = proxyResult.autoGateway;
        diagnostics.proxyConnectivity = await checkProxyConnectivity(
          proxyResult.proxyUrl ?? proxyResult.socksProxyUrl
        );
        mergedEnv = {
          ...buildProxyEnv(proxyResult.proxyUrl, proxyResult.socksProxyUrl),
          ...env,
        };
      }
      if (secretData.envPlaceholders) {
        mergedEnv = {
          ...mergedEnv,
          ...secretData.envPlaceholders,
        };
      }
    }

    const entry = await session.getOrCreate(scopeId, sessionId, {
      workingDir: effectiveCwd,
      env: mergedEnv,
      image: resolvedImage,
      volumes: volumes.length > 0 ? volumes.map((v) => ({ hostPath: v.hostPath, guestPath: v.guestPath, readOnly: v.readOnly })) : undefined,
      security: sandboxConfig.security,
    });
    if (!entry) {
      const reason = "sandbox_unavailable";
      const runtimeError = session.getBoxliteRuntimeError?.();
      const error = runtimeError ? `Sandbox unavailable: ${runtimeError}` : "Sandbox unavailable";
      return {
        outcome: "unavailable",
        approvalRequest: { command: commandLine, args, reason },
        error,
        errorCode: "sandbox_unavailable",
        diagnostics,
      };
    }
    const result = await execInBox(entry.box, command, args, mergedEnv, ttyRequested, maxOutputBytes);
    return { outcome: "boxlite", result, diagnostics };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[boxbox.execute] sandbox execution failed", {
      scopeId,
      sessionId,
      command: commandLine,
      error,
      stack: err instanceof Error ? err.stack : undefined,
    });
    const reason = error || "sandbox_exec_failed";
    return {
      outcome: "unavailable",
      approvalRequest: { command: commandLine, args, reason },
      error,
      errorCode: "sandbox_exec_failed",
      diagnostics,
    };
  }
}
