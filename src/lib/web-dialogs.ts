// Appli Mac / web : react-native-web n'affiche pas Alert.alert / Alert.prompt.
// On les remplace par de petites boîtes de dialogue sombres, dans le style de l'appli.
import { Alert, Platform, type AlertButton } from 'react-native';

type PromptCb = ((text: string) => void) | AlertButton[] | undefined;

function dialog(title: string, message: string | undefined, buttons: AlertButton[], input?: { value: string; secure?: boolean }) {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;backdrop-filter:blur(6px)';
  const box = document.createElement('div');
  box.style.cssText =
    'width:min(380px,90vw);background:rgba(40,40,44,.96);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,.5)';
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:6px;text-align:center';
  box.appendChild(h);
  if (message) {
    const m = document.createElement('div');
    m.textContent = message;
    m.style.cssText = 'font-size:13px;color:rgba(255,255,255,.7);text-align:center;line-height:1.4;white-space:pre-wrap';
    box.appendChild(m);
  }
  let field: HTMLInputElement | null = null;
  if (input) {
    field = document.createElement('input');
    field.type = input.secure ? 'password' : 'text';
    field.value = input.value;
    field.style.cssText =
      'margin-top:14px;width:100%;box-sizing:border-box;background:#1c1c1e;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:10px 12px;color:#fff;font-size:14px;outline:none';
    box.appendChild(field);
  }
  const row = document.createElement('div');
  row.style.cssText = `display:flex;gap:8px;margin-top:16px;${buttons.length > 2 ? 'flex-direction:column' : ''}`;
  const close = () => overlay.remove();
  const list = buttons.length ? buttons : [{ text: 'OK' }];
  for (const b of list) {
    const el = document.createElement('button');
    el.textContent = b.text ?? 'OK';
    const color = b.style === 'destructive' ? '#FF453A' : b.style === 'cancel' ? 'rgba(255,255,255,.75)' : '#fff';
    el.style.cssText = `flex:1;padding:10px;border-radius:10px;border:0;cursor:pointer;font-size:14px;font-weight:${b.style === 'cancel' ? 500 : 700};color:${color};background:rgba(255,255,255,.1)`;
    el.onclick = () => {
      close();
      (b.onPress as ((v?: string) => void) | undefined)?.(field?.value);
    };
    row.appendChild(el);
  }
  box.appendChild(row);
  overlay.appendChild(box);
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      close();
      list.find((b) => b.style === 'cancel')?.onPress?.();
    }
  };
  document.body.appendChild(overlay);
  if (field) {
    field.focus();
    field.onkeydown = (e) => {
      if (e.key === 'Enter') (row.lastChild as HTMLButtonElement | null)?.click();
      if (e.key === 'Escape') close();
    };
  }
}

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  Alert.alert = (title, message, buttons) => dialog(title, message, buttons ?? []);
  Alert.prompt = (title, message, cb?: PromptCb, type?: string, defaultValue?: string) => {
    const buttons: AlertButton[] = Array.isArray(cb)
      ? cb
      : [{ text: 'Annuler', style: 'cancel' }, { text: 'OK', onPress: (v?: string) => cb?.(v ?? '') } as AlertButton];
    dialog(title, message, buttons, { value: defaultValue ?? '', secure: type === 'secure-text' });
  };
}
