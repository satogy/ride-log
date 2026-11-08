import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { deleteFuelStop, getFuelStop, updateFuelStopDetails } from './db';

// 給油入力（SPEC「給油入力」画面）。給油量・金額は空欄でもよく、地点と時刻は残る。後から地図のピンを押して入力・修正できる。

type Props = {
  fuelId: number | null; // null のとき非表示
  onClose: (changed: boolean) => void;
};

function parseNumber(s: string): number | null {
  const n = Number(s.replace(/[,，\s]/g, '').replace('．', '.'));
  return s.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
}

export default function FuelForm({ fuelId, onClose }: Props) {
  const [liters, setLiters] = useState('');
  const [price, setPrice] = useState('');
  const [fullTank, setFullTank] = useState(true);

  useEffect(() => {
    if (fuelId == null) return;
    getFuelStop(fuelId).then((f) => {
      setLiters(f?.liters != null ? String(f.liters) : '');
      setPrice(f?.priceYen != null ? String(f.priceYen) : '');
      setFullTank(f?.isFullTank ?? true);
    });
  }, [fuelId]);

  if (fuelId == null) return null;

  const save = async () => {
    const l = parseNumber(liters);
    const p = parseNumber(price);
    await updateFuelStopDetails(fuelId, {
      liters: l,
      priceYen: p != null ? Math.round(p) : null,
      isFullTank: fullTank,
    });
    onClose(true);
  };

  const remove = () => {
    Alert.alert('この給油記録を削除しますか？', '地点も含めて消えます。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteFuelStop(fuelId);
          onClose(true);
        },
      },
    ]);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>給油</Text>
          <Text style={styles.note}>地点と時刻は記録済みです。量と金額は空欄のままでも、あとで入力できます。</Text>

          <Text style={styles.label}>給油量（L）</Text>
          <TextInput
            style={styles.input}
            value={liters}
            onChangeText={setLiters}
            keyboardType="decimal-pad"
            placeholder="例：12.5"
            returnKeyType="done"
          />

          <Text style={styles.label}>金額（円）</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            keyboardType="number-pad"
            placeholder="例：2100"
            returnKeyType="done"
          />

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>満タン</Text>
            <Switch value={fullTank} onValueChange={setFullTank} />
          </View>
          <Text style={styles.note}>燃費は「満タンから満タンまで」で計算します。</Text>

          <Pressable onPress={save} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>保存</Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable onPress={() => onClose(false)} style={styles.secondary}>
              <Text style={styles.secondaryText}>あとで入力</Text>
            </Pressable>
            <Pressable onPress={remove} style={styles.secondary}>
              <Text style={[styles.secondaryText, styles.danger]}>削除</Text>
            </Pressable>
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
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 22,
    marginTop: 6,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  switchLabel: { fontSize: 18, fontWeight: '600' },
  primary: {
    backgroundColor: '#e07a00',
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
