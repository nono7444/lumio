// Lance le téléchargement d'un titre : directement dans Radarr / Sonarr pour l'admin,
// sous forme de demande Seerr pour les autres utilisateurs.
import { invalidateLibrary, radarr, sonarr } from './arr';
import { seerr } from './seerr';
import { arrReady, isManager, type Settings } from './settings';
import { tmdb } from './tmdb';

export type GrabTarget = { type: 'movie' | 'tv'; tmdbId: number; season?: number; allSeasons?: boolean };

export async function grab(s: Settings, t: GrabTarget): Promise<string | null> {
  if (!isManager(s)) return request(s, t);

  if (t.type === 'movie') {
    if (!s.radarr.url || !s.radarr.apiKey) return null;
    const existing = await radarr.byTmdb(s.radarr, t.tmdbId);
    if (existing) return existing.hasFile ? null : 'Déjà dans Radarr : le téléchargement suit son cours.';
    if (!arrReady(s.radarr)) return null;
    await radarr.add(s.radarr, t.tmdbId);
    invalidateLibrary();
    return 'Ajouté à Radarr : le film se télécharge en arrière-plan.';
  }

  if (!s.sonarr.url || !s.sonarr.apiKey) return null;
  const tv = await tmdb.tv(s, t.tmdbId);
  const tvdb = tv.external_ids?.tvdb_id;
  if (!tvdb) return null;
  const allSeasons = tv.seasons.filter((x) => x.season_number > 0).map((x) => x.season_number);
  const wanted = t.allSeasons ? allSeasons : t.season ? [t.season] : allSeasons;

  const existing = await sonarr.byTvdb(s.sonarr, tvdb);
  if (existing) {
    const missing = wanted.filter((n) => !existing.seasons.find((x) => x.seasonNumber === n)?.monitored);
    if (!missing.length) return null;
    await sonarr.monitorSeasons(s.sonarr, existing, missing);
    invalidateLibrary();
    return missing.length === 1 ? `Saison ${missing[0]} envoyée à Sonarr.` : `${missing.length} saisons envoyées à Sonarr.`;
  }
  if (!arrReady(s.sonarr)) return null;
  await sonarr.add(s.sonarr, tvdb, wanted);
  invalidateLibrary();
  return t.allSeasons || wanted.length > 1
    ? 'Série ajoutée à Sonarr : elle se télécharge en arrière-plan.'
    : `Série ajoutée à Sonarr (saison ${wanted[0]}).`;
}

/** Demande Seerr pour un utilisateur non-admin. */
export async function request(s: Settings, t: GrabTarget): Promise<string | null> {
  if (!s.seerr?.url) return null;
  if (t.type === 'movie') {
    await seerr.requestMovie(s, t.tmdbId);
    return 'Demande envoyée : le film sera ajouté après validation.';
  }
  await seerr.requestTv(s, t.tmdbId, t.allSeasons || !t.season ? 'all' : [t.season]);
  return 'Demande envoyée : la série sera ajoutée après validation.';
}
