import { Platform } from 'react-native';

// react-native-web's style compiler doesn't support the browser's own
// focus outline at all - `outlineWidth`/`outlineStyle` in a TextInput's
// style prop are silently dropped (confirmed against RNW's source: no
// "outline" handling anywhere in its style compiler), so removing the
// black focus ring an <input>/<textarea> gets on focus needs a real,
// global CSS rule instead. Runs once at import time; a no-op on native,
// which has no DOM to inject into.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = 'input:focus, textarea:focus { outline: none; }';
  document.head.appendChild(style);
}
