// app.json は環境変数を読めないため、APIキーはここで差し込む。
// キーはリポジトリに置かず、GitHub Actions のシークレット GOOGLE_MAPS_IOS_API_KEY から渡す。
module.exports = ({ config }) => {
  const iosKey = process.env.GOOGLE_MAPS_IOS_API_KEY;
  if (!iosKey) {
    console.warn('[app.config] GOOGLE_MAPS_IOS_API_KEY が未設定です。地図が表示されません。');
  }
  return {
    ...config,
    // 休憩メモの「近くのお店」検索（Places API）でも同じアプリ用キーを使う
    extra: { ...(config.extra ?? {}), googleIosApiKey: iosKey ?? '' },
    plugins: [...(config.plugins ?? []), ['react-native-maps', { iosGoogleMapsApiKey: iosKey ?? '' }]],
  };
};
