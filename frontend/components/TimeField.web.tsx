import { colors } from '../lib/theme';

// react-native-web's TextInput can't become a real <input type="time">, so
// this file (picked up automatically for web builds, same convention as
// any other .web.tsx) renders a plain HTML time input instead - it's
// already in "HH:MM" form, exactly what quietStart/quietEnd store, so no
// conversion is needed either way. Gives users the browser's own
// clock/spinner control instead of typing digits by hand. The default
// focus ring this element would otherwise get is already stripped
// globally, see lib/webFocusReset.ts.
export function TimeField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '10px 14px',
        fontSize: 16,
        fontFamily: 'inherit',
        color: colors.navy,
        backgroundColor: colors.white,
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  );
}
