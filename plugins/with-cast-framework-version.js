// Fige les versions du Chromecast de Google sur Android.
// react-native-google-cast prend sinon « la dernière » (+) :
// - play-services-cast-framework 23.0.0 est compilée avec Kotlin 2.4 (Kotlin 2.2 attendu) ;
// - elle entraîne androidx.mediarouter 1.9.0-beta01, qui exige le SDK Android 37.
// On garde donc des versions stables et compatibles.
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const CAST = '22.1.0';
const MEDIAROUTER = '1.7.0';

module.exports = function withCastFrameworkVersion(config) {
  config = withProjectBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes('castFrameworkVersion')) {
      c.modResults.contents += `\n// Chromecast : version figée (voir plugins/with-cast-framework-version.js)\next.castFrameworkVersion = "${CAST}"\n`;
    }
    return c;
  });
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes('androidx.mediarouter:mediarouter:')) {
      c.modResults.contents += `
// Chromecast : mediarouter stable (la bêta 1.9 exige le SDK 37), voir plugins/with-cast-framework-version.js
configurations.all {
    resolutionStrategy.force "androidx.mediarouter:mediarouter:${MEDIAROUTER}"
}
`;
    }
    return c;
  });
};
