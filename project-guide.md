# 本プロジェクト 構成・実装ガイド（ファイル・役割・処理フロー）

> このファイルはコミットしない個人用ドキュメント。プロジェクトの「実物（コード）」の
> 構造を説明・発表するために、ファイル構成・各ファイルの役割・データの流れを網羅する。
> 理論・専門用語は `study-notes.md` を参照（本ファイルは"どう作られているか"に集中）。

---

## 0. プロジェクト名と一行説明

- **名前**：func-blocks-vis
- **一行**：Blocklyで組んだ手続型プログラムを関数型ASTに変換し、遅延評価（call-by-need）の純粋評価器で実行し、その評価過程をデータフローグラフとして可視化するWeb学習環境。
- **技術スタック**：React + TypeScript + Vite / Blockly（入力）/ React Flow（グラフ描画）/ Zustand（状態管理）/ Vitest（テスト）/ ESLint / GitHub Actions + GHC（CI検証オラクル）。

---

## 1. ディレクトリ構成（全体像）

```
func-blocks-vis/
├── src/
│   ├── main.tsx                    # Reactエントリポイント（Appをマウント）
│   ├── App.tsx                     # 全体レイアウト（左Blockly / 右上グラフ / 右下コンソール）
│   ├── index.css                   # グローバルCSS
│   ├── store.ts                    # Zustand状態管理（nodes/edges/consoleOutput/保存レイアウト）
│   ├── vite-env.d.ts               # Vite型定義
│   ├── assets/                     # 画像（hero.png / react.svg / vite.svg）
│   │
│   ├── compiler/                   # ★中核：5段階パイプライン＋検証系（UI非依存の純粋ロジック）
│   │   ├── types.ts                # 手続型ASTの型・Value/Thunk/Env等の共通ランタイム型
│   │   ├── functionalAst.ts        # 関数型ASTの型定義
│   │   ├── extractor.ts            # ① Blockly → 手続型AST
│   │   ├── transpiler.ts           # ② 手続型AST → 関数型AST（SSA変換）
│   │   ├── evaluator.ts            # ③ 純粋評価器（call-by-need）→ {trace, consoleOutput}
│   │   ├── renderGraph.ts          # ⑤ トレース駆動グラフ描画（純粋関数）
│   │   ├── procInterpreter.ts      # 手続型参照インタプリタ（§4.8、比較・検証用）
│   │   ├── haskellPrinter.ts       # 関数型AST → Haskellソース（§4.6 GHC検証用）
│   │   ├── debugPrint.ts           # 開発用コンソール整形（AST/traceを可読文字列に）
│   │   │
│   │   ├── transpiler.test.ts      # ②の単体テスト（SSA/φ/letrecの構造・適格性）
│   │   ├── evaluator.test.ts       # ③の単体テスト（評価・短絡・メモ化・ループ）
│   │   ├── renderGraph.test.ts     # ⑤の単体テスト（Elision/型ラベル/ノード生成）
│   │   ├── procInterpreter.test.ts # §4.8の単体テスト（観測等価・停止性の非対称）
│   │   ├── haskellPrinter.test.ts  # Haskell生成のゴールデンテスト（GHC不要）
│   │   └── ghcOracle.test.ts       # GHC差分テスト（GHC_ORACLE=1でゲート）
│   │
│   └── components/                 # React UIコンポーネント
│       ├── BlocklyPane.tsx         # 左ペイン：Blockly本体＋ブロック定義＋実行ボタン＋手続型コンソール
│       ├── FlowPane.tsx            # 右上：React Flowでグラフ描画（カスタムノード群）
│       └── ConsolePanel.tsx        # 左右共通のリサイズ可能なコンソール枠
│
├── .github/workflows/ci.yml        # CI（build→lint→test→test:ghc、GHCはhaskell-actions/setup）
│
├── CLAUDE.md                       # ★設計指示書（唯一の正）。全アーキテクチャ・意味論の規定
├── transform.md                    # 手続型→関数型変換の3論文抽出（Kelsey/森下/住井）
├── launchbury.md                   # Launchbury対応関係論証（AST↔評価規則↔Haskell脱糖）
├── DateFlow.md                     # Weck & Tichy論文からの可視化設計原則抽出
├── study-notes.md                  # （個人用）専門用語・学術知識の学習ノート
├── project-guide.md                # （個人用）本ファイル：実装構成ガイド
├── README.md / GEMINI.md           # 補助ドキュメント
│
├── package.json                    # 依存・スクリプト（dev/build/lint/test/test:ghc）
├── tsconfig.json / tsconfig.node.json  # TypeScript設定
├── vite.config.ts                  # Vite設定
└── eslint.config.js                # ESLint設定
```

