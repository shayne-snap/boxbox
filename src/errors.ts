export type BoxboxErrorCode =
  | "invalid_config"
  | "pty_not_allowed"
  | "secret_protection_unavailable"
  | "sandbox_unavailable"
  | "sandbox_exec_failed";

export class BoxboxError extends Error {
  code: BoxboxErrorCode;

  constructor(code: BoxboxErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BoxboxError";
  }
}
