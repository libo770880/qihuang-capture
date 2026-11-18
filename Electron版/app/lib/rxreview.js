// 处方点评（lib/rxreview.js）
// 定位：与 lib/tcm.js 的 buildRxReport 不同——那是「实时审方」（逐条风险项），
// 这里是「管理视角的处方点评」：按《医院处方点评管理规范（试行）》把处方判定为
// 合理 / 不合理，并把问题归入三类：
//   ① 不规范处方（书写缺项、剂量缺失、书写不清…）
//   ② 用药不适宜处方（适应证、遴选、用法用量、联合用药…）
//   ③ 超常处方（大处方、超疗程、无适应证用药、毒性药超限量…）
// 另有 cls='note'（配伍通过、医保支付、贵细药材等管理类提示），不计入合理性判定。
//
// 本模块为纯逻辑，不碰 IO、不碰数据库；C# 侧镜像见 net/QhjfCapture/Domain/RxReview.cs，
// 两侧必须逐字同源（对拍场景 chan_rx_review / chan_rx_review_ok）。

'use strict';

// ---------- 常量（两侧镜像，勿单边修改） ----------
// 需注明特殊煎法的有毒饮片：方中含之却无「先煎/久煎」标注，属安全隐患
const SPECIAL_DECOCT = [
  { n: '附子', r: '先煎 30-60 分钟至口尝无麻感' },
  { n: '川乌', r: '先煎久煎（一般先煎 1-2 小时）' },
  { n: '草乌', r: '先煎久煎（一般先煎 1-2 小时）' },
  { n: '天南星', r: '宜炮制后用，久煎' },
  { n: '白附子', r: '宜炮制后用，久煎' },
  // 半夏不入此表：临床用的是法半夏/姜半夏/清半夏等炮制品，常规汤剂无需注明先煎久煎；
  // 若为「生半夏」，buildRxReport 的 RAW_TOXIC「炮制核查」已单独命中。
  { n: '马钱子', r: '炮制后入丸散，不作汤剂常规用量' },
  { n: '雷公藤', r: '久煎 1-2 小时减毒' }
];
const RE_DECOCT = /先煎|久煎|久煮|先下|先入/;
// 贵细药材（管理类提示，不判不合理）
const PRECIOUS = ['麝香', '牛黄', '羚羊角', '穿山甲', '冬虫夏草', '燕窝', '海马', '西红花', '蛤蚧', '鹿茸', '紫河车', '血竭', '沉香', '檀香'];
// ---------- 评点红线（可在后台「点评红线」页签维护；未配置时取下列默认） ----------
// herbWarn/herbErr：味数红线（味）｜doseWarn/doseErr：单日剂量红线（g/味/日）
// jiWarn/jiErr：天数红线（剂）｜syndRateWarn/syndRateErr：辨证红线（方-证相符率下限 %）
// 各 on=false 时该类红线停用（不判该类问题）；syndMiss：缺证型时的级别（warn/error）
const DEFAULT_RULES = {
  herbOn: true, herbWarn: 20, herbErr: 28,
  doseOn: true, doseWarn: 60, doseErr: 120,
  jiOn: true, jiWarn: 7, jiErr: 14,
  syndOn: true, syndRateWarn: 30, syndRateErr: 15, syndMiss: 'warn'
};
/** 归一化红线配置：非法/越界值回落默认，保证两侧对拍确定性。 */
function normalizeRules(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const n = (v, def, min, max) => {
    // null / undefined / 空串视同「未配置」→ 回落默认（与 C# ClampNum 的 n == null ? def 对齐）
    const x = (v === null || v === undefined || String(v).trim() === '') ? NaN : Number(v);
    if (!isFinite(x)) return def;
    return Math.min(max, Math.max(min, x));
  };
  const on = (v) => v !== false;
  const o = {
    herbOn: on(r.herbOn),
    herbWarn: Math.round(n(r.herbWarn, DEFAULT_RULES.herbWarn, 1, 999)),
    herbErr: Math.round(n(r.herbErr, DEFAULT_RULES.herbErr, 1, 999)),
    doseOn: on(r.doseOn),
    doseWarn: n(r.doseWarn, DEFAULT_RULES.doseWarn, 1, 9999),
    doseErr: n(r.doseErr, DEFAULT_RULES.doseErr, 1, 9999),
    jiOn: on(r.jiOn),
    jiWarn: Math.round(n(r.jiWarn, DEFAULT_RULES.jiWarn, 1, 999)),
    jiErr: Math.round(n(r.jiErr, DEFAULT_RULES.jiErr, 1, 999)),
    syndOn: on(r.syndOn),
    syndRateWarn: Math.round(n(r.syndRateWarn, DEFAULT_RULES.syndRateWarn, 0, 100)),
    syndRateErr: Math.round(n(r.syndRateErr, DEFAULT_RULES.syndRateErr, 0, 100)),
    syndMiss: r.syndMiss === 'error' ? 'error' : 'warn'
  };
  // 阈值自洽：红线值不得宽于提醒值（率类方向相反：率越低越严重，从严阈值不得高于提醒阈值）
  if (o.herbErr < o.herbWarn) o.herbErr = o.herbWarn;
  if (o.doseErr < o.doseWarn) o.doseErr = o.doseWarn;
  if (o.jiErr < o.jiWarn) o.jiErr = o.jiWarn;
  if (o.syndRateErr > o.syndRateWarn) o.syndRateErr = o.syndRateWarn;
  return o;
}
/** 每日剂数：用法里「每日N剂」→ N，取不到按 1 剂/日。 */
function pickDailyJi(usage) {
  const m = String(usage || '').match(/(?:每\s*)?日\s*(\d+(?:\.\d+)?)\s*剂/);
  if (m) { const v = parseFloat(m[1]); if (isFinite(v) && v > 0) return v; }
  return 1;
}
/** 两位小数去浮点尾巴：60 → 60，12.5 → 12.5，20.000000000000004 → 20 */
function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

