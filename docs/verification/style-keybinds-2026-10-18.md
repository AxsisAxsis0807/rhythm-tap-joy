# Play Style別キーバインド実装・検証記録

検証日: 2026-10-18（JST）。専用branch: `codex/style-keybinds`。基準main: `96449aab48f8c6ac5e4a87594db034cb7dbdc9ca`。mainへのpush、merge、branch削除、履歴書き換え、本番deploy・DB・Storage変更は実施していません。

## 調査と開始点

GitHubのmain HEADはローカルHEADと一致することをGitHub連携とfetchで確認。Song SettingsはDraft PR #8 (`codex/song-settings-update`, `5dacc93063817146cf2d8854aef9625bb823ab8a`) にあり、mainを取り込み済みでした。既存作業を独立して維持するため、今回は最新mainから分岐しました。ほかに旧XP・入力レイアウト関連のopen PR #4/#5がありますが、取り込んでいません。

AGENTS.mdのLovable履歴保持、FNF両側メタデータと選択側採点、versioned設定、判定時刻・音声速度不変の指示を確認しました。

Lovableの「キー設定を2セットにしました」(96449aa、親側の実変更e1e074c等) は、SettingsPanel、GameScreen、InputOverlay、settings.tsを変更していました。ほかにpackage/bun.lock、previewAuthStorage、Supabase生成型の変更を含みます。UIだけではなく、localStorage保存、keyboard解決、入力テストも2セット化されていました。

ただしGameScreenの `[code, alt].filter(k => k && k !== code)` は主キー自身を除外し、主キーがプレイへ届きません。設定は全スタイルで共有され、サブキーもmaniaへ流入していました。Overlayは主キーだけを表示。重複検査はUIの8キー全体のみで、読み込み時の曖昧な割当は防げませんでした。

InputLedgerとGameplayCoreは既に物理sourceごとの保持と最終sourceでのレーン解放を実装。判定済ノーツは次の入力で再判定せず、別sourceによる次ノーツの入力は既存仕様として可能です。HoldとReplay/verifierは同じsource単位のイベントを扱います。この仕組みを維持し、判定コアは変更していません。

## 実装と再利用

- OSU!MANIA/FNFの編集切替をローカルUI stateとして追加。`lastPlayedStyle`や実Play Styleは変更しません。maniaはSET 1のみ、FNFはSET 1/SET 2を同時利用します。
- Lovableの4キー編集UI、キャプチャ、サブキー解除、2段レイアウト、入力テスト、versioned storeと保存エラー表示を再利用しました。
- 全スタイル共用の2配列と誤ったfilterを、独立設定と共通`resolveKeyMap`へ置換しました。Lovableのauth・依存・生成型の変更は今回書き換えていません。
- シンプル/視認性重視/演出重視の選択UIを削除。接続先`applyPreset`は見た目の値だけを書き換える処理でした。既存の個別設定値・保存済presetフィールド・関数は残し、読込時に勝手に別の見た目を適用しません。
- LIVE PREVIEWは編集対象の標準形状・方向に連動。設定の入力テストも編集対象のキーを使います。Input Overlayはプレイ側からPlay Styleを受け取り、有効な両セットのキー名を表示します。
- 重複・未識別・予約キーはキャプチャ段階で拒否し、仮入力は保存しません。Escapeでキャプチャを中止し、dialogや入力テストにそのイベントを流しません。blur/非表示でも待機を解除します。
- 選択状態は`aria-pressed`、下線・太字・枠で表現。切替は44px高。低い横画面でもmain/sidebarをスクロール可能にし、フッターとの重なりを解消。左右と下のSafe Areaを考慮しました。

## データ構造とmigration

同じ保存キー `pulse-lane:game-settings` のversionを3→4へ更新。端末補正の `pulse-lane:device-settings:v2` は維持します。DB migrationはありません。

