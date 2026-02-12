/**
 * Map filesystem policy (denyRead / allowWrite / denyWrite) to boxlite volumes.
 * Node-only: uses path.resolve.
 * Note: boxlite volumes only support directories, so file-level rules (like .git/config)
 * cannot be enforced here. allowGitConfig is currently ignored.
 */

import path from "node:path";
import type { SandboxConfig } from "../config/index.js";
import { emitFilesystemPolicyLog } from "../logging/sandbox-log.js";

export interface VolumeSpec {
  hostPath: string;
  guestPath: string;
  readOnly: boolean;
}

function isPathInOrUnderDeny(hostPath: string, denyRead: string[]): boolean {
  const normalized = path.resolve(hostPath);
  return denyRead.some((d) => {
    const resolved = path.resolve(d);
    return normalized === resolved || normalized.startsWith(resolved + path.sep);
  });
}

function isPathInList(hostPath: string, list: string[]): boolean {
  const normalized = path.resolve(hostPath);
  return list.some((p) => path.resolve(p) === normalized);
}

function isPathInOrUnderPath(candidate: string, parent: string): boolean {
  const normalized = path.resolve(candidate);
  const resolvedParent = path.resolve(parent);
  return normalized === resolvedParent || normalized.startsWith(resolvedParent + path.sep);
}

function isPathUnderAny(candidate: string, parents: string[]): boolean {
  return parents.some((parent) => isPathInOrUnderPath(candidate, parent));
}

/**
 * Build volumes array from SandboxConfig and cwd for use with SimpleBox.
 * - denyRead: do not mount any path in or under these.
 * - allowWrite: paths we may mount as writable (default: cwd is writable when no filesystem config).
 * - denyWrite: paths we mount read-only (takes precedence over allowWrite).
 */
export function buildVolumesFromPolicy(
  sandboxConfig: SandboxConfig,
  cwd: string
): VolumeSpec[] {
  const baseCwd = cwd || process.cwd();
  const resolvedCwd = path.resolve(baseCwd);
  const fs = sandboxConfig.filesystem;
  const denyRead = fs?.denyRead ?? [];
  const allowWrite = fs?.allowWrite ?? [];
  const denyWrite = fs?.denyWrite ?? [];
  const hasFsConfig = !!fs;

  const volumes: VolumeSpec[] = [];
  const notes: string[] = [];

  // Resolve deny/allow lists to absolute for comparison
  const denyReadResolved = denyRead.map((p) => path.resolve(p));
  const allowWriteResolved = allowWrite.map((p) => path.resolve(p));
  const denyWriteResolved = denyWrite.map((p) => path.resolve(p));

  if (!hasFsConfig) {
    notes.push("filesystem: default (cwd writable)");
  } else {
    notes.push(
      `filesystem: configured (denyRead=${denyReadResolved.length} allowWrite=${allowWriteResolved.length} denyWrite=${denyWriteResolved.length})`
    );
  }

  // Workspace volume (cwd): skip if cwd is in/under denyRead
  if (!isPathInOrUnderDeny(resolvedCwd, denyReadResolved)) {
    const cwdAllowedByAllowWrite = isPathUnderAny(resolvedCwd, allowWriteResolved);
    const cwdDeniedByDenyWrite = isPathUnderAny(resolvedCwd, denyWriteResolved);
    const cwdWritable = !hasFsConfig || (cwdAllowedByAllowWrite && !cwdDeniedByDenyWrite);
    if (hasFsConfig && cwdAllowedByAllowWrite && !isPathInList(resolvedCwd, allowWriteResolved)) {
      notes.push(`cwd:${resolvedCwd} writable via allowWrite parent`);
    }
    if (hasFsConfig && cwdDeniedByDenyWrite && !isPathInList(resolvedCwd, denyWriteResolved)) {
      notes.push(`cwd:${resolvedCwd} read-only via denyWrite parent`);
    }
    volumes.push({
      hostPath: resolvedCwd,
      guestPath: resolvedCwd,
      readOnly: !cwdWritable,
    });
    notes.push(
      `cwd:${resolvedCwd} mounted ${cwdWritable ? "read-write" : "read-only"}`
    );
  } else {
    notes.push(`cwd:${resolvedCwd} skipped (denyRead)`);
  }

  // Extra paths from allowWrite (not already added as workspace)
  for (const p of allowWriteResolved) {
    if (isPathInOrUnderDeny(p, denyReadResolved)) {
      notes.push(`allowWrite:${p} skipped (denyRead)`);
      continue;
    }
    if (p === resolvedCwd) {
      notes.push(`allowWrite:${p} already mounted as cwd`);
      continue; // already added
    }
    const readOnly = isPathInList(p, denyWriteResolved);
    volumes.push({
      hostPath: p,
      guestPath: p,
      readOnly,
    });
    notes.push(
      `allowWrite:${p} mounted ${readOnly ? "read-only (denyWrite)" : "read-write"}`
    );
  }

  const mountedPaths = volumes.map((v) => v.hostPath);
  for (const p of denyWriteResolved) {
    if (isPathInOrUnderDeny(p, denyReadResolved)) {
      notes.push(`denyWrite:${p} skipped (denyRead)`);
      continue;
    }
    if (mountedPaths.some((mounted) => path.resolve(mounted) === path.resolve(p))) {
      continue;
    }
    if (!isPathUnderAny(p, mountedPaths)) {
      notes.push(`denyWrite:${p} skipped (not mounted)`);
      continue;
    }
    volumes.push({
      hostPath: p,
      guestPath: p,
      readOnly: true,
    });
    notes.push(`denyWrite:${p} mounted read-only`);
  }

  emitFilesystemPolicyLog({
    timestamp: new Date().toISOString(),
    cwd: resolvedCwd,
    volumes: volumes.map((v) => ({
      hostPath: v.hostPath,
      guestPath: v.guestPath,
      readOnly: v.readOnly,
    })),
    notes,
  });

  return volumes;
}