**行数の目安（実装規模の感覚）**：renderGraph.ts が最大（約630行）、FlowPane.tsx（約627行）、transpiler.ts（約345行）、evaluator.ts（約317行）。compiler層の本体だけで約2000行、テストで約1200行。

---

## 2. 処理フロー（データがどう流れるか）

### 2.1 「関数型に変換して実行」ボタンを押したときの全フロー

起点は `BlocklyPane.tsx` の `handleRun()`。

```
[ユーザーがブロックを組む]
      │
      ▼
① extractAST(workspace)                         … extractor.ts
      │  → ASTNode[]（手続型AST）
      │
      ├─────────────────────────────┐
      │                             │
      ▼                             ▼
runProcedural(ast)            ② transpileToFunctionalAst(ast)   … transpiler.ts
  … procInterpreter.ts             │  → FProgram（関数型AST）
  → 手続型の実行結果               │
  → 左ペイン下部コンソール         ▼
                          ③ evaluate(program)                   … evaluator.ts
                                   │  → { trace: TraceEvent[], consoleOutput: string[] }
                                   │
                          ┌────────┴────────┐
                          ▼                 ▼
                  ④ consoleOutput      ⑤ renderGraph(program, trace)  … renderGraph.ts
                     → 右下コンソール       │  → { nodes, edges }
                     （store経由）          ▼
                                     updateGraph(nodes, edges, consoleOutput)  … store.ts
                                            │
                                            ▼
                                     FlowPane.tsx が store を購読して再描画（React Flow）
```

ポイント：
- **①の出力（手続型AST）が2手に分岐**する。片方は手続型参照インタプリタ（左コンソール）、もう片方が②③④⑤の本線（右コンソール＋グラフ）。この2つを並べて対比させるのがHCIの肝。
- **③が返すのは `trace` と `consoleOutput` だけ**。④（結果表示）も⑤（グラフ描画）も、この `trace`／`consoleOutput` を入力にする「兄弟」であり、互いに依存しない。
- **②〜⑤はすべてUI非依存の純粋関数**。React・Zustandを一切importしない。UIとの橋渡しは `handleRun()` と `store.ts` の `updateGraph()` だけ。

### 2.2 変換が失敗する場合の流れ
- ②`transpileToFunctionalAst` は、現行スコープ外の構成（分岐/ループ内のPrint、ループの入れ子）で**例外を投げる**。
- `handleRun()` は try/catch で捕捉し、右コンソールに `[変換エラー] ...` を表示する（グラフは空）。
- 手続型参照インタプリタ（左）は try/catch の外で常に実行されるので、変換が失敗しても左の結果は出る。

### 2.3 データ型の受け渡し（ステージ間の契約）
| 境界 | 渡す型 | 定義場所 |
|---|---|---|
| ①→② | `ASTNode[]`（手続型AST） | types.ts |
| ②→③⑤ | `FProgram`（関数型AST） | functionalAst.ts |
| ③→④⑤ | `TraceEvent[]` / `string[]` | evaluator.ts |
| ⑤→UI | `{ nodes: Node[], edges: Edge[] }`（React Flow型） | renderGraph.ts |

---

## 3. compiler層（中核ロジック）の各ファイル詳細

### 3.1 `types.ts`（120行）— 手続型ASTと共通ランタイム型
- **手続型ASTの型**（判別フィールド `type`）：
  - `ASTNode = AssignNode | PrintNode | IfNode | WhileNode`
  - `Assign`（代入 var/val）/ `Print`（val）/ `If`（cond/then[]/else[]）/ `While`（cond/body[]）
  - 式：`ExpressionNode = LiteralNode | VarNode | ApplyNode`
  - `ApplyNode.op`：Add/Sub/Mul/Div/Pow/Mod/比較6種/And/Or/Not（15演算子）
- **call-by-needランタイム型**（評価器が使う）：
  - `Value = number | string | boolean | PairValue | FnValue`
  - `PairValue`（対＝WHNFで殻だけ）/ `FnValue`（関数値＝letrecの閉包、name/params/body/env）
  - `Thunk`：3状態FSM（`unevaluated`＝compute保持 / `forcing`＝評価中＝ブラックホール検出用 / `evaluated`＝値保持）
  - `Env = Map<string, Thunk>`（環境は値でなくThunkを束縛）
  - `showValue(v)`：表示ヘルパ（対＝`⟨組⟩`、関数＝`⟨関数 名⟩`、それ以外は`String`）
  - `OP_SYMBOLS`：演算子→記号の表（`+`,`<`,`&&`等。可視化ラベル用）

