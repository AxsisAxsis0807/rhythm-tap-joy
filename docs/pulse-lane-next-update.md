# Pulse Lane 次期アップデート：実装・検証・公開手順

検証日: 2026-10-13。出発点: `f90882ad0b1fbea10aeb866964410f3a18f948f6`。

この変更は、独立して動作するプレイスタイル・判定・曲詳細の更新と、公開前のゲートを残したRevision/XP/画像基盤を含む。**仕様全体の本番公開完了ではない**。本番DBへのmigration、Storage設定変更、XP catalog承認、feature flagの有効化は実施していない。

## Phase別の結果

| Phase | 実装・確認した範囲                                                                                             | 残る条件                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0     | 最新main・既存8テスト・build/typecheck/lint baseline、生成型とmigrationの差、読取専用preflight SQL             | 本番schema/grants/Storage inventoryは未取得。実際の音源・画像の権利未確認                                     |
| 1     | format/style/skinの分離、v2設定互換、FNF早押し候補除外、同じイベントを処理するGamePlayCore、run設定固定        | 実機4指・外付けkeyboard未確認                                                                                 |
| 2     | 非破壊追加migration、metadata CAS、immutable revision、private buckets、RLS、型契約。PGlite適用/権限テスト     | 実Supabaseのschema drift、Storage/API契約、複数connection試験未実施                                           |
| 3     | 共通曲詳細・START、明示指定 > 推薦 > 前回 > mania、CLASSICはmania skin、公開曲は選択後にchart取得              | 認証済みの全入口を実環境で試験する必要あり                                                                    |
| 4     | owner metadata編集、別ファイルによるRevision公開API/UI、音源hashに結びついた新しい権利・試聴確認               | Revision公開OFF。画像decode/re-encode/置換処理、cleanup実行workerは未実装。既存の背景・キャラ画像の編集も未完 |
| 5     | shared AudioContext、世代管理、18秒preview、署名更新1回、hidden停止、gameplay lease、古いload/play/onended抑止 | Safari/iPhone autoplay、実音源codec/CORS/低速回線試験未実施                                                   |
| 6     | server発行session、完全replay別保存、共有core検証、bounded XP計算、transaction ledger/receipt、再送            | XP OFF。独立job runner/lease・運用監視、実Postgres並行/障害試験、HTTP展開後body制限の確認が必要               |
| 7     | 確定値のGrowth provider、Result内訳/再確認、連続枠・直線下辺のカード、crop/privacy/remove CAS、receipt演出     | 画像アップロードOFF。公開カード画像projectionと他者画面への統合は未完。実端末/読上げ未確認                    |
| 8     | ローカル17ファイル114テスト、型、build、Chromium画面・IndexedDB、運用文書                                      | lockfile完全再現、staging契約、iPhone/Firefox/Safari未実施                                                    |

## 既存動作との互換

- maniaの判定窓・得点・MISS規則は維持。FNFの早押しだけ、nearest候補の決定前に除外する。`pulse-mania-v1` / `pulse-fnf-v1`で固定し、CLASSICもmania判定。
- PERFECT/ GREAT/ GOOD/ MISSの境界は45/90/140/200ms。`1e-9`秒のepsilonは浮動小数点の差分誤差対策のみ。入力に有利な新しい判定窓は追加していない。
- FNF両側metadataを残し、指定されたsideだけ採点。既存importerのsustainを今回holdへ変更しない。非FNFは共通レーン描画。
- settings v2のキー配置・速度・offset・音量を維持。新しいstyle/preview設定を追加。速度は表示上の移動だけを変え、audio playback rateは1。
- `CompletedPlay`へ巨大replayを格納しない。既存Score queueは引き続きv1 payloadを扱う。新しい結果contextはv2 RPCで原子的に追加、RPC未適用時はPGRST202だけv1へfallbackする。
- `player_stats`のTOTAL SCORE、Top100/本人順位、同点順位、既存Score冪等性は既存テストで回帰確認。XP失敗/上限/対象外でScore保存を妨げない。
- 旧曲は引き続き旧bucketから通常プレイ可能。公開済みであることから試聴許可やXP承認を推定しない。許可済みimmutable audio hashがない曲は試聴不可。
- 新metadataの保存はmigrationが必要。未適用時は明示的なエラーになる。投稿画面はmetadata列を読取確認し、未適用のDBでは追加項目を無効にして従来の列だけで通常投稿を続ける。保存可能として提示した入力を黙って落とすfallbackはしない。旧Drizzle runnerを重ねて実行しない。

