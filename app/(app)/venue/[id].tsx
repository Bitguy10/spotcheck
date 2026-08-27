/**
 * Venue detail — the venue's own pulse.
 *
 * Big authoritative gauge up top (server-computed), an optional tag breakdown
 * once enough quick-tags exist, and a reverse-chronological mini-feed of recent
 * check-ins. The feed is secondary here by design — the venue is the page.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Logo } from '@/components/Logo';
import { PulseDot } from '@/components/PulseDot';
import { VibeMeter } from '@/components/VibeMeter';
import { ShareCard } from '@/components/ShareCard';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useVenueDetail } from '@/hooks/useVenueDetail';
import { useFavorites } from '@/hooks/useFavorites';
import { useLocation } from '@/hooks/useLocation';
import { useAuth } from '@/hooks/useAuth';
import { getBackend } from '@/data/backend';
import { distanceMeters, directionsUrl, formatDistanceShort, travelEtaMinutes } from '@/lib/geo';
import { usePrefs } from '@/lib/prefs';
import type { VibeHistory } from '@/lib/types';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
import { clockTime, relativeTime } from '@/lib/time';
import {
  MIN_CHECKINS_FOR_SCORE,
  insufficientDataCopy,
  vibeLabel,
} from '@/lib/vibe';
import type { Tag } from '@/lib/tags';

const CATEGORY_LABEL: Record<string, string> = {
  bar: 'Bar',
  pub: 'Pub',
  cafe: 'Café',
  restaurant: 'Restaurant',
  club: 'Club',
  event: 'Event',
  other: 'Place',
};

export default function VenueDetail() {
  const params = useLocalSearchParams<{ id: string }>();
  const { theme, vibeColor } = useTheme();
  const { user } = useAuth();
  const location = useLocation();
  const prefs = usePrefs();
  const favorites = useFavorites(user?.id ?? null);
  const { venue, score, checkins, loading } = useVenueDetail(params.id);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [travelMode, setTravelMode] = useState<'walk' | 'drive'>('walk');
  const [history, setHistory] = useState<VibeHistory | null>(null);

  const awayMeters = venue ? distanceMeters(location.coords, venue) : null;
  const openDirections = () => {
    if (!venue) return;
    Linking.openURL(directionsUrl({ lat: venue.lat, lng: venue.lng }, travelMode)).catch(() => undefined);
  };

  useEffect(() => {
    if (!params.id) return;
    let alive = true;
    getBackend()
      .then((b) => b.getHistory(params.id!))
      .then((h) => alive && setHistory(h))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [params.id]);

  const peakDay = useMemo(() => {
    if (!history) return null;
    let best = -1;
    let bestV = -1;
    history.byDay.forEach((v, i) => {
      if (v !== null && v > bestV) {
        bestV = v;
        best = i;
      }
    });
    return best >= 0 ? { index: best, value: bestV } : null;
  }, [history]);

  const hasScore = score.value !== null;
  const accent = hasScore ? vibeColor(score.value) : theme.faint;
  const saved = venue ? favorites.isSaved(venue.id) : false;

  const requireAuth = () => {
    if (!user) {
      router.push('/(auth)/login' as never);
      return false;
    }
    return true;
  };

  const onHeart = async () => {
    if (!venue) return;
    if (!requireAuth()) return;
    await favorites.toggle(venue.id);
  };

  const venueUrl = () => {
    const id = params.id ?? '';
    if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/venue/${id}`;
    return `spotcheck://venue/${id}`;
  };

  const onShare = async () => {
    if (!venue) return;
    const url = venueUrl();
    const text = `${venue.name} is ${vibeLabel(score.value)} right now on SpotCheck.`;
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        navigator.share({ title: venue.name, text, url }).catch(() => undefined);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
      setShareOpen(true);
    } else {
      setShareOpen(true);
    }
  };

  const nativeShare = () => {
    Share.share({ message: `${venue?.name} — ${vibeLabel(score.value)} right now. ${venueUrl()}` }).catch(() => undefined);
  };

  const copyLink = async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(venueUrl()).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  /* tag breakdown — only when there is enough tagged signal */
  const tagBreakdown = useMemo(() => {
    const counts = new Map<Tag, number>();
    let tagged = 0;
    for (const c of checkins) {
      if (c.tags.length) tagged++;
      for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (tagged < 3) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [checkins]);

  return (
    <Screen>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14 }}>
        <Pressable onPress={() => router.back()} style={{ padding: 8, marginRight: 4 }}>
          <Text style={{ color: theme.muted, fontSize: 20 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 19 }} numberOfLines={1}>
            {venue?.name ?? '…'}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {venue ? CATEGORY_LABEL[venue.category] : ''}
            {venue?.address ? ` · ${venue.address}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {score.isLive ? <PulseDot color={accent} size={10} breathing /> : null}
          <Pressable onPress={onHeart} testID="sc-save" style={{ padding: 8 }} accessibilityLabel={saved ? 'Remove from saved' : 'Save venue'}>
            <Text style={{ fontSize: 20, color: saved ? theme.spectrum[2] : theme.muted }}>{saved ? '♥' : '♡'}</Text>
          </Pressable>
          <Pressable onPress={onShare} testID="sc-share" style={{ padding: 8 }} accessibilityLabel="Share vibe card">
            <Text style={{ fontSize: 18, color: theme.muted }}>⤴</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} showsVerticalScrollIndicator={Platform.OS !== 'web'}>
        {/* the big gauge */}
        <View style={{ backgroundColor: theme.card, borderRadius: 22, borderWidth: 1, borderColor: theme.line, padding: 22, alignItems: 'center' }}>
          {loading ? (
            <Text style={{ color: theme.muted, fontSize: 14 }}>Reading the room…</Text>
          ) : hasScore ? (
            <>
              <Text style={{ color: accent, fontFamily: 'SpaceGroteskBold', fontSize: 58, letterSpacing: -2 }}>
                {Math.round(score.value!)}
              </Text>
              <Text style={{ color: accent, fontWeight: '700', fontSize: 17, marginTop: 2 }}>
                {vibeLabel(score.value)}
              </Text>
              <View style={{ width: '100%', marginTop: 18 }}>
                <VibeMeter value={score.value} height={12} dotSize={20} />
              </View>
              <Text style={{ color: theme.muted, fontSize: 12, marginTop: 14 }}>
                {score.activeCheckins} active check-in{score.activeCheckins === 1 ? '' : 's'} ·
                weighted toward the last {score.lastCheckinAt ? relativeTime(score.lastCheckinAt) : ''}
              </Text>
            </>
          ) : (
            <>
              <Logo size={44} animate={false} />
              <Text style={{ color: theme.muted, fontWeight: '600', fontSize: 16, marginTop: 12 }}>
                {insufficientDataCopy(score.activeCheckins)}
              </Text>
              <Text style={{ color: theme.faint, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                A venue publishes a vibe once at least {MIN_CHECKINS_FOR_SCORE} people have checked in
                within the decay window. Be one of them.
              </Text>
            </>
          )}
        </View>

        {/* historical pattern (wave 3) */}
        <View style={{ marginTop: 16, backgroundColor: theme.card, borderRadius: 18, borderWidth: 1, borderColor: theme.line, padding: 16 }}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>Typically</Text>
          {history && history.sampleSize >= 8 && peakDay ? (
            <>
              <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
                Usually <Text style={{ color: vibeColor(peakDay.value), fontWeight: '700' }}>{vibeLabel(peakDay.value)}</Text> on {DAY_LABELS[peakDay.index]}s · {history.sampleSize} check-ins
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
                {history.byDay.map((v, i) => (
                  <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ height: 26, width: '100%', borderRadius: 6, backgroundColor: v !== null ? vibeColor(v) : theme.track, opacity: v !== null ? 0.5 + (v / 200) : 0.4 }} />
                    <Text style={{ color: i === peakDay.index ? theme.text : theme.faint, fontSize: 9, marginTop: 4, fontWeight: i === peakDay.index ? '700' : '400' }}>
                      {DAY_LABELS[i][0]}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={{ color: theme.faint, fontSize: 13, marginTop: 6 }}>
              Not enough history yet — patterns appear as a place accumulates check-ins.
            </Text>
          )}
        </View>

        {/* tag breakdown */}
        {tagBreakdown ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>What people are saying</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {tagBreakdown.map(([tag, n]) => (
                <View key={tag} style={{ backgroundColor: theme.card, borderRadius: 999, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ color: theme.text, fontSize: 13 }}>
                    {tag} <Text style={{ color: theme.faint }}>· {n}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* recent check-ins mini-feed */}
        {/* getting there */}
        {venue ? (
          <View style={{ marginTop: 20, backgroundColor: theme.card, borderRadius: 22, borderWidth: 1, borderColor: theme.line, padding: 18 }}>
            <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>Getting there</Text>
            <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
              {venue.address ?? `${venue.lat.toFixed(4)}, ${venue.lng.toFixed(4)}`}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {awayMeters != null ? (
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                  {formatDistanceShort(awayMeters, prefs.units)} away
                </Text>
              ) : null}
              {awayMeters != null ? (
                <>
                  <Text style={{ color: theme.faint, fontSize: 13 }}>·</Text>
                  {(['walk', 'drive'] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setTravelMode(m)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: travelMode === m ? theme.spectrum[0] : theme.line,
                        backgroundColor: travelMode === m ? `${theme.spectrum[0]}18` : 'transparent',
                      }}
                    >
                      <Text style={{ color: travelMode === m ? theme.spectrum[0] : theme.muted, fontSize: 12, fontWeight: travelMode === m ? '700' : '500' }}>
                        {m === 'walk' ? '🚶' : '🚗'} ~{travelEtaMinutes(awayMeters, m)} min
                      </Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </View>
            <Pressable
              onPress={openDirections}
              style={{ marginTop: 14, backgroundColor: theme.spectrum[0], borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 14 }}>
                Directions{travelMode === 'walk' ? ' · walk' : ' · drive'} ↗
              </Text>
            </Pressable>
            <Text style={{ color: theme.faint, fontSize: 11, marginTop: 8 }}>
              Opens in Google Maps for turn-by-turn navigation.
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 20 }}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15, marginBottom: 10 }}>Recent check-ins</Text>
          {checkins.length === 0 ? (
            <Text style={{ color: theme.faint, fontSize: 13 }}>No one has checked in yet.</Text>
          ) : (
            checkins.slice(0, 12).map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: vibeColor(c.vibeValue) }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{vibeLabel(c.vibeValue)}</Text>
                  {c.tags.length ? <Text style={{ color: theme.muted, fontSize: 12 }}>{c.tags.join(' · ')}</Text> : null}
                </View>
                <Text style={{ color: theme.faint, fontSize: 12 }}>{relativeTime(c.createdAt)}</Text>
                <Text style={{ color: theme.faint, fontSize: 11 }}>{clockTime(c.createdAt)}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* check-in action */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 18, paddingTop: 10 }}>
        <Pressable
          onPress={() => router.push(`/(app)/checkin/${params.id}` as never)}
          style={{ backgroundColor: theme.spectrum[2], borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Check in here</Text>
        </Pressable>
      </View>

      {/* share modal */}
      <Modal transparent visible={shareOpen} animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable style={{ position: 'absolute', inset: 0 }} onPress={() => setShareOpen(false)} />
          {venue ? <ShareCard venue={venue} score={score} /> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Pressable onPress={copyLink} style={{ backgroundColor: theme.spectrum[0], borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18 }}>
              <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 14 }}>{copied ? 'Copied!' : 'Copy link'}</Text>
            </Pressable>
            {Platform.OS !== 'web' ? (
              <Pressable onPress={nativeShare} style={{ backgroundColor: theme.card, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, borderWidth: 1, borderColor: theme.line }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>Share…</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setShareOpen(false)} style={{ paddingVertical: 12, paddingHorizontal: 12 }}>
              <Text style={{ color: theme.muted, fontSize: 14 }}>Close</Text>
            </Pressable>
          </View>
          <Text style={{ color: theme.faint, fontSize: 11, marginTop: 10 }}>Screenshot the card to share the live vibe.</Text>
        </View>
      </Modal>
    </Screen>
  );
}