### 3.2 `functionalAst.ts`（78行）— 関数型ASTの型
- **判別フィールド `kind`**（手続型の `type` と区別）。React Flow/Zustand非依存、単独でシリアライズ可能。
- **式ノード** `FExpr`：`Lit` / `Var`（SSA名 `x_1`）/ `PrimApp`（組込演算）/ `If`（三項演算子）/ `LetIn`（式レベルlet）/ `Apply`（名前付き関数適用）/ `Pair` / `Proj`（fst/snd）
- **プログラムノード** `FProgram`：`Let`（プログラムレベルSSA束縛）/ `LetRec`（whileの自己参照関数）/ `Do`（Print列＝需要の根）
- **`FPrint`**：個々のPrint。**全ノードが `id`**（trace相関用）。`FVar.id`だけは未使用（Varの実体は束縛元Let。nameで解決）。
- **正準ID関数**：`canonicalVarId(name)="var_"+name`（変数のヒープ位置／ノードID）、`canonicalUnboundId(name)="var_"+name+"_unbound"`（未束縛⊥ゴースト）。評価器とrenderGraphが同じ規則で参照する。

### 3.3 `extractor.ts`（208行）— ① Blockly → 手続型AST
- `extractAST(workspace): ASTNode[]`。トップブロックから `next` 連鎖を辿って文の列を作る。
- `stmtChainToAST`（文の連鎖を再帰的に。if/whileの本体にも適用）/ `blockToAST`（文ブロック→ASTNode）/ `exprToAST`（値ブロック→ExpressionNode）。
- 対応ブロック：`variables_set`→Assign、`text_print`→Print、`controls_if_ext`→If、`controls_while_ext`→While、`math_change_ext`→複合代入（`x += d` を `Assign(x, Add(x,d))` に展開）、演算系ブロック→Apply。

### 3.4 `transpiler.ts`（345行）— ② 手続型AST → 関数型AST（★SSA変換の心臓部）
- `transpileToFunctionalAst(ast): FProgram`。**評価は一切行わない**（forceもBUILTINSも持たない）。
- **SSA版数管理を2層に分離**：
  - `versionCounter`：変数ごとの単調増加カウンタ（分岐に入っても巻き戻さない＝束縛名の一意性を構造的に保証）
  - `current`：「いま参照すべき版」（then/elseで独立進行、合流点でφの版に切替。版0＝未束縛⊥）
- **文の走査**：`processStmts`（Assign→Let束縛、Print→Do収集、If→processIf、While→processWhile）
- **processIf**：両枝を独立に処理→φ対象変数を検出→合成条件束縛 `%cond_n`（複数φ時）→分岐内束縛を巻き上げ→φ束縛 `x_n = If(cond, then版, else版)` 生成。
- **processWhile**：ループ変数（本体で代入される変数）を検出→`%loop_n`関数を作り仮引数化→本体を`LetIn`連鎖に→末尾自己呼び出し（`Apply`）→複数変数なら`Pair`で出口値、`%r_n`束縛＋`Proj`射影で取り出し。ループ不変変数は自由変数として捕捉。
- **エラー**：分岐/ループ内Print、ループの入れ子は明示エラー（現行スコープ外）。
- 最後に束縛列を右結合の入れ子Let/LetRecに畳み、終端Doで閉じる。

### 3.5 `evaluator.ts`（317行）— ③ 純粋評価器（★call-by-needの心臓部）
- `evaluate(program): { trace, consoleOutput }`。**UI非依存の純粋関数**。
- **`TraceEvent`**（可視化の唯一の情報源）：`force`（nodeId/order/value/memoHit）/ `print`（nodeId/order/text）/ `error`（nodeId/order/message）の3種Union。
- **`force(thunk)`**：evaluated→キャッシュ値（memoHit）、forcing→ブラックホールエラー、unevaluated→compute実行後evaluatedに更新。全forceを `trace` にpush。メモ化の可変性は benign effect（コメントに根拠明記）。
- **`BUILTINS`**：15演算子の組込関数。And/Orは `force(a[0]) ? ... : ...` で短絡が創発。Div/ModはIEEE754委譲。
- **`buildThunk(expr, env)`**：式→Thunk構築（＝クロージャ生成、この時点ではforceしない）。Lit/Var（未束縛は`unboundGhosts`で⊥共有）/PrimApp/If（scrutineeのみforce）/LetIn/Apply（`MAX_APPLICATIONS=500`で反復上限）/Pair（WHNF）/Proj（対をforce→成分force）。
- **`run(node, env)`**：Let（bindのみ、forceしない）/ LetRec（関数値をevaluatedで束縛、閉包に自分を含める）/ Do（Print列をプログラム順にforce、try/catchで1つの失敗が後続を止めない）。

