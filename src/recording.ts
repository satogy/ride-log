import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import {
  createFuelStop,
  createRide,
  finishRide,
  getActiveRide,
  insertPoints,
  RidePoint,
  setFuelStopLocation,
} from './db';

export const LOCATION_TASK = 'ride-log-location';

// SPEC「設定値の初期案」。PoCで調整する。
export const RECORDING_CONFIG = {
  distanceIntervalM: 200, // 約200m動いたら1点（Roads APIは300m以内の間隔を推奨）
  deferredIntervalMs: 60_000, // 1分ごとにまとめて受け取る
};

// バックグラウンドでアプリが起動されたときにも登録済みである必要があるため、
// モジュールのトップレベルで定義する（index.ts の先頭で import している）。
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[location task]', error.message);
    return;
  }
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;

  const ride = await getActiveRide();
  if (!ride) return; // 記録中のライドがなければ捨てる（終了直後に届いた分など）

  const points: RidePoint[] = locations
    .filter((l) => l.timestamp >= ride.startedAt)
    .map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      t: l.timestamp,
      accuracy: l.coords.accuracy ?? null,
      speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    }));
  await insertPoints(ride.id, points);
});

export type PermissionResult = { ok: true } | { ok: false; reason: string };

export async function ensurePermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, reason: '位置情報が許可されていません。設定アプリで許可してください。' };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') {
    return {
      ok: false,
      reason: '画面オフで記録するには、設定アプリ → ride-log → 位置情報 を「常に」にしてください。',
    };
  }
  return { ok: true };
}

export async function startRide(): Promise<number> {
  const existing = await getActiveRide();
  const rideId = existing?.id ?? (await createRide(Date.now()));

  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: RECORDING_CONFIG.distanceIntervalM,
      deferredUpdatesDistance: RECORDING_CONFIG.distanceIntervalM,
      deferredUpdatesInterval: RECORDING_CONFIG.deferredIntervalMs,
      activityType: Location.ActivityType.AutomotiveNavigation,
      // iOSの自動一時停止は、止まったあと自動で再開しないため使わない。
      // 停車中は200mの距離フィルタで点が出ず、アプリも起きないので電池はほぼ使わない。
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'ride-log 記録中',
        notificationBody: '走行ルートを記録しています',
      },
    });
  }
  return rideId;
}

export async function stopRide(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  const ride = await getActiveRide();
  if (ride) await finishRide(ride.id, Date.now());
}

/** アプリ再起動時に、記録中のライドがあれば位置更新を確実に再開する */
export async function resumeIfRecording(): Promise<number | null> {
  const ride = await getActiveRide();
  if (!ride) return null;
  const perm = await Location.getBackgroundPermissionsAsync();
  if (perm.status === 'granted') await startRide();
  return ride.id;
}

// ---- 給油（Step 3） ----

const FUEL_FIX_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * 給油ボタン：記録はすぐ作り（入力画面をすぐ開けるように）、位置は高精度で取りに行って後から埋める。
 * 走行中の記録は省電力の Balanced だが、給油地点だけは High で1点取る。
 * @returns 作成した給油記録のID（記録中のライドがなければ null）
 */
export async function recordFuelStop(): Promise<number | null> {
  const ride = await getActiveRide();
  if (!ride) return null;
  const fuelId = await createFuelStop(ride.id, Date.now());

  (async () => {
    try {
      const fix = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        FUEL_FIX_TIMEOUT_MS,
      );
      const loc = fix ?? (await Location.getLastKnownPositionAsync());
      if (loc) {
        await setFuelStopLocation(fuelId, loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy ?? null);
      }
    } catch (e) {
      console.warn('[fuel] 位置を取得できませんでした', e);
    }
  })();

  return fuelId;
}
