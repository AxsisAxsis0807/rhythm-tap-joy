# Song Settings PR #8 仕上げ判定（2026-10-24 JST）

**結論: 競合はないが、Draft解除・マージは保留。** 必須の本番/実target/実端末/運用受入が未確認であり、ローカル成功を代用しない。
今回もmainへのマージ、自動マージ設定、本番migration適用、デプロイ、機能フラグ変更、cron実行、本番データ変更は行っていない。

## main再比較と修正

#5のマージをGitHubで確認。最新mainは `cbf05d6f3fc46d1b43bf076a397d4499d0aece14`。
#8開始head `985b730` へ通常mergeしたところ、競合もファイル内容の変更もなかった（merge `d4657a0`）。
#5の変更は既に#8へ取り込まれていた。公開履歴の書換えはしない。
判定engine/GameplayCore、replay、useRhythmGame、スタイル別settings、XP verifier等はmainと同一。
#8の背景表示・AudioSession・原子的保存などの差分と、既存回帰テストを再確認した。

コード/テストの検証対象commit: `f8f7e87e77dbf92ee7bbc40c26b896cb9b5cbbf3`。

- Storage検証環境の起動時、`storage.objects` の存在だけを準備完了と判定すると、Storage migration中のDDLとbaseline GRANTが競合し `pg_class` deadlockになった。
  `start-song-settings-storage.mjs` でHTTP `/status` の準備完了を待ってからGRANTするよう修正し、再起動と実Storage検証の成功を確認した。アプリ・本番DBのDDL修正ではない。
- release-gates回帰テストを追加。環境flag4種類×DB gate3種類の128組合せ、明示true以外の拒否、schema version/readiness/RPC/通信エラー時の無効化、cleanupの厳密なBearer認証を確認。
- 再現可能なGoTrue verifierを追加。localhost:55442の使い捨てStorage test DBにだけ接続し、固有名の別DB・GoTrueコンテナを作る。auth/public search_pathを設定し、コンテナは終了時に削除、固有DBは調査用に保持する。既存DBのreset/dropはしない。

## 今回の実行結果

| 検証 | 結果・適用範囲 |
| --- | --- |
| 全体Vitest | **291成功 / 7 skip**。skipした実Storage用7件は下記で別実行して成功 |
| 実サービス統合 | **7成功**。実Storage/PostgREST、保存・画像・replacement・旧結果/XP保持・cleanup retry |
| PostgreSQL 17.11 | **ローカル22 migration成功**。複数接続CAS、同request5並列で1receipt、採番、cleanup/save race4回、SQL role認可、既存スコア/XP保持 |
| Storage API 1.82.1 / PostgREST 16.4 | 実JWT role・署名upload・path/upsert拒否・immutable bytes/identity・期限とlease・実削除成功。JWTはローカル生成fixtureでありGoTrue認証とは別 |
| GoTrue v2.197.0 | **8項目成功**。email signup（local auto-confirm）・password login・実発行JWTのSDK getClaims・refresh・改変/期限切れJWT拒否・誤password拒否・logout後refresh拒否 |
| app / Song Settings tests / e2e typecheck | **3種類成功**。追加gatesテストも型チェック成功 |
| 本番build | **成功**。デプロイしていない |
| Chromium build済みharness | **14項目成功**。4viewport、50開閉、波形/試聴、lost receipt、touch、6 codecs。永続化transportはfixture |
| local workerd / Wrangler4.150.0 | **12項目成功**。6音声形式、JPEG/PNG/WebP、100MiB成功、100MiB+1とSVG拒否。local compat date 2026-10-13 / build date 2026-10-16の差は残る |
| 今回変更した3ファイルlint / diff check | **0 errors / 0 warnings / 差分空白指摘なし** |
| 全体lint | **158 errors / 7 warningsで失敗**。既存違反を無関係に整形しない |

機械可読結果: [今回のverification JSON](song-settings-finish-verification.json)。
[元の実装報告書](song-settings-implementation-report.md) と [元のverification JSON](song-settings-verification.json) は過去の証拠として保持し、最新記録への参照を付けた。

## 未完了条件・理由・必要な対応

