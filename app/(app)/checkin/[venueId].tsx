/**
 * The core loop — the entire required input is one tap on the gauge.
 *
 *   1. gate   → are you within the GPS grace radius? If not, a friendly gap
 *               visual (not a dead end). In demo mode there's a clearly
 *               labelled "I'm at the door" bypass; production never has one.
 *   2. tap    → venue name + full-width red↔teal gauge, no pre-fill.
 *   3. flavor → optional contextual chips, max 2, skippable.
 *   4. submit → optimistic, server-verified, then a toast and back.
 *
 * Minimum two taps, under ten seconds, zero text entry.
 */

import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { VibeGauge } from '@/components/VibeGauge';
import { TagChips } from '@/components/TagChips';
import { Logo } from '@/components/Logo';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from '@/hooks/useLocation';
import { getBackend } from '@/data/backend';
import { CHECKIN_GRACE_RADIUS_M, type VibeScore } from '@/lib/vibe';
import { distanceMeters, formatDistance } from '@/lib/geo';
import { tagsForVibe, type Tag } from '@/lib/tags';
import type { Venue } from '@/lib/types';

export default function CheckIn() {
  const params = useLocalSearchParams<{ venueId: string }>();
  const { theme, vibeColor } = useTheme();
  const { user, mode } = useAuth();
  const location = useLocation();

  const [venue, setVenue] = useState<Venue | null>(null);
  const [state, setState] = useState<'loading' | 'gate' | 'tap'>('loading');
  const [gapM, setGapM] = useState<number>(0);
  const [value, setValue] = useState(50);
  const [tapped, setTapped] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [bypass, setBypass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* resolve venue + gate */
  React.useEffect(() => {
    let alive = true;
    getBackend()
      .then(async (backend) => {
        const v = await backend.getVenue(params.venueId);
        if (!alive) return;
        setVenue(v);
        evaluate(v);
      })
      .catch(() => alive && setState('gate'));
    return () => {
      alive = false;
    };
  }, [params.venueId, location.coords.lat, location.coords.lng]);

  function evaluate(v: typeof venue) {
    if (!v) return setState('gate');
    const d = distanceMeters(location.coords, v);
    setGapM(d);
    if (d <= CHECKIN_GRACE_RADIUS_M || bypass) setState('tap');
    else setState('gate');
  }

  const chips = useMemo(() => tagsForVibe(value), [value]);

  async function submit() {
    if (!user) {
      router.push('/(auth)/login' as never);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const backend = await getBackend();
      const result = await backend.submitCheckin({
        venueId: params.venueId,
        vibeValue: value,
        tags,
        at: location.coords,
        bypassGate: mode === 'demo' && bypass,
      });
      if (result.ok) {
        setToast('Vibe logged — thanks for checking in');
        setTimeout(() => router.back(), 800);
      } else if (result.code === 'too_far') {
        setGapM(result.distanceMeters);
        setState('gate');
      } else if (result.code === 'auth_required') {
        router.push('/(auth)/login' as never);
      } else if (result.code === 'rate_limited') {
        setError('You\u2019ve checked in here a few times this hour \u2014 the vibe\u2019s already live.');
      } else {
        setError('Could not log that. Try again in a second.');
      }
    } catch {
      setError('Could not log that. Try again in a second.');
    } finally {
      setBusy(false);
    }
  }

  const gateProgress = Math.min(1, gapM / Math.max(1, CHECKIN_GRACE_RADIUS_M * 4));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={Platform.OS !== 'web'}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()} style={{ padding: 8, marginRight: 6 }}>
            <Text style={{ color: theme.muted, fontSize: 22 }}>×</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 1 }}>CHECK IN</Text>
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 20 }} numberOfLines={1}>
              {venue?.name ?? '…'}
            </Text>
          </View>
          <Logo size={30} animate={state === 'tap'} />
        </View>

        {state === 'gate' ? (
          <View style={{ marginTop: 30, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 24, textAlign: 'center' }}>
              Get closer to check in
            </Text>
            <Text style={{ color: theme.muted, fontSize: 15, marginTop: 8 }}>
              You're about <Text style={{ color: theme.spectrum[2], fontWeight: '700' }}>{formatDistance(gapM)}</Text> from {venue?.name ?? 'the venue'}.
            </Text>

            {/* the gap visual */}
            <View style={{ width: '100%', marginTop: 28, height: 44, justifyContent: 'center' }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.track, position: 'relative' }}>
                {/* grace radius band from the venue end */}
                <View style={{ position: 'absolute', right: 0, width: '25%', height: 6, borderRadius: 3, backgroundColor: `${theme.spectrum[0]}66` }} />
                {/* you */}
                <View style={{ position: 'absolute', left: `${gateProgress * 100}%`, top: -7, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.spectrum[2], borderWidth: 3, borderColor: theme.isDark ? theme.bg : '#fff' }} />
                {/* venue */}
                <View style={{ position: 'absolute', right: -4, top: -7, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.spectrum[0] }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: theme.faint, fontSize: 11 }}>you</Text>
                <Text style={{ color: theme.faint, fontSize: 11 }}>within {CHECKIN_GRACE_RADIUS_M}m ✓</Text>
              </View>
            </View>

            <Pressable onPress={() => location.refresh()} style={{ marginTop: 26, borderWidth: 1, borderColor: theme.line, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 }}>
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>Refresh my location</Text>
            </Pressable>

            {mode === 'demo' ? (
              <Pressable onPress={() => { setBypass(true); setState('tap'); }} style={{ marginTop: 14 }}>
                <Text style={{ color: theme.spectrum[0], fontSize: 13, fontWeight: '600' }}>
                  Demo mode: I'm at the door →
                </Text>
              </Pressable>
            ) : (
              <Text style={{ color: theme.faint, fontSize: 12, marginTop: 14 }}>
                Check-ins are verified at the door — no couch check-ins.
              </Text>
            )}
          </View>
        ) : state === 'tap' ? (
          <View style={{ marginTop: 30 }}>
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 24 }}>
              How's it feeling right now?
            </Text>
            <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
              One tap on the gauge. That's the whole input.
            </Text>

            <View style={{ marginTop: 22 }}>
              <VibeGauge value={value} showKnob={tapped} onChange={(v) => { setValue(v); setTapped(true); setTags([]); }} />
            </View>
            {!tapped ? <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8, textAlign: 'center' }}>← drag or tap the bar →</Text> : null}

            {/* optional flavor */}
            {tapped ? (
              <View style={{ marginTop: 22 }}>
                <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 10 }}>
                  Optional — add up to 2:
                </Text>
                <TagChips options={chips} selected={tags} accent={vibeColor(value)} onToggle={(t) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t].slice(0, 2)))} />
              </View>
            ) : null}
          </View>
        ) : (
          <Text style={{ color: theme.muted, marginTop: 40 }}>Loading venue…</Text>
        )}

        {error ? <Text style={{ color: theme.spectrum[2], marginTop: 16, fontSize: 13 }}>{error}</Text> : null}
      </ScrollView>

      {/* submit */}
      {state === 'tap' ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingBottom: 20, paddingTop: 10 }}>
          <Pressable
            testID="sc-checkin-submit"
            disabled={!tapped || busy}
            onPress={submit}
            style={{ backgroundColor: tapped ? vibeColor(value) : theme.line, borderRadius: 16, paddingVertical: 16, alignItems: 'center', opacity: tapped ? 1 : 0.6 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
              {busy ? 'Logging…' : user ? 'Check in' : 'Sign in to check in'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* toast */}
      {toast ? (
        <View style={{ position: 'absolute', left: 20, right: 20, bottom: 96, backgroundColor: theme.spectrum[0], borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 }}>
          <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 14 }}>{toast}</Text>
        </View>
      ) : null}
    </Screen>
  );
}
