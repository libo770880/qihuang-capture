// lib/tcm.js - 岐黄鉴方「智能方剂分析」引擎
// 对抓取内容按类型输出：
//   1) 病历/诊断（含证型）→ 推荐适配方剂 + 核对病历选用方（证-方相符校验）
//   2) 单纯方剂/处方   → 方剂说明（组成/功效/主治/用法/加减/注意）或单味药说明
//   3) 含方药内容      → 处方合规：十八反/十九畏/毒性限量/生品毒药/妊娠/中西药联用
// 全部本地规则，输出为「辅助参考」，不构成诊断或处方结论。
const KB = require('./kb');
const Analyze = require('./analyze');
const RxMetric = require('./rxmetric');

const DISCLAIMER = '知识库与规则来自《中国药典》及规划教材《方剂学》《中药学》等公开权威资料，输出仅为辅助参考与合规自查，不构成临床诊断或处方结论；最终处方须由执业医师结合病情确定。';

// 运行时动态取库（支持后台导入后热刷新）
function allFormulas() { return KB.getAllFormulas(); }
function herbMap() { return KB.getHerbMap(); }
function canonMap() { return KB.getCanon(); }

// 证型标签全集（动态汇聚），按长度降序用于长键优先匹配
let _syndCache = null;
function allSyndromes() {
  if (_syndCache) return _syndCache;
  _syndCache = [...new Set(allFormulas().flatMap(f => f.s || []))].sort((a, b) => b.length - a.length);
  return _syndCache;
}

// 药名 token（规范名+别名，动态汇聚），长键优先；导入后经 invalidateCache 失效
let _tokenCache = null;
function getTokens() {
  if (_tokenCache) return _tokenCache;
  const set = new Set();
  for (const k of Object.keys(canonMap())) if (k.length >= 2) set.add(k);
  _tokenCache = [...set].sort((a, b) => b.length - a.length);
  return _tokenCache;
}

// 用户库更新后调用：丢弃证型/token 缓存
function invalidateCache() { _syndCache = null; _tokenCache = null; symVocabCache = null; herbTextCache = null; }

// 证型别名 → 规范证型（提升 OCR/口语化表达的匹配率）
const SYND_ALIAS = {
  '痰湿中阻': '痰湿内阻', '痰浊中阻': '痰湿内阻', '脾虚痰湿': '痰湿内阻',
  '风痰阻络': '风痰上扰', '痰浊上蒙': '风痰上扰', '风阳上扰': '肝阳上亢',
  '肝阳化风': '肝阳上亢', '肝风内动': '肝阳上亢', '阴虚阳亢': '肝阳上亢',
  '心血瘀阻': '气滞血瘀', '心脉瘀阻': '气滞血瘀', '瘀血阻络': '气滞血瘀',
  '瘀血内停': '气滞血瘀', '血瘀气滞': '气滞血瘀', '气虚络瘀': '气虚血瘀',
  '气阴不足': '气阴两虚', '气血不足': '气血两虚', '脾肾气虚': '脾气虚',
  '寒湿困脾': '湿滞脾胃', '湿热蕴结': '肝胆湿热', '肝郁化火': '肝火上炎',
  '肾气不固': '肾阳不足', '心肾阴虚': '心肾不交', '水湿内停': '阳虚水泛',
  '热毒内盛': '热毒痢疾', '湿热蕴肠': '湿热下利', '风热袭肺': '风热犯肺',
  '风寒束肺': '风寒袭肺', '风寒犯肺': '风寒袭肺', '肝气犯胃': '肝气郁结'
};

const RECORD_MARKERS = ['主诉', '现病史', '既往史', '舌', '脉', '辨证', '证型', '治法', '方药', '中医诊断', '西医诊断', '体格检查'];
const RX_HUOXUE = ['桃仁', '红花', '川芎', '丹参', '赤芍', '当归', '三七', '牛膝', '益母草', '水蛭', '莪术', '三棱', '蒲黄', '五灵脂', '乳香', '没药', '鸡血藤', '延胡索', '苏木', '血竭', '牡丹皮', '郁金', '姜黄', '西红花', '土鳖虫'];

// 临床常规替换药对（双向等价）：组成反查/缺味判定时视同命中，如「党参」代「人参」、
// 处方「(或党参12g)」等备选写法。仅收录教材/药典公认的可替代对，宁缺勿滥。
const SUBSTITUTES = [
  ['人参', '党参'],          // 补气：党参力缓，最常用替换
  ['犀角', '水牛角'],        // 药典现代替代（犀角禁用）
  ['金银花', '忍冬藤'],      // 同株异部，清热力近
  ['南沙参', '北沙参'],      // 养阴，侧重略异常互代
  ['川贝母', '浙贝母'],      // 止咳化痰，润/清侧重异但临床常互代
  ['太子参', '人参'],        // 补气：太子参气阴双补，儿科/肿瘤处方常代人参
  ['枳实', '枳壳'],          // 同源一物（酸橙幼果/近熟果），理气常互代
];
function subGroupOf(h) { const g = SUBSTITUTES.find(p => p.includes(h)); return g || null; }
// 两药是否等价（同药或互为常规替换）
function herbsMatch(a, b) { return a === b || !!(subGroupOf(a) && subGroupOf(a).includes(b)); }

// ---------- 工具 ----------
function clean(s) { return String(s || ''); }

// 在文本中扫描药名 token，返回去重叠后的命中 [{canon, raw, start, end, line}]
function scanHerbs(text) {
  const t = clean(text);
  const hits = [];
  const cm = canonMap();
  for (const tok of getTokens()) {
    let idx = t.indexOf(tok);
    while (idx !== -1) {
      hits.push({ canon: cm[tok], raw: tok, start: idx, end: idx + tok.length });
      idx = t.indexOf(tok, idx + tok.length);
    }
  }
  // 重叠保留最长
  hits.sort((a, b) => a.end - a.start === b.end - b.start ? a.start - b.start : (b.end - b.start) - (a.end - a.start));
  const picked = [];
  outer:
  for (const h of hits) {
    for (const p of picked) {
      if (h.start < p.end && h.end > p.start) continue outer; // 重叠，短者让位
    }
    picked.push(h);
  }
  picked.sort((a, b) => a.start - b.start);
  // 行归属
  const lines = t.split('\n');
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const next = off + lines[i].length + 1;
    for (const h of picked) {
      // 保留整行：截 80 字会把无换行长文本（HIS 粘贴常整段一行）后段药味的剂量全部截丢
      if (!h.lineIdx && h.start >= off && h.start < next) { h.lineIdx = i; h.lineText = lines[i]; }
    }
    off = next;
  }
  return picked;
}

// 提取某行的剂量 [value, unit]（取单位前的最后一个数，兼容 3-9g / 每日2次）
function doseInLine(lineText, fromIdx) {
  const seg = (lineText || '').slice(fromIdx, fromIdx + 30);
  const m = seg.match(/(\d+(?:\.\d+)?)\s*(g|克|钱|分|两|ml|毫升|mg|粒|片|丸|包|袋|支|剂|贴)/i);
  if (!m) return null;
  return { val: parseFloat(m[1]), unit: m[2].toLowerCase() };
}

// 从文本提取带剂量的处方项（仅捕获内容侧）
function extractRxItems(text) {
  const items = [];
  const hits = scanHerbs(text);
  const seen = new Set();
  const allLines = clean(text).split('\n');
  // 行起始偏移表：h.start 是全文索引，行内位置 = start - 行起始。不能用 lineText.indexOf(raw)
  // 取位置——同一行多个同名药（「冰片 10g 冰片 12g …」列式排版）时 indexOf 只会取首个位置，
  // 后面的药味全部错配第一味的剂量（2026-10-19 修复）。
  const lineStarts = [];
  { let off = 0; for (const l of allLines) { lineStarts.push(off); off += l.length + 1; } }
  for (const h of hits) {
    const key = h.canon + '@' + h.start;
    if (seen.has(key)) continue;
    seen.add(key);
    let dose = null;
    if (h.lineText) {
      const pos = (h.lineIdx != null && h.lineIdx >= 0 && h.lineIdx < lineStarts.length)
        ? Math.max(0, h.start - lineStarts[h.lineIdx])
        : h.lineText.indexOf(h.raw);
      if (pos >= 0) dose = doseInLine(h.lineText, pos + h.raw.length);
    }
    const flags = h.lineText
      ? ['先煎', '久煎', '后下', '包煎', '冲服', '烊化', '另煎', '打碎'].filter(f => h.lineText.includes(f))
      : [];
    items.push({ canon: h.canon, raw: h.raw, lineText: h.lineText || '', dose, flags, start: h.start, lineIdx: h.lineIdx == null ? -1 : h.lineIdx });
  }
  // 容错：行内带 g/克 剂量但药名未被识别（OCR 错字如「炙苜草」应为「炙甘草」）——
  // 剔除已识别药名后，对残片药名做编辑距离≤1 的唯一匹配；仍失败则标记 unknown 供合规提示
  const flagsAll = ['先煎', '久煎', '后下', '包煎', '冲服', '烊化', '另煎', '打碎'];
  for (let ln = 0; ln < allLines.length; ln++) {
    const rawLine = allLines[ln];
    let remain = rawLine;
    for (const h of scanHerbs(rawLine)) remain = remain.split(h.raw).join(' ');
    // 已识别药名剥离后残留「9g后下 9g包煎醋 6g包煎」：煎法注词必须一并剥掉，
    // 否则兜底正则会把「g后下」「包煎醋」「冲服」等残片当库外药名，合规页刷假未识别
    for (const f of flagsAll) remain = remain.split(f).join(' ');
    // 名字段排除 g/G/克——剂量单位残留不能充当药名首字（「g醋」「g酒」类假名）
    const re = /([^\s\d：:、，,gG克]+?)\s*(\d+(?:\.\d+)?)\s*((?:g|G|克))(?![a-z])/g;
    let m;
    while ((m = re.exec(remain)) !== null) {
      const name = m[1].replace(/[（(][^）)]*[)）]/g, '').replace(/各$/, '').trim();
      if (!name || name.length < 2 || name.length > 6) continue;
      const dose = { val: parseFloat(m[2]), unit: m[3].toLowerCase() };
      const flags = flagsAll.filter(f => rawLine.includes(f));
      const fc = fuzzyCanon(name);
      if (fc) items.push({ canon: fc, raw: name, lineText: rawLine.slice(0, 80), dose, flags, fuzzy: true, start: lineStarts[ln] + m.index, lineIdx: ln });
      else items.push({ canon: name, raw: name, lineText: rawLine.slice(0, 80), dose, flags, unknown: true, start: lineStarts[ln] + m.index, lineIdx: ln });
    }
  }
  // 跨行纯剂量行关联：HIS 多列排版被 OCR 逐行读出时药名行与剂量行分离（「半枝莲」\n…\n「12g」），
  // doseInLine 只认同行会误报缺剂量。与面板 parseRxRows 同语义：纯剂量行归给最近一条缺剂量的药味。
  applyPureDoseLines(items, allLines);
  // 列式排版剂量重配对（载体行 + 用法列伪药名行剂量按文档序回填真药味）
  return reflowColumnarDoses(items, allLines.join('\n'));
}

