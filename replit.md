# 水泳教室 振替予約システム

## プロジェクト概要

水泳教室の振替希望受付を管理するフルスタックWebアプリケーション。保護者が振替枠を検索・予約できます。満席の枠は予約不可として表示されます。

## 技術スタック

- **フロントエンド**: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **バックエンド**: Node.js + Express + TypeScript
- **データベース**: Drizzle ORM + SQLite/PostgreSQL
- **メール送信**: Resend API
- **フォント**: Noto Sans JP

## 主要機能

### 保護者向け画面（/）

1. **欠席連絡登録（ステップ1）**
   - 子どもの名前、クラス帯（初級/中級/上級）、欠席予定日、連絡用メールを入力
   - 欠席登録後は確認コードが発行され、予約確認やキャンセルに使用可能

2. **振替枠検索（ステップ2）**
   - 欠席情報をもとに欠席日の前後30日の範囲で振替可能枠を検索
   - 欠席連絡が完了していないと検索できないガードを実装

3. **候補一覧表示**
   - ○（残り2枠以上）：即時予約可能
   - △（残り1枠）：即時予約可能
   - ×（残り0枠）：満席（予約不可）

4. **即時予約**（○/△の枠）
   - クリック1つで振替予約が確定
   - 確定メールが送信される

### 管理画面（/admin）

1. **確定一覧タブ**
   - 確定済みの振替リクエストを一覧表示
   - 事務局が既存管理システムへ手入力するためのデータ

2. **レッスン状況タブ**
   - 日付を選択してその日のレッスン状況を確認
   - 欠席者・振替参加者を一覧表示

3. **欠席一覧タブ**
   - 登録済みの欠席と振替状況を一覧表示
   - 確認コード、振替期限、連絡先を確認可能

4. **枠管理タブ**
   - ClassSlot（レッスン枠）の作成・編集・削除機能
   - 日時、コース名、クラス帯、定員の設定

5. **コース管理タブ**
   - 通常コースの作成・編集・削除機能
   - 曜日、開始時刻の設定

## APIエンドポイント

### 保護者向け
- `POST /api/absences` - 欠席連絡の登録
- `GET /api/absences/:token` - 欠席情報の再開・確認
- `GET /api/class-slots` - 指定日のクラス枠の取得
- `POST /api/search-slots` - 振替候補検索
- `POST /api/book` - 即時予約
- `POST /api/cancel-absence` - 欠席キャンセル
- `GET /api/cancel/:token` - 予約キャンセル

### 管理画面向け
- `GET /api/admin/confirmed` - 確定リクエスト一覧取得
- `GET /api/admin/daily-lessons` - 日別レッスン状況取得
- `GET /api/admin/lesson-status` - レッスン詳細取得
- `POST /admin/update-slot-capacity` - 枠容量更新
- `GET /api/admin/slots` - 全ClassSlot取得
- `GET /api/admin/absences` - 欠席情報一覧取得
- `POST /api/admin/create-slot` - ClassSlot作成
- `PUT /api/admin/update-slot` - ClassSlot更新
- `DELETE /api/admin/delete-slot` - ClassSlot削除
- `POST /api/admin/courses` - コース作成
- `PUT /api/admin/courses/:id` - コース更新
- `DELETE /api/admin/courses/:id` - コース削除

## データモデル

### ClassSlot
- レッスン枠（日時、コース名、クラス帯、容量情報など）

### Request
- 振替リクエスト（子ども名、欠席日、振替先、ステータスなど）
- ステータス: 確定、却下、期限切れ

### Absence
- 欠席連絡（子ども名、欠席日、振替状況など）

### Course
- 通常コース（名前、曜日、開始時刻）

## 最近の変更

**2026-01-16**: タイムゾーン処理の統一
- **変更内容**:
  - サーバー起動時に `TZ=Asia/Tokyo` を設定し、すべての日付操作を日本時間で行うよう統一
  - 冗長な `+09:00` タイムゾーン指定を削除（二重変換を防止）
- **理由**: 日付がずれる問題（曜日のずれ、枠の重複キーエラー）を根本的に解決

**2026-01-12**: 順番待ち機能の完全削除
- **変更内容**:
  - 順番待ち（waitlist）機能を完全に削除
  - 満席の枠は「満席」と表示され、予約不可に変更
  - 関連するAPI、UI、スケジューラ処理を削除
  - `scripts/reconcileWaitlist.ts`、`waitlist-dialog.tsx`、`wait-decline.tsx` を削除
- **理由**: システムの簡素化と保守性向上

## プロジェクト構成

```
.
├── prisma/
│   ├── schema.prisma         # Prismaスキーマ定義
│   └── migrations/          # マイグレーションファイル
├── server/
│   ├── index.ts            # Expressサーバーエントリポイント
│   ├── routes.ts           # APIルート定義
│   ├── db.ts               # データベース接続
│   ├── storage.ts          # ストレージ層
│   ├── resend-client.ts    # Resend統合クライアント
│   ├── email-service.ts    # メール送信サービス
│   └── scheduler.ts        # スケジューラ（基本チェックのみ）
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── parent.tsx    # 保護者向け画面
│   │   │   ├── admin.tsx     # 管理画面
│   │   │   ├── status.tsx    # 予約確認画面
│   │   │   └── mypage.tsx    # マイページ
│   │   ├── components/
│   │   │   └── ui/           # shadcn/ui コンポーネント
│   │   └── App.tsx          # ルーティング設定
│   └── index.html
├── shared/
│   └── schema.ts           # 共有型定義・バリデーションスキーマ
└── replit.md              # このファイル
```

## 開発メモ

- Noto Sans JPフォントを使用した日本語対応
- ○/△/×のステータス表示でわかりやすいUI
- レスポンシブデザイン対応
- メールテンプレートはHTMLで美しくデザイン
