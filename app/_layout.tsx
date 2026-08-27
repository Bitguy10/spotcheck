import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';

import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { AuthProvider } from '@/hooks/useAuth';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Shell() {
  const { theme } = useTheme();
  const [loaded] = useFonts({
    SpaceGrotesk: SpaceGrotesk_600SemiBold,
    SpaceGroteskBold: SpaceGrotesk_700Bold,
    Inter: Inter_400Regular,
    InterMedium: Inter_500Medium,
    InterSemiBold: Inter_600SemiBold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);

  // Match the document shell to the theme on web so overscroll never flashes.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = theme.bg;
    }
  }, [theme.bg]);

  // Web self-updater: the SPA never refetches its own HTML, so a phone left
  // open across a deploy keeps running the old bundle and "fixed" bugs look
  // unfixed. Compare the served index.html bundle hash with the running one;
  // when a new build exists, reload exactly once.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;
    const current = [...document.querySelectorAll('script[src]')]
      .map((s) => s.getAttribute('src') ?? '')
      .find((src) => src.includes('/_expo/static/js/web/index-'));
    const curHash = current?.match(/index-([a-f0-9]+)\.js/)?.[1];
    if (!curHash) return;

    let done = false;
    const check = async () => {
      if (done) return;
      try {
        const res = await fetch(`${window.location.origin}/?sc-upd=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const latest = html.match(/index-([a-f0-9]+)\.js/)?.[1];
        if (latest && latest !== curHash) {
          done = true;
          const key = 'sc-updated-to';
          if (window.sessionStorage.getItem(key) !== latest) {
            window.sessionStorage.setItem(key, latest);
            window.location.reload();
          }
        }
      } catch {
        /* offline or blocked — keep running the current build */
      }
    };
    const t = setTimeout(() => void check(), 4000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!loaded) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
        animation: 'default',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="(auth)/login" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="(auth)/signup" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ThemeProvider>
  );
}
