/**
 * Session-scoped Boxlite lifecycle (getOrCreate, stop).
 */

import { DEFAULT_SANDBOX_IMAGE } from "../config/index.js";

export interface BoxLike {
  exec(
    command: string,
    args?: string[] | null,
    env?: Array<[string, string]> | Array<Array<string>> | null,
    tty?: boolean | null
  ): Promise<any>;
  stop(): Promise<void>;
}

export interface SessionBoxOptions {
  workingDir?: string;
  env?: Record<string, string>;
  image?: string;
  volumes?: Array<{ hostPath: string; guestPath: string; readOnly?: boolean }>;
  security?: { jailerEnabled?: boolean; seccompEnabled?: boolean };
}

type SimpleBoxConstructor = new (opts: {
  image?: string;
  env?: Record<string, string>;
  workingDir?: string;
  volumes?: Array<{ hostPath: string; guestPath: string; readOnly?: boolean }>;
}) => any;

type BoxliteRuntime = {
  create(options: Record<string, unknown>, name?: string | null): Promise<BoxLike>;
};

let SimpleBoxClass: SimpleBoxConstructor | null = null;
let loadPromise: Promise<SimpleBoxConstructor | null> | null = null;

let runtime: BoxliteRuntime | null = null;
let runtimePromise: Promise<BoxliteRuntime | null> | null = null;
let lastRuntimeError: string | undefined;

export async function loadBoxlite(): Promise<SimpleBoxConstructor | null> {
  if (SimpleBoxClass != null) return SimpleBoxClass;
  if (loadPromise != null) return loadPromise;
  loadPromise = (async () => {
    try {
      const m = await import("@boxlite-ai/boxlite");
      const Ctor = (m as { SimpleBox?: SimpleBoxConstructor }).SimpleBox ?? null;
      SimpleBoxClass = Ctor;
      return Ctor;
    } catch {
      return null;
    }
  })();
  return loadPromise;
}

async function loadBoxliteRuntime(): Promise<BoxliteRuntime | null> {
  if (runtime != null) return runtime;
  if (runtimePromise != null) return runtimePromise;
  runtimePromise = (async () => {
    try {
      const m = await import("@boxlite-ai/boxlite");
      const JsBoxlite = (m as { JsBoxlite?: { withDefaultConfig?: () => BoxliteRuntime } }).JsBoxlite;
      if (!JsBoxlite?.withDefaultConfig) {
        lastRuntimeError = "boxlite runtime unavailable (JsBoxlite.withDefaultConfig missing)";
        return null;
      }
      runtime = JsBoxlite.withDefaultConfig();
      lastRuntimeError = undefined;
      return runtime;
    } catch (error) {
      lastRuntimeError = error instanceof Error ? error.message : String(error);
      return null;
    }
  })();
  return runtimePromise;
}

const sessionCache = new Map<string, Map<string, { box: BoxLike }>>();

/**
 * scopeId: e.g. agentId. sessionId: e.g. ACP session id.
 */
export function getOrCreate(
  scopeId: string,
  sessionId: string,
  options: SessionBoxOptions
): Promise<{ box: BoxLike } | null> {
  return (async () => {
    const boxliteRuntime = await loadBoxliteRuntime();
    if (!boxliteRuntime) {
      if (!lastRuntimeError) {
        lastRuntimeError = "boxlite runtime unavailable";
      }
      return null;
    }

    let scopeMap = sessionCache.get(scopeId);
    if (!scopeMap) {
      scopeMap = new Map();
      sessionCache.set(scopeId, scopeMap);
    }

    let entry = scopeMap.get(sessionId);
    if (!entry) {
      const box = await boxliteRuntime.create(
        {
          image: options.image ?? DEFAULT_SANDBOX_IMAGE,
          workingDir: options.workingDir ?? "/",
          env: options.env
            ? Object.entries(options.env).map(([key, value]) => ({ key, value }))
            : undefined,
          volumes: options.volumes?.map((v) => ({
            hostPath: v.hostPath,
            guestPath: v.guestPath,
            readOnly: v.readOnly ?? false,
          })),
          security: options.security
            ? {
                jailerEnabled: options.security.jailerEnabled,
                seccompEnabled: options.security.seccompEnabled,
              }
            : undefined,
          autoRemove: true,
          detach: false,
        },
        undefined
      );
      entry = { box };
      scopeMap.set(sessionId, entry);
    }
    return entry ?? null;
  })();
}

export function getBoxliteRuntimeError(): string | undefined {
  return lastRuntimeError;
}

export function stopSession(scopeId: string, sessionId?: string): void {
  const scopeMap = sessionCache.get(scopeId);
  if (!scopeMap) return;
  if (sessionId) {
    const entry = scopeMap.get(sessionId);
    if (entry) {
      entry.box.stop().catch(() => {});
      scopeMap.delete(sessionId);
    }
  } else {
    for (const { box } of scopeMap.values()) {
      box.stop().catch(() => {});
    }
    sessionCache.delete(scopeId);
  }
}

/** Session manager: delegates to getOrCreate/stopSession. */
export const SessionManager = {
  loadBoxlite,
  getOrCreate,
  stopSession,
};
