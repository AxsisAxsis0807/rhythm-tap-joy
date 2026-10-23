# Pulse Lane 既存楽曲編集 / Song Settings Update
# Codex実装指示書

調査日: 2026-10-15〜16（JST）。2026-10-16の再確認でもmain HEADは同一。  
対象: `AxsisAxsis0807/rhythm-tap-joy`  
調査基準main: `40347afc5ef15e67f3f901d970e4fffac1fd3643`  
文書の性質: 現行コード・履歴を調べた上で作成した、次のCodex作業用の実装契約。**この文書を作成したWorkの作業では、機能実装・commit・push・本番変更を行っていない。**

## 0. この指示書を受け取ったCodexへ

この文書に従って、Pulse Laneの「プロフィール → 自分の投稿楽曲 → 楽曲設定」を既存コードへの差分として実装してください。最初に現在のリポジトリ、AGENTS.md、main HEAD、作業ブランチ、未コミット変更、関連PR、migration適用状況を再確認してください。以下の調査基準から変更があれば、その差分を読み、既に追加された機能を重複実装しないでください。

この文書の「既存」は調査基準commitのソース上の事実です。「新設案」「追加」は今回実装する契約・提案名であり、現在存在するファイル/APIとは区別しています。実装開始時に同等機能が存在したら統合してください。

最終的に必要なのは次の動作です。

1. 自分の投稿曲を1回タップして選択し、曲名枠の右端の「⋮」から「編集」を開ける。
2. プロフィールを背面に保ったフローティング設定パネルで、18秒の試聴開始位置を実波形と試聴で調整できる。
3. 背景画像［Beta］を安全にアップロード・プレビュー・差し替え・削除でき、保存後の実際の表示へ反映される。
4. 既存metadataを確認・編集できる。実タイミングに影響するBPM/Offsetは不変Revisionを新設し、過去の結果を保つ。
5. 所有者認可、原子的な保存、競合検出、再送、画像cleanup、スマホ・PC・アクセシビリティまで完成する。

**完遂ルール**

- 明示的な除外項目以外は今回の実装対象。波形・画像処理・cleanup・BPM/Offset・認可試験等を、独断でFuture Work／将来対応／スコープ外へ移さない。
- 問題が出たら原因を調べ、安全に修正できる範囲で継続する。コードを書いただけで完了としない。必要なtests、typecheck、build、lint、migration検証、RLS/Storage検証、回帰確認まで行う。
- 推測による危険な変更、データ損失、既存機能の破壊、認可や検証の弱体化で「完成」させない。
- 同じ問題への安全な修正は原因・仮説を変えながら最大3回程度。解決しなければその問題を止め、原因・試行・残件・次の作業を記録する。独立した安全な作業は続行できるが、公開に必要な問題が残れば公開完了と報告しない。
- インフラ、資格情報、実端末などが不足して実施できない検証は、未実施として明記する。mock、PGlite、Chromium端末エミュレーションを本番Supabaseや実機Safari合格に数えない。
- AGENTS.mdのLovable履歴保護に従う。公開済み履歴のforce push、rebase、amend等は禁止。既存FNF左右metadata、選択側採点、設定の保存形式・判定時刻を維持する。

## 1. 調査で確認したリポジトリ状態

### 1.1 基準・履歴・ブランチ

| 項目 | 確認結果 |
|---|---|
| GitHub default branch | `main` |
| main HEAD | `40347afc5ef15e67f3f901d970e4fffac1fd3643`、2026-10-15 17:25:24 JST |
| 調査用checkout | mainを独立clone。開始時・検証後ともtracked差分なし。作業ブランチを作成していない |
| 最新PR #7 | merged。`codex/fnf-gameplay-investigation` / `baa76aa...`。キャリブレーション補正符号と実プレイ経路の統合試験 |
| 直前の大型更新PR #6 | merged。`codex/pulse-lane-next-update` / `80ee05e...`、merge `e2988ba...`。共通詳細、18秒試聴、metadata CAS、Revision、画像予約、XP基盤 |
| PR #5 | open。`fix/centered-input-fnf` / `b51aefc...`。mainへ統合済みと扱わない |
| PR #4 | open。`feat/verified-xp-backend` / `17b1cbb...`。別のXP案を現mainの基盤に重ねない |
| その他のremote branch | `feat/global-score-ranking`、`fix/global-ranking-reliability`、`fix/ranking-completion`、`fix/touch-input-key-overlay`、`work`。存在だけで作業基準にしない |
| HEADのGitHub status / Actions | combined statusの件数0、該当workflow run 0。公開Lovableのdeploy SHAを証明する情報ではない |
| AGENTS.md | ルート1件。Lovable履歴保護、FNF左右保持、選択側採点、hydration後のversioned設定保存 |
| 調査範囲 | tracked 204ファイルのtree/構成を列挙。主要UI・音声・parser・server・DB・全13本のmigrationの構成/依存・関連テスト・既存検証文書を照合。巨大な内蔵譜面配列はデータ定義/利用経路を対象とし、全ノーツの正誤監査はしていない |

