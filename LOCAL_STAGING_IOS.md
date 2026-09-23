# Local iOS development

Local development uses staging by default. The normal iOS and Metro commands cannot load the repository's production `.env` file.

## One-time setup

Copy the tracked template and add the staging project's publishable keys locally:

```sh
cp .env.staging.example .env.staging.local
```

Edit `.env.staging.local` and replace the Supabase and RevenueCat placeholders. Use the Wingr App Store iOS public `appl_...` SDK key for RevenueCat so physical-device staging builds use Apple Sandbox StoreKit instead of the RevenueCat Test Store. The file is ignored by Git. It intentionally contains the staging API URL:

```text
https://driytnlagwgzebnfdpcr.supabase.co/functions/v1
```

Optional diagnostic (the key is never printed):

```sh
npm run staging:check
```

## Day-to-day workflow

Install or rebuild the physical-iPhone development build against staging:

```sh
npm run ios
```

After that build is installed, start a staging Metro server without rebuilding iOS:

```sh
npm start
```

`npm start` clears Metro's cache to avoid serving a bundle created with a different environment. Reload the development build after Metro starts.

`npm run ios:staging`, `npm run start:staging`, and `npm run start:dev-client` remain equivalent aliases for the same staging-only workflow.

## Safety behavior

The staging wrapper validates all required values before Expo starts. It fixes the API base URL to the staging project, requires non-placeholder staging Supabase and RevenueCat iOS SDK keys, disables Expo's automatic `.env` loading, and replaces any inherited values for those variables. Therefore the repository's production `.env` cannot override a normal local command, and a missing local staging file fails before a build or Metro server begins.

The wrapper applies to the normal local iOS and Metro commands. It also keeps PostHog disabled for the local staging development build rather than loading production analytics settings.

## Production and App Store releases

Production is deliberately not available through a local `npm run ios` shortcut. The existing, unchanged EAS `production` profile remains the explicit release workflow, for example:

```sh
eas build --platform ios --profile production
```

That release command is separate from the local staging wrapper. DeviceCheck, RevenueCat, Supabase configuration, bundle identity, and backend behavior are unchanged.
