/** Widget iOS « Serveurs » façon UptimeRobot : disponibilité 24 h de Jellyfin, Radarr, Sonarr, Lumio et machine en direct. */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'LumioWidget',
  displayName: 'Lumio',
  bundleIdentifier: '.widget',
  deploymentTarget: '16.4',
  icon: '../../assets/images/icon.png',
  colors: {
    $accent: '#3D8BFF',
    $widgetBackground: '#0B0D12',
  },
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
