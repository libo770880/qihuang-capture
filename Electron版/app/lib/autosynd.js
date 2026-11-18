// lib/autosynd.js - 病历类截图自动辨证判定
// 判定截图内容是否「病历信息」，并尽可能直接给出证型诊断（诊断 + 证型 + 依据）：
//   证型来源优先级：① 文本/keys 中证型名命中（tcm.detectSyndromes，强）
//                  ② 症状库投票：命中症状的提示证型聚合，top 且 ≥2 票（弱）
//                  ③ 由方推证：命中方剂主治证型（最弱，标注可调整）
//   诊断来源：     ① 诊断库病名命中文本（强）
//                  ② 由证型反查含该证型的诊断（弱）
// 供 main.finalizeRecord 截图入库时调用；探针可直接 require 验证。
const tcm = require('./tcm');

// 证型名归一：detectSyndromes 返回不带「证」尾，与临床库（诊断/症状 syndromes）对齐
function normSynd(s, pool) {
  const raw = String(s || '').trim();
  if (!raw) return '';
  if (!pool || !pool.length) return raw;
  if (pool.includes(raw)) return raw;
  if (pool.includes(raw + '证')) return raw + '证';
  // 兼容「风寒袭肺」vs「风寒袭肺证」之外的轻微差异（包含关系）
  const hit = pool.find(p => p.includes(raw) || raw.includes(p));
  return hit || raw;
}

