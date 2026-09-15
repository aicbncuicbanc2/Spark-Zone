import { useRef } from 'react';
import { useRouter } from 'expo-router';
import { Animated, Easing, ImageStyle, Pressable, StyleProp } from 'react-native';

import { logoSize } from '../lib/theme';

// The wordmark used in every tab header, navigating back to Home. On hover
// it bobs gently up and down on a loop - as if it's floating on water -
// same harmless no-op on native as LiquidButton's hover props (onHoverIn/
// Out simply never fire there).
export function HeaderLogo({ style }: { style?: StyleProp<ImageStyle> }) {
  const router = useRouter();
  const bob = useRef(new Animated.Value(0)).current;
  const loop = useRef<Animated.CompositeAnimation | null>(null);

  function startBob() {
    loop.current?.stop();
    loop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -3,
          duration: 600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 3,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.current.start();
  }

  function stopBob() {
    loop.current?.stop();
    Animated.timing(bob, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }

  return (
    <Pressable onPress={() => router.push('/')} onHoverIn={startBob} onHoverOut={stopBob}>
      <Animated.Image
        source={require('../assets/brand/wordmark.png')}
        style={[
          { width: logoSize.width, height: logoSize.height },
          style,
          { transform: [{ translateY: bob }] },
        ]}
        resizeMode="contain"
      />
    </Pressable>
  );
}