// 纯剂量行：整行只有一个「N g/克」（可有小数）
const PURE_DOSE_RE = /^(\d{1,4}(?:\.\d{1,2})?)\s*(?:g|G|克)$/;
/** 纯剂量行归并：按文档行序，把每条纯剂量行分给该行之前最近一条缺剂量的药味（镜像面板 parseRxRows） */
function applyPureDoseLines(items, lines) {
  if (!Array.isArray(items) || !items.length || !Array.isArray(lines)) return;
  const order = items.map((it, seq) => ({ it, seq, ln: (it && it.lineIdx != null) ? it.lineIdx : -1 }))
    .sort((a, b) => (a.ln - b.ln) || (a.seq - b.seq));
  for (let ln = 0; ln < lines.length; ln++) {
    const m = String(lines[ln] || '').trim().match(PURE_DOSE_RE);
    if (!m) continue;
    for (let i = order.length - 1; i >= 0; i--) {
      const o = order[i];
      if (o.ln >= 0 && o.ln < ln && o.it && !o.it.dose) {
        o.it.dose = { val: parseFloat(m[1]), unit: 'g' };
        break;
      }
    }
  }
}

// ---------- 列式排版剂量重配对（2026-10-19，21:40 泛化） ----------
// AI 视觉/OCR 把 HIS 处方表格按「列」读出：药名列成串（无剂量）、用法列「水煎内服」被误读成
// 某一药名（如「冰片」）并与单剂量列交错 → 剂量全部就近绑给伪药名，真药味全部缺剂量。
// 特征签名：同一药名带剂量出现 ≥2 次（载体行）且 ≥3 味药缺剂量。此时剂量来源有两类：
//   ① 载体行剂量（冰片 10g 冰片 12g…）；② 用法列伪药名行自带的剂量（水煎内服 10g / 日一剂 12g）。
// 两类按**文档序**统一排序后回填给缺剂量药味（混排时交错关系不能丢），载体行整行剔除。
// 与 Domain/Tcm.cs ReflowColumnarDoses、面板 parseRxRows 同源（对拍 chan_rx_column / chan_rx_column2）。
const USAGE_WORD_SRC = '(?:水煎内服|水煎服|水煎|煎服|内服|口服|外用|日一剂|每日一剂|日[0-9一二两三四五]+剂|每日[0-9一二两三四五]+剂|单剂用量|单剂量|每剂用量|用量|剂量|饮片)';
const USAGE_WORD_RE = new RegExp('^' + USAGE_WORD_SRC + '$');
function reflowColumnarDoses(items, text) {
  if (!Array.isArray(items) || items.length < 5) return items;
  const missing = items.filter(it => !(it && it.dose));
  if (missing.length < 3) return items;
  const cnt = {}; const ord = [];
  for (const it of items) {
    if (!(it && it.dose)) continue;
    const k = it.canon;
    if (!(k in cnt)) { cnt[k] = 0; ord.push(k); }
    cnt[k]++;
  }
  let carrier = null;
  let maxN = 1;
  for (const k of ord) { if (cnt[k] > maxN) { maxN = cnt[k]; carrier = k; } }
  if (!carrier) return items;
  // 载体剂量（带文档偏移）+ 用法伪药名行剂量（文本扫描）→ 按偏移排序
  const doses = items.filter(it => it && it.dose && it.canon === carrier)
    .map(it => ({ off: typeof it.start === 'number' ? it.start : 0, dose: it.dose }));
  if (text) {
    const lines = String(text).split('\n');
    const re = new RegExp('(' + USAGE_WORD_SRC + ')\\s*(\\d{1,4}(?:\\.\\d{1,2})?)\\s*(?:g|G|克)', 'g');
    let off = 0;
    for (const ln of lines) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(ln)) !== null) {
        // 载体行的剂量已由 items 带入；载体本身是用法/规格词时（饮片 10g 型），文本扫描再收会重复计数
        if (m[1] === carrier) continue;
        doses.push({ off: off + m.index, dose: { val: parseFloat(m[2]), unit: 'g' } });
      }
      off += ln.length + 1;
    }
  }
  doses.sort((a, b) => a.off - b.off);
  let di = 0;
  for (const it of items) {
    if (!(it && it.dose) && di < doses.length) { it.dose = doses[di].dose; di++; }
  }
  // 载体行整行剔除；未知药名兜底产出的用法伪药味（水煎内服/日一剂…）同为列式误读产物，一并剔除
  return items.filter(it => it.canon !== carrier && !USAGE_WORD_RE.test(it.canon));
}

// 未知药名容错：与已知药名（规范名/别名）编辑距离≤1 且唯一命中才采用，防误配
function fuzzyCanon(name) {
  const cm = canonMap();
  if (cm[name]) return cm[name];
  const n = String(name || '');
  if (!n || n.length < 3) return null;
  const cands = [];
  for (const k of Object.keys(cm)) {
    if (k.length !== n.length) continue;
    let diff = 0;
    for (let i = 0; i < k.length; i++) {
      if (k[i] !== n[i]) { diff++; if (diff > 1) break; }
    }
    if (diff === 1) cands.push(cm[k]);
  }
  const uniq = [...new Set(cands)];
  return uniq.length === 1 ? uniq[0] : null;
}

// 扫描一段组成文本中的药名（如方剂组成字段）
function scanComp(text) {
  return [...new Set(scanHerbs(text).map(h => h.canon))];
}

// ---------- 内容类型识别 ----------
function countRecordMarkers(text) {
  let n = 0;
  for (const mk of RECORD_MARKERS) if (text.includes(mk)) n++;
  return n;
}

// 证型识别（文本逐行 + keys），返回规范证型数组
function detectSyndromes(text, keys) {
  const found = [];
  const push = (s) => { if (s && !found.includes(s)) found.push(s); };
  const textKeys = clean(text);
  const kz = clean((keys && keys['证型']) || '');
  // 1) keys.证型 全串扫描
  for (const sy of allSyndromes()) { if (kz.includes(sy)) push(sy); }
  // 2) 全文本逐行扫描
  for (const line of textKeys.split('\n')) {
    if (!line.trim()) continue;
    // 别名先行（长键）
    for (const [a, c] of Object.entries(SYND_ALIAS).sort((x, y) => y[0].length - x[0].length)) {
      if (line.includes(a)) { push(c); break; }
    }
    for (const sy of allSyndromes()) {
      if (line.includes(sy)) { push(sy); break; }
    }
  }
  // 3) 单证候要素回退（如无标签行）：仅当文本含「辨证/证型/诊断」上下文
  if (!found.length && /辨证|证型|中医诊断/.test(textKeys)) {
    const m = textKeys.match(/(?:辨证|证型|中医诊断|证候)[:：]?\s*([^\n]{2,40})/);
    if (m) {
      const seg = m[1];
      for (const sy of allSyndromes()) { if (seg.includes(sy)) { push(sy); break; } }
    }
  }
  return found;
}

// 命中方剂（含别名），返回 [{f, name, matched, line}]
function findFormulas(text) {  const t = clean(text);
  const out = [];
  const sorted = [...allFormulas()].sort((a, b) => b.n.length - a.n.length);
  const used = new Set();
  for (const f of sorted) {
    if (used.has(f.n)) continue;
    // 守卫：无组成/功效/主治/用法的空壳条目（如误入方剂库的「诊断采集插入」数据）不参与方名匹配——
    // 防止 HIS「诊断：XX职工医保总费用…」这类含病名的划费行被误命中，生成假处方卡
    if (!(String(f.c || '').trim() || String(f.g || '').trim() || String(f.m || '').trim() || String(f.u || '').trim() || String(f.j || '').trim())) continue;
    const names = [f.n].concat(f.aka || []);
    for (const nm of names) {
      if (nm.length < 3) continue;
      if (t.includes(nm)) {
        const line = (t.split('\n').find(l => l.includes(nm)) || '').trim().slice(0, 80);
        out.push({ f, name: f.n, matched: nm, line });
        used.add(f.n);
        break;
      }
    }
  }
  return out;
}

