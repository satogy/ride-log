import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { deleteRestNote, listRestNotes, RestKind, saveRestNote } from './db';
import { PlaceSuggestion, searchNearbyPlaces } from './places';
import type { Rest } from './rests';

// 休憩メモ。どこで・何をしたか（ランチ、コーヒーなど）を残す。
// 将来ほかの人の参考にできるよう、種類・店や場所の名前・ひとことを分けて持つ。

export const REST_KINDS: { kind: RestKind; label: string; icon: string }[] = [
  { kind: 'lunch', label: 'ごはん', icon: '🍴' },
  { kind: 'cafe', label: 'カフェ', icon: '☕' },
  { kind: 'view', label: '景色・観光', icon: '📷' },
  { kind: 'break', label: 'ひと休み', icon: '🅿️' },
  { kind: 'other', label: 'その他', icon: '📝' },
];

export function kindInfo(kind: RestKind | null | undefined) {
  return REST_KINDS.find((k) => k.kind === kind);
}

type Props = {
  rideId: number;
  rest: Rest | null; // null のとき非表示
  onClose: (changed: boolean) => void;
};

export default function RestForm({ rideId, rest, onClose }: Props) {
  const [kind, setKind] = useState<RestKind | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [memo, setMemo] = useState('');
  const [hasNote, setHasNote] = useState(false);

  useEffect(() => {
    if (rest == null) return;
    listRestNotes(rideId).then((notes) => {
      const n = notes.find((x) => x.startT === rest.startT);
      setKind(n?.kind ?? null);
      setPlaceName(n?.placeName ?? '');
      setPlaceId(n?.placeId ?? null);
      setSuggestions(null);
      setMemo(n?.memo ?? '');
      setHasNote(n != null);
    });
  }, [rideId, rest]);

  if (rest == null) return null;

  const save = async () => {
    const p = placeName.trim();
    const m = memo.trim();
    if (kind == null && !p && !m) {
      if (hasNote) await deleteRestNote(rideId, rest.startT);
      onClose(hasNote);
      return;
    }
    await saveRestNote({
      rideId,
      startT: rest.startT,
      lat: rest.lat,
      lng: rest.lng,
      kind,
      placeName: p || null,
      placeId: p ? placeId : null,
      memo: m || null,
    });
    onClose(true);
  };

  const findNearby = async () => {
    setSearching(true);
    try {
      setSuggestions(await searchNearbyPlaces(rest.lat, rest.lng));
    } catch (e) {
      Alert.alert('近くのお店を探せませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const pick = (s: PlaceSuggestion) => {
    setPlaceName(s.name);
    setPlaceId(s.id);
    if (kind == null && s.kind) setKind(s.kind);
    setSuggestions(null);
  };

  const remove = () => {
    Alert.alert('このメモを消しますか？', '休憩の記録（場所と時間）は残ります。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: async () => {
          await deleteRestNote(rideId, rest.startT);
          onClose(true);
        },
      },
    ]);
  };

  const d = (ms: number) => {
    const t = new Date(ms);
    return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>休憩メモ</Text>
          <Text style={styles.note}>
            {d(rest.startT)}〜{d(rest.endT)}（約{Math.round(rest.durationMs / 60000)}分）
          </Text>

          <Text style={styles.label}>何をした？</Text>
          <View style={styles.chips}>
            {REST_KINDS.map((k) => (
              <Pressable
                key={k.kind}
                onPress={() => setKind(kind === k.kind ? null : k.kind)}
                style={[styles.chip, kind === k.kind && styles.chipOn]}
              >
                <Text style={[styles.chipText, kind === k.kind && styles.chipTextOn]}>
                  {k.icon} {k.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>お店・場所の名前</Text>
          <TextInput
            style={styles.input}
            value={placeName}
            onChangeText={(t) => {
              setPlaceName(t);
              setPlaceId(null); // 手で直したら候補との結びつきは外す
            }}
            placeholder="例：道の駅〇〇、△△食堂"
            returnKeyType="done"
          />
          {suggestions == null ? (
            <Pressable onPress={findNearby} disabled={searching} style={styles.nearbyButton}>
              {searching ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.nearbyText}>📍 近くのお店をGoogleマップから探す</Text>
              )}
            </Pressable>
          ) : suggestions.length === 0 ? (
            <Text style={styles.note}>近く（300m以内）に候補が見つかりませんでした。</Text>
          ) : (
            <ScrollView style={styles.suggestList} keyboardShouldPersistTaps="handled">
              {suggestions.map((s) => (
                <Pressable key={s.id} onPress={() => pick(s)} style={styles.suggestRow}>
                  <Text style={styles.suggestName}>{s.name}</Text>
                  <Text style={styles.suggestSub}>
                    {[s.typeLabel, `${s.distanceM}m`].filter(Boolean).join('・')}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <Text style={styles.label}>ひとこと</Text>
          <TextInput
            style={[styles.input, styles.memo]}
            value={memo}
            onChangeText={setMemo}
            placeholder="例：海鮮丼がおいしい。バイク置き場あり"
            multiline
          />

          <Pressable onPress={save} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>保存</Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable onPress={() => onClose(false)} style={styles.secondary}>
              <Text style={styles.secondaryText}>やめる</Text>
            </Pressable>
            {hasNote ? (
              <Pressable onPress={remove} style={styles.secondary}>
                <Text style={[styles.secondaryText, styles.danger]}>メモを消す</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  title: { fontSize: 24, fontWeight: '700' },
  note: { color: '#666', marginTop: 6, fontSize: 14 },
  label: { fontSize: 16, fontWeight: '600', marginTop: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  chipOn: { backgroundColor: '#2a6fdb', borderColor: '#2a6fdb' },
  chipText: { fontSize: 16, color: '#333' },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
    marginTop: 6,
  },
  memo: { minHeight: 80, textAlignVertical: 'top' },
  nearbyButton: { marginTop: 8, paddingVertical: 10, alignItems: 'center', borderRadius: 12, backgroundColor: '#eef3fc' },
  nearbyText: { color: '#2a6fdb', fontSize: 16, fontWeight: '600' },
  suggestList: { maxHeight: 200, marginTop: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 12 },
  suggestRow: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  suggestName: { fontSize: 17 },
  suggestSub: { color: '#777', fontSize: 13, marginTop: 2 },
  primary: {
    backgroundColor: '#2a6fdb',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  secondary: { padding: 12 },
  secondaryText: { fontSize: 17, color: '#333' },
  danger: { color: '#b3261e' },
});
