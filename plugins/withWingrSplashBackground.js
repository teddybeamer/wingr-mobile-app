const { withMod } = require('expo/config-plugins');

const SPLASH_BACKGROUND_COLOR = {
  alpha: '1.000',
  blue: '0.992156862745098',
  colorSpace: 'custom',
  customColorSpace: 'sRGB',
  green: '0.439215686274510',
  red: '0.0980392156862745',
};

// Expo SDK 54 leaves the legacy storyboard's inline named color unchanged
// when an existing splash image is removed. Keep it aligned with the
// expo-splash-screen config so regenerated iOS projects stay solid #1970FD.
module.exports = function withWingrSplashBackground(config) {
  return withMod(config, {
    platform: 'ios',
    mod: 'splashScreenStoryboard',
    action: (config) => {
      const resources = config.modResults.document.resources[0];

      delete resources.image;
      resources.namedColor = [
        {
          $: { name: 'SplashScreenBackground' },
          color: [{ $: SPLASH_BACKGROUND_COLOR }],
        },
      ];

      return config;
    },
  });
};