// 组成反查：未捕获方名时，据药味集合推断处方最可能脱胎的方剂（加减化裁推断）
// 临床加减常在原方上增删数味，故门槛放宽：命中(含替代)>=3、缺味<=3、处方覆盖率>=0.35；
// 评分 = 原方覆盖×2 + 处方覆盖 + 经典方加分0.8（《伤寒论》《金匮要略》《温病条辨》等）+ 命中药数微调；
// 按得分/缺味少/方小排序，最多返回 2 个
const CLASSIC_ORIGIN_RE = /伤寒|金匮|温病|局方|内经|景岳|医宗|普济|脾胃论|内外伤|卫生宝鉴|儒门事亲/;
function guessByComposition(herbSet) {
  const out = [];
  for (const f of allFormulas()) {
    const comp = [...new Set(scanComp(f.c || ''))];
    if (!comp.length) continue;
    const hit = herbSet.filter(h => comp.includes(h));
    // 替换命中：处方用常规替换药替代原方药味（如党参代人参），不算缺味
    const subHits = [];
    for (const x of comp) {
      if (herbSet.includes(x)) continue;
      const used = herbSet.find(h => herbsMatch(h, x));
      if (used) subHits.push({ orig: x, used });
    }
    const hitAll = hit.length + subHits.length;
    if (hitAll < 3) continue;
    const missing = comp.length - hitAll;
    if (missing > 3) continue;
    const covRx = hitAll / herbSet.length;   // 处方中有多少药可被原方解释
    const covF = hitAll / comp.length;       // 原方被命中的比例
    // 准入三通道（满足其一）：
    //  1) 常规：处方覆盖率 >=0.35（小方/接近原方的加减）
    //  2) 成方全嵌套：原方几乎完整嵌入（hitAll>=4、缺<=1、covF>=0.8），如大复方中完整保留的二陈汤
    //  3) 大复方规则：>=14 药的复方（肿瘤/慢病），底方被大量加减稀释，放宽为 hitAll>=5、covF>=0.6、缺<=3
    if (covRx < 0.35 && !(hitAll >= 4 && missing <= 1 && covF >= 0.8) && !(herbSet.length >= 14 && hitAll >= 5 && covF >= 0.6 && missing <= 3)) continue;
    const classic = CLASSIC_ORIGIN_RE.test(f.origin || '');
    const score = covF * 2 + covRx + (classic ? 0.8 : 0) + hitAll * 0.02;
    out.push({ f, hit, subHits, miss: comp.filter(x => !herbSet.includes(x) && !herbSet.some(h => herbsMatch(h, x))), missing, inter: hitAll, compSize: comp.length, covRx, classic, score });
  }
  out.sort((a, b) => b.score - a.score || a.missing - b.missing || a.compSize - b.compSize);
  return out.slice(0, 2);
}

// 屏蔽文本中命中的方剂名区间，防止方名内药名被误当独立药味
function maskSpans(text, spans) {
  let out = String(text || '');
  const runs = spans.filter(s => s.end > s.start).sort((a, b) => b.start - a.start);
  for (const sp of runs) {
    const len = sp.end - sp.start;
    out = out.slice(0, sp.start) + '方'.repeat(len) + out.slice(sp.end);
  }
  return out;
}

// ---------- 诊断 → 方剂匹配（评分推荐 / 方-诊相符核对） ----------
// 证型标签归一：去「证」尾 + 常用别名映射（诊断库证型带「证」尾，方剂库不带）
function normSyndLabel(s) {
  const t = clean(s).trim().replace(/证$/, '');
  return SYND_ALIAS[t] || t;
}
// 从 keys 提取诊断名（去掉「病/证」尾便于主治文本包含匹配，如 咳嗽病→咳嗽）
function diagNameOf(keys) {
  const raw = clean(keys && keys['中医诊断']).trim();
  return raw.replace(/[病证]$/, '') || raw;
}
// 方剂与诊断匹配评分：主治含诊断 +4；功效含诊断 +1；主治证型 ∩ 诊断所属证型 +3/个
function scoreFormulaForDiag(f, diag, diagSynds) {
  let sc = 0;
  if (diag && diag.length >= 2 && clean(f.m).includes(diag)) sc += 4;
  if (diag && diag.length >= 2 && clean(f.g).includes(diag)) sc += 1;
  const fss = f.s || [];
  for (const sy of (diagSynds || [])) if (fss.includes(sy)) sc += 3;
  return sc;
}
// 方剂是否与诊断对应（须同病域；同域内证型命中或主治/功效含诊断名，无更细证据时同域即视为相符）
function formulaMatchesDiag(f, diag, diagSynds) {
  const dom = diagDomainOf(diag);
  if (dom && !formulaInDiagDomain(f, dom, diag)) return false; // 跨病域：证型同名也不算相符
  if ((diagSynds || []).length && (f.s || []).some(s => diagSynds.includes(s))) return true;
  if (diag && diag.length >= 2 && (clean(f.m).includes(diag) || clean(f.g).includes(diag))) return true;
  return !!dom; // 有病域约束时，同域即相符；无病域时须有证型/名称证据
}

// 诊断所属病域：推荐方主治须落在同域，防止「骨折气滞血瘀」推出速效救心丸等跨科药
const DIAG_DOMAINS = [
  { re: /骨折|跌打|损伤|扭伤|筋伤|脱位|脱臼|软组织|劳损/, kw: ['骨折', '跌打', '损伤', '扭伤', '筋伤', '脱位', '软组织', '劳损', '瘀肿', '续筋', '接骨', '伤科', '金疮', '正骨', '闪挫'] },
  { re: /胸痹|心痛|心绞痛|冠心病|心悸|怔忡|心肌缺血|心律失常/, kw: ['胸痹', '心痛', '心绞痛', '冠心病', '心悸', '怔忡', '胸闷', '胸痛', '心阳'] },
  { re: /咳嗽|咳喘|哮病|喘证|肺胀|感冒|肺痈|肺痿|支气管炎|肺炎|上呼吸道感染/, kw: ['咳嗽', '咳喘', '哮喘', '气喘', '感冒', '伤风', '肺', '止嗽', '宣肺', '止咳', '平喘'] },
  { re: /胃痛|胃脘痛|痞满|呕吐|呃逆|泄泻|腹泻|便秘|痢疾|胃炎|胃溃疡|十二指肠溃疡|肠炎/, kw: ['胃', '脘腹', '泄泻', '痢', '便秘', '呕吐', '呃逆', '痞', '脾胃', '肠'] },
  { re: /眩晕|头痛|中风|失眠|不寐|健忘|癫狂|痫|高血压|脑梗|脑梗塞|脑出血|脑血管/, kw: ['眩晕', '头痛', '中风', '失眠', '不寐', '健忘', '癫', '痫', '惊悸', '肝阳', '熄风', '平肝'] },
  { re: /痛经|月经|崩漏|带下|闭经|产后|不孕|癥瘕|恶露|盆腔炎|附件炎|子宫肌瘤/, kw: ['月经', '痛经', '崩漏', '带下', '闭经', '产后', '不孕', '癥', '瘕', '恶露'] },
  { re: /淋证|水肿|癃闭|尿血|遗尿|阳痿|遗精|精浊|尿路感染|泌尿系结石|前列腺/, kw: ['淋', '水肿', '癃闭', '小便', '尿', '遗精', '阳痿', '遗尿'] },
  { re: /痹|痛风|腰痛|痿|腰椎间盘突出|腰肌劳损|颈椎病|坐骨神经痛|关节炎/, kw: ['痹', '关节', '肢体', '麻木', '风湿', '腰', '痿', '筋脉'] },
  { re: /疮|痈|疔|疖|瘰|痔|瘿|乳癖|肠痈|阑尾炎|胆囊炎|胆结石/, kw: ['疮', '痈', '疔', '疖', '瘰疬', '痔', '瘿', '肿毒', '痈疽'] },
  { re: /咽|喉|乳蛾|口疮|耳鸣|耳聋|鼻|目|扁桃体炎|鼻窦炎|中耳炎/, kw: ['咽喉', '咽', '喉', '口疮', '耳鸣', '耳', '鼻', '目', '头痛'] },
  { re: /湿疹|瘾疹|粉刺|风瘙痒|蛇串疮|黧黑|白疕|荨麻疹|带状疱疹/, kw: ['湿疹', '瘾疹', '风疹', '粉刺', '瘙痒', '疮'] },
  { re: /消渴|糖尿病/, kw: ['消渴', '多饮', '多尿'] },
  { re: /黄疸|胁痛|积聚|臌胀/, kw: ['黄疸', '胁', '肝胆', '积', '臌胀'] }
];
// 诊断 → 病域关键词表（未收录的诊断返回 null，不做域约束）
function diagDomainOf(diag) {
  const d = String(diag || '');
  for (const g of DIAG_DOMAINS) if (g.re.test(d)) return g.kw;
  return null;
}
// 方剂主治/功效/主治证型是否落在诊断病域内
function formulaInDiagDomain(f, dom, diag) {
  if (!dom) return true;
  const text = clean(f.m) + ' ' + clean(f.g);
  if (diag && diag.length >= 2 && text.includes(diag)) return true;
  return dom.some(kw => text.includes(kw));
}

