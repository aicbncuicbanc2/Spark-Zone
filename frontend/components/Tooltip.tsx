import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { colors } from '../lib/theme';

// Modelled on animate-ui.com's Tooltip: a small label that fades in above an
// icon-only button on hover, so its meaning isn't left to guessing. Web
// only - onHoverIn/Out simply never fire on native, so the label is never
// even rendered there (a harmless no-op, not a missing feature).

// The plain visual piece, for a button that already tracks its own hovered
// state (e.g. one that also fades its own fill color on hover) - nest this
// inside it instead of wrapping it in a second Pressable.
export function TooltipBubble({ label, visible }: { label: string; visible: boolean }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 120, useNativeDriver: true }).start();
  }, [visible, opacity]);

  if (!visible) return null;

  return (
    <View style={styles.bubbleAnchor} pointerEvents="none">
      <Animated.View style={[styles.bubble, { opacity }]}>
        <Text style={styles.bubbleText}>{label}</Text>
      </Animated.View>
    </View>
  );
}

// Owns the Pressable itself (rather than wrapping an existing one) so
// there's only one hover/press target, not two nested Pressables fighting
// over it - for the common case of a button with no hover styling of its
// own to preserve.
export function Tooltip({
  label,
  onPress,
  hitSlop,
  children,
  style,
}: {
  label: string;
  onPress: () => void;
  hitSlop?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <View style={styles.wrap}>
      <Pressable
        style={style}
        hitSlop={hitSlop}
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
      >
        {children}
      </Pressable>
      <TooltipBubble label={label} visible={hovered} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  // Spans exactly the icon's own width (left:0/right:0 against the
  // position:relative wrap, which shrinks to fit the icon) so centering
  // the bubble inside it centers the bubble over the icon, without
  // needing a percentage-based transform (RN doesn't support one on
  // native, though this subtree never even mounts there).
  bubbleAnchor: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 6,
    alignItems: 'center',
  },
  bubble: {
    backgroundColor: colors.navy,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  bubbleText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '600',
    ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' as const } : null),
  },
});
