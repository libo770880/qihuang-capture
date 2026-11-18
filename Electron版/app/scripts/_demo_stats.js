// 为 demo-tcm.html 采集真实统计（只读，不改库）
// 用法：QHJF_USERDATA="<便携目录>" node scripts/_demo_stats.js
const path = require('path');
const fs = require('fs');
const UD = String(process.env.QHJF_USERDATA || '').trim()
  || path.join(process.env.APPDATA, '岐黄鉴方·悬浮采集助手');
const DB = require('../lib/db');
DB.initDb(UD);
const { initStore } = require('../lib/store');
const { initUserKb } = require('../lib/userkb');
const tcm = require('../lib/tcm');
const analyze = require('../lib/analyze');
const rxreview = require('../lib/rxreview');
try { initStore(UD); initUserKb(UD); } catch (e) { console.warn('init: ' + e.message); }

const out = { userData: UD };
out.records = DB.recCount();
out.kvKeys = DB.kvAll().map(x => x.k);
out.kbKinds = DB.kbKinds();

const recs = DB.recList() || [];
out.recTotal = recs.length;
const dept = {}, src = {};
let analyzed = 0, risky = 0, sumScore = 0, scored = 0;
const herbFreq = {};
const issueKind = {};
for (const r of recs) {
  if (r.dept) dept[r.dept] = (dept[r.dept] || 0) + 1;
  if (r.source) src[r.source] = (src[r.source] || 0) + 1;
  const t = r.tcm || (r.data && r.data.tcm);
  if (t && t.ok !== false && (t.diag || t.items)) analyzed++;
  const items = (t && t.items) || [];
  for (const it of items) {
    const k = (it.cat || '') + '/' + (it.type || '');
    if (it.level === 'error' || it.level === 'warn') issueKind[k] = (issueKind[k] || 0) + 1;
  }
  if (Array.isArray(t && t.herbs)) for (const h of t.herbs) {
    const n = h.name || h.n; if (n) herbFreq[n] = (herbFreq[n] || 0) + 1;
  }
  try {
    const rv = rxreview.reviewOne(r);
    if (rv && typeof rv.score === 'number') { sumScore += rv.score; scored++; if (rv.verdict !== '合理处方' && rv.cls !== 'ok') risky++; }
  } catch (e) { }
}
out.depts = Object.entries(dept).sort((a, b) => b[1] - a[1]);
out.sources = Object.entries(src).sort((a, b) => b[1] - a[1]);
out.analyzed = analyzed;
out.risky = risky;
out.avgScore = scored ? Math.round(sumScore / scored) : null;
out.issueKind = Object.entries(issueKind).sort((a, b) => b[1] - a[1]);
out.herbTop = Object.entries(herbFreq).sort((a, b) => b[1] - a[1]).slice(0, 12);

// 三类演示处方的推荐方剂（用于辨证分析页）
const DEMO = {
  shibafan: '制附子 10g（先煎） 法半夏 9g 炙甘草 10g 海藻 10g\n人参 9g 五灵脂 10g 干姜 6g 白术 12g',
  yibao: '阿胶 10g 鹿茸 3g 冬虫夏草 3g 西洋参 6g\n黄芪 30g 当归 12g 熟地黄 15g 白芍 12g 川芎 9g',
  redline: '石膏 150g 知母 15g 黄连 12g 黄芩 12g 黄柏 12g',
};
const DIAG = {
  shibafan: ['胃脘痛', '脾胃虚寒证'],
  yibao: ['月经不调', '气血两虚证'],
  redline: ['胸痹', '心血瘀阻证'],
};
out.tcm = {};
for (const [k, txt] of Object.entries(DEMO)) {
  const [diag, synd] = DIAG[k];
  try {
    const t = tcm.runTcm({ text: txt, keys: { "中医诊断": diag }, diagSynds: [synd] });
    out.tcm[k] = {
      match: t.match || t.ratio || null,
      recs: (t.recs || []).slice(0, 3).map(x => ({ name: x.name || x.title, kind: x.kind, score: x.score, 组成: (x.items || x.herbs || []).map(i => (i.name || i.n) + (i.dose ? i.dose : '')).join(' ') })),
    };
  } catch (e) { out.tcm[k] = { err: e.message }; }
}

// 知识库样例（附子 / 四逆汤 / 脾胃虚寒证）
function sample(kind, key) {
  try {
    const rows = DB.kbLoad(kind) || [];
    const hit = rows.find(x => JSON.stringify(x).includes(key));
    return hit || null;
  } catch (e) { return null; }
}
out.samples = {
  herb: sample('herb', '附子'),
  formula: sample('formula', '四逆汤'),
  diag: sample('diag', '脾胃虚寒'),
};

fs.writeFileSync(path.join(__dirname, '..', '.probe', 'demo-stats.json'), JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2).slice(0, 3200));
