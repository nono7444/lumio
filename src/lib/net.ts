// Requêtes réseau plus robustes sur iPhone.
// Le fetch d'Expo renvoie parfois « fetch failed: UnexpectedException: cancelled (ExpoModulesCore/Promise.swift) »
// quand iOS coupe une requête (appli mise en arrière-plan, changement Wi-Fi / 4G, écran quitté pendant le chargement).
// Ici : une requête de lecture coupée est relancée automatiquement, et une requête qu'on a annulée nous-mêmes
// (délai dépassé) redevient une vraie « AbortError » que le reste de l'appli sait déjà traiter.

const isCancel = (e: any) => /cancell?ed|UnexpectedException|Promise\.swift|network connection was lost/i.test(String(e?.message ?? e));

export class InterruptedError extends Error {
  interrupted = true;
  constructor() {
    super('Connexion interrompue, réessaie dans un instant');
    this.name = 'InterruptedError';
  }
}

/** Erreur sans intérêt pour l'utilisateur (requête coupée par le système ou volontairement abandonnée). */
export const isSilentError = (e: any) => Boolean(e?.interrupted) || e?.name === 'AbortError' || isCancel(e);

let installed = false;
export function installNetworkFix() {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  const original = globalThis.fetch.bind(globalThis);
  const wrapped = async (input: any, init?: any) => {
    const method = String(init?.method ?? (typeof input === 'object' && input?.method) ?? 'GET').toUpperCase();
    const retryable = method === 'GET' || method === 'HEAD';
    for (let attempt = 0; ; attempt++) {
      try {
        return await original(input, init);
      } catch (e: any) {
        if (init?.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }
        if (!isCancel(e)) throw e;
        if (!retryable || attempt >= 2) throw new InterruptedError();
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  };
  globalThis.fetch = wrapped as typeof fetch;
}

installNetworkFix();