## 数値仕様

XPの値は指示書のまま。30 XP/分、同一groupの6〜10回目は1/2、11回目以降1/4、日次初回50・group生涯初回50、日次1500、参加時間最大600秒。成功head前後2.5秒と実hold区間のunionを利用し、日次境界は最初のserver受付日UTC00:00（JST09:00）。上限時は日次bonus→初clear→playの順で配分する。有効完了/初clearの消費も同一transaction。

累積Level閾値は `25*(L-1)*(L+18)`、次Level必要量は `500+50*(L-1)`。整数XPは文字列/BigIntで保持し、Levelを二分探索する。既存表示契約の`xpToNextLevel`は「Level全体の必要XP」なので、残りはその値から`xpInLevel`を引く。

replayは8 MiB/200,000イベントまで。超過時はプレイとScoreを続行しXPだけ対象外。初回受付期限24時間、確定evidenceのpurge予定30日。**purge実行workerは未実装**なので、本番有効化前に運用を追加する。

## Migration適用順・復旧

まず `supabase/preflight/pulse_update.sql` を対象環境で読取実行し、既存7 migrationの適用履歴、`songs.chart_author`の型/default/nullability、RLS、table/function grants、bucket public/limitsを確認する。結果に個人データ・secretは不要。現在のschemaをバックアップし、以下をSupabase migration runnerで順にstagingへ適用する。

1. `20261012100000_chart_author_bridge.sql`: 存在すれば正しい定義か検証、なければ追加。既存の不一致は停止する。
2. `20261012110000_chart_revisions_metadata.sql`: metadata、CAS、immutable revision、公開pointer保護。旧song削除時はrevisionのchart_keyを保持してsong_idのみtombstone化。
3. `20261012120000_private_asset_foundation.sql`: 3 private buckets、予約/quota/画像asset/profile prefs/cleanup jobs、Storage RLS。publicまたはlimitsの衝突を検出すると停止。
4. `20261012200000_xp_foundation.sql`: XP catalog/session/evidence/jobs/progress/ledger/receipt、読取projection、全flag初期OFF。
5. `20261012210000_xp_transactions.sql`: begin/accept/finalize/correctionのserver-only RPCと固定lock順。
6. `20261012220000_result_context_audit.sql`: 旧Score RPCに委譲するv2結果context、catalog変更監査。

旧migrationの書換え、DROP/recreate、全曲の無条件rights付与はしない。stagingにて旧frontendと新frontend両方を確認してから本番適用する。旧`drizzle/0000_add_chart_author.sql`を二重適用しない。

復旧はserverの`PULSE_XP_ENABLED`/`PULSE_REVISIONS_ENABLED`をfalseにし、DB `xp_feature_flags`の`xp_sessions`/`xp_awards`/`xp_progress`をOFFにする。公開frontendを戻しても追加schemaと履歴は保持する。ledgerをUPDATE/DELETEせず、`correct_xp_ledger`へcorrection UUID・元行・差額・理由・operatorを渡す。Storageのcanonical不変triggerを外して復旧しない。未完画像/孤立snapshotの削除は参照・保持期間・権利撤回要件を整理した専用運用を追加する。

## 設定と公開ゲート

| 設定                                         | 今回の状態 / 用途                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PULSE_XP_ENABLED`                           | 未設定=false。serverのsession発行/同期verifier                                              |
| `PULSE_REVISIONS_ENABLED`                    | 未設定=false。新Revision公開                                                                |
| DB `xp_sessions`, `xp_awards`, `xp_progress` | migrationでfalse                                                                            |
| image upload                                 | capabilitiesでfalse固定、reserve RPCはauthenticatedへEXECUTE未付与                          |
| supporter/boost                              | データなし、boostEnabled=false。架空の状態やXPを表示しない                                  |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`   | serverのSupabase接続。client用は既存の`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`  |
| `SUPABASE_SERVICE_ROLE_KEY`                  | 既存server専用clientで使用。VITE変数にしない。今回環境には未設定                            |
| buckets                                      | `songs`は既存互換。`asset-staging`, `profile-card-images`, `chart-revision-assets`はprivate |

