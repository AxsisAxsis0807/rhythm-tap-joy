# Rhythm Core Engine

音楽ゲームの基盤となるプロトタイプを制作してください。

このゲームは、スマートフォンでのタッチ操作を第一に考えつつ、外付けキーボードでもプレイできる音楽ゲームを目指しています。

現段階では機能を増やしすぎず、まず「曲を再生して、ノーツを叩いて、判定される」という音楽ゲームの基本部分を完成させてください。

【今回実装する機能】

4レーンの音楽ゲーム画面

画面を4つのレーンに分割する

ノーツは上から下へ移動する

画面下部に判定ラインを配置する

ノーツが判定ラインに到達したタイミングで入力する

タッチ操作

スマートフォンの画面を4つの入力エリアとして使用する

各レーンをタップして対応するノーツを叩けるようにする

同時押しにも対応できる構造にする

キーボード操作

4つのレーンにキーボードのキーを割り当てる

初期設定では D / F / J / K を使用する

後からキーコンフィグを追加できるよう、入力処理は拡張しやすい構造にする

音源再生

音楽ファイルを読み込んで再生できるようにする

音源の再生時間を正確に取得する

音源の再生時間を基準としてノーツを同期させる

BPMやオフセットを後から設定できる構造にする

ノーツデータ
ノーツは最低限、

出現時間

レーン番号

ノーツ種類
を持つデータ構造にする。

最初は通常ノーツだけで構いません。

判定システム
判定ラインとの時間差を計算し、

PERFECT

GREAT

GOOD

MISS
の4段階で判定する。

判定幅は後から変更できるようにする。

コンボ・スコア

正しく叩くとコンボが増える

MISSでコンボをリセットする

判定に応じてスコアを加算する

現在のスコアとコンボを画面上に表示する

譜面テスト用データ
まずは外部の譜面エディターを作らず、簡単なテスト譜面をコードまたはJSONなどのデータとして用意してください。

テスト用の音源に合わせて、実際にノーツが落下して判定できる状態まで完成させてください。

【重要な設計方針】

スマートフォンでの操作を重視する

タッチ入力とキーボード入力を同じ判定システムで処理する

後からiPadにも対応しやすい構造にする

後から譜面エディターを追加できるよう、譜面データとゲーム本体を分離する

後から4K以外のレーン数にも拡張できる構造を意識する

後からロングノーツ、SPAM、階段、トリルなどのパターンを追加できるようにする

音源・譜面・ゲームロジックをできるだけ分離する

現段階ではキャラクター、ストーリー、オンライン機能、ショップなどは実装しない

【最初の完成条件】

音源を再生する
↓
曲に同期してノーツが落ちてくる
↓
タッチまたはキーボードでノーツを叩く
↓
PERFECT / GREAT / GOOD / MISS が表示される
↓
コンボとスコアが計算される

ここまでを最初の完成目標としてください。

まずプロジェクトの構成と使用する技術を決め、その理由を簡潔に説明してから実装してください。

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://rhythm-tap-joy.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c694247d-0274-4e9a-85bb-e21f3c4f00eb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
