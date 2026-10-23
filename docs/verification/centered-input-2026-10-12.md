# プレイヤーレーン中央固定・入力可視化・FNF早押しの検証

2026-10-12、最新 `origin/main` の `f90882a` を基準に差分修正した。
ルートの AGENTS.md、既存レーン・InputLedger・設定保存・判定処理を確認済み。
公開済み履歴の書き換えは行わない。

## 修正した内容とファイル

- `GameScreen.tsx` / `FnfField.tsx` / `styles.css`：入力可視化の予約領域と
  FNF用の連動マージンを削除し、プレイヤーの横中心をゲーム領域の中央に固定。
  選択した左右の譜面メタデータ、選択側だけの採点、上下スクロール、判定位置を維持。
  共通描画のノーツに CSS と inline transform の中央寄せが二重に適用される
  既存不具合も修正。360px幅では判定枠との23pxのずれが解消した。
- `InputOverlay.tsx` / `inputOverlayLayout.ts`：独立した absolute / click-through
  表示レイヤー。画面外補正と必要時の縮小は表示時だけ行い、保存値は維持。
  キー・タッチの履歴、実際の操作用TouchInputは引き続き別の機能。
- `SettingsPanel.tsx` / `settings.ts`：入力可視化の表示、横・縦位置、倍率、
  キー幅・高さ・間隔、履歴高さ、不透明度、履歴時間にスライダーと数値入力。
  単位・中心基準、配置プレビュー、中央に戻す、入力可視化だけの初期化を追加。
  同じlocalStorageキーで一般設定をversion 3へ移行し、旧left/rightも復元。
  音声補正のdevice設定version 2は維持。DB migrationは追加・適用していない。
- `engine.ts` / `useRhythmGame.ts`：FNFだけ未来側の候補をGOOD受付幅までに限定。
  その前の入力を記録・表示し、判定やノーツ消費は行わない。予約入力は追加しない。
  同じレーンの受付内ノーツ、押し逃しMISS、正常な長押し・解除・キャンセルは維持。
  maniaの早押しMISS、判定幅の定数、スコア計算は維持。
  実際のスタイルを明示的に渡し、スキンやスクロールから判定仕様を推測しない。
  `modes.ts`の説明もスタイル別仕様に合わせて更新。
- `tests/input-overlay-settings.test.tsx` / `tests/style-input-policy.test.tsx`：
  17件の回帰テスト追加。既存設定テストのversion期待値を更新。

## 自動検証

| 実行 | 結果 |
| --- | --- |
| `npm run test` | 10ファイル・85件成功（変更前68件） |
| `npm run typecheck` | 成功 |
| `npm run build` | client / SSR / Nitro本番ビルド成功 |
| 変更したTS / TSXのESLint | エラー・警告なし |
| `git diff --check` | 成功 |
| `npm run lint` | 359エラー・7警告。最新main単独の検査と指摘内容・位置が同一、追加0件 |

全体lintは既存Prettier 358件、prefer-const 1件、react-refresh警告7件。
関係のないファイルは整形していない。ビルドには既存の大きいchunk、
inputValidator非推奨、Vite設定、NitroのinlineDynamicImports警告が残る。
mainが指定するLovable Vite設定2.25.3のlock記載integrityを照合して検証した。

回帰テストでは、FNF早押しの全プレイ状態不変・MISS音なし・表示あり・同じノーツの
再入力成功、早いまま保持しても自動成功しないこと、押し逃し、同レーン候補選択、
mania早押しMISS、両入力種別の4同時押し・連打・長押し、スタイル切替を確認した。
設定は旧version移行、不正値補正、端・大サイズ・safe-area計算、保存復元、
ゲーム／音声／タッチ設定を変えない初期化、実際の設定コンポーネントを検査した。

## ブラウザで実際に確認した範囲

ローカルChromium 151 / Playwright。実際のGameScreen、SettingsPanel、AudioClock、
InputLedger、TouchInputを使い、無音6秒・11ノーツの合成譜面で操作した。
譜面読込と音声時計は実装を使用。ログイン・本番DB保存・公開サイトの検証ではない。

