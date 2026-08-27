/**
 * The shared shell: theme-aware background, safe-area padding, and an
 * optional title row. Every screen sits on this so Light/Dark/System applies
 * everywhere with zero per-screen plumbing.
 */

import React from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';

type ScreenProps = {
  children: React.ReactNode;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
};

export function Screen({ children, edges = ['top', 'bottom'] }: ScreenProps) {
  const { theme } = useTheme();
  const Wrapper = Platform.OS === 'web' ? View : SafeAreaView;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />
      <Wrapper style={{ flex: 1 }}>{children}</Wrapper>
    </View>
  );
}

export default Screen;
