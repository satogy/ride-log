import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { getPoints, RidePoint } from './db';

// Step 2：保存した生の点をそのまま線でつなぐ（道路吸着は Step 4）。

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
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    getPoints(rideId).then(setPoints);
  }, [rideId]);

  const coords = (points ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng }));

  const fit = () => {
    if (coords.length === 0) return;
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: 160, left: 40 },
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
        </MapView>
      )}

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
});
