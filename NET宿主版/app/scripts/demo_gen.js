// 重新生成 demo-tcm.html：以真实引擎输出 + 新审方优先布局（处方→药味→合规→推荐独立区）
// 运行：node scripts/demo_gen.js
const path = require('path');
const fs = require('fs');
const { runTcm } = require(path.join(__dirname, '..', 'lib/tcm'));
const KB = require(path.join(__dirname, '..', 'lib/kb'));

// 中药映射（同 panel.html composeHtml）
const HERBS = {};
KB.getAllHerbs().forEach(h => { HERBS[h.n] = h; (h.aliases || []).forEach(a => { if (!HERBS[a]) HERBS[a] = h; }); });
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function composeHtml(cstr) {
  const s = String(cstr || '');
  const toks = s.split(/[、，,;；\n]+/).map(x => x.trim()).filter(Boolean);
  if (!toks.length) return esc(s);
  const cells = toks.map(tok => {
    const m = tok.match(/^([^\d]+)/);
    let name = m ? m[1] : tok;
    const nameClean = name.replace(/[（(][^）)]*[)）]/g, '').replace(/各$/,'').trim();
    const dose = nameClean ? tok.slice(name.indexOf(nameClean) + nameClean.length) : '';
    const h = nameClean ? HERBS[nameClean] : null;
    if (!h) return `<span class="ci na"><span class="cn">${esc(tok)}</span></span>`;
    const fx = String(h.fx || h.prop || '').replace(/\s+/g, ' ');
    const tip = (String(h.prop || '') + '｜' + String(h.fx || '')).replace(/"/g, '');
    return `<span class="ci" title="${esc(tip)}"><span class="cn">${esc(nameClean)}</span>${dose ? `<span class="cd">${esc(dose)}</span>` : ''}<span class="cx">${esc(fx.length > 16 ? fx.slice(0, 16) + '…' : fx)}</span></span>`;
  }).join('');
  return `<div class="cing">${cells}</div>`;
}
function formulaRows(f) {
  const rows = [];
  if (f.origin) rows.push(['出处', f.origin]);
  rows.push(['组成', composeHtml(f.c)], ['功效', f.g], ['主治', f.m], ['用法', f.u]);
  if (f.j) rows.push(['加减', f.j]);
  if (f.x) rows.push(['注意', f.x]);
  return rows;
}
function fCard(kind, name, badge, ctx, rows, patent) {
  const headL = kind === 'rec' ? '推荐方' : kind === 'guess' ? '疑似方（智能补全）' : '处方';
  const patB = patent ? '<span class="bdg pat">中成药</span>' : '';
  return `<div class="fcard ${kind}"><div class="fhd"><span class="fkind">${headL}</span><span class="fn">${esc(name)}</span>${patB}<div class="sp2"></div>${badge || ''}</div>
  ${ctx ? `<div class="fctx">${kind === 'chosen' ? '病历原文：' : kind === 'guess' ? '推断说明：' : ''}${esc(ctx)}</div>` : ''}
  ${rows.map(r => `<div class="fr"><span class="flb">${esc(r[0])}</span><span>${r[0] === '组成' ? r[1] : esc(r[1])}</span></div>`).join('')}</div>`;
}
function levelLbl(l) { return l === 'error' ? '需修改' : l === 'warn' ? '建议完善' : '提示'; }
function rxHtml(rx) {
  if (!rx || !rx.items || !rx.items.length) return '';
  const riskN = (rx.riskN || 0) + (rx.warnN || 0);
  const rows = rx.items.map(it => `<div class="it"><span class="dot ${it.level}"></span><div class="bd"><div class="a"><span class="lv ${it.level}">${levelLbl(it.level)}</span>${it.tag ? `<span class="tag-rx">${esc(it.tag)}</span>` : ''}${esc(it.title)}</div>${it.detail ? `<div class="d">${esc(it.detail)}</div>` : ''}${it.advice ? `<div class="v">✦ ${esc(it.advice)}</div>` : ''}</div></div>`).join('');
  return `<div class="rxs"><div class="rxh">处方合规分析${riskN ? `<span class="rxb w">${riskN} 项需关注</span>` : ''}</div>${rows}</div>`;
}
function herbCardsHtml(cards) {
  if (!cards || !cards.length) return '';
  return cards.map(h => `<div class="hcard"><div class="hn">${esc(h.n)}${h.tox ? '<span class="tox">毒性药</span>' : ''}${h.pre === 2 ? '<span class="tox">孕妇禁用</span>' : h.pre === 1 ? '<span class="tox">孕妇慎用</span>' : ''}</div>
  ${h.prop ? `<div class="hr"><b>药性</b>${esc(h.prop)}</div>` : ''}${h.fx ? `<div class="hr"><b>功效</b>${esc(h.fx)}</div>` : ''}${h.use ? `<div class="hr"><b>用法</b>${esc(h.use)}</div>` : ''}${h.note ? `<div class="hr"><b>注意</b>${esc(h.note)}</div>` : ''}</div>`).join('');
}
function disclaimerOf(t) { return (t && t.disclaimer) || ''; }
// 审方优先整块渲染（模拟 panel.html tcmReviewHtml + tcmRecsHtml）
function renderTcm(t, chips) {
  const body = [];
  (t.notes || []).forEach(n => body.push(`<div class="note">${esc(n)}</div>`));
  (t.chosen || []).forEach(c => {
    const f = c.f;
    let badge = '';
    if (c.okSynd === false) badge += '<span class="bdg bad">证-方不符 · 建议复核</span>';
    else if (c.okDiag === false) badge += '<span class="bdg bad">与诊断不符 · 建议复核</span>';
    if (c.okSynd === true || c.okDiag === true) badge += '<span class="bdg ok">与辨证相符</span>';
    body.push(fCard('chosen', f.n, badge, c.line, formulaRows(f), f.k === 'p'));
  });
  if (t.guess) {
    const g = t.guess;
    const missTxt = (g.miss && g.miss.length) ? `现方药味：${g.hit.join('、')}；与原方差异：缺 ${g.miss.join('、')}（或以代用品加减）`
      : (g.subHits && g.subHits.length) ? `现方药味 ${g.hit.concat(g.subHits.map(s => s.used)).join('、')} 与原方组成相符（${g.subHits.map(s => `「${s.orig}」以「${s.used}」替代`).join('、')}，属常规替换）`
      : `现方药味 ${g.hit.join('、')} 与原方组成吻合`;
    body.push(fCard('guess', g.f.n, '<span class="bdg rec">据组成推断</span>', missTxt, formulaRows(g.f)));
  }
  if ((t.herbs || []).length && t.type !== 'drugs') {
    body.push(`<div class="tsec">处方药味 · ${t.herbs.length}</div><div class="hchips">${t.herbs.map(h => `<span class="hchip">${esc(h)}</span>`).join('')}</div>`);
  }
  body.push(rxHtml(t.rx));
  if (t.type === 'drugs' && (t.herbCards || []).length) body.push(herbCardsHtml(t.herbCards));
  let recsBlock = '';
  if ((t.recs || []).length) {
    const cards = t.recs.map(c => {
      const bd = (c.by === 'diag'
        ? `<span class="bdg rec">按诊断「${esc(c.diag)}」推荐 · 匹配评分 ${c.score}</span>`
        : `<span class="bdg rec">按辨证「${esc(c.syndrome)}」推荐</span>`)
        + (c.top ? '<span class="bdg top">⭐ 首选</span>' : '');
      return fCard('rec', c.f.n, bd, '', formulaRows(c.f), c.f.k === 'p');
    }).join('');
    recsBlock = `<div class="tcm recs"><div class="tch"><span class="tt">推荐参考</span><span class="ts">${t.recs.length} 首 · 汤方在前</span></div>${cards}<div class="foot">${esc(disclaimerOf(t))}</div></div>`;
  }
  return `<div class="tcm"><div class="tch"><span class="tt">智能方剂分析</span><span class="ts">${esc(t.typeLabel || '')}</span>${(chips || []).map(c => `<span class="chip ${String(c).indexOf('⚠') === 0 ? 'chip-warn' : ''}">${esc(c)}</span>`).join('')}</div>${body.join('')}<div class="foot">${esc(disclaimerOf(t))}</div></div>${recsBlock}`;
}