参照: [HEAD](https://github.com/AxsisAxsis0807/rhythm-tap-joy/commit/40347afc5ef15e67f3f901d970e4fffac1fd3643)、[PR #7](https://github.com/AxsisAxsis0807/rhythm-tap-joy/pull/7)、[PR #6](https://github.com/AxsisAxsis0807/rhythm-tap-joy/pull/6)、[PR #5](https://github.com/AxsisAxsis0807/rhythm-tap-joy/pull/5)、[PR #4](https://github.com/AxsisAxsis0807/rhythm-tap-joy/pull/4)。

### 1.2 構成と依存

| 項目 | package.json指定 / bun.lock解決値 |
|---|---|
| React / React DOM | `^19.2.0` / `19.2.8` |
| TypeScript | `^5.8.3` / `5.9.3` |
| TanStack Start | `1.168.60` |
| TanStack Router | `1.170.41` |
| TanStack Query | `^5.101.1` / `5.101.4` |
| Vite | `8.1.5` |
| Nitro | `3.0.260603-beta`、buildの既定targetはCloudflare |
| Lovable Vite設定 | `@lovable.dev/vite-tanstack-config` `2.25.3` |
| Supabase JS | `^2.116.0` / `2.116.0` |
| Radix Dialog | `^1.1.15` / `1.1.23`。dialog/dropdown/alert-dialog/slider等の既存wrapperあり |
| CSS | Tailwind v4、tw-animate-css、既存の暗色/cyan中心のデザイン |
| テスト | Vitest、Testing Library、jsdom、PGlite |
| lockfile | `bun.lock`のみ。勝手にpackage-lock.jsonを追加しない |
| schema管理 | Supabase migrationsが正。Drizzleのchart_author追加履歴は残すが再実行しない |

`src/routes/index.tsx`が`RhythmHub`を表示する。画面切替は主として`RhythmHub`の`screen` stateであり、プロフィールや編集用の独立routeは現在ない。`src/router.tsx`にQueryClientがあるが、**現在の楽曲一覧はReact QueryではなくuseStateと手動fetch**。Queryのinvalidateだけでは一覧更新にならない。

`vite.config.ts`のLovable wrapperがTanStack/React/Tailwind/Nitro等を導入する。プラグインを重複追加しない。`.server.ts`のservice-role clientはserver専用、`.functions.ts`はclientからもimportされる。`src/start.ts`の認証付与とCSRF middlewareを維持する。

### 1.3 今回実行した基準検証

ソースを変更せず、既存の利用可能な依存ディレクトリを調査checkoutへ接続して実行した。

| 検証 | 結果 / 限界 |
|---|---|
| `npm test` | 18 test files / 214 tests成功 |
| `npm run typecheck` | 成功 |
| `npm run build` | Vite + Nitro Cloudflare build成功 |
| 全体ESLint | 156 errors / 7 warnings。既存の14ファイルにerror。今回の機能は未実装 |
| tracked差分 | 検証後もなし |
| lockfile完全再現 | 未実施。この環境のPATHにBunなし。利用依存のLovable configは2.25.2、Reactは19.3.0でlockと異なる。上記成功をfrozen installの成功としない |
| 実DB・Storage・iPhone | 未検証。管理DB接続/service-role資格情報なし、実機試験なし |

前回文書のArtifact Registry 403は**前回記録**であり、今回も同じinstallを実行して失敗したという意味ではない。Codexは自環境で正しいBunとlockfileから再検証する。

### 1.4 本番について確認できない事項

本番Supabaseのmigration適用履歴、実schema、RLS/grants、bucket設定、実運用flag、cleanup scheduler、公開frontendのcommitは未確認。`.env`には接続先・publishable key用の変数名があるが、管理権限を意味しない。秘密値を文書やログへ出さない。

「migrationがGitにある」「前回PRがmerged」「型に列がある」を「本番適用済み」の証拠にしない。前回PR/文書は当時の本番適用を未実施と記しているが、その後の運用変更の有無までは分からない。

## 2. 既存・再利用・不足の対応表

以下のpathはすべて調査HEADに実在する。

| 領域 | 既存実装 | 今回の扱い |
|---|---|---|
| プロフィール/MY TRACKS | `src/components/app/RhythmHub.tsx`内`ProfileScreen`。自分の`songs.user_id`で取得、行ごとにPLAY/譜面を編集 | 選択行+右端⋮へ置換。プロフィール本体は維持 |
| 通常選曲/詳細 | 同ファイル`SelectScreen`と`src/components/app/SongDetail.tsx`。所有者には編集ボタンも出る | 今回の希望に合わせ、この管理入口を除去。通常の選択・START・style操作は維持 |
| 簡易metadata編集 | `SongMetadataEditor.tsx`、`SongMetadataFields.tsx` | 基盤を拡張・置換して浮動パネル化。旧画面と二重運用しない |
| 曲取得 | `src/lib/chartRepository.ts`の`normalizeSong/listPublicSongs/songToEntry/loadPlayableChart/getSongPreview/updateSongMetadata` | 共通の取得・保存窓口として再利用。新しい別repositoryを重複させない |
| metadata保存 | `update_chart_metadata` RPC。owner確認、row lock、metadata_versionとcurrent_revision_idのCAS | 入力検証を共通化し、一括保存/RPCの内部へ統合。互換wrapperを維持 |
| Revision | `RevisionPublisher.tsx`、`chart.functions.ts`、`chartRevision.server.ts`、`chartValidation.ts` | 不変snapshotの設計を再利用。timing-only更新を追加し、再uploadを必須にしない |
| preview | `audioSession.ts`、`useAudioPreview.ts`、`SongDetail.tsx` | shared context/世代管理/排他を維持し、編集用seek/head/owner leaseを拡張 |
| 波形 | 実装なし、専用依存なし | 実データのpeaks、Canvas、Worker、cache、drag/数値操作を追加 |
| 画像基盤 | `image_reservations/image_assets/asset_cleanup_jobs`と3 private bucket定義 | 予約・quota・path規約を再利用。実decoder/canonical化/差替え/cleanup workerを完成 |
| 画像flag | `getUpdateCapabilities.imageUploadEnabled=false`固定。`profilePreferences.ts`もfalse | 楽曲背景専用capabilityを追加。プロフィール画像uploadまで無条件ONにしない |
| 旧投稿画像 | `UploadScreen/UploadTask`が`songs` bucketにbackground/cover等を保存 | 旧互換の読取元。安全な新背景編集経路としてそのまま流用しない |
| 背景の実表示 | `GameScreen.tsx`はradial effectとdimを描画。`Chart`に背景参照なし、`loadPlayableChart`も背景を渡さない | 表示用assetをgameplay identityと別に渡す経路を追加 |
| 設定UI | `SettingsDialog.tsx/SettingsPanel.tsx`。暗色panel、200ms、focus処理、body overflow制御 | デザイン/部品を再利用。既存手製focus trapをそのままコピーしない |
| modal部品 | `src/components/ui/dialog.tsx`、`dropdown-menu.tsx`、`alert-dialog.tsx` | Radixを利用。今回の寸法・閉じる確認・motion用に最小拡張 |
| Score/ranking | `playerRanking.ts/usePlayResult.ts/playResultQueue.ts`、`play_results/player_stats` | 変更目的外。保持と回帰試験 |
| XP/replay | `usePlaySession.ts/xp.functions.ts/xpWorker.server.ts`等、session/ledger/catalog | 旧revisionとの対応を保持。新revisionへ承認を自動コピーしない |
| 完全な履歴・router連動 | 現在の編集にはunsaved確認、browser back連動、原子的画像込み保存なし | 今回追加 |

### 2.1 見逃してはいけない現行の制約

- `getSongPreview()`は`current_revision_id`なし、または`preview_allowed=false`なら試聴sourceを返さない。旧公開曲を自動的に試聴許可済みと扱っていない。
- `preview_start_ms`はinteger nullable。未指定は実行時0秒。既存previewは18秒、終端では`min(start+18,duration)`、loopしない。
- 旧曲で非0のpreview位置を保存するには、現行RPCが検証済みRevisionのdurationを必要とする。UIだけ波形に変えても旧曲の編集は完成しない。
- `songs.bpm/offset_sec`は投稿時のコピー。現在のプレイはファイル/Revisionの`Chart.bpm/offset`を読む。**songs列だけUPDATEしても同期は変わらない。**
- FNFと.osu importerは`bpm=60, offset=0, beat=秒`へ正規化する。原曲BPMやテンポマップをそのまま保持していない。
- importしたFNF sustain/.osu long noteは、現状`kind:"tap"`に`lengthBeats`を付ける。今回勝手に`hold`へ変換すると採点が変わるため禁止。
- `parseNative()`はcanonicalの`chart.fnf`を引き継がない。既存canonical JSONを汎用importerへ再投入してtiming revisionを作らない。
- `createRevision()`は現状WAV/Oggに限定し、100MiBをdownload後に検査する。container確認は完全decodeではない。max(revision_number)+1も別transactionで競合し得る。
- `publish_chart_revision()`は`is_published=true`へ変更する。下書きの設定保存にそのまま使うと意図せず公開する。
- 現行Revision作成はrow INSERT→pointer CASで、失敗した候補もrowが残る。RevisionのSELECT policyは「公開曲に属するrevision」を許すため、未保存候補の作り方を今回見直す必要がある。
- `protect_canonical_storage`は`chart-revision-assets`のUPDATE/DELETEを全面拒否する。未登録の孤立ファイルを普通のcleanupで消せると仮定しない。
- `putWithProgress()`は`x-upsert:true`を固定する。insert-only stagingへ無修正で流用しない。
- 既存`SettingsPanel`のfocus候補は主にbutton/input/tabindex。select/textarea等を含む新フォームのfocus管理には不足する。onClose依存のeffect再実行にも注意する。

## 3. スコープと最終仕様

今回のUIは「楽曲専用の設定」。投稿フォームの再表示やページ全面置換にしない。主sectionは「試聴」「背景［Beta］」「基本情報」の3つ。既存の曲名/artist/難易度名/譜面制作者/説明/推奨styleを基本情報に収める。

既存の音源・譜面ファイル差替え機能を消さない。`RevisionPublisher`は「音源・譜面を差し替える」の折りたたみ高度操作へ移し、共通保存・競合規約に従わせる。今回の通常BPM/Offset編集でファイル再選択を要求しない。

明示的な除外: 本格Chart Editor、途中背景切替、背景timeline/event、PiP API/別窓/動画PiP、Patreon、Supporter、XP Boost、課金、Rating/Ranked Score、通常選曲の大改造、不要な判定変更、TOTAL SCOREランキング再設計。波形の表示zoomやpanelアニメーションをPiPとして実装しない。

## 4. MY TRACKSの操作

### 4.1 行の構造

- `ProfileScreen`に`selectedMySongId`を持つ。複数同時選択なし。再取得で同じidがあれば維持、削除/別accountでは解除。
- 曲名部分はnative buttonで選択操作、`aria-pressed`で選択を表現。行内にボタンを入れ子にしない。listboxのoption内にmenu等を詰め込まない。
- 1回タップ/クリックで即時に選択表示する。double tap待ちのためsingle選択を遅延しない。
- 選択された行だけ、曲名枠の**一番右端**に44×44 CSS px以上の⋮ボタンを表示する。未選択時もその幅を予約してタイトルが跳ねないようにする。
- `aria-label="{曲名} の管理メニュー"`、`aria-haspopup="menu"`、開閉状態を設定。lucideの`MoreVertical`等の既存icon体系を使用。
- menu項目は最低「編集」「プレイ」。削除・公開変更など未依頼の破壊的操作を追加しない。
- 選択行にはmenu外にも「プレイ」buttonを補助表示する。double tapが苦手な人も同じ既存フローへ進める。
- 通常の選曲/共通詳細には管理menuを出さない。`SongDetail.onEdit`と`SelectScreen.onEdit`の既存配線を整理し、入口はプロフィールのみとする。

### 4.2 double tap / double click

| 入力 | 動作 |
|---|---|
| mouse single click | 選択のみ |
| mouse double click | native `dblclick`から1回だけ既存`selectSong(songToEntry(song))`へ。2回のclickによる選択は無害であること |
| touch/pen 1tap | pointerup時に有効なtapを確定して選択 |
| touch/pen 2tap | 同じ曲・同じ主pointer系統・2tap間350ms以内・両tapの移動各8px以内・tap位置差12px以内を初期値とし、既存の曲詳細/STARTへ1回だけ進む |
| drag/scroll/pinch/multitouch | double tap候補を破棄。pointercancel/lost captureでもリセット |
| keyboard | Tab→曲button、Enter/Spaceで選択。次のTab→⋮/プレイ。⋮はEnter/Space、menu内は矢印/Enter/Esc |
| screen readerの合成click | 通常buttonとして選択。touch判定と混ぜない。明示的PLAYで再生経路へ進む |

350ms等はPulse Laneの初期操作値であり、OS標準の保証ではない。PCはnative double-click判定を使う。touch処理後の互換mouse/clickによる二重遷移を抑止し、長押しやsecondary pointerをtapに数えない。

「double tapでplay」は**既存の曲詳細→style選択→STARTフローへ進む**意味。いきなり楽曲を自動STARTしてstyle確認を飛ばさない。`selectSong/startSong`のgeneration guardを再利用する。

menu/PLAY/編集のbuttonイベントは行のdouble tap判定へ伝播させない。menuを開いた時点でtap履歴を消す。gesture用refは曲id変更・閉じる・account変更でも消す。

行の操作領域に限り`touch-action:manipulation`を候補とし、pinch zoomと縦scrollを維持する。ページ全体の`touch-action:none`や`user-scalable=no`は使わない。[W06][W07]

## 5. フローティング楽曲設定パネル

### 5.1 見た目・配置

| 対象 | 指定 |
|---|---|
| 背面 | プロフィールをmountしたまま保持。選択曲・scroll位置・入力中プロフィールを保持 |
| パネル | `#101522`系、白10% border、既存の角丸/typography/field/button。巨大ネオンなし |
| スマホ縦 | 左右12pxを基本余白、safe-areaが大きい側はその値+余白。幅はviewport内、max-heightはvisual viewportと`100dvh`から上下余白を引く |
| PC | max-width 880px程度、内容高を基本にmax-height=min(820px, viewport余白内)。中央配置 |
| 狭い/横画面 | 余白8pxへ縮小可。固定min-heightを置かずheader/footerを小さくし、本文をscroll。閉じる/保存が常に到達可能 |
| header | 「楽曲設定」、曲名（折返し可）、公開/下書き表示、右上×。作者やrevisionの詳細は基本情報へ |
| navigation | 3つのsection切替。スマホは上部横並び、PCは小さい左sidebar可。波形幅を確保 |
| footer | 「変更を保存」「キャンセル」、変更有無/保存状態。stickyでも入力欄を覆わない |
| motion | 既存に合わせ150〜200ms程度のopacity+小さいtranslate/scale。閉じるanimationもpresenceで完了させる |

`SettingsPanel`の見た目を参考にし、既存Radix `Dialog`/`DropdownMenu`/`AlertDialog`を再利用する。現行94dvh・下辺密着sheetをそのままコピーしない。`ui/dialog.tsx`の既定max-widthやclose buttonが邪魔なら、後方互換なpropsでoverlay class/close表示等を拡張する。一般設定の自動保存文言をコピーしない。[W08][W09]

### 5.2 開閉・focus・history

- `editingSongId`/routeのoverlay状態を唯一の真実とする。`screen="edit"`でプロフィールをunmountする実装を置換する。
- 開く前にowner確認済み最新rowを取得。取得中はshell+skeleton。権限なし/削除/不明は編集フォームを出さない。
- 開始focusはモバイルのソフトkeyboardを勝手に開かない見出し（`tabIndex=-1`）または閉じるbutton。Tab循環はRadixに任せ、背景をinertにする。
- 閉じる時は、元の⋮が存在すればそこへ、なければ対象曲button、それもなければMY TRACKS見出しへfocusを戻す。
- ×/Esc/backdrop/browser back/内部navigationは共通`requestClose(reason)`へ集約。dirtyなら「変更を破棄 / 編集に戻る」。確認dialog内のEscは確認のみを閉じ、編集を残す。
- backdropは同一pointerのdown/upがともに背面だった場合だけ閉じる。波形内から外へdragしたreleaseで閉じない。
- menuと編集panel、一般設定panelを重ねて同時起動させない。menu選択後に開くfocus移行を制御する。
- body scroll lockの取得/解除をmodal基盤1か所に任せる。手製overflow effectとRadixを重ねない。StrictModeのmount/unmount、保存失敗、owner変更でも復元する。
- **browser back**: 既存Routerにoptionalな`?songSettings=<uuid>`だけを追加する案を採用。`src/routes/index.tsx`で検証する。内部から開く時はpush、backで閉じる。direct URLのowner曲はプロフィールを表示して開く。閉じる時は内部open markerがある場合のみback、direct entryではsearchをreplaceで除去する。
- TanStackのnavigation blockerでdirtyなsearch離脱を止める。raw `history.pushState`とRouterを並行使用しない。既存のlocal `screen`変更もmodal開中は共通close判定を通す。back後の復元ループや履歴の二重pushを作らない。[W10]
- refresh/タブcloseはdirty時だけbeforeunloadを補助使用する。モバイルOS終了まで確認を保証できると説明しない。
- OSの`prefers-reduced-motion` **または**既存`settings.reducedMotion`がtrueなら移動/scale演出を停止。playhead自体は必要な情報として更新する。CSSのみとアプリ設定のみの片方に限定しない。[W11]

### 5.3 stateの分離

新設案`useSongSettingsDraft`に次を分離する。

| state | 内容 |
|---|---|
| identity | `ownerId, songId, sessionGeneration` |
| base | 最新の確定row、metadataVersion、currentRevisionId、source fingerprint |
| draft | 曲名等、nullable previewStartMs、背景操作keep/replace/remove、timing変更値 |
| derived | dirtyFields、fieldErrors、effective preview end、timing変更有無、source format |
| transport | idle / loading / preparing / saving / reconciling / conflict / error / saved |
| image | empty/current/local-processing/uploading/verifying/ready/error + reservationId。upload進捗とDB保存進捗を混ぜない |
| audio | controllerのowner token、waveform状態、view range、requested preview start。再生headはdraft保存項目ではない |

dirtyは正規化した永続対象だけを比較する。tab、scroll、playhead、音量の操作だけではdirtyにしない。取得が遅れて到着してもdirty draftを上書きしない。account変更は全requestを無効化し、前ownerのdraft/URLを新ownerへ出さない。

## 6. metadataの正式分類

A=通常編集、B=表示のみ、C=自動算出、D=Gameplay Revision、E=ユーザー編集禁止。これは実保存方法の分類で、B/Cが同時に当てはまる項目は両方記す。

| 情報 | 現在の保存/利用元 | 分類・今回の仕様 |
|---|---|---|
| 曲名 | songs.title / canonicalにもsnapshot | A。現在の表示はsongsを優先、旧canonical hashは書換えない |
| artist | songs.artist | A、120文字以内の新値 |
| 譜面制作者 | songs.chart_author | A。単なる表示文字列。owner identityではない |
| 難易度名 | songs.difficulty_name | A、40文字以内。notes/XP groupを変更しない |
| 説明 | songs.description | A、2000文字、plain text。HTMLとして描画しない |
| 推奨Play Style | songs.recommended_play_style | A、null/mania/fnf。explicit selection > recommendation > last > maniaの順序を維持 |
| preview開始 | songs.preview_start_ms | A、nullまたは整数ms。信頼できる音源durationが必要。旧曲は§9の準備を行う |
| 背景 | 旧songs.background_path | A。新しいverified asset参照を追加。score hashには含めない |
| NativeのBPM | parsed/canonical Chart.bpm | D。beat-basedと証明できる場合に編集 |
| .osu/FNFの内部60 | parsed/canonical Chart.bpm | B/C。「原曲BPM 60」と誤表示しない。タイミング用の内部値、変更不可 |
| 原曲のテンポmap | 現在の正規化では保持なし | 新しい手入力のテンポmap/曲BPM列を作らない。読めない値を推定表示しない |
| 譜面Offset | Chart.offset（秒）、songs.offset_secはコピー | D。UIは符号付きms、保存canonicalは既存の秒 |
| 端末入力補正 | settings.timingOffsetMs / RunConfiguration | E（この画面では編集しない）。譜面Offsetと区別 |
| ノーツ数 | parsed.notes.length / revision.note_count / songs.note_count | B/C。採点側のhead数。MISS総数や判定イベント数とは区別 |
| レーン数 | parsed/canonical / lane_count | B/C。新revision validatorは4K。旧非4Kを勝手に4K化しない |
| 音源時間 | revision.duration_ms / 実音源検証 | B/C。手入力禁止。ファイル末尾のノーツ時刻を音源長に代用しない |
| format / chart_type | importer識別 / songs.chart_type | B。新しいformat設定を手入力で追加しない |
| FNF左右・採点side | chart.fnf、songs.fnf_side | B、変更する既存ファイル差替え操作ではD。今回通常フォームには新side変更を追加しない |
| notes/hold/audio | canonical snapshot / Storage | D。既存差替え経路を維持するが、今回notes editorを作らない |
| cover/キャラ画像 | songs各path | B（必要な情報表示のみ）。今回背景以外の新しい画像編集UIは対象外 |
| 公開状態/公開日時 | songs.is_published/published_at | B。設定保存で勝手に変更しない。既存publish画面を維持 |
| owner/id/path/hash/version | user_id/current_revision_id/metadata_version等 | E。serverが決定 |
| rights/preview許可 | revisionのaudio_hashとpreview_allowed等 | E（通常metadata編集不可）。必要な新規同意は専用操作でserverがsnapshotへ反映 |
| Score/TOTAL SCORE/XP/Level/ランキング | play_results/player_stats/XP各表 | E。今回フォームに入力欄を作らない |

titleは変更時trim後1〜120文字。その他の既存上限は既存RPCと一致させる。legacyの長い未変更文字列は黙って切り詰めない。`metadata_version`はDB BIGINTなので、新契約は10進文字列で往復し、Numberの安全範囲超過を避ける。旧number契約はsafe integerを検査する互換wrapperにとどめる。

## 7. 18秒previewと波形UI

### 7.1 保存規約・終端

- `PREVIEW_DURATION_MS=18000`を既存audio層で共有する。自由長やloopを新設しない。
- durationをD、開始位置をSとすると、`0 <= S < D`、`end=min(S+18000,D)`。
- `S`は整数ms。UIは`01:24.350 → 01:42.350`形式。入力時にmsへ1回変換し、dragの積算浮動小数点をDBへ流さない。
- 未設定nullを保持する。既存のdefault 0秒へ解決する挙動を維持し、「既定の位置へ戻す」はnullに戻す。音源を開いただけで0を保存しない。
- 曲末尾も選択可能。`D-18000`へ勝手にclampしない。例えばD=90000/S=89999は1msの区間として保存可、UIは「終端までの0.001秒」を示す。実ブラウザが1ms音声を正確に聴かせる保証とは区別する。
- S=D/負数/NaN/Infinity/小数msはserverで拒否。曲全体が18秒未満なら全長まで。音源更新で範囲外になれば保存前に再設定を要求する。

### 7.2 表示と調整

- 全曲overviewの横長実波形、選択開始handle、18秒固定の半透明region、現在の再生headを表示する。end側は終端を示すだけで長さをdrag変更できない。
- overviewで大まかな位置を選び、下に選択位置周辺の拡大表示を用意する。zoomは波形の表示だけ。audio playbackRateは1。
- 時刻、開始位置の数値入力、±1秒/±100ms/±10msのstep control、必要時1ms入力を提供。ドラッグなし・keyboardのみでも同じ値へ設定できる。[W12]
- waveform領域の操作は「保存予定の開始位置変更」。再生headのseekとは別stateにする。試聴ボタンはdraftのSから再生。再生中seekは選択区間内へ制限し、Sを勝手に書き換えない。
- drag中に音声を何度もplayしない。開始時はpause、見た目の位置をrAFで更新し、release時に最新Sをcontrollerへ1回反映。既定では再生は明示buttonで開始する。
- `pointerId`とpointer captureを使い、横dragを扱う。通常領域は`touch-action:pan-y pinch-zoom`、必要な小さいhandleだけ制御を狭める。縦scroll優勢ならキャンセルし、ブラウザzoomを奪わない。
- loading、部分生成中、ready、音源なし、権限なし、codec非対応、通信失敗を別表示。波形がない時に乱数や装飾波形を出さない。
- Canvasは`aria-hidden`として隣接するslider/inputにラベル、min/max/value、時刻の`aria-valuetext`を提供。読み上げを毎frame更新しない。

### 7.3 AudioSessionControllerの拡張

`src/game/audioSession.ts`を唯一の試聴再生管理にする。waveformライブラリが別のAudioContext/AudioElementを勝手に再生する構成は採用しない。

追加API名は案: `acquirePreviewOwner(ownerKey)`、`updatePreviewSegment(token,startMs)`、`seekPreview(token,timeMs)`、`getPlaybackPosition(token)`、`releasePreviewOwner(token)`。既存の`selectPreview/play/pause/replay/retry/beginGameplay`を内部で再利用する。

- 編集panelがpreview leaseを持つ間は通常選曲previewを停止。古いcomponentのcleanupが新ownerの再生を止めないようtoken照合する。
- asset keyはaudio hash + immutable asset identity、selection keyはsong/settings session。signed URLやS変更は音源の別asset扱いにしない。同じ音源のdragで`load()`/source node生成を繰り返さない。
- `MediaElementAudioSourceNode`はelementごとに一度。elementを再利用できないpending play時は既存generation方式で廃棄する。
- pointerup/clickのuser gesture内で`unlock()/resume()`をawaitより前に呼ぶ。autoplay拒否は「タップして試聴」。一度unlockしたから全Safari条件で永久に再生可能と仮定しない。[W04]
- 現行のseek判定には20msの閾値がある。編集でSが1〜10ms変わった時にseekを省略しないよう、明示seek要求を区別する。**保存精度1msとブラウザ実再生精度は別**。[W05]
- headはmedia.currentTimeを根拠にし、performance.now/rAF累積だけで進めない。再生中のみrAFで表示を更新し、全フォームを毎frame再renderしない。
- 現行終了timerはwall clockなのでbuffering中に先に18秒を使い切る可能性がある。timerはwake-upとして実currentTimeを再確認し、waiting/stalled/seekを考慮して終端を判定する。loopしない。
- master×menu×preview volumeを維持。編集用音量変更で保存pending metadataを増やさない。
- signed URLは既存の残30秒判定/refresh最大1回を継承。refresh後もasset hashとowner/generationを確認し、権限取消や削除を無限retryしない。
- close/START/account変更/visibility hidden/pagehideで音声、timer、rAF、seek待ちを停止。復帰時は勝手に再開しない。共有AudioContext自体はpanelがcloseしない。
- selection変更中の古いsign/load/seek/play/onended/Worker返信を全部generation検証する。

## 8. 波形生成・cache・長時間音源

### 8.1 採用方式

**再生は既存HTMLAudioElement、波形は別の無音解析Worker+Canvas**とする。WaveSurfer等を「loadすれば完成」と導入しない。公式資料も全体decodeの大容量メモリ問題を示す。[W03]

新設案`src/workers/waveform.worker.ts`で圧縮データを段階読取し、PCMを短いchunkごとにmin/maxへ集約してすぐ解放する。WAVは検証済みPCMをchunk処理、Ogg Vorbis/Opus・MP3は作者公式のstreaming WASM decoderを候補の標準実装とする。AAC/M4Aはdemux+AAC decoderが必要で、拡張子だけでMP3 decoderへ渡さない。Mediabunnyの部分読取/packet API等を利用する場合も、WebCodecsの有無を検出し、必要codecのWASM経路を用意する。[W13][W14]

依存は実装時に作者公式API・ライセンス・供給元・対象runtimeを確認してpinし、Bun lockを更新する。外部CDNから実行時にcodecを読み込まない。browserの対応だけでCloudflare上の対応を保証しない。実際のbundleでWASMのstatic import/配置・CSPを確認する。

### 8.2 資源上限

- 本機能の検証済み音源範囲は既存Revisionの100MiB・2時間を基準とする。旧曲がこの範囲外でも既存PLAYを止めない。高度設定準備に失敗した理由を表示し、title/背景等の独立編集を継続できる。
- 入力は1assetずつ、同時decode1件。取得の実受信byte数を制限し、Content-Lengthだけを信用しない。download完了後に初めて上限を検査する方式を新設しない。
- 10ms窓のmin/maxを各Int16に量子化し、全channelのmin/maxを取る（単純mono平均による逆相相殺を避ける）。2時間でも基本peaksは約2.88MB。overviewはさらに間引きlevelを作り、描画点数をCanvas幅に制限する。
- 時刻mappingは音源timestamp/sample rate、先頭delay/preskip、最後のpartial binを保持する。VBR MP3やAACのgapless offsetもfixturesでHTMLAudioElementと照合する。単純なbyte割合を時間割合にしない。
- 部分生成中は生成範囲を明示し、未生成部分を無音と偽らない。progressは250ms程度でthrottleする。
- 大きいPCM配列をpostMessageで複製しない。必要なpeaksのみtransferする。Worker終了時はdecoder.free/close、reader.cancel、AbortController、object URLを解放する。
- `decodeAudioData()`は完全ファイルを要求するため、断片を渡してstreaming decodeしたことにしない。[W01] 使用するfallbackは小さい音源だけに制限し、予測PCM+copyを含む上限を設ける。標準経路はこれに依存しない。
- Float32 PCMは48kHz stereo・5分だけで約110MiB（48,000×2×300×4 bytes）、2時間で約2.57GiB。Workerへ移すだけではこのメモリ量は減らない。[W02]
- browser Workerの目標working setは64MiB未満、peaks cacheは合計32MiBを初期上限とする。数字は設計budgetであり端末保証ではない。実機測定で調整するが全体decodeに後退しない。

### 8.3 cacheとfailure

- memory LRU + IndexedDBでpeaksをcache。keyは`owner/access scope + immutable audio hash + waveform algorithm version`。署名URL、開始位置、曲タイトルをkeyにしない。
- 同じhashの異なるrevisionではpeaksを再利用できる。ただしcacheがあることを音源アクセス許可とみなさない。private draftはowner隔離し、sign-out時に参照を解除する。
- IndexedDB拒否/容量不足ならmemoryへfallbackし、波形利用を失敗させない。音源rawやPCMを永続保存しない。
- 署名更新、network retry、seek位置変更で同一処理を多重起動しない。解析用の1回のbyte取得と再生elementの取得はブラウザ内で必ず共有できるとは限らないため、完全な通信ゼロ重複を保証しない。少なくともdragごとの再取得は禁止。
- duration/音声headとpeaksのずれをfixtureで測定する。許容範囲を超えた場合は波形不整合を表示し、無関係な音源の波形を使用しない。
- 長時間音源・codec非対応を「数値欄だけにして完成」としない。対応codecのWorker経路まで実装・試験する。どうしてもruntime条件が満たせない場合は、機能未完了として具体的blockerを報告し、その経路のflagを有効化しない。

## 9. 旧投稿曲・音源snapshotの準備

### 9.1 旧曲を置き去りにしない

現在の旧曲は`current_revision_id=null`でもPLAYできる。一方、非0のpreview位置には検証済みdurationが必要であり、試聴許可も自動付与されていない。**「旧曲なので編集不可」で今回を完了しない。** ただし再uploadや一括migrationを強制せず、当該曲の高度設定を使用する時に安全なsnapshotを準備する。

| 曲の状態 | 開いた時 / 保存時 |
|---|---|
| 検証済みcurrent revisionあり | その不変audio/chartを参照。metadataだけなら新revision不要 |
| legacy、title/説明/背景だけ変更 | 既存metadata CASで扱う。音源の再検証・revision化を必須にしない |
| legacy、波形/preview位置/Offsetを使用 | serverで既存ファイルを読み取り、現在のparser結果を不変候補へsnapshot。再upload不要。保存時に初めてrevisionを登録・currentへ設定 |
| legacy、非対応/壊れた/消えた音源 | 具体的error、retry、既存ファイル差替えへの導線。独立したmetadata/背景の保存は可能。PLAYの既存読取を勝手に廃止しない |
| preview配信未許可 | 公開試聴を勝手にONにしない。音源hashに対する権利/試聴同意を明示して確認。所有者の非公開検証用試聴と公開PLAY選曲previewの許可を区別 |

公開previewを未許可のまま開始位置を下書き保存することは認めても、`getSongPreview`の許可判定を迂回しない。許可を変更する場合は、音源hashに結び付いた専用のrevision操作とする。単なるbackground変更でrights確認を求めない。

初回snapshot・timing変更・replacement・試聴許可変更で新revisionを保存する時は、準備handleのaudioに対する権利確認を保存確認UIで明示的に取得する。clientの過去のcheckboxを別audioへ引き継がず、確認者はserverがactorから設定する。同じaudioのtiming-only変更では既存preview許可を維持できるが、audio hash変更時は新しいpreview許可の明示選択を要求する。

所有者用の同期確認sourceは、serverで認可した`owner-preview`用途としてcontrollerへ渡し、公開選曲用sourceと区別する。公開用`getSongPreview`へowner-only許可を流用しない。preview許可は試聴機能の利用契約であり、既に通常PLAYで配信される音源にDRMを追加する仕組みではない。

### 9.2 snapshot作成手順

新設案`prepareSongSettingsSource`で以下を実行する。

1. JWTを検証し、`songs.id + user_id`を確認。期待`metadata_version/current_revision_id`と一致することを確認する。
2. operation IDを発行/再利用し、同じowner・song・payloadだけを再試行可能にする。元pathをclientから自由指定させない。DBの参照pathと管理prefixから解決する。
3. legacyのaudio/chartをbyte上限付きで取得。HTTP失敗、途中切断、想定外redirect、巨大bodyを拒否する。外部任意URLをserverにfetchさせない。
4. legacyは実際の`chart_type/fnf_side`で現在の`parseChartByType`を使い、両sideを保持。新しいparserの「修正」をこのsnapshotに混ぜない。既存canonicalはvalidatorで読むだけでimporterへ戻さない。
5. audioの正確なduration、format、content hash、canonical chart hash、note数、lane数をserverで求める。client申告duration/hashは比較用にしか使わない。既存WAV/Ogg検証を拡張し、少なくとも旧投稿で使用可能なMP3/AAC-M4A、必要なWebM/Opus等を実データ/fixtureで確認する。単なる拡張子・`HTMLAudioElement.duration`の申告をDBの信頼値にしない。
6. 未登録候補のaudio/chartを`chart-revision-assets`の新UUID pathへinsert-onlyで保存し、operationにhash/path/provenance/検証結果を記録する。**まだ`chart_revisions`へINSERTしない**。公開曲のSELECT policyから未保存候補が読める状態を避ける。
7. 所有者専用の短期signed URLと検証値を返す。波形・試聴・保存候補がすべて同じsnapshotを参照する。
8. 保存直前にoperationのowner/target/期限、CAS、sourceの変化を再検査する。legacy pathが上書きされた場合は、Storageのversion/updated metadataが信頼できるなら比較し、できなければhashを再取得して照合する。差異は409とし、旧波形のまま新audioを採用しない。

旧public bucketのownerには従来の書換え能力が残るため、DB lockだけでStorage書換えまで止められるとは説明しない。**保存対象を準備済み不変snapshotに固定**することが整合性の根拠。更新検出後に自動で別bytesへ差し替えない。

legacyに無変更の最初のrevisionを作る場合、既存`buildRuntimeNotes`の採点対象・左右metadata・head/end時刻が元と一致することをfixtureで保証する。BPM/Offsetも同時変更する場合は元snapshotから明示した変更だけを加える。

### 9.3 runtimeと大容量

既存serverはaudio全体を`Uint8Array`にするため、100MiB inputにdecode/copyを重ねるとCloudflareの128MiB isolate上限に近づく。既存コードのまま「100MiB対応」と宣言しない。[W20]

新しい検証・hash・copyはstreaming/chunk経路にし、増分hash、短いdecode出力、Storageのcopy/stream uploadの実対応を確認する。durationだけが必要な処理で全PCMを保持しない。全体検証が必要なcodecは短いchunkで最後まで検査する。必要なcodec/WASM経路を実buildと実runtimeで検証し、メモリ/CPU上限を超える設計なら上限内の同等処理に修正する。未検証のserverless機能やバックグラウンド継続時間を前提にしない。

再実行可能なoperationを用い、接続終了で残った候補は期限付きcleanupへ渡す。巨大な独自ジョブ基盤を先行実装せず、既存Storageと小さいoperation/cleanup契約で完結させる。制約を解消できないcodec/サイズは明示的blockerとして報告し、実際に検証した対応範囲と未完了範囲を分ける。

## 10. BPM / OffsetとGameplay Revision

### 10.1 タイミングの意味

現行engineのnote時刻は`offset + beat * 60 / bpm`秒、hold endも同じ変換。従ってNativeのBPM変更は実タイミングを変える。Offset変更も全ノーツを動かす。どちらも単なるsongs列のmetadata更新にはしない。

新規revisionのprovenanceに`source_format`と`timing_basis`を追加する案を採用する。値はserverがimport/準備時に決定する。例: source formatは`native/osu/fnf-legacy/fnf-vslice/unknown`、timing basisは`beats/absolute-seconds/unknown`。これらの名前は**追加案**であり、現在の列ではない。

- 既存revisionは安全な既定値`unknown`。bpmが60だからFNF、拡張子がjsonだからNative、と推定しない。元sourceとhash対応が証明できる場合のみprovenanceを登録する。
- Native `beats`のみBPM編集を許す。新値は有限の正数、note/hold全体が音源範囲内になることをvalidatorで確認する。新しい根拠のない整数化やBPM上限を追加しない。
- `.osu/FNF`は`absolute-seconds`なので内部BPMは表示のみ。「BPM: 60」だけの誤解を招く欄にしない。音楽的BPMを別に手入力する機能は今回追加しない。
- `unknown`の既存canonicalはBPMを読取専用にし、その理由を表示する。証明できない意味付けを変更しない。Offsetは同じcanonical全体への加算として検証できる範囲で編集可能。
- OffsetのUI単位はms、canonicalは秒。既存の高精度値を開くだけでroundしない。変更時に1ms単位で正規化し、負のnote時刻やduration外を生成すればfield errorにする。
- FNFは`notes`だけでなく`fnf.leftNotes/rightNotes`との整合を保持。両sideの検証を行う。選択side、sustainの現行kind、early-input policyは変更しない。
- parserの解釈が変わらないtiming変更で`CHART_PARSER_VERSION`を勝手に更新しない。provenanceとparser versionは別目的。

### 10.2 同期確認

BPM/Offset欄は「プレイ内容が変わるため、新しい譜面版として保存されます」と示す。旧値→新値、影響するrevision、新規note範囲を保存前に表示する。

試聴区間内のnote head目印/簡単なpulseを音声currentTimeに合わせて表示し、「変更前 / 変更後」を切り替えて同期を確認できるようにする。両者は同じ音源で比較する。保存せずメインゲームのglobal settingsを変更しない。この確認から`record_play_result`、XP session開始、XP evidence送信を呼ばない。

小さな確認用表示に限定し、新しいChart Editorや別判定engineを作らない。既存のbeat→runtime変換を共有する。元曲のaudioは再encodeせず、同一hashのbytesを保持する。現在のRevision path制約により新revision専用audio copyが必要ならserverでcopyし、hashを照合する。巨大audioをclientへ往復させない。

### 10.3 スコアと履歴の契約

| 項目 | 必須の扱い |
|---|---|
| current pointer | 保存transactionの最後に新revisionへ切替。公開状態は維持 |
| 旧revision | row/bytes/hashを不変のまま保持。現在使われないという理由で削除しない |
| 実行中PLAY | 開始時に固定した`RunConfiguration/revisionId`を最後まで使用。保存後のcache更新で差し替えない |
| 新PLAY | 保存後に取得したcurrent revisionを使用 |
| play_results / player_stats | 書換え・再集計・削除をしない。TOTAL SCOREは保存された各プレイのscoreをuser単位で累積する現在の契約を維持。song別bestやrevision別bestへ変更しない |
| play_result_context | 新結果は実際にプレイしたrevisionへ。旧null revisionを推測してbackfillしない |
| UUID再送 | 同じplay_idを違うrevisionへ付け替えない。既存v2のconflict rollbackを保持 |
| XP/Level | 既存ledger/progress/awardを修正しない。新revisionを旧catalogの承認対象へ自動追加しない |
| 進行中XP session | 開始時snapshot/既存失効規則を維持。current pointer変更だけで旧sessionを新revisionへ変換しない |
| ranking | 既存の集計・sort・表示の回帰だけ確認。revision別rankingの新設は対象外 |
| replay/evidence | 記録したrevision/parser/rules/sideに対応させる。新しいcurrentを使って古いevidenceを再解釈しない |

現行`record_play_result_v2`はcontextを追加する仕組みであり、ランキング全体がrevision別に作り直されたわけではない。今回もその再設計をしない。「過去の結果の対応を保持」と「revisionごとにランキングを分離」を混同しない。

## 11. 背景画像［Beta］

### 11.1 UIと保存対象

- section名に常時「Beta」を表示。「背景設定は将来のChart Editorへ移動予定」と短く説明する。未完成を意味する表示にはしない。
- 現在の画像、選択中画像、未保存状態、画像なしfallbackを区別する。ローカルpreviewにはobject URLを使い、変更/閉じる時にrevokeする。
- 「画像を選択」「選択を取り消す」「背景を削除」を用意。削除もdraftの操作であり、保存までは本番参照を消さない。
- client処理→転送%→server検証→保存準備完了の各状態を表示する。転送100%を保存完了と表示しない。server処理の残時間を偽のprogressで埋めない。
- JPEG/PNG/static WebPだけを受け付ける。iPhoneのHEIC/Live Photo等を自動的に対応済みと表示しない。対象外ならJPEG等への変換が必要と具体的に案内する。
- 画像処理/Storageのdomain serviceはUIから分離し、将来Chart Editorが`purpose=chart-background,target=songId`で同じ処理を利用できるようにする。背景timelineやevent schemaは作らない。

### 11.2 bucketとDB参照

**新bucketを重複作成しない。** `asset-staging`と既存`profile-card-images`を使う。後者の名称はprofile向けだが、既存`image_assets.purpose`はchart-backgroundを含むためcanonical image保管先として再利用できる。名称変更で既存profile機能を壊さない。

新設案`songs.background_asset_id uuid REFERENCES image_assets(id)`を追加し、verified assetへ結び付ける。row lock下で`owner_id=songs.user_id`、`purpose=chart-background`、`target_id=songs.id`、未削除・検証済みを確認する。FKだけではこの認可条件を保証しない。

- 読取優先順位はverified pointer→検証可能なlegacy背景→既存fallback。
- 旧`background_path`は互換読取用として保持。初回置換/明示削除では新pointerとlegacy pathを同じtransactionで更新/clearし、削除後に旧画像が復活しないようにする。
- legacy画像の現状表示もraw SVG/HTMLを新経路で再公開しない。serverでサイズ・magic・静止画を確認できた画像のみ所有者previewへ渡す。検証不能/欠落ならfallbackと理由を示す。公開PLAY背景への新しい表示経路はcanonical画像を優先する。
- `songs` bucketのpublic設定を今回一括変更しない。旧avatarはpublic URLを使用しており、private化すると別機能を壊す。

### 11.3 reserve → upload → verify → swap

1. clientは元ファイルのbyte数と画像headerを確認する。初期の入力上限は20MiB、縦横各8192px以内、16,777,216 pixels以内。headerが不明なら無制限decodeしない。これはclient資源保護でありserverの認可/検証の代わりではない。
2. client側でEXIF向きを適用し、長辺2048px以内、総pixel数4,194,304以内、転送3MiB以下へresize/encodeする。許可形式の静止画であることを元ファイル段階でも確認し、GIF/APNG/animated WebPを先頭frameへ勝手に変換して通さない。透明画像は必要に応じてWebPを使用する。
3. 専用server functionで認証/所有権/背景capabilityを確認。既存`reserve_image_asset`のquota・idempotency・path規約を再利用する。一般purposeのRPCを無条件にauthenticatedへ公開せず、背景専用wrapperまたは目的を制限したgrant/DB gateを用意する。
4. 予約は`owner/reservation/source`、canonicalは`owner/reservation/master`。clientのpath指定を受け付けない。予約に対応するsigned upload URLを返し、既存`putWithProgress`を`upsert`指定可能に拡張して**false**で送信する。
5. 検証requestはreservation IDだけを受ける。serverは再びowner/target/state/期限を確認し、stageを実byte上限付きで取得する。申告MIME/size/hashだけでverifiedにしない。
6. serverでmagic/container、実際のcodec、dimensions、frame数、decode完了を確認し、全pixelをdecode→独自canonical encodeする。JPEGまたはstatic WebPへ固定し、metadata/EXIF/不要なchunkを除く。向き補正済み画像に二重回転をかけない。[W19][W25]
7. canonical pathのcleanup jobを**Storage書込前に**予約する。insert-only upload後、保存されたbyte/hash/dimensionsとDBを整合させて`image_assets`を登録し、reservationをverifiedにする。再試行で既存pathがあれば一致hashのみ再利用。不一致をupsertで上書きしない。
8. ここまで成功しても`songs`は変更しない。「変更を保存」で§12のtransactionがpointerをswapする。失敗/取消なら旧画像を表示し続け、準備画像はcleanup対象になる。

`image_reservations.expires_at`は既存1時間。Supabase signed upload URLは公式仕様で2時間有効なため、予約失効とURL失効を同一視しない。[W23] 期限切れ後のverifyを拒否し、cleanupは発行したtokenの最終有効期限より後に行う。通常は既存24時間猶予で足りるが、再発行時刻を記録して計算する。期限切れ予約の同pathへtokenを再発行しない。

### 11.4 decoderと攻撃対策

現時点で実画像processorはない。新設案`imageProcessor.server.ts`にdecode/verify/re-encodeを実装する。Nitro Cloudflareで`sharp`が利用できると仮定しない。公式にCloudflare例のあるjSquash系WASMを初期候補とし、必要moduleをpin/static bundleして、対象runtimeでJPEG/PNG/WebPの実decode/encode、memory/CPU、壊れた画像の挙動を検証する。[W21]

| 攻撃/失敗 | 必須処理 |
|---|---|
| SVG/HTML/偽MIME/偽拡張子 | content typeに依存せずcontainerとdecoderで拒否。SVGをブラウザDOMへ挿入しない |
| APNG/animated WebP/GIF | animation構造を検査して拒否。ライブラリが第一frameだけ返しても合格にしない。[W25][W28] |
| 巨大dimension/展開爆弾 | decode前のbounded header parse、幅高/pixel上限、読取byte上限、処理時間上限 |
| truncated/壊れた画像 | strict decode完了確認。部分画像をcanonical成功として扱わない |
| polyglot/metadata内の危険内容 | 許可container以外拒否、canonical re-encodeとmetadata除去。元bytesを配信しない |
| CPU/同時upload濫用 | 既存予約quota、server rate/concurrency制限、timeout、retry回数制限。ログにfile bytesを出さない |
| service-role横取り | server専用module、任意bucket/path/sign APIを公開しない。client bundleにsecretなしを確認 |

serverではstage最大3MiB、各辺2048px/4MPを**再検査**し、canonicalも3MiB以下を保証する。WASM memoryはJSと別の無料枠ではない。128MiB isolate内の同時処理も計測する。client resizeを省略した直接requestでもこの条件を満たさない画像は拒否する。

### 11.5 読取と実表示

private bucketを維持し、新設案`getSongBackground`が`songId`から参照を解決する。公開曲はviewerへ、下書きはownerへだけ短期signed URLを返す。ownerであっても別の曲のreservationやprofile画像をtarget差替えで流用できない。

- 公開projectionはassetのpath/owner全情報を一覧取得させるものではない。必要なURL、expiresAt、寸法/hash識別子だけを返す。
- 新背景URLは10分を初期TTLとし、期限前/表示失敗時に世代付きで一度更新。既存audioの1時間契約は勝手に一括変更しない。
- signed URLは所持者が期限まで利用できる。auth変更や非公開化で即時失効する保証をせず、短いTTLとcache制御で範囲を限定する。[W15][W16][W24]
- 応答の共有cacheにdraft情報を入れない。session/account変更でprivate cacheを分離・破棄する。ログ/analyticsに署名queryを保存しない。
- `SongEntry`または表示専用DTOから`GameScreen`へ背景参照を渡す。`Chart`のgameplay hashやRunConfigurationには画像を含めない。
- ゲーム背景はノーツ/HUDより下、`pointer-events:none`、既存dim/軽量化設定を尊重し、decode失敗は既存fallbackへ。プレイ中の背景変更による再mountやaudio reloadを起こさない。1回のrunは開始時の表示assetを保持してよい。

### 11.6 cleanupを実際に動かす

既存`asset_cleanup_jobs`を拡張し、実行worker/schedulerを今回完成させる。「tableを作った」だけでは完了しない。`next_attempt_at/lease_expires_at/locked_by`等の再試行・lease列を追加し、claimはrow lock+`SKIP LOCKED`、batchサイズ/同時実行数を制限する。

- stage: token失効後かつ予約失効/verified/rejectedの状態を確認して削除。
- canonical image: 未保存/取消は猶予後、swapされた旧画像は最低24時間後。`songs`と`profile_preferences`および未完了operationの全参照を再検査する。
- assetsに`deleting/deleted_at`等の状態を追加し、commitとcleanupが同じasset lockを使う。cleanupがdeletingを確定したassetは新しい保存に使えない。DB transactionを開いたまま長いStorage network待ちをしない。
- 予約・canonical書込・DB登録・swapの各crash境界から復旧できること。Storage 404は削除済みとして冪等成功にする。bytes削除後DB更新前にcrashしても再実行できる。
- legacy背景の置換では、旧`songs` pathを必要に応じ7日猶予で対象にする。owner/path検証と全songs画像列・profile avatar等の参照検査を行い、同じpathを使う別表示を消さない。bucket全体やuser prefixの一括削除は禁止。cleanup jobのbucket制約を広げる場合もこの用途と検証を明示する。
- retryはbackoff付き、例えば最大5回後dead-letter/運用通知。成功したふりでjobを消さない。今回Codexの同問題3回修正ルールと、実行時retryは別物。
- cleanupはSupabase Storage APIで削除する。`storage.objects`のSQL DELETEだけで物理objectが消えたことにしない。[W22]

未登録Revision候補のorphanについては現行immutable triggerのため追加設計が必要。登録済みrevisionのbytesを永久保持する規約は維持し、**未登録かつ期限切れ/abandoned operationの正確なpathだけ**をservice workerがreclaimできるDB認可markerを追加する。claim時にoperationをterminalにlockし、その後のcommitを禁止。Storage DELETE triggerはservice経由・有効marker・対応する登録revisionがないことを検査した場合だけ許可し、それ以外のUPDATE/DELETEは拒否する。triggerを丸ごと無効化しない。実Supabase Storageが使うDB roleでこの条件を検証する。

schedulerは対象hostingで実際に呼べるcron/運用jobへ配線し、認証済みserver-only endpointにする。現在のXP worker関連実装を参照してよいがXP catalog/flagに依存させない。未配線なら画像機能の公開条件を満たさない。

## 12. 一括保存・競合・API契約

### 12.1 基本方針

upload/解析などの準備は先行してよいが、**公開されるsongs metadata・背景pointer・current revisionの変更は1つのDB transaction**で行う。外部Storage upload自体はDB transactionに含められないため、準備済みimmutable assets→DB commit→不要asset cleanupの順で整合させる。

旧metadata RPCの検証を別実装でコピーしない。共通のprivate SQL helperへ切り出し、既存`update_chart_metadata`は認証・所有権・旧number契約の互換wrapperとして残す。新設案`commit_song_settings`は準備済み候補も扱う一括commit用service-only RPC。`publish_chart_revision`も同じ安全な内部commit処理へ寄せ、二重のversion/所有者ロジックを残さない。

### 12.2 client → serverの契約案

以下は新設API名で、現在の`.functions.ts`へ追加/分割する設計案。

| function | 入力の要点 | 結果 / 制約 |
|---|---|---|
| `getSongSettings` | songId | 最新owner row、version文字列、revision情報、capabilities、表示用asset。JWT必須 |
| `prepareSongSettingsSource` | songId、operationId、expectedVersion、expectedRevisionId | 不変候補source handle、hash、duration、format/timing basis、owner URL。準備だけ |
| `prepareChartReplacement` | songId、operationId、期待version/revision、検証済みupload handle、chartType/side | 既存RevisionPublisher用の追加案。既存parser/検証を再利用して候補だけ作る |
| `reserveSongBackground` | songId、reservationId、MIME、expectedBytes | 目的固定の予約とsigned upload URL。既存quotaを使用 |
| `verifySongBackground` | songId、reservationId | verified asset ID/owner preview。何度呼んでも同じbyteなら同じ結果 |
| `saveSongSettings` | 下記payload | 確定receipt + server row/version/revision。明示保存のみ |
| `getSongSettingsOperation` | operationId | 所有者専用のpreparing/committed/failed等とreceipt。timeout後の照合 |
| `abandonSongSettingsOperation` | operationId | 所有者一致の準備だけ取消。commit済みはrollbackしない |
| `getSongBackground` | songId | 公開/owner認可の最小projection。任意path署名不可 |

`saveSongSettings`の入力例（新契約、厳密Zod schemaを作る）:

```ts
type SaveSongSettingsInput = {
  songId: string;                 // UUID
  requestId: string;              // 一つの保存意図に一つのUUID
  expectedVersion: string;        // 非負10進BIGINT文字列
  expectedRevisionId: string | null;
  metadata: {
    title: string;
    artist: string;
    chartAuthor: string;
    difficultyName: string;
    description: string | null;
    recommendedPlayStyle: "mania" | "fnf" | null;
    previewStartMs: number | null;
  };
  background:
    | { action: "keep" }
    | { action: "remove" }
    | { action: "replace"; assetId: string };
  gameplay:
    | { action: "keep" }
    | { action: "timing"; sourceOperationId: string;
        bpm?: number; offsetMs?: number }
    | { action: "prepared-replacement"; sourceOperationId: string };
  sourceOperationId?: string;    // legacyの検証/初回snapshotが必要な場合
  rightsConfirmation?: { confirmed: true; sourceOperationId: string };
  previewConsent?: { allowed: boolean; sourceOperationId: string };
};
```

`user_id/owner_id/hash/path/revision_number/note_count/rights_confirmed_by/is_official/score/XP/is_published`等のmass assignmentを認めない。preview同意はserverがhandleのaudio hashに結び付け、clientの別hashを信用しない。UUID/hashesはparseし、JSONの未知fieldをstrict拒否する。date/整数/有限数/文字列長はclientとserver両方で同じ規則を使う。

新revisionを作る保存では`rightsConfirmation`が必須。内外のsourceOperationIdが異なる入力、timing変更値が一つもない入力を拒否する。metadataだけなら同意欄は不要。payload hashは順序が安定した正規化JSONからserverが計算し、署名URL/一時progressは含めない。Unicode文字列長はPostgreSQLの文字数と一致させ、emojiをUTF-16 code unitだけで数えてclient/serverの上限を食い違わせない。変更がない保存で無意味なversion/revisionを増やさない。

BIGINTを一度JS numberで受けてから`String()`にしても精度は戻らない。新read RPC/projectionはDBで`metadata_version::text`として返し、CASもDB bigintへ厳密castする。既存generated typesを新DTOの都合で虚偽に書換えない。

### 12.3 DB transaction

新設案`song_edit_operations`に最小のreceipt/候補台帳を持つ。主な列: UUID、owner_id、song_id、kind、payload_hash、expected_version、expected_revision_id、state、準備済みpath/hash/検証値、結果receipt、created/updated/expires_at。RLSはowner SELECTのみ、書込はservice-only。用途別CHECKで曖昧なstate遷移を禁止する。既存image予約台帳は重複作成しない。

準備operationは`preparing → prepared → committed/abandoned/expired`、処理失敗は`failed`として原因を保持する。保存operationのcommitted receiptは再送判定に使い、準備assetの期限cleanupと同時に削除しない。source bytes/全PCMを台帳JSONへ格納せず、path/hash/検証値を保存する。準備期限は1時間を初期値とし、長い実処理に必要なlease更新だけserverから行う。

**UUID/pathの整合**: 新revision IDは当該保存の`requestId`に固定する。DB INSERT前にcanonicalの最終pathを必ず`<songId>/<requestId>/chart.json`と`<songId>/<requestId>/audio`へ確定し、既存CHECKを満たす。sourceOperationIdの仮pathが異なる場合はserverで同bytesをcopy/hash検証し、timing変更後のchartをその最終pathへinsert-onlyで用意する。仮pathのまま別IDのrevision rowへ登録しない。copy/書込はtransaction前で、未登録時はoperation認可以外から読めず、失敗時はGC対象となる。

既存file replacementのraw uploadも、新UIではoperationに束縛したprivate候補pathとsigned uploadへ接続する。`chart-revision-assets`を再利用し、100MiB/8MiBのfile別上限、owner、用途、insert-onlyをserverで制限する。元ファイルを検証前に公開revisionとして登録しない。旧`createChartRevision`契約は同じ内部prepare/commitを呼ぶ互換wrapperにし、旧clientの単独replacementを壊さず、新UIは`prepareChartReplacement`の結果を親draftへ渡して一括保存する。

commitの順序:

1. service-only EXECUTE権限/DB gateを検査。actorは認証middlewareが確定した値だけ。ブラウザ指定actorをserverが転送しない。
2. requestIdのowner/target/payload hashを確認。同じIDで異なるpayloadなら409。同じIDで既にcommittedなら**CAS判定より先に**保存receiptを返す。他人のIDの存在は開示しない。
3. song rowを`FOR UPDATE`し、ownerを再確認。versionとcurrent revisionの両方を比較し、不一致なら40001→client 409。
4. 必要なsource operationとassetを一貫した順序でlockし、未期限切れ・同owner/song・verified・未deletingを確認。cleanupと同じlock順を文書化しdeadlockを避ける。[W17]
5. metadataを既存の制約で検証。変更していないlegacy長値は壊さず、変更値は現行上限。previewは今回採用するaudio duration内で検証。
6. gameplay/legacy snapshotが必要なら候補hashとcanonical検証値からrevision rowをINSERT。revision_numberはsong lock内で採番する。revision IDの再利用時は内容一致を確認。既存rowをUPDATEしない。
7. songsの通常metadata、background pointer/legacy path、必要なcurrent pointerとderived mirrorを一度だけUPDATE。metadata_versionは1回だけ+1。`is_published/published_at/user_id/is_official/play_count`を保存副作用で変えない。
8. 古い背景のcleanup job、operation committed receiptを同transactionに記録してcommit。
9. canonical row/receiptを返す。responseが失われても同requestIdで照合できる。

DB処理から外部Storage HTTPを呼んで長いlockを保持しない。clientから未verified revision rowを直接登録させない。旧`createRevision`のmax+1と先行INSERTは新しい内部経路へ統合する。既存ファイル差替えUIも同じ原子性を使い、別の保存ボタンでmetadataだけ先に書かない。

### 12.4 保存UX・失敗・cache

- 保存前に変更一覧とvalidationを確認。準備中/保存中は保存buttonをdisableし、二重submitを同requestIdで吸収する。network retryのたびに新IDを作らない。
- 保存中のcloseは結果照合が必要になる旨を示す。通信abortはDB rollbackを保証しない。閉じた場合もpending requestId/owner/songだけを短期保持し、次回openで照合する。署名URL/secretをlocalStorageへ入れない。
- committed receipt確認前に「保存しました」を出さない。timeoutは「保存結果を確認しています」、明確なserver失敗はdraftを残して再試行。
- 409は最新rowと自分のdraftを両方保持。「最新を読み直す」「変更を比較してやり直す」を提供。画像/タイミングを自動mergeしない。確認後の別意図は新requestIdで再送する。
- 基本はpessimistic commit。ローカルpreviewだけを先行表示し、確定一覧や公開PLAYを保存前にoptimistic更新しない。
- 成功後、owner/song/version/generationが一致する時だけbase/draftを確定値へ更新。古い保存応答で新しいdraftを消さない。receiptよりさらに新しいversionがある場合は再取得して表示し、古いreceipt rowを最新rowとして上書きしない。
- 新しい設定query keyは`["song-settings",ownerId,songId]`等に統一。画像はasset ID/hash単位。mutation成功時に必要なqueryをinvalidateする。[W18]
- **現行のRhythmHub useState一覧も更新する。** `mySongs/publishedSongs/selectedSong`に同じ確定rowを反映し、その後のreloadにrequest generationを付ける。保存前に開始された遅いfetchが古いrowを戻さないようversion比較/世代確認する。
- preview位置/背景更新は次のPLAY選択へ反映する。実行中のRunConfigurationは更新しない。audio hash不変なら波形を再生成せず、revision変更でもhashが同じ場合はcacheを再利用する。
- 再接続時の自動送信は同ownerのpending保存だけ。別accountへ切り替わった場合に旧draftを新tokenで送らない。既存`ownerTransport`のtoken固定を再利用する。

## 13. DB・RLS・認可の実装条件

### 13.1 所有者モデル

所有者は`songs.user_id = auth.users.id`。`profiles.id`もauth userと対応する。`chart_author`は編集可能な表示文字列であり、所有者・権限の根拠ではない。プロフィール名、メール、曲名、作者文字列の一致で認可しない。

現在の`requireSupabaseAuth`はBearer tokenのclaimsを検証し、JWT付きSupabase clientと`context.userId`を渡す。これを再利用する。`supabaseAdmin`はRLSを回避できるため、呼ぶ前と最終DB transaction内の両方でownerを確認する。[W15][W26][W27]

| 経路 | 必須の認可 |
|---|---|
| UI管理表示 | login ownerのMY TRACKSだけ。利便性の制御でありsecurity境界ではない |
| URL `songSettings` | ID形式検証、owner read、他人/削除は同じ未取得表示。URLを知るだけで編集できない |
| 設定read/準備/署名 | verified JWT、song owner、source/operation target一致 |
| metadata旧RPC | `auth.uid()`必須、songs row owner、CAS、protected column拒否 |
| 新commit RPC | anon/authenticated EXECUTEをREVOKE、service_roleのみ。serverが検証したactorでrow owner再検査 |
| reserve/verify | song owner、reservation owner/purpose/target/期限/状態、quota。別曲・別profileのassetを拒否 |
| staging upload | 予約されたexact pathのみ、insert-only。任意path、期限切れ、上書き、他人prefixを拒否 |
| canonical write | trusted serverのみ。clientにはINSERT/UPDATE/DELETEを与えない |
| public background read | 対象songが公開か、viewerがowner。下書きassetを他人に署名しない |
| cleanup | server専用認証、exact path、参照/状態/lease確認。ユーザー入力の任意path削除なし |

### 13.2 SQL関数・protected columns

- `SECURITY DEFINER SET search_path=''`を維持し、table/functionはschema修飾する。PUBLICの暗黙EXECUTEを明示REVOKEし、必要roleだけGRANTする。[W26]
- 既存songs UPDATEはcolumn-level grantで`is_published/published_at`等に制限されている。背景・BPM・owner・revision列をauthenticatedの直接UPDATEへ開放しない。
- `current_revision_id`とsongの対応FK、canonical immutability trigger、INSERT identity保護を維持する。service_roleが通常の全安全制約を自由に迂回してよい設計にしない。
- 新しいbackground pointer/provenance/operation列もschemaとtriggerへ組み込み、raw RESTによるowner/foreign asset代入を拒否する。
- `auth.uid()`はservice-role呼出では通常のユーザーを表さない。service-only関数はtrusted server actorを使い、authenticatedにもその同じactor引数関数を開放しない。
- DB errorはSQLSTATE/内部codeから構造化errorへ変換する。例: `AUTH_REQUIRED`、`NOT_FOUND_OR_FORBIDDEN`、`STALE_VERSION`、`INVALID_INPUT`、`SOURCE_CHANGED`、`ASSET_NOT_READY`、`UPLOAD_EXPIRED`、`RETRYABLE_TRANSPORT`、`SERVER_NOT_READY`。生SQL・Storage内部path・tokenをerror UIへ出さない。
- 未適用schemaでPGRST202/列欠落となったらcapabilityを閉じ、準備不足を表示する。旧public bucket直接UPDATE等の安全でないfallbackは作らない。

### 13.3 owner以外で必ず試す攻撃

A/Bの2ユーザーとanonを用意する。BまたはanonからAのsongIdへ差替え、AのassetId/operationIdを使用、`p_actor=A`を指定、古いversionを送信、未知のprotected fieldを追加して、UIを通さずHTTP/RPC/Storageへ直接requestする。すべて失敗し、Aのrow/画像/scoreが変わらないことを確認する。

owner自身でも他の自分の曲用assetをtarget差替えで使うケース、期限切れtoken、再送payload差替え、正規user JWTからservice-only関数呼出を試す。ownerであるだけでは全操作が無制限に許可されない。

## 14. component・moduleの変更計画

既存ファイルの巨大化を避けつつ、既存domain層を使う。以下の追加名は命名案で、実装開始時のtreeに同等物があればそちらへ統合する。

| 対象 | 既存/追加 | 責務 |
|---|---|---|
| `src/components/app/RhythmHub.tsx` | 既存変更 | MY TRACKS選択、overlay状態と一覧更新、通常選曲の管理入口削除、play経路維持 |
| `src/components/app/SongMetadataEditor.tsx` | 既存を置換/薄い互換入口 | standalone edit screenを廃止しSongSettingsDialogへ一本化 |
| `src/components/app/SongMetadataFields.tsx` | 既存変更 | 通常metadata field再利用。preview数値欄は波形sectionへ、validation共通化 |
| `src/components/app/SongDetail.tsx` | 既存変更 | 通常曲詳細から編集導線を除去。preview/STARTは保持 |
| `src/components/app/RevisionPublisher.tsx` | 既存変更 | 準備したreplacementを親draftへ返す。直接独立publishを共通保存へ統合 |
| `src/components/app/song-settings/SongSettingsDialog.tsx` | 追加案 | modal shell、section、close/dirty確認、save状態 |
| `.../MySongManagementMenu.tsx` | 追加案 | ⋮・PLAY・編集、入力競合を局所化 |
| `.../SongPreviewEditor.tsx` | 追加案 | 波形表示、drag/keyboard/step、audio controls |
| `.../SongBackgroundEditor.tsx` | 追加案 | Beta UI、file input、progress、preview、remove/cancel |
| `.../ChartTimingFields.tsx` | 追加案 | provenance別のBPM/Offset表示と編集、同期確認 |
| `.../useSongSettingsDraft.ts` | 追加案 | base/draft/dirtiness、CAS conflict、owner generation、receipt照合 |
| `src/game/audioSession.ts` | 既存拡張 | owner lease、精密seek、head購読、終了判定。再生管理は一元化 |
| `src/hooks/useAudioPreview.ts` | 既存連携 | 通常previewからlease契約へ適応。既存public API互換を維持 |
| `src/lib/waveform.ts` / `src/workers/waveform.worker.ts` | 追加案 | waveform型、algorithm version、段階解析、cache/取消 |
| `src/lib/chartRepository.ts` | 既存拡張 | owner設定取得/save adapter、DTO、背景取得。別の曲取得層を重複させない |
| `src/lib/chart.functions.ts` | 既存拡張 | capabilities/認証済みserver関数。必要時songSettings.functionsへ分割 |
| `src/lib/chartRevision.server.ts` | 既存再利用/再構成 | prepare/canonical timing clone、検証・hash・候補作成、DB commit呼出 |
| `src/lib/songSettingsContract.ts` | 追加案 | strict入力型、field validation、error/receipt型。server secretをimportしない |
| `src/lib/imageAssets.server.ts` / `imageProcessor.server.ts` | 追加案 | purpose固定reserve/verify/signとcanonical encoder。UI独立 |
| `src/lib/assetCleanup.server.ts` | 追加案 | lease claim、参照検査、Storage API削除、retry、認証scheduler入口 |
| `src/lib/uploadProgress.ts` | 既存拡張 | upsert option、abort、owner generation。既存投稿の呼出契約も維持 |
| `src/lib/audioMetadata.ts` / `chartValidation.ts` | 既存拡張 | 既存WAV/Ogg条件保持、旧音源対応の検証、bounded読取、timing整合 |
| `src/components/game/GameScreen.tsx` | 既存最小変更 | 表示用背景のみ追加。判定/input/audio clockを変更しない |
| `src/routes/index.tsx` / `src/router.tsx` | 既存最小変更 | overlay search、dirty blocker、既存QueryClient統合 |
| `src/components/ui/dialog.tsx` / `src/styles.css` | 既存最小変更 | 必要な後方互換props・safe area・motion。全体デザイン変更なし |
| `src/integrations/supabase/types.ts` | 生成更新 | 検証済みmigrationから再生成。生成元不明の列を手で存在済みにしない |
| `supabase/preflight/pulse_update.sql` | 既存拡張 | 新表/関数/trigger/flag/実行権限のread-only照合 |

各sectionはserver rowを直接変更せず親draftへイベントを返す。audio head更新はform stateと分離する。image verify/revision prepareが成功しても保存済みtoastを出さない。

## 15. migration・feature flag・rollback

### 15.1 既存migrationの事実

| migration | ソース上の内容 |
|---|---|
| `20260915095457_d89c3979-1c4a-4b48-9088-69ce856ff3ac.sql` | profiles/songs、owner RLS、legacy Storage policy |
| `20260915095524_76dbbcf9-7e1e-4145-93f0-cc62ffaeb2ca.sql` | 関数search_pathの修正 |
| `20261001155201_f117e76b-093d-4546-926f-97e1f9bb542d.sql` | chart_type、fnf_side、official管理 |
| `20261001155227_e33ac524-f77f-4010-83ed-cb6a398e1ecb.sql` | search_path修正 |
| `20261006200000_global_score_ranking.sql` | play_results/player_stats/ranking基盤 |
| `20261007090000_global_score_ranking_hardening.sql` | Score/ranking検証強化 |
| `20261010120000_play_result_validation.sql` | 結果入力validation |
| `20261012100000_chart_author_bridge.sql` | chart_authorの互換追加/型確認 |
| `20261012110000_chart_revisions_metadata.sql` | metadata CAS、immutable Revision、公開RPC |
| `20261012120000_private_asset_foundation.sql` | private buckets、画像予約/assets/cleanup table、profile preferences |
| `20261012200000_xp_foundation.sql` | XP catalog/session/ledger/flag等 |
| `20261012210000_xp_transactions.sql` | XP transaction/検証job系 |
| `20261012220000_result_context_audit.sql` | play_result_contextとv2結果RPC |

この表は適用済み一覧ではない。実際の`supabase_migrations.schema_migrations`、関数定義、grants、Storage構成と照合する。

### 15.2 今回追加するmigrationのまとまり

既存ファイルを書換えて再適用せず、新しいtimestampの追記migrationを作る。適用順と依存を明示する。名称は以下の用途を示す案。

1. **schema追加**: songs.background_asset_id、revision provenance、song_edit_operations、画像deleting/deleted状態、cleanup lease/retry列、必要index/FK/CHECK、目的を限定したsong-settings flag。
2. **transaction/RLS**: metadata helper/互換wrapper、commit RPC、reserve背景wrapper、operation認可、columns protection、公開背景projection、未登録候補専用GC marker/trigger条件。
3. **readiness/検証**: read-only preflight更新、test fixtures、必要な権限を明示。flagはdefault OFF。

revision provenanceの既存rowはunknownのままにする。証拠がある場合も既存immutable rowをUPDATEせず、準備handleで証拠を保持し、次の新revisionに正しいprovenanceを記録する。過去のtiming/hash/historyを書き換えるbackfillは行わない。

既存dataの不正型・重複・bucket設定差異に遭遇したら、検知して停止し、勝手にdrop/recreate/型変換/削除しない。schema driftは別の明示的修正migrationとして扱う。大量tableのindex追加/lock時間はstagingで計測し、適用方法をPostgreSQL/Supabaseの実versionに合わせる。

### 15.3 capabilitiesとflag

| flag/capability | 現在 | 今回 |
|---|---|---|
| `PULSE_REVISIONS_ENABLED` | server env、true時だけRevision関数を許可 | 維持。timing/replacement/source publishの前提 |
| `imageUploadEnabled` | false固定 | 一般profile画像機能の意味を勝手に変更しない |
| `PULSE_XP_ENABLED` | server env | 触らない |
| DB `xp_sessions/xp_awards/xp_progress` | migration既定false | 触らない。本番値は未確認 |
| `songSettingsEnabled` | なし | 追加案。schema/APIの準備完了時だけON |
| `songBackgroundUploadEnabled` | なし | 追加案。processor/private policies/cleanupの実検証後だけON |
| `songTimingRevisionEnabled` | なし | 追加案。legacy source・codec・CAS・revision regression後だけON |

server env名の追加案は`PULSE_SONG_SETTINGS_ENABLED/PULSE_SONG_BACKGROUND_ENABLED/PULSE_SONG_TIMING_ENABLED`。server capabilityはenvだけでなくDBの対応version/feature gateとANDにする。DB gateも目的を限定した小さい表/関数で管理し、schema未対応はfail closed。クライアントからgateを変更できない。

既存metadata互換RPCまで無条件に新flagへ巻き込み停止させない。新機能へのwriteだけを閉じる。UI flagを隠すだけでRPCが実行できる状態にしない。flagOFFでも保存済みcanonical背景/revisionの**読取と通常PLAY**は維持する。

### 15.4 rollout手順

1. 現HEAD/関連PR/clean状態を再確認。read-only preflightで対象環境のmigration履歴・schema・grants・policies・bucket/flagを取得し、環境名と日時を記録する。個人データ/secretは出力しない。
2. localで全migrationを空DBへ適用、既存データを模したupgrade fixtureへ適用して検証。PGliteに加え、本物のPostgreSQLとSupabase Storageで試す。
3. stagingへ追記migrationを適用。新flag OFFのまま互換性・既存client・private公開範囲・cleanup schedulerを確認する。
4. backendとfrontendを読取後方互換でdeploy。WASM/Workerが実Cloudflare targetで動くことを確認。秘密鍵がclient bundleへ入っていないことも検査。
5. stagingの限定ownerでmetadata→画像→timingの順にgateを有効化し、§16の全必須試験を行う。失敗した段階を成功扱いにしない。
6. 本番の対象project、DB履歴、backup/復元手段、deploy SHAを再確認し、当該実装セッションで許可された範囲で本番へ反映する。現在の調査文書だけで、本番適用済みと報告しない。
7. 本番flagを段階的にON。保存成功率/409率、source decode失敗、画像verify拒否、cleanup遅延・dead-letter、未参照asset件数、preview再生失敗、通常PLAY/Score/XPの異常を確認。eventにrequest IDとerror codeを記録し、署名URL/生ファイルは記録しない。
8. 実際に適用したmigration version、flag値、frontend/backend commit、実行日時、smoke test結果を完了報告へ記載する。

機能の部分的な段階公開と、残りを実装対象から外すことは異なる。全仕様完成が本指示書の目標。必要な本番権限/環境がなく検証不能なら、実装完了と運用未完了を明確に区別する。

### 15.5 rollback

- 最初に該当write gateをOFF。既存曲の読取/PLAY・旧revision・scoreは継続する。準備済みassetsは期限付きcleanupへ回す。
- 新しい列/table/旧revisionをdropして戻さない。安定したreaderを残し、必要なら互換性を確認した前frontend/backendへ戻す。
- current pointerを古いrevisionへ戻す操作は別の所有者/運用認可・CAS・auditを伴う明示操作。単なるdeploy rollbackで全曲pointerを一括変更しない。
- 画像の旧pointerを戻す場合はassetがまだ存在/verifiedで参照可能なことを確認する。削除済みbytesが戻ると仮定しない。
- cleanup不具合時はcleanup workerだけ止め、参照中asset保護を優先する。登録済みRevisionの削除やscore ledgerの補正で帳尻を合わせない。
- rollback後もコミット済み保存receiptを保持し、timeout後のretryが同じ変更を二重適用しないようにする。

## 16. テスト計画と受入条件

「追加コードに同じ条件式を書いたunit test」だけで完了しない。利用者操作、保存結果、不正request、競合、旧機能の不変性を検証する。テストの新ファイル名は提案で、既存testへ自然に加えられるものは統合する。

### 16.1 Unit

| ID | テスト | 合格条件 |
|---|---|---|
| U01 | preview S=null/0/18秒未満曲/中盤/終端1ms/D/負/NaN/Infinity | null維持、end clip、無効値拒否、18秒固定 |
| U02 | 時刻文字列、±step、drag ms変換、BIGINT version | 往復で意図しない丸めなし。安全範囲超のversionも文字列で一致 |
| U03 | peaksのsample→時刻、partial bin、逆相stereo、VBR/preskip | 波形とfixture時刻が一致。全channelの振幅を失わない |
| U04 | memory budget/cache key/IDB不可/abort | PCMを全保持せず、hash別cache、abort後返信無視、memory fallback |
| U05 | Native BPM/Offset、absolute/unknown BPM | Nativeだけ編集、全note/holdを再検証。FNF両side保持 |
| U06 | draft reducerとdirty、base遅延取得、古いsave応答 | metadataのみdirty、playhead等は対象外、古い応答でdraft消失なし |
| U07 | image container/MIME/frame/header/寸法 | JPEG/PNG/static WebPのみ。偽MIME/SVG/HTML/GIF/APNG/animated WebP拒否 |
| U08 | payload hashing、requestId再送/異payload、path | 同意を含め安定hash。別payload拒否、任意pathやprotected fields拒否 |
| U09 | tap判定mouse/touch/pen/scroll/pinch/menu | single即時、double一回、scroll/二指/menuがplayにならない |
| U10 | cleanup state/lease/backoff | 期限前・参照中・committed revisionを削除候補にしない |

`tests/chart-validation.test.ts`、`tests/audio-preview.test.ts`を拡張し、new `tests/song-settings-draft.test.ts`、`tests/waveform.test.ts`、`tests/image-validation.test.ts`等へ分ける。

### 16.2 Integration / component

| ID | テスト | 合格条件 |
|---|---|---|
| I01 | `ProfileScreen`のA/B/anon | 自分の投稿だけ管理UI、通常SELECT/共通詳細に編集入口なし |
| I02 | single→⋮→編集、double、明示PLAY、keyboard | 全入力で既存曲詳細へ正しく遷移。doubleから自動STARTしない |
| I03 | menu連打・編集連打・open/closeを50回 | modal一つ、handler/timer/objectURL/scroll lock漏れなし |
| I04 | dirty Esc/backdrop/×/browser back/内部navigation | 共通確認、cancelでdraft維持、破棄で解除、focus復帰 |
| I05 | clean close/直接URL/戻る→進む | 履歴の二重pushやback loopなし。元プロフィール保持 |
| I06 | audio rapid seek/selection/Sを1ms変更 | 最終要求が再生、重複sourceなし、20ms閾値で無視されない |
| I07 | buffering/URL期限/auth変更/close/START/pagehide | 終端判定は音声時刻、適切に停止、勝手に復帰しない |
| I08 | image選択取消/削除/verify失敗/再試行 | 保存までは旧背景、100%転送≠DB完了、失敗理由とretry |
| I09 | 保存二重送信/timeout/commit後応答欠落 | 同じrequestIdで1commit。照合後のみ成功表示 |
| I10 | account切替中のfetch/upload/保存 | 旧token/応答が新accountへ表示・保存されない |
| I11 | 成功後一覧/PLAYの更新、古いfetch後着 | 新rowが即時反映、古いrowへ戻らない。実行中runは不変 |
| I12 | 背景decode失敗/軽量化/dim/CLASSIC | fallbackあり、ノーツ・入力・HUD表示を阻害しない |

Mock AudioElement/AudioContextは競合ロジック確認用。実codec・autoplay・実seek精度まで証明したと報告しない。

### 16.3 DB / RLS / 原子性

| ID | テスト | 合格条件 |
|---|---|---|
| D01 | A曲へB/anonがread/settings/save/prepare | mutation不可、非公開情報漏洩なし |
| D02 | raw RESTでsongs protected columnsをUPDATE/INSERT | ownerでも禁止列・foreign revision/assetを注入不可 |
| D03 | authenticatedからservice-only RPC、偽actor | EXECUTE拒否。server側owner検査も通らない |
| D04 | 他人/別曲/別purpose/期限切れassetをswap | transaction全体失敗、metadata/pointer/version不変 |
| D05 | A端末/B端末が同じversionで同時保存 | 1件だけ成功、もう1件409。lost updateなし |
| D06 | 同songへ同時timing/replacement保存 | revision number重複なし、pointer一貫、候補は公開されない |
| D07 | 同requestId再送、異payload、成功後さらに別保存 | receipt再送で二重commitなし、異payload拒否、最新rowを巻戻さない |
| D08 | metadata+background+timingの途中error注入 | どれかだけ反映されない。全commitまたは全旧状態 |
| D09 | `is_published=false`曲の設定保存 | 下書き維持、published_at不変 |
| D10 | registered revisionのrow/bytes変更・削除 | serviceも通常経路で拒否。旧revisionを保持 |
| D11 | cleanup claimとsaveが同assetで同時実行 | 参照中削除なし。deleting assetへの新swap拒否 |
| D12 | orphan revision GC markerと遅いcommit競合 | terminal operationはcommit不可、登録済みfileはGC不可 |
| D13 | flag OFF/schema不足/column追加後旧client | 安全な停止、旧read/PLAYとmetadata互換の契約を維持 |
| D14 | 空DB / 前回schema+legacyデータからupgrade | migration成功、既存Score/XP/owner値の不意な変更なし |

既存`tests/chart-security-db.test.ts`、`tests/helpers/database.ts`を拡張する。PGliteで関数/triggerの回帰を速く検証した後、**実PostgreSQLの複数connectionによる同時実行**と実JWT roleでD01〜D14を確認する。

### 16.4 実Storage / server runtime

| ID | テスト | 合格条件 |
|---|---|---|
| S01 | valid JPEG/PNG/static WebP | canonical MIME/hash/dimensionsとDB一致、original公開なし |
| S02 | 小byte巨大dimension/3MiB超/偽MIME/truncated/animation | byte/CPU/memory上限内で拒否、row/pointer不変 |
| S03 | 任意path/他人prefix/upsert/token期限切れ/予約なしupload | storage/server認可で拒否。予約とtokenの期限差はS07で別検証 |
| S04 | upload途中切断/verify前停止/canonical書込後crash | 旧画像維持、冪等retryまたは期限cleanup |
| S05 | pointer swap後の旧画像cleanup、参照共有legacy | 未参照だけ削除。avatar/他曲画像を削除しない |
| S06 | Storage 404/429/5xx、cleanup再実行/二重worker | 正しいretry/lease、失敗記録、二重破壊なし |
| S07 | signed URL2hと予約1hのずれ | 期限切れverify拒否、token生存中に早すぎるcleanupをしない |
| S08 | private URL/非公開曲/公開→非公開/URL期限 | 認可外の新署名なし、期限付き閲覧の既知仕様を確認 |
| S09 | Cloudflare実targetでcodec/WASM/100MiB境界 | メモリ/CPU上限を測定、bounded処理、正常/異常両方確認 |
| S10 | 実cronからcleanup endpoint | 認証・実行・再試行・監視が稼働。tableだけで終了しない |

### 16.5 E2E / 実機 / accessibility

現在Playwright E2E基盤はない。追加する場合はdev dependency・設定・再現手順をpinし、Vitestと分離する。Chromium/Firefox/WebKitの自動E2Eに加え、実iPhone Safariで最低次を実施する。OS/browser version、端末、viewport、結果を記録する。

- 320〜430px相当の縦画面、横画面、notch/safe area、PC 1280px以上、browser zoom 200%。すべてのfield/保存/閉じるに到達でき、横overflowやfooter被りがない。
- ソフトkeyboardを出したままscroll/保存/close。visualViewport縮小時も操作可能。画像選択から戻った時もdraftを維持する。
- 1tap/2tap、menu内tap、縦scroll、長押し、pinch、波形dragとscroll競合、細かいstep、rapid seek。誤ったPLAYやページzoom抑止がない。
- 初回gestureで試聴、Safariの拒否から手動再生、tab切替/画面lock/復帰/pagehide、URL更新、START停止。音が二重に鳴らない。
- 波形overview/zoomと音声の同期を、WAV/Ogg/MP3/AAC等の対応format、短曲/長曲/VBRで検証する。既知のimpulse時刻をfixture化し、peaksのbin内一致を確認。実headの表示誤差も測定して記録する。
- Tab/Shift+Tabだけで選択→menu→編集→全項目変更→保存→閉じる。Enter/Space/矢印/Escの意味が一貫。focusが背面やブラウザへ抜けない。
- VoiceOverとPC screen readerで曲名付き⋮ラベル、section見出し、field error、保存結果が読める。波形drag以外の操作で同じ値へ設定できる。
- OS reduced motionとPulse設定の両方を個別にONにして確認。focus indicator・選択・errorを色だけで伝えない。touch target44pxを確認。
- open/close50回、別曲への切替、network offline→online、同時2tab編集、ログアウト→別ユーザーを含める。

### 16.6 既存機能の回帰

| 系統 | 必須確認 |
|---|---|
| 通常選曲/PLAY/詳細 | 選択・style優先順位・START・RETRY、編集入口以外の操作は同じ |
| Native/.osu/FNF | 新旧曲、左右side、classic visual skin、sustain現行扱い、chart.fnf保持 |
| input/判定 | keyboard、multitouch、PR #7補正符号、FNF early-input policy。該当既存testを全成功 |
| audio/settings | preview18秒、音量、cache、settings persistence/hydration、reducedMotion、背景dim |
| Result/Score/TOTAL SCORE | 同じfixture結果の記録、重複play_id、offline queue、profile/global rankingを比較 |
| XP/Level | session snapshot、ledger、award、progress、旧revision結果、catalog pendingの新revisionで誤加算なし |
| プロフィール/投稿 | avatar、旧画像、metadata未適用時の既存fallback、新規投稿、公開/下書き維持 |

「設定だけ保存」の前後で既存`play_results/player_stats/play_result_context/player_progress/xp_ledger`の対象行と値が変わらないことをfixtureで比較する。BPM/Offset保存後も同じ比較を行い、新しいPLAYだけが新revisionを使うことを確認する。

### 16.7 validation commands

以下は現在存在するpackage scriptsを基準にしたコマンド。プロジェクトrootで実行する。Bun/Nodeの実version、lock hash、実行結果を残す。

```sh
git status --short --branch
git rev-parse HEAD
bun --version
node --version
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build
bun run lint
git diff --check
git status --short --branch
```

Bun利用不可なら環境を安全に整える。私設registryの認証不足を別version/別lockへの差替えやsupply-chain guard無効化で回避しない。今回調査の`npm test/typecheck/build`成功は参考baselineであり、lock再現試験の代用ではない。

lintは現在156 errors/7 warningsのbaselineを持つ。最初に自環境で再採取し、変更/追加ファイルの新しい違反は0にする。全体lint失敗を無視・disable・設定弱体化で隠さない。既存違反は差分とともに報告し、今回変更に関係するものは安全に修正する。無関係な全体formatでPRを膨らませない。全体lint未解決なら「全validation成功」と記載しない。

DBは利用Supabase CLIのversionとhelpを確認し、**ローカルprojectだけ**で`supabase start`、`supabase db reset --local`、`supabase db lint --local`相当を実行する。linked本番へresetを送らない。migration履歴に既存の差があれば、apply前に解決する。

E2Eを追加した場合は`test:e2e`等のscriptを今回定義し、実際に動くコマンドをREADME/完了報告へ記載する。存在しないscriptを実行済みと記載しない。`tsconfig.json`の対象外となる新test/Worker/server型も、適切な専用tsconfigまたは既存build検査で型確認し、`any`で隠さない。

## 17. Codexの実装順序・完了判定・報告

### 17.1 実装順序

1. **再調査とbaseline**: HEAD/AGENTS/差分、現機能、本番未確認事項、tests/lint/installを記録。作業branchを既存変更と衝突させない。
2. **contractとDB**: field分類、strict DTO、version文字列、operation/画像参照、原子的commit、RLSを実装。D01〜D14を先に通す。
3. **source/revision**: legacy snapshot、canonical clone、timing basis、audio検証、旧history保持、未登録候補GCを実装する。現在のfile replacementを同経路へ統合。
4. **画像domain**: reserve/verify/canonical/signed read/cleanupを実runtimeで完成。flag OFFで試験する。
5. **preview/波形domain**: controller lease/seek/head、Worker/cache、format対応、長時間音源、mobileの計測を完了する。
6. **UI統合**: MY TRACKS選択/menu、floating panel、draft/dirty/history、画像とtiming確認、cache/一覧反映を実装する。
7. **全体検証**: unit/integration/DB/Storage/E2E/実機/回帰、typecheck/build/lintを実行。原因を特定して安全な修正を行う。
8. **rollout/完了報告**: 許可された対象環境でmigration・flags・scheduler・smokeを実行し、実際の適用状態を記録。未実施は分離報告。

この順序は依存関係の目安。安全に順序を変えてもよいが、UIだけ作って下位層を未完了のまま終了しない。巨大な新基盤や無関係な判定修正を差し込まない。

### 17.2 完了条件

- [ ] 自分の投稿だけに選択→⋮→編集があり、1tap/2tap/明示PLAY/keyboardを満たす。
- [ ] profileを保ったresponsive modal、全close経路、dirty確認、focus/scroll/reduced motionが動く。
- [ ] 実音源に一致した全曲波形・拡大調整・head・18秒試聴・終端・停止/世代管理が動く。
- [ ] 古い曲も必要なsnapshotを安全に作り、既存挙動/未設定値を保持できる。
- [ ] 背景Betaの選択/検証/保存/削除/取消/進捗/失敗/retry/実表示/cleanupが揃う。
- [ ] Native BPMとOffsetの保存が新revisionになり、FNF/.osu/unknownを誤解釈しない。
- [ ] metadata/image/timingが原子的で、CAS/同時編集/応答喪失/冪等retryが成立する。
- [ ] UIを迂回した認可試験、実Storage、service-only境界、protected columnsが合格する。
- [ ] 旧Score/TOTAL SCORE/XP/Level/結果/旧revisionを変更せず、関連回帰が合格する。
- [ ] tests/typecheck/build/lintの結果、migration/rolloutの状態、実機試験の証拠が残る。
- [ ] 明示的な除外以外を勝手にFuture Workへ移していない。残件があれば未完了として具体化した。

### 17.3 実装後の最終報告形式

```text
対象commit / branch / PR:
実装した機能:
再利用した既存基盤:
変更したDB / API / Storage:
検証結果:
  command・環境・件数・成功/失敗
  実PostgreSQL / Storage / iPhone Safariの結果
既存機能の回帰結果:
本番適用状態:
  migration versions / flags / deploy SHA / scheduler / smoke
  未実施は明記（ソース上の存在と分ける）
rollback手順:
未完了項目（ある場合のみ、項目ごと）:
  要求/受入ID:
  完了できなかった理由:
  調査した内容:
  試した対応（原因・仮説・結果、最大3回程度）:
  残っている問題/影響:
  次に必要な作業/権限/環境:
  現在のflagと公開可否:
```

「コード作成済み」「Betaだから後で検証」「未確認だが適用済みのはず」は完了報告として認めない。今回の作業成果物は本指示書であり、上記の実装・適用・検証は次のCodex作業で実施する。

## 18. 調査根拠・一次資料・要求対応

### 18.1 リポジトリの根拠

以下はすべて調査HEAD固定リンク。GitHub上のmainが進んだ場合でも、本文の観測時点を再確認できる。

| source | 確認した内容 |
|---|---|
| [AGENTS.md](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/AGENTS.md) | 履歴保護、FNF保持、settings制約 |
| [package.json](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/package.json) | 実行scriptsとdependency指定 |
| [bun.lock](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/bun.lock) | lock解決値 |
| [src/components/app/RhythmHub.tsx](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/components/app/RhythmHub.tsx) | ProfileScreen / SelectScreen / UploadScreen / selectSong / startSong / editSong |
| [src/components/app/SongMetadataEditor.tsx](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/components/app/SongMetadataEditor.tsx) | 現行の別画面metadata編集とRevisionPublisher接続 |
| [src/lib/chartRepository.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/chartRepository.ts) | 旧曲/Revision読取、preview許可、metadata保存 |
| [src/game/chartFile.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/game/chartFile.ts) | parseNative / parseOsuMania / parseFnfLegacy / parseFnfVslice |
| [src/game/engine.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/game/engine.ts) | buildRuntimeNotes、beat/offsetから実時刻への変換 |
| [src/game/runConfiguration.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/game/runConfiguration.ts) | runのrevision/side/style/parser/settings snapshot |
| [src/game/audioSession.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/game/audioSession.ts) | 18秒、generation、AudioContext、MediaElement、署名更新 |
| [src/hooks/useAudioPreview.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/hooks/useAudioPreview.ts) | previewのcomponent側lifecycle |
| [src/components/game/SettingsPanel.tsx](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/components/game/SettingsPanel.tsx) | 既存設定のデザインと手製focus/scroll管理 |
| [src/components/game/GameScreen.tsx](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/components/game/GameScreen.tsx) | 背景dim、visual、入力領域 |
| [src/lib/chartRevision.server.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/chartRevision.server.ts) | 現行revision作成・検証・Storage・publish処理 |
| [src/lib/audioMetadata.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/audioMetadata.ts) | WAV/Ogg検証、duration範囲 |
| [src/lib/chartValidation.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/chartValidation.ts) | canonical/両side/path/byte validation |
| [src/lib/chart.functions.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/chart.functions.ts) | Revision gate、imageUploadEnabled=false |
| [src/lib/uploadProgress.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/uploadProgress.ts) | XHR uploadと固定upsert |
| [src/integrations/supabase/auth-middleware.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/integrations/supabase/auth-middleware.ts) | JWT検証とuserId context |
| [src/lib/ownerTransport.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/src/lib/ownerTransport.ts) | owner token固定 |
| [supabase/migrations/20261012110000_chart_revisions_metadata.sql](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/supabase/migrations/20261012110000_chart_revisions_metadata.sql) | metadata CAS、protected columns、immutable revisions |
| [supabase/migrations/20261012120000_private_asset_foundation.sql](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/supabase/migrations/20261012120000_private_asset_foundation.sql) | 予約/画像/cleanup、private buckets、無効なreserve grant |
| [supabase/migrations/20261006200000_global_score_ranking.sql](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/supabase/migrations/20261006200000_global_score_ranking.sql) | プレイ結果INSERTからuser TOTAL SCORE累積 |
| [supabase/migrations/20261012220000_result_context_audit.sql](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/supabase/migrations/20261012220000_result_context_audit.sql) | 結果contextとrevisionの対応 |
| [supabase/migrations/20261012210000_xp_transactions.sql](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/supabase/migrations/20261012210000_xp_transactions.sql) | XP transactionと既存検証条件 |
| [docs/pulse-lane-next-update.md](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/docs/pulse-lane-next-update.md) | 前回実装/未適用・検証記録 |
| [docs/fnf-input-investigation.md](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/docs/fnf-input-investigation.md) | 直前の判定/補正調査。今回の不要変更禁止の根拠 |
| [tests/helpers/database.ts](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/40347afc5ef15e67f3f901d970e4fffac1fd3643/tests/helpers/database.ts) | PGliteのauth/storage stubと実環境との差 |

### 18.2 Web一次資料

確認日: 2026-10-15〜16。本文の寸法・TTL・memory budget・retry回数・UI閾値等は、明記した既存値を除き**本機能向けの設計値**であり、下記資料がそのまま推奨する数値とは限らない。候補libraryの稼働可否を未検証のまま断定していない。

| ID | 一次資料 | 本文への適用 |
|---|---|---|
| W01 | [MDN — decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) | 完全なencoded fileを対象とするAPI。断片を渡すstreaming decoderとして扱わない。 |
| W02 | [MDN — AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer) | channelごとのFloat32 PCM。本文のメモリ値はこの表現からの計算。 |
| W03 | [WaveSurfer — Documentation](https://wavesurfer.xyz/docs/) | 大きいaudioの全体decodeとpre-decoded peaksに関する制約。今回自前Canvas/Workerを選ぶ判断材料。 |
| W04 | [WebKit — New video policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/) | user gesture起点の制約。歴史的説明であり、最新iOS全条件の保証には使用しない。 |
| W05 | [MDN — HTMLMediaElement.currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime) | seek/再生時刻と精度上の制約。 |
| W06 | [MDN — Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) | pointer capture、pointercancel等の入力モデル。 |
| W07 | [MDN — touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) | pan/pinch/manipulationの意味。ページ全体のzoomを奪わない。 |
| W08 | [WAI-ARIA APG — Dialog modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | modal focus、Esc、復帰focusの基本。 |
| W09 | [Radix — Dialog](https://www.radix-ui.com/primitives/docs/components/dialog) | Dialogのmodal/focus/keyboard機能。実装はrepoの1.1.23型/APIへ合わせる。 |
| W10 | [TanStack Router — Navigation blocking](https://tanstack.com/router/latest/docs/guide/navigation-blocking) | dirty navigation/beforeunload/blocker。 |
| W11 | [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) | OS motion preference検出。 |
| W12 | [W3C WCAG 2.2 — Dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | dragを必要としない操作の提供。 |
| W13 | [eshaz — wasm-audio-decoders](https://github.com/eshaz/wasm-audio-decoders) | 作者一次資料。codec別WASM/streaming/Worker候補。Pulseの実bundleでの適合は未検証。 |
| W14 | [Mediabunny — Reading media files / Media sinks](https://mediabunny.dev/guide/reading-media-files) | 部分読取/demux候補。別途 [Media sinks](https://mediabunny.dev/guide/media-sinks) で段階的sample処理を確認。 |
| W15 | [Supabase — Storage access control](https://supabase.com/docs/guides/storage/security/access-control) | Storage RLS、service keyがpolicyを迂回すること。 |
| W16 | [Supabase — Buckets fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals) | public/private bucketのアクセスモデル。 |
| W17 | [PostgreSQL — Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) | row lock、deadlock、lock順序。DB transactionは外部Storageまで原子化しない。 |
| W18 | [TanStack Query — Invalidations from mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations) | mutation後のquery invalidation。Pulseの手動一覧stateは別途更新が必要。 |
| W19 | [OWASP — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | 多層validation、拡張子/MIMEを信用しない、サイズ制限、画像rewrite等。 |
| W20 | [Cloudflare Workers — Limits](https://developers.cloudflare.com/workers/platform/limits/) | isolate memory 128MiB、JS/WASMを含む制限。CPU等は実plan/runtimeで確認する。 |
| W21 | [jSquash — Author repository](https://github.com/jamsinclair/jSquash) | 画像codec WASMとCloudflare例。採用候補でありPulseで稼働確認した証拠ではない。 |
| W22 | [Supabase — Delete objects](https://supabase.com/docs/guides/storage/management/delete-objects) | Storage APIによる削除。SQLでmetadataだけ消す方法を避ける。 |
| W23 | [Supabase JS — createSignedUploadUrl](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) | signed upload tokenの2時間有効期間。 |
| W24 | [Supabase — Serving assets](https://supabase.com/docs/guides/storage/serving/downloads) | private配信、signed URLはAuth署名鍵変更だけでは失効しない。 |
| W25 | [W3C — PNG Third Edition](https://www.w3.org/TR/png-3/) | PNG/APNGのcontainer/frame構造。静止画だけを許す検査に使用。 |
| W26 | [Supabase — Database functions](https://supabase.com/docs/guides/database/functions) | SECURITY DEFINER、search_path、EXECUTE権限。 |
| W27 | [TanStack Start — Server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) | server functionの入力・middleware・server-only実装境界。 |
| W28 | [Google — WebP container / IETF RFC 9649](https://developers.google.com/speed/webp/docs/riff_container) | ANIM/ANMF/animation flagとcontainer構造。RFC一次資料: [RFC 9649](https://www.rfc-editor.org/rfc/rfc9649.html)。 |
| W29 | [WAI-ARIA APG — Menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) | ⋮menuのrole/keyboard契約。 |
| W30 | [MDN — dblclick event](https://developer.mozilla.org/en-US/docs/Web/API/Element/dblclick_event) | native mouse double-clickとclick発火関係。 |
| W31 | [osu! — .osu file format](https://osu.ppy.sh/wiki/en/Client/File_formats/osu_(file_format)) | 本家のPreviewTimeはms。Pulseが自動importしているとは推定しない。 |
| W32 | [FunkinCrew — SongData.hx](https://github.com/FunkinCrew/Funkin/blob/main/source/funkin/data/song/SongData.hx) | 本家のtimeFormat/timeChangesを確認。Pulseの現在の簡易parserとは別契約。 |
| W33 | [W3C — Web Audio API](https://www.w3.org/TR/webaudio-1.0/) | AudioContext/MediaElement sourceの仕様。既存shared controllerを拡張する際の一次資料。 |

本家osu!/FNFのformatに項目が存在しても、Pulseが現在保持/利用していなければ「実装済み」には数えない。最新docsのサンプルAPIがrepoのpin versionと異なる場合は、pinした型・source・公式version履歴を確認する。

### 18.3 ユーザー要求との対応

| 要求 | 指示書の場所 |
|---|---|
| 最初の全体調査・既存/新設分離・本番未確認 | §1〜2、§15.1、§18.1 |
| プロフィール導線・tap/double tap・通常選曲維持 | §4、§16.2/16.5 |
| フローティング設定・開閉・focus/history | §5 |
| 18秒波形preview・audio/性能/終端 | §7〜9、U01〜U04、I06〜I07 |
| 背景Beta・既存基盤再利用・安全性・cleanup | §11、§13、S01〜S10 |
| metadata一覧・A/B/C/D/E・BPM/Offset | §6、§10 |
| Metadata EditとGameplay Revision分離 | §9〜10、§12.3 |
| 保存UX・CAS・冪等性・cache | §5.3、§12 |
| DB/Storage/認可・改変request | §11〜13、D01〜D14 |
| スマホ優先・PC・accessibility | §4〜8、§16.5 |
| Score/TOTAL SCORE/XP/古いchartの保全 | §10.3、§16.6 |
| 一次情報の技術調査 | §18.2 |
| Unit/Integration/DB/RLS/UI/E2E | §16 |
| 完遂ルール・最大3回・未完了報告 | §0、§17 |
| 明示スコープ外の維持 | §3 |
| migration・flag・rollback・production | §15 |

### 18.4 今回の調査成果と未確認事項

**調査・仕様設計・この指示書の作成は完了。機能実装は今回行っていない。**

確認済み: 上記HEADの実コード/履歴、全体構成、13 migration、既存UIとaudio/Revision/画像基盤、主要一次資料、既存tests 214件/typecheck/buildの参考baseline、lint既存問題、参照pathの実在。

未確認: 本番DB/Storageへの実適用・運用flag、公開deployのHEAD、lockfile完全再現install、実機iPhone Safari、新設WASM/codec/画像processorの実runtime性能、今回まだ実装していない機能のtests。本番credentialsや実機を使わずに、これらを確認済みとはしていない。

