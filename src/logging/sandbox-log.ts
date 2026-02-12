export interface SandboxLogContext {
  scopeId?: string;
  sessionId?: string;
}

export interface NetworkLogEvent extends SandboxLogContext {
  timestamp: string;
  decision: "allow" | "deny";
  host: string;
  port: number;
  method: string;
  url: string;
  rule: string;
}

export interface FilesystemPolicyLogEvent extends SandboxLogContext {
  timestamp: string;
  cwd: string;
  volumes: Array<{ hostPath: string; guestPath: string; readOnly: boolean }>;
  notes: string[];
}

export interface SecretInjectionLogEvent extends SandboxLogContext {
  timestamp: string;
  host: string;
  headersInjected: string[];
  secretNames: string[];
  direction?: "request" | "response";
  action?: "inject" | "placeholder_replace" | "redact";
  redacted?: boolean;
  carrier?: "headers" | "body" | "headers+body";
}

type NetworkLogListener = (event: NetworkLogEvent) => void;
type FilesystemLogListener = (event: FilesystemPolicyLogEvent) => void;
type SecretInjectionLogListener = (event: SecretInjectionLogEvent) => void;

const networkListeners = new Set<NetworkLogListener>();
const filesystemListeners = new Set<FilesystemLogListener>();
const secretInjectionListeners = new Set<SecretInjectionLogListener>();

let currentContext: SandboxLogContext = {};

export function setSandboxLogContext(context: SandboxLogContext): void {
  currentContext = { ...context };
}

export function getSandboxLogContext(): SandboxLogContext {
  return currentContext;
}

export function subscribeNetworkLog(listener: NetworkLogListener): () => void {
  networkListeners.add(listener);
  return () => {
    networkListeners.delete(listener);
  };
}

export function subscribeFilesystemPolicyLog(listener: FilesystemLogListener): () => void {
  filesystemListeners.add(listener);
  return () => {
    filesystemListeners.delete(listener);
  };
}

export function subscribeSecretInjectionLog(
  listener: SecretInjectionLogListener
): () => void {
  secretInjectionListeners.add(listener);
  return () => {
    secretInjectionListeners.delete(listener);
  };
}

export function emitNetworkLog(
  event: Omit<NetworkLogEvent, "scopeId" | "sessionId"> & Partial<SandboxLogContext>
): void {
  const context = currentContext;
  const payload: NetworkLogEvent = {
    ...event,
    scopeId: event.scopeId ?? context.scopeId,
    sessionId: event.sessionId ?? context.sessionId,
  };
  networkListeners.forEach((listener) => listener(payload));
}

export function emitFilesystemPolicyLog(
  event: Omit<FilesystemPolicyLogEvent, "scopeId" | "sessionId"> &
    Partial<SandboxLogContext>
): void {
  const context = currentContext;
  const payload: FilesystemPolicyLogEvent = {
    ...event,
    scopeId: event.scopeId ?? context.scopeId,
    sessionId: event.sessionId ?? context.sessionId,
  };
  filesystemListeners.forEach((listener) => listener(payload));
}

export function emitSecretInjectionLog(
  event: Omit<SecretInjectionLogEvent, "scopeId" | "sessionId"> &
    Partial<SandboxLogContext>
): void {
  const context = currentContext;
  const payload: SecretInjectionLogEvent = {
    ...event,
    scopeId: event.scopeId ?? context.scopeId,
    sessionId: event.sessionId ?? context.sessionId,
  };
  secretInjectionListeners.forEach((listener) => listener(payload));
}
