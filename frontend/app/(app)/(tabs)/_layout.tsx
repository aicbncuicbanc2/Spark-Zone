import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { PanResponder, View } from 'react-native';

import { colors } from '../../../lib/theme';

// Home -> Pantry -> Scan, left to right, matching the bottom bar's icon
// order - swiping left moves forward through this list (like turning a
// page), swiping right moves back. Doesn't wrap at the ends.
const TAB_ORDER = ['/', '/pantry', '/scan'] as const;
const SWIPE_DISTANCE_THRESHOLD = 60;
const SWIPE_VELOCITY_THRESHOLD = 0.3;

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
          // slide) - a quick fade instead of a hard cut is enough to read
          // as an intentional transition rather than a flicker.
          animation: 'fade',
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