```ts
{
  version: 4,
  maniaKeybinds: ["KeyD", "KeyF", "KeyJ", "KeyK"],
  fnfKeybinds: {
    primary: ["KeyA", "KeyS", "KeyW", "KeyD"],
    secondary: ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"]
  }
}
```

上は新規初期値。既存の`keyBindings`はmaniaとFNF primaryへそれぞれ新しい配列でコピーし、`altKeyBindings`はFNF secondaryへコピーします。旧サブの空文字（未割当）も保持。v4の独立設定を優先するため、繰り返しsanitizeしても結果は変わりません。初回hydrateでは既存どおり書き込まず、次の自動保存でv4を永続化します。

既存の有効なキーを先に確保してから欠損を補います。後方のカスタムキーを前方のデフォルト復元で奪いません。異なるレーンへの同一キーを修復し、サブの復元候補が別レーンと衝突する場合は未割当にします。壊れたJSON、undefined、不正な値は既存storeの安全な読込とsanitizeで扱います。保存例外は`saveError`として画面に通知します。

同一レーンのprimary/secondaryに同じ物理キーを設定することは許可しました。キー→レーンが一意であるため曖昧さがなく、既存設定を余計に失いません。解決時にSetで重複を除き、物理source IDも同じになるため、二重のpressは発生しません。異なるレーン間はUIとsanitizeの両方で拒否・修復します。

## 入力・判定・Retry

`KeyboardEvent.code → resolveKeyMap(settings, playStyle) → useRhythmGameのkeyToLane → InputLedgerの物理source → ReplayRecorder → GameplayCore` の経路です。maniaではmaniaの4キーのみ。FNFではprimary/secondaryを4論理レーンへ統合します。

InputLedgerの`key:code`ごとの押下管理、repeat無視、sourceによるkeyupを維持します。片方を離しても別キー/指が押されていればレーンとHoldを維持。blur、visibility、pause、retry、終了、unmountで既存の解放処理が働きます。TouchInputはKeyboard設定を参照せず、pointer IDごとに独立して同じ論理レーンへ接続します。Overlayは同じledgerを購読し、得点には介入しません。

RunConfigurationは開始前にPlay Style・Visual Mode・Judgement Policy・補正を固定する既存方式です。キー設定は得点の解釈を変えず、Replayは論理レーンと物理sourceのイベントを記録するためRunConfigurationの形式は変更不要です。Settingsは待機/一時停止/結果画面で編集でき、更新後の次入力とRetryは対応するスタイルの保存キーを読みます。保持中のkeyupは割当変更前のsourceでも解放できます。

CLASSICはPlay StyleではなくVisual Mode/mania skinです。`playStyle === "mania"`ならCLASSICでもmaniaキー。既存どおり明示的にFNF styleへCLASSIC visualを渡した場合も、キーと判定はstyleに従います。FNFの早押し無MISS、maniaの早押しMISS、Hold判定幅、得点係数、音声時刻は変更していません。

## 変更ファイル

| ファイル                                                           | 変更                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| src/game/settings.ts                                               | v4構造、migration、物理キー検査、共通解決                       |
| src/components/game/SettingsPanel.tsx                              | 編集対象切替、1/2セット、重複検査、preview、Safe Area/scroll    |
| src/components/game/GameScreen.tsx                                 | style別解決をhook・表示へ接続                                   |
| src/components/game/InputOverlay.tsx                               | style別の表示と入力テスト                                       |
| tests/style-keybinds.test.tsx                                      | migration、保存、UI、複数source/Hold、blur/非表示、Retry        |
| tests/fnf-gameplay-integration.test.tsx                            | style別キーfixture、Settings→ゲーム→Replay/Retry、maniaサブ無効 |
| tests/game-settings-engine.test.ts / tests/style-selector.test.tsx | v4移行・既存設定保持の期待値                                    |
| docs/verification/style-keybinds-2026-10-18.md                     | 本記録                                                          |

## 検証結果