function judge(text, keys, diags, sxs) {
  const T = String(text || '');
  const K = keys || {};
  const diags2 = Array.isArray(diags) ? diags : [];
  const sxs2 = Array.isArray(sxs) ? sxs : [];

  // --- 诊断命中 ---
  const diagHits = diags2.filter(d => d && d.name && d.name.length >= 2 && T.includes(d.name)).map(d => d.name);

  // --- 证型：强来源（文本/keys 证型识别） ---
  const syndRaw = tcm.detectSyndromes(T, K);
  let synd = '', syndSrc = '', evidence = [];
  const pool = (() => {
    // 以命中诊断（或全部诊断）的证型集合为归一池
    const base = diagHits.length ? diags2.filter(d => diagHits.includes(d.name)) : diags2;
    const set = [];
    for (const d of base) for (const s of (d.syndromes || [])) if (!set.includes(s)) set.push(s);
    return set;
  })();
  if (syndRaw.length) {
    synd = normSynd(syndRaw[0], pool);
    syndSrc = 'text';
    const line = T.split('\n').find(l => l.includes(syndRaw[0])) || '';
    if (line) evidence.push('原文：' + line.trim().slice(0, 60));
    else if (K['证型']) evidence.push('辨证标注：' + K['证型']);
  }
  // 次强来源：HIS/病历已标注证型但未入 GB/T 证候库（如「痰瘀阳络证」这类自由证名）——
  // 库匹配不到不等于没有证型，直接采信标注（panel 显示为已定，来源与证据如实标注）
  if (!synd) {
    const kz = String(K['证型'] || '').trim().replace(/^[：:、，,；;]+|[，,。；;、]+$/g, '');
    if (kz && kz.length <= 30 && /[\u4e00-\u9fa5]/.test(kz)) {
      synd = normSynd(kz, pool);
      syndSrc = 'keys';
      evidence.push('标注证型：' + kz + '（未入证候库，按标注采信）');
    }
  }

  // --- 证型：弱来源（症状投票 + 证候要素启发消解并列） ---
  // 投票：命中症状的提示证型计数；要素：按证型名类别（风寒/风热/痰热…）匹配舌脉/痰/寒热特征词。
  // 排序 = 票数优先、要素命中消解并列；top 需领先（票数或要素分）才判定，避免武断。
  const votes = {};
  const voteEv = {};
  for (const sx of sxs2) {
    if (!sx || !sx.name || !T.includes(sx.name)) continue;
    for (const s of (sx.syndromes || [])) {
      votes[s] = (votes[s] || 0) + 1;
      (voteEv[s] = voteEv[s] || []).push(sx.name);
    }
  }
  const SYND_HINTS = [
    ['风寒', ['恶寒', '痰白', '清稀', '浮紧', '无汗', '遇寒', '怕冷']],
    ['风热', ['发热', '痰黄', '咽痛', '咽红', '舌尖红', '浮数', '口渴']],
    ['寒湿', ['畏寒', '白腻', '濡缓', '脘痞', '肢冷']],
    ['痰热', ['痰黄', '黄稠', '黄腻', '滑数', '气粗', '烦热']],
    ['痰湿', ['痰白', '白腻', '滑', '脘痞', '量多', '身重']],
    ['湿热', ['黄腻', '濡数', '口苦', '尿黄', '身热不扬']],
    ['阴虚', ['干咳', '少痰', '红少苔', '细数', '盗汗', '五心烦热', '口干']],
    ['气虚', ['乏力', '纳少', '便溏', '自汗', '气短', '神疲']],
    ['阳虚', ['畏寒', '肢冷', '淡胖', '沉迟', '夜尿']],
    ['血瘀', ['刺痛', '紫暗', '瘀斑', '涩']],
    ['肝火', ['易怒', '口苦', '胁肋', '目赤']],
    ['气滞', ['胀闷', '叹气', '胁胀', '弦']],
  ];
  function featOf(syndName, txt) {
    const hits = [];
    for (const [k, ws] of SYND_HINTS) {
      if (String(syndName).includes(k)) for (const w of ws) if (txt.includes(w)) hits.push(w);
    }
    return hits;
  }
  const ranked = Object.keys(votes).map(s => ({ s, v: votes[s], feat: featOf(s, T), ev: voteEv[s] }))
    .sort((a, b) => (b.v - a.v) || (b.feat.length - a.feat.length));
  if (!synd && ranked.length) {
    const top = ranked[0], second = ranked[1];
    const lead = !second || top.v > second.v || (top.v === second.v && top.feat.length > second.feat.length);
    if (top.v >= 1 && lead) {
      synd = normSynd(top.s, pool);
      syndSrc = 'symptom';
      evidence.push('症状佐证：' + top.ev.slice(0, 4).join('、') + '（提示' + synd + '）');
      if (top.feat.length) evidence.push('要素佐证：' + top.feat.slice(0, 4).join('、'));
    }
  }
  const candidates = ranked.slice(0, 3).map(r => ({ synd: normSynd(r.s, pool), votes: r.v, feats: r.feat.slice(0, 3), by: r.ev.slice(0, 4) }));

  // ③ 由方推证（最弱来源）：文本命中方剂名（如「补中益气汤加减」）且该方主治证型有定义
  //    → 主治证型与诊断证型池交集优先（同池说明诊断也支持），无交集取主治第一个；
  //    一律标注「由方剂主治推证」，提示可调整辨证（加减方主治≠本患者证型，弱推断供确认）
  if (!synd) {
    try {
      const fs = tcm.findFormulas(T) || [];
      for (const hit of fs) {
        const f = hit && hit.f;
        const ss = (f && Array.isArray(f.s)) ? f.s.filter(Boolean) : [];
        if (!ss.length) continue;
        const inter = ss.filter(s => pool.includes(s));
        synd = inter.length ? inter[0] : normSynd(ss[0], pool);
        syndSrc = 'formula';
        evidence.push('方剂主治推证：方「' + f.n + '」主治含' + synd + '（加减方主治≠必为本证，可调整）');
        break;
      }
    } catch (e) { /* 方剂库不可用不影响辨证 */ }
  }

  // --- 诊断：证型反查 ---
  let diag = diagHits[0] || '';
  let diagSrc = diagHits.length ? 'text' : '';
  if (!diag && synd) {
    const bySynd = diags2.find(d => (d.syndromes || []).includes(synd));
    if (bySynd) { diag = bySynd.name; diagSrc = 'synd'; evidence.push('据证型「' + synd + '」归属诊断'); }
  }

  // --- 病历判定 ---
  const markers = ['主诉', '现病史', '既往史', '舌', '脉', '辨证', '证型', '治法', '方药', '中医诊断', '西医诊断', '体格检查'];
  let mk = 0; for (const m of markers) if (T.includes(m)) mk++;
  const record = mk >= 2 || diagHits.length > 0 || !!synd;

  return { record, mk, diag, diagSrc, diagHits, synd, syndSrc, evidence, candidates };
}

module.exports = { judge, normSynd };
