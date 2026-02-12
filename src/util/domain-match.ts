/**
 * Domain pattern matching (aligned with sandbox-runtime).
 * *.example.com matches subdomains only (e.g. api.example.com), not example.com.
 */

export function matchesDomainPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const baseDomain = pattern.substring(2);
    return hostname.toLowerCase().endsWith("." + baseDomain.toLowerCase());
  }
  return hostname.toLowerCase() === pattern.toLowerCase();
}
