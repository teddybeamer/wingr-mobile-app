const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const packageJson = require("../package.json");
const metroConfig = require("../metro.config");

const {
  STAGING_API_BASE_URL,
  resolveStagingEnvironment,
} = require("./with-staging-env");

const STAGING_START_COMMAND =
  "node scripts/with-staging-env.js start --dev-client --clear";
const STAGING_IOS_COMMAND =
  "node scripts/with-staging-env.js run:ios --device";

function withStagingFile(contents, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wingr-staging-env-"));
  const stagingEnvPath = path.join(directory, ".env.staging.local");
  fs.writeFileSync(stagingEnvPath, contents);

  try {
    return callback({ directory, stagingEnvPath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("staging configuration replaces inherited production values", () => {
  withStagingFile(
    [
      `EXPO_PUBLIC_WINGR_API_BASE_URL=${STAGING_API_BASE_URL}`,
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=staging-publishable-key",
      "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=staging-app-key",
    ].join("\n"),
    ({ directory, stagingEnvPath }) => {
      const { environment } = resolveStagingEnvironment({
        cwd: directory,
        inheritedEnv: {
          EXPO_PUBLIC_WINGR_API_BASE_URL:
            "https://production.example/functions/v1",
            EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "production-publishable-key",
            EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "production-app-key",
        },
        stagingEnvPath,
      });

      assert.equal(environment.EXPO_NO_DOTENV, "1");
      assert.equal(environment.EXPO_PUBLIC_WINGR_STAGING, "1");
      assert.equal(
        environment.EXPO_PUBLIC_WINGR_API_BASE_URL,
        STAGING_API_BASE_URL,
      );
      assert.equal(
        environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        "staging-publishable-key",
      );
      assert.equal(
        environment.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
        "staging-app-key",
      );
    },
  );
});

test("staging configuration rejects a production or otherwise wrong API URL", () => {
  withStagingFile(
    [
      "EXPO_PUBLIC_WINGR_API_BASE_URL=https://production.example/functions/v1",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=staging-publishable-key",
      "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=staging-app-key",
    ].join("\n"),
    ({ directory, stagingEnvPath }) => {
      assert.throws(
        () => resolveStagingEnvironment({ cwd: directory, stagingEnvPath }),
        /must be https:\/\/driytnlagwgzebnfdpcr\.supabase\.co\/functions\/v1/,
      );
    },
  );
});

test("staging configuration rejects a missing or placeholder RevenueCat iOS SDK key", () => {
  for (const key of [
    undefined,
    "PASTE_STAGING_REVENUECAT_IOS_PUBLIC_SDK_KEY_HERE",
  ]) {
    const values = [
      `EXPO_PUBLIC_WINGR_API_BASE_URL=${STAGING_API_BASE_URL}`,
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=staging-publishable-key",
      ...(key ? [`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=${key}`] : []),
    ];
    withStagingFile(values.join("\n"), ({ directory, stagingEnvPath }) => {
      assert.throws(
        () => resolveStagingEnvironment({ cwd: directory, stagingEnvPath }),
        /EXPO_PUBLIC_REVENUECAT_IOS_API_KEY must be set to a real staging value/,
      );
    });
  }
});

test("staging configuration never falls back to inherited values when the local file is missing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wingr-staging-env-"));

  try {
    assert.throws(
      () =>
        resolveStagingEnvironment({
          cwd: directory,
          inheritedEnv: {
            EXPO_PUBLIC_WINGR_API_BASE_URL:
              "https://production.example/functions/v1",
            EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "production-publishable-key",
            EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: "production-app-key",
          },
        }),
      /Missing \.env\.staging\.local/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("default local iOS and Metro commands use the fail-closed staging wrapper", () => {
  assert.equal(packageJson.scripts.start, STAGING_START_COMMAND);
  assert.equal(packageJson.scripts["start:dev-client"], STAGING_START_COMMAND);
  assert.equal(packageJson.scripts["start:staging"], STAGING_START_COMMAND);
  assert.equal(packageJson.scripts.ios, STAGING_IOS_COMMAND);
  assert.equal(packageJson.scripts["ios:staging"], STAGING_IOS_COMMAND);
});

test("Metro excludes the staging credential file from its module graph", () => {
  const stagingEnvPath = path.resolve(__dirname, "../.env.staging.local");

  assert.ok(
    metroConfig.resolver.blockList.some((pattern) => pattern.test(stagingEnvPath)),
  );
});
