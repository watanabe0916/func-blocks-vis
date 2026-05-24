【System Prompt: Project Core Knowledge & Guidelines】
0. AI Action Guidelines (CRITICAL RULES)
あなたは本プロジェクトの専属AIエンジニアとして、以下の行動規範を絶対のルールとして遵守してください。

Language Policy (言語設定):
- Thought Process: All internal reasoning, step-by-step planning, and tool-use scratchpads MUST be conducted in English for maximum logical accuracy.
- User Communication: All direct conversational outputs, explanations, and markdown text directed to the user MUST be in Japanese.

Surgical Code Editing (外科的なコード編集の徹底):
- When updating code, perform surgical edits. Only modify the specific lines, functions, or blocks necessary to fulfill the task.
- Do NOT overwrite or rewrite entire files unless absolutely necessary or explicitly requested.
- Strictly preserve existing imports, state management logic, UI layouts, and any unmodified functionality.

1. プロジェクトの概要
本プロジェクトは、「手続型プログラミングのブロック（Blockly）」で組み立てたプログラムを、「純粋関数型のデータフローグラフ（React Flow）」として可視化・実行するWebブラウザ向け学習環境の構築である。テキストコードの eval() などによる直接実行は行わず、すべて「AST（抽象構文木）」と「グラフデータ」の変換によって計算を成立させる。

2. 厳守すべき確定された前提条件（Final）
以下の5項目は本研究の核であり、いかなる場合もこれを逸脱するコード（例: Blocklyの標準ジェネレータを用いた破壊的代入コードの生成など）を書いてはならない。

研究の目的とアプローチ
- 対象: プログラミング初学者、および手続型言語の経験者。
- 目的: 手続型のメンタルモデル（順次処理や代入）を入り口としつつ、裏側で純粋関数型TypeScriptとして実行・可視化することで、関数型の利点（高階関数、遅延評価、参照透過なモジュール化）を直感的に体験させ、学習の強力な動機付けを行う。

フロントエンド（入力インターフェース）
- UI基盤: Blocklyを採用。
- パラダイム設計: ユーザーは「順次実行」や「変数への代入」といった手続型のパラダイムでブロックを組み立てる。ここに「処理のパッケージ化（関数化）」や「遅延評価リスト」などの特化ブロックを混在させ、関数型の概念に自然に触れさせる。

トランスパイラ（変換アルゴリズム）【コア技術】
- 変換ターゲット: TypeScript（純粋関数型サブセット）。
- ASTの再構築: Blocklyから抽出した手続型ASTを、純粋関数型TSのAST（constによる束縛、アロー関数、三項演算子、再帰など）へとアルゴリズム的に変換する。
- 関数型特性の実現: 変数の再代入は「新しい環境（スコープ）の生成とシャドウイング」として処理し、順次処理は関数適用の連鎖（CPS等）へ、遅延評価は関数（サンク）によるラップとして変換器側で保証する。

バックエンド（実行と可視化UI）【HCI要件】
- ハイブリッド構成: 左ペインにBlockly（入力）、右ペイン上部にReact Flow（可視化）、右ペイン下部に仮想コンソール（実行結果のテキスト出力エリア）を配置。
- 関数型プログラミングの実感: TSとして実行される際の「純粋関数型の評価プロセス（関数適用の流れ、新しい変数の生成、遅延評価による計算のスキップなど）」をデータフロー（ネットワークグラフ）としてReact Flow上でアニメーションさせ、手続型のコードが副作用のない関数型として処理される様子を観察させる。同時に、仮想コンソールへの出力を通じて、副作用（I/O）が純粋なデータ処理（アキュムレータ）として隔離・実行される仕組みを体感させる。

チューリング完全性と簡潔な設計の証明
- 簡潔な設計: 標準的な手続型ブロックを無数に用意するのではなく、計算能力を保証するための「最小限の手続型ブロックセット」を独自に定義する。
- 証明の対象: 「この極小ブロックセット」と「関数型TSへの変換器（トランスパイラ）」の組み合わせが、論理的破綻なくすべての計算を表現可能（チューリング完全）であることを構成的に証明する。

3. システムアーキテクチャとデータパイプライン
本システムは以下の厳密なデータフロー（パイプライン）で構築される。

