# FNF実プレイ判定の調査とキャリブレーション修正

調査日: 2026-10-15 JST。最新main確認済み: `e2988ba0a5a480521b7dbfbcc7204ade2c14ffd8`。

## 結論と範囲

**設定画面のキャリブレーションが逆符号のoffsetを保存する不具合を、実GameScreen経路とChromiumで再現して修正した。ユーザーの公開環境で起きた現象と同一原因かは未確認。** offset=0の最新mainでは、FNFの早すぎる入力がMISSになる現象は再現しなかった。判定windowやFNF候補除外を再実装していない。

入力時刻には `timingOffsetMs / 1000` を加算してから判定する。一方、キャリブレーションは `tapTime - nearestBeatTime` の平均をそのまま保存していた。例えば+200msの遅れに+200msを保存すると、遅れを補正せず加算してしまう。設定説明も「プラスにすると、より遅い入力が譜面時刻に合います」と逆方向を案内していた。

修正は推奨値を平均誤差の負値にし、説明を実際の加算規則へ合わせるだけ。manual offset、保存済みdevice settings、mania/CLASSICの採点、AudioClock、GameplayCore、judgementPolicy、窓幅は変更しない。既存の値が旧校正由来か手動設定由来かを識別できないため自動反転しない。以前に校正した端末ではリセットまたは再校正が必要。

## 再現と修正確認

### 失敗する統合テストを先に確認

実SettingsPanelで500msごとの基準から200ms遅れて8回タップし「採用」→閉じる→FNF選択→START。

noteTime=1秒、入力songTime=0.95秒の場合:

| 状態       | 保存offset | 補正後delta | HUD結果                          |
| ---------- | ---------- | ----------- | -------------------------------- |
| 修正前main | +200ms     | +150ms      | MISS 1、note消費                 |
| 修正後     | −200ms     | −250ms      | MISS 0、note未消費、hold開始なし |

修正前はKeyboard/Touch両方のテストが `expected 1 to be 0` で失敗。修正後は成功。その後releaseして1.2秒にpressすると補正後delta=0、PERFECT。単に押し続けた場合の自動hitはない。

これは「補正前−150msが常にMISSになる」という再現ではない。実際に比較すべき値は補正前時刻、保存offset、補正後deltaの3つ。別の診断テストで、手動+300msなら補正前−150msが補正後+150msの正当なlate MISSになることも確認した。保存済み+300msをこの変更で強制的に無効化しない。

### 実Chromium / Web Audio

元mainを別worktreeでそのまま起動（8081）、修正側を8080で起動。local Pulse Testを使用し、公開曲一覧は空配列fixture。FNF renderer確認用にテスト実行時だけ両側metadataを付与したfixtureも使用。認証・本番曲の検証ではない。

ブラウザ実AudioContext、`page.keyboard`とCDP `Input.dispatchTouchEvent`によるイベント、実TouchInput/AudioClock/GameplayCoreを使用。テスト実行中だけブラウザ内でprocess/nowAtを観測し、製品コードへのログやデバッグ用入力収集は追加していない。

| ケース              | offset | 補正前delta | 補正後delta / 結果                  |
| ------------------- | ------ | ----------- | ----------------------------------- |
| 修正前校正→Keyboard | +200   | −42.108ms   | +157.892ms / MISS 1                 |
| 修正前校正→Touch    | +200   | −48.801ms   | +151.199ms / MISS 1                 |
| 修正後校正→Keyboard | −200   | −50.216ms   | −250.216ms / outside-window、MISS 0 |
| 修正後校正→Touch    | −200   | −45.898ms   | −245.898ms / outside-window、MISS 0 |

修正後は両方ともrelease後の再入力がPERFECT。offset=0でも4K/両側FNF × Keyboard/Touchの4ケースを実行し、約160〜170msの早押しは未消費・MISS 0、次の適時入力はPERFECTだった。

## 経路と調査11項目

