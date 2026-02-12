import { HEADER_NAME_REGEX } from "./constants.js";

export function isValidHeaderName(value: string): boolean {
  return HEADER_NAME_REGEX.test(value);
}

export function isValidHeaderValue(value: string): boolean {
  return !/[\r\n]/.test(value);
}

export function stripUndefinedHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[]> {
  const sanitized: Record<string, string | string[]> = {};
  for (const [headerName, value] of Object.entries(headers)) {
    if (typeof value !== "undefined") {
      sanitized[headerName] = value;
    }
  }
  return sanitized;
}

export function dropConflictingLengthHeaders(
  headers: Record<string, string | string[]>
): Record<string, string | string[]> {
  const hasContentLength = "content-length" in headers || "Content-Length" in headers;
  const hasTransferEncoding = "transfer-encoding" in headers || "Transfer-Encoding" in headers;
  if (!hasContentLength || !hasTransferEncoding) return headers;
  const sanitized = { ...headers };
  delete sanitized["transfer-encoding"];
  delete sanitized["Transfer-Encoding"];
  return sanitized;
}
