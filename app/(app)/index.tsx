/**
 * Dashboard — venue-first, pulse-strip.
 *
 * Mobile: a scrollable pulse strip with a list↔map toggle and a sticky,
 * location-aware "Check in here" bar.
 * Web: two columns — pulse strip left (~480px), a persistent colour-coded map
 * right. Both visible at once, no toggle needed.
 */

import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';

import { Logo } from '@/components/Logo';
import { PulseDot } from '@/components/PulseDot';
import { FilterRow } from '@/components/FilterRow';
import { PulseStripRow } from '@/components/PulseStripRow';
import { VibeMap } from '@/components/VibeMap';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/hooks/useAuth';
import { useLocation } from '@/hooks/useLocation';
import { useVenues } from '@/hooks/useVenues';
import { useFavorites } from '@/hooks/useFavorites';
import { getBackend } from '@/data/backend';
import { geocodePlace } from '@/data/overpass';
import { DEFAULT_FILTERS, type VenueFilters } from '@/lib/types';
import { usePrefs } from '@/lib/prefs';
import { formatDistanceShort, type LatLng } from '@/lib/geo';

const isWeb = Platform.OS === 'web';

export default function Dashboard() {
  const { user } = useAuth();
  // Each account gets a fresh dashboard instance — nothing from the
  // previous signed-in user (saved list, explore state, strip) can
  // survive a user switch while the nav stack keeps this screen mounted.
  return <DashboardInner key={user?.id ?? 'anon'} />;
}

