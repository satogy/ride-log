import * as SQLite from 'expo-sqlite';

// 走行中の点はすべて端末内のSQLiteに貯める（SPEC「電池を食わない記録方式」）。
// バックグラウンドタスクからも同じ接続を使うため、モジュール単位で1つだけ開く。

export type RideStatus = 'recording' | 'processing' | 'done';

export type Ride = {
  id: number;
  startedAt: number; // ms epoch
  endedAt: number | null;
  status: RideStatus;
};

export type RidePoint = {
  lat: number;
  lng: number;
  t: number; // ms epoch
  accuracy: number | null;
  speed: number | null; // m/s（取得できた場合のみ）
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('ridelog.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS rides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ride_id INTEGER NOT NULL REFERENCES rides(id),
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          t INTEGER NOT NULL,
          accuracy REAL,
          speed REAL
        );
        CREATE INDEX IF NOT EXISTS idx_points_ride ON points(ride_id, t);
        CREATE TABLE IF NOT EXISTS fuel_stops (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ride_id INTEGER NOT NULL REFERENCES rides(id),
          t INTEGER NOT NULL,
          lat REAL,
          lng REAL,
          accuracy REAL,
          liters REAL,
          price_yen INTEGER,
          is_full_tank INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_fuel_ride ON fuel_stops(ride_id, t);
        CREATE TABLE IF NOT EXISTS rest_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ride_id INTEGER NOT NULL REFERENCES rides(id),
          start_t INTEGER NOT NULL,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          kind TEXT,
          place_name TEXT,
          memo TEXT,
          updated_at INTEGER NOT NULL,
          UNIQUE (ride_id, start_t)
        );
      `);
      // 後から足した列（既に作られた表にも追加する）
      const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(rest_notes)');
      if (!cols.some((c) => c.name === 'place_id')) {
        await db.execAsync('ALTER TABLE rest_notes ADD COLUMN place_id TEXT');
      }
      return db;
    })();
  }
  return dbPromise;
}

type RideRow = { id: number; started_at: number; ended_at: number | null; status: RideStatus };

const toRide = (r: RideRow): Ride => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  status: r.status,
});

export async function createRide(startedAt: number): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO rides (started_at, status) VALUES (?, ?)',
    startedAt,
    'recording',
  );
  return res.lastInsertRowId;
}

export async function finishRide(rideId: number, endedAt: number): Promise<void> {
  const db = await getDb();
  // Step 4でクラウド処理が入るまでは、終了したらそのまま done にする
  await db.runAsync('UPDATE rides SET ended_at = ?, status = ? WHERE id = ?', endedAt, 'done', rideId);
}

export async function getActiveRide(): Promise<Ride | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RideRow>(
    "SELECT * FROM rides WHERE status = 'recording' ORDER BY id DESC LIMIT 1",
  );
  return row ? toRide(row) : null;
}

export async function insertPoints(rideId: number, points: RidePoint[]): Promise<void> {
  if (points.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of points) {
      await db.runAsync(
        'INSERT INTO points (ride_id, lat, lng, t, accuracy, speed) VALUES (?, ?, ?, ?, ?, ?)',
        rideId,
        p.lat,
        p.lng,
        p.t,
        p.accuracy,
        p.speed,
      );
    }
  });
}

export type RideSummary = Ride & { pointCount: number; lastPointAt: number | null; fuelCount: number };

export async function listRides(limit = 20): Promise<RideSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<
    RideRow & { point_count: number; last_point_at: number | null; fuel_count: number }
  >(
    `SELECT r.*,
            (SELECT COUNT(*) FROM points p WHERE p.ride_id = r.id) AS point_count,
            (SELECT MAX(t) FROM points p WHERE p.ride_id = r.id) AS last_point_at,
            (SELECT COUNT(*) FROM fuel_stops f WHERE f.ride_id = r.id) AS fuel_count
       FROM rides r ORDER BY r.id DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({
    ...toRide(r),
    pointCount: r.point_count,
    lastPointAt: r.last_point_at,
    fuelCount: r.fuel_count,
  }));
}

export async function getPoints(rideId: number): Promise<RidePoint[]> {
  const db = await getDb();
  return db.getAllAsync<RidePoint>(
    'SELECT lat, lng, t, accuracy, speed FROM points WHERE ride_id = ? ORDER BY t',
    rideId,
  );
}