| 対象 | 確認結果 |
| --- | --- |
| 360×780、844×390、1440×900 CSS px | 共通mania / 共通FNF / FNF左選択 / FNF右選択で横中央 |
| 位置0/0・100/100・25.5/66.6%、倍率30/200/115% | キー寸法・間隔・履歴高さも変え、計36通りでレーン・判定枠・ノーツの横位置不変 |
| ノーツ中心と判定枠中心 | 全レーンで一致。共通描画の二重translate修正後に再測定 |
| 表示OFF、中央に戻す、初期化 | レーン・判定位置不変、設定操作成功 |
| 数値入力、スライダーのHome/End | 相互反映。小数位置の再読み込み復元成功 |
| リロードなしの縦／横／PCへのサイズ変更 | 保存位置を維持し、表示が領域内へ補正される |
| FNF左・下スクロール／右・上スクロール | 早押し無罰、入力表示、同じノーツへの正常入力、保持による予約なし、押し逃しMISS |
| FNFとmania、上下スクロール | 4キー同時押し、CDPの4点タッチ、続く入力、長押しと別レーン操作、RESULT到達 |
| mania早押し、FNF⇔maniaのModePicker切替 | mania早押しMISSを維持、切替先の規則を適用 |
| ブラウザ例外 | 確認したシナリオで0件 |

FNFの11ノーツ中10個を入力、最後の1個は故意に押し逃し。左右ともMISS 1、
MAX COMBO 10。自動操作の遅延により左側にはGREATも含まれる。
mania追加シナリオの初回は自動操作でMISS 5となり、入力結果を記録した
2回目では上下とも10入力を受け付け、故意の押し逃し1件だけがMISSになった。
判定幅や入力処理を変更してテストを通したものではない。
CDPのタッチはブラウザ上の複数Pointer入力であり、実機iPhoneの代わりとは扱わない。

## スクリーンショット

| 画面 | 縦360×780 | 横844×390 | PC1440×900 |
| --- | --- | --- | --- |
| FNF中央配置 | [縦](screenshots/centered-fnf-360x780.png) | [横](screenshots/centered-fnf-844x390.png) | [PC](screenshots/centered-fnf-1440x900.png) |
| 入力可視化設定・プレビュー | [縦](screenshots/input-settings-360x780.png) | [横](screenshots/input-settings-844x390.png) | [PC](screenshots/input-settings-1440x900.png) |

- [FNF左／下スクロールの入力](screenshots/fnf-active-left-down-360.png)
- [FNF右／上スクロールの入力](screenshots/fnf-active-right-up-360.png)
- [FNF左RESULT](screenshots/fnf-input-result-left-down-360.png)
- [FNF右RESULT](screenshots/fnf-input-result-right-up-360.png)
- [mania早押しMISS](screenshots/mania-early-miss-360.png)
- [mania下スクロールの4点入力・長押しRESULT](screenshots/mania-chord-hold-down-360.png)
- [mania上スクロールの4点入力・長押しRESULT](screenshots/mania-chord-hold-up-360.png)

## 参考・未確認事項

[公式PlayState.hx](https://github.com/FunkinCrew/Funkin/blob/main/source/funkin/play/PlayState.hx)
を2026-10-12に取得し、processInputQueue / getNotesMayHit / FEATURE_GHOST_TAPPING /
ghostNoteMiss / 入力解除処理を確認した。公式側はfeature条件で無対象入力への
挙動が変わるため、Pulse Laneでは依頼の具体的な受け入れ条件を優先した。

- 実機iPhone／Safari、実機のnotch・home indicator・ブラウザバー伸縮は未確認。
  上記3画面幅とsafe-areaの計算テストは代替確認であり実機確認ではない。
- 公開サイトでの配信後確認、本番認証・DB保存は今回実施していない。
  公開への反映にはPRのマージとLovable側の公開、実機での確認が必要。
- 別の未マージPR #4のreplay検証は、このスタイル別早押し仕様へ追従させてから
  統合・XP有効化する必要がある。今回の最新mainにはその検証バックエンドがなく、
  このPRで別機能の未マージコードは取り込んでいない。
