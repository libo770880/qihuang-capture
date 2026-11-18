// scripts/verify-ref.js —— 参照库入库验收（只读，不改数据）
// 用法: node scripts/verify-ref.js <dataDir>
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dir = process.argv[2] || path.join(process.env.APPDATA || '', '岐黄鉴方·悬浮采集助手');
const file = path.join(dir, 'data.db');
console.log('DB:', file);

const db = new DatabaseSync(file);
const q = (sql, ...p) => db.prepare(sql).all(...p);

console.log('\n== 表清单 ==');
console.log(q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r.name).join(', '));

console.log('\n== ref_meta ==');
for (const r of q('SELECT * FROM ref_meta ORDER BY kind')) {
  const actual = q('SELECT COUNT(*) c FROM ref_items WHERE kind=?', r.kind)[0].c;
  console.log(`  ${r.kind.padEnd(11)} meta=${String(r.count).padStart(6)} actual=${String(actual).padStart(6)} ${actual === r.count ? '✓' : '✗不一致'} ver=${r.version} at=${r.loaded_at}`);
}

console.log('\n== kv 键 ==');
console.log(q('SELECT k FROM kv ORDER BY k').map(r => r.k).join(', '));

console.log('\n== kb_items 分布 ==');
for (const r of q('SELECT kind, COUNT(*) c FROM kb_items GROUP BY kind ORDER BY kind')) console.log(`  ${r.kind.padEnd(11)} ${r.c}`);

console.log('\n== records ==');
const rc = q('SELECT COUNT(*) c FROM records')[0].c;
console.log('  记录数:', rc);
for (const r of q('SELECT id,ts,diag,synd,substr(text,1,40) t FROM records ORDER BY rowid DESC LIMIT 3')) {
  console.log(`  ${r.ts} | ${r.diag || '-'} | ${r.t || ''}`);
}

// GB/T 抽样：确认 seq 顺序与编码完整性
console.log('\n== GB/T 15657 抽样 ==');
const gbt = q("SELECT data FROM ref_items WHERE kind='gbt' ORDER BY k1 LIMIT 3").map(r => JSON.parse(r.data));
gbt.forEach(x => console.log('  ', JSON.stringify(x).slice(0, 120)));
const kinds = q("SELECT json_extract(data,'$.kind') k, COUNT(*) c FROM ref_items WHERE kind='gbt' GROUP BY k");
console.log('  分库:', kinds.map(r => r.k + '=' + r.c).join(', '));

// ICD 抽样
console.log('\n== ICD 抽样 ==');
for (const r of q("SELECT data FROM ref_items WHERE kind='icd' ORDER BY k1 LIMIT 2")) console.log('  ', r.data.slice(0, 120));

db.close();
console.log('\nOK');
