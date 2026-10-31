// Builds dist/ (ES modules, for `import`) and dist/cjs/ (CommonJS, for `require`).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const cjsDir = join(distDir, "cjs");
const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function tsc(args) {
  const run = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json", ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

rmSync(distDir, { recursive: true, force: true });
tsc([]);
tsc(["--module", "commonjs", "--moduleResolution", "node10", "--outDir", cjsDir]);
// package.json says "type": "module"; this marks dist/cjs as CommonJS.
writeFileSync(join(cjsDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

for (const dir of [distDir, cjsDir]) {
  readFileSync(join(dir, "index.js"));
  readFileSync(join(dir, "index.d.ts"));
}
console.log("sendaro built: dist (ESM) and dist/cjs (CommonJS)");
