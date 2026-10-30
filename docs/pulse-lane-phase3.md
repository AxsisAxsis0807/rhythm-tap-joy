# Pulse Lane Phase 3 — production計測・描画候補の比較と撤回

この文書はPR #11のPhase 3追補。Phase 2の履歴は [pulse-lane-performance.md](pulse-lane-performance.md) に保持する。実機・OS録画のPhase 4完了を意味しない。

## 基準と依存関係

開始時main: `dfc071d017edfc4b358450c546f36ea50875ce76`。Phase 2比較基準: `47049059b1ff5cf88924db6c1062ca57d53dd17a`（PR #11の開始head）。AGENTS.md、#11の全12ファイル・テスト・報告・baseline archiveを再確認。専用branch `codex/pulse-lane-performance-phase2-4` を継続し、公開履歴は書き換えない。

#8（head `c00fbbc487eefcae097acaacf3e9528c4d4b6d65`）はDraft/open、#4（head `17b1cbb6a472cd5d0e43b535b0b362d020f7da93`）もopen。`git merge-tree --write-tree` による読み取り目的の仮想統合では、#8とGameScreenのbackground周辺が競合。#4とはGameScreen、AccountGrowth、RhythmHub、Replay、types、hook、Supabase types、accountGrowth、useAccountGrowth、xp.functions、xp-db testが競合する。実branchへのmergeはしていない。Phase 3は両PRの未統合コードに依存せず、現在のcore/Replay/XP/queueを維持する。#8統合時は画像背景・波形・private URL期限と権限/CASを追加回帰対象にする。

## production previewの原因と修正

- `@tanstack/start-plugin-core/dist/esm/vite/preview-server-plugin/plugin.js` はサーバーinput名から `dist/server/server.js` を組み立て、default exportのfetchをNode上で呼ぶ。
- `@lovable.dev/vite-tanstack-config@2.26.5` はbuild時だけNitroを追加し、既定の `cloudflare-module` presetで `.output/server/index.mjs` と `.output/public` を生成する。`vite preview` 時にはそのworker runtimeが追加されない。生成された `.output/nitro.json` のpreview commandもWranglerを指す。
- workerの正しいpreviewは `wrangler dev --local --config .output/server/wrangler.json`。Cloudflare workerdと生成ASSETS bindingを使用する。存在しないserver.jsのshim作成や本番presetのNodeへの変更は不要。
- package.jsonに `preview:production` を追加。`npm run build` → `npm run preview:production -- --port 5180` で起動。Wranglerは `4.156.0` を固定しnpxで解決する（初回のnpm registryアクセスが必要）。既存 `preview` と通常Vite/deploy設定・依存lockは変更していない。代わりにwork配下へ同版をinstallして直接実行してもよい。
- Wranglerはlocalhost限定、`--local`。本番deploy、認証操作、DB migration/更新を行わない。ローカル起動時の外部向け更新確認等の失敗ログがあっても、起動成功の判断は実際のHTTPとブラウザー起動による。

## 測定方法

`vite.performance.config.ts` はローカル計測専用config。通常configを読み込み、ソースマップと固定譜面データのload hookだけを追加する。ルート、GameScreen、AudioClock、InputLedger、core、Replay、入力、CSSはproduction実装を使用。dev build/React profiling buildへの置き換えはしていない。

固定fixtureはBPM 120、各bank 24 notes/s、14,400 notes（10分相当の配列）。FNF左右bankも同一密度。音声はローカル90秒・8kHz mono PCM（220Hz、振幅1000）で実Web Audioを使う。**これは合成fixtureであり実楽曲・長曲完走の評価ではない。** 比較時の音源SHAは両側同一。ゲスト、autoPreview OFF、1280×720、deviceScaleFactor 1、Chromium headless、Linux、CPU quota 2 cores。実GPU・実モバイル機・高Hzディスプレイの評価ではない。

Playwrightは実画面の「曲を探して遊ぶ」→STARTで入場。外部APIは空データで応答し、他の外部通信（広告も含む）は遮断。ゲストのためXPや保存のサーバーAPIを呼ばない。初期scriptはtop frameのみで実行し、広告sandboxを変更しない。

音声source.startを計測用に観察し、AudioContext由来の時刻で対象区間を決める。now/nowAt・core advance・DOM timestampを差し替えない。入力はブラウザーRAFから8Hzの合成keyboard down/upを通常の入力listenerへ送る。描画のためのRAFや入力/coreは制限していない。描画遅延による入力実時刻の差があるため、live得点を決定論的回帰の一致判定には使わず、別の固定イベント列で検証する。

