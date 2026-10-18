// « Relancer la recherche » pour une demande validée dont Radarr / Sonarr n'a encore rien trouvé :
// le serveur Lumio relance la recherche et répond « trouvé » ou « toujours rien ».
import { useState } from 'react';

import { toast } from '@/components/toast';
import { Button } from '@/components/ui';
import { requestsApi, type Req } from '@/lib/requests';
import { useSettings } from '@/lib/settings';

export function RecheckButton({ r, onDone, style, compact }: { r: Req; onDone?: () => void; style?: object; compact?: boolean }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await requestsApi.search(settings, r.id);
      toast(res.found ? `✅ ${res.message}` : `🔎 ${res.message}`, res.found ? 'ok' : 'info', 8000);
      onDone?.();
    } catch (e: any) {
      toast(e?.message ?? String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      title={busy ? 'Recherche…' : compact ? 'Relancer' : 'Relancer la recherche'}
      icon="refresh"
      variant="secondary"
      loading={busy}
      onPress={run}
      style={style}
    />
  );
}