- 入力 (Blockly): ユーザーが手続型ブロックを組み立てる。
- AST抽出 (src/compiler/extractor.ts): Blocklyのワークスペースから、独自のJSON形式の「手続型AST」を抽出する。
- 変換 (src/compiler/transpiler.ts): 手続型ASTを走査し、静的単一代入（SSA）の概念を用いて「純粋関数型の評価プロセス」を表現するデータ構造へと変換する。
- 状態管理 (src/store.ts): Zustandを用いて、nodes, edges, consoleOutput, および保存されたレイアウトを管理・永続化する。
- 出力 (React Flow & Console): ストアの変更を検知し、右画面に純粋関数型の計算過程とI/O結果をレンダリングする。

4. 開発規約
- TypeScriptの使用: 新規コードおよび修正はすべてTypeScriptで行い、`src/compiler/types.ts` で定義された型を厳守する。
- シャドウイングの可視化: 変数の再代入が発生した際、最新のバージョンのみを強調（背景色指定）し、以前のバージョンの強調を解除する。
- レイアウト保存: Blocklyのレイアウト保存はJSONシリアライズ形式を使用する。

# 論理・比較演算子ブロックの追加とデータフロー変換の実装計画

手続型（Blockly）の論理演算子・比較演算子ブロックを、純粋関数型のデータフロー（React Flow）に変換・可視化するための機能追加を行います。今後の「条件分岐（If-Else）」や「再帰のベースケース」、および「高階関数」の導入に向けた重要な基盤となります。

## User Review Required / 設計ガイドライン

> [!IMPORTANT]
> - **型制約の強化と視覚的フィードバック**: 
>   - 比較ブロックの入力は `Number` / `String` のみ、論理ブロックの入力は `Boolean` のみに制限します。
>   - さらに、比較ブロックは左右の入力ポートが「完全に一致する型（例: NumberとNumber）」である場合のみ接続を許可し、型不一致（Type Mismatch）の場合は視覚的なエラーまたは接続拒否のフィードバックを与えます。
> - **短絡評価（遅延評価）の導入**:
>   - 論理演算（`And`, `Or`）のトランスパイル時、右辺のノードは即座に評価・展開するのではなく、左辺の評価結果が確定するまで未評価状態（Thunk）として保持する「短絡評価（遅延評価）」のロジックを実装します。
> - **評価の省略 (Elision) と遅延展開**:
>   - リテラル同士の演算（例: `3 < 5`）や自明な演算結果は、コンパイラ側でノード自体を完全に消去（静的フォールディング）するのではなく、内部データとして演算ノードを保持しつつ、React Flow の初期描画時に「折りたたんだ状態（Elision）」として `true / false` の結果ノード1つに縮約してレンダリングします。これにより、ユーザーは必要に応じてノードを展開し、計算の途中経過を確認（On-demand inspection）できます。
> - **部分適用を見据えた変数の内部埋め込み**:
>   - 引数に変数が含まれる演算（例: `x < 5`）の場合、React Flow 上では視覚的ノイズを減らすため一つの演算ノードとしてリテラル値を埋め込み表示します。しかし、内部のSSAグラフおよび状態管理上は、将来的な高階関数・部分適用の導入（`filter (< 5)` のような切り出し）を見据え、「リテラルが部分適用された関数ノード」として扱えるデータ構造を維持します。

## Proposed Changes

### 1. AST・型定義の拡張
#### [MODIFY] `src/compiler/types.ts`
- `LiteralNode` の `value` に `boolean` を追加。
- 演算子を特殊構文ではなく純粋な関数適用として扱うため、`ApplyNode` を定義。
- `ExpressionNode` に `ApplyNode` を追加。

### 2. AST抽出ロジック（Extractor）の更新
#### [MODIFY] `src/compiler/extractor.ts`
- Blockly の論理比較ブロック `logic_compare_ext`, 論理演算ブロック `logic_operation_ext`, 否定ブロック `logic_negate_ext`, 真偽値ブロック `logic_boolean_ext` から AST を抽出するロジックを実装。
- すべての演算を特殊構文ではなく、`Apply` タイプ（`LessThan`, `GreaterThan`, `Equal`, `NotEqual`, `And`, `Or`, `Not` など）を用いた第一級関数の適用としてマッピング。

