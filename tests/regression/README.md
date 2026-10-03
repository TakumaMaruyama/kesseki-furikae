# 欠席・振替アプリの回帰テスト

送迎不要連絡を欠席連絡と同じ直接入力へ変更し、学校でのコード発行を不要にした最新状態は **全70ケース成功**（既存9・欠席/振替API24・送迎API21・ブラウザ16）。追加機能、マイグレーション、画面証跡、運用判断は [TRANSPORT.md](./TRANSPORT.md)、公開状況は [RELEASE.md](./RELEASE.md) を参照。下段の41件の表は送迎追加前の取消修正時点の記録。

対象ソース: `/Users/brest/Documents/ChatGPT/欠席・振替` の `a466cc412ae38448d2f199db32c3ff9719f8ab32`（`codex/integrate-replit-security`）。
2026-10-02にソースだけを独立コピーし、`test/school-regression-20261002` ブランチで作成した。元チェックアウト、共通ログイン統合作業、パーソナル予約、動画プロジェクトは変更していない。

最初のテスト追加ではアプリ実装を変更せず、同時取消による人数の二重減算を再現した。その後のユーザー承認に基づき、この独立コピーの `server/routes.ts` に取消処理の最小修正を加えた。UI、スキーマ、既存確認スクリプトは無変更。失敗テストを成功に見せるためのskip・期待失敗指定・リトライは使わない。

## 再実行

Node.js 20.11以上、npm、通常ユーザー権限、ローカルのTCP待受が必要。確認環境はmacOS arm64 / Node 26.3.0。ほかのOS、Nodeバージョン、CIコンテナは未検証。PostgreSQLは開発依存に含まれるのでシステムへのインストールは不要。root専用コンテナでOSユーザーを自動作成する設定は無効。

初回セットアップ（依存取得のためインターネット接続が必要）:

```sh
npm ci
npx playwright install chromium
```

実行:

```sh
npm run test:regression
npm run test:regression:typecheck
npm run check
```

個別実行:

```sh
npm run test:regression:existing
npm run test:regression:api
npm run test:regression:transport
npm run test:regression:e2e
npm run test:regression:e2e -- --project=mobile-chromium
npm run test:regression:api -- --test-name-pattern="simultaneous cancellation"
npm run test:regression:api -- --test-name-pattern="cancellation"
```

`test:regression` は既存検証、欠席/振替API、送迎API、ブラウザを順に実行し、途中の失敗後も残りの結果を収集する。1件でも失敗したら終了コード1になる。最新の全体結果は、各スイートを個別実行して合計70成功・失敗0・skip 0、各終了コード0。欠席/振替APIを `cancellation` で絞ると通常の取消・兄弟分離と7つの競合/再試行ケースの計9件を実行する。

PlaywrightのJSON結果は `test-results/regression-results.json`。画面幅ごとのスクリーンショット、失敗時のtrace・画面・エラー文脈も `test-results/` に出力される。再実行で置き換わるため保存する証跡は実行前に別の場所へコピーする。生成物はGit管理対象外。

## 安全なテスト環境

- 接続URL、固定ポート、既存サーバー、DBデータディレクトリを入力として受け取らない。
- 毎回、新しい一時ディレクトリにPostgreSQL 16.14を起動し、`127.0.0.1` の動的ポートのみで待ち受ける。Unix socketは無効。
- 接続後にDB名、実データディレクトリ、接続アドレス、ポートを今回起動したものと照合してからDDL/テストデータを投入する。
- スキーマは `shared/schema.ts` から生成する。実会員、実DBのバックアップ、旧DBのデータは利用しない。氏名は「ごうせいてすと あおい」「ごうせいてすと はる」、メールは `example.invalid`。
- 親プロセスの `DATABASE_URL`、`PG*`、`ADMIN_PASSWORD`、メール・Replit関連の環境変数や `.env` を利用しない。アプリ子プロセスには生成したローカルURLと合成セッション秘密値だけを渡す。
- `server/routes.ts`、実際のstorage・SQL・認証・session storeを使用する。メール配送境界のみテスト用sinkに置換し、ビルド結果に配送実装が含まれていないことを検査する。schedulerは起動しない。
- ブラウザは専用コンテキストを使う。サービスワーカーを無効化し、テスト用オリジン以外のページ要求を遮断する。
- DBは各テスト前に初期化し、サーバー・DBプロセス・一時データは終了時に片付ける。