const CLS_LABEL = { irregular: '不规范处方', inappropriate: '用药不适宜处方', abnormal: '超常处方', note: '管理提示' };

// 排序键：两侧确定性（计数降序之外的兜底），勿用 localeCompare —— Node ICU 与 .NET 排序规则不同，会对拍出假差异
const CMP = (a, b) => { const x = String(a), y = String(b); return x < y ? -1 : (x > y ? 1 : 0); };

// 免责声明：点评结果供药师/点评小组复核参考，不替代医师处方决策（前后台都要展示）
// 文本收尾「疑似截断」判定的字符集合（两侧镜像）
const TAIL_CHARS = '、，,；;：:（）(';
const DISCLAIMER = '点评结果由规则引擎自动生成，供药师/点评小组复核参考，不替代医师处方决策。';

// ---------- 工具 ----------
function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function uniq(a) { return [...new Set((a || []).map(str).filter(Boolean))]; }

/** 剂数：优先「N味M剂」中的 M；其次（排除「每日N剂」后）的裸数。取不到返回 0。 */
function pickJi(text) {
  const t = str(text);
  if (!t) return 0;
  const cleared = t.replace(/(?:每\s*)?日\s*\d+\s*剂/g, '');
  let m = cleared.match(/味\s*(\d{1,3})\s*(?:剂|付|帖)/);
  if (m) return parseInt(m[1], 10) || 0;
  m = cleared.match(/(\d{1,3})\s*(?:剂|付|帖)(?!\s*[型量])/);
  if (m) return parseInt(m[1], 10) || 0;
  return 0;
}

/**
 * 已有风险项（tcm.rx.items）→ 点评三分类。返回 null 表示不计入合理性判定（管理类提示）。
 * 返回 { cls, level }，level 可能被提升（如配伍禁忌一律 error）。
 */