### 3. トランスパイラ（Transpiler）の更新
#### [MODIFY] `src/compiler/transpiler.ts`
- `ApplyNode` の評価処理を追加。
- 以下の変換・フォールディングロジックを実装：
  - **短絡評価**: `And` / `Or` 演算時、左辺の結果に依存して右辺を Thunk として扱うロジックの追加。
  - **Elisionの適用**: 引数がすべて `Literal` の場合や結果が自明な場合、計算結果ノードを作成しつつ、元の演算ノード群の React Flow 用 `data` オブジェクトに「初期状態で折りたたみ（簡易表示フラグON）」の設定を付与。
  - **部分適用構造の生成**: 引数に変数が含まれる場合、演算子ノードを生成し入力ノードからエッジを接続。リテラル引数は演算ノード内部の `data` に保持し、将来の部分適用の布石とする。

### 4. Blocklyフロントエンドの更新
#### [MODIFY] `src/components/BlocklyPane.tsx`
- 新しいブロック（論理・比較演算子、真偽値リテラル）を定義し、コネクタ形状・色（Boolean 専用の形状とマゼンタ/グリーン等のカラー）を定義。
- 同一型の接続のみを許可する（Type Mismatch防止）ための Blockly バリデーションフックを追加。
- ツールボックスに新カテゴリ「論理・比較」を追加。

### 5. 可視化UI（FlowPane / Custom Nodes）の実装
#### [MODIFY] `src/components/FlowPane.tsx`
- React Flow 用のカスタムノード `opNode`（演算子）および `valNode`（値/変数）を実装。
- アコーディオンまたはトグルスイッチによる「簡易表示（Elision状態：結果のみ）」と「詳細表示（演算過程の展開）」の切り替えUIを構築。
- 計算結果が `true` の場合は鮮やかなエメラルドグリーン、`false` の場合はソフトな赤/グレーでハイライト。

#### [MODIFY] `src/store.ts`
- カスタムノードの折りたたみ状態（`foldedNodeIds`）を Zustand で管理・永続化。

## Verification Plan

### Automated Tests
- `npm run build` を実行し、TypeScriptのビルドと型チェックが正常に通ることを検証します。
- `npm run lint` で構文エラーやコード規約違反がないか確認します。

### Manual Verification
Blockly上で以下のブロック構成を作り、「関数型に変換して実行」を押下する。
1. **リテラル比較のElision**: `3 < 5` -> 単一の値ノード `true` として簡約表示（折りたたみ状態）されること。また、クリックして展開し、`3 < 5` の詳細が確認できること。
2. **変数の部分適用表現**: `x = 3`, `x < 5` -> 変数ノード `x_1` から比較演算ノード `< 5`（引数が内部に視覚的埋め込みされた状態）に単一のエッジが接続されること。
3. **論理演算の簡約**: `true AND false` -> 単一の値ノード `false` として簡約表示されること。
4. **UIの堅牢性**: 演算ノードをクリックして詳細表示と簡易表示が切り替わり、周囲のエッジの再計算（レイアウト）が破綻しないこと。
5. **【重要】短絡評価の確認**: `false AND (存在しない変数 y > 0)` を実行した際、左辺の `false` が評価された時点で全体が `false` に簡約され、右辺のエラー（未定義変数等）によるクラッシュが起きないこと。

# ブロック機能のドキュメント化規約（memo.txt）
今後、新しいカスタムブロックや機能を実装・変更する場合は、以下の規約を厳守してください。
1. 新しいブロックやトランスパイラ、データフロー可視化（React Flow）の機能を追加した際は、必ずプロジェクトのルートにある [memo.txt](file:///Users/w.kout/Desktop/func-blocks-vis/memo.txt) にその機能内容を簡潔かつわかりやすく追記してください。
2. 既存の機能を変更・修正した場合は、[memo.txt](file:///Users/w.kout/Desktop/func-blocks-vis/memo.txt) の既存の記述内容を現状に合わせて修正してください。
3. このメモのドキュメント化プロセスは、今後の機能追加や仕様変更の際にも継続的に行われなければなりません。