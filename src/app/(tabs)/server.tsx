// Lumio Auto → onglet « Serveur » (caché dans Lumio).
import { AutoServerScreen } from '@/components/auto-admin';
import { IS_AUTO } from '@/lib/variant';

export default function ServeurRoute() {
  return IS_AUTO ? <AutoServerScreen /> : null;
}
