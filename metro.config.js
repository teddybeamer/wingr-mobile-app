const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
const stagingEnvPath = path.resolve(__dirname, '.env.staging.local');
const escapeRegExp = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
const stagingApiBaseUrl = 'https://driytnlagwgzebnfdpcr.supabase.co/functions/v1';
const isStaging = process.env.EXPO_PUBLIC_WINGR_STAGING === '1';

if (
  isStaging &&
  process.env.EXPO_PUBLIC_WINGR_API_BASE_URL?.trim().replace(/\/$/, '') !==
    stagingApiBaseUrl
) {
  throw new Error(
    `Staging Metro must use EXPO_PUBLIC_WINGR_API_BASE_URL=${stagingApiBaseUrl}.`,
  );
}

// Expo SDK 54's development env virtual module uses a broad require.context
// for project-root `.env*` files. In staging, those files must not enter the
// graph: expo/virtual/env merges them over the staging process environment and
// could otherwise replace validated staging values with production values.
// Production keeps its normal dotenv behavior. The staging wrapper supplies
// and validates every required staging value before Metro starts.
const projectDotEnvPattern = new RegExp(
  `${escapeRegExp(path.resolve(__dirname, '.env'))}(?:\\..*)?$`,
);
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  new RegExp(`${escapeRegExp(stagingEnvPath)}$`),
  ...(isStaging ? [projectDotEnvPattern] : []),
];

module.exports = withNativeWind(config, { input: './global.css' });
