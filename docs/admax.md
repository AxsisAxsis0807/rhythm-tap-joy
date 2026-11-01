# Pulse Lane / 忍者AdMax 非同期バナー

更新: 2026-11-01。実装・模擬検証の記録。実配信の修復や収益化完了を意味しない。

## 対象と設定

- 公開先: https://rhythm-tap-joy.lovable.app/
- 管理枠番号: `1237257` / `PulseLane_SP_320x50`。タグIDとは別。
- 発行タグID: `cb996f4b2cbc2c0b8adc2c12ad721c8f`、`class="admax-ads"`、`data-admax-id`、`display:inline-block`。
- キュー: `window.admaxads` に `{ admax_id: "cb996f4b2cbc2c0b8adc2c12ad721c8f", type: "banner" }` をpush。
- SDK: `https://adm.shinobi.jp/st/t.js`、`type="text/javascript"`、`charset="utf-8"`、async。
- SP 320×50原寸。自動リサイズ・オーバーレイOFF、アダルト・出会い等非表示ON、登録URLは上記HTTPS、ジャンルはゲーム（ユーザー提供情報）。管理設定は変更していない。PC枠やswitchタグは追加していない。

## 調査と確定していないこと

GitHub APIで確認したmainは `ff30d55fc81a2eaa3e57921726627dd3adf2e31c`。作業開始時のローカルHEADと一致し、未コミット変更なし。AGENTS.mdも照合した。進行中のPR #4（XP）・#8（Song Settings）へ変更を加えていない。Git CLIのfetchはproxy接続失敗のため、最新refは接続済みGitHubツールで確認した。

