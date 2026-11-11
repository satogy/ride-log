import * as Application from 'expo-application';
import Constants from 'expo-constants';
import type { RestKind } from './db';

// 休憩地点の近くのお店・場所を Google の Places API (New) の Nearby Search で探す。
// 料金がかかるので、休憩メモで「近くのお店を探す」を押したときだけ1回呼ぶ（自動では呼ばない）。
// キーはアプリ用（iOS制限つき）を使い、制限を通すためにバンドルIDをヘッダーで送る。

export type PlaceSuggestion = {
  id: string; // Google の place ID（将来の共有で同じお店をまとめるのに使う）
  name: string;
  typeLabel: string | null; // 例：「カフェ」「ラーメン屋」
  distanceM: number;
  kind: RestKind | null; // 種類の自動判定（ごはん・カフェなど）
};

type ApiPlace = {
  id: string;
  displayName?: { text: string };
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  location?: { latitude: number; longitude: number };
};

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function guessKind(types: string[]): RestKind | null {
  const has = (t: string) => types.includes(t);
  if (has('cafe') || has('coffee_shop') || has('tea_house') || has('bakery')) return 'cafe';
  if (has('restaurant') || has('food') || has('meal_takeaway') || types.some((t) => t.endsWith('_restaurant')))
    return 'lunch';
  if (
    has('tourist_attraction') ||
    has('park') ||
    has('scenic_spot') ||
    has('observation_deck') ||
    has('museum') ||
    has('shinto_shrine') ||
    has('buddhist_temple')
  )
    return 'view';
  if (has('rest_stop') || has('convenience_store') || has('parking') || has('gas_station')) return 'break';
  return null;
}

/** 休憩地点の近く（半径300m）のお店・場所を近い順に返す */
export async function searchNearbyPlaces(lat: number, lng: number): Promise<PlaceSuggestion[]> {
  const key = (Constants.expoConfig?.extra as { googleIosApiKey?: string } | undefined)?.googleIosApiKey;
  if (!key) throw new Error('APIキーが入っていないビルドです。');

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Ios-Bundle-Identifier': Application.applicationId ?? '',
      // 必要な項目だけ取る（取る項目で料金が決まる）
      'X-Goog-FieldMask': 'places.id,places.displayName,places.primaryType,places.primaryTypeDisplayName,places.types,places.location',
    },
    body: JSON.stringify({
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 300 } },
      rankPreference: 'DISTANCE',
      maxResultCount: 10,
      languageCode: 'ja',
      regionCode: 'JP',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403) {
      throw new Error(
        'Places API が使えません。Google Cloud で「Places API (New)」を有効にし、アプリ用キーのAPIの制限に追加してください。',
      );
    }
    throw new Error(`検索に失敗しました（${res.status}）：${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { places?: ApiPlace[] };
  return (json.places ?? [])
    .filter((p) => p.displayName?.text)
    .map((p) => ({
      id: p.id,
      name: p.displayName!.text,
      typeLabel: p.primaryTypeDisplayName?.text ?? null,
      distanceM: p.location ? Math.round(distanceM(lat, lng, p.location.latitude, p.location.longitude)) : 0,
      kind: guessKind([p.primaryType ?? '', ...(p.types ?? [])]),
    }));
}
