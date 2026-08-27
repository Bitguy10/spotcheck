/**
 * Shareable vibe card (wave 2) — a screenshot-friendly, always-dark brand card.
 * It encodes the venue's live vibe so a shared image is instantly readable.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Logo } from './Logo';
import { VibeMeter } from './VibeMeter';
import { PulseDot } from './PulseDot';
import { vibeColor, vibeLabel } from '@/lib/vibe';
import { relativeTime } from '@/lib/time';
import type { Venue } from '@/lib/types';
import type { VibeScore } from '@/lib/vibe';

type ShareCardProps = {
  venue: Venue;
  score: VibeScore;
};

export function ShareCard({ venue, score }: ShareCardProps) {
  const has = score.value !== null;
  const accent = has ? vibeColor(score.value, 'dark') : '#6B6F76';
  return (
    <View style={{ width: 320, borderRadius: 22, overflow: 'hidden', backgroundColor: '#12131A', borderWidth: 1, borderColor: '#2A2E3D' }}>
      <LinearGradient colors={['#4ECDC4', '#FFD166', '#FF5A5F']} start={[0, 0.5]} end={[1, 0.5]} style={{ height: 5 }} />
      <View style={{ padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Logo size={26} animate={false} />
          <Text style={{ color: '#F2F4F8', fontFamily: 'SpaceGroteskBold', fontSize: 15 }}>SpotCheck</Text>
          <View style={{ flex: 1 }} />
          {score.isLive ? <PulseDot color={accent} size={8} breathing /> : null}
        </View>

        <Text style={{ color: '#F2F4F8', fontFamily: 'SpaceGroteskBold', fontSize: 24, letterSpacing: -0.6, marginTop: 16 }} numberOfLines={1}>
          {venue.name}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10 }}>
          <Text style={{ color: accent, fontFamily: 'SpaceGroteskBold', fontSize: 46, letterSpacing: -2 }}>
            {has ? Math.round(score.value!) : '–'}
          </Text>
          <Text style={{ color: accent, fontWeight: '700', fontSize: 16 }}>{vibeLabel(score.value)}</Text>
        </View>

        <View style={{ marginTop: 14 }}>
          <VibeMeter value={has ? score.value : null} height={10} />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
          <Text style={{ color: '#8E939C', fontSize: 12 }}>
            {score.activeCheckins} active · {score.lastCheckinAt ? relativeTime(score.lastCheckinAt) : 'no recent check'}
          </Text>
          <Text style={{ color: '#8E939C', fontSize: 12 }}>know the vibe →</Text>
        </View>
      </View>
    </View>
  );
}

export default ShareCard;
