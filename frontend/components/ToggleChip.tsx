import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { colors } from '../lib/theme';

// Same fill-rises-from-bottom animation as LiquidButton's outline variant,
// adapted for a toggle chip: selected is a persistent version of "filled",
// hovered is a transient preview of it - either one asks for the same
// full fill, so they drive one shared Animated.Value together instead of
// fighting over it.
export function ToggleChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fill = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: selected || hovered ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [selected, hovered, fill]);

  return (
    <Pressable onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}>
      <View style={styles.chip}>
        <Animated.View
          pointerEvents="none"
          style={[styles.fill, { height: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
        />
        <Animated.Text
          style={[
            styles.text,
            { color: fill.interpolate({ inputRange: [0, 1], outputRange: [colors.navy, colors.white] }) },
          ]}
        >
          {label}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#2B3A9E',
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
