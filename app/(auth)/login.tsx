/**
 * Sign in — email + password only. No magic link, no SMS OTP.
 */

import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/hooks/useAuth';

export default function Login() {
  const { theme } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok) router.replace('/(app)' as never);
    else setError(res.error);
  }

  const field = {
    backgroundColor: theme.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.line,
    color: theme.text,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
  } as const;

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', padding: 28 }}>
        <Logo size={44} />
        <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 28, letterSpacing: -1, marginTop: 18 }}>
          Welcome back
        </Text>
        <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
          Sign in to log vibe checks.
        </Text>

        <View style={{ marginTop: 26, gap: 12 }}>
          <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={theme.faint} autoCapitalize="none" keyboardType="email-address" style={field} />
          <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={theme.faint} secureTextEntry style={field} />
        </View>

        {error ? <Text style={{ color: theme.spectrum[2], fontSize: 13, marginTop: 12 }}>{error}</Text> : null}

        <Pressable disabled={busy} onPress={submit} style={{ marginTop: 20, backgroundColor: theme.spectrum[0], borderRadius: 14, paddingVertical: 15, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
          <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 16 }}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>

        <Pressable onPress={() => router.replace('/(auth)/signup' as never)} style={{ marginTop: 16, alignItems: 'center' }}>
          <Text style={{ color: theme.muted, fontSize: 14 }}>
            New here? <Text style={{ color: theme.spectrum[0], fontWeight: '700' }}>Create an account</Text>
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