XP catalogはservice側で審査し、難度・side・Revisionが同一groupに属することとrightsを確認する。新Revisionの自動承認はない。catalogの緊急revokedは確定前にも再検査する。許可されたservice-only RPCをクライアントへgrantしない。metadata/画像参照/承認/ledgerへの直接書込みは別々に検証する。

XP有効化前に必須: 実Supabase Storage overwrite/delete拒否、認証owner/anon/別owner、複数接続の同時finish/初回bonus/日次cap、デッドロック再送、transaction各段階rollback、catalog撤回、通信断・別タブ・再ログイン、圧縮後展開body制限、worker再実行・監視・保持期間処理。

画像有効化前に必須: 実Cloudflare targetで動くdecode/re-encode経路を選定・検証し、magic/MIME/3MiB/ピクセル数/animation/metadata除去/失敗時旧画像保持/cleanup再試行を実装。現在の予約・RLSだけでONにしない。

Revision有効化前に必須: 実worker memory/CPU限界でaudio/chart処理、ファイルが処理途中で変わる競合、公開CAS失敗・再送・孤立asset管理。新Revision音源はPCM WAV / Ogg Vorbis・Opusに制限。コンテナ長/CRC/duration確認は完全audio decodeの代用ではない。現在はStorage download後にサイズ確認するため、100MiB上限でのworkerメモリを検証する必要がある。

account削除と監査記録の匿名化、権利撤回とimmutable asset保管の手順も本番前に確定する。auth.usersへの監査FKがあるため、無計画なaccount削除はFKで拒否され得る。

## 検証結果

| Command / 試験                                 | 結果                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| baseline `npm run typecheck` / `npm run build` | 成功                                                                                                                  |
| baseline `npm test`                            | 8 files / 68 tests成功                                                                                                |
| baseline `npm run lint`                        | 359 errors / 7 warnings（既存）                                                                                       |
| `npm test`                                     | 17 files / 114 tests成功                                                                                              |
| `npm run typecheck`                            | 成功                                                                                                                  |
| `npm run build`                                | Vite client + Nitro Cloudflare worker build成功                                                                       |
| `npm run lint -- --format json`                | 156 errors / 7 warnings。未変更ファイルの既存違反のみ                                                                 |
| 変更TS/TSX/JS限定eslint                        | 0 errors、UploadTaskの既存Fast Refresh warning 1件のみ                                                                |
| `git diff --check`                             | 成功                                                                                                                  |
| `bun install --frozen-lockfile`                | **未成功**。private Google Artifact RegistryのLovable 2.25.3/picomatch tarballが403。lockfileを変更して回避していない |
| Chromium home→詳細→FNF→START                   | 360×780、390×844、844×390、1280×800で横overflow/pageerrorなし。公開曲APIは空配列fixture、local Pulse Testを使用       |
| Chromium IndexedDB                             | durable保存→reload→同一payload取得、account切替時送信なし、並行flush1回・完了後削除を確認                             |
| Chromium Levelカードfixture                    | 白/黒画像、長い数値、360/390/1280幅・200%zoomを撮影確認。連続枠・直線下辺。実accountデータ試験ではない                |

実行Nodeは24.19.0、Bunは1.3.11。buildは環境に既存のLovable config **2.25.2**を使用しており、要求2.25.3のlockfile完全再現buildとは区別する。既存依存の警告（inputValidator deprecated等）も残る。

lintの残るerrorファイル: `NoteSprite.tsx`, `SettingsDialog.tsx`, `ui/slider.tsx`, `game/chartFile.ts`, `game/charts/{bewilderment-left,bewilderment,test-chart}.ts`, `game/config.ts`, `integrations/supabase/{auth-attacher,auth-middleware,client.server,client,cron-auth,previewAuthStorage}.ts`。主因は既存Prettier形式、previewAuthStorageには既存prefer-constもある。無関係な全体formatはしていない。

### 指示書Test Planとの対応

