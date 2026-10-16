# Song Settings 実装・検証記録

記録日: 2026-10-17 JST。**公開完了ではない。** 本番権限・実端末・実デプロイ先の検証が不足しているため、追加した機能を本番で有効にしない。

## 対象と main の差分

- 指示書: `docs/pulse-lane-song-settings-codex-instructions.md` 全文。調査基準 `40347afc5ef15e67f3f901d970e4fffac1fd3643`、追加 commit `4e543a40734d1363039269a566937ef82bad7037`。
- 作業 branch: `codex/song-settings-update`。実装 commit `2d7034d`。最新 main `96449aab48f8c6ac5e4a87594db034cb7dbdc9ca` を merge commit `056a448` で取り込み。公開履歴の書換えなし。
- 開始時 main と調査基準との差は指示書追加のみ。再開後の fetch で main に4 commit追加を検出。キー2セット、認証 broker、PostgREST version 14.17、Lovable build config 2.26.5 を保持した。型再生成で削除されていた既存 UpgradeTables/UpgradeFunctions と songs 拡張を復元し、revision/XP/metadata の既存型契約を保った。
- main の keyMap が primary key 自体を filter する問題は、重複を除いて両セットを保持する修正と実 judgement 経路の回帰試験を追加した。判定窓・音声時刻・キャリブレーション式は変更しない。
- 関連履歴: merged PR #6/#7 の FNF 両側保持・選択側採点を維持。別の入力調整 PR をこの変更に混ぜていない。

## 実装

MY TRACKS の選択、44px 管理メニュー、明示 PLAY とネイティブ double tap/mouse double click、プロフィールを保持する Radix modal を追加。dirty close/history guard、nullable preview、文字列 BIGINT version、競合時の draft 保持、同一 requestId の receipt 照合を実装した。

共有 AudioSession の owner lease、1ms seek、実 media clock による区間終了、Worker の全曲10ms min/max波形、32 MiB memory/IndexedDB LRU、legacy source の不変 snapshot、Native BPM/各形式 Offset の新 revision、既存 replacement の共通 prepare/commit への統合を追加した。WAV、MP3、Ogg Vorbis/Opus、AAC-LC in MP4/M4A、WebM Opus をローカル同梱 decoder で処理する。全体 PCM decode、WebCodecs、外部 CDN は使わない。AAC-LC以外など非対応 profile を全 AAC 対応と表記しない。

画像は既存 staging/private bucket・reservation を再利用。header と実 pixel decode、canonical reencode、insert-only upload、hash検証、原子的 pointer swap、未保存候補の期限と quota、exact-path lease cleanup を追加。PLAY 背景は表示層に配置し、ノーツや入力を変更しない。署名更新・失敗 fallback・ユーザー設定の dim を維持する。

既存 Supabase owner auth、metadata validator、revision/read、React Query、Radix、AudioSession、ゲーム settings、画像 bucket、XP/result 基盤を再利用した。新しい汎用 job 基盤は追加していない。

## DB / API / Storage

追加 migration は次の9本。既存13本と合わせてローカル22本を適用した。

```
20261016010000_song_settings_transactions.sql
20261016011000_song_asset_lifecycle.sql
20261016012000_song_source_preparation.sql
20261016013000_song_save_intents.sql
20261016014000_asset_reclaim_guards.sql
20261016015000_private_replacement_limits.sql
20261016016000_song_settings_readiness.sql
20261016017000_source_operation_quotas.sql
20261016018000_verified_image_immutability.sql
```

owner RPC は version を SQL text で射影する。service-only RPC の actor/owner検査、durable save intent、receipt-first 冪等処理、行 lock 下 CAS、metadata/image/revision 同時 commit、protected column trigger、immutable registered bytes、terminal orphan GC marker を追加。旧 metadata RPC と publish 経路にも共有検証を適用した。型は CLI 2.121.0 によりローカル適用済み schema から生成し、nullable RPC引数のみ transport 層で補正している。本番生成の型ではない。

`/api/internal/asset-cleanup` は token 未設定503・不一致403。SQL が claim したパスだけを削除し、429/5xxを記録して再試行する。失敗件数が残る場合は503を返し scheduler の失敗検知につなぐ。5回失敗は dead letter。workflow は15分間隔の定義だが `PULSE_CLEANUP_ENABLED` が true の場合だけ稼働する。

## 再現コマンドと証拠の範囲

Node 24.19.0 / Bun 1.3.10 / PostgreSQL 17.11 / Supabase CLI 2.121.0 / Wrangler 4.150.0。ログはローカル ignored `work/final-*.log` に保存。秘密を含む接続設定は commit しない。

```sh
bun install --frozen-lockfile
npm test
npm run typecheck
npm run typecheck:song-settings-tests
npm run typecheck:song-settings-e2e
npm run build
npm run lint
git diff --check
```

