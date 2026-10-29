# Pulse Lane Performance Update — Phase 2実装・Phase 3–4測定待ち

調査基準と開始時mainは `dfc071d017edfc4b358450c546f36ea50875ce76`。GitHub branches/main APIで確認。AGENTS.mdを確認し、専用branch `codex/pulse-lane-performance-phase2-4` で作業。#10/#9/#7/#6/#5/#3/#2/#1はmerged、#8はDraft/open、#4はopen。#8 headは `c00fbbc487eefcae097acaacf3e9528c4d4b6d65`、未統合のSong Settings変更は取り込んでいない。main push、merge、deploy、DB操作は行っていない。

## 変更理由と固定SHAの根拠

以下のリンクはすべて固定SHAの変更前コード。

- [GameScreen L185–188](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/dfc071d017edfc4b358450c546f36ea50875ce76/src/components/game/GameScreen.tsx#L185): 結果でのみ使用するtimingErrorsMsのreduceが毎描画走る。finished時のみ集計するよう変更。mutable配列の参照だけではmemo化していない。
- [GameScreen L257](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/dfc071d017edfc4b358450c546f36ea50875ce76/src/components/game/GameScreen.tsx#L257) と [InputOverlay L220](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/dfc071d017edfc4b358450c546f36ea50875ce76/src/components/game/InputOverlay.tsx#L220): OFFでもLayerの測定observerとresize listenerが残る。既存inputOverlayEnabledを用いて表示Layerをunmountし、直接利用時もmounted childを分離。InputLedger、keyboard、TouchInputは維持。従来もOFF時の内側InputOverlayはunmountされ、内側RAFは停止していたため、今回のOFF改善を「従来のRAF停止」とは扱わない。
- [NoteSprite L22/L45](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/dfc071d017edfc4b358450c546f36ea50875ce76/src/components/game/NoteSprite.tsx#L22): bar影/circle glowが常時有効。[GameScreen L194](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/dfc071d017edfc4b358450c546f36ea50875ce76/src/components/game/GameScreen.tsx#L194)のshakeも軽量設定を参照していない。effectiveRenderingでノーツ影・判定線glow・hit ping・shake・背景を統一。FnfFieldにも同じglowを渡す。reducedMotionはping/shakeを抑止し、静止したglow/背景は残す。既存OS reduced-motion CSSも維持。
- [settings L70/L182](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/dfc071d017edfc4b358450c546f36ea50875ce76/src/game/settings.ts#L70): 既にversion 5。番号や保存キーを変更せず、描画presetを追加。既存v5に新フィールドがなければCustomに分類し、値はそのまま保存。sanitizeを繰り返しても同じ結果。

## 描画設定

| Preset    | glow・hit・背景 | shake  | reducedMotion / lightweight | 入力表示 |
| --------- | --------------- | ------ | --------------------------- | -------- |
| Standard  | ON              | OFF    | OFF                         | ON       |
| Light     | OFF             | OFF    | ON                          | OFF      |
| Recording | OFF             | OFF    | ON                          | ON       |
| Custom    | 個別値          | 個別値 | 個別値                      | 個別値   |

選択時に変えるのはこの表の描画項目とrenderingPresetのみ。補正・音量・譜面速度・キー・Touch領域・レーン座標・ノーツ形状/大きさは変更しない。個別設定の変更でCustomとなる。従来のsimple/readable/effects用presetは互換性のため保持。Recordingという名前はOS録画性能の保証ではない。

## 実施済み検証と全標本

- 変更前production build成功。変更前の出力public assetsを `work/performance/baseline/public` に保存。build/testログとbaseline.jsonも同directoryに保存（workはgit対象外）。変更前public assets・baseline.json・build/testログは [verification/pulse-production-baseline.zip](verification/pulse-production-baseline.zip) にも保存。server bundleと計測traceは含まない。アーカイブのSHA-256一覧は検証記録JSONに収録。これは端末性能baselineの取得完了を意味しない。
- 変更前 `npm test`: 22 files / 248 tests成功。変更後: 23 files / 256 tests成功。
- `npm run typecheck` / `npm run build`: 成功。buildには既存の非推奨API・chunk size等の警告あり。
- 変更範囲ESLint: 0 errors / 0 warnings。`git diff --check`成功。
- `node scripts/verify-performance-equivalence.mjs`: 固定SHAからbaseline実装を抽出し、変更後と同一configuration/timestamp/advance順序で60標本を比較。mania・FNF左/右 × 60/144Hz advance × 入力delta -200/-140/0/+140/+200ms × tap/hold。holdにはcancelと同一lane複数sourceを含む。coreのnotes/play/hold interval/各process戻り値、Replayのschema/sequence/全イベント、verifyReplay結果を含む全出力をSHA-256比較。60/60一致。全標本の条件・event数・正確なUTF-8 byte数・得点・判定数・検証eligibility・両hashは [verification/pulse-performance-equivalence.json](verification/pulse-performance-equivalence.json)。標本イベント列はscriptから再生成できる。この144Hzは合成イベント列であり実144Hz端末の性能測定ではない。
- 新規テストはv5冪等移行、描画専用変更範囲、effective policy、bar/circle影OFF、Layer ON/OFF 20回を検証。20回は表示Layerの再入場であり、ゲーム/音声20回の実機再入場測定ではない。OFF時のobserver/RAFなし、ONからOFFで解放、継続中sourceが消えずOFFでもrelease可能であることを確認。
- 入力timestamp正規化、AudioClock.nowAt、hook、core、engine、judgementPolicy、Replay、runConfiguration、verifier、XP rules/evidence queue、score保存queue、TouchInput、広告componentは固定SHAとdiffなし。既存integration testsで入力/音声・FNF選択側・保存を回帰確認。新しい動画機能は追加していない。

## 未測定・Phase 3/4の保留条件

**性能向上の実測値はない。Phase 2の描画変更をレビューするDraftであり、Phase 2–4全体の完了ではない。**

`npm run preview -- --host 127.0.0.1 --port 5180` は既存TanStack previewが生成されていない `dist/server/server.js` を参照しERR_MODULE_NOT_FOUND。build出力はCloudflare用 `.output/server/index.mjs`。ローカルlistenのsandbox制約を解消した再試行でもこの既存previewエラーを確認。設定やdeploy先を変えて測定環境を偽装していない。production trace、同じ60秒区間のAB/BA最低5組は0組で未取得。devモードやjsdomテストをproduction測定の代用にはしない。

実iPhone Safari/低価格Android、録画OFF/ON、長曲・実高Hz・ヒット音ONの端末性能、ゲーム再入場20回のretained heap/AudioNode/AudioBuffer/listener/native media保持は未測定。コード上はAudioClock.stop/disposeにsource disconnect・buffer解放、audioSessionのmedia teardownとlistener cleanupがあるが、hit soundのone-shot oscillator/gainは明示disconnectを持たず、GC/OS保持は未確認。ここからリークの有無を断定せず、変更していない。

Phase 3ではまず正しいproduction runtimeで支配箇所を取得してから更新範囲を分割する。可視窓のlane分類とtransform位置更新はそれぞれ別A/Bが必要で、今回未変更。mutable notes/play/activeLanesの参照同一性のみのmemo化、FPS制限、入力/advance間引きは導入していない。

Phase 4ではOS録画OFF/ONを分け、端末型番・OS/browser・リフレッシュレート・曲/譜面hash・設定・温度/電源条件・60秒範囲を固定。AB/BAを最低5組（10 runs）保存し、各runのframe分布/long tasks/traceと20回前後のretainerを保存する。各別案を測り、同じsongTimeでノーツID集合/座標/速度を比較する。未取得の標本を0ms/成功として記載しない。Replayはprofileで必要と判明するまで最適化しない。schema/sequence/全イベント/UTF-8上限は現状維持。#8が後に統合されたら画像背景・実波形・private URL期限とCAS/権限を回帰対象へ加える。

## Revert単位

描画設定/描画変更/新規テストを1つの機能コミットにまとめ、比較scriptと報告/標本を別コミットにする。機能コミットをrevertすれば旧描画へ戻せる。保存は既存v5キーで追加フィールドのみのため、旧実装は未知フィールドを無視して補正等を保持する。migration/DB/deployのrollbackは不要。性能測定が揃うまでReady for review/merge判定は行わない。