Chromiumは151.0.7922.173。正式比較はnominal songTime 5.5–65.5秒、60秒窓、順序 AB / BA / AB / BA / AB の5組・10 runs。実際の観測開始/終了時刻・frame全列・入力pulse数も標本に保存し、ブラウザー/CDPの開始遅延を隠さない。ビルド・テストは測定前に完了し、測定中に並走させない。V8 CPU profilerは両版で1ms interval、Performance.getMetricsのTask/Script/Layout/RecalcStyleとRAF間隔・long taskを取得。profileにはmetricsの時間窓を保存する。

A = Phase 2、B = Sprite memoだけ、C = Sprite memo + visible-window/lane分類。12秒の個別AB/BAでA–B、B–Cを分離し、60秒の正式比較はA–Cとする。探索の入力表示ON/OFF・light条件、FNF短時間profileは正式5組と区別する。source mapによるsampling attributionは統計標本であり、正確な関数呼出し回数や全frameのReact commit数ではない。

## 比較した描画候補（正式比較後に撤回）

以下の2候補はtrial commitとして実装・検証したが、正式比較で改善を確認できず、最終headでは両方をrevertしている。

1. NoteSpriteの見た目部分をmemo化。adapterがmodeからshape/color/size/rotationとbooleanを毎回読み、primitive snapshotを内部Spriteへ渡す。fresh/mutatedなmodeも観測でき、静止した見た目の再生成を抑える。mode objectを比較するcustom comparatorは使わない。mutable notes/play/activeLanesをmemoのキーにしない。
2. 既存のbinary-search可視窓を純粋関数へ移し、各描画でlane bucketを1回作る。従来の「4 laneそれぞれで全visible配列をmapして他laneをnullにする」構造を避ける。FnfFieldはplayer/opponent別に分類し、opponent receptorのsomeもそのlaneに限定。GameScreenはFNF表示時に未使用のmania可視窓を作らない。judged等は描画時にその都度読む。
3. maniaの上限比較 `note.time - time > travel` とFNFの `note.time > time + travel` は浮動小数点の丸めが異なる可能性があるため、各呼出元の式を保持。可視下限、座標、速度、visualOffsetの既存適用範囲も維持する。FnfFieldへ新たにvisualOffsetを適用する仕様変更はしていない。
4. top位置をtransformへ変える案は未実装・未測定。CSSのtranslateYの%は要素自身の高さで、既存topの%は包含blockの高さ。単純置換では一致せず、field寸法の観測・resize・拡大縮小を含む独立検証が必要。Layout/RecalcStyleを測っても、その全時間をノーツ位置更新に帰属できないため、今回の改善結果からtransform案の効果を推定しない。

Phase 2の描画preset、effective設定、OFF時Layer全unmount、結果時だけ平均誤差計算は維持。FPS制限、入力/advance間引き、Replay最適化、動画背景は追加していない。

## 結果

**採用判断: 描画候補は採用しない。** 12秒のスクリーニングでは小さなscript時間減少が見られたが、60秒5組ではtask/frame指標に一貫した改善がない。型・描画・判定の回帰がないことと、性能改善があることを区別する。最終headのsrcはPhase 2と同じで、preview command・計測/検証tooling・報告と追加の描画回帰testを残す。

以下は60秒runあたり、各5標本の平均。A=Phase 2、C=2候補を組み合わせた版（rawではlabel B）。符号はC/A−1。

| 指標                     |         A |         C |       差 |
| ------------------------ | --------: | --------: | -------: |
| Main-thread TaskDuration | 15.6564 s | 15.7217 s |  +0.417% |
| ScriptDuration           |  4.8008 s |  4.7756 s |  −0.526% |
| LayoutDuration           |  1.3493 s |  1.3679 s |  +1.380% |
| RecalcStyleDuration      |  2.8331 s |  2.8417 s |  +0.303% |
| RAF interval p95         |   16.8 ms |   16.8 ms | 変化なし |
| 25ms超frame数            |      30.6 |      44.0 |     増加 |

| Pair | 順序 |  task差 | script差 | 25ms超frameの差 |
| ---- | ---- | ------: | -------: | --------------: |
| 1    | A→C  | −4.772% |  −4.866% |              −6 |
| 2    | C→A  | −3.361% |  −4.671% |             −19 |
| 3    | A→C  | +5.911% |  +2.368% |             +52 |
| 4    | C→A  | +3.925% |  +6.093% |              +9 |
| 5    | A→C  | +0.865% |  −0.894% |             +31 |

