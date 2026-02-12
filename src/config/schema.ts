/**
 * Sandbox runtime configuration schema for boxbox.
 */

import { z } from "zod";
import type { SandboxConfig } from "./types.js";

const domainPatternSchema = z.string().refine(
  (val) => {
    if (val.includes("://") || val.includes("/") || val.includes(":")) {
      return false;
    }

    if (val === "localhost") return true;

    if (val.startsWith("*.")) {
      const domain = val.slice(2);
      if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
        return false;
      }
      const parts = domain.split(".");
      return parts.length >= 2 && parts.every((p) => p.length > 0);
    }

    if (val.includes("*")) {
      return false;
    }

    return val.includes(".") && !val.startsWith(".") && !val.endsWith(".");
  },
  {
    message:
      "Invalid domain pattern. Use a valid domain (example.com) or wildcard (*.example.com).",
  }
);

const filesystemPathSchema = z.string().min(1, "Path cannot be empty");
const headerNameSchema = z
  .string()
  .min(1)
  .refine(
    (val) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(val),
    { message: "Invalid header name. Must be a valid HTTP token." }
  );

export const FilesystemConfigSchema = z.object({
  denyRead: z.array(filesystemPathSchema),
  allowWrite: z.array(filesystemPathSchema),
  denyWrite: z.array(filesystemPathSchema),
  allowGitConfig: z.boolean().optional(),
});

export const NetworkConfigSchema = z.object({
  allowedDomains: z.array(domainPatternSchema),
  deniedDomains: z.array(domainPatternSchema),
  proxyHost: z.string().min(1).optional(),
  httpProxyPort: z.number().int().min(1).max(65535).optional(),
  socksProxyPort: z.number().int().min(1).max(65535).optional(),
  mitmProxy: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      domains: z.array(domainPatternSchema).min(1),
    })
    .optional(),
  secretInjection: z
    .object({
      rules: z
        .array(
          z.object({
            domains: z.array(domainPatternSchema).min(1),
            headers: z
              .record(headerNameSchema, z.string().min(1))
              .refine((val) => Object.keys(val).length > 0, {
                message: "Secret injection headers cannot be empty.",
              }),
          })
        )
        .min(1),
    })
    .optional(),
  secrets: z
    .record(
      z.string().min(1),
      z.object({
        hosts: z.array(domainPatternSchema).min(1),
      })
    )
    .optional(),
  secretProtectionMode: z.enum(["off", "best_effort", "strict"]).optional(),
  secretResponseRedaction: z
    .object({
      enabled: z.boolean().optional(),
      maxBodyBytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
    })
    .optional(),
});

export const SecurityConfigSchema = z.object({
  jailerEnabled: z.boolean().optional(),
  seccompEnabled: z.boolean().optional(),
});

export const SandboxConfigSchema = z
  .object({
    allowPty: z.boolean().optional(),
    image: z.string().min(1).optional(),
    security: SecurityConfigSchema.optional(),
    filesystem: FilesystemConfigSchema.optional(),
    network: NetworkConfigSchema.optional(),
  })
  .strict();

export function validateSandboxConfig(config: SandboxConfig) {
  return SandboxConfigSchema.safeParse(config);
}

export function createDefaultSandboxConfig(): SandboxConfig {
  return {};
}