- J01–J08: 境界・早押し・候補除外・同時/source・hold/clearをunitで確認。J09/J10: 既存parser/sideテスト維持。実touch入力は未確認。
- U01/U03: style優先順位・radio・v2 hydrateテスト。U02はrun snapshotとUI保持を実装、全入口/再取得/RETRYの実認証E2Eは未実施。
- A01–A03/A05/A06: fake media/contextで遅延load/sign/playと排他・18秒・音量を確認。A04のSafari/実codec/CORSは未実施。
- C01/C02/C05/C06: PGliteでCAS/owner/direct mutation拒否とsnapshot/tombstone。C03/C04/C07の実upload/revision契約・同時connection試験は未実施。
- I01–I04: 予約/RLS基盤とcrop表示のみ。画像処理・置換・cleanup完了試験は未実施、機能OFF。
- X01–X06/X08/X09/X11: unit/PGliteで境界/再送/hash/nonce/rights/権限/日次/BigInt/実core replay。X01/X07/X10の実並行・障害注入は未実施。X12はreceipt重複抑止/reduced motion実装、複数タブ演出競合は追加確認が必要。
- R01/R02: 既存Score queue/client/UI/DBテスト全件維持、v2 contextの冪等性を追加。R03: PGlite全migration適用、実schema driftへの適用は未実施。
- M01: 未実施。M02: Chromium local fixtureのみ。M03: 上記カードfixture。M04: CSS/アプリ設定対応、実screen reader未実施。

検証用ログ・画像・スクリプトはgit管理外の`work/verification/`に保存。PGliteとmock成功を本番認証/Storage/並行connection/Safariの合格には数えていない。

## 変更ファイル一覧

### 既存

- `.gitignore`
- `eslint.config.js`
- `src/components/app/AccountGrowth.tsx`
- `src/components/app/RhythmHub.tsx`
- `src/components/app/UploadTask.tsx`
- `src/components/game/GameScreen.tsx`
- `src/components/game/ModePicker.tsx`
- `src/components/menu/MusicSelect.tsx`
- `src/game/audio.ts`
- `src/game/engine.ts`
- `src/game/modes.ts`
- `src/game/settings.ts`
- `src/game/types.ts`
- `src/game/useRhythmGame.ts`
- `src/integrations/supabase/types.ts`
- `src/lib/accountGrowth.ts`
- `src/lib/playerRanking.ts`
- `src/routes/index.tsx`
- `tests/account-growth.test.tsx`
- `tests/game-settings-engine.test.ts`
- `tests/ranking-db.test.ts`

### 新規

- `docs/pulse-lane-next-update.md`
- `src/components/app/LiveGrowthProvider.tsx`
- `src/components/app/ProfileLevelCard.tsx`
- `src/components/app/RevisionPublisher.tsx`
- `src/components/app/SongDetail.tsx`
- `src/components/app/SongMetadataEditor.tsx`
- `src/components/app/SongMetadataFields.tsx`
- `src/components/app/accountGrowth.css`
- `src/game/audioSession.ts`
- `src/game/gameplayCore.ts`
- `src/game/judgementPolicy.ts`
- `src/game/replay.ts`
- `src/game/runConfiguration.ts`
- `src/game/styleSelection.ts`
- `src/hooks/useAudioPreview.ts`
- `src/integrations/supabase/upgradeTypes.ts`
- `src/lib/audioMetadata.ts`
- `src/lib/chart.functions.ts`
- `src/lib/chartRepository.ts`
- `src/lib/chartRevision.server.ts`
- `src/lib/chartValidation.ts`
- `src/lib/ownerTransport.ts`
- `src/lib/playVerifier.ts`
- `src/lib/profilePreferences.ts`
- `src/lib/uploadProgress.ts`
- `src/lib/useAccountGrowth.ts`
- `src/lib/usePlaySession.ts`
- `src/lib/xp.functions.ts`
- `src/lib/xpContract.ts`
- `src/lib/xpEvidenceQueue.ts`
- `src/lib/xpRules.ts`
- `src/lib/xpWorker.server.ts`
- `supabase/migrations/20261012100000_chart_author_bridge.sql`
- `supabase/migrations/20261012110000_chart_revisions_metadata.sql`
- `supabase/migrations/20261012120000_private_asset_foundation.sql`
- `supabase/migrations/20261012200000_xp_foundation.sql`
- `supabase/migrations/20261012210000_xp_transactions.sql`
- `supabase/migrations/20261012220000_result_context_audit.sql`
- `supabase/preflight/pulse_update.sql`
- `tests/audio-preview.test.ts`
- `tests/chart-security-db.test.ts`
- `tests/chart-validation.test.ts`
- `tests/helpers/database.ts`
- `tests/judgement-policy.test.ts`
- `tests/play-verifier.test.ts`
- `tests/style-selector.test.tsx`
- `tests/xp-db.test.ts`
- `tests/xp-evidence-queue.test.ts`
- `tests/xp-rules.test.ts`