全10 runsにブラウザー例外なし。観測開始は5.5008–5.5183秒、終了は65.5011–65.5303秒、全runで入力481 pulses。実開始/終了が完全一致するとは主張せず、全値をprovenanceに保持する。改善したpairだけを選んでいない。5組のばらつきが大きく、平均scriptの0.5%を再現性のある改善と判定しない。これはこのLinux合成fixtureにおける採否であり、端末全般の差を示すものではない。

全標本・集計・source-map attribution・除外理由とraw profileは [検証資料](verification/pulse-phase3/README.md) を参照。最初の探索には計測init scriptが広告sandbox内でlocalStorageへ触れた例外、FNFのroleをbuttonとしたselector timeoutがある。top frameだけに限定し、radio selectorへ修正して再取得。ビルドと重なったsprite-screen標本も正式比較から除外し、削除せず保存。これらは最適化の成功根拠に使っていない。

## ボトルネックの根拠と探索条件

正式run 1のsource-map付きV8 sampling（metrics窓へcrop）では、名前付きJS sourceのself timeがReact DOM production 2,322ms、GameScreen 776ms、InputOverlay 243ms。GCは566ms、Replayは86ms。大きな `(program)` 領域10,152msもあり、その全時間をReactやノーツ抽出に帰属できない。NoteSprite関数単体や可視窓binary searchが支配的という証拠は得ていない。これを踏まえて静止した見た目の生成・React更新入力を小さくする候補を試したが、総合指標で利益が確認できず撤回した。判定/core/Replayを軽量化対象へ拡張する根拠にはしない。

次の12秒標本は探索用の単発条件で、正式5組と混ぜない。入力表示OFFでは表示側の仕事が減る結果だが、単発の順序交絡を排除していない。Lightは複合設定のため背景単独の効果を表さない。

| baseline探索条件                     | TaskDuration | ScriptDuration | RAF p95 |
| ------------------------------------ | -----------: | -------------: | ------: |
| mania・overlay ON                    |      3.289 s |        1.046 s | 16.8 ms |
| mania・overlay OFF                   |      2.762 s |        0.808 s | 16.8 ms |
| mania・overlay OFF・Light            |      2.971 s |        0.815 s | 16.7 ms |
| FNF・overlay OFF                     |      3.173 s |        0.941 s | 16.7 ms |
| mania・overlay OFF・背景ON（別run）  |      2.788 s |        0.843 s | 16.7 ms |
| mania・overlay OFF・背景OFF（別run） |      3.047 s |        0.926 s | 16.7 ms |

背景OFFの方が短時間標本で遅いことも含め、背景やLightのCPU改善はこのデータから結論しない。FNFは別bank・形状・経路の診断で、maniaとの改善率ではない。FnfField、NoteSprite、Layout/UpdateLayoutTree/Paintの診断profile/timelineをraw archiveに保存する。timelineはwarmupを含む短時間の診断で、Tracing自体の負荷があり、イベントdurationも入れ子で重なるため加算しない。最初のtimelineはpreview command起動と重なったため、起動完了後にnative-cleanで取り直した。

## 回帰検証

- 候補版 `npm test`: 24 files / 259 tests成功。可視窓境界・seek・mutable judgedとmutated modeの反映を追加。最終版: 23 files / 257 tests成功。候補専用helper/testはrevertし、mode objectを変更したときの既存描画更新を確認する回帰testだけを保持。Phase 2のv5移行・OFF時Layer cleanup/入力継続も維持。
- `npm run typecheck`、通常 `npm run build`、変更範囲ESLint、diff checkを実行。buildの既存警告はログに残す。
- `verify-performance-equivalence.mjs`: 元の調査基準dfc071dから抽出したcore/Replay/verifierに対して60標本一致。全イベント・sequence・UTF-8 bytesを含む出力hashを比較。
- `verify-render-equivalence.mjs`: Phase 2のGameScreen/FnfField/NoteSpriteと現在の実レンダラーをReact SSRで比較。hook/persistenceと閉じたSettingsPanelだけをfixture化。mania/classic/FNF左右 × up/down × 7時刻（seek含む）× 3速度の168標本で、ノーツ集合・順序・位置/scale式・receptor状態を含むHTMLが一致。同じ配列/Setを変更して再利用する。SSR一致だけをブラウザーpaint/実機表示検証の代用にしない。
- `verify-render-geometry.mjs`: baselineの実production CSSをChromiumで読み、候補版と最終版それぞれについて72標本（seekの再訪を含む）のノーツ/receptorのgetBoundingClientRectが全項目一致。48標本（24の固有条件、seek再訪を含む）の有限差分速度も一致。これは固定snapshotのdesktop CSS座標検証であり、実機の連続プレイやOS録画の確認ではない。

