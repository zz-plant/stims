#!/usr/bin/env node
/* eslint-env node */
/* global process, console */

import { execSync } from "node:child_process";

const userAgent = process.env.npm_config_user_agent ?? "";
const isBunUserAgent = userAgent.startsWith("bun");
const isCloudflarePages = (() => {
  const value = process.env.CF_PAGES?.toLowerCase?.();
  return value === "1" || value === "true";
})();

const run = (command) => {
  execSync(command, { stdio: "inherit" });
};

const hasBun = (() => {
  if (isBunUserAgent) return true;
  try {
    execSync("bun --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const buildRunner = hasBun ? "bun" : "npm";

if (isCloudflarePages) {
  console.log(
    `[postinstall] Cloudflare Pages detected; running "${buildRunner} run build" to produce dist/.`,
  );
  run(`${buildRunner} run build`);
} else {
  console.log("[postinstall] CF_PAGES not set; skipping build.");
}

if (isBunUserAgent) {
  run("husky install");
} else {
  console.log("[postinstall] Husky install skipped (Bun not detected as installer).");
}