function classify(item) {
  const cat = str(item && item.cat);
  const tag = str(item && item.tag);
  const lv = str(item && item.level) || 'info';
  if (cat === '配伍禁忌') return { cls: 'inappropriate', level: 'error' };
  if (cat === '炮制核查') return { cls: 'inappropriate', level: 'error' };
  if (cat === '妊娠禁忌') return { cls: 'inappropriate', level: lv === 'info' ? 'info' : lv };
  if (cat === '妊娠提醒') return { cls: 'inappropriate', level: 'info' };
  if (cat === '用量核查') {
    if (tag === '未识别') return { cls: 'irregular', level: lv };
    if (tag === '外用') return null;                         // 外用豁免属管理类说明
    if (/超出常用限量/.test(str(item && item.title))) return { cls: 'abnormal', level: 'warn' }; // 毒性药超限量从严
    return { cls: 'inappropriate', level: lv };
  }
  if (cat === '配伍提醒') return { cls: 'inappropriate', level: lv };
  if (cat === '中西药联用') return { cls: 'inappropriate', level: lv };
  if (cat === '药数核对') return { cls: 'irregular', level: lv };
  if (cat === '诊断核对' || cat === '辨证核对') return { cls: 'inappropriate', level: lv };
  if (cat === '配伍核查' || cat === '医保提示') return null; // 「未检出错」通过项与医保管理类
  return null;
}

/**
 * 单处方点评。
 * @param {{tcm:object, text?:string, diag?:string, synd?:string, usage?:string, keys?:object}} ctx
 *        tcm 为 runTcm 的完整返回值；diag/synd/usage 缺失时从 tcm 兜底。
 * @returns {{ok:boolean, verdict:string, score:number, cats:object, levels:object, items:Array, stat:object, summary:string}}
 */