### 3.6 `renderGraph.ts`（630行）— ⑤ トレース駆動グラフ描画
- `renderGraph(program, trace): { nodes, edges }`。**評価を一切行わない純粋関数**。
- **traceのインデックス化**：`forceIndex`（nodeId→最初のforce結果）/ `printIndex`。同一nodeIdは「最初に需要が届いた時点」を採用。
- **binderIndex**：全束縛（Let/LetRec関数名/仮引数/LetIn）の名前→{正準ID, 束縛式}索引。Varはこれ経由で束縛元ノードへ解決（Var自体のノードは作らない）。
- **静的型推論** `inferType`：forceを誘発せず全エッジに型ラベル（Number/String/Boolean/Unknown）を付与。PrimApp→op、Lit→typeof、If→両腕合流、Var→束縛式を辿る。
- **place(expr,...)**：式を再帰配置（構造再構築のみ）。深さ=Y（浅い子が上）、兄弟の広がり=X（上→下レイアウト）。ノード種別ごとに valNode/opNode/ifNode/applyNode を生成。
- **walkProgram**：Let/LetRec/Doの連鎖を歩き、変数ノード・loopNode・printNodeを配置。LetRecは仮引数を上段に、本体を下に、末尾自己呼び出しでサイクル（＝再帰の可視化）。
- **Finalizeパス**：評価状態確定後にElision（折りたたみ）・unforcedInputs（need未到達バッジ）・エッジの減光/破線（source未評価）を決定。

### 3.7 `procInterpreter.ts`（141行）— 手続型参照インタプリタ（§4.8）
- `runProcedural(ast, maxSteps=10000): { output, status: 'ok'|'timeout'|'error', message? }`。
- 変換を経由せず、可変な変数表 `Map` で正格・逐次実行。評価器と**コードを共有しない独立実装**（参照オラクル）。
- 無限ループは反復総数上限（`PROC_MAX_STEPS=10000`）で `timeout` 打ち切り、**途中出力は保持**。未束縛変数は即時 `error` 停止（関数型側の⊥許容と対照的）。入れ子ループ・ループ内Printにも制限なし。

### 3.8 `haskellPrinter.ts`（202行）— GHC検証用Haskell生成（§4.6）
- `printHaskell(program): string`。関数型AST→コンパイル可能なdo記法Haskellソース。**本番実行パスには組み込まない**。
- 脱糖：Let→do内let、LetRec→letの関数束縛、If→if-then-else、Pair→タプル、Proj→fst/snd、未束縛Var→`undefined`（＝⊥）。
- 正規化：埋め込みヘルパ `showJS`（`3.0`→"3"、`True`→"true"、Infinity/NaN）と `jsMod`（JSの`%`の符号規約）で `evaluate()` 出力と文字単位一致。数値は `(n::Double)` 固定。
- マングリング：ユーザー変数`v_`＋不正文字エスケープ、`%`系→`phi_`。

### 3.9 `debugPrint.ts`（75行）— 開発用コンソール整形
- `showProceduralAst` / `showFunctionalAst` / `showTrace`。DevToolsの「Copy object」が全要素改行する冗長JSONを避け、プログラム構造の節目だけ改行し式は1行に畳む。`handleRun` の console.log 専用（パイプライン非関与）。

---

## 4. components層（UI）の各ファイル詳細

### 4.1 `BlocklyPane.tsx`（484行）— 左ペイン
- **カスタムブロック定義**（`Blockly.defineBlocksWithJsonArray`）：`math_change_ext`（複合代入）/ `controls_if_ext`（if-else）/ `controls_while_ext`（while）/ `logic_boolean_ext` / `logic_compare_ext`（型一致バリデーション付き）/ `logic_operation_ext`（AND/OR）/ `logic_negate_ext`（NOT）。標準 `math_arithmetic` に剰余(%)を追加。
- **ツールボックス**：変数（動的カテゴリ`CUSTOM_VARIABLE`＝標準フライアウトから`math_change`を除外）/ 数学・計算 / 論理・比較 / 制御 / テキスト出力。
- **`handleRun()`**：①抽出→手続型実行（左コンソール）→②③⑤本線（try/catch）→`updateGraph`。debugPrintでconsole.logも出す。
- **保存/復元/削除**：`Blockly.serialization` でワークスペースをJSON保存（Zustandの`savedLayouts`にpersist）。
- **手続型コンソール**：`ConsolePanel` で「実行結果（手続型）」を表示。`ResizeObserver`→`Blockly.svgResize()` でコンソールリサイズにワークスペースを追従。

