# Threat Model

## Project Overview

保護者が欠席連絡と振替予約を行い、事務局が管理画面から枠・コース・欠席状況を管理する公開Webアプリケーション。バックエンドは Express/TypeScript、データ保存は PostgreSQL + Drizzle ORM、通知は Resend を利用する。デプロイは public な Replit Deployment で、インターネットから直接アクセス可能である。

## Assets

- **保護者・児童の個人情報** — 児童名、クラス帯、欠席日、連絡先メールアドレス、欠席理由。漏えいするとプライバシー侵害や子どもの行動情報の露出につながる。
- **予約・出欠データ** — 欠席連絡、振替予約、休講イベント、各枠の残数。改ざんや不正消費が起きると教室運営そのものに支障が出る。
- **管理者権限** — 管理画面から全出欠・連絡先・枠設定へアクセスできるため、侵害時の影響が大きい。
- **操作用トークン/コード** — `resumeToken`、`cancelToken`、`declineToken`、`confirmCode`、`sharedCode`。知っているだけで特定の操作が可能な bearer secret として扱う必要がある。
- **アプリケーション秘密情報** — `SESSION_SECRET`、`ADMIN_PASSWORD`、`DATABASE_URL`、`RESEND_API_KEY`。漏えいすると認証回避やデータ侵害につながる。

## Trust Boundaries

- **Browser → Public API** — `/api/absences`、`/api/search-slots`、`/api/book`、`/api/lookup/:confirmCode`、トークン付きキャンセル/辞退系 API。クライアントは信用せず、サーバーが入力・認可・業務制約を強制する必要がある。
- **Browser → Admin API** — `/api/admin/*` と一部 `/api/settings` / `/api/holidays` / `/admin/update-slot-capacity`。単一の管理セッション境界なので、認証突破の影響は全件閲覧・改ざんに直結する。
- **API → PostgreSQL** — 予約枠、欠席、連絡先、管理セッションを保持する。API 側の認可欠落や不正更新はそのまま永続化される。
- **API → Email service** — メール本文・リンク・トークンが外部配送される。誤ったリンク露出や HTML 注入は利用者への二次被害につながる。
- **Public surface → Bearer-token flows** — メールリンクと確認コードはログイン代替として振る舞うため、推測耐性・流出耐性・濫用検知が必要である。

## Scan Anchors

- Production entry points: `server/index.ts`, `server/routes.ts`
- Highest-risk code areas: public booking/status routes in `server/routes.ts`, admin session/login in `server/routes.ts`, persistence helpers in `server/storage.ts`, token/code schemas in `shared/schema.ts`
- Public surfaces: `/`, `/status`, `/absence`, token/code based public APIs
- Admin surfaces: `/admin`, `/api/admin/*`, `/api/settings`, `/api/holidays`, `/admin/update-slot-capacity`
- Dev-only areas usually out of scope: Vite dev server integration in `server/vite.ts`, unmounted client pages unless backed by reachable production routes

## Threat Categories

### Spoofing

管理画面は単一パスワード + セッションで保護され、保護者向け操作はログインの代わりにメールリンクや確認コードへ依存している。したがって、管理ログインへの総当たり、推測可能なコード、漏えいしたトークンの再利用を前提に考える必要がある。管理 API は毎回有効な管理セッションを要求し、保護者向けの token/code は十分に高エントロピーで、推測試行に対して回数制限や監視が必要である。

### Tampering

予約成立、欠席登録、枠の消費、休講コード利用上限は全てサーバー側で一貫して検証しなければならない。UI 上の「欠席登録後でないと検索・予約できない」といった導線だけに依存すると、API 直接呼び出しで不正予約や枠消費が成立する。サーバーは every state transition について前提条件を再検証し、クライアント任せの業務ルールを置かないこと。

### Information Disclosure

確認コード・共有コード・メールリンクは、正しく扱わないと児童名、欠席日、連絡先、予約状況などの機微情報へ直結する。公開 API は必要最小限の項目だけを返し、確認コードやトークンで照会する API には総当たり耐性が必要である。管理 API とエラーメッセージも、不要な内部情報や生データを返してはならない。

### Denial of Service

公開 API からの大量登録、総当たり検索、無認可の枠消費、管理ログインへの反復試行は、可用性と業務継続性を直接損なう。特に `book`、`lookup`、`admin/login` のような状態変更・照会 API はレート制限、前提条件検証、競合安全性が必要である。

### Elevation of Privilege

通常利用者は自分の欠席・予約に対応する限定的な操作しかできず、管理者だけが全データ閲覧と枠編集を行えるべきである。サーバーは `/api/admin/*` だけでなく、公開 API 側でも「その操作権限を示す token/code を本当に持つか」を厳密に検証しなければならない。さらに、確認コードだけで他人のデータ一式へ到達できないこと、欠席登録なしに予約確定できないことが必須保証である。