function reviewOne(ctx) {
  const o = ctx || {};
  const tcm = o.tcm || null;
  if (!tcm || tcm.ok === false) return { ok: false, error: '未识别到可点评的中医处方内容' };

  const text = str(o.text);
  const rx = tcm.rx || null;
  const items0 = Array.isArray(rx && rx.items) ? rx.items : [];
  const herbs = uniq(tcm.herbs);
  const doses = (tcm && tcm.herbDoses) || {};
  const miss = uniq(rx && rx.stat && rx.stat.miss);
  const usage = str(o.usage !== undefined && o.usage !== null ? o.usage : tcm.usage);
  const diagCheck = tcm.diagCheck || null;
  const diag = str(o.diag !== undefined && o.diag !== null ? o.diag : tcm.diag);
  let synd = str(o.synd);
  if (!synd && o.keys) synd = str(o.keys['证型']);
  const synds = uniq(tcm.synds);
  const hasRx = herbs.length > 0 || (Array.isArray(tcm.chosen) && tcm.chosen.length > 0);
  if (!hasRx) return { ok: false, error: '本条未识别到中药组成，无法点评' };

  const R = normalizeRules(o.rules);
  const dailyJi = pickDailyJi(usage);
  const items = [];
  const push = (cls, level, tag, title, detail, advice) => {
    items.push({ cls, clsLabel: CLS_LABEL[cls] || '', level, tag, title, detail: str(detail), advice: str(advice) });
  };

  // ---- ① 已有审方项归类 ----
  for (const it of items0) {
    const c = classify(it);
    if (!c) continue;
    if (c.level === 'info') continue;   // 管理类 info 不进点评项（保持点评表干净）
    push(c.cls, c.level, str(it.tag), str(it.title), str(it.detail), str(it.advice));
  }

  // ---- ② 不规范：书写缺项 ----
  // 诊断与证型全无时按「无适应证用药」（超常）单点立案，避免「缺诊断+缺证型+无适应证」三连重复计票
  const noIndication = !diag && !synd && !synds.length;
  if (!noIndication) {
    if (!diag) push('irregular', 'warn', '缺诊断', '处方未见中医诊断（病名）',
      '《中药处方格式及书写规范》要求处方须写明中医诊断，诊断是判定用药适宜性的前提。',
      '请补全中医诊断后重新点评。');
    if (!synd && !synds.length) push('irregular', (R.syndOn && R.syndMiss === 'error') ? 'error' : 'warn', '缺证型', '处方未见中医证型',
      '《中药处方格式及书写规范》要求「中医诊断」包含病名与证型（如：咳嗽·痰湿蕴肺证）。',
      '请补全证型，便于核对「理法方药」一致性。');
  }
  if (!usage) push('irregular', 'warn', '缺用法', '处方未标注用法用量（每日剂数 / 服法）',
    '给药途径、次数与给药途径不明，无法核查给药途径适宜性，也无法据外用规则豁免内服剂量核查。',
    '请补全用法用量后重新点评。');

  const noDose = herbs.filter(h => !doses[h]);
  if (noDose.length) push('irregular', 'warn', '缺剂量', `${noDose.length} 味药缺剂量：${noDose.slice(0, 8).join('、')}${noDose.length > 8 ? ' 等' : ''}`,
    '单味剂量缺失，无法核查用量适宜性与毒性药材限量。',
    '请核对原处方，补全剂量后重新点评。');

  // 未识别药名不再另立项：buildRxReport 已逐味给出「用量核查/未识别」，此处重复计票会让不规范数虚高

  const tail = text.replace(/\s+$/, '');
  // 原判定的实际语义就是「末字符 ∈ 该集合」，直接查表，避免两侧正则引擎对全角字符类的差异
  const tailC = tail.slice(-1);
  if (tail.length > 0 && TAIL_CHARS.indexOf(tailC) >= 0) push('irregular', 'warn', '疑似截断',
    `文本以「${tailC}」收尾，疑似抓取不完整`,
    '处方内容不全会导致漏评（缺或少味、用法识别不到）。',
    '请重新完整抓取该处方后点评。');

  // ---- ③ 不适宜：辨证红线（方-证相符率） / 特殊煎法 ----
  // 相符率 = 有直接支撑（病域/证型/症状证据）的药味占比；低于红线即判用药不适宜
  const supN = diagCheck ? Number(diagCheck.supN || 0) : 0;
  const totN = diagCheck ? Number(diagCheck.totN || 0) : 0;
  const rate = totN > 0 ? Math.round((supN * 1000) / totN) / 10 : null;   // 一位小数百分比
  if (R.syndOn && rate !== null) {
    const ev = `支撑证据 ${supN}/${totN} 味药与诊断/辨证相符（相符率 ${rate}%，红线 ${R.syndRateWarn}%）。`;
    if (rate < R.syndRateErr) {
      push('inappropriate', 'error', '方证不符',
        `方-证相符率 ${rate}%，低于辨证红线（${R.syndRateErr}%）：用药与诊断/辨证支撑不足`,
        ev, '请复核辨证是否准确、处方是否为随证化裁，并在病历中写明配伍依据。');
    } else if (rate < R.syndRateWarn) {
      push('inappropriate', 'warn', '方证不符',
        str(diagCheck && diagCheck.verdict) || `方-证相符率 ${rate}%，低于辨证红线（${R.syndRateWarn}%）`,
        ev, '建议核对诊断与辨证是否准确、处方是否为随证化裁，并在病历中写明配伍依据。');
    } else if (diagCheck && diagCheck.cross) {
      // 跨病域不再一律判不合理：方名为按组成反查推断时可能误配（实际用方不在库内），
      // 药味证据充足（相符率已过红线）时只作管理提示，不计入合理率；真正不符由上方相符率红线兜底。
      push('note', 'info', '适应证', str(diagCheck.verdict) || '方剂主治病域与诊断不同',
        ev, '建议核对选用方是否为库内方名的化裁，必要时在后台知识库补充该方。');
    }
  }
  const externalUsage = /外用|外敷|外洗|熏洗|坐浴|擦|涂|敷/.test(usage);
  const needDecoct = SPECIAL_DECOCT.filter(d => herbs.includes(d.n));
  if (needDecoct.length && !RE_DECOCT.test(text)) {
    push('inappropriate', externalUsage ? 'warn' : 'error', '特殊煎法',
      `${needDecoct.map(d => d.n).join('、')} 未标注先煎/久煎等特殊煎法`,
      needDecoct.map(d => `${d.n}：${d.r}`).join('；') + '。有毒饮片的减毒依赖规范煎法。',
      '请在处方注明特殊煎法并向患者交代清楚，必要时改为相应炮制品。');
  }

  // ---- ④ 超常：味数红线 / 单日剂量红线 / 天数红线 / 无适应证 ----
  // 剂数：医生手填（o.ji）优先——手填后天数红线/点评口径与前台指标条同源；否则按原文识别
  const ji = Number(o.ji) > 0 ? Math.round(Number(o.ji)) : pickJi(text);
  if (R.herbOn) {
    if (herbs.length >= R.herbErr) push('abnormal', 'error', '大处方',
      `本方 ${herbs.length} 味，超出味数红线（${R.herbErr} 味；提醒值 ${R.herbWarn} 味）`,
      '药味过多易致功效牵制、重复用药与不良反应风险上升，也不利于疗效判定。',
      '请精简组方，突出君药，必要时分主方与时方分期给药。');
    else if (herbs.length >= R.herbWarn) push('abnormal', 'warn', '大处方',
      `本方 ${herbs.length} 味，已达味数红线（${R.herbWarn} 味）`,
      '各机构对饮片味数规定不一，一般宜控制在 20 味以内。',
      '建议核查是否存在同类重复用药，适当精简。');
  }

  // 单日剂量红线：单味 g/剂 × 每日剂数，超过红线即判超剂量（外用方按外用豁免，不按内服量核查）
  const doseOver = [];
  if (R.doseOn && !externalUsage) {
    for (const h of herbs) {
      const d = doses[h];
      if (!d) continue;
      const unit = String(d.unit || '').toLowerCase();
      if (unit !== 'g' && unit !== '克') continue;   // 非重量单位（ml/粒/丸…）不按 g 红线计量
      const v = Number(d.val);
      if (!isFinite(v) || v <= 0) continue;
      const daily = round2(v * dailyJi);
      if (daily > R.doseErr) doseOver.push({ n: h, v: daily, lv: 'error' });
      else if (daily > R.doseWarn) doseOver.push({ n: h, v: daily, lv: 'warn' });
    }
  }
  const doseErrList = doseOver.filter(x => x.lv === 'error');
  const doseWarnList = doseOver.filter(x => x.lv === 'warn');
  const doseTxt = (arr) => arr.slice(0, 6).map(x => `${x.n} ${x.v}g/日`).join('、') + (arr.length > 6 ? ' 等' : '');
  if (doseErrList.length) push('abnormal', 'error', '超剂量',
    `${doseErrList.length} 味药单日剂量超红线（${R.doseErr} g/日）：${doseTxt(doseErrList)}`,
    `按用法「${usage || '未标注用法'}」折算每日 ${dailyJi} 剂；单味日剂量超过红线值 ${R.doseErr} g，属超剂量用药。`,
    '请核对是否为笔误（如单位错填），确有超大剂量用药指征请在病历中写明理由并签字。');
  else if (doseWarnList.length) push('abnormal', 'warn', '超剂量',
    `${doseWarnList.length} 味药单日剂量达提醒值（${R.doseWarn} g/日）：${doseTxt(doseWarnList)}`,
    `按用法「${usage || '未标注用法'}」折算每日 ${dailyJi} 剂；单味日剂量超过提醒值 ${R.doseWarn} g。`,
    '请复核剂量是否必要，矿物类/贝壳类与药食同源药味大剂量时关注不良反应与煎煮方法。');

  if (R.jiOn) {
    if (ji > R.jiErr) push('abnormal', 'error', '超疗程',
      `本次开具 ${ji} 剂，超出天数红线（${R.jiErr} 剂）`,
      '《处方管理办法》：处方一般不得超过 7 日用量，急诊一般 3 日；慢性病、老年病等特殊情况可适当延长，但医师应当注明理由。',
      '属慢性病长疗程请在处方注明理由；否则建议缩短至常规用量并复诊调方。');
    else if (ji > R.jiWarn) push('abnormal', 'warn', '超疗程',
      `本次开具 ${ji} 剂，超出常规 ${R.jiWarn} 日用量`,
      '《处方管理办法》：处方一般不得超过 7 日用量，急诊一般 3 日；慢性病、老年病等特殊情况可适当延长，但医师应当注明理由。',
      '属慢性病长疗程请在处方注明理由；否则建议缩短至常规用量并复诊调方。');
  }

  if (noIndication) push('abnormal', 'error', '无适应证',
    '开具中药处方但无任何中医诊断或证型记录，属无适应证用药',
    '无法证明用药具有明确适应证据链。',
    '请补全诊断与证型后重新点评；确为代茶饮/调理方请在病历写明理由。');

  // ---- ⑤ 管理类提示（不计入合理性） ----
  const preciousHit = herbs.filter(h => PRECIOUS.includes(h));
  if (preciousHit.length) push('note', 'info', '贵细药材',
    `含贵细药材 ${preciousHit.length} 味：${preciousHit.join('、')}`,
    '贵细药材请特别注意来源合法性与用量控制（濒危物种须有合法来源证明）。',
    '请确认已在处方中单列、单独计价并经患者知情同意。');
  if (externalUsage) push('note', 'info', '外用', `本方用法为外用：${usage}`,
    '外用处方不按内服常用量核查过量，但仍需注意浓度、面积与透皮吸收。', '');

  // ---- 结论 ----
  const judged = items.filter(i => i.cls !== 'note');
  const errorN = judged.filter(i => i.level === 'error').length;
  const warnN = judged.filter(i => i.level === 'warn').length;
  const cats = {
    irregular: judged.filter(i => i.cls === 'irregular').length,
    inappropriate: judged.filter(i => i.cls === 'inappropriate').length,
    abnormal: judged.filter(i => i.cls === 'abnormal').length
  };
  const verdict = (errorN + warnN) > 0 ? 'irrational' : 'reasonable';
  let score = 100 - errorN * 15 - warnN * 6;
  if (score < 0) score = 0;

  const clsList = [];
  if (cats.irregular) clsList.push(`不规范 ${cats.irregular} 条`);
  if (cats.inappropriate) clsList.push(`用药不适宜 ${cats.inappropriate} 条`);
  if (cats.abnormal) clsList.push(`超常 ${cats.abnormal} 条`);
  const summary = verdict === 'reasonable'
    ? `合理处方：${herbs.length} 味，未检出书写缺项、适宜性或超常问题（评分 ${score}）`
    : `不合理处方：${clsList.join('、')}（严重 ${errorN} 条 / 一般 ${warnN} 条，评分 ${score}）`;

  return {
    ok: true, verdict, verdictLabel: verdict === 'reasonable' ? '合理处方' : '不合理处方', score, summary,
    cats, levels: { error: errorN, warn: warnN },
    items,
    stat: {
      herbN: herbs.length, missN: miss.length,
      noDoseN: noDose.length, ji,
      diag, synd: synd || synds.join('、'),
      usage, external: externalUsage,
      rate: rate === null ? null : rate, dailyJi, doseOverN: doseOver.length,
      formulaN: (tcm.chosen || []).length,
      belongN: rx && rx.belong ? str(rx.belong.n) : '',
      belongBy: rx && rx.belong ? str(rx.belong.by) : ''
    },
    herbs,
    disclaimer: DISCLAIMER
  };
}