### 4.2 `FlowPane.tsx`（627行）— 右上グラフ描画
- **カスタムノードコンポーネント**：
  - `ValNode`（丸/値・変数・リテラル。真偽値で色分け、未評価はゴースト減光、変数の最新版は黄色）
  - `OpNode`（矩形/演算。折りたたみ・埋め込みリテラル・右辺スキップバッジ・展開ボタン。単項/二項でハンドル数が変わる）
  - `IfNode`（三項演算子/φ合流。cond/then/elseの3入力、then側/else側スキップバッジ）
  - `ApplyNode`（小四角/動的な関数適用。関数定義からの破線エッジ＝再帰サイクル）
  - `LoopNode`（破線枠/letrec自己参照関数の定義）
  - `PrintNode`（Print。エラー時は⊥表示）
- ハンドルは上（target）/下（source）＝上→下レイアウト。
- 折りたたみノードの子リテラルを非表示化、選択ノードに接続するエッジをオレンジでハイライト。

### 4.3 `ConsolePanel.tsx`（68行）— 共通コンソール枠
- `ConsolePanel({ title, defaultHeight, children })`。左右で同一の見た目を保証。
- 上端の仕切りバーをドラッグで**左右独立にリサイズ**（最小40px〜画面高8割）。`#1e1e1e`・monospace。

### 4.4 `App.tsx`（33行）/ `main.tsx`（10行）/ `store.ts`（57行）
- `App.tsx`：左ペイン（BlocklyPane）と右ペイン（上=FlowPane / 下=ConsolePanel「実行結果（関数型）」）の2分割レイアウト。右コンソールは`useStore`の`consoleOutput`を購読。
- `main.tsx`：`ReactDOM.createRoot` で `App` をマウント。
- `store.ts`：Zustand。状態＝`nodes/edges/consoleOutput/savedLayouts`。アクション＝`updateGraph`（③⑤の結果反映）/`onNodesChange`/`onEdgesChange`（React Flow操作）/`toggleNodeFold`（折りたたみ）/`saveLayout`/`deleteLayout`。`persist`ミドルウェアで`savedLayouts`のみlocalStorage永続化。

---

## 5. テスト構成

`npm run test`（Vitest）で通常テスト、`npm run test:ghc`（`GHC_ORACLE=1`）でGHC差分テスト。

| テストファイル | 対象 | 主な検証内容 |
|---|---|---|
| `transpiler.test.ts` | ②変換 | SSA名の一意性（適格性）/ if-elseのφ生成・%cond共有・片側代入⊥腕 / while→letrec・仮引数・Pair出口・射影・自由変数捕捉 / 分岐内Print・ループ入れ子の明示エラー |
| `evaluator.test.ts` | ③評価 | 算術/比較/論理 / 短絡で右辺未force / IEEE754 0除算 / 未使用変数の未評価 / メモ化（memoHit）/ ループ実行・需要のないループが走らない・反復上限エラー・300反復のスタック安全性 |
| `renderGraph.test.ts` | ⑤描画 | Elision判定 / unforcedInputsバッジ / 全エッジ型ラベル / Var→束縛ノード解決 / ノード数線形性 / ifNode3エッジ・skippedBranch / loopNode・applyNode・仮引数ノード・自由変数捕捉エッジ |
| `procInterpreter.test.ts` | §4.8 | 停止プログラムでの関数型との観測等価 / 短絡 / 無限ループ打ち切り / 停止性の非対称 / 未束縛変数の即時エラー / 入れ子ループ |
| `haskellPrinter.test.ts` | §4.6生成 | Let/PrimApp/Do脱糖 / ⊥→undefined / if-elseφ / %condマングリング / while→letrec+タプル+射影 / 非ASCII変数エスケープ（GHC不要のゴールデンテスト） |
| `ghcOracle.test.ts` | §4.6検証 | 8fixtureに対し `ghc -fno-code`型検査＋`runghc`出力の文字単位一致（GHC_ORACLE=1でゲート、GHC不在ならスキップ） |

