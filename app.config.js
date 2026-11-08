// Deux applis à partir du même code :
// - Lumio (par défaut) : l'appli de la famille ;
// - Lumio Auto (APP_VARIANT=auto) : l'appli de l'admin (Lumio Auto, torrents, serveur, mises à jour).
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'auto') return { ...config, extra: { ...(config.extra || {}), variant: 'lumio' } };
  const plugins = (config.plugins || [])
    // Pas de widget dans Lumio Auto (il reste dans Lumio)
    .filter((p) => p !== '@bacons/apple-targets')
    .map((p) =>
      Array.isArray(p) && p[0] === 'expo-splash-screen' ? ['expo-splash-screen', { ...p[1], image: './assets/images/auto/splash-icon.png' }] : p
    );
  return {
    ...config,
    name: 'Lumio Auto',
    slug: config.slug,
    scheme: 'lumioauto',
    icon: './assets/images/auto/icon.png',
    ios: {
      ...config.ios,
      icon: './assets/images/auto/icon.png',
      bundleIdentifier: 'lol.wawanono.lumio.auto',
      entitlements: {},
      infoPlist: {
        ...config.ios.infoPlist,
        NSLocalNetworkUsageDescription: 'Lumio Auto se connecte à ton serveur Lumio et à Jellyfin sur ton réseau local.',
      },
    },
    android: {
      ...config.android,
      package: 'lol.wawanono.lumio.auto',
      adaptiveIcon: {
        ...config.android.adaptiveIcon,
        backgroundColor: '#1A0F08',
        foregroundImage: './assets/images/auto/android-icon-foreground.png',
        backgroundImage: './assets/images/auto/android-icon-background.png',
      },
    },
    plugins,
    extra: { ...(config.extra || {}), variant: 'auto' },
  };
};
