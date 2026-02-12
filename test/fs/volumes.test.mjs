/**
 * Unit tests for buildVolumesFromPolicy.
 * Run: pnpm run build && pnpm test
 */
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVolumesFromPolicy } from "../../dist/esm/fs/volumes.js";
import { createDefaultSandboxConfig } from "../../dist/esm/config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testCwd = path.resolve(__dirname, "fixtures-workspace");

// No filesystem config => one volume for cwd, writable
{
  const config = createDefaultSandboxConfig();
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 1, "default config: one volume");
  assert.equal(volumes[0].hostPath, testCwd);
  assert.equal(volumes[0].guestPath, testCwd);
  assert.equal(volumes[0].readOnly, false, "cwd writable when no fs config");
}

// filesystem with empty arrays => allow-only semantics, cwd not in allowWrite so readOnly
{
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [], denyWrite: [] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 1);
  assert.equal(volumes[0].readOnly, true, "cwd readOnly when allowWrite list is empty");
}

// cwd in denyRead => no cwd volume
{
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [testCwd], allowWrite: [], denyWrite: [] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 0, "no volume when cwd in denyRead");
}

// cwd in allowWrite => writable
{
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [testCwd], denyWrite: [] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 1);
  assert.equal(volumes[0].readOnly, false);
}

// cwd under allowWrite parent => writable
{
  const parentPath = path.dirname(testCwd);
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [parentPath], denyWrite: [] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 2);
  assert.equal(volumes[0].hostPath, testCwd);
  assert.equal(volumes[0].readOnly, false);
}

// cwd in allowWrite and denyWrite => readOnly (deny takes precedence)
{
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [testCwd], denyWrite: [testCwd] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 1);
  assert.equal(volumes[0].readOnly, true);
}

// cwd under denyWrite parent => readOnly (deny parent takes precedence)
{
  const parentPath = path.dirname(testCwd);
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [parentPath], denyWrite: [parentPath] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes[0].hostPath, testCwd);
  assert.equal(volumes[0].readOnly, true);
}

// extra allowWrite path => second volume
{
  const otherPath = path.resolve(testCwd, "other");
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [testCwd, otherPath], denyWrite: [] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 2);
  assert.equal(volumes[0].hostPath, testCwd);
  assert.equal(volumes[1].hostPath, otherPath);
  assert.equal(volumes[1].readOnly, false);
}

// extra allowWrite path in denyWrite => second volume readOnly
{
  const otherPath = path.resolve(testCwd, "other");
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [testCwd, otherPath], denyWrite: [otherPath] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 2);
  assert.equal(volumes[1].readOnly, true);
}

// denyWrite subpath should be mounted readOnly when parent is writable
{
  const denySubpath = path.resolve(testCwd, "secrets");
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [testCwd], denyWrite: [denySubpath] };
  const volumes = buildVolumesFromPolicy(config, testCwd);
  assert.equal(volumes.length, 2);
  const subpathVolume = volumes.find((volume) => volume.hostPath === denySubpath);
  assert.ok(subpathVolume, "denyWrite subpath mounted");
  assert.equal(subpathVolume.readOnly, true, "denyWrite subpath is readOnly");
}

// allowGitConfig is ignored (boxlite volumes only support directories)
{
  const cwdWithGit = path.resolve(__dirname, "fixtures-allowGitConfig");
  const config = createDefaultSandboxConfig();
  config.filesystem = { denyRead: [], allowWrite: [cwdWithGit], denyWrite: [], allowGitConfig: true };
  const volumes = buildVolumesFromPolicy(config, cwdWithGit);
  assert.equal(volumes.length, 1, "no extra volume for .git/config");
}
