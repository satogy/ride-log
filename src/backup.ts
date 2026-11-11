import * as Clipboard from 'expo-clipboard';
import { getDb } from './db';

// 走行データの引っ越し用。全データをJSONにしてクリップボードへコピーし、別のアプリで貼り付けて読み込む。
// バンドルIDが変わると別アプリ扱いになり端末内のデータが引き継がれないため（Step 4のクラウド保存までのつなぎ）。

const FORMAT = 'ride-log-backup';
const VERSION = 1;

type RideRow = { id: number; started_at: number; ended_at: number | null; status: string };
type PointRow = {
  ride_id: number;
  lat: number;
  lng: number;
  t: number;
  accuracy: number | null;
  speed: number | null;
};
type FuelRow = {
  ride_id: number;
  t: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  liters: number | null;
  price_yen: number | null;
  is_full_tank: number;
};

type RestNoteRow = {
  ride_id: number;
  start_t: number;
  lat: number;
  lng: number;
  kind: string | null;
  place_name: string | null;
  memo: string | null;
  updated_at: number;
};

type Backup = {
  format: typeof FORMAT;
  version: number;
  exportedAt: number;
  rides: RideRow[];
  points: PointRow[];
  fuelStops: FuelRow[];
  restNotes?: RestNoteRow[]; // 休憩メモ（後から追加。古いコピーには無い）
};

/** 全データをクリップボードにコピーし、件数を返す */
export async function copyBackupToClipboard(): Promise<{
  rides: number;
  points: number;
  fuelStops: number;
  restNotes: number;
}> {
  const db = await getDb();
  const rides = await db.getAllAsync<RideRow>('SELECT id, started_at, ended_at, status FROM rides ORDER BY id');
  const points = await db.getAllAsync<PointRow>(
    'SELECT ride_id, lat, lng, t, accuracy, speed FROM points ORDER BY ride_id, t',
  );
  const fuelStops = await db.getAllAsync<FuelRow>(
    'SELECT ride_id, t, lat, lng, accuracy, liters, price_yen, is_full_tank FROM fuel_stops ORDER BY ride_id, t',
  );
  const restNotes = await db.getAllAsync<RestNoteRow>(
    'SELECT ride_id, start_t, lat, lng, kind, place_name, memo, updated_at FROM rest_notes ORDER BY ride_id, start_t',
  );
  const backup: Backup = {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    rides,
    points,
    fuelStops,
    restNotes,
  };
  await Clipboard.setStringAsync(JSON.stringify(backup));
  return { rides: rides.length, points: points.length, fuelStops: fuelStops.length, restNotes: restNotes.length };
}

/**
 * クリップボードのデータを読み込む。出発時刻が同じライドは取り込み済みとみなして飛ばす。
 * @returns 取り込んだライド数と、飛ばしたライド数
 */
export async function importBackupFromClipboard(): Promise<{ imported: number; skipped: number }> {
  const text = await Clipboard.getStringAsync();
  let backup: Backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('クリップボードに走行データがありません。先に古いアプリで「データをコピー」を押してください。');
  }
  if (backup?.format !== FORMAT || !Array.isArray(backup.rides)) {
    throw new Error('クリップボードの内容が走行データではありません。');
  }

  const db = await getDb();
  let imported = 0;
  let skipped = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const r of backup.rides) {
      const exists = await tx.getFirstAsync<{ id: number }>('SELECT id FROM rides WHERE started_at = ?', r.started_at);
      if (exists) {
        skipped++;
        continue;
      }
      // 記録中のまま書き出されたライドは、終了済みとして取り込む
      const endedAt = r.ended_at ?? backup.points.filter((p) => p.ride_id === r.id).at(-1)?.t ?? r.started_at;
      const res = await tx.runAsync(
        'INSERT INTO rides (started_at, ended_at, status) VALUES (?, ?, ?)',
        r.started_at,
        endedAt,
        'done',
      );
      const newId = res.lastInsertRowId;
      for (const p of backup.points) {
        if (p.ride_id !== r.id) continue;
        await tx.runAsync(
          'INSERT INTO points (ride_id, lat, lng, t, accuracy, speed) VALUES (?, ?, ?, ?, ?, ?)',
          newId,
          p.lat,
          p.lng,
          p.t,
          p.accuracy,
          p.speed,
        );
      }
      for (const f of backup.fuelStops ?? []) {
        if (f.ride_id !== r.id) continue;
        await tx.runAsync(
          'INSERT INTO fuel_stops (ride_id, t, lat, lng, accuracy, liters, price_yen, is_full_tank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          newId,
          f.t,
          f.lat,
          f.lng,
          f.accuracy,
          f.liters,
          f.price_yen,
          f.is_full_tank,
        );
      }
      for (const n of backup.restNotes ?? []) {
        if (n.ride_id !== r.id) continue;
        await tx.runAsync(
          'INSERT OR IGNORE INTO rest_notes (ride_id, start_t, lat, lng, kind, place_name, memo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          newId,
          n.start_t,
          n.lat,
          n.lng,
          n.kind,
          n.place_name,
          n.memo,
          n.updated_at,
        );
      }
      imported++;
    }
  });
  return { imported, skipped };
}
