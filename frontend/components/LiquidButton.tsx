import { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../lib/theme';

// Modelled on animate-ui.com's "Liquid Button": a colored fill that rises
// from the bottom on hover - not the SVG-filter gooey-blob effect "liquid"
// might suggest, just an Animated-driven height, so it works on both web
// (where hover exists) and native (where onHoverIn/Out simply never fire -
// a harmless no-op, not a missing feature). No scale/size change: on a
// full-width button (this one spans its whole parent), scaling up visibly
// overflows past the container's own padding - fine for a small button,
// not for this one.
export function LiquidButton({
  label,
  onPress,
  variant = 'solid',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'outline';
  disabled?: boolean;
  /** Swaps the label for a spinner and disables the button - for an action
   * already in flight (e.g. a crop upload), same as the plain Pressable
   * this replaced showed an ActivityIndicator in place of its text. */
  loading?: boolean;
}) {
  // Drives the fill overlay's height (0%-100%) and, for the outline variant,
  // the text color crossfade - can't use the native driver for either
  // (layout height and color aren't supported by it), but this only
  // animates on a hover/press interaction, not a hot path.
  const fill = useRef(new Animated.Value(0)).current;

  function animateFill(toValue: number) {
    Animated.timing(fill, { toValue, duration: 220, useNativeDriver: false }).start();
  }

  const isOutline = variant === 'outline';

  return (
    <Pressable
      style={styles.wrapper}
      disabled={disabled || loading}
      onPress={onPress}
      onHoverIn={() => animateFill(1)}
      onHoverOut={() => animateFill(0)}
    >
      <View style={[styles.button, isOutline && styles.outline, disabled && styles.disabled]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.fill,
            {
              backgroundColor: isOutline ? colors.navy : '#2B3A9E',
              height: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
        {loading ? (
          <ActivityIndicator color={isOutline ? colors.navy : colors.white} />
        ) : (
          <Animated.Text
            style={[
              styles.text,
              isOutline
                ? {
                    color: fill.interpolate({
                      inputRange: [0, 1],
                      outputRange: [colors.navy, colors.white],
                    }),
                  }
                : styles.solidText,
            ]}
          >
            {label}
          </Animated.Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The old bare <Pressable style={styles.button}> (button itself had
  // width:'100%') is now a Pressable wrapping an inner Animated.View - the
  // 100% width has to live on THIS outer Pressable too, or it shrinks to
  // fit the label text (as a plain View would by default inside a
  // center-aligned column) and the 100% on the inner view just means 100%
  // of that already-shrunk width.
  wrapper: {
    width: '100%',
  },
  button: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
    overflow: 'hidden',
  },
  outline: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  disabled: {
    opacity: 0.5,
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  text: {
    fontWeight: '600',
  },
  solidText: {
    color: colors.white,
  },
});
