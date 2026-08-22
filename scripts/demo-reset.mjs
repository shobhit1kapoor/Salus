import { spawnSync } from "node:child_process";

console.log("Preparing the canonical synthetic Salus reviewer workspace.");
console.log("This operation is idempotent and does not delete user-created profiles.");

const result = spawnSync("docker", ["compose", "exec", "-T", "api", "npm", "run", "seed", "-w", "@salus/api"], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.error) {
  console.error(`Demo preparation failed: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
