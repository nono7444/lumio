// Mode développeur : idées de fonctionnalités et bugs proposés par la famille, stockés sur le serveur Lumio.
// L'admin les transmet à Claude (claude.ai) avec un prompt prêt à l'emploi.
import { useEffect, useState } from 'react';

import { serverCall } from './chat';
import { useSettings } from './settings';
import type { Settings } from './settings';

export type IdeaStatus = 'new' | 'planned' | 'sent' | 'done' | 'rejected';
export type Idea = {
  id: string;
  kind: 'feature' | 'bug';
  title: string;
  details: string;
  status: IdeaStatus;
  note?: string;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt?: string;
  votes: number;
  voted: boolean;
  mine: boolean;
  /** Signalement lié à un film / une série */
  media?: { type: 'movie' | 'tv'; tmdbId: number; title: string; poster?: string };
  category?: string;
};

export const IDEA_STATUS: Record<IdeaStatus, { label: string; color: string; icon: string }> = {
  new: { label: 'Nouvelle', color: '#64D2FF', icon: 'sparkles' },
  planned: { label: 'Prévue', color: '#FFB340', icon: 'calendar' },
  sent: { label: 'Chez Claude', color: '#D97757', icon: 'code-slash' },
  done: { label: 'Faite', color: '#30D158', icon: 'checkmark-circle' },
  rejected: { label: 'Écartée', color: '#8E8E93', icon: 'close-circle' },
};

export const ideasApi = {
  list: (s: Settings) => serverCall<{ ideas: Idea[] }>(s, '/api/ideas').then((r) => r.ideas),
  create: (s: Settings, b: { title: string; details: string; kind: Idea['kind']; category?: string; media?: Idea['media'] }) =>
    serverCall<Idea>(s, '/api/ideas', { method: 'POST', body: JSON.stringify(b) }),
  vote: (s: Settings, id: string) => serverCall<Idea>(s, `/api/ideas/${id}/vote`, { method: 'POST' }),
  update: (s: Settings, id: string, b: { status?: IdeaStatus; note?: string }) =>
    serverCall<Idea>(s, `/api/ideas/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  remove: (s: Settings, id: string) => serverCall(s, `/api/ideas/${id}`, { method: 'DELETE' }),
};

/** Prompt complet pour Claude : contexte du projet + idées sélectionnées. */
export function claudePrompt(ideas: Idea[]) {
  const list = ideas
    .map(
      (i, n) =>
        `${n + 1}. [${i.kind === 'bug' ? 'BUG' : 'FONCTIONNALITÉ'}] ${i.title} (proposé par ${i.createdBy.name}, ${i.votes} vote${i.votes > 1 ? 's' : ''})` +
        (i.details ? `\n   ${i.details.replace(/\n/g, '\n   ')}` : '')
    )
    .join('\n');
  return `Tu travailles sur Lumio, mon appli iOS familiale (Expo SDK 57 / React Native, expo-router), dépôt GitHub nono7444/lumio.
- Appli : src/app (écrans), src/lib (Jellyfin, demandes, réglages), src/components.
- Serveur Lumio (Node 22 sans dépendances) : server/lumio/server.js, déployé en Docker chez moi ; il parle à Jellyfin, Radarr et Sonarr.
- L'appli TV Android est un fork de NuvioTV : dépôt nono7444/lumio-tv.
- Le build iOS se lance à chaque push sur main (GitHub Actions → IPA → FlareStore).

Voici les demandes de ma famille :
${list}

Pour chaque demande : dis si c'est faisable et comment, puis implémente-la sur une branche à part (pas sur main), avec des textes en français. Signale ce qui demande une mise à jour du serveur.`;
}

/** Ouvre claude.ai avec le prompt pré-rempli. */
export const claudeUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

// ——— Admin : problèmes signalés pas encore traités (icône ⚠️ de l'accueil) ———

let problemCount = 0;
const problemListeners = new Set<(n: number) => void>();

export async function refreshProblemCount(s: Settings) {
  if (!s.jellyfin?.isAdmin || !s.chatUrl) return;
  const list = await ideasApi.list(s).catch(() => null);
  if (!list) return;
  problemCount = list.filter((i) => i.kind === 'bug' && i.status === 'new').length;
  problemListeners.forEach((l) => l(problemCount));
}

/** Nombre de signalements « nouveaux » (admin seulement), vérifié toutes les 60 s. */
export function useProblemCount() {
  const { settings } = useSettings();
  const [n, setN] = useState(problemCount);
  const admin = settings.jellyfin?.isAdmin === true;
  useEffect(() => {
    problemListeners.add(setN);
    if (!admin || !settings.chatUrl) return () => void problemListeners.delete(setN);
    refreshProblemCount(settings);
    const t = setInterval(() => refreshProblemCount(settings), 60_000);
    return () => {
      problemListeners.delete(setN);
      clearInterval(t);
    };
  }, [admin, settings.chatUrl, settings.jellyfin?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  return admin ? n : 0;
}
