import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(agentRoot, "../..");
const agentDist = join(agentRoot, "dist");
const scannerRoot = join(repoRoot, "packages/scanner");
const scannerDist = join(scannerRoot, "dist");
const outputParent = join(agentDist, "standalone");
const bundleName = `change-detective-agent-${process.platform}-${process.arch}`;
const outputDirectory = join(outputParent, bundleName);

if (!existsSync(join(agentDist, "index.js"))) {
  throw new Error("Agent build output is missing; run the standalone package script again.");
}
if (!existsSync(join(scannerDist, "index.js"))) {
  throw new Error("Scanner build output is missing; run the standalone package script again.");
}
if (!existsSync(process.execPath)) {
  throw new Error(`Could not find the Node runtime at ${process.execPath}.`);
}

mkdirSync(outputParent, { recursive: true });
const stagingDirectory = mkdtempSync(join(outputParent, ".bundle-"));

try {
  const scannerPackageDirectory = join(stagingDirectory, "packages/scanner");
  const appDirectory = join(stagingDirectory, "app");
  const runtimeDirectory = join(stagingDirectory, "runtime");
  mkdirSync(scannerPackageDirectory, { recursive: true });
  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(runtimeDirectory, { recursive: true });

  copyFileSync(join(scannerRoot, "package.json"), join(scannerPackageDirectory, "package.json"));
  cpSync(scannerDist, join(scannerPackageDirectory, "dist"), { recursive: true });
  for (const entry of readdirSync(agentDist)) {
    if (entry === "standalone") continue;
    cpSync(join(agentDist, entry), join(appDirectory, entry), {
      recursive: true,
    });
  }
  writeFileSync(
    join(stagingDirectory, "package.json"),
    JSON.stringify(
      {
        name: "change-detective-agent-bundle",
        private: true,
        type: "module",
        dependencies: {
          "@change-detective/scanner": "file:./packages/scanner",
          "better-sqlite3": JSON.parse(
            readFileSync(join(agentRoot, "package.json"), "utf8")
          ).dependencies["better-sqlite3"],
          zod: JSON.parse(readFileSync(join(agentRoot, "package.json"), "utf8")).dependencies.zod,
        },
      },
      null,
      2
    ) + "\n"
  );

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const install = spawnSync(
    npm,
    ["install", "--omit=dev", "--no-audit", "--no-fund"],
    {
      cwd: stagingDirectory,
      stdio: "inherit",
      shell: process.platform === "win32",
    }
  );
  if (install.error) throw install.error;
  if (install.status !== 0) {
    throw new Error(`Production dependency installation failed (exit ${install.status}).`);
  }

  const runtimeName = process.platform === "win32" ? "node.exe" : "node";
  const bundledRuntime = join(runtimeDirectory, runtimeName);
  copyFileSync(process.execPath, bundledRuntime);
  if (process.platform !== "win32") chmodSync(bundledRuntime, 0o755);

  if (process.platform === "win32") {
    writeFileSync(
      join(stagingDirectory, "Start-ChangeDetective.cmd"),
      `@echo off\r\n` +
        `setlocal\r\n` +
        `if not exist "%APPDATA%\\change-detective\\agent.json" (\r\n` +
        `  set /p "CD_API_URL=Dashboard HTTPS origin: "\r\n` +
        `  set /p "CD_MONITORED_ROOT=Absolute folder to monitor: "\r\n` +
        `)\r\n` +
        `"%~dp0runtime\\node.exe" "%~dp0app\\index.js"\r\n` +
        `exit /b %ERRORLEVEL%\r\n`
    );
  } else {
    writeFileSync(
      join(stagingDirectory, "start-agent.sh"),
      `#!/usr/bin/env bash\n` +
        `set -euo pipefail\n` +
        `bundle_dir="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"\n` +
        `config_file="\${XDG_CONFIG_HOME:-$HOME/.config}/change-detective/agent.json"\n` +
        `if [[ ! -f "$config_file" ]]; then\n` +
        `  read -r -p "Dashboard HTTPS origin: " CD_API_URL\n` +
        `  read -r -p "Absolute folder to monitor: " CD_MONITORED_ROOT\n` +
        `  export CD_API_URL CD_MONITORED_ROOT\n` +
        `fi\n` +
        `exec "$bundle_dir/runtime/node" "$bundle_dir/app/index.js"\n`
    );
    chmodSync(join(stagingDirectory, "start-agent.sh"), 0o755);
  }

  const resolvedOutput = resolve(outputDirectory);
  if (dirname(resolvedOutput) !== resolve(outputParent)) {
    throw new Error("Refusing to replace an output directory outside the standalone bundle folder.");
  }
  rmSync(outputDirectory, { recursive: true, force: true });
  cpSync(stagingDirectory, outputDirectory, { recursive: true });
  console.log(`Created self-contained agent bundle: ${outputDirectory}`);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
