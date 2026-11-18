// scripts/_diff_tcm.js - 比对 JS 与 C# 两版批次 2 的对拍输出
//
// 用法:
//   node scripts/_probe_tcm.js > /tmp/js.txt
//   QhjfCapture.exe --probe-tcm > /tmp/cs.txt
//   node scripts/_diff_tcm.js /tmp/js.txt /tmp/cs.txt
'use strict';
const fs = require('fs');

const [jsFile, csFile] = process.argv.slice(2);
if (!jsFile || !csFile) {
  console.error('用法: node scripts/_diff_tcm.js <js.txt> <cs.txt>');
  process.exit(2);
}

/** 对象键顺序在 JSON 语义上无意义（前端按名取值），比较前递归排序，只比语义；数组顺序保留 */
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonical(v[k]);
    return o;
  }
  return v;
}
const norm = (s) => {
  try { return JSON.stringify(canonical(JSON.parse(s))); } catch (e) { return s; }
};

const load = (p) => {
  const m = new Map();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('\t');
    if (i < 0) continue;
    m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
};

const js = load(jsFile);
const cs = load(csFile);

const onlyJs = [...js.keys()].filter(k => !cs.has(k));
const onlyCs = [...cs.keys()].filter(k => !js.has(k));
let same = 0;
const diffs = [];

for (const [name, a] of js) {
  if (!cs.has(name)) continue;
  const b = cs.get(name);
  if (a === b) { same++; continue; }
  if (norm(a) === norm(b)) { same++; continue; }   // 仅键顺序不同视为一致

  // 定位首个差异位置，便于快速判断漂移性质
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  diffs.push({ name, pos: i, js: a.slice(Math.max(0, i - 60), i + 120), cs: b.slice(Math.max(0, i - 60), i + 120), jsLen: a.length, csLen: b.length });
}

console.log(`场景总数 JS=${js.size} CS=${cs.size}`);
console.log(`一致 ${same} / 差异 ${diffs.length}`);
if (onlyJs.length) console.log('仅 JS 有:', onlyJs.join(', '));
if (onlyCs.length) console.log('仅 CS 有:', onlyCs.join(', '));
for (const d of diffs) {
  console.log('\n=== ' + d.name + ` (首个差异 @${d.pos}, len ${d.jsLen}/${d.csLen}) ===`);
  console.log('  JS: …' + d.js);
  console.log('  CS: …' + d.cs);
}
process.exit(diffs.length === 0 && onlyJs.length === 0 && onlyCs.length === 0 ? 0 : 1);
