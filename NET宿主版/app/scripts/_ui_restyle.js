/**
 * UI 现代化 · 硬编码色值批量替换（受控、可复跑）
 * ------------------------------------------------------------
 * 背景：renderer/ 各页 <style> 与 JS 模板里散落大量「米黄纸感」旧色，
 *           不可能逐一手改，也不能靠肉眼保证一致性，故集中在表里一次映射。
 *
 * 原则：
 *   1. 只替换「明确的旧值 → 新值」，不匹配的不动（宁可留白，不可误伤）。
 *   2. 禁止映射链：若某条的「新值」同时是别的「旧值」，脚本直接报错终止，
 *          否则替换结果会依赖遍历顺序，不可复现。
 *   3. 只处理 6 位 hex（3 位简写如 #eee 一律跳过，避免误命中）。
 *   4. 不触碰 renderer/theme.css —— 那是新设计系统的单一真相源。
 *
 * 用法：node scripts/_ui_restyle.js            （干跑，只统计）
 *           node scripts/_ui_restyle.js --apply（落盘）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PAGES = ['panel', 'admin', 'consult', 'ai', 'pastebox', 'photo'];

// ======================= 映射表：旧 → 新 =======================
const MAP = {
  // —— 品牌绿：旧墨绿偏暗黄 → 更通透的现代墨绿 ——
  '#2f5d3a': '#1d6f4b',   // --green
  '#1e3d27': '#123f28',   // --deep
  '#1d6b3a': '#16674a',
  '#4c7d3f': '#2f8f62',
  '#7fb069': '#4aa87a',
  '#4e6b3a': '#2f6a45',
  '#3f5730': '#245437',
  '#42582b': '#2f6a45',
  '#6f9050': '#3f7a52',
  '#2e7d43': '#17734a',
  '#2e6b46': '#16674a',
  '#4c9a5f': '#2f8f62',
  '#6fa584': '#4aa87a',

  // —— 中性面：米黄纸感 → 冷绿灰（本次换肤的主体） ——
  '#f6f3e9': '#f4f7f5',   // --bg
  '#e2dccb': '#dce5e0',   // --line
  '#eef2e3': '#e7f1eb',   // --soft
  '#eef0e3': '#e5ede9',   // --track
  '#f3f5e8': '#eef4f1',   // --hov
  '#fbfbf5': '#f8fbfa',   // --card2
  '#fdfcf7': '#fafcfb',
  '#eef3e0': '#e6f1ea',

  // —— 文字灰度 ——
  '#23311f': '#17241c',   // --ink
  '#313b26': '#17241c',
  '#26301c': '#17241c',
  '#6a7562': '#5d7067',   // --mut
  '#a2a493': '#93a49a',
  '#9a9c8a': '#93a49a',
  '#8a9276': '#849590',
  '#8a8d7c': '#849590',
  '#aebb9e': '#93a49a',
  '#5c6152': '#5d7067',
  '#6b7a5e': '#5d7067',
  '#333b30': '#2c3830',
  '#2c342a': '#2c3830',
  '#3d3a2e': '#2c3830',
  '#4a5646': '#4d6357',
  '#55604b': '#4d6357',
  '#444c40': '#37423a',
  '#565d4c': '#4d6357',

  // —— 边框 / 浅分隔面（暖黄 → 冷灰绿） ——
  '#e6e2d2': '#e5ede9',
  '#f0ecdd': '#eef4f1',
  '#e0d9c4': '#dce5e0',
  '#e6dfc8': '#dfe8e2',
  '#e8e2d0': '#e5ede9',
  '#eee7d4': '#eef4f1',
  '#e3dcc8': '#dfe8e2',
  '#eee8d5': '#eef4f1',
  '#efece0': '#eef4f1',
  '#e4e8d4': '#e5ede9',
  '#e3e7d2': '#e5ede9',
  '#cfd8c2': '#d3ded8',
  '#d5dcc3': '#d3ded8',
  '#d9d3c1': '#dae2db',
  '#d9dcc8': '#dce5e0',
  '#d8ddc6': '#d3ded8',
  '#d9e0c8': '#d3ded8',
  '#e3e9d6': '#e5ede9',
  '#e0d8bd': '#d8e2db',
  '#e0e0da': '#e5ede9',
  '#f0f4e8': '#eef4f1',
  '#f6f2e3': '#eef4f1',
  '#f0ebd8': '#eef4f1',
  '#e0d8bd': '#d8e2db',
  '#e5e0cc': '#dfe8e2',

  // —— 语义：警示暖色（保留暖意，提亮一档） ——
  '#b7791f': '#b9760f',   // --amber
  '#e2b563': '#e0b555',
  '#8a6d1f': '#8a6a15',
  '#9a6b12': '#94650f',
  '#96610d': '#8f5c0c',
  '#7a6a3c': '#7d6b3e',
  '#fdf1da': '#fbf2d9',
  '#fdf6e3': '#fdf8ea',
  '#fffaf0': '#fffcf5',
  '#fbf0d4': '#fbf3dd',
  '#ecdcae': '#f0dcb0',
  '#ecd9a8': '#f0dcb0',
  '#eadfae': '#f0dcb0',
  '#e0c98f': '#e6cf99',
  '#f7ecc8': '#faf0cf',
  '#f4efdb': '#faf5e6',
  '#fdfbf2': '#fdfaf3',
  '#e7d5a6': '#eed9ab',
  '#c5d6ab': '#b7ddc6',
  '#ffebd1': '#ffe8c8',

  // —— 语义：红系（禁忌 / 危险） ——
  '#b3372e': '#bf3a2f',   // --red
  '#c0392b': '#c53f33',
  '#b91c1c': '#bf3a2f',
  '#b23b31': '#bf3a2f',
  '#e89a91': '#e8a49c',
  '#fbe7e5': '#fdeceb',
  '#fdecea': '#fdeceb',
  '#fbe3df': '#fbe4e1',
  '#f3c3bf': '#f5cac5',
  '#f4c0d1': '#f7c8d5',
  '#e0b9b9': '#e8c4c0',
  '#a32d2d': '#bf3a2f',

  // —— 语义：粉（妊娠禁忌） ——
  '#993556': '#a03a5e',
  '#fbeaf0': '#fceef4',

  // —— 语义：蓝 / 紫（已是现代色，仅统一到同一套刻度） ——
  '#1d4ed8': '#2563eb',
  '#e2e8f0': '#e3e9f2',
  '#eaf1fd': '#eff5fe',
  '#24507f': '#2c6ca8',
  '#c3d6f5': '#c9ddf9',
  '#c9dcf5': '#c9ddf9',
  '#123a75': '#154a94',
  '#e6f1fb': '#eaf3fd',
  '#185fa5': '#1b5fae',
  '#b5d4f4': '#cbdff8',
  '#f6f8fb': '#f7fafc',
  '#d4dce6': '#dae2ec',
  '#5a3d92': '#5f3fa0',
  '#ddd6ee': '#ded9f2',
  '#d9d2ea': '#ded9f2',
  '#e6e2f5': '#eeebf9',
  '#f5f2fb': '#f7f5fc',
  '#8a7fb8': '#8b81bb',

  // —— 图表系列色（数据可视化统一到新刻度） ——
  '#5f6b7a': '#5d7067',
  '#8cc79a': '#86bf9e',
  '#9fc98a': '#7cc49a',
  '#9ab87a': '#7cc49a',
  '#9fbc9a': '#7cc49a',
  '#a9c4a5': '#86bf9e',
  '#a9d0b4': '#86bf9e',
  '#bcdcbf': '#8fd0a8',
  '#cfe0bc': '#c9e2d3',
  '#cfe0c4': '#c9e2d3',
  '#d9cda6': '#d6e3d8',
  '#4a3d20': '#33402f',
  '#8a6d2f': '#8a6a15',
  '#7d8272': '#849590',
  '#b9b291': '#93a49a',
  '#c0bbaa': '#a8b8ae',
  '#ccd0bf': '#c3d2c8',
  '#c6cab8': '#c3d2c8',
  '#b9bfa9': '#b3c4ba',
  '#9a9678': '#849590',
  '#a09a85': '#93a49a',
  '#a2a493': '#93a49a',
  '#8a9c7a': '#7ba487',
};

// ======================= 守卫：禁止映射链 / 自反 =======================
const problems = [];
const vals = new Set(Object.values(MAP));
for (const [k, v] of Object.entries(MAP)) {
  if (k === v) problems.push(`自反: ${k}`);
  if (MAP[v] !== undefined) problems.push(`链式: ${k} -> ${v} -> ${MAP[v]}`);
}
if (problems.length) {
  console.error('映射表非法，终止：\n' + problems.join('\n'));
  process.exit(1);
}

const apply = process.argv.includes('--apply');
let total = 0;
const perFile = [];

for (const p of PAGES) {
  const f = path.join('renderer', p + '.html');
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const hits = {};
  const out = src.replace(/#([0-9a-fA-F]{6})\b/g, (m, hex) => {
    const key = '#' + hex.toLowerCase();
    const to = MAP[key];
    if (!to) return m;                       // 不在表里 → 原样保留
    hits[key] = (hits[key] || 0) + 1;
    total++;
    return to;
  });
  if (src !== out) {
    perFile.push({ file: f, n: Object.values(hits).reduce((a, b) => a + b, 0), hits });
    if (apply) fs.writeFileSync(f, out);
  }
}

const verb = apply ? '已写入' : '干跑统计';
console.log(`${verb}：替换 ${total} 处，涉及 ${perFile.length} 个文件`);
for (const r of perFile) {
  console.log(`\n  ${r.file}  ${r.n} 处`);
  const top = Object.entries(r.hits).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [k, n] of top) console.log(`    ${k} -> ${MAP[k]}  x${n}`);
  if (Object.keys(r.hits).length > 12) console.log(`    …共 ${Object.keys(r.hits).length} 种`);
}
if (!apply) console.log('\n未落盘。确认无误后加 --apply 执行。');
