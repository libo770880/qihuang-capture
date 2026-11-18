// scripts/_test_dataport.js - 配置搬家内核自测（不碰生产库）
// 1) 拷贝一份真实 data.db 到临时目录 → audit（应全部入库）
// 2) 导出配置包 → 在空目录建新库 → 导入 → 比对 kv 各键长度与 kb 各类条数
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LIB = path.join(__dirname, '..', 'lib');
const DB_PATH = path.join(LIB, 'db.js');
const PORT_PATH = path.join(LIB, 'dataport.js');
const SRC = process.argv[2] || path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手', 'data.db');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qhjf-dataport-'));
const dirA = path.join(tmpRoot, 'A');
const dirB = path.join(tmpRoot, 'B');
fs.mkdirSync(dirA, { recursive: true });
fs.mkdirSync(dirB, { recursive: true });
for (const f of ['data.db', 'data.db-wal', 'data.db-shm']) {
  const s = path.join(path.dirname(SRC), f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dirA, f));
}

// 每个目录用独立子进程打开（同进程只能持一个 SQLite 连接）
function run(code, args) {
  const out = execFileSync(process.execPath, ['-e', code, ...args], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}
const PRE = `const DB=require(${JSON.stringify(DB_PATH)});const port=require(${JSON.stringify(PORT_PATH)});`;

const auditA = run(PRE + `
DB.initDb(process.argv[1],()=>{});
const a=port.audit(process.argv[1]);
console.log(JSON.stringify(a));
`, [dirA]);

console.log('[audit] db=' + auditA.dbBytes + 'B records=' + auditA.records +
  ' kv=' + auditA.kv.length + ' kb=' + auditA.kb.length + ' legacy=' + auditA.legacy.length +
  ' allInDb=' + auditA.allInDb);
for (const x of auditA.kv) console.log('  kv ' + x.key.padEnd(12) + (x.present ? 'OK ' + x.bytes + 'B' : 'MISSING'));
for (const x of auditA.kb) console.log('  kb ' + x.kind.padEnd(12) + x.count + ' 条');
if (auditA.legacy.length) console.log('  legacy: ' + auditA.legacy.map(x => x.rel).join(', '));

const cfgFile = path.join(tmpRoot, 'cfg.qhcfg');
const ex = run(PRE + `
DB.initDb(process.argv[1],()=>{});
console.log(JSON.stringify(port.exportConfig(process.argv[2])));
`, [dirA, cfgFile]);
console.log('[export] ' + ex.kv + ' kv / ' + ex.kbKinds + ' kinds / ' + ex.kbItems + ' items / ' + ex.bytes + 'B');

const imp = run(PRE + `
DB.initDb(process.argv[1],()=>{});
console.log(JSON.stringify(port.importConfig(process.argv[2])));
`, [dirB, cfgFile]);
console.log('[import] ok=' + imp.ok + ' kv=' + imp.kv + ' kb=' + imp.kb + ' kinds=' + imp.kbKinds +
  (imp.snapshot ? ' snapshot=yes' : ''));

function snap(dir) {
  return run(PRE + `
DB.initDb(process.argv[1],()=>{});
const raw=DB.exportConfigRaw();
const kv={}; for(const k of Object.keys(raw.kv).sort()) kv[k]=JSON.stringify(raw.kv[k]).length;
const kb={}; for(const k of Object.keys(raw.kb).sort()) kb[k]=raw.kb[k].length;
console.log(JSON.stringify({kv,kb}));
`, [dir]);
}
const a = snap(dirA), b = snap(dirB);
let diff = 0;
for (const k of Object.keys(a.kv)) if (a.kv[k] !== b.kv[k]) { diff++; console.log('  kv diff ' + k + ': ' + a.kv[k] + ' vs ' + b.kv[k]); }
for (const k of Object.keys(a.kb)) if (a.kb[k] !== b.kb[k]) { diff++; console.log('  kb diff ' + k + ': ' + a.kb[k] + ' vs ' + b.kb[k]); }
console.log('[compare] kv=' + Object.keys(a.kv).length + ' kb=' + Object.keys(a.kb).length + ' diff=' + diff);

fs.rmSync(tmpRoot, { recursive: true, force: true });
process.exit(diff === 0 && auditA.allInDb ? 0 : 1);
