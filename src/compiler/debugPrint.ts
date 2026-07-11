import { ASTNode } from './types';
import { FExpr, FProgram } from './functionalAst';
import { TraceEvent } from './evaluator';

/**
 * 開発用コンソール出力の整形器。DevToolsの「Copy object」による全要素改行の
 * 冗長なJSONを避けるため、プログラム構造の節目（文の区切り・body/fnBodyの
 * 入れ子）だけを改行し、式や文の中身は1行に畳んだ文字列を生成する。
 * 実行パイプラインの一部ではなく、BlocklyPane の console.log 専用。
 */

// 1行のコンパクトJSON（`{ "key": value, ... }` / `[ a, b ]` 形式）。
// 関数プロパティ（Thunkのcompute等）は省略し、Map（評価器のEnv）は {} とする。
const inline = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof Map) return '{}';
    if (Array.isArray(v)) {
        if (v.length === 0) return '[]';
        return `[ ${v.map(inline).join(', ')} ]`;
    }
    if (typeof v === 'object') {
        const entries = Object.entries(v as Record<string, unknown>)
            .filter(([, val]) => val !== undefined && typeof val !== 'function');
        if (entries.length === 0) return '{}';
        return `{ ${entries.map(([k, val]) => `"${k}": ${inline(val)}`).join(', ')} }`;
    }
    return JSON.stringify(v);
};

// ①手続型AST：1文=1行。制御構造（If/While）のみ cond / then / else / body を
// フィールド単位で改行し、分岐・本体の中の文は1行に畳む。
export function showProceduralAst(ast: ASTNode[]): string {
    const fmtStmt = (s: ASTNode, ind: string): string => {
        if (s.type === 'If') {
            return `${ind}{\n${ind}  "type": "If",\n${ind}  "cond": ${inline(s.cond)},\n${ind}  "then": ${inline(s.then)},\n${ind}  "else": ${inline(s.else)}\n${ind}}`;
        }
        if (s.type === 'While') {
            return `${ind}{\n${ind}  "type": "While",\n${ind}  "cond": ${inline(s.cond)},\n${ind}  "body": ${inline(s.body)}\n${ind}}`;
        }
        return `${ind}${inline(s)}`;
    };
    if (ast.length === 0) return '[]';
    return `[\n${ast.map((s) => fmtStmt(s, '  ')).join(',\n')}\n]`;
}

// ②関数型AST：Let/LetRecの連鎖（プログラム構造）に沿って body / fnBody だけを
// 改行・インデントし、束縛の右辺式は1行に畳む。fnBody直下のIf（ループの
// 骨格）のみ cond / then / else をフィールド単位で改行する。
export function showFunctionalAst(program: FProgram): string {
    const fmtFnBody = (e: FExpr, ind: string): string => {
        if (e.kind === 'If') {
            return `{\n${ind}  "kind": "If", "id": ${inline(e.id)}, "cond": ${inline(e.cond)},\n${ind}  "then": ${inline(e.then)},\n${ind}  "else": ${inline(e.else)}\n${ind}}`;
        }
        return inline(e);
    };
    const fmt = (p: FProgram, ind: string): string => {
        if (p.kind === 'Let') {
            return `{\n${ind}  "kind": "Let", "id": ${inline(p.id)}, "name": ${inline(p.name)}, "value": ${inline(p.value)},\n${ind}  "body": ${fmt(p.body, ind + '  ')}\n${ind}}`;
        }
        if (p.kind === 'LetRec') {
            return `{\n${ind}  "kind": "LetRec", "id": ${inline(p.id)}, "name": ${inline(p.name)}, "params": ${inline(p.params)},\n${ind}  "fnBody": ${fmtFnBody(p.fnBody, ind + '  ')},\n${ind}  "body": ${fmt(p.body, ind + '  ')}\n${ind}}`;
        }
        // Do（需要の根）は1行に畳む
        return inline(p);
    };
    return fmt(program, '');
}

// ③評価トレース：1イベント=1行（force順に上から読める）。
export function showTrace(trace: TraceEvent[]): string {
    if (trace.length === 0) return '[]';
    return `[\n${trace.map((ev) => `  ${inline(ev)}`).join(',\n')}\n]`;
}
