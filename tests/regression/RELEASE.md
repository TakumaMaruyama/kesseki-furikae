# 欠席・振替アプリの公開記録

## 2026-10-03 保護者による直接入力への変更

ユーザーは学校でのコード発行を不要にし、送迎も欠席連絡と同様に入力できるよう希望した。保護者が名前・クラス・日付・レッスンを選ぶ方式へ変更し、訂正・取消に使う本人用の控えは自動発行する。名前だけで他の家庭の既存記録へアクセスする機能はない。仕様と検証は[TRANSPORT.md](./TRANSPORT.md)を参照。

元のコード方式は、ユーザーがReplit上でDB変更レビューを完了して公開した。2026-10-03 01:39 UTCの確認結果:

- 公開ページ・送迎ページ・ヘルスはHTTP 200。
- 匿名の送迎セッションは対象0件、スタッフ・管理者APIは401。
- 発行していない確認用コードはDB照会後に403。実児童や送迎連絡の新規登録は0件。
- クライアント資産index-4ZSA7qc3.jsのSHA256は6cdc385169233892a013bb98eb0d7f88c32c74a6c933d8c4470473bf8ba3db51。
- Replitの公開結果はsuccess。HEAD f5bf17d3fe38c0ddaf40e3bf2ff420e9bf64329bは、検証済み取込46de907ed8d57150dda6d4db314674453a4ba53aとコード差分0。
- 管理対象開発・本番DBの双方に送迎2テーブルが存在し、スキーマ差分0。ランタイムDBの直接指紋取得は行っていない。接続・公開設定を変更せず、Replitの標準的な管理DBの公開フローを利用する判断に更新した。

直接入力への変更は、公開GitHubのPR #2の検証済み先行コミット6cf473d9eee62772c12fd459743aebb136c3edf7からの差分として用意した。合成テスト70件・アプリ/テスト型検査・本番用ビルドが成功。今回の変更はDBの構造・依存・公開設定を変えない。既存の送迎データとコードを保持する。

この記録を含むコミットの作成時点では、新入力版のReplitへの反映・再公開前。承認済みの公開作業を続け、完了後の版・公開応答・配信資産の照合結果はローカルrelease-evidenceへ保存する。復旧は旧公開版f5bf17dへコードだけを戻し、追加テーブルと連絡データを残す。

## 以下は過去時点の履歴

下記の「未公開」「DB対応未確認」は当時の記録であり、現在の進行状況は上段を参照。

## 2026-10-02 取消修正の本番公開と検証記録

## 2026-10-03 送迎機能の公開準備

送迎機能と合成回帰テスト一式を、GitHubのmain `17b2b587d28e6e2e6eb8c9b8cf890d9764c9eaee` から公開準備ブランチ `codex/transport-notices-20261003` にまとめた。アプリ実装とテストは、全63件・型検査・ビルドが成功済みの独立コピー `91f0ab3` とバイト単位で照合し、変更していない。取消修正はmainに含まれており、今回の差分で重複適用しない。

Replit専用接続の再確認では、作業ツリーは引き続き `8d2aa3c` でクリーン、送迎機能は未取込。公開状態はsuccess。本番ランタイムDBと公開時スキーマ反映先を結ぶ非秘密の管理情報は取得できず、同一性は未確認のまま。公開準備ブランチの作成は、本番DB照合や送迎の公開完了を意味しない。

送迎機能を公開するには、実行先とスキーマ反映先の対応を確認し、追加差分が送迎用2テーブルと付随する制約・インデックスだけであることを確定する。既存の欠席・振替・定員データの変更や実会員コードの自動発行を行わない。復旧時は送迎データを保持してアプリコードを戻し、ローカル専用のDROPを含む復旧SQLを本番で使用しない。

