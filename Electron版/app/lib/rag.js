// lib/rag.js - 岐黄鉴方 轻量知识检索（RAG 上下文抽取）
// 在 266 味中药 / 122 首方剂上建立扁平文档，对问句做中文二元组评分检索，
// 供 AI 问答/解读组装“本地知识库上下文”，无需外部向量库，零依赖离线可用。
const KB = require('./kb');

const STOP = new Set(['请问', '我想', '想问', '如何', '怎么', '什么', '哪些', '为什么', '可以', '一下', '治疗', '调理', '适合', '用', '吃', '服', '吗', '呢', '的', '了', '我', '你', '给', '帮', '推荐', '介绍', '说说', '是否', '怎样', '一个', '这个', '那个', '有', '没', '需要', '注意', '进行', '或者', '以及', '和', '与']);

function docs() {
  const out = [];
  const herbMap = KB.getHerbMap();
  const userHerbs = KB.getAllHerbs().filter(h => h.user);
  userHerbs.forEach(h => { if (!herbMap[h.n]) herbMap[h.n] = h; });
  KB.getAllHerbs().forEach(h => {
    out.push({
      kind: 'herb', name: h.n,
      aliases: h.aliases || [],
      text: [h.n, (h.aliases || []).join(' '), h.prop || '', h.fx || '', h.use || '',
        h.note || '', h.origin || '', h.indications || '', h.category || ''].join(' ')
    });
  });
  KB.getAllFormulas().forEach(f => {
    out.push({
      kind: 'formula', name: f.n,
      aliases: f.aka || [],
      text: [f.n, (f.aka || []).join(' '), (f.s || []).join(' '), f.c || '', f.g || '',
        f.m || '', f.u || '', f.j || '', f.origin || ''].join(' ')
    });
  });
  return out;
}

// 中文二元组
function bigrams(s) {
  const clean = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  if (clean.length === 1) out.add(clean);
  return out;
}

function cleanQuery(q) {
  return String(q || '').split(/[\s,，。.、；;:：?？!！()（）]+/)
    .map(w => w.trim()).filter(w => w && !STOP.has(w))
    .join(' ') || String(q || '');
}

function scoreDoc(d, qRaw, qBig) {
  const hay = d.text;
  let score = 0;
  const low = qRaw.toLowerCase();
  // 全名/别名精确命中权重最高（如“白术”“四君子汤”）
  if (d.name === qRaw) score += 500;
  else if (d.name.includes(qRaw)) score += 300;
  else if (qRaw.includes(d.name)) score += 220;
  for (const a of d.aliases) {
    if (a === qRaw) score += 420;
    else if (hay.includes(a) && qRaw.includes(a)) score += 120;
  }
  if (hay.includes(low)) score += 120;
  // 二元组共现
  let hit = 0;
  qBig.forEach((b) => { if (hay.includes(b)) hit += 1; });
  score += hit * 8;
  // 命中段越靠前分越高
  return { score, hit, head: hay.slice(0, 200) };
}

function search(q, k = 8) {
  const qRaw = cleanQuery(q);
  if (!qRaw) return [];
  const qBig = bigrams(qRaw);
  const pool = docs();
  const ranked = [];
  for (const d of pool) {
    const r = scoreDoc(d, qRaw, qBig);
    if (r.score <= 0) continue;
    ranked.push({ ...d, ...r });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, k).map(x => ({ kind: x.kind, name: x.name, score: x.score, head: x.head }));
}

function toContext(hits) {
  if (!hits || !hits.length) return '';
  return hits.map((h, i) => {
    const tag = h.kind === 'formula' ? '方剂' : '中药';
    return `[${i + 1}] ${tag}「${h.name}」${h.head || ''}`.replace(/\s+/g, ' ').slice(0, 220);
  }).join('\n');
}

module.exports = { search, toContext, cleanQuery };