const FOOT = '知识库与规则来自《中国药典》及规划教材《方剂学》《中药学》等公开权威资料，输出仅为辅助参考与合规自查，不构成临床诊断或处方结论；最终处方须由执业医师结合病情确定。';
const STYLE = `:root{--ink:#23311f;--mut:#6a7562;--line:#e2dccb;--card:#fff;--green:#2f5d3a;--deep:#1e3d27;--amber:#b7791f;--soft:#eef2e3;--bg:#f6f3e9}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:var(--bg);color:var(--ink);font-size:13px;padding:0 0 60px}
header{background:linear-gradient(100deg,var(--deep),var(--green));color:#eef3e0;padding:26px 40px}
header h1{font-family:KaiTi,serif;font-size:26px;letter-spacing:2px}
header p{font-size:12px;opacity:.8;margin-top:6px;line-height:1.7}
.wrap{max-width:980px;margin:0 auto;padding:22px 24px}
.sc{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:16px 0;box-shadow:0 2px 10px rgba(30,61,39,.05)}
.sc h2{font-size:16px;color:var(--deep);border-left:4px solid var(--amber);padding-left:10px}
.sd{font-size:12px;color:var(--mut);margin:6px 0 14px 14px;line-height:1.7}
.tcm{border:1px solid var(--line);border-radius:10px;background:var(--card);overflow:hidden}
.tcm.recs{margin-top:10px}
.tcm .tch{display:flex;align-items:center;gap:8px;padding:9px 14px;background:linear-gradient(90deg,#e7efe1,#f6f8ef);border-bottom:1px solid var(--line);flex-wrap:wrap}
.tcm .tch .tt{font-size:13px;font-weight:700;color:var(--deep);font-family:KaiTi,serif;letter-spacing:1px}
.tcm.recs .tch .tt{color:#6b7a5e}
.tcm .tch .ts{font-size:11px;color:var(--mut)}
.chip{font-size:10.5px;border-radius:10px;padding:1px 8px;background:#e3e9d6;color:#4a5a3c}
.chip.chip-warn{background:#fdeccd;color:#96610d}
.note{font-size:11.5px;background:#fdf8ec;border-bottom:1px solid #ecdcae;color:#6b5628;padding:6px 14px;line-height:1.7}
.tsec{font-size:11.5px;font-weight:600;color:var(--mut);margin:10px 14px 4px;letter-spacing:1px;border-left:3px solid var(--amber);padding-left:8px}
.fcard{border:1px solid #e3dcc8;border-radius:9px;margin:8px 12px 2px;background:#fdfcf7;overflow:hidden}
.fcard.rec{border-color:#cfe0c4;background:#f7faf1}
.fcard .fhd{display:flex;align-items:center;gap:8px;padding:8px 12px 6px;flex-wrap:wrap}
.fkind{font-size:10px;color:#7a6a3c;border:1px solid #d9cda6;border-radius:4px;padding:0 5px;line-height:15px}
.fcard.rec .fkind{color:#2e6b46;border-color:#a9d0b4;background:#eef6ea}
.fn{font-size:14px;font-weight:700;color:var(--deep);font-family:KaiTi,serif;letter-spacing:.5px}
.fcard .sp2{flex:1}
.bdg{font-size:10px;border-radius:4px;padding:1px 6px;background:#ecefe0;color:#4a5646}
.bdg.ok{background:#e2f2e4;color:#1d6b3a}
.bdg.bad{background:#fbe3df;color:#b3372e}
.bdg.rec{background:#fdf1da;color:#9a6b12}
.bdg.top{background:#efe9f7;color:#5b3d8f}
.bdg.pat{background:#fbeaf0;color:#993556}
.fctx{font-size:11px;color:#a09a85;padding:0 12px 4px}
.fr{display:flex;gap:8px;font-size:12px;line-height:1.75;color:#333b30;padding:1px 12px}
.fr .flb{flex:none;width:34px;color:var(--amber);font-weight:600}
.fcard .fr:last-child{padding-bottom:8px}
.cing{display:flex;flex-wrap:wrap;gap:4px 6px}
.cing .ci{display:inline-flex;align-items:baseline;gap:3px;background:#f4f1e2;border:1px solid #e6dfc8;border-radius:6px;padding:1px 7px;line-height:1.5}
.cing .ci .cn{font-weight:600;color:#4a3d20}
.cing .ci .cd{font-size:10.5px;color:#8a6d2f}
.cing .ci .cx{font-size:10.5px;color:#7d8272;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cing .ci.na{background:#f6f5ef;border-style:dashed}
.hchips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 14px 10px}
.hchip{font-size:11px;background:#eef2e3;border:1px solid #d9e0c8;border-radius:10px;padding:1px 9px;color:#3d4a34}
.hcard{border:1px solid #e3dcc8;border-radius:8px;margin:6px 12px;padding:8px 12px;background:#fdfcf7}
.hcard .hn{font-size:13px;font-weight:700;color:var(--deep);display:flex;gap:8px;align-items:center;margin-bottom:2px}
.hcard .tox{font-size:9.5px;background:#fbe7e5;color:#b3372e;border-radius:3px;padding:0 5px;line-height:14px}
.hcard .hr{font-size:12px;line-height:1.7;color:#333b30}
.hcard .hr b{display:inline-block;min-width:30px;color:var(--amber);font-weight:600}
.rxs{border-top:1px dashed #e6e2d2;margin-top:6px}
.rxh{font-size:12px;font-weight:600;color:var(--deep);padding:8px 14px 4px;display:flex;align-items:center;gap:8px}
.rxb{font-size:10.5px;border-radius:9px;padding:0 8px;line-height:16px}
.rxb.w{background:#fdeccd;color:#96610d}
.tag-rx{display:inline-block;font-size:10px;border-radius:4px;background:#eef0e3;color:#6a7562;padding:0 5px;line-height:15px;margin-right:5px}
.it{display:flex;gap:9px;padding:8px 14px;border-bottom:1px solid #f0ecdd}
.dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:6px}
.dot.error{background:#c93b30}.dot.warn{background:#d99a1f}.dot.info{background:#6fa584}
.it .bd{flex:1;min-width:0}
.lv{display:inline-block;font-size:10px;border-radius:4px;padding:0 5px;line-height:15px;margin-right:5px}
.lv.error{background:#fbe7e5;color:#b3372e}.lv.warn{background:#fdf1da;color:#9a6b12}.lv.info{background:#e8f3ea;color:#2e6b46}
.it .a{font-size:12.5px;color:#2c342a;font-weight:600;line-height:1.5}
.it .d{font-size:11.5px;color:#6a7562;line-height:1.6;margin-top:2px}
.it .v{font-size:11.5px;color:#1e5c3a;line-height:1.6;margin-top:2px}
.foot{font-size:10.5px;color:#9a9c8a;padding:6px 14px;line-height:1.6;border-top:1px dashed #e6e2d2}`;