// ---- 給油（Step 3） ----

export type FuelStop = {
  id: number;
  rideId: number;
  t: number;
  lat: number | null; // 位置の取得前・失敗時は null（給油の記録自体は残す）
  lng: number | null;
  accuracy: number | null;
  liters: number | null;
  priceYen: number | null;
  isFullTank: boolean;
};

type FuelRow = {
  id: number;
  ride_id: number;
  t: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  liters: number | null;
  price_yen: number | null;
  is_full_tank: number;
};

const toFuel = (r: FuelRow): FuelStop => ({
  id: r.id,
  rideId: r.ride_id,
  t: r.t,
  lat: r.lat,
  lng: r.lng,
  accuracy: r.accuracy,
  liters: r.liters,
  priceYen: r.price_yen,
  isFullTank: r.is_full_tank === 1,
});

export async function createFuelStop(rideId: number, t: number): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync('INSERT INTO fuel_stops (ride_id, t) VALUES (?, ?)', rideId, t);
  return res.lastInsertRowId;
}

export async function setFuelStopLocation(
  id: number,
  lat: number,
  lng: number,
  accuracy: number | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE fuel_stops SET lat = ?, lng = ?, accuracy = ? WHERE id = ?', lat, lng, accuracy, id);
}

export async function updateFuelStopDetails(
  id: number,
  details: { liters: number | null; priceYen: number | null; isFullTank: boolean },
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE fuel_stops SET liters = ?, price_yen = ?, is_full_tank = ? WHERE id = ?',
    details.liters,
    details.priceYen,
    details.isFullTank ? 1 : 0,
    id,
  );
}

export async function getFuelStop(id: number): Promise<FuelStop | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<FuelRow>('SELECT * FROM fuel_stops WHERE id = ?', id);
  return row ? toFuel(row) : null;
}

export async function listFuelStops(rideId: number): Promise<FuelStop[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<FuelRow>('SELECT * FROM fuel_stops WHERE ride_id = ? ORDER BY t', rideId);
  return rows.map(toFuel);
}

export async function deleteFuelStop(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM fuel_stops WHERE id = ?', id);
}

// ---- 休憩メモ ----
// 休憩そのものは点の並びから毎回計算する（rests.ts）。メモだけを「ライド＋止まった時刻」に結びつけて保存する。
// 将来ほかの人と共有できるよう、場所（緯度経度）と種類・店名もメモ側に持たせる。

export type RestKind = 'lunch' | 'cafe' | 'view' | 'break' | 'other';

export type RestNote = {
  rideId: number;
  startT: number;
  lat: number;
  lng: number;
  kind: RestKind | null;
  placeName: string | null;
  placeId: string | null; // Googleマップの候補から選んだときの place ID
  memo: string | null;
  updatedAt: number;
};

type RestNoteRow = {
  ride_id: number;
  start_t: number;
  lat: number;
  lng: number;
  kind: RestKind | null;
  place_name: string | null;
  place_id: string | null;
  memo: string | null;
  updated_at: number;
};

const toRestNote = (r: RestNoteRow): RestNote => ({
  rideId: r.ride_id,
  startT: r.start_t,
  lat: r.lat,
  lng: r.lng,
  kind: r.kind,
  placeName: r.place_name,
  placeId: r.place_id,
  memo: r.memo,
  updatedAt: r.updated_at,
});

export async function listRestNotes(rideId: number): Promise<RestNote[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RestNoteRow>('SELECT * FROM rest_notes WHERE ride_id = ? ORDER BY start_t', rideId);
  return rows.map(toRestNote);
}

export async function saveRestNote(note: Omit<RestNote, 'updatedAt'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO rest_notes (ride_id, start_t, lat, lng, kind, place_name, place_id, memo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (ride_id, start_t) DO UPDATE SET
       lat = excluded.lat, lng = excluded.lng, kind = excluded.kind, place_name = excluded.place_name,
       place_id = excluded.place_id, memo = excluded.memo, updated_at = excluded.updated_at`,
    note.rideId,
    note.startT,
    note.lat,
    note.lng,
    note.kind,
    note.placeName,
    note.placeId,
    note.memo,
    Date.now(),
  );
}

export async function deleteRestNote(rideId: number, startT: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM rest_notes WHERE ride_id = ? AND start_t = ?', rideId, startT);
}
