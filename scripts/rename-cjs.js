import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist", "cjs");
if (!fs.existsSync(root)) {
  process.exit(0);
}

function rewriteSourceMap(mapPath, newFile) {
  try {
    const raw = fs.readFileSync(mapPath, "utf8");
    const data = JSON.parse(raw);
    data.file = newFile;
    fs.writeFileSync(mapPath, JSON.stringify(data));
  } catch {
    // best-effort
  }
}

function rewriteRequires(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const updated = raw.replace(
      /require\((['"])(\.\.?(?:\/[^'"]+)*?)\.js\1\)/g,
      "require($1$2.cjs$1)"
    );
    if (updated !== raw) {
      fs.writeFileSync(filePath, updated);
    }
  } catch {
    // best-effort
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      const base = entry.name.slice(0, -3);
      const newName = base + ".cjs";
      const newPath = path.join(dir, newName);
      fs.renameSync(fullPath, newPath);
      rewriteRequires(newPath);

      const mapPath = fullPath + ".map";
      if (fs.existsSync(mapPath)) {
        const newMapPath = newPath + ".map";
        fs.renameSync(mapPath, newMapPath);
        rewriteSourceMap(newMapPath, newName);
      }
    }
  }
}

walk(root);
