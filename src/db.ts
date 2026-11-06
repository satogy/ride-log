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
      `);
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

export type RideSummary = Ride & { pointCount: number; lastPointAt: number | null };

export async function listRides(limit = 20): Promise<RideSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RideRow & { point_count: number; last_point_at: number | null }>(
    `SELECT r.*, COUNT(p.id) AS point_count, MAX(p.t) AS last_point_at
       FROM rides r LEFT JOIN points p ON p.ride_id = r.id
      GROUP BY r.id ORDER BY r.id DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({ ...toRide(r), pointCount: r.point_count, lastPointAt: r.last_point_at }));
}

export async function getPoints(rideId: number): Promise<RidePoint[]> {
  const db = await getDb();
  return db.getAllAsync<RidePoint>(
    'SELECT lat, lng, t, accuracy, speed FROM points WHERE ride_id = ? ORDER BY t',
    rideId,
  );
}