// ---------- 处方 × 诊断/病历 相符性核查（方-证-症状三级证据链） ----------
// 证型要素 → 功效证据关键词（顺序即优先级：具体要素在前）
const SYND_EVIDENCE = [
  [/血瘀|瘀血|瘀阻|瘀滞/, ['血瘀', '活血', '化瘀', '祛瘀', '逐瘀', '破血', '散瘀']],
  [/气滞|气郁/, ['气滞', '行气', '理气', '疏肝', '解郁', '破气']],
  [/风寒/, ['散寒', '祛风', '解表', '发散风寒', '辛温']],
  [/风热/, ['疏风', '疏散风热', '辛凉', '清热']],
  [/风痰|肝风|风/, ['祛风', '疏风', '息风', '熄风', '平肝']],
  [/湿热/, ['清热', '燥湿', '利湿', '化湿']],
  [/痰湿|痰浊|寒湿|水湿|湿/, ['燥湿', '化湿', '利湿', '渗湿', '祛湿', '胜湿', '健脾']],
  [/血虚|血亏/, ['补血', '养血', '活血']],
  [/阴虚|津亏/, ['滋阴', '养阴', '益阴', '生津', '润燥']],
  [/阳虚|阳衰|虚寒/, ['温阳', '助阳', '回阳', '温补', '补肾', '散寒']],
  [/气虚|气亏|气短/, ['益气', '补气', '健脾', '固表']],
  [/热|火|毒/, ['清热', '泻火', '凉血', '解毒']],
  [/痰/, ['化痰', '祛痰', '涤痰', '止咳']],
  [/寒/, ['散寒', '温中', '祛寒', '温经', '温']],
  [/肾/, ['补肾', '益肾', '滋肾', '固精', '温阳']],
  [/脾|胃/, ['健脾', '补脾', '和胃', '消食', '化湿', '温中']],
  [/肝/, ['疏肝', '平肝', '养肝', '清肝', '柔肝']],
  [/肺/, ['宣肺', '润肺', '清肺', '止咳', '化痰']],
  [/心/, ['养心', '清心', '安神', '补心', '通阳']]
];
function syndEvidenceKws(synd) {
  const s = String(synd || '');
  const out = [];
  for (const [re, kws] of SYND_EVIDENCE) if (re.test(s)) kws.forEach(k => { if (!out.includes(k)) out.push(k); });
  return out;
}
// 症状词表 + 药味证据文本（基于 getAllHerbs，含 sx/indications；懒加载缓存）
let symVocabCache = null, herbTextCache = null;
function symptomVocab() {
  if (symVocabCache) return symVocabCache;
  const set = new Set();
  for (const h of KB.getAllHerbs()) ((h && h.sx) || []).forEach(s => { const t = String(s).trim(); if (t.length >= 2) set.add(t); });
  symVocabCache = [...set].sort((a, b) => b.length - a.length);
  return symVocabCache;
}
function herbTextMap() {
  if (herbTextCache) return herbTextCache;
  const m = {};
  for (const h of KB.getAllHerbs()) {
    if (!h || !h.n) continue;
    m[h.n] = clean(h.fx) + ' ' + clean(h.indications) + ' ' + clean(h.prop) + ' ' + clean(h.note);
  }
  herbTextCache = m;
  return m;
}
function invalidateSymptomVocab() { symVocabCache = null; }

// 核查：处方药味 + 所选方剂 是否支撑 诊断(病域)/证型/病历症状
function rxDiagCheck({ herbs, f, diag, synds, diagSynds, recordText }) {
  const names = (herbs || []).filter(Boolean);
  if (!names.length) return null;
  if (!diag && !(synds && synds.length)) return null;
  const dom = diagDomainOf(diag);
  const evKws = [];
  [].concat(synds || [], diagSynds || []).forEach(s => syndEvidenceKws(s).forEach(k => { if (!evKws.includes(k)) evKws.push(k); }));
  // 病历症状提取（症状词表全名包含）
  const text = String(recordText || '');
  const recSyms = symptomVocab().filter(s => text.includes(s));
  // 逐味药支撑度
  const htx = herbTextMap();
  const support = [], neutral = [];
  for (const n of names) {
    const tx = htx[n] || '';
    let by = null;
    if (dom && dom.some(kw => tx.includes(kw))) by = '病域';
    if (!by && evKws.some(k => tx.includes(k))) by = '证型';
    if (!by && recSyms.some(s => tx.includes(s))) by = '症状';
    if (by) support.push({ n, by }); else neutral.push(n);
  }
  const ratio = names.length ? support.length / names.length : 0;
  // 症状覆盖（主治/功效 或 任一药味功效覆盖）
  const covered = recSyms.filter(s => {
    if (f && (clean(f.m) + ' ' + clean(f.g)).includes(s)) return true;
    return names.some(n => (htx[n] || '').includes(s));
  });
  const missed = recSyms.filter(s => !covered.includes(s));
  const fMatch = f ? formulaMatchesDiag(f, diag, diagSynds) : null;
  const cross = !!(f && dom && !formulaInDiagDomain(f, dom, diag));
  const syndHit = (synds && synds.length && f) ? f.s.some(s => synds.includes(s)) : null;
  let level;
  // 跨病域只作「软信号」：方名未能命中时按组成反查得到的方可能与实际用方不同（如黄芪建中汤→小建中汤），
  // 若药味证据本身充足（>=30%），不能仅凭方名主治跨域就判定方证不符；真正的不符由 ratio 红线兜底。
  if (ratio < 0.3) level = 'weak';
  else if (cross) level = 'partial';
  else if (ratio >= 0.6 || (fMatch && ratio >= 0.45) || syndHit === true) level = 'ok';
  else level = 'partial';
  const ctx = [diag ? `诊断「${diag}」` : '', (synds || []).length ? `辨证「${synds.join('、')}」` : ''].filter(Boolean).join('，');
  let verdict;
  if (level === 'ok') {
    verdict = `处方与${ctx}相符：${support.length}/${names.length} 药有直接支撑（${[...new Set(support.map(s => s.by))].join('/')}证据）` +
      (recSyms.length ? `；病历症状 ${recSyms.length} 项覆盖 ${covered.length} 项` : '') +
      (syndHit === true ? '；方剂主治证型与辨证吻合' : '');
  } else if (level === 'partial') {
    verdict = cross
      ? `处方与${ctx}基本相符：${support.length}/${names.length} 药有直接支撑，但所选方剂主治病域与诊断不同，可能为随证化裁或方名识别偏差，建议核对选用方` +
        (recSyms.length ? `；症状覆盖 ${covered.length}/${recSyms.length}` : '')
      : `处方与${ctx}基本相符：${support.length}/${names.length} 药有直接支撑，其余多为调和/佐使或兼治用药，建议结合病案核对配伍意图` +
        (recSyms.length ? `；症状覆盖 ${covered.length}/${recSyms.length}` : '');
  } else {
    const evTxt = missed.length ? `，症状「${missed.slice(0, 4).join('、')}」未见覆盖` : '';
    verdict = `处方与${ctx}对应性弱：仅 ${support.length}/${names.length} 药有支撑证据${evTxt}，建议复核诊断/辨证或调整处方`;
  }
  return {
    level, verdict, ratio: Math.round(ratio * 100) / 100,
    supN: support.length, totN: names.length,
    support, neutral,
    diag: diag || '', synds: synds || [],
    symTotal: recSyms.length, symCovered: covered, symMissed: missed,
    fMatch, cross
  };
}

// 常见西医病名 → 中医病名直配（内置兜底；后台「西医对照」库可增删，运行时合并）
// 库条目为字符串包含匹配（如 west:「糖尿病」 命中「2型糖尿病」）
const BUILTIN_WEST_MAP = [
  ['糖尿病', '消渴'], ['高血压', '眩晕'], ['冠心病', '胸痹'], ['心绞痛', '胸痹'],
  ['心肌缺血', '胸痹'], ['心律失常', '心悸'], ['胃炎', '胃痛'], ['胃溃疡', '胃痛'],
  ['十二指肠溃疡', '胃痛'], ['支气管炎', '咳嗽'], ['肺炎', '咳嗽'], ['上呼吸道感染', '感冒'],
  ['腰椎间盘突出', '腰痛'], ['腰肌劳损', '腰痛'], ['脑梗死', '中风'], ['脑梗塞', '中风'],
  ['脑出血', '中风'], ['脑血管意外', '中风'], ['尿路感染', '淋证'], ['泌尿系结石', '淋证'],
  ['肾结石', '淋证'], ['输尿管结石', '淋证'], ['膀胱炎', '淋证'], ['阑尾炎', '肠痈'],
  ['盆腔炎', '痛经'], ['附件炎', '痛经'], ['子宫肌瘤', '癥瘕'], ['前列腺增生', '精浊'],
  ['前列腺炎', '精浊'], ['颈椎病', '痹证'], ['类风湿', '痹证'], ['风湿性关节炎', '痹证'],
  ['骨性关节炎', '痹证'], ['骨关节炎', '痹证'], ['坐骨神经痛', '痹证'], ['失眠', '不寐'],
  ['神经衰弱', '不寐'], ['便秘', '便秘'], ['腹泻', '泄泻'], ['结肠炎', '泄泻'],
  ['带状疱疹', '蛇串疮'], ['湿疹', '湿疹'], ['荨麻疹', '瘾疹'], ['扁桃体炎', '乳蛾'],
  ['鼻炎', '鼻渊'], ['鼻窦炎', '鼻渊'], ['中耳炎', '耳鸣'], ['胆囊炎', '胁痛'],
  ['胆结石', '胁痛'], ['胆石症', '胁痛'], ['乳腺增生', '乳癖'], ['痛风', '痛风'],
  ['月经不调', '月经不调'], ['功能失调性子宫出血', '崩漏'], ['贫血', '血虚'], ['骨质疏松', '骨痿']
];
// 用户/后台维护的中药医保规则库（knowledge/yibao.json），处方报告医保支付提示用
let YIBAO_RULES = [];
let YIBAO_BY_NAME = {}; // 正名 → 规则（单味药说明卡医保徽章用）
function setYibaoRules(list) {
  YIBAO_RULES = (list || []).filter(r => r && r.name).map(r => ({
    name: String(r.name).trim(),
    code: String(r.code || '').trim(),
    payType: String(r.payType || '').trim(),
    limit: String(r.limit || '').trim(),
    copay: String(r.copay || '').trim(),
    note: String(r.note || '').trim()
  }));
  YIBAO_BY_NAME = {};
  for (const r of YIBAO_RULES) if (!YIBAO_BY_NAME[r.name]) YIBAO_BY_NAME[r.name] = r;
  return YIBAO_RULES.length;
}

