#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const STAGING_API_BASE_URL =
  "https://driytnlagwgzebnfdpcr.supabase.co/functions/v1";
const STAGING_ENV_FILENAME = ".env.staging.local";
const REQUIRED_VARIABLES = [
  "EXPO_PUBLIC_WINGR_API_BASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
];
const PLACEHOLDER_VALUES = new Set([
  "PASTE_STAGING_SUPABASE_PUBLISHABLE_KEY_HERE",
  "PASTE_STAGING_REVENUECAT_IOS_PUBLIC_SDK_KEY_HERE",
  "sb_publishable_replace_me",
]);

function parseEnvFile(contents, filePath) {
  const values = {};

  for (const [index, rawLine] of contents.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      throw new Error(
        `Invalid environment entry in ${filePath}:${index + 1}. Use KEY=value.`,
      );
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }

  return values;
}

function resolveStagingEnvironment({
  cwd = process.cwd(),
  inheritedEnv = process.env,
  stagingEnvPath = path.join(cwd, STAGING_ENV_FILENAME),
} = {}) {
  if (!fs.existsSync(stagingEnvPath)) {
    throw new Error(
      `Missing ${path.basename(stagingEnvPath)}. Copy .env.staging.example to ${path.basename(stagingEnvPath)} and add the staging Supabase publishable key.`,
    );
  }

  const localValues = parseEnvFile(
    fs.readFileSync(stagingEnvPath, "utf8"),
    stagingEnvPath,
  );

  for (const variable of REQUIRED_VARIABLES) {
    const value = localValues[variable]?.trim();
    if (!value || PLACEHOLDER_VALUES.has(value)) {
      throw new Error(
        `${variable} must be set to a real staging value in ${path.basename(stagingEnvPath)}.`,
      );
    }
  }

  if (
    localValues.EXPO_PUBLIC_WINGR_API_BASE_URL.trim().replace(/\/$/, "") !==
    STAGING_API_BASE_URL
  ) {
    throw new Error(
      `EXPO_PUBLIC_WINGR_API_BASE_URL in ${path.basename(stagingEnvPath)} must be ${STAGING_API_BASE_URL}.`,
    );
  }

  const environment = { ...inheritedEnv };
  for (const variable of REQUIRED_VARIABLES) delete environment[variable];

  return {
    environment: {
      ...environment,
      // Expo otherwise auto-loads the repository's production .env file.
      EXPO_NO_DOTENV: "1",
      EXPO_PUBLIC_WINGR_STAGING: "1",
      EXPO_PUBLIC_WINGR_API_BASE_URL: STAGING_API_BASE_URL,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        localValues.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim(),
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:
        localValues.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY.trim(),
    },
    stagingEnvPath,
  };
}

function main() {
  const expoArguments = process.argv.slice(2);
  const { environment, stagingEnvPath } = resolveStagingEnvironment();

  if (expoArguments.length === 1 && expoArguments[0] === "--check") {
    console.log("Staging configuration is valid.");
    console.log(`Config file: ${stagingEnvPath}`);
    console.log(`API base URL: ${environment.EXPO_PUBLIC_WINGR_API_BASE_URL}`);
    console.log("Supabase publishable key: configured (redacted)");
    console.log("RevenueCat iOS SDK key: configured (redacted)");
    console.log("Expo .env auto-loading: disabled for this command");
    return;
  }

  if (expoArguments.length === 0) {
    throw new Error("Provide an Expo command, for example: start --dev-client --clear.");
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, ["expo", ...expoArguments], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`\nStaging configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_VARIABLES,
  STAGING_API_BASE_URL,
  parseEnvFile,
  resolveStagingEnvironment,
};
