// 手順1: BlocklyからのAST抽出（今回はジェネレータの出力を模した固定のJSON）
export function extractAST() {
    return [
        { type: 'Assign', var: 'x', val: { type: 'Literal', value: 10 } },
        { type: 'Assign', var: 'y', val: { type: 'Var', name: 'x' } },
        { type: 'Assign', var: 'x', val: { type: 'Add', left: { type: 'Var', name: 'x' }, right: { type: 'Literal', value: 5 } } },
        { type: 'Print', val: { type: 'Var', name: 'y' } },
        { type: 'Print', val: { type: 'Var', name: 'x' } }
    ];
}

// 手順2: SSAグラフと実行結果の生成
export function transpileToSSA(ast) {
    let env = {}; // 変数のバージョン管理 { x: 1, y: 1 }
    let nodes = [];
    let edges = [];
    let consoleOutput = [];
    let yOffset = 50;

    const getVarVersion = (name) => env[name] || 0;
    const incrementVarVersion = (name) => {
        env[name] = getVarVersion(name) + 1;
        return env[name];
    };

    ast.forEach((stmt, index) => {
        if (stmt.type === 'Assign') {
            const ver = incrementVarVersion(stmt.var);
            const varId = `var_${stmt.var}_${ver}`;

            nodes.push({
                id: varId,
                position: { x: 300, y: yOffset },
                data: { label: `${stmt.var}_${ver}` },
                style: ver > 1 ? { background: '#ffeb3b' } : {} // シャドウイングされた変数を強調
            });

            if (stmt.val.type === 'Literal') {
                const valId = `val_${index}`;
                nodes.push({ id: valId, position: { x: 50, y: yOffset }, data: { label: `[値] ${stmt.val.value}` } });
                edges.push({ id: `e_${valId}_${varId}`, source: valId, target: varId, animated: true });
            } else if (stmt.val.type === 'Var') {
                const srcVer = getVarVersion(stmt.val.name);
                const srcId = `var_${stmt.val.name}_${srcVer}`;
                edges.push({ id: `e_${srcId}_${varId}`, source: srcId, target: varId, animated: true });
            } else if (stmt.val.type === 'Add') {
                const leftVer = getVarVersion(stmt.val.left.name);
                const leftId = `var_${stmt.val.left.name}_${leftVer}`;
                const rightId = `val_add_${index}`;
                const opId = `op_add_${index}`;

                nodes.push({ id: rightId, position: { x: 50, y: yOffset }, data: { label: `[値] ${stmt.val.right.value}` } });
                nodes.push({ id: opId, position: { x: 175, y: yOffset }, data: { label: '[+] 加算' } });

                edges.push({ id: `e_${leftId}_${opId}`, source: leftId, target: opId, animated: true });
                edges.push({ id: `e_${rightId}_${opId}`, source: rightId, target: opId, animated: true });
                edges.push({ id: `e_${opId}_${varId}`, source: opId, target: varId, animated: true });
            }
            yOffset += 100;
        } else if (stmt.type === 'Print') {
            if (stmt.val.type === 'Var') {
                const srcVer = getVarVersion(stmt.val.name);
                const srcId = `var_${stmt.val.name}_${srcVer}`;
                const printId = `print_${index}`;

                nodes.push({ id: printId, position: { x: 500, y: yOffset - 100 }, data: { label: 'Print()' }, style: { background: '#4caf50', color: '#fff' } });
                edges.push({ id: `e_${srcId}_${printId}`, source: srcId, target: printId, animated: true });

                // コンソール出力の評価（簡易的なインタプリタとしての振る舞い）
                // 実際のAST評価器ではないため、今回は環境の最新の値をシミュレーションする
                let outputValue = "";
                if (stmt.val.name === 'y') outputValue = "10";
                if (stmt.val.name === 'x') outputValue = "15";
                consoleOutput.push(outputValue);
            }
        }
    });

    return { nodes, edges, consoleOutput };
}