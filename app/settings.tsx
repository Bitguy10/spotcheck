/**
 * Settings — theme (Light / Dark / System), account, and data provenance.
 */

import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';

import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/hooks/useAuth';
import { THEME_OPTIONS } from '@/theme/tokens';
import { APP_VERSION } from '@/lib/config';

export default function Settings() {
  const { theme, preference, setPreference } = useTheme();
  const { user, signOut } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <Pressable onPress={() => router.back()} style={{ padding: 8, marginRight: 6 }}>
            <Text style={{ color: theme.muted, fontSize: 22 }}>‹</Text>
          </Pressable>
          <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 22 }}>Settings</Text>
        </View>

        {/* theme */}
        <Text style={{ color: theme.muted, fontSize: 12, letterSpacing: 1, marginBottom: 10 }}>APPEARANCE</Text>
        <View style={{ flexDirection: 'row', backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.line, padding: 4, gap: 4 }}>
          {THEME_OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => setPreference(opt.id)}
              style={{
                flex: 1,
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: 'center',
                backgroundColor: preference === opt.id ? theme.subtle : 'transparent',
                borderWidth: 1,
                borderColor: preference === opt.id ? theme.spectrum[0] : 'transparent',
              }}
            >
              <Text style={{ color: preference === opt.id ? theme.text : theme.muted, fontWeight: preference === opt.id ? '700' : '500', fontSize: 14 }}>
                {opt.label}
              </Text>
              <Text style={{ color: theme.faint, fontSize: 10, marginTop: 2 }}>{opt.hint}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
          The red↔teal vibe scale stays identical in both themes — a colour means the same thing everywhere.
        </Text>

        {/* account */}
        <Text style={{ color: theme.muted, fontSize: 12, letterSpacing: 1, marginTop: 28, marginBottom: 10 }}>ACCOUNT</Text>
        <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.line, padding: 16 }}>
          {user ? (
            <>
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>{user.email}</Text>
              <Pressable onPress={() => { signOut(); router.replace('/' as never); }} style={{ marginTop: 12 }}>
                <Text style={{ color: theme.spectrum[2], fontWeight: '600', fontSize: 14 }}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable onPress={() => router.push('/(auth)/login' as never)}>
                <Text style={{ color: theme.spectrum[0], fontWeight: '700', fontSize: 14 }}>Sign in</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/(auth)/signup' as never)}>
                <Text style={{ color: theme.muted, fontWeight: '600', fontSize: 14 }}>Create account</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={{ alignItems: 'center', marginTop: 36 }}>
          <Logo size={36} />
          <Text style={{ color: theme.faint, fontSize: 11, marginTop: 8 }}>SpotCheck {APP_VERSION}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