private Artifact Registry の config 2.26.5 download は403。同一 version・同一 lock integrity の公式 npm package を隔離 cache に取得した後、frozen install が成功した。lock version、24h supply-chain guard、既存 exclude は変更しない。私設 registry の未認証 download 自体が成功したという意味ではない。

追加検証:

```sh
# 独立した localhost PostgreSQL。新規一意名DBを作り、共有DBを reset/drop しない。
PULSE_TEST_DATABASE_URL=postgres://LOCAL_ROLE@127.0.0.1:LOCAL_PORT/postgres node scripts/verify-song-settings-postgres.mjs

# この検証専用の exact container 名のみ再作成する。共有 stack には向けない。
node scripts/start-song-settings-storage.mjs
node scripts/verify-song-settings-storage.mjs
PULSE_REAL_STORAGE_TEST=true npx vitest run tests/song-settings-services.test.ts

# build 後の実 artifact を local workerd で検証し、検査用 export は終了時に復元する。
WRANGLER_BIN=/path/to/wrangler-4.150.0 node scripts/verify-song-settings-runtime.mjs

python3 -m pip install -r tests/e2e/requirements.txt
npm run build:e2e
npm run preview:e2e
# 別 terminal、Chromium の実パスを指定可能
PULSE_E2E_URL=http://127.0.0.1:4175 CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Storage verifier は PostgreSQL、PostgREST 16.4、Storage API 1.82.1 の実サービスと実署名 JWT を使用する。GoTrue login と本番 JWT、production middleware 全体を合格したとは扱わない。最小 bootstrap の auth schema と baseline Storage grants はテスト用である。

ブラウザ harness は本物の React/Radix/Router/AudioSession/Worker/HTMLAudio を使うが、owner transport・保存 API は制御 fixture である。実 server 保存は別の Storage service test で検証する。dev Worker の CommonJS interop 問題を避けるため、codec検証は build 済み harness で行う。

### 検証結果

- native PostgreSQL:22 migrations、複数 connection CAS、5件同一 request の1 receipt、実 SQL role、同時 revision 採番、4回 cleanup/save race が成功。
- actual Storage:owner/anon/foreign 認可、service-only RPC、protected pointer、署名 upload、upsert/path拒否、実サイズ、2h token/1h予約差、画像 byte/identity 不変、参照保持、lease実削除、revision GC marker が成功。
- actual services:7件成功。metadata-only、legacy snapshot/timing、実画像 upload/canonical/swap、AAC replacement/retry、current AAC 全再検証、非ゼロ Score/結果/XP保持、Storage429→実 cleanup retry/credential拒否。
- local workerd:6音声形式の1125ms impulse、JPEG/PNG/WebP、100 MiB PCM streaming、100 MiB+1拒否、SVG拒否が成功。最大2048²の3画像形式も個別試験成功。これは deployed target の S09 合格ではない。
- 全体 lint は開始時156 errors/7 warnings。main取り込み前の再実行も同じ件数。変更ファイル lint は0 error/0 warning。無関係な全体 format/disable は行っていない。
- 最終 main 統合後の test/type/build/E2E 件数は、この記録末尾の最終実行結果に記す。

## 本番適用状態（ファイルの存在とは別）

| 項目                         | 実際の確認状態                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| 本番 migration versions      | **未確認**。本番 DB 管理接続なし。ローカル22本は本番適用の証拠にならない                               |
| 本番 flags                   | **未確認**。追加 migration の初期 DB gates は全 OFF。server env も明示 true と schema readiness の AND |
| deploy SHA / Cloudflare plan | **未確認・本作業から deploy なし**                                                                     |
| scheduler                    | workflow定義のみ。default branchへの公開・vars/secrets設定・実cron実行・監視は未実施                   |
| production smoke             | **未実施**                                                                                             |
| 本番データ変更               | migration/apply、upload、保存、削除などは行っていない                                                  |

環境 status には secrets/runtime variables/outbound identities の設定がなかった。公開 URL や repository の schema ファイルから本番適用済みと推定しない。read-only administrator 接続で `supabase/preflight/pulse_update.sql` を実行し、既存 migration history の差と bucket/grants/trigger を確認してから rollout を判断する。

## Rollout と rollback

1. 対象環境・管理接続・backupを確認し、read-only preflight と実 migration history の照合を保存する。不一致時は停止する。
2. 追加9 migration を通常の forward migration として適用し、gates OFF で既存read/PLAY・旧metadata・revision immutability・owner認可を smoke する。本番 reset は使わない。
3. デプロイ artifact の SHA、Cloudflare target/date/plan/CPU-memory制限を記録して S09 を実施する。画像/codecが失敗する環境では該当gateを開けない。
4. cleanup URL/TOKEN/enable variable を対象 scheduler に設定し、手動→実cron→失敗通知→retry/dead-letter監視まで S10 を確認する。token はログ・PRに記載しない。
5. staging の browser/実端末認可試験後、DB gate と env gate を段階的に有効化する。metadata/image/timing 各経路と既存 Score/XP/新旧revision を確認する。
6. 問題時は DB `song_settings_gates` の全 boolean と対応 env gates を OFF にし、新規 mutation を止める。既存 read/PLAYを維持し、cleanup は状態を確認してから停止する。旧 app artifactへ戻す場合も expand schema/registered files/receipts/旧revision は残す。破壊的 down migration、履歴削除、version 巻戻し、registered bytes上書きは行わない。

## 未完了の受入条件と blocker

### S09 / 波形 resource budget / §16.5 codec・長曲・実 head

実 deployed Cloudflare account/target/plan権限と実 mobile 端末がない。静的 WASM import の query消失、tree-shaking、Vorbis constructor重複を調査・修正し、実 build の local workerd では6形式と100 MiB境界を確認した。Wrangler 4.150.0のlocal対応日は2026-10-13で、production build の2026-10-16と異なる。64 MiB working set の実端末測定、実 target CPU/memory、2時間長曲/VBR/全対応profileの端末 matrix、実head誤差の記録は未完了。local成功を本番合格に数えない。必要環境を用意し、同じ artifact/hashで測定するまで公開不可。

### S10 / scheduler・運用監視 / production rollout

認証 endpoint、実削除、429 retry、SQL lease/dead-letter、default OFF workflow は実装・ローカル試験済み。実 scheduler token/URL設定権限・本番deployがなく、cron実行・失敗通知・継続監視を開始できていない。read-only production migration照合も同じ接続不足。次に管理接続、deployed SHA、scheduler設定と監視先が必要。flagsを未確認のまま有効にせず、公開不可。

### §16.5 / I02〜I12 の実ブラウザ・実端末 matrix

Chromium viewport/harness、gesture単体、AudioSession/ゲーム統合、実 Storage を分けて検証している。Firefox/WebKit、実 iPhone Safari、VoiceOver/PC screen reader、software keyboard/lock復帰、notch、200%zoom、offline→online/別account/実2tabの全組合せは未実施。エミュレーションを実機合格と報告しない。必要なブラウザ・端末・認証済み staging で残る matrix を実行する。公開可否は保留。

### D14 / CLI local reset・lint と production相当 auth

Supabase CLIの通常 stack 起動は3通り試した。既定 registry は403、Docker Hub切替はSupabase PG大容量 imageでdisk不足、最小service指定でも同PG imageで不足した。従って `supabase start` は成功せず、`db reset --local` は local stack未起動、`db lint --local` は54322接続拒否で未成功。代わりに native PG17と小さい実 Storage/PostgREST stackで22 migration・upgrade・roleを確認したが、CLI commandsやGoTrue認証の合格には代用しない。十分なdiskの隔離 Supabase stackでreset/lintとauth middleware経路を完了する必要がある。本番resetは行わない。

### 全体 lint

着手時156 errors/7 warnings、最新main統合後159 errors/7 warningsが残る。今回のorigin/mainとの差分に対する違反は個別検査で0。既存違反を消すための無関係な大量整形は行わない。従って「全 validation 成功」ではない。

## 最終実行結果

最新 main 統合・padding終端修正後の結果:

| command / 環境                                               | 結果                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| frozen install / Bun1.3.10                                   | 成功。同一lock・同一integrity cacheを使用                                                |
| npm test / Node24.19.0                                       | 26 files成功、259件成功、実Storage用7件を通常実行ではskip                                |
| PULSE_REAL_STORAGE_TEST=true / 実Storage                     | 別実行で7件すべて成功                                                                    |
| アプリ・song-settings-tests・song-settings-e2e の3 typecheck | すべて成功                                                                               |
| npm run build / config2.26.5                                 | 成功。既存系統のchunk-size warningあり                                                   |
| native PostgreSQL17.11                                       | 22 migrationと複数接続競合検証成功                                                       |
| actual PostgREST16.4 / Storage1.82.1                         | 認可・不変性・実削除すべて成功                                                           |
| build済み Chromium harness                                   | 14項目成功。4 viewport、50 Worker/audio開閉、receipt loss、touch、6 codecs               |
| local workerd / compat2026-10-13                             | 12項目成功。実production date/planの代用ではない                                         |
| 全体 lint                                                    | main取込後159 errors / 7 warnings。着手時156/7からの増分は取り込んだmainのファイルを含む |
| origin/mainに対する変更/追加TS・TSX・mjs lint                | 0 error / 0 warning                                                                      |
| git diff --check                                             | 成功                                                                                     |

最終全体 lint は失敗のままであり、全validation成功とは扱わない。ソースと受入matrixの未完了は上記のとおり。

ブラウザ codec impulse は6形式すべて500ms、WASM duration は1125ms。Chromium media duration は WAV/MP3/Vorbis/AAC が1125ms、Ogg Opusが1131.5ms、WebM Opusが1133msであった。container paddingを試聴区間に含めないよう、owner sourceとregistered revisionの検証済みdurationをAudioSessionへ渡し、media durationとの小さい方を終端にする。seek範囲・D−1msの回帰試験も追加した。
