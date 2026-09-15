import { TextInput } from 'react-native';

import { colors } from '../lib/theme';

// Native fallback: no time-picker library is installed, so this stays the
// plain HH:MM text field it always was, validated by the caller's TIME_RE.
// The real picker (the OS's own time control) only exists on web - see
// TimeField.web.tsx.
export function TimeField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        fontSize: 16,
        backgroundColor: colors.white,
      }}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      keyboardType="numbers-and-punctuation"
    />
  );
}
