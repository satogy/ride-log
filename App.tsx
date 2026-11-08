import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { getActiveRide, listRides, RideSummary } from './src/db';
import { ensurePermissions, resumeIfRecording, startRide, stopRide } from './src/recording';
import RideMap from './src/RideMap';

// Step 1：記録だけ。ホーム（出発）と走行中（経過時間・終了）の2画面。
// 走行中も地図は描かない。点の数はアプリを開いている間だけ確認用に表示する。

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function App() {
  const [activeStartedAt, setActiveStartedAt] = useState<number | null>(null);
  const [rides, setRides] = useState<RideSummary[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [openRide, setOpenRide] = useState<RideSummary | null>(null);

  const refresh = useCallback(async () => {
    const active = await getActiveRide();
    setActiveStartedAt(active?.startedAt ?? null);
    setRides(await listRides());
  }, []);

  useEffect(() => {
    resumeIfRecording().then(refresh);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // 走行中の画面を開いている間だけ、経過時間を1秒ごと・点数を10秒ごとに更新
  useEffect(() => {
    if (activeStartedAt == null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(refresh, 10_000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [activeStartedAt, refresh]);

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perm = await ensurePermissions();
      if (!perm.ok) {
        Alert.alert('位置情報の許可が必要です', perm.reason);
        return;
      }
      await startRide();
      setNow(Date.now());
      await refresh();
    } catch (e) {
      Alert.alert('記録を開始できませんでした', String(e));
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopRide();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const current = rides.find((r) => r.status === 'recording');
  const past = rides.filter((r) => r.status !== 'recording');

  if (openRide && activeStartedAt == null) {
    return (
      <>
        <StatusBar style="dark" />
        <RideMap rideId={openRide.id} title={formatDate(openRide.startedAt)} onClose={() => setOpenRide(null)} />
      </>
    );
  }

  if (activeStartedAt != null) {
    return (
      <SafeAreaView style={[styles.container, styles.dark]}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.label}>記録中</Text>
          <Text style={styles.elapsed}>{formatDuration(now - activeStartedAt)}</Text>
          <Text style={styles.sub}>記録した点：{current?.pointCount ?? 0}</Text>
          {current?.lastPointAt ? (
            <Text style={styles.sub}>最後の点：{formatDate(current.lastPointAt)}</Text>
          ) : null}
        </View>
        <Pressable
          onLongPress={onStop}
          delayLongPress={1000}
          style={({ pressed }) => [styles.bigButton, styles.stopButton, pressed && styles.pressed]}
        >
          <Text style={styles.bigButtonText}>終了</Text>
          <Text style={styles.hint}>長押しで終了</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <Pressable
        onPress={onStart}
        disabled={busy}
        style={({ pressed }) => [styles.bigButton, styles.startButton, pressed && styles.pressed]}
      >
        <Text style={styles.bigButtonText}>出発</Text>
      </Pressable>
      <Text style={styles.sectionTitle}>これまでのライド</Text>
      <FlatList
        data={past}
        keyExtractor={(r) => String(r.id)}
        ListEmptyComponent={<Text style={styles.empty}>まだ記録がありません</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setOpenRide(item)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rowTitle}>{formatDate(item.startedAt)}</Text>
            <Text style={styles.rowSub}>
              {item.endedAt ? formatDuration(item.endedAt - item.startedAt) : '-'}・{item.pointCount}点 ›
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  dark: { backgroundColor: '#111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { color: '#f5a623', fontSize: 22, fontWeight: '600' },
  elapsed: { color: '#fff', fontSize: 72, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sub: { color: '#bbb', fontSize: 18, marginTop: 8 },
  bigButton: {
    height: 160,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
  },
  startButton: { backgroundColor: '#1f7a3a', marginTop: 48 },
  stopButton: { backgroundColor: '#b3261e' },
  pressed: { opacity: 0.7 },
  bigButtonText: { color: '#fff', fontSize: 48, fontWeight: '700' },
  hint: { color: '#fdd', fontSize: 16, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginTop: 24, marginBottom: 8 },
  empty: { color: '#888' },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ccc' },
  rowTitle: { fontSize: 16 },
  rowSub: { color: '#666', marginTop: 2 },
});
