/**
 * Landing page — "Know the vibe before you walk in."
 *
 * Leads with a *live* pulse-strip demo (real backend data, breathing dots),
 * not a static screenshot, so the first thing you see is the product being
 * alive. Everything below reinforces liveness vs. stale star ratings.
 */

import React, { useMemo } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import { Logo } from '@/components/Logo';
import { PulseStripRow } from '@/components/PulseStripRow';
import { VibeMap } from '@/components/VibeMap';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from '@/hooks/useLocation';
import { useVenues } from '@/hooks/useVenues';
import { useLiveCount } from '@/hooks/useLiveCount';
import { DEFAULT_FILTERS } from '@/lib/types';

const isWeb = Platform.OS === 'web';

function useLandingData() {
  const location = useLocation();
  const venues = useVenues(location.coords, location.radiusM, DEFAULT_FILTERS);
  const live = useLiveCount();
  return { location, venues, live };
}

export default function Landing() {
  const { theme } = useTheme();
  const { user, mode, signOut } = useAuth();
  const { location, venues, live } = useLandingData();
  const { width } = useWindowDimensions();
  // Real viewport responsiveness (works on phones, tablets, resized browser
  // windows) — never branch layout on Platform alone.
  const wide = width >= 880;

  const heroRows = useMemo(() => {
    const scored = venues.visible.filter((v) => v.score.value !== null);
    const liveFirst = [...scored].sort((a, b) => Number(b.score.isLive) - Number(a.score.isLive));
    return liveFirst.slice(0, 3);
  }, [venues.visible]);

  const maxW = isWeb ? 960 : undefined;

  return (
    <Screen edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 64 }} showsVerticalScrollIndicator={!isWeb}>
        {/* header */}
        <View style={{ alignSelf: 'center', width: '100%', maxWidth: maxW, paddingHorizontal: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 18, paddingBottom: 8 }}>
            <Logo size={34} />
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 19, marginLeft: 10 }}>
              SpotCheck
            </Text>
            <View style={{ flex: 1 }} />
            {mode === 'demo' ? (
              <Text style={{ color: theme.faint, fontSize: 11, marginRight: 12 }}>demo mode</Text>
            ) : null}
            {user ? (
              <Pressable onPress={() => signOut()}>
                <Text style={{ color: theme.muted, fontSize: 13 }}>Sign out</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => router.push('/(auth)/login' as never)}>
                <Text style={{ color: theme.muted, fontSize: 13 }}>Sign in</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* hero */}
        <View
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: maxW,
            paddingHorizontal: 20,
            flexDirection: wide ? 'row' : 'column',
            alignItems: wide ? 'center' : 'stretch',
            gap: wide ? 40 : 24,
            paddingTop: 32,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.spectrum[0], fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>
              LIVE · CROWDSOURCED · DECAYS IN REAL TIME
            </Text>
            <Text
              style={{
                color: theme.text,
                fontFamily: 'SpaceGroteskBold',
                fontSize: wide ? 44 : 34,
                lineHeight: wide ? 48 : 40,
                letterSpacing: -1.5,
                marginTop: 10,
              }}
            >
              Know the vibe before you walk in.
            </Text>
            <Text style={{ color: theme.muted, fontSize: 16, lineHeight: 24, marginTop: 12 }}>
              Star ratings remember 2019. SpotCheck tells you what a place feels like{' '}
              <Text style={{ color: theme.text, fontWeight: '600' }}>right now</Text> — checked in at the
              door by people who are actually there.
            </Text>
            <Pressable
              onPress={() => router.push('/(app)' as never)}
              style={{
                marginTop: 22,
                backgroundColor: theme.spectrum[0],
                borderRadius: 14,
                paddingVertical: 15,
                paddingHorizontal: 22,
                alignSelf: wide ? 'flex-start' : 'stretch',
              }}
            >
              <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 16 }}>Check your first spot →</Text>
            </Pressable>
            <Text style={{ color: theme.faint, fontSize: 12, marginTop: 10 }}>
              No reviews to read. Two taps. Under ten seconds.
            </Text>
          </View>

          {/* live pulse-strip demo */}
          <View style={{ width: wide ? 380 : '100%' }}>
            <Text style={{ color: theme.muted, fontSize: 12, marginBottom: 8 }}>Happening near you</Text>
            {heroRows.length === 0 ? (
              <View style={{ backgroundColor: theme.card, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: theme.line }}>
                <Text style={{ color: theme.muted, fontSize: 13 }}>Listening for the first check-ins…</Text>
              </View>
            ) : (
              heroRows.map((v) => (
                <PulseStripRow key={v.id} venue={v} onPress={() => router.push(`/(app)/venue/${v.id}` as never)} />
              ))
            )}
          </View>
        </View>

        {/* live counter */}
        <View
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: maxW,
            paddingHorizontal: 20,
            marginTop: 40,
          }}
        >
          <View
            style={{
              backgroundColor: theme.card,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.line,
              paddingVertical: 22,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 34, letterSpacing: -1 }}>
              {live.loading ? '—' : live.count.toLocaleString()}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 13 }}>vibe checks today · ticking live</Text>
          </View>
        </View>

        {/* how it works */}
        <Section title="How it works" theme={theme}>
          <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', gap: 12 }}>
            {[
              ['1', 'Check in', 'We verify you\u2019re at the door with a quick GPS grace-radius check. No check-ins from the couch.'],
              ['2', 'Tag the vibe', 'One tap on the red\u2194teal gauge. Optionally drop up to two flavor chips. No typing.'],
              ['3', 'See it live', 'Your dot joins the venue\u2019s pulse instantly, then decays over ~45 minutes so the score is always now.'],
            ].map(([n, h, b]) => (
              <View key={n} style={{ flex: 1, minWidth: wide ? 220 : undefined }}>
                <Text style={{ color: theme.spectrum[0], fontFamily: 'SpaceGroteskBold', fontSize: 26 }}>{n}</Text>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16, marginTop: 6 }}>{h}</Text>
                <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{b}</Text>
              </View>
            ))}
          </View>
        </Section>

        {/* why not reviews */}
        <Section title="Why not just reviews?" theme={theme}>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12 }}>
            <View style={{ flex: 1, backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.line, padding: 18 }}>
              <Text style={{ color: theme.faint, fontWeight: '700', fontSize: 13 }}>STAR RATINGS</Text>
              {['A lifetime average that forgets last night', 'Written later, by people who left', 'Gamed, scraped, and stale'].map(
                (t) => (
                  <Text key={t} style={{ color: theme.muted, fontSize: 14, lineHeight: 24, marginTop: 8 }}>
                    ✕  {t}
                  </Text>
                ),
              )}
            </View>
            <View style={{ flex: 1, backgroundColor: theme.card, borderRadius: 16, borderWidth: 1, borderColor: theme.spectrum[0], padding: 18 }}>
              <Text style={{ color: theme.spectrum[0], fontWeight: '700', fontSize: 13 }}>SPOTCHECK</Text>
              {['A decaying average that is always now', 'Tapped on the spot, verified by GPS', 'Crowdsourced, weighted toward this moment'].map(
                (t) => (
                  <Text key={t} style={{ color: theme.text, fontSize: 14, lineHeight: 24, marginTop: 8 }}>
                    ✓  {t}
                  </Text>
                ),
              )}
            </View>
          </View>
        </Section>

        {/* mini map teaser */}
        <Section title="Near you, right now" theme={theme}>
          <VibeMap
            venues={venues.visible.slice(0, 40)}
            center={location.coords}
            radiusM={location.radiusM}
            onSelect={(id) => router.push(`/(app)/venue/${id}` as never)}
            style={{ height: 240, borderWidth: 1, borderColor: theme.line }}
          />
          <Text style={{ color: theme.faint, fontSize: 12, marginTop: 8 }}>
            Works anywhere on Earth — discovery is just your coordinates plus a radius.
          </Text>
        </Section>

        {/* footer */}
        <View style={{ alignSelf: 'center', width: '100%', maxWidth: maxW, paddingHorizontal: 20, marginTop: 44 }}>
          <View style={{ backgroundColor: theme.spectrum[0], borderRadius: 20, padding: 26, alignItems: 'center' }}>
            <Text style={{ color: '#0B1114', fontFamily: 'SpaceGroteskBold', fontSize: 24, letterSpacing: -0.5 }}>
              The vibe is live. Are you?
            </Text>
            <Pressable
              onPress={() => router.push('/(app)' as never)}
              style={{ marginTop: 16, backgroundColor: '#0B1114', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 }}
            >
              <Text style={{ color: theme.spectrum[0], fontWeight: '700', fontSize: 15 }}>Check your first spot</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 22 }}>
            <Text style={{ color: theme.faint, fontSize: 12 }}>About</Text>
            <Text style={{ color: theme.faint, fontSize: 12 }}>Privacy</Text>
            <Text style={{ color: theme.faint, fontSize: 12 }}>Data: OpenStreetMap</Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, theme, children }: { title: string; theme: { text: string }; children: React.ReactNode }) {
  return (
    <View style={{ alignSelf: 'center', width: '100%', maxWidth: 960, paddingHorizontal: 20, marginTop: 44 }}>
      <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 22, letterSpacing: -0.5, marginBottom: 14 }}>
        {title}
      </Text>
      {/* Children arrange themselves responsively; the map teaser stacks full-width. */}
      <View style={{ flexDirection: 'column' }}>{children}</View>
    </View>
  );
}
