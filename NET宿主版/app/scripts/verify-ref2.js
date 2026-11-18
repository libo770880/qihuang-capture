// scripts/verify-ref2.js —— 参照库模块端到端验收（gbt/icd 走 db 优先 + JSON 兜底）
'use strict';
const path = require('path');
const DB = require('../lib/db');
const gbt = require('../lib/gbt');
const icdmap = require('../lib/icdmap');
const kb = require('../lib/kb');

const dir = process.argv[2];
DB.initDb(dir, (a, b) => {});

console.log('== gbt ==');
const gs = gbt.stats();
console.log('  source =', gbt.source(), '| total =', gs.total);
for (const k of gbt.KINDS) console.log('  ', k.padEnd(9), gs[k].count, '类目', gs[k].cats.length);
console.log('  检索「感冒」:', gbt.search('感冒', 'disease', '', 5).list.map(x => x.code + ' ' + x.name).join(' / '));
console.log('  检索 A01.01  :', gbt.search('A01.01', 'all', '', 5).list.map(x => x.code + ' ' + x.name).join(' / '));
const mn = gbt.matchNames(['感冒', '不存在的病名xyz']);
console.log('  matchNames  :', [...mn.entries()].map(([k, v]) => k + '→' + v.code).join(', '));

console.log('\n== icd ==');
const is = icdmap.stats();
console.log('  source =', icdmap.source(), '| total =', is.total, '| diffCode =', is.diffCode, '| diffName =', is.diffName);
console.log('  检索 A00.0 :', icdmap.search('A00.0', 'all', 3).list.map(x => x.glCode + '→' + x.ybCode).join(' / '));
console.log('  lookupByCode A00.000 :', JSON.stringify(icdmap.lookupByCode('A00.000')).slice(0, 100));
console.log('  lookupByName 霍乱   :', (icdmap.lookupByName('霍乱') || {}).glCode);

console.log('\n== kb 内置 ==');
console.log('  herbs =', typeof kb.getBuiltinHerbs === 'function' ? kb.getBuiltinHerbs().length : 'N/A',
  '| formulas =', typeof kb.getBuiltinFormulas === 'function' ? kb.getBuiltinFormulas().length : 'N/A');

// 缓存命中：第二次调用应只做一次单行查询
const t1 = Date.now(); gbt.search('', 'all', '', 20); const t2 = Date.now();
icdmap.search('', 'all', 20); const t3 = Date.now();
console.log('\n  缓存命中耗时: gbt', (t2 - t1) + 'ms', '/ icd', (t3 - t2) + 'ms');
console.log('\nOK');