1. **Style Selector→START**: 実SongDetailのModePickerを操作し、MANIA→FNFとFNF→MANIAを確認。最後の明示選択がSTARTまで維持される。
2. **各入口**: 実RhythmHubの選曲、Home曲カード、MY TRACKS PLAY→詳細→autoStartを、両形式・両入力で通した。結果画面RETRYも新core/new run IDで同じFNF policyを保持。
3. **設定の優先順位**: recommended/lastがmaniaの状態で明示FNFが勝つ。modeId/visualModeをplayStyleと意図的に食い違わせてもpolicyはplayStyleから決まる。CLASSIC+maniaは早押しMISSを維持。
4. **FNF/4K**: 通常4Kと、実parseChartByTypeを通したFNF JSONを使用。選択right側だけを採点し、scoringSideはright/shared、policyは同じpulse-fnf-v1。
5. **Keyboard/Touch**: window keydown/upとTouchInputのpointerdown/up/cancelを使用。同じeventTime→dispatch→recorder→core経路。単なるcoreへのsongTime直渡しではない。
6. **時刻変換**: AudioClockとinputTimeは実物。プラットフォームAudioContextとperformance時刻を制御し、異なるepoch、300ms遅延dispatch、WebKit型epoch timestampも検査。offset=0でearlyがlateへ反転する変換は見つからなかった。反転の再現は上記校正値による。
7. **rAF/press順序**: advanceは独立イベント。既に+201msでadvanceした後に古い−150msのedgeが届いても、press自体はMISSを追加しない。このとき残るMISSは通過によるもの。
8. **重複MISS**: 未入力+201msで1noteにつき1MISS、その後advance/release/cancelで追加されない。
9. **Pointer経路**: surfaceとwindowへのpointerup/cancel重複、release後の再press、4指同時を確認。物理iPhone/Safariは未実施。
10. **React lifecycle/RETRY**: 実GameScreenのautoStart、結果→RETRY、新coreとnew run ID、ReplayRecorderのconfigurationとcoreのconfigurationの同一性を確認。通常のSTART後は必ずplayStyle=fnf/policy=pulse-fnf-v1。StrictMode固有の再mountは今回追加テストでは未実施。
11. **公開版**: READMEの `https://rhythm-tap-joy.lovable.app` は環境のproxyからCONNECT 403。GitHub main SHAは確認したが、同SHAのActions runs/statusesは0件で、Lovableのdeploy commitを裏付ける情報は得られなかった。公開版が古いとは断定しない。

## 追加テスト

`tests/fnf-gameplay-integration.test.tsx` に100件。UI/入力/時刻変換を実物とし、DB/保存API・認証・物理AudioContextだけをfixtureへ置換する。音声clock本体、hook、dispatcher、recorder、coreは置換せず、spyは元実装へ委譲する。

- −500/−250/−201/−199/−150/−141/−140/−139/0/+140/+141/+199ms。全4レーン同時、2形式×2入力。
- −140/−139/+140はGOOD、0はPERFECT、+141/+199はMISS。それ以前は無罰。未入力+201はMISS。
- releaseして再入力、押し続けても自動hitしない、earlyでhold開始なし、既存score/combo/accuracy保持。
- Home/選曲/MY TRACKS、RETRY、相反するvisual mode、CLASSIC、style切替。
- raw/epoch DOM timestamps、callback遅延、rAFとの順序、正負ゼロ校正の採用・device保存・START snapshot。

## コマンドと結果

- baseline `npm test`: 17 files / 114 tests成功。
- 修正前 `vitest run tests/fnf-gameplay-integration.test.tsx -t 'calibration adopted'`: Keyboard/Touch 2件がMISS増加で失敗。`-t`による他ケース除外のみで、テストのskip化はしていない。
- 修正後 `npm test`: 18 files / 214 tests成功。
- `npm run typecheck`: 成功。
- `npm run build`: Vite client / Nitro Cloudflare worker成功。依存は既存環境を利用（前回記録のLovable config 2.25.2、要求2.25.3のfrozen再構築ではない）。
- `eslint src/components/game/SettingsPanel.tsx tests/fnf-gameplay-integration.test.tsx`: 0 errors / 0 warnings。
- `git diff --check`: 成功。

ログ・実ブラウザ観測は作業用 `work/fnf-investigation/`。この変更の対象はSettingsPanel、追加統合テスト、本報告の3ファイル。

## 未確認・残る切り分け

ユーザーの実URL/曲/端末/ブラウザ/保存offset・visual offset、公開deploy SHA、物理iPhone/Safari、実際の問題曲での密なノーツ・前ノーツのlate判定は未確認。ノーツの「見た目上の早さ」と校正後deltaは同じとは限らない。既存校正値を0にリセットしても同じ問題が起きる場合、この符号修正だけで直ったと扱わず、その条件で再現を続ける必要がある。
