import { Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { USE_MOCKS } from '../../lib/config';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.cream },
          headerTintColor: colors.navy,
          headerTitleStyle: { color: colors.navy },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="item/[id]" options={{ headerShown: true, title: 'Item' }} />
        <Stack.Screen name="add" options={{ headerShown: true, title: 'Add item', presentation: 'modal' }} />
        <Stack.Screen name="scan-product" options={{ headerShown: true, title: 'Scan product' }} />
        <Stack.Screen name="ask-thyme" options={{ headerShown: true, title: 'Ask Thyme' }} />
        <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings', presentation: 'modal' }} />
      </Stack>
      {USE_MOCKS && <MockDataBadge />}
    </View>
  );
}

function MockDataBadge() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.badge, { top: insets.top + 6 }]} pointerEvents="none">
      <Text style={styles.badgeText}>MOCK DATA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  badge: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#9a7d0a',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
