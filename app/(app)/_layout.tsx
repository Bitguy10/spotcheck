import React from 'react';
import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

export default function AppLayout() {
  const { theme } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="venue/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen
        name="checkin/[venueId]"
        options={{
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
