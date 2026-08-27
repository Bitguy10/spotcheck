/**
 * Settings — appearance, discovery (area/radius/units), data controls,
 * account self-service, and attribution. Sign-out lives here only.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from '@/hooks/useLocation';
import { useFavorites } from '@/hooks/useFavorites';
import { THEME_OPTIONS } from '@/theme/tokens';
import { APP_VERSION } from '@/lib/config';
import { getBackend } from '@/data/backend';
import { RADIUS_OPTIONS, setPrefs, usePrefs } from '@/lib/prefs';

export default function Settings() {
  const { theme, preference, setPreference } = useTheme();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const favorites = useFavorites(user?.id ?? null);
  const prefs = usePrefs();

  const [busy, setBusy] = useState<null | 'pull' | 'purge' | 'password' | 'delete'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const section = (label: string) => (
    <Text style={{ color: theme.muted, fontSize: 12, letterSpacing: 1, marginTop: 28, marginBottom: 10 }}>
      {label}
    </Text>
  );
  const card: object = { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.line, padding: 16 };
  const rowBtn = (active: boolean): object => ({
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: active ? theme.spectrum[0] : theme.line,
    backgroundColor: active ? theme.subtle : 'transparent',
  });

  async function pull() {
    setBusy('pull');
    setNote(null);
    try {
      const backend = await getBackend();
      const r = await backend.syncFromOSM(location.coords, prefs.radiusM);
      setNote(`Pulled ${r.inserted} venue${r.inserted === 1 ? '' : 's'} for ${location.areaLabel}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Pull failed.');
    } finally {
      setBusy(null);
    }
  }

  async function purge() {
    setBusy('purge');
    setNote(null);
    try {
      const backend = await getBackend();
      const n = await backend.purgeCache(location.coords, prefs.radiusM);
      setNote(`Cleared ${n} unchecked cached venue${n === 1 ? '' : 's'} near you.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Clear failed.');
    } finally {
      setBusy(null);
    }
  }

  async function savePassword() {
    setNote(null);
    if (pw1.length < 6) return setNote('Password needs 6+ characters.');
    if (pw1 !== pw2) return setNote('Passwords don’t match.');
    setBusy('password');
    const backend = await getBackend();
    const r = await backend.changePassword(pw1);
    setBusy(null);
    if (r.ok) {
      setPw1('');
      setPw2('');
      setNote('Password updated.');
    } else {
      setNote(r.message ?? 'Could not update password.');
    }
  }

  async function deleteAccount() {
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy('delete');
    const backend = await getBackend();
    const r = await backend.deleteAccount();
    setBusy(null);
    if (r.ok) {
      router.replace('/' as never);
    } else {
      setNote(r.message ?? 'Could not delete the account.');
      setConfirmDelete(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <Pressable onPress={() => router.back()} style={{ padding: 8, marginRight: 6 }}>
            <Text style={{ color: theme.muted, fontSize: 22 }}>‹</Text>
          </Pressable>
          <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 22 }}>Settings</Text>
        </View>

        {/* appearance */}
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

        {/* discovery */}
        {section('DISCOVERY')}
        <View style={card}>
          <Text style={{ color: theme.text, fontSize: 14 }}>
            Area: <Text style={{ fontWeight: '700' }}>{location.areaLabel}</Text>
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {RADIUS_OPTIONS.map((r) => (
              <Pressable key={r} onPress={() => setPrefs({ radiusM: r })} style={rowBtn(prefs.radiusM === r)}>
                <Text style={{ color: prefs.radiusM === r ? theme.text : theme.muted, fontWeight: prefs.radiusM === r ? '700' : '500', fontSize: 13 }}>
                  {r / 1000} km
                </Text>
              </Pressable>
            ))}
            <View style={{ flex: 1 }} />
            {(['km', 'mi'] as const).map((u) => (
              <Pressable key={u} onPress={() => setPrefs({ units: u })} style={rowBtn(prefs.units === u)}>
                <Text style={{ color: prefs.units === u ? theme.text : theme.muted, fontWeight: prefs.units === u ? '700' : '500', fontSize: 13 }}>
                  {u}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 10 }}>
            Radius controls how far “near you” reaches; units apply to every distance in the app.
          </Text>
        </View>

        {/* data */}
        {section('DATA')}
        <View style={card}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={pull} disabled={busy !== null} style={rowBtn(false)}>
              <Text style={{ color: theme.spectrum[0], fontWeight: '600', fontSize: 13 }}>
                {busy === 'pull' ? 'Pulling…' : 'Re-pull my area'}
              </Text>
            </Pressable>
            <Pressable onPress={purge} disabled={busy !== null || !user} style={rowBtn(false)}>
              <Text style={{ color: theme.muted, fontWeight: '600', fontSize: 13 }}>
                {busy === 'purge' ? 'Clearing…' : 'Clear unchecked cache'}
              </Text>
            </Pressable>
          </View>
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 10 }}>
            Saved venues: {favorites.ready ? favorites.ids.length : '…'} · Venues come from OpenStreetMap and are cached
            server-side; clearing only removes unchecked cache rows near you.
          </Text>
        </View>

        {/* account */}
        {section('ACCOUNT')}
        <View style={card}>
          {user ? (
            <>
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>{user.email}</Text>
              <TextInput
                placeholder="New password (6+ characters)"
                placeholderTextColor={theme.faint}
                secureTextEntry
                value={pw1}
                onChangeText={setPw1}
                style={{ backgroundColor: theme.subtle, borderRadius: 10, borderWidth: 1, borderColor: theme.line, color: theme.text, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12 }}
              />
              <TextInput
                placeholder="Repeat new password"
                placeholderTextColor={theme.faint}
                secureTextEntry
                value={pw2}
                onChangeText={setPw2}
                style={{ backgroundColor: theme.subtle, borderRadius: 10, borderWidth: 1, borderColor: theme.line, color: theme.text, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8 }}
              />
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                <Pressable onPress={savePassword} disabled={busy !== null}>
                  <Text style={{ color: theme.spectrum[0], fontWeight: '700', fontSize: 14 }}>
                    {busy === 'password' ? 'Saving…' : 'Change password'}
                  </Text>
                </Pressable>
                <Pressable onPress={deleteAccount} disabled={busy !== null}>
                  <Text style={{ color: theme.spectrum[2], fontWeight: '600', fontSize: 14 }}>
                    {busy === 'delete' ? 'Deleting…' : confirmDelete ? 'Tap again to confirm' : 'Delete account'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => { signOut(); router.replace('/' as never); }}>
                  <Text style={{ color: theme.spectrum[2], fontWeight: '600', fontSize: 14 }}>Sign out</Text>
                </Pressable>
              </View>
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

        {/* about */}
        {section('ABOUT')}
        <View style={card}>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
            SpotCheck {APP_VERSION} · live, crowdsourced venue vibes. Map data © OpenStreetMap contributors, tiles ©
            Esri. Vibe scores decay over ~45 minutes and are always computed server-side. Your check-ins are tied to
            your account; deleting it removes them.
          </Text>
        </View>

        {note ? (
          <Text style={{ color: theme.spectrum[0], fontSize: 13, marginTop: 14 }}>{note}</Text>
        ) : null}

        <View style={{ alignItems: 'center', marginTop: 36 }}>
          <Logo size={36} />
          <Text style={{ color: theme.faint, fontSize: 11, marginTop: 8 }}>SpotCheck {APP_VERSION}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
