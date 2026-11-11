import type { FuelStop, RidePoint } from './db';

// 休憩（5分以上の停車）の判定。
// 走行中は「200m動いたら1点」なので、止まっている間は点が来ない。
// そこで後から点の並びを見て、「次の点まで5分以上空いていて、しかも距離がほとんど離れていない」
// 区間を停車とみなす。端末内の点から計算するだけなので、過去のライドにもそのまま使える。
//
// 割り切り：
// - 場所は止まる直前の点（実際の停車位置から最大200mほどずれる）
// - トンネル等で位置が取れなかった区間は、距離が大きく離れるので休憩にしない
// - 200mに5分以上かかる大渋滞は休憩と判定されることがある

export const REST_MIN_MS = 5 * 60 * 1000;
// 停車判定で許す前後の点の距離。距離フィルタ200m＋位置のぶれ分の余裕
const REST_MAX_GAP_M = 500;

export type Rest = {
  lat: number;
  lng: number;
  startT: number; // 止まった時刻（目安：止まる直前の点の時刻）
  endT: number; // 走り出した時刻（目安：次の点の時刻）
  durationMs: number;
  isFuel: boolean; // この間に給油ボタンが押されていれば給油として扱う
};

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function detectRests(points: RidePoint[], fuels: FuelStop[] = []): Rest[] {
  const rests: Rest[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    const gap = next.t - prev.t;
    if (gap < REST_MIN_MS) continue;
    if (distanceM(prev, next) > REST_MAX_GAP_M) continue;
    const isFuel = fuels.some((f) => f.t >= prev.t && f.t <= next.t);
    rests.push({ lat: prev.lat, lng: prev.lng, startT: prev.t, endT: next.t, durationMs: gap, isFuel });
  }
  return rests;
}

/** 停車（休憩・給油）を除いた走行時間 */
export function movingMs(points: RidePoint[], rests: Rest[]): number {
  if (points.length < 2) return 0;
  const total = points[points.length - 1].t - points[0].t;
  return Math.max(0, total - rests.reduce((s, r) => s + r.durationMs, 0));
}
