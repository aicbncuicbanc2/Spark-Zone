import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize } from '../lib/theme';

type Props = {
  title?: string;
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ title = "Couldn't load this.", message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {onRetry && (
        <Pressable style={styles.button} onPress={onRetry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    backgroundColor: colors.cream,
  },
  title: {
    fontSize: fontSize.subheading,
    fontWeight: '600',
    color: colors.navy,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  button: {
    marginTop: 12,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  buttonText: {
    color: colors.white,
    fontWeight: '600',
  },
});
