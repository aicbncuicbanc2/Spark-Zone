import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { DevicePlatform } from './types';

// expo-notifications throws just from being imported when remote push isn't
// supported in the current environment (Android + Expo Go, since SDK 53 -
// see https://docs.expo.dev/versions/v57.0.0/sdk/notifications/). So it's
// loaded dynamically, only once this check has already ruled that out -
// a static top-level import would crash the whole app before this file's
// own guard ever got a chance to run.
//
// `appOwnership` is deprecated in favor of `executionEnvironment`, but the
// replacement can't tell Expo Go apart from a real expo-dev-client build
// (both report "storeClient") - only `appOwnership === 'expo'` identifies
// Expo Go specifically, which is exactly the distinction this needs: push
// should still work once this ships as a real dev client or standalone build.
const PUSH_UNSUPPORTED = Platform.OS === 'android' && Constants.appOwnership === 'expo';

/**
 * Gets an Expo push token for this device, or null if that isn't possible
 * right now. Every failure mode here is expected during development, not a
 * bug, so this never throws — callers just skip device registration:
 *  - no EAS project linked yet (no `extra.eas.projectId` in app config)
 *  - Android + Expo Go (remote push needs a dev client, per Expo's docs)
 *  - the user denied notification permission
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (PUSH_UNSUPPORTED) {
    console.warn(
      '[push] Expo Go on Android cannot use remote push (needs a dev client) — skipping.'
    );
    return null;
  }

  const Notifications = await import('expo-notifications');

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] Notification permission not granted — skipping device registration.');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn(
      '[push] No EAS project linked (app.json has no extra.eas.projectId) — cannot fetch an ' +
        'Expo push token yet. Run `eas init` once an Expo account is set up, then reinstall.'
    );
    return null;
  }

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (error) {
    console.warn('[push] Failed to get Expo push token:', (error as Error).message);
    return null;
  }
}

export function currentDevicePlatform(): DevicePlatform | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return null;
}