/**
 * 单处方点评的表格行摘要（批量汇总 / 导出用）。
 * 额外带出 tags（本行问题标签计数）与 herbs（药味清单）：后台「处方点评」页按月份/来源等
 * 条件筛选后要在前端重算「高频问题 / 用药频次 / 概览」，不能只看全量口径。
 */
function reviewRow(ctx) {
  const r = reviewOne(ctx);
  if (!r.ok) return null;
  const top = r.items.filter(i => i.cls !== 'note')[0];
  // 键序必须确定性：按 cls|tag 升序（JS 插入序与 .NET Dictionary 序不同，会出对拍差异）
  const tagMap = {};
  for (const it of r.items) {
    if (it.cls === 'note') continue;
    const key = it.cls + '|' + it.tag;
    const old = tagMap[key];
    if (old) old.n++;
    else tagMap[key] = { cls: it.cls, clsLabel: it.clsLabel, tag: it.tag, level: it.level, n: 1, sample: it.title };
  }
  const tags = Object.keys(tagMap).sort(CMP).map(k => tagMap[k]);
  return {
    verdict: r.verdict, verdictLabel: r.verdictLabel, score: r.score,
    irregular: r.cats.irregular, inappropriate: r.cats.inappropriate, abnormal: r.cats.abnormal,
    herbN: r.stat.herbN, ji: r.stat.ji, diag: r.stat.diag, synd: r.stat.synd,
    top: top ? `${top.level === 'error' ? '✕' : '！'}${top.tag}：${top.title}` : '—',
    tags, herbs: (r.herbs || []).slice()
  };
}

