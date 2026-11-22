# Pulse Lane Roblox 開発版

4レーンのタッチ・キーボード入力を確認する無音の2D試作です。テスト譜面はこの試作用に作成しています。

## ビルド

Rojo 7.6.1 を [公式リリース](https://github.com/rojo-rbx/rojo/releases/tag/v7.6.1) から入手し、リポジトリ直下で実行します。

```sh
rojo build roblox/default.project.json --output roblox/PulseLane.rbxlx
```

Studio の **Open from File** で生成ファイルを開き、**Play** で確認できます。GitHub Actions の **Pulse Lane Roblox build** でも、成功した実行の Artifacts から同じ形式を取得できます。CI は Luau の構文検査、純粋ロジックの型検査と単体テスト、Rojo ビルド、生成物の構造検査を実行します。

## 開発用Placeの初回公開

公開はオーナー承認後に行います。生成物はPlace全体のファイルなので、対象Placeで保持する必要がある内容がある場合は、公開前に現在のバージョンを確認して控えてください。Experience の公開範囲は Creator Dashboard で管理します。

1. PRとビルド結果を確認します。オーナー承認後にマージし、GitHub の **Settings → Environments** で `roblox-development` を作成します。
2. **Required reviewers** にリポジトリ所有者 `AxsisAxsis0807` だけを設定します。管理者による保護ルールの回避を無効にし、許可するデプロイブランチを `main` に絞ります。オーナー自身が起動する単独運用では **Prevent self-review** をオフにし、実行開始と承認を別操作で行います。
3. 登録済みの Actions Variables が Universe `6296385428` と Place `94836487284054` であることを確認します。Creator Dashboardでキーの権限 `universe-places:write` が開発Experienceだけに付与されていることを確認します。キーは登録済みの `ROBLOX_API_KEY` を使います。
4. Actions の **Pulse Lane Roblox development publish** を `main` で開き、`PUBLISH 94836487284054` を入力して起動します。ビルドしたコミットを確認し、**Review deployments** からオーナーが承認します。
5. Actions の出力と Creator Dashboard の Place バージョンを照合します。公開処理のタイムアウトや失敗時は、適用済みの可能性があるため、再実行の前に Dashboard を確認します。再実行する場合は新規の手動起動と承認が必要です。

ワークフローは [RobloxのPlace Publishing API v1](https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/cloud/universes-api/v1.json) を使用します。固定の Universe/Place に `x-api-key` と `application/xml` で `POST` します。 [必要権限](https://create.roblox.com/docs/cloud/reference/scopes) は `universe-places:write` です。Creator Hub の別の [Assets APIガイド](https://create.roblox.com/docs/cloud/guides/usage-place-publishing) では PATCH と非同期処理を使うため、手順と権限はそれぞれの API に合わせます。リポジトリSecretは書き込み権限を持つ人が別のワークフローで参照できるため、今後の分離強化では承認を得て同名の Environment Secret に移行できます。

## iPhone実機テスト

1. 公開後、対象 Experience にプレイ権限がある Roblox アカウントで iPhone の Roblox アプリにログインします。[開発Place](https://www.roblox.com/games/94836487284054) を起動します。
2. 4レーンと画面内の固定判定線を確認します。縦・横の両方でゲームが提供する向きを確認し、表示可能な向きごとにメニューとレーンに触れられるか確認します。
3. START前に左から順に各レーンをタップし、光る位置と消灯を確認します。4本指で押して `4K PEAK 4/4` になるか確認します。指をレーン外まで滑らせて離し、点灯が残らないことも確認します。
4. **START / RETRY** をタップします。開始約7秒と8.5秒に4レーン同時が出ます。FNFで譜面開始直後の空打ちにMISSが表示されず、maniaでMISSになることを確認します。PCでは D/F/J/K でも同じ確認ができます。
5. プレイ中に Roblox メニューやアプリ切り替えを開いて戻ります。押下表示が解除され、RETRYで譜面を再開できるか確認します。失敗時は端末、向き、タッチ順、`4K PEAK` 値と症状を記録します。

## Web版との差分と将来の連携

Web版は音源同期とモード別スキン・スクロール設定を持ちます。この試作は両モード下スクロール、固定50%判定線、無音の絶対経過時計、試作用の判定幅です。既存のスキン、楽曲、譜面、長押し、スコア保存は対象外です。

入力・表示・譜面判定をモジュール化しています。将来の連携では、アカウント紐付け、譜面配布、プレイセッションと結果検証をサーバー境界に置きます。XP・実績・ランキング等の更新権限は検証側に持たせ、クライアントが記録を直接書き込む経路は設けません。
