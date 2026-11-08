// Onglet admin : Lumio Auto → « Seed » ; Lumio (famille) : caché. Le code est dans components/auto-admin.
import AutoTab, { AutoSeedScreen } from '@/components/auto-admin';
import { IS_AUTO } from '@/lib/variant';

export default function AutoRoute() {
  return IS_AUTO ? <AutoSeedScreen /> : <AutoTab />;
}