function DashboardInner() {
  const { theme } = useTheme();
  const { mode, user } = useAuth();
  const location = useLocation();
  const [eventOpen, setEventOpen] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventTtl, setEventTtl] = useState(180);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventErr, setEventErr] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  // Two columns once there's room for both; below that, list/map toggle.
  // Width-based (not Platform) so a narrow browser window and a phone both
  // get the single-column, thumb-friendly layout.
  const wide = width >= 880;
  const [filters, setFilters] = useState<VenueFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const prefs = usePrefs();
  const [radiusOverride, setRadiusOverride] = useState<number | null>(null);
  const radiusM = radiusOverride ?? prefs.radiusM;
  const [explore, setExplore] = useState<(LatLng & { label: string; query: string }) | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const center = explore ?? location.coords;
  const favorites = useFavorites(user?.id ?? null);

  // While an explored area is active and the search box still holds the area
  // query, that text is a *place*, not a venue filter — don't let it hide the
  // venues we just pulled for that area. Editing the box re-enables filtering.
  const querySuppressed = !!explore && filters.query.trim() === explore.query;
  const effectiveFilters = querySuppressed ? { ...filters, query: '' } : filters;

  const { venues, visible, loading, error, refresh, syncFromOSM, syncing, syncNote } = useVenues(
    center,
    radiusM,
    effectiveFilters,
    user?.id ?? null,
  );

  async function explorePlace() {
    const q = filters.query.trim();
    if (!q) return;
    setExploring(true);
    setSearchNote(null);
    const g = await geocodePlace(q);
    setExploring(false);
    if (g) {
      setExplore({ ...g, query: q });
      setRadiusOverride(null);
    } else {
      setSearchNote(`Couldn’t find “${q}” on the map.`);
    }
  }

  const displayed = savedOnly ? visible.filter((v) => favorites.ids.includes(v.id)) : visible;

  const onPull = async () => {
    setSearchNote(null);
    await syncFromOSM();
  };

  // A little spice: a live vibe-mix strip summarising the current view.
  const mix = useMemo(() => {
    let chill = 0, mod = 0, hot = 0, quiet = 0, live = 0;
    for (const v of displayed) {
      const s = v.score;
      if (s.value == null) { quiet += 1; continue; }
      if (s.isLive) live += 1;
      if (s.value < 40) chill += 1;
      else if (s.value <= 70) mod += 1;
      else hot += 1;
    }
    return { chill, mod, hot, quiet, live };
  }, [displayed]);

  const nearest = useMemo(() => {
    let best = null as null | (typeof venues)[number];
    for (const v of venues) {
      if (!best || (v.distanceMeters ?? Infinity) < (best.distanceMeters ?? Infinity)) best = v;
    }
    return best;
  }, [venues]);

  // Sticky check-in only when you're genuinely standing next to a venue.
  const near = !!nearest && nearest.distanceMeters != null && nearest.distanceMeters <= 200;

  const openVenue = (id: string) => {
    setSelectedId(id);
    router.push(`/(app)/venue/${id}` as never);
  };

  const onCreateEvent = async () => {
    setEventErr(null);
    if (!user) {
      router.push('/(auth)/login' as never);
      return;
    }
    setEventBusy(true);
    const backend = await getBackend();
    const res = await backend.createEvent({ name: eventName, at: location.coords, ttlMinutes: eventTtl });
    setEventBusy(false);
    if (res.ok) {
      setEventOpen(false);
      setEventName('');
      refresh();
    } else {
      setEventErr(res.code === 'invalid_name' ? 'Give the event a name (2+ characters).' : 'Could not create the event.');
    }
  };

  const list = (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={theme.muted} />}
      showsVerticalScrollIndicator={!isWeb}
    >
      {explore ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Pressable
            onPress={() => { setExplore(null); setSearchNote(null); setFilters((f) => ({ ...f, query: '' })); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.spectrum[0], borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}
          >
            <Text style={{ color: theme.spectrum[0], fontSize: 12, fontWeight: '700' }}>↩︎ Back to {location.areaLabel}</Text>
          </Pressable>
          <Text style={{ color: theme.faint, fontSize: 11, flex: 1 }} numberOfLines={1}>Exploring {explore.label}</Text>
        </View>
      ) : null}
      {searchNote ? <Text style={{ color: theme.faint, fontSize: 12, marginBottom: 8 }}>{searchNote}</Text> : null}
      {syncNote ? <Text style={{ color: theme.faint, fontSize: 12, marginBottom: 8 }}>{syncNote}</Text> : null}

      {error && displayed.length === 0 && !loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <Logo size={40} animate={false} />
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 14, textAlign: 'center' }}>
            Couldn’t load places near you — check your connection.
          </Text>
          <Pressable onPress={refresh} style={{ marginTop: 12, backgroundColor: theme.spectrum[0], borderRadius: 12, paddingVertical: 10, paddingHorizontal: 22 }}>
            <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 13 }}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {error && displayed.length > 0 ? (
        <Text style={{ color: theme.faint, fontSize: 12, marginBottom: 8 }}>
          Couldn’t refresh just now — showing your saved list.
        </Text>
      ) : null}

      {loading && displayed.length === 0 ? (
        <View>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line, borderRadius: 18, padding: 14, marginBottom: 10 }}
            >
              <View style={{ height: 14, width: '60%', borderRadius: 7, backgroundColor: theme.line }} />
              <View style={{ height: 9, borderRadius: 5, backgroundColor: theme.line, marginTop: 12 }} />
              <View style={{ height: 10, width: '40%', borderRadius: 5, backgroundColor: theme.line, marginTop: 10 }} />
            </View>
          ))}
          <Text style={{ color: theme.faint, fontSize: 12, textAlign: 'center', marginTop: 4 }}>
            Reading the room near you…
          </Text>
        </View>
      ) : null}

      {displayed.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            {mix.live > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <PulseDot color={theme.spectrum[0]} size={8} breathing />
                <Text style={{ color: theme.spectrum[0], fontSize: 11, fontWeight: '700' }}>
                  {mix.live} live now
                </Text>
              </View>
            ) : (
              <Text style={{ color: theme.faint, fontSize: 11 }}>quiet right now — a check-in starts a vibe</Text>
            )}
            <Text style={{ color: theme.faint, fontSize: 11, marginLeft: 'auto' }}>
              {loading ? 'refreshing… · ' : ''}
              {displayed.length} place{displayed.length === 1 ? '' : 's'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: theme.line }}>
            {mix.chill > 0 ? <View style={{ flex: mix.chill, backgroundColor: theme.spectrum[0] }} /> : null}
            {mix.mod > 0 ? <View style={{ flex: mix.mod, backgroundColor: theme.spectrum[1] }} /> : null}
            {mix.hot > 0 ? <View style={{ flex: mix.hot, backgroundColor: theme.spectrum[2] }} /> : null}
            {mix.quiet > 0 ? <View style={{ flex: mix.quiet, backgroundColor: theme.faint, opacity: 0.35 }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
            {(
              [
                [theme.spectrum[0], 'chill', mix.chill, 1],
                [theme.spectrum[1], 'moderate', mix.mod, 1],
                [theme.spectrum[2], 'hot', mix.hot, 1],
                [theme.faint, 'quiet', mix.quiet, 0.5],
              ] as const
            ).map(([c, l, n, o]) => (
              <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c, opacity: o }} />
                <Text style={{ color: theme.faint, fontSize: 10 }}>
                  {n} {l}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {displayed.length === 0 && !loading && !error ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <Logo size={40} animate={false} />
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 14, textAlign: 'center' }}>
            Nothing within {Math.round(radiusM / 100) / 10} km {explore ? `around ${explore.label}` : 'around you'} yet.
          </Text>
          <Pressable onPress={syncFromOSM} style={{ marginTop: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 }} disabled={syncing}>
            <Text style={{ color: theme.spectrum[0], fontWeight: '600', fontSize: 13 }}>
              {syncing ? 'Pulling from OpenStreetMap…' : 'Pull venues from OpenStreetMap'}
            </Text>
          </Pressable>
          {radiusM < 5000 ? (
            <Pressable onPress={() => setRadiusOverride(5000)} style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 14 }}>
              <Text style={{ color: theme.muted, fontSize: 13 }}>Widen search to 5 km</Text>
            </Pressable>
          ) : null}
          {filters.query.trim() && !querySuppressed ? (
            <Pressable onPress={explorePlace} disabled={exploring} style={{ marginTop: 10, backgroundColor: theme.spectrum[0], borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                {exploring ? 'Finding…' : `Explore “${filters.query.trim()}”`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        displayed.map((v) => <PulseStripRow key={v.id} venue={v} onPress={() => openVenue(v.id)} />)
      )}
    </ScrollView>
  );

  const map = (
    <VibeMap
      venues={displayed.slice(0, 60)}
      center={center}
      radiusM={radiusM}
      selectedId={selectedId}
      onSelect={openVenue}
      style={{ flex: 1, borderWidth: 1, borderColor: theme.line, marginBottom: near ? 92 : 0 }}
    />
  );

  return (
    <Screen edges={['top']}>
      {/* header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Logo size={30} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 17 }}>SpotCheck</Text>
            <Text style={{ color: theme.muted, fontSize: 11 }} numberOfLines={1}>
              {explore ? `Exploring: ${explore.label}` : `Near you: ${location.areaLabel}`}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/settings' as never)} style={{ padding: 6 }}>
            <Text style={{ color: theme.muted, fontSize: 16 }}>⚙︎</Text>
          </Pressable>
        </View>

        {/* search */}
        <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 12, height: 42 }}>
          <Text style={{ color: theme.faint, marginRight: 8 }}>⌕</Text>
          <TextInput
            value={filters.query}
            onChangeText={(q) => setFilters((f) => ({ ...f, query: q }))}
            onSubmitEditing={explorePlace}
            returnKeyType="search"
            placeholder="Search venues, areas…"
            placeholderTextColor={theme.faint}
            style={{ flex: 1, color: theme.text, fontSize: 14 }}
          />
          {filters.query.trim() && !querySuppressed ? (
            <Pressable onPress={explorePlace} disabled={exploring} hitSlop={8}>
              <Text style={{ color: theme.spectrum[0], fontSize: 12, fontWeight: '700' }}>Explore ⏎</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* filters */}
      <FilterRow filters={filters} onChange={setFilters} />

      {/* saved toggle + create event (wave 2/3) */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
        <Pressable
          onPress={() => setEventOpen(true)}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: theme.spectrum[0] }}
        >
          <Text style={{ color: theme.spectrum[0], fontSize: 12, fontWeight: '700' }}>＋ Event</Text>
        </Pressable>
        <Pressable
          onPress={() => setSavedOnly((s) => !s)}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: savedOnly ? theme.spectrum[2] : theme.line,
            backgroundColor: savedOnly ? `${theme.spectrum[2]}18` : 'transparent',
          }}
        >
          <Text style={{ color: savedOnly ? theme.spectrum[2] : theme.muted, fontSize: 12, fontWeight: savedOnly ? '700' : '500' }}>
            ♥ Saved{favorites.ready ? ` · ${favorites.ids.length}` : ''}
          </Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={onPull}
          disabled={syncing}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.line,
            opacity: syncing ? 0.6 : 1,
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '500' }}>
            {syncing ? 'Pulling…' : '↻ Pull OSM'}
          </Text>
        </Pressable>
      </View>

      {/* body */}
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: 16, gap: 16 }}>
          <View style={{ width: Math.min(480, width * 0.44), maxHeight: '100%' }}>{list}</View>
          <View style={{ flex: 1 }}>{map}</View>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'center', paddingBottom: 8, gap: 8 }}>
            {(['list', 'map'] as const).map((m) => (
              <Pressable key={m} onPress={() => setView(m)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: view === m ? theme.spectrum[0] : theme.line }}>
                <Text style={{ color: view === m ? theme.spectrum[0] : theme.muted, fontSize: 12, fontWeight: view === m ? '700' : '500' }}>
                  {m === 'list' ? 'Pulse strip' : 'Map'}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flex: 1 }}>{view === 'list' ? list : map}</View>
        </>
      )}

      {/* sticky check-in bar — only when a venue is within ~200 m, so map controls stay clear */}
      {near && nearest ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 18, paddingTop: 10 }}>
          <Pressable
            onPress={() => router.push(`/(app)/checkin/${nearest.id}` as never)}
            style={{
              backgroundColor: theme.spectrum[2],
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
              Check in here · {nearest.name}
            </Text>
            <Text style={{ color: '#ffffffcc', fontSize: 12, marginTop: 2 }}>
              {formatDistanceShort(nearest.distanceMeters ?? 0, prefs.units)} away
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* create-event modal (wave 3) */}
      <Modal transparent visible={eventOpen} animationType="fade" onRequestClose={() => setEventOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable style={{ position: 'absolute', inset: 0 }} onPress={() => setEventOpen(false)} />
          <View style={{ width: '100%', maxWidth: 400, backgroundColor: theme.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: theme.line }}>
            <Text style={{ color: theme.text, fontFamily: 'SpaceGroteskBold', fontSize: 20 }}>Drop an event</Text>
            <Text style={{ color: theme.muted, fontSize: 13, marginTop: 6 }}>
              A pop-up, a set, a market. It lives on the map for a while, then vanishes.
            </Text>
            <TextInput
              value={eventName}
              onChangeText={setEventName}
              placeholder="Event name"
              placeholderTextColor={theme.faint}
              style={{ marginTop: 16, backgroundColor: theme.bg, borderRadius: 12, borderWidth: 1, borderColor: theme.line, color: theme.text, paddingHorizontal: 14, height: 46, fontSize: 15 }}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              {[60, 180, 360].map((t) => (
                <Pressable key={t} onPress={() => setEventTtl(t)} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: eventTtl === t ? theme.spectrum[0] : theme.line, backgroundColor: eventTtl === t ? theme.subtle : 'transparent' }}>
                  <Text style={{ color: eventTtl === t ? theme.text : theme.muted, fontSize: 13, textAlign: 'center', fontWeight: eventTtl === t ? '700' : '500' }}>
                    {t === 60 ? '1h' : t === 180 ? '3h' : '6h'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {eventErr ? <Text style={{ color: theme.spectrum[2], fontSize: 13, marginTop: 10 }}>{eventErr}</Text> : null}
            <Pressable disabled={eventBusy} onPress={onCreateEvent} style={{ marginTop: 18, backgroundColor: theme.spectrum[0], borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: eventBusy ? 0.7 : 1 }}>
              <Text style={{ color: '#0B1114', fontWeight: '700', fontSize: 15 }}>{eventBusy ? 'Dropping…' : 'Drop it here'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