- `npm test`: **19ファイル、224件成功**（追加10件）。主/サブ/混在の4レーン入力、同一レーンの2キー、得点・Combo・Accuracy二重加算なし、Hold所有権、repeat、keyup、blur/visibility、Retry、Touch4点、Overlay、migrationと再hydrateを検証しました。
- 同一依存環境の変更前main: 214件中46件失敗、168件成功。失敗はLovableの主キー除外に関連するGameScreen keyboard統合経路。変更後は全件成功です。
- `npm run typecheck`: **既存103件で失敗**。変更前mainと出力が完全一致し、追加エラーなし。生成型から失われた既存schema定義が原因です。今回の新規テスト単独のstrict TypeScriptチェックは成功。
- `npm run lint`: **既存329 errors / 7 warningsで失敗**。変更前は330 errors / 7 warnings。変更TS/TSX 8ファイルのeslintは0 errors / 0 warnings。
- `npm run build`: **production build成功**。deployはしていません。
- `git diff --check`: 成功。
- Chromium実ブラウザ: 360×780、390×844、667×375、844×390、1440×900で設定編集・保存・再読み込み・両スタイル独立性・2キー同時保持と片側解放・CDPの4点同時Touch・横はみ出しなし・mainとfooterの非重複を確認。実コンポーネントを使ったローカル検証用harnessであり、本番サイトや実iPhoneの検証ではありません。

既存スイートには楽曲選択からのSTART（選曲/Home/My Tracks）、Play Style、FNF/mania/CLASSIC、touch/pointer capture、Hold、Pause、Retry、Resultと保存キュー、ランキング/TOTAL SCORE、XP/Level・server verifier・DBロジック、Song Preview/audio/timingの検証が含まれます。これらの本番API/実認証/実ネットワーク運用まで確認したという意味ではありません。

## Song Settings PR #8との統合

別worktreeにPR #8をcheckoutし、今回のpatchを適用しました。衝突はGameScreenのkeyMapと既存統合テストのキーfixtureです。keyMapを`resolveKeyMap(settings, playStyle)`へ統一し、背景などPR #8の追加を保持する形で一時的に解決しました。

PR #8には「maniaで旧サブArrowLeftも有効」という旧仕様のテストがあるため、今回の仕様では「maniaでArrowLeftは無効、主キーは有効」と期待値を更新する必要があります。これはテスト無効化ではなく、依頼されたスタイル分離の確認です。PR #8のbranch自体にはcommit/pushしていません。

仮統合後は`npm test`で269件成功・7件skip（実Storage/PostgRESTサービス用の接続情報がないため既存の条件付きテストがskip）、アプリの`npm run typecheck`、`npm run typecheck:song-settings-tests`、production buildが成功しました。テストを無効化する変更は加えていません。PR #8固有のcodec依存を検証環境へ追加して実行しています。

## 未完了・本番反映前の確認

1. **main全体の型チェックとlintを全件greenにすることは未完了。** 原因を変更前との比較で特定済みです。既存schema復元はPR #8にあり、今回は重複するschema修正を混ぜていません。公開前にPR #8または同等のschema復元を統合し、型チェックを再実行してください。lint残件も既存差分です。
2. **実iPhone/Safariと実キーボード配列・IMEの確認は未実施。** 実機へアクセスできないため、Chromiumのサイズ/Pointer検証までです。Safe Area、縦横切替、サスペンド復帰、タッチ4本とKeyboard併用を実機で確認してください。
3. **本番サイトでの実認証・Score/XP保存・楽曲配信確認は未実施。** ローカルの既存回帰/統合スイートは成功しています。本番deployは依頼のGitHubルールに従って実施していません。今回固有のDB migration・Storage操作・feature flag変更は不要です。
4. PR #8の先後に関わらず、上記競合解決とテスト期待値の更新を行い、統合後のtests/typecheck/buildを実行してください。

これらを完了扱いにはせず、PRはDraftとして提出します。
