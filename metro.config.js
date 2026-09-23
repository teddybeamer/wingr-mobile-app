const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
const stagingEnvPath = path.resolve(__dirname, '.env.staging.local');
const escapeRegExp = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

// Expo SDK 54's development env virtual module uses a broad require.context
// for `.env*` files, but its transformer does not recognize `.env.staging.*`.
// The staging wrapper reads this file before Metro starts, so exclude only this
// local credential file from Metro's module graph.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  new RegExp(`${escapeRegExp(stagingEnvPath)}$`),
];

module.exports = withNativeWind(config, { input: './global.css' });
