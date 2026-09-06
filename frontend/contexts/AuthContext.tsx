import type { Session } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { registerDevice, unregisterDevice } from '../lib/dataSource';
import { currentDevicePlatform, getExpoPushToken } from '../lib/push';
import { supabase } from '../lib/supabase';

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Tracked so sign-out can unregister the same token — POST /v1/devices is
  // per-token, not per-user, so we need the exact value we registered with.
  const pushTokenRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
      if (data.session) registerPush();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'SIGNED_IN') registerPush();
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function registerPush() {
    const platform = currentDevicePlatform();
    if (!platform || platform === 'web') return;
    const token = await getExpoPushToken();
    if (!token) return;
    try {
      await registerDevice({
        fcm_token: token,
        platform,
        app_version: Constants.expoConfig?.version ?? null,
      });
      pushTokenRef.current = token;
    } catch (error) {
      console.warn('[push] Failed to register device:', (error as Error).message);
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    if (pushTokenRef.current) {
      // Best-effort — a failed unregister shouldn't block sign-out.
      await unregisterDevice(pushTokenRef.current).catch(() => {});
      pushTokenRef.current = null;
    }
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