現状：通常テスト46件パス（GHCオラクル8件はスキップ）、`test:ghc`で8〜9件パス。

---

## 6. ビルド・実行・CI

### スクリプト（package.json）
- `npm run dev`：Vite開発サーバ起動。
- `npm run build`：`tsc && vite build`（型チェック込みビルド）。
- `npm run lint`：ESLint。
- `npm run test`：Vitest（通常。GHCオラクルはスキップ）。
- `npm run test:ghc`：`GHC_ORACLE=1 vitest run src/compiler/ghcOracle.test.ts`（GHC差分テスト）。

### CI（.github/workflows/ci.yml）
- push（main）/ PR時に ubuntu-latest で実行。
- `actions/setup-node`（Node 22）＋ `haskell-actions/setup`（GHC 9.6）→ `npm ci` → `build` → `lint` → `test` → `test:ghc`。
- これで「GHCはCI専用オラクル・本番実行系に組み込まない」位置づけが構造的に保証される。

### 設定ファイル
- `tsconfig.json`：strict有効、`types:["node"]`（ghcOracle.test.tsのnode:*用）、`noUnusedLocals/Parameters`。
- `vite.config.ts` / `eslint.config.js`：Vite・ESLintの設定。

---

## 7. ドキュメントファイル群（役割分担）

| ファイル | 役割 | 位置づけ |
|---|---|---|
| `CLAUDE.md` | **設計指示書（唯一の正）**。§1概要〜§8ドキュメント規約。全アーキテクチャ・意味論・変換規則・検証計画を規定 | 最重要。実装はこれに従う |
| `transform.md` | 手続型→関数型変換の3論文（Kelsey/森下/住井）抽出。§5.1/§5.2変換規則の根拠 | CLAUDE.md §5の出典 |
| `launchbury.md` | Launchbury対応関係論証（AST↔評価規則↔Haskell脱糖）。§5.2着手前に確定した前提 | CLAUDE.md §4.7の正本 |
| `DateFlow.md` | Weck & Tichy論文からの可視化設計原則抽出。ノード種別/型ラベル/レイアウト | CLAUDE.md §4.5の出典 |
| `memo.txt` | 実装した機能の変更履歴（§8規約に基づき機能追加ごとに追記） | 実装ログ |
| `README.md` / `GEMINI.md` | 補助ドキュメント | ― |
| `study-notes.md` | （個人用）専門用語・学術知識の学習ノート | 発表準備 |
| `project-guide.md` | （個人用）本ファイル：実装構成ガイド | 発表準備 |

---

## 8. 実装状況（どこまで作ったか）

- **実装済み**：変数/数学・計算/論理・比較/テキスト出力の各ブロック、§5.1 if-else（三項演算子φ）、§5.2 while（letrec）、5段階パイプライン全体、GHC検証オラクル（§4.6 Phase1〜3：haskellPrinter＋差分テスト＋CI）、手続型参照インタプリタ（§4.8）、左右コンソール（リサイズ可能）。
- **未実装（今後）**：§5.3 余再帰/無限リスト（値レベル自己参照束縛、`cons`セル）、§5.4 高階関数（第一級ラムダ`Lambda`・部分適用・map/filter/reduce・クロージャの部分グラフ描画）、非局所制御（break/例外＝CPS導入境界）、ループのThunk連鎖の反復展開可視化。
- **設計上の重要な決定事項**：正格化オプションは導入せず反復上限（500）で対処（§5.2(e)）、GHCはCI専用（§4.6）、可視化はトレース駆動でWeck&Tichyの生成経路は不採用（§4.5）。

---

## 9. 「このプロジェクトの説明」を1分でする台本

「Blocklyで手続型のプログラムを組ませます。それを `extractor` で手続型ASTにし、`transpiler` がSSA変換で関数型ASTに変えます。`evaluator` がそれを遅延評価（call-by-need）で実行し、評価イベントの列（trace）とコンソール出力を返します。`renderGraph` がそのtraceだけを見てデータフローグラフを組み、React Flowで描画します。評価とUIは完全に分離されていて、②〜⑤はUIに一切依存しない純粋関数です。正しさは3つの独立実装——手続型参照インタプリタ・自作評価器・GHCで実行したHaskell——の出力が一致することで機械検証しています。左右のコンソールに手続型実行と関数型実行を並べるので、"手続型なら無限ループ、関数型なら需要がなく停止"という遅延評価の利点がそのまま見えます。」
</content>
