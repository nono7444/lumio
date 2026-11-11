// Lumio Auto → onglet « Lecture » (caché dans Lumio).
import { AutoPlayingScreen } from '@/components/auto-admin';
import { IS_AUTO } from '@/lib/variant';

export default function LectureRoute() {
  return IS_AUTO ? <AutoPlayingScreen /> : null;
}
