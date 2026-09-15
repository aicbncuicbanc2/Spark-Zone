import { Ionicons } from '@expo/vector-icons';
import type { BottomTabSceneInterpolationProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Dimensions, Easing, PanResponder, View } from 'react-native';

import { colors } from '../../../lib/theme';

// Home -> Pantry -> Scan, left to right, matching the bottom bar's icon
// order - swiping left moves forward through this list (like turning a
// page), swiping right moves back. Doesn't wrap at the ends.
const TAB_ORDER = ['/', '/pantry', '/scan'] as const;
const SWIPE_DISTANCE_THRESHOLD = 60;
const SWIPE_VELOCITY_THRESHOLD = 0.3;

// expo-router's Tabs only ships two built-in transitions ('fade' and
// 'shift', a 50px nudge) - neither is the full "one page slides fully off,
// the next slides fully in" effect a tab switch was asked to have, which
// only exists as a preset for the *stack* navigator (used elsewhere in this
// app for pushed screens, not tabs). This is that same full slide, written
// by hand as a custom scene-style interpolator: `progress` is -1 for a
// screen with a lower tab index than the active one, 0 when active, 1 when
// higher - so a screen you're leaving slides fully off toward whichever
// side its neighbor sits on, and the incoming one slides fully in from the
// opposite side, matching TAB_ORDER's left-to-right layout.
function forSlide({ current }: BottomTabSceneInterpolationProps) {
  const { width } = Dimensions.get('window');
  return {
    sceneStyle: {
      transform: [
        {
          translateX: current.progress.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [-width, 0, width],
          }),
        },
      ],
    },
  };
}

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();

  // Deliberately only the bubble-phase callback (no *Capture variant): a
  // horizontal ScrollView the touch actually starts on - the home tip
  // carousel, the category/location chip rows - gets first refusal and
  // claims the gesture for its own scrolling. This is only ever asked once
  // nothing nested already wanted the touch, so it can claim a swipe
  // starting in open space (or over a vertical list, which doesn't compete
  // for horizontal drags) without fighting those inner scrollers for it.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderRelease: (_evt, gesture) => {
          const currentIndex = TAB_ORDER.indexOf(pathname as (typeof TAB_ORDER)[number]);
          if (currentIndex === -1) return;
          const swipedFarEnough =
            Math.abs(gesture.dx) > SWIPE_DISTANCE_THRESHOLD || Math.abs(gesture.vx) > SWIPE_VELOCITY_THRESHOLD;
          if (!swipedFarEnough) return;
          const nextIndex = gesture.dx < 0 ? currentIndex + 1 : currentIndex - 1;
          if (nextIndex < 0 || nextIndex >= TAB_ORDER.length) return;
          router.push(TAB_ORDER[nextIndex]);
        },
      }),
    [pathname, router]
  );

  return (
    <View style={{ flex: 1 }} {...panResponder.panHandlers}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: colors.navy,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.border },
          // Tabs swap instantly by default (no push/pop, so nothing to
          // animate) - forSlide (above) is a custom full-width slide,
          // since neither of the two built-in options ('fade', a 50px
          // 'shift') is the real page-sliding-across effect this was
          // asked for.
          sceneStyleInterpolator: forSlide,
          transitionSpec: {
            animation: 'timing',
            config: { duration: 300, easing: Easing.out(Easing.cubic) },
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="pantry"
          options={{
            title: 'Pantry',
            tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color, size }) => <Ionicons name="barcode-outline" size={size} color={color} />,
          }}
        />
      </Tabs>
    </View>
  );
}
