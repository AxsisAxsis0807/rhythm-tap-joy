# PR #8 / #5 統合・公開判定記録

2026-10-24 JST。基準 main: `32e239d0488d938c4319e3330ee83ff37a2b8a37`。
元 #8 head: `5dacc93063817146cf2d8854aef9625bb823ab8a`。
mainを取り込み、履歴を書き換えず #5 の修正も merge した。
**mainへのマージ・自動マージ設定・本番DB操作・デプロイは実施していない。**

## 解消内容

#8の競合は `GameScreen.tsx` と `fnf-gameplay-integration.test.tsx`。
キー設定は main の `resolveKeyMap(settings, playStyle)` を保持する。
MANIA 1セットと FNF 主/サブ2セットを維持し、旧共有サブキーのテストを FNF 主/サブキーの実判定テストへ更新した。
MY TRACKS の選択→明示PLAYという #8 の操作とテストを保持した。
Song Settings・background・AudioSession・保存認可/原子性の既存変更は保持する。

#5 は [個別記録](pr5-integration-2026-10-24.md) のとおり、mainで既に実装された FNF 判定処理を戻さず、
中央配置・入力可視化の設定・二重translate修正のみを取り込んだ。
#5 を先にマージし、その後 #8 を検討する順序を推奨する。#8 は修正後 #5 を祖先に含む。
判定エンジン、GameplayCore、useRhythmGame、replay、判定policy・スコア/XPのロジックは最新 main と同一。

## 今回実行した検証

| 対象 | 結果 |
| --- | --- |
| #5単独 npm test | 21 files / 242 tests 成功 |
| #8+#5 npm test | 29 files / 287 tests 成功、実Storage用1 file / 7 tests skip |
| #8+#5 app / song-settings-tests / song-settings-e2e typecheck | 3種類すべて成功 |
| #5単独 typecheck / 本番build | 成功 |
| #8+#5 本番build | 成功 |
| build済み Song Settings Chromium harness | 14項目成功（4viewport、50開閉、波形/試聴、lost receipt、touch、6 codecs） |
| 今回修正した#5コード/テスト11ファイル + #8回帰テスト lint | 0 errors / 0 warnings |
| 全体 lint | 158 errors / 7 warnings、失敗。既存違反を無関係に大量整形しない |
| #5→#8 merge試験 | 追加競合なし |

Node24.19.0 / Bun1.3.10。lockfileが参照する私設registryは403。
公式npmから同一version・同一integrityの配布物を隔離cacheへ取得した後、元のlockfileのまま
`bun install --frozen-lockfile --offline` が成功した。依存バージョン・release-age guard・lockfileは変更していない。

Vitestの実Storage7件は今回再実行していない。以前の実Storage/PostgREST7件、native PostgreSQL22 migration、
workerd検証の成功は [以前の実装記録](song-settings-implementation-report.md) の履歴であり、今回の再実行とは扱わない。
今回の変更では migration・DB APIの実装を変更していない。
ChromiumのSong Settingsテストは永続化transportをfixtureに置き換えたharnessであり、本番保存smokeではない。
jsdomのscrollTo未実装通知、buildのdeprecated API / chunk-size warningは残る。
PR全体のdiff checkには既存ライセンス/SQL末尾空白があり、ライセンスや既存migrationを整形し直していない。

## 残る blocker と必要な対応

**#8はDraftを維持し、公開・マージ承認は保留。競合解消は本番受入完了を意味しない。**

1. 本番migration history・bucket/grants/trigger・flagsが未確認。承認されたread-only管理接続で
   `supabase/preflight/pulse_update.sql` と実履歴を照合し、backup/rolloutをレビューする。
2. S09: 実Cloudflare target/plan/date/CPU/memory、64MiB working set、長曲/VBR/端末codec matrixが未完了。
   同じartifactで実測するためのstaging権限・実端末が必要。
3. S10: 実scheduler URL/token/enable設定、実cron、失敗通知・継続監視・dead letterの運用確認が未完了。
   運用先と承認を用意してから設定する。
4. 実iPhone/Safari、Firefox/WebKit、screen reader、software keyboard/lock復帰、offline/別account/複数tab matrixが未完了。
   認証済みstagingと実端末で残るmatrixを実行する。
5. D14: Supabase CLI start/reset/lint・GoTrue全認証経路の再現は未完了。
   十分なdiskの隔離local stackで完了する。本番resetは行わない。
6. 本番deploy SHAとproduction smokeは未確認・未実施。DB適用・deployは別途承認が必要。

追加9 migrationのgate初期値OFF、envとschema readinessのAND条件、およびrollback手順は維持。
本番gateの実状態をローカルファイルから推定しない。必要条件を満たすまでgateを有効にしない。