- [公式タグ設置FAQ](https://www.ninja.co.jp/admax/help/faq/4281/): 管理画面「タグ・SDK確認」のタグを設置する案内。
- [公式・広告が表示されない](https://www.ninja.co.jp/admax/help/faq/10325/): タグ、SP/PC、JavaScriptやブロッカーの確認を案内。
- [公式・審査中](https://www.ninja.co.jp/admax/help/faq/9448/): 初回の**広告表示**から3日以上の場合にURL・タグ・貼付検出を確認する案内。設置からの経過時間やscript loadだけで掲載確認済みとは判断しない。
- [公式スマホインライン枠](https://www.ninja.co.jp/admax/help/manual/10494/): スマホ用タグはスマホだけで表示される。PCの空欄だけでは障害と断定できない。
- [MDN iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe): 旧srcDoc/sandboxではorigin等の制限がある。これが今回の不表示・掲載未確認の原因だったかは未確定。
- [参考SPAサンプル](https://github.com/ninjatools/admax-spa-examples): README自身が非公式・動作保証なしと明示。公式なSPAサポート仕様として扱わず、switch形式や非公開グローバルのリセットを転用していない。

調査した公式ヘルプにはSPAでの再初期化・破棄APIの保証を確認できなかった。実SDK URLのWeb取得は取得不可であり、クラウドの許可先にもSDK・公開Lovableホストはない。ネットワーク制限を迂回せず、実広告への反復要求は行っていない。

## 現在の実装

`src/lib/admax.ts` がSDKとDocument単位の広告セッションを管理する。`AdMaxBanner.tsx` はResizeObserverによる幅確認と配置・解除を担当する。既存RhythmHubのホーム・ログイン済みプロフィールの配置だけを使用し、選曲・詳細・編集・プレイ・結果への配置やゲーム実装は変更しない。ホームはログイン不要（既存の認証初期読込完了後）。

1. SSRでは広告DOM/scriptを出さず、ブラウザーでコンテナ幅320px以上を確認して広告DOMを設置する。未対応ブラウザーや幅不足なら読込しない。縮小・拡大・切抜きのCSSは加えない。
2. microtaskで破棄済みEffectを除外し、SDKはDocumentにつき1回だけロードする。通常タグのsrcDocとアプリ独自の外側iframeは廃止した。
3. SDKのload後、現に接続されている対象広告DOMに対して上記bannerキューを1回だけpushする。loadは広告表示成功の判定ではない。load中の離脱・幅不足ではpushしない。復帰時に未登録なら現行DOMに対してpushする。
4. 画面を離れると広告サブツリーをDocumentから外す。対象外画面に広告DOMを残さない。ホーム・プロフィールへの再訪や幅復帰では同じサブツリーを戻し、登録済みなら再pushしない。SDKが作成したiframeの属性・内容をアプリから書き換えない。同IDの同時所有は1枠に制限する。
5. 通常再レンダー・プロフィール入力・StrictMode・幅が足りる範囲のリサイズでは再登録しない。SDK失敗・同期例外でも画面表示や操作を待たせず、自動リトライ・更新タイマーはない。

### 信頼境界と互換性の制約（マージ前に確認が必要）

**第三者SDKが親ページの権限で実行される方式へ変わる。** 旧sandboxの隔離はなく、親DOM・ページで利用可能な情報へのアクセスを信頼する必要がある。CSPやサイト全体のセキュリティ設定は緩めていない。

提示タグはSDK読込前のpushだが、この実装は離脱後のキュー処理を避けるため**load後のpush**にしている。`window.admaxads.push` という提示済みのインターフェースだけを使うが、実SDKが空キューで起動した後のpushを処理することは未確認。もしキューを一度しか処理しなければ、この方式は動作しない。模擬SDKは継続的なpush処理をモデル化しており、この仕様そのものの証拠にはならない。

保持DOMの再接続で実広告が正しく表示・計測されるかも未確認。iframeの移動ではブラウザーが子文書を再ロードする可能性があり、同じDOMであることは広告文書の実行状態保持や広告ネットワーク要求1回を保証しない。SDKが親ページへ設置したタイマー・リスナー・後続処理の停止も保証できない。正式な破棄APIを推測して呼び出してはいない。

したがって「SDKを一度読めば再訪も確実」「広告が直った」とは扱わない。実SDKの初回・遅延離脱後の復帰・通常再訪の確認、または提供元による公開キューの説明が得られるまでDraft/マージ判断保留とする。根拠のない再注入やグローバル削除で隠さない。

## 検証状態

| 項目                    | 状態                           |
| ----------------------- | ------------------------------ |
| 非同期タグ方式のコード  | 実装済み（上記互換性制約あり） |
| 模擬SDKによる制御・配置 | 検証結果は以下に記録           |
| 実広告表示              | 未確認                         |
| 実iPhone Safari         | 未確認                         |
| AdMax側の掲載確認・審査 | 未確認                         |
| 表示回数・収益等の計測  | 未確認                         |

自動テストは模擬SDKのみ。旧方式の過去の検証は[当時の文書](https://github.com/AxsisAxsis0807/rhythm-tap-joy/blob/ff30d55fc81a2eaa3e57921726627dd3adf2e31c/docs/admax.md)と `docs/verification/admax-320x50-2026-10-28.json`、`admax-layout-2026-10-28.json` に残る。これらの隔離・srcDocに関する成功は新方式の結果ではない。

2026-11-01の結果:

- `npm run typecheck`、`npm run build`: 成功。既存の非推奨API・chunk-size等のビルド警告は残る。
- 広告単体テスト: 12件成功（SSR、初回DOM/タグ、StrictMode・再レンダー、保持DOMによる再訪、SDK待機中の離脱と復帰、同ID同時所有の抑止、幅不足、通信失敗、push例外、ResizeObserver未対応・無効化）。
- `npm test` 初回: 262成功/1失敗（`style-keybinds.test.tsx:224` のFNF PERFECT期待値）。変更後の単独7件、未変更mainの単独7件はともに成功。原因は未確定で、既存不具合と断定せず記録する。並列数を抑えた全体再実行 `npm test -- --maxWorkers=2`: **23ファイル/263件すべて成功**。ゲームや該当テストを変更して通したものではない。
- 変更TS/TSX/CJSのESLint: 0エラー/0警告。全体 `npm run lint`: 156エラー/7警告。未変更mainは156エラー/8警告。今回の変更で広告のexport警告1件が解消、残る指摘は今回の範囲外。
- Chromium模擬SDK: **32条件成功**。[実測JSON](verification/admax-async-2026-11-01.json)。319/320/390/844/1280px幅×成功/接続遮断/503×ホーム/プロフィールの30条件と、ゲストホーム、SDK遅延中離脱・復帰。選曲画面での非残存・検索操作、ホーム/プロフィール再訪、プロフィール入力、横はみ出しなし・末尾スクロールで固定ナビより上に320×50枠全体が収まることを確認。模擬成功時はSDK取得・キューpushが各1回（再訪で増加なし）。ゲームプレイ全体・実プロフィール保存・実認証・実広告計測のE2E合格ではない。
- `git diff --check`: 成功。

ブラウザーの認証・プロフィール・曲レスポンスはfixtureに置換した。実広告は取得もクリックもしていない。実iPhone Safariや実SDKの互換性を確認したという意味ではない。

再現: `npm run typecheck`、`npm run build`、`npm test -- --maxWorkers=2`。広告関連は `npx vitest run tests/admax-banner.test.tsx`。ブラウザー検証はPlaywright・Chromiumを用意し、`npm run dev -- --host 127.0.0.1 --port 5180` と別ターミナルで `node scripts/verify-admax.cjs`。模擬SDKに5191ポートを使用し、ソース内の正確なSDK URLをローカルへ置換したことをassertし、実AdMaxホストも遮断する。デフォルトの結果は `work/admax/browser-results.json`。

## マージ後のLovable公開（今回は実行しない）

1. 上記互換性制約・未確認事項とPRの最新チェックをレビューし、運営者がマージ可否を判断する。AGENTS.mdに従い公開済み履歴を書き換えない。
2. マージ後、Lovableの接続リポジトリ・同期ブランチを確認し、該当コミットがエディターに同期されたことを確認する。GitHub反映と本番公開は別操作。
3. Lovable右上のPublishから既存URL・公開範囲・チェック結果を確認し、Publish changesを実行する。[公式公開手順](https://docs.lovable.dev/features/publish)。この作業では公開・DB変更・広告設定変更は行わない。

## iPhoneでの最小限の確認

公開を判断して反映した後、実iPhone SafariでJavaScript有効・当該サイトの広告ブロッカー無効を確認し、公開HTTPSホームを一度開く（ログイン不要）。縦向きで広告位置までスクロールし、320×50の内容・横はみ出し・固定ナビとの重なりを確認する。広告はクリックしない。

通常の操作でホーム→選曲→ホーム、ログインする場合はプロフィール→ホームを一度ずつ確認する。対象外画面に広告が残らず、戻ったときに実広告が表示されるか、ゲーム・入力・保存が利用できるかを記録する。読み込み中離脱の試験が必要なら追加の反復読込ではなく、提供元の仕様確認・許可されたプレビューでの最小限の確認を優先する。

日時・実端末/iOS・URL・表示内容・エラーを記録し、AdMax管理画面で掲載状態とレポート反映を別々に確認する。scriptの200/load、SDK iframeの生成、スマホエミュレーションだけを実広告・実iPhone・掲載・計測の確認済みとは扱わない。自動更新や表示回数を作る反復アクセスは行わない。