## 再現手順

```sh
# npm dependenciesは導入済みであること。既存build-time環境を両版で揃える。
npm install --prefix work/phase3/tools --no-audit --no-fund wrangler@4.156.0 playwright
# Cは撤回済みtrialの再現。A/Bは下記SHAへ置き換えて別directory/portを使う。
git worktree add --detach work/phase3/source-C 650e738
mkdir -p work/phase3/source-C/scripts
cp scripts/vite.performance.config.ts work/phase3/source-C/scripts/
ln -s "$PWD/node_modules" work/phase3/source-C/node_modules
(cd work/phase3/source-C && npm exec -- vite build --config scripts/vite.performance.config.ts)
node scripts/prepare-performance-preview.mjs C work/phase3/source-C/.output
work/phase3/tools/node_modules/.bin/wrangler dev --local --ip 127.0.0.1 --port 5183 --inspector-port 9233 --config work/phase3/C/.output/server/wrangler.json
```

AはPhase 2 SHA `4704905`、Bはtrial `4fca980`、Cはtrial `650e738` を別worktreeにcheckoutする。最終版には候補が残っていないので、Cを最終headからbuildしない。同じ計測configをscriptsへコピー、同じdependencies/build-time環境でbuildしてsnapshot化する。BはSprite変更だけのcommitで同様にbuildする。`.output` のsnapshotを別々に保持し、比較中に上書きしない。`prepare-performance-preview.mjs` はpublic audioとbuild manifest（全出力hash）を保存する。サンプルとconfigは比較する両側で同一にする。

```sh
PLAYWRIGHT_PATH="$PWD/work/phase3/tools/node_modules/playwright" BASE_A=http://127.0.0.1:5181 BASE_B=http://127.0.0.1:5183 PAIRS=5 PERF_SECONDS=60 PERF_OUT=work/phase3/final-60s node scripts/measure-performance.mjs
node scripts/summarize-performance-profile.mjs work/phase3/final-60s/run-1-A-mania-overlayon-lightoff.cpuprofile.gz work/phase3/A/.output/public/assets
node scripts/verify-performance-equivalence.mjs
RENDER_CURRENT_REF=650e738 node scripts/verify-render-equivalence.mjs
PLAYWRIGHT_PATH="$PWD/work/phase3/tools/node_modules/playwright" node scripts/verify-render-geometry.mjs
```

`PLAYWRIGHT_PATH`はインストール先に合わせた絶対pathまたはnpm package名、`CHROMIUM_PATH`も環境に合わせる。MODE=explore / PERF_SECONDS=12で探索条件、MODE=effectsで背景単独条件、STYLE=fnfでFNFを指定できる。MODE=single / PERF_TRACE=onでChrome timelineを追加保存できる。raw CPU profilesはgzipしたDevTools形式、results.jsonは全frameを含む。各run終了直後に保存するため中断しても完了標本が残る。失敗・除外標本も削除せず理由を付ける。

## Phase 4の残項目とrevert

実iPhone Safari/低価格Android、実OS録画OFF/ON、実高Hz、長曲完走、実ヒット音、ゲーム再入場20回のretained AudioNode/AudioBuffer/listener/native mediaは実機検証待ち。Linux headlessでの8Hz合成入力＋hitSoundEnabledと区別する。Replay最適化はprofileによる必要性が確認されるまで行わない。

試作Spriteは `4fca980`、window/lane分類は `650e738`。後者を `97dc578`、前者を `a47c902` でrevertした。公開履歴を書き換えず、試作と撤回を両方追跡できる。再評価するなら別branchでtrial commitをcheckoutして測定し、未測定のままrevertを取り消さない。計測toolingは `fe2b68f`。`git revert fe2b68f` でpreview command・計測script・追加回帰testを外せる。報告とraw証跡は別commitで、こちらのrevertはゲーム実装に影響しない。設定schema/DB/data変更はなく、データ移行のrevertは不要。main push/merge/deployは行わずDraft #11を維持する。
