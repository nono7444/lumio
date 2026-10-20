// Fige la version du module Chromecast de Google sur Android.
// react-native-google-cast prend sinon « la dernière » (+) : la 23.0.0 est compilée avec Kotlin 2.4
// et casse la compilation de l'APK (Kotlin 2.2 attendu).
const { withProjectBuildGradle } = require('expo/config-plugins');

const VERSION = '22.1.0';

module.exports = function withCastFrameworkVersion(config) {
  return withProjectBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes('castFrameworkVersion')) {
      c.modResults.contents += `\n// Chromecast : version figée (voir plugins/with-cast-framework-version.js)\next.castFrameworkVersion = "${VERSION}"\n`;
    }
    return c;
  });
};
