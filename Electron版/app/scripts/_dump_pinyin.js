/**
 * _dump_pinyin.js —— 把 pinyin-pro 的读音能力导出为离线数据（供 .NET 宿主复用）
 *
 * 为什么需要：lib/kb.js 的同音仲裁（pyNoTone）与 lib/tcm.js 的拼音展开（westPyExpand）
 * 依赖 pinyin-pro。C# 侧不能内嵌该库，故导出为 JSON：
 *   ① chars —— 全量单字无声调全拼（基本区 + 扩展A），按码位对齐的紧凑串，任意汉字串都有兜底读音
 *   ② words —— 词组读音修正表：仅收录「逐字拼接 != pinyin-pro 词组结果」的词（多音字，如 白术 baizhu
 *               而非 bai|shu；薄荷 bohe 而非 bao|he），体积小且精准
 * C# 侧 Pinyin.Of(s)：整词查 words 命中则用，否则逐字查 chars 拼接。
 *
 * 用法：node scripts/_dump_pinyin.js
 * 产物：data/pinyin.json（附带 sha256 与计数，供对拍）
 * 注意：改内置知识库数据（kb*.js）后需重跑本脚本 + _dump_builtin_kb.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pinyin } = require('pinyin-pro');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'pinyin.json');

const CJK = /^[\u3400-\u4dbf\u4e00-\u9fa5]+$/;
const pyNoTone = (s) => {
  try { return (pinyin(String(s), { toneType: 'none', type: 'array', nonZh: 'consecutive' }) || []).join('').toLowerCase(); }
  catch (e) { return ''; }
};
const pyAll = (s) => {
  try { return (pinyin(String(s), { toneType: 'none', type: 'array', nonZh: 'consecutive' }) || []).map(x => String(x).toLowerCase()); }
  catch (e) { return []; }
};

// ---------- ① 单字表 ----------
const ranges = [
  [0x3400, 0x4dbf],  // 扩展 A
  [0x4e00, 0x9fff],  // 基本区
];
const chars = {};
let charCount = 0;
for (const [from, to] of ranges) {
  const arr = [];
  for (let c = from; c <= to; c++) {
    const ch = String.fromCharCode(c);
    const py = pyNoTone(ch);
    // pinyin-pro 对未收录字会原样返回，视为无读音
    arr.push(py && py !== ch ? py : '');
    if (py && py !== ch) charCount++;
  }
  chars['0x' + from.toString(16)] = arr.join(',');
}

// ---------- ② 词条表（多音字修正） ----------
const terms = new Set();
const addTerm = (t) => {
  const s = String(t || '').trim();
  if (s.length >= 2 && s.length <= 12 && CJK.test(s)) terms.add(s);
};
// (a) 内置知识库 JSON 里的全部中文串
try {
  const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'builtin-kb.json'), 'utf8'));
  const walk = (v) => {
    if (typeof v === 'string') addTerm(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { addTerm(k); walk(x); });
  };
  walk(kb);
} catch (e) { console.warn('跳过 builtin-kb.json：', e.message); }
// (b) lib/*.js 源码中的中文串字面量（覆盖西医用词表/证型别名/术语表等运行时常量表）
for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8');
  for (const m of src.matchAll(/'([^'\\\n]{2,60})'|"([^"\\\n]{2,60})"/g)) {
    const lit = m[1] || m[2] || '';
    // 长串按常见分隔符拆成短词条（如「骨折|跌打|损伤」类枚举）
    if (CJK.test(lit)) { addTerm(lit); }
    else for (const part of lit.split(/[^\u3400-\u4dbf\u4e00-\u9fa5]+/)) if (part) addTerm(part);
  }
}

const words = {};      // 全拼修正：逐字拼接 != 词组读音（多音字，如 白术 bai|shu → baizhu）
const firsts = {};     // 首字母修正：逐字首字母 != 词组首字母（如 白术 b|s → b|z）
let diffN = 0, firstDiff = 0;
for (const t of terms) {
  const whole = pyNoTone(t);
  if (!whole) continue;
  // 逐字单独调用 = C# 兜底路径（单字表查表）
  const perChar = [...t].map(c => pyNoTone(c)).join('');
  const perCharFirst = [...t].map(c => (pyNoTone(c) || ' ')[0] || '').join('');
  const firstLib = (pinyin(t, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }) || []).join('').toLowerCase();
  if (whole !== perChar) { words[t] = whole; diffN++; }
  if (firstLib !== perCharFirst) { firsts[t] = firstLib; firstDiff++; }
}

const payload = {
  _comment: [
    '本文件由 scripts/_dump_pinyin.js 自动生成，请勿手工编辑。',
    'chars：单字无声调全拼，按码位对齐、逗号分隔（空串=无读音），键为区间起始码位。',
    'words：词组全拼修正表（仅收录与逐字拼接不同的多音字词）。',
    'firsts：词组首字母修正表（仅收录与逐字首字母不同的词）。',
    '用途：替代 pinyin-pro，供 .NET 宿主 lib/kb.js(pyNoTone) 与 lib/tcm.js(westPyExpand) 的对等实现使用。',
  ],
  _generated: new Date().toISOString(),
  counts: { chars: charCount, words: diffN, firsts: firstDiff, terms: terms.size },
  chars,
  words,
  firsts,
};
const json = JSON.stringify(payload);
payload.sha256 = crypto.createHash('sha256').update(json).digest('hex');
fs.writeFileSync(OUT, JSON.stringify(payload));

console.log('单字表:', charCount, '字');
console.log('词条候选:', terms.size, '→ 多音字修正:', diffN, '条');
console.log('首字母修正:', firstDiff, '条');
console.log('产物:', OUT, Math.round(fs.statSync(OUT).size / 1024) + 'KB');
console.log('sha256:', payload.sha256.slice(0, 16));
