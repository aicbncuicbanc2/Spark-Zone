import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="item/[id]" options={{ headerShown: true, title: 'Item' }} />
      <Stack.Screen name="add" options={{ headerShown: true, title: 'Add item', presentation: 'modal' }} />
    </Stack>
  );
}