ローカルTCP待受がsandboxに拒否される場合は、回帰テストコマンドのローカル待受許可が必要。これは本番DBへの接続許可ではない。

## 取消修正時点の検証範囲と結果（2026-10-02・送迎追加前）

| 層 | 実行内容 | 結果 |
| --- | --- | --- |
| 既存確認 | 確認コード、新入会者、枠作成、カレンダー、枠フォーム、理由表示、エラー処理、公開情報・セキュリティ、運用スクリプト定義 | 9成功 |
| API + 実PostgreSQL | 欠席→確認→予約→取消、兄弟の分離、不正な2行目で全体rollback、重複連絡、遅刻、満席・体験者・級・休講・開始後・期限切れの拒否 | 成功 |
| API + 実PostgreSQL | 同じ欠席の同時予約、最後の1席の競合、失効sessionの更新拒否と再ログイン、コーチ/管理者権限境界 | 成功 |
| API + 実PostgreSQL | 同じ予約の同時取消と再試行、取消メールが一度だけ発行されること | 成功 |
| API + 実PostgreSQL | 予約取消と欠席取消の競合（開始順を入れ替えた2件）、別予約2件の同時取消で3人目が残ること | 成功 |
| API + 実PostgreSQL | 欠席を伴わない管理者予約の取消、再予約後の古い取消要求、同じ欠席の同時取消 | 成功 |
| API合計 | 24ケース | **24成功 / 0失敗** |
| ブラウザ | 兄弟登録・確認コードでの切替、級変更時の枠選択、満席表示・予約・再表示・取消、失効sessionからの再ログイン | **8成功**（desktop 1280×900 / mobile 390×844、各4件） |
| 型検査 | 既存アプリと追加テスト | 成功 |
| 全回帰 | `npm run test:regression` | **41成功 / 0失敗**、skip 0、終了コード0 |
| 修正前の証拠 | 元の18 APIケースを含む全回帰（アプリ無変更） | **34成功 / 1失敗**、終了コード1（同時取消） |
| 修正前の追加再現 | `--test-name-pattern="cancellation"`（アプリ無変更） | **5成功 / 4失敗**、終了コード1 |
| 修正後の追加再現 | 同じ `cancellation` の9ケース | **9成功 / 0失敗**、終了コード0 |

依存はlockfileから `npm ci --prefer-offline --no-audit --no-fund --cache /tmp/attendance-npm-cache` で779パッケージを新規インストール済み。初回は実行環境の接続切断で中断したが、再接続後に再インストールを完了して検証した。Chromium本体は既存キャッシュを使用しており、新規ダウンロードは今回実施していない。

実行ログは独立コピーの親ディレクトリに保存した。`regression-run-20261002.log` は最初の未修正結果、`cancellation-before-fix.log` は追加ケースでの修正前再現、`cancellation-after-fix.log` は修正後の9ケース、`cancellation-full-regression.log` は修正後の全41ケース。それぞれの終了コードも対応するテキストファイルに保存している。

ブラウザの兄弟切替は、現行UIの「複数の子どもの欠席入力」と「確認コードごとに対象児童の詳細へ移る」流れを意味する。現行routerに接続されていない保護者アカウント画面をテスト対象としていない。

## 修正した不具合: 同時取消による使用人数の過少計上

場所: `server/routes.ts` の `cancelRequestUnified`（1059行以降）。失敗テスト: `api.test.ts` の `simultaneous cancellation of the same booking must retain another child's occupied seat`。

合成データでの再現手順:

1. 定員4、通常出席2の枠に、児童AとBの振替予約をそれぞれ作る。`capacity_makeup_used = 2` になる。
2. 専用DBの別トランザクションで、Aの `requests` 行を `SELECT ... FOR UPDATE` でロックする。
3. Aの同じ `requestId`・`cancelToken` で `POST /api/cancel-request` を同時に2回呼ぶ。
4. `pg_blocking_pids` で両トランザクションの待機を観測してロックを解放する。単なるsleepのタイミングには依存しない。
5. 修正前は両応答が200になり、Bの予約は引き続き「確定」だが、使用人数が **0** になる。期待値は **1**。修正後は使用人数1を保ち、2回目は `alreadyCancelled: true` になる。

