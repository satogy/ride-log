# ride-log

バイクの走行ルートと給油地点を記録して振り返るiPhoneアプリ（Expo / React Native）。仕様は [SPEC.md](SPEC.md)。

## 進み具合

| ステップ | 状態 |
| --- | --- |
| 準備：GitHubリポジトリ | 済み |
| 準備：Google Cloud（Maps SDK for iOS、Roads API、APIキー2つ） | 未（下の手順で手作業） |
| 準備：Firebaseプロジェクト | 未（下の手順で手作業。Step 4までに） |
| Step 1 記録だけ | 実装済み・実機テスト待ち |

## 準備（手作業が必要なもの）

### Google Cloud（Step 2までに）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト `ride-log` を作る（Firebaseと同じプロジェクトにすると管理が楽）
2. 「APIとサービス」→「ライブラリ」で **Maps SDK for iOS** と **Roads API** を有効化
3. 「認証情報」でAPIキーを2つ作る
   - **アプリ用**：アプリケーションの制限＝iOSアプリ、バンドルID `jp.spiraq.ridelog`。APIの制限＝Maps SDK for iOS のみ
   - **サーバー用**：APIの制限＝Roads API のみ。アプリには埋め込まない（Cloud Functionsのシークレットに置く）
4. 「お支払い」→「予算とアラート」で予算アラートを設定（例：月500円）
5. 「割り当て」で Roads API の1日あたりリクエスト上限を設定（例：200件/日）
6. 料金は課金設定前に [公式の料金表](https://developers.google.com/maps/billing-and-pricing/pricing) で確認

APIキーはリポジトリにコミットしない（`.env*.local` に置く。`.gitignore` 済み）。

### Firebase（Step 4までに）

1. [Firebase Console](https://console.firebase.google.com/) で上のGoogle Cloudプロジェクトを選んでFirebaseを追加
2. Firestore、Authentication（まずは匿名認証かAppleでサインイン）を有効化
3. Cloud Functionsを使うため Blaze プランに切り替え（上の予算アラートを先に設定しておく）

## Step 1 を iPhone で試す

バックグラウンドの位置記録は Expo Go では動かないため、**開発ビルド**をEASで作る（WindowsなのでXcode不要のクラウドビルド）。

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest device:create      # iPhoneを登録（表示されるQRをiPhoneで開く）
npx eas-cli@latest build --profile development --platform ios
```

ビルド完了後、表示されるQR/リンクからiPhoneにインストール。iPhoneの「設定 → プライバシーとセキュリティ → デベロッパモード」をオンにする必要がある。

その後、PCで開発サーバーを起動し、iPhoneの開発ビルドから接続する。

```bash
npx expo start
```

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
