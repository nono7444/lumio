// Profils de la famille (« Qui regarde ? ») : un compte Jellyfin chacun, créé et ouvert par le serveur Lumio.
import { serverCall } from './chat';
import type { JellyfinSession, Settings } from './settings';

export type Profile = {
  id: string;
  jfUserId: string;
  name: string;
  avatar: string;
  color: string;
  kind: 'adult' | 'kid';
  hasPin: boolean;
  maxAge: number | null;
  libraries: string[] | null;
  linked: boolean;
};
export type ProfileInput = Partial<{
  name: string;
  avatar: string;
  color: string;
  kind: 'adult' | 'kid';
  maxAge: number | null;
  libraries: string[];
  pin: string | null;
  linkUser: string;
  linkPassword: string;
}>;

/** Les profils se gèrent toujours avec la session du compte principal. */
export const ownerSettings = (s: Settings): Settings => (s.household?.owner ? { ...s, jellyfin: s.household.owner } : s);

export const profilesApi = {
  list: (s: Settings) => serverCall<{ owner: boolean; profiles: Profile[] }>(ownerSettings(s), '/api/profiles'),
  libraries: (s: Settings) => serverCall<{ libraries: { id: string; name: string; type: string | null }[] }>(ownerSettings(s), '/api/profiles/libraries'),
  create: (s: Settings, b: ProfileInput) => serverCall<{ profile: Profile }>(ownerSettings(s), '/api/profiles', { method: 'POST', body: JSON.stringify(b) }),
  update: (s: Settings, id: string, b: ProfileInput) => serverCall<{ profile: Profile }>(ownerSettings(s), `/api/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  remove: (s: Settings, id: string, deleteAccount: boolean) =>
    serverCall(ownerSettings(s), `/api/profiles/${id}${deleteAccount ? '?deleteAccount=1' : ''}`, { method: 'DELETE' }),
  /** Ouvre la session Jellyfin du profil (appareil à part pour ne pas fermer celle du compte principal). */
  switch: async (s: Settings, p: Profile, pin?: string): Promise<JellyfinSession> => {
    const owner = ownerSettings(s).jellyfin!;
    const deviceId = `${s.deviceId}-p${p.id}`;
    const r = await serverCall<{ session: { token: string; userId: string; userName: string; isAdmin: boolean; deviceId: string } }>(
      ownerSettings(s),
      `/api/profiles/${p.id}/switch`,
      { method: 'POST', body: JSON.stringify({ deviceId, pin }) }
    );
    return {
      url: owner.url,
      serverName: owner.serverName,
      token: r.session.token,
      userId: r.session.userId,
      userName: r.session.userName,
      isAdmin: r.session.isAdmin,
      deviceId: r.session.deviceId,
      profile: { id: p.id, name: p.name, avatar: p.avatar, color: p.color, kind: p.kind },
    };
  },
};

export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🦄', '🐙', '🦖', '🐱', '🐶', '🐨', '🐯', '🐵', '🦉', '🐧', '🐝', '🌟', '🚀', '⚽️', '🎮', '🎧', '🌸', '🍕', '👑', '😎'];
export const COLORS = ['#3D8BFF', '#7D4DFF', '#FF4F8B', '#FF7A00', '#2BB673', '#00B8D9', '#E0243A', '#8E8E93'];