// 用户/后台维护的西医对照（来自辨证库 westmap.json），后加载优先生效
let USER_WEST_MAP = [];
function setWestMap(list) {
  USER_WEST_MAP = [];
  for (const it of (list || [])) {
    const west = String((it && (it.west || it.w)) || '').trim();
    const tcm = String((it && (it.tcm || it.r)) || '').trim();
    if (west && tcm) USER_WEST_MAP.push([west, tcm]);
  }
  _westPyIdx = null; // 西医词表变化后拼音索引失效
  return USER_WEST_MAP.length;
}

// 西医词拼音索引（懒加载 pinyin-pro；主进程 CJS 直接可用）
let _pyLib = null;
function pyLib() { if (_pyLib === null) { try { _pyLib = require('pinyin-pro').pinyin; } catch (e) { _pyLib = false; } } return _pyLib; }
let _westPyIdx = null;
// 输入为纯字母时按西医词表全拼/首字母展开为中文西医诊断名（如 tnb→糖尿病、gxy→高血压）
function westPyExpand(west) {
  const w = String(west || '').trim();
  if (!/^[a-z]+$/i.test(w)) return [w];
  const py = pyLib();
  if (!py) return [w];
  if (!_westPyIdx) {
    _westPyIdx = allWestMaps().map(function (pair) {
      const k = pair[0];
      return {
        k: k,
        py: py(k, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase(),
        py0: py(k, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase()
      };
    });
  }
  const kw = w.toLowerCase();
  const hits = _westPyIdx.filter(function (x) { return (x.py && x.py.indexOf(kw) !== -1) || (x.py0 && x.py0.indexOf(kw) !== -1); }).map(function (x) { return x.k; });
  return hits.length ? hits.slice(0, 4) : [w];
}
function allWestMaps() { return USER_WEST_MAP.concat(BUILTIN_WEST_MAP); }

// 西医诊断 → 中医诊断候选（评分排序）：名称互含 + 直配表 + 同病域
function westTcmCandidatesRaw(west, diagNames) {
  const w = String(west || '').trim();
  if (!w || !Array.isArray(diagNames)) return [];
  const dom = diagDomainOf(w);
  const boost = new Set();
  for (const [wkey, tcm] of allWestMaps()) if (w.includes(wkey)) boost.add(tcm);
  const scored = [];
  for (const name of diagNames) {
    if (!name) continue;
    let sc = 0;
    if (name === w) sc += 10;
    else if (w.includes(name) || name.includes(w)) sc += 6;
    if (boost.has(name)) sc += 4;
    const tdom = diagDomainOf(name);
    if (dom != null && tdom != null && tdom === dom) sc += 3;
    if (sc > 0) scored.push({ name, sc });
  }
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, 8).map(x => x.name);
}
// 对外入口：支持拼音/首字母输入（纯字母时先展开为中文西医词再逐个求候选，去重合并）
function westTcmCandidates(west, diagNames) {
  const wlist = westPyExpand(west);
  if (wlist.length === 1 && wlist[0] === String(west || '').trim()) return westTcmCandidatesRaw(west, diagNames);
  const merged = [], seen = new Set();
  for (const w of wlist) {
    for (const name of westTcmCandidatesRaw(w, diagNames)) {
      if (!seen.has(name)) { seen.add(name); merged.push(name); }
    }
  }
  return merged;
}

// 方剂对象 → 展示行
function formulaRows(f) {
  const rows = [['组成', f.c], ['功效', f.g], ['主治', f.m], ['用法', f.u]];
  if (f.j) rows.push(['加减', f.j]);
  if (f.x) rows.push(['注意', f.x]);
  return rows;
}

// ---------- 处方合规 ----------
function buildRxReport({ text, captureItems, compHerbs, usage }) {
  const known = captureItems.filter(i => !i.unknown);
  const union = [...new Set([...known.map(i => i.canon), ...compHerbs])];
  const items = [];
  const hitDesc = (set) => union.filter(h => set.includes(h));

  // 配伍禁忌：十八反 + 十九畏 + 机构自定义规则（KB.getAllIncompat 统一合并，#47）
  for (const g of KB.getAllIncompat()) {
    const ha = hitDesc(g.A), hb = hitDesc(g.B);
    if (ha.length && hb.length) {
      const isUser = !!g.user;
      items.push({
        level: 'error', cat: '配伍禁忌', tag: g.kind || (isUser ? '自定义' : '十八反'),
        title: `${g.kind || '配伍禁忌'}：${ha.join('、')} 与 ${hb.join('、')} 同用（${g.v}）`,
        detail: g.user
          ? `机构自定义配伍禁忌规则：${g.v}。请核对处方是否符合本机构用药规定。`
          : (g.kind === '十九畏'
            ? g.v + '。传统列为配伍禁忌，现代临床多避免同用。'
            : '《中国药典》将上述药物列为「不宜同用」。少数古方（如附子粳米汤等）有特殊合用先例，属特殊情况，须由经验医师斟酌并充分知情。'),
        advice: '请复核处方来源与配伍依据，必要时拆分或替换其中药物，避免风险。'
      });
    }
  }
  // 医保支付提示：机构维护的中药医保规则库（自费→warn / 乙类丙类→info / 限定支付→info）
  if (YIBAO_RULES.length) {
    const ybHits = YIBAO_RULES.filter(r => union.includes(r.name));
    const grp = (t) => ybHits.filter(r => r.payType === t);
    const self = grp('自费'), yi = grp('乙类'), bing = grp('丙类');
    if (self.length) items.push({
      level: 'warn', cat: '医保提示', tag: '自费',
      title: `自费 ${self.length} 药：${self.map(r => r.name).join('、')}`,
      detail: '规则库标注为「自费」，医保基金不予支付，需患者知情同意并自费结算。' + self.map(r => r.note ? `${r.name}：${r.note}` : '').filter(Boolean).join('；'),
      advice: '如需医保结算，请核对是否有可替代的医保目录内药物。'
    });
    if (yi.length || bing.length) items.push({
      level: 'info', cat: '医保提示', tag: '乙类/丙类',
      title: `乙类 ${yi.length} 药、丙类 ${bing.length} 药（部分自付）`,
      detail: [yi.length ? `乙类：${yi.map(r => r.copay ? `${r.name}(自付${r.copay}%)` : r.name).join('、')}` : '',
               bing.length ? `丙类：${bing.map(r => r.name).join('、')}` : ''].filter(Boolean).join('；'),
      advice: '乙类/丙类药品个人需按比例先行自付，收费前请向患者说明。'
    });
    // 限定支付按「限定内容相同」分组合并——同组一条提示，避免逐味刷屏
    const limited = ybHits.filter(r => r.limit);
    const byLimit = {};
    for (const r of limited) {
      const key = r.limit;
      (byLimit[key] = byLimit[key] || []).push(r);
    }
    for (const [limit, rs] of Object.entries(byLimit)) {
      items.push({
        level: 'info', cat: '医保提示', tag: '限定支付',
        title: rs.length > 1
          ? `${rs.map(r => r.name).join('、')} ${rs.length} 药为医保限定支付药`
          : `${rs[0].name} 为医保限定支付药`,
        detail: `限定支付范围：${limit}`,
        advice: '超出限定范围使用时医保基金不予支付，请核对适应证并在病历中留痕。'
      });
    }
  }
  // 毒性药材限量 + 常用药量上限（仅对带剂量的捕获项）。
  // 外用给药例外：药典常用量为内服量，外用一般标注「适量」——超内服上限的药不再逐味告警，
  // 合并为一条 info（剂量事实仍要告知，但不能按内服口径吓人）。
  const external = Analyze.isExternalUsage(usage);
  const overList = [];
  for (const it of captureItems) {
    if (!it.dose || !/^(g|克)$/.test(it.dose.unit)) continue;
    for (const rule of KB.TOX_LIMITS) {
      if (!rule.names.includes(it.canon)) continue;
      if (it.dose.val > rule.max) {
        if (external) { overList.push(`${it.canon} ${it.dose.val}${it.dose.unit}`); continue; }
        const toxSrc = it.raw && it.raw !== it.canon ? `；原文「${it.raw}」已识别为「${it.canon}」，请核对。` : '';
        items.push({
          level: 'warn', cat: '用量核查', tag: it.canon,
          title: `${it.canon} ${it.dose.val}${it.dose.unit} 超出常用限量`,
          detail: rule.note + toxSrc + (it.flags.length ? `；该行注明「${it.flags.join('、')}」。` : ''),
          advice: '毒性/小毒药物宜严格按药典剂量，超量须由高年资医师把关。'
        });
      }
    }
    for (const rule of KB.DOSE_LIMITS) {
      if (!rule.names.includes(it.canon)) continue;
      if (it.dose.val > rule.max) {        if (external) {
          const dup = overList.some(s => s.startsWith(it.canon + ' '));
          if (!dup) overList.push(`${it.canon} ${it.dose.val}${it.dose.unit}`);
          continue;
        }
        // raw≠canon 有三种性质完全不同的来源，提示口径必须分开（北柴胡/姜厚朴 不是错字！）：
        //   fuzzy     → 形近自动识别（真·拿不准）
        //   炮制/规格 → 医师的有意写法（kb.herbAliasKind，库内合法别名/炮制品/商品规格）
        //   其余      → OCR 形近错字纠正（原有口径）
        const kind = (it.raw && it.raw !== it.canon) ? KB.herbAliasKind(it.raw) : null;
        const srcNote = it.fuzzy
          ? `；该药名「${it.raw}」系按相近药名自动识别为「${it.canon}」，请核对。`
          : (it.raw && it.raw !== it.canon
              ? (kind === '炮制'
                  ? `；原文「${it.raw}」为「${it.canon}」的炮制品写法（非错字），按「${it.canon}」核查剂量。`
                  : (kind === '规格'
                      ? `；原文「${it.raw}」为「${it.canon}」的商品规格/别名（非错字），按「${it.canon}」核查剂量。`
                      : `；原文「${it.raw}」系OCR形近错字，已自动纠正为「${it.canon}」，请核对。`))
              : '');
        items.push({
          level: 'warn', cat: '用量核查', tag: it.canon,
          title: `${it.canon} ${it.dose.val}${it.dose.unit} 超出药典常用量（上限 ${rule.max}g）`,
          detail: rule.note + srcNote + (it.flags.length ? `；该行注明「${it.flags.join('、')}」。` : ''),
          advice: '超常用量须有依据（如经典方原方剂量、专科经验）并在病历中注明，必要时减量或复核。'
        });
      }
    }
    // 药典常用量兜底（2026-10-19）：内置限量表只覆盖高风险药，香附 9g 被 OCR 读成 99g 这类
    // 「多读一位」会静默通过。按知识库「用量」字段解析上限，超上限 2 倍且差值 ≥10g → 提示核对
    //（提示级、不拦截；不重复内置限量表已提示的药；外用不按内服口径）。
    if (!external
      && !KB.TOX_LIMITS.some(r => r.names.includes(it.canon))
      && !KB.DOSE_LIMITS.some(r => r.names.includes(it.canon))) {
      let useTxt = '';
      try { useTxt = String((herbMap()[it.canon] || {}).use || ''); } catch (e) { useTxt = ''; }
      const um = useTxt.match(/(\d+(?:\.\d+)?)\s*(?:[-~～至]\s*(\d+(?:\.\d+)?))?\s*(?:g|克)/);
      if (um) {
        const hi = parseFloat(um[2] != null ? um[2] : um[1]);
        if (hi > 0 && it.dose.val > hi * 2 && it.dose.val - hi >= 10) {
          const times = Math.round(it.dose.val / hi);
          items.push({
            level: 'warn', cat: '用量核查', tag: it.canon,
            title: `${it.canon} ${it.dose.val}${it.dose.unit} 明显超出药典常用量（${useTxt}）`,
            detail: `按知识库用量「${useTxt}」，该单味剂量约为常用上限的 ${times} 倍；常见原因为 OCR 把剂量多读一位（如 9g→99g）或录入错误。`,
            advice: '请核对原始处方剂量后再确认；确为医师有意重剂时应在病历注明依据。'
          });
        }
      }
    }
  }
  // 外用合并提示：仅当确实存在超内服上限的药时才出现（不制造噪音）
  if (external && overList.length) {
    items.push({
      level: 'info', cat: '用量核查', tag: '外用',
      title: `用法为外用：${overList.join('、')} 超出内服常用量，外用不按内服量核查`,
      detail: '药典「用法与用量」所标常用量为内服量；外用给药一般标注「适量」，不作内服上限核查。',
      advice: '外用仍需注意浓度、用药面积与透皮吸收（毒性药尤甚）；破损皮肤或长时间使用请评估后调整。'
    });
  }
  // 未识别药名（OCR 错字/别名未收录，无法核查）
  for (const it of captureItems) {
    if (!it.unknown) continue;
    items.push({
      level: 'warn', cat: '用量核查', tag: '未识别',
      title: `「${it.raw}」未识别为知识库药名${it.dose ? `（${it.dose.val}${it.dose.unit}）` : ''}，无法核查其配伍与剂量`,
      detail: '可能为错别字、炮制品别名或库外品种；相近药名自动匹配未命中。',
      advice: '请核对药名后重新分析；确属库外品种请人工复核。'
    });
  }
  // 生品毒性药
  for (const r of KB.RAW_TOXIC) {
    if (text.includes(r.key)) {
      items.push({
        level: 'error', cat: '炮制核查', tag: r.key,
        title: `检出「${r.key}」：${r.note}`,
        detail: '生品毒性药材一般不可直接内服。',
        advice: '确认处方开具的是炮制品并在医嘱中注明先煎/久煎等特殊煎法。'
      });
    }
  }
  // 妊娠禁忌
  const pregHit = KB.PREG_WORDS.some(w => text.includes(w));
  const forb = union.filter(h => KB.PREG_FORBID.includes(h));
  const caut = union.filter(h => KB.PREG_CAUTION.includes(h));
  if (pregHit) {
    if (forb.length) items.push({
      level: 'error', cat: '妊娠禁忌', tag: '禁用',
      title: `处方含妊娠禁用之品：${forb.join('、')}`,
      detail: '文本出现「孕妇/妊娠」语境，上述药物传统列为孕妇禁用。',
      advice: '立即复核患者是否妊娠或备孕，必要时调整处方。'
    });
    if (caut.length) items.push({
      level: 'warn', cat: '妊娠禁忌', tag: '慎用',
      title: `处方含妊娠慎用之品：${caut.join('、')}`,
      detail: '上述药物孕妇须慎用或减量使用。',
      advice: '结合孕周权衡利弊，告知患者并知情同意。'
    });
    if (!forb.length && !caut.length) items.push({
      level: 'info', cat: '妊娠禁忌', tag: '通过',
      title: '妊娠语境下未检出禁/慎用药物',
      advice: '仍建议医师按《孕妇用药禁忌》再行核对。'
    });
  } else if (forb.length) {
    const cautOnly = caut.filter(h => !forb.includes(h));
    items.push({
      level: 'info', cat: '妊娠提醒', tag: '备注',
      title: `处方含妊娠禁用之品：${forb.join('、')}${cautOnly.length ? `（另含慎用：${cautOnly.join('、')}）` : ''}`,
      detail: '若患者为妊娠期/备孕期女性，上述药物须禁用或慎用。',
      advice: '门诊问诊请常规确认妊娠状态，必要时调整处方。'
    });
  }
  // 毒性叠加 / 重复用药（warn 级，规则表驱动）
  for (const g of KB.STACK_RULES) {
    const hit = union.filter(h => g.herbs.includes(h));
    const min = g.min || 1;
    if (hit.length >= min) {
      items.push({
        level: 'warn', cat: '配伍提醒', tag: min > 1 ? '毒性叠加' : '特殊药品',
        title: `${min > 1 ? '同类药叠加' : '特殊药材'}：${hit.join('、')}（${hit.length} 味）`,
        detail: g.v,
        advice: g.advice
      });
    }
  }
  // 中西药联用（warn 级，DRUG_INTERACT 规则表驱动；原先单一的「活血×抗凝」分支已并入第 1 条）
  const westHit = KB.WEST_DRUGS.filter(w => text.includes(w));
  for (const g of KB.DRUG_INTERACT) {
    const wHit = g.west.filter(w => text.includes(w));
    if (!wHit.length) continue;
    const hHit = union.filter(h => g.herbs.includes(h));
    if (!hHit.length) continue;
    items.push({
      level: 'warn', cat: '中西药联用', tag: g.id === 'bleed' ? '出血风险' : '相互作用',
      title: `${[...new Set(hHit)].slice(0, 4).join('、')}${hHit.length > 4 ? ` 等 ${hHit.length} 味` : ''} 与 ${wHit.slice(0, 3).join('、')}${wHit.length > 3 ? ' 等' : ''} 同用：${g.v}`,
      detail: g.why,
      advice: g.advice
    });
  }
  if (westHit.length && captureItems.length && !items.some(i => i.cat === '中西药联用')) {
    items.push({
      level: 'info', cat: '中西药联用', tag: '提示',
      title: `识别到西药（${westHit.slice(0, 3).join('、')}${westHit.length > 3 ? ' 等' : ''}）与中药同用`,
      detail: '中西药同服建议间隔 0.5-1 小时，并关注药效叠加或拮抗。',
      advice: '如需具体相互作用评估请咨询临床药师。'
    });
  }
  const risk = items.filter(i => i.level === 'error').length;
  const warn = items.filter(i => i.level === 'warn').length;
  // 配伍禁忌显性结论：未命中也必须明确提示"未检测到"（#48）
  if (!items.some(i => i.cat === '配伍禁忌') && (captureItems.length || compHerbs.length)) {
    items.unshift({
      level: 'info', cat: '配伍核查', tag: '通过',
      title: '未检测到十八反/十九畏配伍禁忌',
      detail: '已按内置十八反、十九畏歌诀规则及机构自定义规则核查处方药物组合，未发现不宜同用药物。',
      advice: '配伍安全核查通过；仍建议结合患者体质、肝肾功能与过敏史综合评估。'
    });
  }
  if (!items.length && (captureItems.length || compHerbs.length)) {
    items.push({
      level: 'info', cat: '配伍核查', tag: '通过',
      title: '未检出十八反/十九畏配伍禁忌、毒性药超量、常用药超量或生品毒性药',
      detail: '已按药典规则对处方药物与剂量做自动核查。',
      advice: '仍建议结合患者体质、肝肾功能与过敏史综合评估。'
    });
  }
  return { items, union, riskN: risk, warnN: warn, active: !!items.length };
}

// ---------- 主入口 ----------
function runTcm({ text, keys, diagSynds, usage: usageIn } = {}) {
  const masked = clean(text);
  // 处方「用法」：调用方传入（医生手填/落库值）优先；未传再从文本抓取（水煎服/每日1剂/外用…）。
  // 需在 buildRxReport 之前定值——外用给药要据此豁免内服常用量核查。
  let usage = clean(usageIn).trim();
  if (!usage) { try { usage = (Analyze.pickUsage(text || '') || {}).usage || ''; } catch (e) { usage = ''; } }
  const foundF = findFormulas(masked);
  // 方名占位屏蔽后，再做药味与剂量提取（避免方名内药名被误扫）
  const spans = [];
  for (const c of foundF) {
    let idx = masked.indexOf(c.matched);
    while (idx !== -1) {
      spans.push({ start: idx, end: idx + c.matched.length });
      idx = masked.indexOf(c.matched, idx + c.matched.length);
    }
  }
  const rxText = maskSpans(masked, spans);
  const captureItems = extractRxItems(rxText);
  const herbSet = [...new Set(captureItems.filter(i => !i.unknown).map(i => i.canon))];
  // 药味 → 剂量映射（同名取第一个非空剂量；药味 pill 与单味药说明卡共用）
  const doseMap = {};
  for (const it of captureItems) {
    if (it.unknown || !it.canon) continue;
    if (it.dose && !doseMap[it.canon]) doseMap[it.canon] = it.dose;
  }
  // 识别名与库规范名比对留痕（别名/编辑距离纠错替换）：raw≠canon 时质检给「库比对」提示
  const subs = [];
  const subSeen = new Set();
  for (const it of captureItems) {
    if (it.unknown || !it.canon || !it.raw || it.raw === it.canon) continue;
    const k = it.raw + '→' + it.canon;
    if (subSeen.has(k)) continue;
    subSeen.add(k);
    subs.push({ raw: it.raw, canon: it.canon, fuzzy: !!it.fuzzy });
  }
  const synds = detectSyndromes(masked, keys);
  const recMarkers = countRecordMarkers(masked);
  // 诊断（病历「中医诊断」）→ 所属证型（由 clinicalkb 归一后传入）
  const diag = diagNameOf(keys);
  const diagSyndList = (diagSynds || []).map(normSyndLabel).filter(Boolean);

  // 组方药味（命中方剂的组成）
  const compHerbs = [];
  const chosen = [];
  for (const { f, line } of foundF) {
    chosen.push({ f, line: line || '' });
    for (const h of scanComp(f.c)) if (!compHerbs.includes(h)) compHerbs.push(h);
  }
  const chosenNames = chosen.map(c => c.f.n);

  // 组成反查（智能补全）：未捕获方名但药味高度吻合某成方时推断，供核对
  const guessList = (!chosen.length && herbSet.length >= 3) ? guessByComposition(herbSet) : [];
  const guess = guessList.length ? guessList[0] : null;

  // 证型 → 推荐方（排除已选用，防重复展示；有诊断时按病域过滤 + 评分排序）
  const dom = diagDomainOf(diag);
  const recPool = [];
  for (const sy of synds) {
    for (const f of allFormulas()) {
      if (chosenNames.includes(f.n)) continue;
      if (!f.s.includes(sy)) continue;
      let sc = 0;
      if (dom && formulaInDiagDomain(f, dom, diag)) sc += 3; // 同病域加分
      sc += scoreFormulaForDiag(f, diag, diagSyndList);
      recPool.push({ f, syndrome: sy, by: 'synd', score: diag ? sc : null, diag: '' });
    }
  }
  // 同域优先；若无同域方则退回全部，避免空推荐。汤方(方药)优先于中成药，各按评分降序，首选标星
  const recs = (dom ? recPool.filter(r => formulaInDiagDomain(r.f, dom, diag)) : recPool)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .sort((a, b) => ((a.f.k || 'f') === (b.f.k || 'f') ? 0 : (a.f.k || 'f') === 'f' ? -1 : 1))
    .slice(0, 3);
  if (recs.length) recs[0].top = true;
  // 仅选诊断（未见证型）→ 按匹配评分全库排名推荐（主治含诊断 + 诊断所属证型命中）
  if (!recs.length && diag) {
    let pass = allFormulas()
      .filter(f => !chosenNames.includes(f.n))
      .map(f => ({ f, score: scoreFormulaForDiag(f, diag, diagSyndList) + (dom && formulaInDiagDomain(f, dom, diag) ? 1 : 0) }))
      .filter(x => x.score > 0);
    if (dom) {
      const inDom = pass.filter(x => formulaInDiagDomain(x.f, dom, diag));
      if (inDom.length) pass = inDom; // 有同域方时排除跨域（无则退回全部，避免空推荐）
    }
    const scored = pass
      .sort((a, b) => b.score - a.score)
      .sort((a, b) => ((a.f.k || 'f') === (b.f.k || 'f') ? 0 : (a.f.k || 'f') === 'f' ? -1 : 1))
      .slice(0, 5);
    for (const x of scored) recs.push({ f: x.f, syndrome: '', by: 'diag', score: x.score, diag });
    if (recs.length) recs[0].top = true;
  }

  // 证-方相符核对（病历已有选用方 + 有证型）
  const zhengFangWarn = [];
  for (const { f } of chosen) {
    if (synds.length) {
      const hit = f.s.some(s => synds.includes(s));
      if (!hit) {
        zhengFangWarn.push({
          level: 'warn', cat: '辨证核对', tag: '证-方不符',
          title: `病历辨证「${synds.join('、')}」与所选方「${f.n}」（主治 ${f.s.slice(0, 2).join('、')}）不完全对应`,
          detail: '方剂主治证型与病历辨证不吻合，可能导致疗效打折或病案质控扣分。',
          advice: '建议改用与辨证相符的方剂，或在辨证分型处补充说明随证化裁依据。'
        });
      }
      continue;
    }
    // 仅诊断未辨证：方-诊对应性核对（软提示）
    if (diag && !formulaMatchesDiag(f, diag, diagSyndList)) {
      zhengFangWarn.push({
        level: 'info', cat: '诊断核对', tag: '方-诊不符',
        title: `病历诊断「${diag}」与所选方「${f.n}」（主治 ${clean(f.m).slice(0, 18)}…）对应性弱`,
        detail: '所选方剂的功效主治与病历诊断对应不明显，可能为随证化裁或合并用药。',
        advice: '建议核对方证对应关系，或在病历中注明化裁依据，避免质控扣分。'
      });
    }
  }

  // 处方 × 诊断/病历 相符性核查（方-证-症状三级证据链）
  const diagCheck = rxDiagCheck({
    herbs: herbSet,
    f: chosen.length ? chosen[0].f : (guess ? guess.f : null),
    diag, synds, diagSynds: diagSyndList, recordText: masked
  });

  // 内容分类
  const hasHerb = herbSet.length > 0;
  const hasFormula = chosen.length > 0;
  // 明确诊断（手工选择或 OCR 病历行）视为病历语境：仅诊断也可触发推荐
  const recLike = recMarkers >= 2 || !!diag;
  let type = 'none', typeLabel = '未识别到中医内容';
  if (hasFormula || hasHerb || synds.length || (diag && recs.length)) {
    if (recLike) type = (synds.length || recs.length) ? 'recordSynd' : 'record';
    else if (hasFormula && hasHerb) type = 'prescription';
    else if (hasFormula) type = 'formula';
    else if (hasHerb) type = 'drugs';
    else type = 'unknown';
  }
  typeLabel = {
    recordSynd: '病历/诊断 · 辨证推荐与方剂核对',
    record: '病历内容 · 未见明确证型',
    prescription: '处方 · 方剂说明与合规分析',
    formula: '方剂 · 说明与合规分析',
    drugs: '药品 · 用法说明与合规分析',
    unknown: '含中医术语 · 未完全匹配'
  }[type] || '未识别到中医内容';

  // 处方合规（有药味或有方剂时执行）
  // 味数核对：处方脚注标注的每剂味数 vs 实际识别味数（OCR 漏识别/库外品种直接暴露）
  let countWarn = null;
  if (hasHerb) {
    const mCnt = String(text || '').match(/(?:每剂含|共)\s*(\d{1,2})\s*味/);
    if (mCnt) {
      const stated = parseInt(mCnt[1], 10);
      if (stated > herbSet.length) {
        countWarn = {
          level: 'warn', cat: '药数核对', tag: '药数不符',
          title: `处方标注每剂 ${stated} 味，仅识别到 ${herbSet.length} 药，可能有药物漏识别`,
          detail: `已识别：${herbSet.join('、')}。漏识别常因 OCR 错字、知识库未收录或排版特殊。`,
          advice: '请对照原件核对缺失药物；若属库外品种，请在知识库后台补录后重新分析。'
        };
      }
    }
  }
  let rx = null;
  if (hasHerb || hasFormula) {
    rx = buildRxReport({ text: masked, captureItems, compHerbs, usage });
    if (zhengFangWarn.length) {
      rx.items = [...zhengFangWarn, ...rx.items.filter(i => i.cat !== '辨证核对' && i.cat !== '诊断核对')];
      if (rx.warnN !== undefined) { rx.warnN += zhengFangWarn.filter(w => w.level === 'warn').length; }
    }
    // 相符性弱 → 并入合规告警（审方核心位置直接可见）
    if (rx && diagCheck && diagCheck.level === 'weak') {
      rx.items.unshift({
        level: 'warn', cat: '诊断核对', tag: '方证对应',
        title: diagCheck.verdict,
        detail: `支撑证据 ${diagCheck.supN}/${diagCheck.totN} 药（${diagCheck.support.map(s => s.n + '·' + s.by).slice(0, 6).join('、')}${diagCheck.support.length > 6 ? '等' : ''}）；中性药 ${diagCheck.neutral.slice(0, 8).join('、')}${diagCheck.neutral.length > 8 ? '等' : ''}。`,
        advice: '建议核对诊断与辨证是否准确、处方是否为随证化裁，并在病历中说明配伍依据。'
      });
      rx.warnN = (rx.warnN || 0) + 1;
    }
    if (rx && countWarn) {
      rx.items.unshift(countWarn);
      rx.warnN = (rx.warnN || 0) + 1;
    }
    // 方剂归属：本方属于哪个方剂（方名命中 或 组成最相近的加减推断），前台重点展示（#48）
    if (rx) {
      if (chosen.length) {
        const f0 = chosen[0].f;
        rx.belong = { by: 'name', n: f0.n, origin: f0.origin || '', hit: herbSet.filter(h => scanComp(f0.c).includes(h)).length, compSize: scanComp(f0.c).length };
      } else if (guess) {
        rx.belong = { by: 'comp', n: guess.f.n, origin: guess.f.origin || '', hit: guess.hit.length, compSize: guess.compSize || scanComp(guess.f.c).length, miss: guess.miss || [], subHits: guess.subHits || [], covRx: guess.covRx, classic: guess.classic };
      }
      // 命中统计：识别 N 味 / 命中知识库 M 味 + 未匹配清单（OCR 错字/库外药），供前台展示与后台 AI 补库
      const unknowns = [...new Set(captureItems.filter(i => i.unknown).map(i => String(i.raw || '').trim()).filter(Boolean))];
      // 量化指标（味数/单剂克数/每日克数/剂数/天数/总克数…）并入 stat：前台指标条与后台点评共用同一口径
      const met = RxMetric.rxMetrics({ items: captureItems, text: masked, usage });
      rx.stat = {
        total: captureItems.length, hit: herbSet.length, miss: unknowns,
        herbN: met.herbN, doseN: met.doseN, noDoseN: met.noDoseN,
        doseG: met.doseG, dailyJi: met.dailyJi, dailyG: met.dailyG,
        ji: met.ji, days: met.days, totalG: met.totalG, avgG: met.avgG,
        maxG: met.maxG, maxN: met.maxN
      };
    }
  }

  // 摘要文案
  let msg = '';
  if (type === 'recordSynd') {
    if (!recs.length) {
      msg = synds.length ? `辨证「${synds.join('、')}」→ 已核对选用方` : '病历要素已识别';
    } else if (recs[0].by === 'diag') {
      msg = `诊断「${diag}」→ 按匹配评分推荐 ${recs.length} 首方剂（Top${recs.length}）供参考，可补充辨证细化`;
    } else {
      msg = `辨证「${synds.join('、')}」→ 推荐 ${recs.length} 首方剂供参考`;
    }
  } else if (type === 'prescription' || type === 'formula') {
    msg = hasFormula ? `已解析 ${chosen.length} 首方剂组成与用法` : '已解析处方内容';
  } else if (type === 'drugs') {
    msg = guess
      ? `据组成推断为「${guess.f.n}」加减化裁（原方命中 ${guess.inter}/${guess.compSize} 药），已按组成与合规给出说明供核对`
      : `识别 ${herbSet.length} 药，未匹配到近似方剂，已按组成与合规给出说明`;
  } else if (type === 'record') {
    msg = '病历要素已识别，未见明确证型，可补全辨证后推荐方剂';
  } else if (type === 'unknown') {
    msg = '识别到部分中医术语，建议框选更完整的方药区域';
  } else {
    msg = '本次内容未识别到中医病历/方药要素';
  }
  const riskN = rx ? rx.riskN : 0;

  // 内容完整性提示（供面板横幅展示）
  const notes = [];
  const tailTrim = clean(text).replace(/\s+$/, '');
  if (guess) {
    const hitTxt = [...new Set(guess.hit.concat((guess.subHits || []).map(s => s.used)))].join('、');
    const subTxt = (guess.subHits && guess.subHits.length)
      ? guess.subHits.map(s => `「${s.orig}」以「${s.used}」替代（常规替换）`).join('、') : '';
    const missTxt = guess.miss.length ? `（缺 ${guess.miss.join('、')}，或以代用品加减）` : '';
    const pre = guess.miss.length ? '内容不完整' : '未见方名';
    const mid = subTxt && !guess.miss.length ? `，其中 ${subTxt}` : '';
    const tail = guess.miss.length ? '' : '，组成相符';
    notes.push(`${pre}：据组成 ${hitTxt} 推断为「${guess.f.n}」${guess.f.origin ? `（${guess.f.origin}）` : ''}${mid}${missTxt}${tail}，建议核对方名或重新框选。`);
  }
  if (/[、，,:：;；]$/.test(tailTrim)) {
    notes.push(`文本末尾以「${tailTrim.slice(-1)}」收尾，疑似截断、内容不全，建议重新完整框选后分析。`);
  }

  const chips = [];
  if (synds.length) chips.push(`辨证 ${synds.length}`);
  else if (diag && recs.length) chips.push(`诊断 ${diag}`);
  if (chosen.length) chips.push(`方剂 ${chosen.length}`);
  if (chosen.some(c => c.f.k === 'p') || recs.some(r => r.f.k === 'p')) chips.push('含中成药');
  if (herbSet.length) chips.push(`用药 ${herbSet.length} 药`);
  if (guess) chips.push('疑似方剂');
  if (notes.length && !guess) chips.push('⚠ 内容不全');
  if (rx && (rx.riskN || rx.warnN)) chips.push(`⚠ 风险 ${rx.riskN + rx.warnN}`);
  else if (rx && rx.active) chips.push('✓ 合规已核查');
  if (diagCheck && diagCheck.level === 'ok') chips.push('✓ 方证相符');
  else if (diagCheck && diagCheck.level === 'partial') chips.push('◐ 基本相符');

  return {
    ok: true, type, typeLabel, msg, chips, notes,
    hasRec: !!recs.length, hasChosen: !!chosen.length,
    synds, diag, usage,
    recs: recs.map(r => ({ f: r.f, syndrome: r.syndrome, by: r.by || 'synd', score: r.score, diag: r.diag || '', top: !!r.top })),
    chosen: chosen.map(c => ({
      f: c.f, line: c.line,
      okSynd: !synds.length ? null : c.f.s.some(s => synds.includes(s)),
      okDiag: !diag ? null : formulaMatchesDiag(c.f, diag, diagSyndList)
    })),
    herbs: herbSet,
    subs,
    guess: guess ? { f: guess.f, hit: guess.hit, miss: guess.miss, subHits: guess.subHits || [] } : null,
    guessAlt: guessList.length > 1 ? guessList[1].f : null,
    herbCards: herbSet.map(h => { const c = herbMap()[h]; if (!c) return null; const extra = { dose: doseMap[h] || '' }; const yb = YIBAO_BY_NAME[h]; if (yb) extra.yb = yb; return Object.assign({}, c, extra); }), // 全场景生成（成方也出说明卡），带剂量+医保（浅拷贝防缓存污染）
    herbDoses: doseMap,
    diagCheck,
    rx,
    disclaimer: DISCLAIMER
  };
}

// 导出（含隐藏字段用于面板渲染）
function viewModel(tcm) {
  if (!tcm || !tcm.ok) return null;
  return tcm;
}

module.exports = { runTcm, viewModel, scanComp, herbsMatch, invalidateCache, detectSyndromes, countRecordMarkers, westTcmCandidates, diagDomainOf, setWestMap, setYibaoRules,
  // 组成反查（框选遮罩「药」卡片预判方剂用）：runTcm 内部仅在未命中方名时才算，这里对外单独暴露
  guessByComposition,
  // 方名命中（autosynd 由方推证用）：命中方剂的主治证型可在文本无证型标注时弱推断
  findFormulas,
  // 带剂量处方项提取 + 列式排版剂量重配对（对拍 chan_rx_column）
  extractRxItems, reflowColumnarDoses };
