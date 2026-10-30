# Phase 3 evidence

- [summary.json](summary.json): 正式60秒5組・全10 runsとpair別集計。rawのlabel Bはtrial C（2候補の組合せ）。
- [provenance.json](provenance.json): A/B/C source commit、実build全ファイルhash、ソースマップと各commitの一致検証、全datasetの扱い、実観測時刻。
- [checks.json](checks.json): 候補版/最終版のtest、typecheck、通常production build、lint、core/Replay、HTML、ブラウザー座標/速度の実行ログと診断timeline集計。
- [raw-measurements.zip](raw-measurements.zip): 全frame列、CPU profiles、Chrome timelines、各buildのclient assets/maps、音声fixture、renderer snapshot結果、検証ログ、除外標本。archiveのhashは [artifact.json](artifact.json)。

ZIPを展開し、`.cpuprofile.gz` / `.trace.json.gz` をgunzipしてChrome DevToolsへ読み込める。source-map集計はrepoの `scripts/summarize-performance-profile.mjs` にprofileと `builds/A/assets`（raw label Bの正式runでは `builds/C/assets`）を渡す。timeline集計は `scripts/summarize-performance-timeline.mjs`。集計値のdurationは入れ子で重複するため足し合わせない。

`measurements` と `sprite-screen`、最初の `native-timeline` は例外・測定競合があり、正式比較の成功標本には使っていない。`sprite-clean` と `lanes-screen` は12秒AB/BAの探索、`explore-clean` / `background-screen` は単発条件、`native-clean` はTracing負荷を含む診断。正式比較は `final-60s` だけ。

source mapsのGameScreen/FnfField/NoteSprite（CではvisibleNotesも）は、記録された各Git commitの内容とbyte単位で一致。最終headでは候補をrevertし、src全体がPhase 2と同じ。実機/OS録画/長曲完走/20回のaudio retainer測定は未実施。