// —— 五个演示场景（与真实引擎一致）——
const cases = [
  {
    h: '演示一 · 病历 · 证-方不符检出与病域推荐',
    d: '抓取病历页：辨证「痰湿内阻证」却开「血府逐瘀汤」——工具置顶展示处方并指出证-方不符，下方独立推荐区给出相符方剂（汤方在前、首选标星）',
    run: () => runTcm({ text: '中医诊断：眩晕病\n辨证：痰湿内阻证\n主诉：反复头晕3月，头重如裹。\n方药：血府逐瘀汤加减\n桃仁10g 红花10g 川芎6g', keys: { 中医诊断: '眩晕病', 证型: '痰湿内阻证' }, sections: [], diagSynds: ['痰湿内阻', '风痰上扰'] })
  },
  {
    h: '演示二 · 纯处方 · 智能补全与组成逐味解析',
    d: '只抓到方药区「半夏白术天麻汤加减 + 饮片明细」——处方置顶，组成逐味药展示功效说明，合规核查通过',
    run: () => runTcm({ text: '方药：半夏白术天麻汤加减\n法半夏9g 天麻10g 炒白术15g 茯苓15g 陈皮6g 炙甘草6g', keys: {}, sections: [] })
  },
  {
    h: '演示三 · 经典方替换药识别（人参↔党参）',
    d: '「党参12g」代替人参开四君子汤——识别为常规替换不误报缺味；若真缺味（如缺大枣）会如实标注',
    run: () => runTcm({ text: '党参12g、白术9g、茯苓9g、炙甘草6g', keys: {}, sections: [] })
  },
  {
    h: '演示四 · 处方 · 配伍禁忌拦截（十八反）',
    d: '同一处方含「制附子(先煎)」与「法半夏」——触发十八反高危拦截',
    run: () => runTcm({ text: '制附子(先煎)6g 法半夏9g 茯苓15g 陈皮6g', keys: {}, sections: [] })
  },
  {
    h: '演示五 · 中西药联用出血风险预警',
    d: '活血类中药与阿司匹林同用——提示出血风险并建议监测',
    run: () => runTcm({ text: '桃仁10g 红花10g 川芎6g\n西药：阿司匹林肠溶片 100mg qd', keys: {}, sections: [] })
  }
];

const sections = cases.map((c, i) => {
  const t = c.run();
  const chips = (t.chips || []).slice();
  return `<section class="sc"><h2>${esc(c.h)}</h2><p class="sd">${esc(c.d)}</p>${renderTcm(t, chips)}</section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>岐黄鉴方 · 智能方剂分析演示</title>
<style>
${STYLE}
</style></head><body>
<header><h1>岐黄鉴方 · 智能方剂分析</h1><p>悬浮采集 → 自动识别 → 审方优先：处方 / 组成逐味解析 / 处方合规分析 / 病历质控，推荐参考置底<br>知识库：中药 338 味（20 类分类 + 症状参考）· 方剂 179 首（含中成药 26）· 病域化推荐 · 本地离线规则引擎</p></header>
<div class="wrap">
${sections}
<div style="text-align:center;color:#a2a493;font-size:11px;margin-top:8px">—— 由采集工具内置引擎实际生成 ——</div></div>
</body></html>`;

const out = path.join(__dirname, '..', 'demo-tcm.html');
fs.writeFileSync(out, html);
console.log('written', out, html.length, 'chars');
