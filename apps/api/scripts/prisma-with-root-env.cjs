const { spawnSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");

const rootEnvPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: rootEnvPath });

if (!process.env.DATABASE_URL) {
  console.error(`DATABASE_URL is not set. Add it to ${rootEnvPath} or export it.`);
  process.exit(1);
}

const result = spawnSync("prisma", process.argv.slice(2), {
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("Could not start Prisma CLI:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