| 条件 | 今回確認できた範囲 | 残る条件と必要な環境/手順 |
| --- | --- | --- |
| 本番migration / flags | ソースの初期OFF、env/schema AND条件、ローカルmigration/認可/フラグ試験 | 本番管理者のread-only接続がない。実migration履歴・bucket/grants/trigger/schema readinessと、実デプロイ環境のflagsを照合する。ローカルOFFから本番OFFと推定しない |
| S09 / U03-U04の実環境性能 | codec/境界処理のlocal workerd、fixture波形/cacheテスト | 実Cloudflare account/target/plan/date、CPU/memory、実端末64MiB working set、2時間/VBR/各profile・実head誤差が未測定。同artifact hashを承認済みstagingへ用意して実測する |
| S10 / cron・監視 | cleanup credential、実Storage削除/429 retry、SQL lease/dead-letterロジック | workflowはPRにのみ存在し、現在mainにない。実scheduler設定/cron/通知/継続監視は未実施。別途承認後、運用先とtoken/URLを設定し実cron→失敗通知→retry/dead-letterの運用証拠を保存する |
| D14 / CLI | CLI2.121.0はSUPABASE_HOME指定で起動可能。実PGのfresh migrationと既存DB回帰テスト成功 | 完全stackはpublic.ecr.awsで403後、CLIがghcr.ioへfallback。PG image展開で空き約2.4GiBになったため、この起動処理だけを停止。start/reset/lint未完了。32GiBより余裕のある隔離runnerでfresh/旧schema+legacy upgradeを実行する |
| Supabase認証 | 独立GoTrueの8項目成功 | `requireSupabaseAuth` を含むアプリserver-function全経路、2account切替、OAuth/MFA/mail、本番相当設定は未確認。認証済みstagingとfixture accountsが必要。GoTrue SDK単体成功を全middleware合格にしない |
| I01-I12 / §16.5 matrix | Vitest/Chromium fixture・実サービスに分けて再検証 | Firefox/WebKit、実iPhone Safari、VoiceOver/PC screen reader、software keyboard/notch/lock復帰/zoom200%、offline→online/2tab/別accountの全組合せが未完了。端末/OS/browser版と受入ID別の証拠を残す |
| deploy SHA / production smoke | 実施なし | DB履歴・backup/rollbackレビューと個別承認後に行う。production resetは禁止 |

public client keyで `/auth/v1/health` と `/rest/v1/` の読み取りだけを試し、両方HTTP403だった。
拒否がproxyかupstreamかは確定できず、GoTrue稼働やschema適用状態の判定材料にはならない。
本番用secret/runtime variables/outbound identitiesのreadyな設定はなく、認証情報を推測したりservice-only RPCへ昇格したりしていない。

I01-I12などは実装テストの成功と、要求された全実機・認証・障害matrixの完了を区別する。
通常テスト内のjsdom scrollTo未実装通知、buildのdeprecated API / chunk-size warningも残る。

## 再現手順（ローカルのみ）

```sh
npm test
npm run typecheck
npm run typecheck:song-settings-tests
npm run typecheck:song-settings-e2e
npm run build
node scripts/start-song-settings-storage.mjs
node scripts/verify-song-settings-storage.mjs
PULSE_REAL_STORAGE_TEST=true npx vitest run tests/song-settings-services.test.ts
node scripts/verify-song-settings-auth.mjs
# 固有名DBだけを新規作成するnative検証。接続値はログへ出さない。
PULSE_TEST_DATABASE_URL=LOCAL_TEST_DATABASE_URL node scripts/verify-song-settings-postgres.mjs
WRANGLER_BIN=PINNED_WRANGLER_4_150_0 node scripts/verify-song-settings-runtime.mjs
npm run build:e2e
# 別terminalでpreview:e2eを起動後
PULSE_E2E_URL=http://127.0.0.1:4175 CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

GoTrue verifierはfixture用auto-confirmであり、メール送信/OAuth/MFAを検証しない。
Supabase CLIの設定保存先は `SUPABASE_HOME=$PWD/work/supabase-home` とする。今回のCLI projectは本番project_idとは異なる固有名・別portのignored work内に隔離した。

本番の管理者が行うread-only照合例（今回は未実行）:

```sh
PGOPTIONS='-c default_transaction_read_only=on' psql "$PULSE_READONLY_DATABASE_URL" \
  -X -v ON_ERROR_STOP=1 -f supabase/preflight/pulse_update.sql
```

結果をrepositoryの22 migration一覧と照合し、不一致時は停止する。envの秘密値は出力せず、必要なflagsの有効/無効と対象deploy SHAのみ記録する。

## Draft解除・マージ判定

Gitの競合解消とローカル回帰検証は完了。しかし元の受入条件はS09/S10・実機・本番照合等を公開/merge前に要求しており、それらを裏付ける権限・環境・実測が不足する。
したがって **Draft維持、Ready for reviewへの変更なし、マージ承認は保留** と判定する。
不足する環境で上表の証拠を揃えた後に再判定する。migration適用・deploy・production mutationはその前に別途承認を得る。
