# ride-log

バイクの走行ルートと給油地点を記録して振り返るiPhoneアプリ（Expo / React Native）。仕様は [SPEC.md](SPEC.md)。

## 進み具合

| ステップ | 状態 |
| --- | --- |
| 準備：GitHubリポジトリ | 済み |
| 準備：Google Cloud（Maps SDK for iOS、Roads API、APIキー2つ） | 未（下の手順で手作業） |
| 準備：Firebaseプロジェクト | 未（下の手順で手作業。Step 4までに） |
| Step 1 記録だけ | 完了（2026-11-08 実機で43点、電池の減りは少ない） |
| Step 2 生の線を表示 | 完了（2026-11-08 実機で線と地図を確認） |
| Step 3 給油 | 完了（2026-11-11）。休憩（5分以上の停車）の自動表示と休憩メモも追加 |

## 準備（手作業が必要なもの）

### Google Cloud（Step 2までに）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト `ride-log` を作る（Firebaseと同じプロジェクトにすると管理が楽）
2. 「APIとサービス」→「ライブラリ」で **Maps SDK for iOS**、**Roads API**、**Places API (New)**（休憩メモの「近くのお店を探す」用）を有効化
3. 「認証情報」でAPIキーを2つ作る
   - **アプリ用**：アプリケーションの制限＝iOSアプリ、バンドルID `jp.spiraq.ridelog.dev`（開発用。正式版はSPIRAQアカウントで `jp.spiraq.ridelog`）。APIの制限＝Maps SDK for iOS と Places API (New)
   - **サーバー用**：APIの制限＝Roads API のみ。アプリには埋め込まない（Cloud Functionsのシークレットに置く）
4. 「お支払い」→「予算とアラート」で予算アラートを設定（例：月500円）
5. 「割り当て」で Roads API の1日あたりリクエスト上限を設定（例：200件/日）
6. 料金は課金設定前に [公式の料金表](https://developers.google.com/maps/billing-and-pricing/pricing) で確認

APIキーはリポジトリにコミットしない。アプリ用キーは GitHub のシークレット `GOOGLE_MAPS_IOS_API_KEY` に登録し、ビルド時に `app.config.js` が読み込む（`gh secret set GOOGLE_MAPS_IOS_API_KEY --repo satogy/ride-log`）。

### Firebase（Step 4までに）

1. [Firebase Console](https://console.firebase.google.com/) で上のGoogle Cloudプロジェクトを選んでFirebaseを追加
2. Firestore、Authentication（まずは匿名認証かAppleでサインイン）を有効化
3. Cloud Functionsを使うため Blaze プランに切り替え（上の予算アラートを先に設定しておく）

## Step 1 を iPhone で試す

バックグラウンドの位置記録は Expo Go では動かない。有料のApple Developerアカウントがない間は、JumpCamと同じく **GitHub上のMacで署名なしIPAを作り、Sideloadlyで自分のApple ID（無料）で署名して入れる**。

1. GitHubの [Actions → iOS build (unsigned IPA)](https://github.com/satogy/ride-log/actions/workflows/ios-build.yml) で「Run workflow」（手動実行のみ。macOSは無料枠の消費が大きいため）
2. 完了したら成果物 `ride-log-unsigned-ipa` をダウンロードして解凍し、`ride-log-unsigned.ipa` を取り出す
3. iPhoneをPCにつなぎ、Sideloadlyに `.ipa` をドラッグ、Apple IDを入れて Start。**Advanced Options の「Use automatic bundle ID」はチェックを入れたまま**にする。実際のバンドルIDは `jp.spiraq.ridelog.dev.JM8MNRSL29`（末尾はApple IDごとに固定）で、毎回同じIDなので上書きになり走行データは残る。Google Mapsのアプリ用キーのiOS制限にはこのIDを登録しておく（違うIDで入れると別アプリ扱いになり、データが引き継がれず地図も真っ白になる）。万一IDが変わったときは、アプリの「データをコピー」「データを貼り付け」で移せる
4. iPhoneの「設定 → 一般 → VPNとデバイス管理」で自分のApple IDを信頼、「プライバシーとセキュリティ → デベロッパモード」をオン

Releaseビルドなので開発サーバーは不要。無料のApple IDでは **7日で期限切れ**になるので、その都度Sideloadlyで入れ直す（データは上書きインストールなら残る）。

SPIRAQの法人アカウントが使えるようになったら、EASの開発ビルド（`eas.json` の `development`）に切り替える。

### 完了条件の確かめ方

1. 「出発」をタップ → 位置情報は「常に許可」を選ぶ
2. 画面をロックして近所を30分走る
3. アプリを開き、「記録した点」が増えていること、「終了」長押し後に一覧へ点数付きで残ることを確認（30分・時速30kmなら約15km ≒ 75点前後が目安）

## 記録の仕組み（Step 1）

- `src/recording.ts`：`expo-location` のバックグラウンド位置更新。精度 Balanced、200mごと、1分まとめ受け取り、`AutomotiveNavigation`
- `src/db.ts`：`expo-sqlite` に `rides` と `points` を保存
- 停車中の扱い：iOSの「自動一時停止（pausesUpdatesAutomatically）」は、止まった後にアプリ側で再開させる必要があり休憩後に記録が止まったままになるため使っていない。200mの距離フィルタで停車中は点が出ずアプリも起きないので、電池はほぼ使わない。走行時間（停車を除く）は Step 5 で点の時刻から計算する

## 開発コマンド

```bash
npx tsc --noEmit      # 型チェック
npx expo-doctor       # 依存関係の診断
```