影響: 残席を実際より1席多く計算し、追加予約を受け付ける可能性がある。連続した取消は既存の状態確認で防げるが、同時取消は双方が更新前の「確定」を読んで人数を減らす。予約行の取得はロックなしで、取消更新にも未取消状態を一度だけ確保する条件がない。

追加した修正前テストでは、予約取消と欠席取消を重ねた際の400応答（SQL更新失敗）、逆順での二重減算、欠席を伴わない管理者予約で両応答が `alreadyCancelled: false` になることも再現した。400応答の本文にはPostgreSQLの原因コードが含まれないため、そのログだけで原因コードを断定しない。

修正は `server/routes.ts` の2関数に限定した。

- `cancelRequestUnified`: 関連する欠席行、予約行の順に `FOR UPDATE` でロックし、その後の予約状態から取消済みかを判断する。欠席がない予約も予約行をロックする。
- `cancelAbsenceWithRelated`: 最初に欠席行をロックし、関連予約もID順にロックしてから人数を変更する。両処理のロック順を「欠席→予約→枠」にそろえる。

これにより、競合した後続処理は先行処理の確定した状態を読み、人数の減算、通常出席人数の復元、取消メール発行を繰り返さない。全テストは期待値を維持したまま成功した。

## 変更の受け渡し

- `attendance-cancellation-fix.patch`: 今回のアプリ修正だけ（`server/routes.ts`）。
- `attendance-regression-fixed.patch`: 元の対象コミットに対する全変更15ファイル。アプリ修正に加え、テスト、依存定義、再実行手順を含む。
- 前段の `attendance-regression.patch` はアプリ無変更のテスト追加パッチとして保存している。全変更パッチと重ねて適用しない。

パッチは独立コピーの親ディレクトリに保存。元チェックアウトでは `git apply --check` による適用可否の確認だけを行い、実際には適用していない。今回の追加・更新は `server/routes.ts`、`tests/regression/api.test.ts`、このREADMEの3ファイルで、前段のテスト基盤を再利用した。

## 限界・再利用した既存検証

- 共通ログイン統合のローカル作業ディレクトリは `Swim Platform/.local/integration-20260927`。既存の `tests/e2e/integration-auth.spec.ts`、`tests/common-auth-contract.test.mjs`、`tests/synthetic-restore-guard.test.mjs` と合成fixtureを確認した。別作業が進行中のため、変更・再起動・再実行していない。共通ログイン復帰、アプリ間ユーザー切替、合成バックアップ復元の新しい成功証拠として今回の結果を扱わない。
- 今回の `existing.test.ts` は欠席・振替アプリの既存確認スクリプト9本をそのまま呼び、assertionを重複実装していない。
- パーソナル予約の決済・カレンダー連携、動画サービス、他アプリ全体、未接続の保護者ログインは対象外。
- メールの外部配信、PWA/offline、実機iPhone/Safari、Android実機、全画面の見た目・アクセシビリティは未検証。
- ログイン期限切れはテストDBのsession期限を過去に変更して検証。開きっぱなしの管理画面が操作なしで自動的に再ログイン画面へ移ることや、自然な時間経過は保証しない。
- frontendはテスト専用Viteサーバーで起動する。公開版のビルド・Replit/CDN/TLS・実稼働DBスキーマ・全ネットワーク障害の検証ではない。
- 競合テストはDBの実ロック待機を観測して指定の重なりを作る。大量負荷、全ての処理順序、schedulerや管理者による枠削除・再編と取消が重なる場合までは検証していない。
- この合成テストは本番DBの接続先や公開状態を証明しない。Replit標準の管理対象DB・公開手順と公開後の確認は [RELEASE.md](./RELEASE.md) に別途記録する。実会員データのテスト利用、資格情報変更、送迎コードの実会員への発行は行っていない。
