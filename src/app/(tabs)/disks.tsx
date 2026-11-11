// Lumio Auto → onglet « Disques » (caché dans Lumio).
import { AutoDisksScreen } from '@/components/auto-admin';
import { IS_AUTO } from '@/lib/variant';

export default function DisquesRoute() {
  return IS_AUTO ? <AutoDisksScreen /> : null;
}
