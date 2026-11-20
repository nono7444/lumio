// Quatre applis à partir du même code :
// - Lumio (par défaut) : l'appli de la famille ;
// - Lumio Auto (APP_VARIANT=auto) : l'appli de l'admin (Lumio Auto, torrents, serveur, mises à jour) ;
// - Lumio Audio (APP_VARIANT=audio) : les livres audio de la maison (bibliothèque du serveur Lumio, lecture en arrière-plan) ;
// - Lumio Livres (APP_VARIANT=books) : livres, BD et mangas de la maison (bibliothèque du serveur Lumio, liseuse).
const VARIANTS = {
  auto: {
    name: 'Lumio Auto',
    scheme: 'lumioauto',
    id: 'lol.wawanono.lumio.auto',
    dir: 'auto',
    bg: '#1A0F08',
    local: 'Lumio Auto se connecte à ton serveur Lumio et à Jellyfin sur ton réseau local.',
  },
  audio: {
    name: 'Lumio Audio',
    scheme: 'lumioaudio',
    id: 'lol.wawanono.lumio.audio',
    dir: 'audio',
    bg: '#120A1F',
    local: 'Lumio Audio se connecte à ton serveur Lumio sur ton réseau local.',
  },
  books: {
    name: 'Lumio Livres',
    scheme: 'lumiolivres',
    id: 'lol.wawanono.lumio.livres',
    dir: 'books',
    bg: '#06201C',
    local: 'Lumio Livres se connecte à ton serveur Lumio sur ton réseau local.',
  },
};

module.exports = ({ config }) => {
  const v = VARIANTS[process.env.APP_VARIANT];
  if (!v) return { ...config, extra: { ...(config.extra || {}), variant: 'lumio' } };
  const plugins = [
    ...(config.plugins || [])
      // Pas de widget dans Lumio Auto / Lumio Audio (il reste dans Lumio)
      .filter((p) => p !== '@bacons/apple-targets')
      .map((p) =>
        Array.isArray(p) && p[0] === 'expo-splash-screen' ? ['expo-splash-screen', { ...p[1], image: `./assets/images/${v.dir}/splash-icon.png` }] : p
      ),
    ...(v.plugins || []),
  ];
  return {
    ...config,
    name: v.name,
    slug: config.slug,
    scheme: v.scheme,
    icon: `./assets/images/${v.dir}/icon.png`,
    ios: {
      ...config.ios,
      icon: `./assets/images/${v.dir}/icon.png`,
      bundleIdentifier: v.id,
      entitlements: {},
      infoPlist: { ...config.ios.infoPlist, NSLocalNetworkUsageDescription: v.local },
    },
    android: {
      ...config.android,
      package: v.id,
      adaptiveIcon: {
        ...config.android.adaptiveIcon,
        backgroundColor: v.bg,
        foregroundImage: `./assets/images/${v.dir}/android-icon-foreground.png`,
        backgroundImage: `./assets/images/${v.dir}/android-icon-background.png`,
      },
    },
    plugins,
    extra: { ...(config.extra || {}), variant: process.env.APP_VARIANT },
  };
};
