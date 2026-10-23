# PR #5 最新 main 統合記録

2026-10-24 JST。基準 main: `32e239d0488d938c4319e3330ee83ff37a2b8a37`。
元の PR head: `b51aefc24136e053b8de1d5e97072eb18f5c05d7`。
公開履歴を書き換えず main を merge。main 自体への push/merge、DB 操作、デプロイは行っていない。

## 比較と競合解消

8ファイルで競合。`engine.ts`、`modes.ts`、`useRhythmGame.ts` は最新 main を保持した。
FNF 早押しを無視する仕様は main の `judgementPolicy` / `GameplayCore` と server replay verifier に既に実装済み。
旧 PR の `inputStyle` / mutable judgement への置換は採用しない。判定幅、epsilon、得点係数、選択側採点、XP/リプレイのコードは main と同一。
プレイ中の設定変更は現在の run を変更せず、次の START で適用する。回帰テストをこの契約へ更新した。

未反映の中央固定 FNF field、独立 click-through overlay、位置/寸法/表示設定、ノーツ二重 translate 修正のみを維持。
キー編集 UI、MANIA 1セット、FNF 主/サブ2セット、共有 hydrated store、試聴設定、端末設定を維持する。
設定 version は3へ戻さず5へ更新。旧 left/right、version4キー設定、preview/device設定の移行と冪等性をテストした。
入力テスト・プレビューにも編集対象スタイルのキー表示を渡す。

main の再生成済み Supabase types から落ちていた既存 `UpgradeTables` / `UpgradeFunctions` と songs metadata の型契約を復元。
これは既存 migration に対応する型修正であり、新規 migration やDB適用を含まない。
この types.ts は修正後 PR #8 と同一で、後続統合時の競合を避ける。

## 今回の検証

- 全体 Vitest: **21 files / 242 tests 成功**。
- 重点3 files: **25 tests 成功**（設定移行、入力表示、スタイル別キーと入力判定）。
- `npm run typecheck`: 成功。
- `npm run build`: 成功。既存の deprecated API / chunk-size 系 warning は残る。
- 修正したコード/テスト11ファイルの ESLint: **0 errors / 0 warnings**。
- 全体 ESLint: **158 errors / 7 warnings**。無関係な既存整形・lint違反は残す。
- 修正後 PR #8 への merge 試験: **競合なし**。両方を含む状態でも287 tests成功、実Storage用7件skip、3 typecheck・本番build成功。
- frozen install: Bun1.3.10、元 lockfile のまま成功。私設registry403は公式npm同一version/integrityの隔離cacheで解消。依存更新なし。

旧 `centered-input-2026-10-12.md` のスクリーンショット・実測は当時の記録であり、今回の再実行結果とは分ける。
今回のブラウザ実測は別途この記録末尾に追記する。

## 残る確認

実 iPhone/Safari、公開環境での smoke は未実施。本番接続を使う保存・アップロード・削除試験は実施しない。
#5 → #8 の順序を推奨する。#8 は独自の本番公開・受入条件が残るため Draft を維持する。
GitHub上の競合解消と、すべての公開条件の成立は別である。自動マージは設定しない。
