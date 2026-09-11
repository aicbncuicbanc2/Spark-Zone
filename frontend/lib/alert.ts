import { Alert as NativeAlert, type AlertButton, Platform } from 'react-native';

/**
 * Drop-in for RN's Alert.alert(title, message?, buttons?) that actually
 * works on web. react-native-web's own Alert is a hard no-op - literally
 * `static alert() {}` - so on the Netlify build every one of these calls
 * (permission prompts, scan-failure messages, delete confirmations, the
 * brand/date mismatch warning) was silently doing nothing: no dialog, and
 * critically, no button's onPress ever ran either. That's a real
 * behaviour gap, not just a missing UI - a user hitting "Continue anyway"
 * on web wasn't silently shown an ugly fallback, they were shown *nothing*
 * and nothing happened next.
 *
 * On native this delegates straight to the real Alert. On web it drives
 * AppAlertHost (mounted once at the app root) through a tiny pub/sub
 * store, so call sites never need to know which platform they're on.
 */
export interface AlertState {
  title: string;
  message?: string;
  buttons: AlertButton[];
}

type Listener = (state: AlertState | null) => void;

let listener: Listener | null = null;

export function subscribeToAlerts(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function alert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    NativeAlert.alert(title, message, buttons);
    return;
  }
  const resolvedButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];
  listener?.({ title, message, buttons: resolvedButtons });
}

/** AppAlertHost calls this once the user taps a button. */
export function resolveWebAlert(button: AlertButton): void {
  listener?.(null);
  button.onPress?.();
}

export function dismissWebAlert(): void {
  listener?.(null);
}