対象: [TakumaMaruyama/kesseki-furikae](https://github.com/TakumaMaruyama/kesseki-furikae)。原本は `/Users/brest/Documents/ChatGPT/欠席・振替`、独立作業コピーは `/Users/brest/Documents/Codex/2026-10-02/task-3/attendance-regression`。

ユーザーの後続承認に基づき、取消の同時実行による人数二重減算の修正だけを本番公開した。送迎は本番ランタイムDBと移行対象DBの照合待ちで、本番移行・公開を行っていない。原本や進行中の共通ログイン統合作業は変更していない。

## 公開結果

- 公開URL: <https://kesseki-furikae.replit.app>。Replit公開ツールは `pending → running → promoting → success`。
- 公開コミット: `8d2aa3cf803e45564cf9e17e0f48161fae39a83f`。取消修正コミット `cc715e36c8694041247294b84634adde55e0afeb` の直接の子で、実ファイル変更のない公開用コミット。
- 両者のtree SHAは `8622bfb7751d554bd428765ec2f528ba049f6bd4` で一致。公開後も作業ツリーはクリーン、修正ファイルのSHA256も下記検証値と一致した。
- デプロイID: `e9ef4e0d-e470-4941-b003-f8ca2ff40cda`（再公開でも同じIDが返るため、これだけを版識別子とは扱わない）。
- 2026-10-02 08:37 UTCにヘルス・入口ページ・静的JSを読み取り確認し、すべてHTTP 200。配信されたクライアントJSは検証済みビルドとバイト一致し、UI変更はない。
- `/health` の `buildSha` は引き続きnull。バックエンドの版はReplitの公開前後のGit照合と公開成功応答を根拠とし、HTTPから独立にソースSHAを確認できたとはしない。
- 公開直前の専用スキーマ差分照会は適用SQL 0件。公開ログ自体は取得できなかったため、プラットフォーム側の実行記録を事後監査したわけではない。DB移行コマンド、実会員データを用いた検証、人数補正は実行していない。

GitHubの [PR #1](https://github.com/TakumaMaruyama/kesseki-furikae/pull/1) は、ユーザーのmainマージ承認と「デプロイまで」の明示指示を受け、2026-10-02にmainへマージした。mainは `17b2b587d28e6e2e6eb8c9b8cf890d9764c9eaee`。マージ直前にbase `a466cc4` / head `381fc66d` と取消1ファイルだけの差分を再確認し、期待headを指定して実行した。前回の承認不足による停止後、明示承認を根拠とする1回の再試行で成功した。

mainとPR headのファイル差分は0。mainの取消ファイルとReplitの現在の同ファイルは、いずれも下記SHA256に一致する。Replitは引き続き `8d2aa3c`、未コミット変更なし。12:54 UTCに公開ヘルス・入口ページ・静的JSを再確認し、すべてHTTP 200、静的JSのSHA256は `4630be93110fb8da1085c08d5bfda893942892e4ada3b5ac30c158354d0b056f` で検証済みビルドと一致した。既に同じ取消修正を公開済みなので二重公開はしていない。公開中バックエンドのSHAはHTTPや現在の公開メタデータから独立取得できず、前回の公開記録と今回のソース照合を根拠とする。

GitHubのChecks・ステータス・Actions定義・実行履歴は0件で、41件成功はローカル検証の結果。PRには送迎機能や回帰テスト基盤を含めていない。Replit標準の公開は別のRepublish操作であり、リポジトリに自動公開/移行の定義はない。Gitペインの任意auto-sync設定と外部Webhook設定は取得できていない。

## 取消修正の変更

[381fc66d7ddbbf304cb35517b057d8742d90b42d](https://github.com/TakumaMaruyama/kesseki-furikae/commit/381fc66d7ddbbf304cb35517b057d8742d90b42d)、ブランチ `codex/cancellation-locking-20261002`。

- 基点: `a466cc412ae38448d2f199db32c3ff9719f8ab32`。
- GitHub比較: 1コミット、`server/routes.ts` だけ、追加16行・削除3行。
- スキーマ、UI、資格情報、公開設定、依存の変更は含まない。
- 修正済み `server/routes.ts` のSHA256: `b96899e9c99424adf36b5098c88e18f73cd90a3dabb24d76251d2cd2e05f95f7`。
- 独立コピーの保存点 `fc5d3d2` から作った `../cancellation-release/` で全41件成功。ビルドも成功。
- 実会員の予約取消による本番再現は実施しない。別児童の人数が減らないことは合成PostgreSQLの競合テストで検証した。

## 公開前の確認

- 原本とGitHub main: `a466cc4`、原本の未コミット変更なし。
- Replit変更前: `codex/deploy-new-enrollees-745f7df` / `13ccba3b57cceb984b3a906bddba9627ad27463e`、未コミット変更なし。
- Replitはmainより4コミット先行。実差分は既存のポート設定のみ。routes/schema/index/lockfileのSHA256は原本と一致。
- 公開URL: <https://kesseki-furikae.replit.app>。
- 公開前デプロイID: `e9ef4e0d-e470-4941-b003-f8ca2ff40cda`。状態 `success`。
- 公開前 `/health`: `status: ok`, `buildSha: null`。公開中バックエンドのソースSHAはHTTPから特定できない。
- Replit Agentの専用読み取り照会では、管理DBの開発→本番スキーマ差分なし、適用SQL 0件、データ損失・互換性の警告なし。
- 公開ビルド/起動に `db:push` や起動時DDLは含まれない。ただし、Replit自体のスキーマ反映は公開時に別途行われるため直前にも差分0件を確認する。
- 公開中プロセスの実接続DBとスキーマ反映先DBの同一性は未確認。この確認でHamasui Platformの別件のDB照合問題も解決したとは扱わない。

Replitは取消の検証済みコミットだけを取り込み、変更前基点の保存、型検査・ビルドに成功した。直前のファイルハッシュ一致と適用SQL 0件を照合してから公開した。送迎の取り込み、実会員参照・複製、資格情報や設定変更、実DBへ接続するプレビュー起動は行っていない。

## 検証コマンドと証拠

| 対象 | コマンド | 結果 |
| --- | --- | --- |
| 取消だけ | `npm run test:regression`（`../cancellation-release/`） | 41成功、失敗/skip 0、終了コード0 |
| 送迎を含む最新状態 | `npm run test:regression` | 63成功、失敗/skip 0、終了コード0 |
| 送迎境界API | `npm run test:regression:transport` | 14成功 |
| PC/スマホ画面 | `npm run test:regression:e2e` | 16成功 |
| 型検査 | `npm run check` / `npm run test:regression:typecheck` | 両方成功 |
| productionビルド | `npm run build` を `cleanEnvironment()` で外部DB・メール・認証環境変数を除いて実行 | 両コピーで成功 |

ログは独立コピーの親にある `release-cancellation-regression.log`、`release-cancellation-build.log`、`transport-policy-full-regression.log`、`transport-policy-build.log`。終了コードも対応する `-exit.txt` に保存。初期の取消失敗・修正後の成功・再現手順は [README.md](./README.md)、送迎の範囲と画面証跡は [TRANSPORT.md](./TRANSPORT.md)。API/ブラウザが使用する実データはすべて合成で、外部メール送信は0件。

公開前照会と変更要求の応答は親ディレクトリの `release-evidence/` に保存する。資格情報や会員データは含めない。

## 復旧方針と未実施

取消だけなら追加スキーマはなく、変更コミットのrevertまたは保存した変更前基点へのコード復旧で戻す。Replitの `backup/pre-cancel-fix-13ccba3` は変更前 `13ccba3b57cceb984b3a906bddba9627ad27463e` を保持。取消変更だけを戻して型検査・ビルドと公開前SQL 0件を確認し、再公開する。デプロイID指定で旧版へ戻す機能は今回のツールから確認できない。後続変更がある場合は作業を上書きせず、取消変更だけを反転する。

親ディレクトリの `attendance-cancellation-rollback.patch` は修正済みコピーで `git apply --check` 成功。復旧自体は実行していない。DBの復元・削除・既存人数の一括補正は行わない。修正前の不具合で既に誤った人数があるかは実データを調べていない。

送迎導入後の復旧は新テーブルと保存データを残して旧アプリへ戻す方針。ローカル専用DROP SQLを本番で使用しない。現在の阻害箇所は `transport_profiles` / `transport_notices` の本番追加で、公開ランタイムが実際に使うDBと、公開時スキーマ反映先DBの非秘密の識別情報を照合できていない。開発側の接続設定や「本番変数が存在する」だけでは同一とみなさない。資格情報の開示は不要。

main承認後にも公式管理画面への読み取り経路を再確認したが、現在のReplit接続にはPublishing/Database画面の個別内容を直接取得する機能がなく、公開メタデータと既存ログにもDBリソース/ブランチIDがなかった。`DATABASE_URL` はshared/productionの両方で存在するが、管理bindingか手動設定か、公開時の有効な由来を値なしで判定する情報がない。存在だけから手動上書きと決めつけてもいない。

必要な確認は、公式Publishing画面の現行公開環境に割り当てられたDBと、Database画面のProductionインスタンス/スキーマ反映先を同じ安定したリソース・ブランチIDで結べること、および公開環境の `DATABASE_URL` がその管理bindingを使うという非秘密の由来情報。値を表示しない管理ラベルで確認し、表示自体がない場合は既存権限を持つ管理者またはReplit側の対応関係確認が必要。接続文字列、パスワード、APIキーの送付や新規作成は求めない。この条件を満たせないため送迎の本番DB変更・公開は保留を継続した。

実会員へのコード発行・配布、運転担当との引継ぎ、実機Safari/PWA、外部メール配信、復旧の実運用テストは未実施。
