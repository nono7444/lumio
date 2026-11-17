// Lumio Auto → onglet « H.265 » : conversion de nuit des films (caché dans Lumio).
import { AutoConvScreen } from '@/components/auto-admin';
import { IS_AUTO } from '@/lib/variant';

export default function ConvertRoute() {
  return IS_AUTO ? <AutoConvScreen /> : null;
}
