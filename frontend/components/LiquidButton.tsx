import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../lib/theme';

// Modelled on animate-ui.com's "Liquid Button": a slight hover scale-up, a
// press scale-down, and a colored fill that rises from the bottom on hover
// - not the SVG-filter gooey-blob effect "liquid" might suggest, just two
// Animated-driven values, so it works on both web (where hover exists) and
// native (where onHoverIn/Out simply never fire - a harmless no-op, not a
// missing feature).
export function LiquidButton({
  label,
  onPress,
  variant = 'solid',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'solid' | 'outline';
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  // Drives the fill overlay's height (0%-100%) and, for the outline variant,
  // the text color crossfade - can't use the native driver for either
  // (layout height and color aren't supported by it), but this only
  // animates on a hover/press interaction, not a hot path.
  const fill = useRef(new Animated.Value(0)).current;
  const hoveredRef = useRef(false);

  function animateScale(toValue: number) {
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  }

  function animateFill(toValue: number) {
    Animated.timing(fill, { toValue, duration: 220, useNativeDriver: false }).start();
  }

  const isOutline = variant === 'outline';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => {
        hoveredRef.current = true;
        animateScale(1.05);
        animateFill(1);
      }}
      onHoverOut={() => {
        hoveredRef.current = false;
        animateScale(1);
        animateFill(0);
      }}
      onPressIn={() => animateScale(0.95)}
      onPressOut={() => animateScale(hoveredRef.current ? 1.05 : 1)}
    >
      <Animated.View
        style={[
          styles.button,
          isOutline && styles.outline,
          disabled && styles.disabled,
          { transform: [{ scale }] },
        ]}
      >
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
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
