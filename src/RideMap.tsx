import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { FuelStop, getPoints, listFuelStops, RidePoint } from './db';
import FuelForm from './FuelForm';
import { detectRests, movingMs } from './rests';

// Step 2：保存した生の点をそのまま線でつなぐ（道路吸着は Step 4）。
// Step 3：給油地点にピンを立てる。給油量・金額は下の一覧のボタンから入力・修正する。
// 休憩：5分以上の停車を青いピンで表示する（給油と重なる停車は給油として扱い、休憩ピンは出さない）。

function minutes(ms: number): number {
  return Math.round(ms / 60000);
}

function formatHm(ms: number): string {
  const m = minutes(ms);
  return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`;
}

function fuelDescription(f: FuelStop): string {
  const parts: string[] = [];
  if (f.liters != null) parts.push(`${f.liters}L`);
  if (f.priceYen != null) parts.push(`${f.priceYen.toLocaleString('ja-JP')}円`);
  if (parts.length === 0) return '量・金額は未入力';
  if (f.isFullTank) parts.push('満タン');
  return parts.join('・');
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function haversineKm(a: RidePoint, b: RidePoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function rawDistanceKm(points: RidePoint[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineKm(points[i - 1], points[i]);
  return d;
}

type Props = { rideId: number; title: string; onClose: () => void };

export default function RideMap({ rideId, title, onClose }: Props) {
  const [points, setPoints] = useState<RidePoint[] | null>(null);
  const [fuels, setFuels] = useState<FuelStop[]>([]);
  const [editingFuelId, setEditingFuelId] = useState<number | null>(null);
  const [selectedFuelId, setSelectedFuelId] = useState<number | null>(null);
  const mapRef = useRef<MapView>(null);

  const loadFuels = () => listFuelStops(rideId).then(setFuels);

  useEffect(() => {
    getPoints(rideId).then(setPoints);
    loadFuels();
  }, [rideId]);

  const coords = (points ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng }));
  const placedFuels = fuels.filter((f) => f.lat != null && f.lng != null);
  const totalLiters = fuels.reduce((s, f) => s + (f.liters ?? 0), 0);
  const totalYen = fuels.reduce((s, f) => s + (f.priceYen ?? 0), 0);
  const allStops = points ? detectRests(points, fuels) : [];
  const rests = allStops.filter((r) => !r.isFuel);
  const restMs = rests.reduce((s, r) => s + r.durationMs, 0);
  const moving = points ? movingMs(points, allStops) : 0;

  const fit = () => {
    const all = [...coords, ...placedFuels.map((f) => ({ latitude: f.lat!, longitude: f.lng! }))];
    if (all.length === 0) return;
    mapRef.current?.fitToCoordinates(all, {
      edgePadding: { top: 80, right: 40, bottom: 120 + fuels.length * 60, left: 40 },
      animated: false,
    });
  };

  return (
    <View style={styles.container}>
      {points == null ? (
        <ActivityIndicator style={styles.loading} size="large" />
      ) : coords.length === 0 ? (
        <Text style={styles.empty}>このライドには点がありません</Text>
      ) : (
        <MapView ref={mapRef} provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} onMapReady={fit}>
          <Polyline coordinates={coords} strokeColor="#d1495b" strokeWidth={4} />
          <Marker coordinate={coords[0]} title="出発" pinColor="green" />
          <Marker coordinate={coords[coords.length - 1]} title="終了" pinColor="red" />
          {placedFuels.map((f) => (
            <Marker
              key={f.id}
              coordinate={{ latitude: f.lat!, longitude: f.lng! }}
              title={`給油 ${hhmm(f.t)}`}
              pinColor={selectedFuelId === f.id ? 'gold' : 'orange'}
              onPress={() => setSelectedFuelId(f.id)}
            />
          ))}
          {rests.map((r) => (
            <Marker
              key={`rest-${r.startT}`}
              coordinate={{ latitude: r.lat, longitude: r.lng }}
              title={`休憩 ${hhmm(r.startT)}〜${hhmm(r.endT)}`}
              description={`約${minutes(r.durationMs)}分`}
              pinColor="blue"
            />
          ))}
        </MapView>
      )}

      <FuelForm
        fuelId={editingFuelId}
        onClose={() => {
          setEditingFuelId(null);
          loadFuels();
        }}
      />

      <View style={styles.header} pointerEvents="box-none">
        <Pressable onPress={onClose} style={styles.back}>
          <Text style={styles.backText}>‹ 戻る</Text>
        </Pressable>
      </View>

      {points && points.length > 0 ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{title}</Text>
          <Text style={styles.panelSub}>
            {points.length}点・直線つなぎの距離 {rawDistanceKm(points).toFixed(1)} km
          </Text>
          <Text style={styles.panelSub}>
            走行 {formatHm(moving)}
            {rests.length > 0 ? `・休憩 ${rests.length}回（計${minutes(restMs)}分）` : ''}
          </Text>
          {fuels.length > 0 ? (
            <Text style={styles.panelSub}>
              給油 {fuels.length}回
              {totalLiters > 0 ? `・${Math.round(totalLiters * 10) / 10}L` : ''}
              {totalYen > 0 ? `・${totalYen.toLocaleString('ja-JP')}円` : ''}
            </Text>
          ) : null}
          {/* 地図の吹き出しはiOSのGoogleマップで押せないことがあるため、給油はここに一覧で出して入力ボタンを置く */}
          {fuels.map((f) => (
            <View key={f.id} style={[styles.fuelRow, selectedFuelId === f.id && styles.fuelRowSelected]}>
              <Pressable style={styles.fuelInfo} onPress={() => setSelectedFuelId(f.id)}>
                <Text style={styles.fuelTime}>
                  ⛽ {hhmm(f.t)}
                  {f.lat == null ? '（位置なし）' : ''}
                </Text>
                <Text style={styles.fuelDesc}>{fuelDescription(f)}</Text>
              </Pressable>
              <Pressable
                onPress={() => setEditingFuelId(f.id)}
                style={({ pressed }) => [styles.fuelEdit, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.fuelEditText}>{f.liters == null && f.priceYen == null ? '入力' : '修正'}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  loading: { flex: 1 },
  empty: { flex: 1, textAlign: 'center', textAlignVertical: 'center', marginTop: 200, color: '#666' },
  header: { position: 'absolute', top: 56, left: 16 },
  back: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  backText: { fontSize: 18, fontWeight: '600' },
  panel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 40,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  panelTitle: { fontSize: 18, fontWeight: '700' },
  panelSub: { color: '#555', marginTop: 4, fontSize: 15 },
  fuelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
  },
  fuelRowSelected: { backgroundColor: '#fff4e0', borderRadius: 8 },
  fuelInfo: { flex: 1 },
  fuelTime: { fontSize: 16, fontWeight: '600' },
  fuelDesc: { color: '#555', marginTop: 2 },
  fuelEdit: { backgroundColor: '#e07a00', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  fuelEditText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
