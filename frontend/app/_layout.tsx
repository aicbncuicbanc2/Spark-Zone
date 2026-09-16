import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';

import { AppAlertHost } from '../components/AppAlertHost';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { useStoreVisitTracking } from '../lib/useStoreVisitTracking';
import '../lib/webFocusReset';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
        <AppAlertHost />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const { session, isLoading } = useAuth();
  // Only once signed in - the endpoint it polls is authenticated, and
  // there's no reason to ask for location before the user even has a
  // pantry to add nearby-store suggestions to.
  useStoreVisitTracking({ enabled: !!session });

  if (!isLoading) {
    SplashScreen.hide();
  } else {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