/**
 * 批量点评汇总（处方点评工作表口径）。
 * @param {Array<{tcm:object, text?:string, diag?:string, synd?:string, usage?:string, id?:string, ts?:string, source?:string}>} list
 */
function reviewBatch(list) {
  const src = Array.isArray(list) ? list : [];
  const rows = [];
  let total = 0, reasonableN = 0, irrationalN = 0, skippedN = 0;
  const catN = { irregular: 0, inappropriate: 0, abnormal: 0 };
  const problemMap = {}, herbMap = {};
  let scoreSum = 0;

  for (const it of src) {
    const r = reviewOne(it);
    if (!r.ok) { skippedN++; continue; }
    total++; scoreSum += r.score;
    if (r.verdict === 'reasonable') reasonableN++; else irrationalN++;
    catN.irregular += r.cats.irregular;
    catN.inappropriate += r.cats.inappropriate;
    catN.abnormal += r.cats.abnormal;
    for (const p of r.items) {
      if (p.cls === 'note') continue;
      const key = p.cls + '|' + p.tag;
      const old = problemMap[key] || { cls: p.cls, clsLabel: p.clsLabel, tag: p.tag, n: 0, level: p.level, sample: p.title };
      old.n++; problemMap[key] = old;
    }
    for (const h of r.herbs) herbMap[h] = (herbMap[h] || 0) + 1;
    rows.push(Object.assign({
      id: str(it.id), ts: str(it.ts), source: str(it.source), dept: str(it.dept)
    }, reviewRow(it) || {}));
  }

  // 排序必须两侧确定性：先计数降序，再按 UTF-16 码元序（勿用 localeCompare —— Node ICU 与 .NET 排序规则不同，会对拍出假差异）
  const cmp = CMP;
  const problemTop = Object.keys(problemMap).map(k => problemMap[k])
    .sort((a, b) => (b.n - a.n) || cmp(a.cls, b.cls) || cmp(a.tag, b.tag))
    .slice(0, 10);
  const herbTop = Object.keys(herbMap).map(k => ({ n: k, c: herbMap[k] }))
    .sort((a, b) => (b.c - a.c) || cmp(a.n, b.n))
    .slice(0, 10);
  const avgScore = total ? Math.round(scoreSum / total) : 0;

  return {
    ok: true, total, reasonableN, irrationalN, skippedN,
    rate: total ? Math.round((reasonableN * 1000) / total) / 10 : 0,  // 一位小数百分比
    catN, avgScore, problemTop, herbTop, rows, disclaimer: DISCLAIMER
  };
}

module.exports = { reviewOne, reviewRow, reviewBatch, pickJi, CLS_LABEL, DEFAULT_RULES, normalizeRules, pickDailyJi };
