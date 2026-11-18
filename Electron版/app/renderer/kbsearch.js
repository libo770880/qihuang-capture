// renderer/kbsearch.js - 岐黄鉴方「中药 / 方剂知识检索」共享组件
// 供独立检索窗 search.html 与 记录面板 panel.html 复用；数据经 preload 桥接读合并库。
// window.KBSearch.mount(host, {height}) → 返回 { reload }
(function () {
  'use strict';
  if (window.KBSearch) return; // 防重复注入

  var CSS_DONE = false;
  function injectCss() {
    if (CSS_DONE || !document.head) return;
    CSS_DONE = true;
    var st = document.createElement('style');
    st.id = 'kbs-search-css';
    st.textContent = [
      '.kbs{display:flex;flex-direction:column;height:100%;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#23311f;background:#f6f3e9;border:1px solid #e2dccb;border-radius:10px;overflow:hidden;box-sizing:border-box}',
      '.kbs *{box-sizing:border-box}',
      '.kbs .kb{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#123f28;flex:none}',
      '.kbs .kb .inp{flex:1;min-width:0;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.14);color:#eef3e0;border-radius:8px;padding:7px 12px;font-size:12.5px;outline:none}',
      '.kbs .kb .inp::placeholder{color:#a9c4a5}',
      '.kbs .kb .inp:focus{border-color:#f0c164;background:rgba(255,255,255,.2)}',
      '.kbs .kb .fs{display:flex;background:rgba(255,255,255,.08);border-radius:8px;padding:2px;border:1px solid rgba(255,255,255,.18)}',
      '.kbs .kb .fs button{background:transparent;border:0;color:#cfe4c8;font-size:11.5px;padding:4px 11px;border-radius:6px;cursor:pointer;white-space:nowrap}',
      '.kbs .kb .fs button.on{background:#f0c164;color:#3c2c08;font-weight:600}',
      '.kbs .kb .ybsel{flex:none;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);color:#eef3e0;border-radius:8px;padding:6px 6px;font-size:11.5px;outline:none;cursor:pointer}',
      '.kbs .kb .ybsel:hover{background:rgba(255,255,255,.22)}',
      '.kbs .kb .ybsel option{color:#23311f;background:#fff}',
      '.kbs .flink{display:inline-block;color:#2f6d3f;cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;font-weight:600;margin:0 7px 0 0}',
      '.kbs .flink:hover{color:#7a4f9e}',
      '.kbs .flinkS{display:inline-block;color:#96610d;background:#faf1dc;border:1px solid #ecd9a8;border-radius:9px;padding:0 7px;margin:1px 3px 1px 0;font-size:11px;cursor:pointer;line-height:17px}',
      '.kbs .flinkS:hover{background:#f3e2ba}',
      '.kbs .flinkF{display:inline-block;color:#2f5d3a;background:#eef4e4;border:1px solid #cfe0bc;border-radius:9px;padding:0 7px;margin:1px 3px 1px 0;font-size:11px;cursor:pointer;line-height:17px}',
      '.kbs .flinkF:hover{background:#dcead0}',
      '.kbs .glink{display:inline-block;color:#5b3d8f;background:#f1ebfa;border:1px solid #ddcdf2;border-radius:9px;padding:0 7px;margin:1px 3px 1px 0;font-size:11px;cursor:pointer;line-height:17px}',
      '.kbs .glink:hover{background:#e3d7f5}',
      '.kbs .pmeta{font-size:12px;color:#6a7562;padding:2px 0 8px;line-height:1.8}',
      '.kbs.hmodal-mask{position:fixed;inset:0;background:rgba(40,50,35,.45);z-index:9999;display:flex;align-items:center;justify-content:center;animation:hfade .15s ease}',
      '@keyframes hfade{from{opacity:0}to{opacity:1}}',
      '.kbs .hmodal{background:#fbf9f0;border:1px solid #d8ddc6;border-radius:14px;max-width:600px;width:92%;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(20,30,16,.35);animation:hpop .18s ease}',
      '@keyframes hpop{from{transform:translateY(14px) scale(.97);opacity:0}to{transform:none;opacity:1}}',
      '.kbs .hmodal .hhd{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid #e4e8d4}',
      '.kbs .hmodal .hhd .ht{font-family:KaiTi,serif;font-size:20px;color:#1e3d27;font-weight:700}',
      '.kbs .hmodal .hhd .hx{margin-left:auto;width:26px;height:26px;border-radius:50%;border:1px solid #d5dcc3;background:#fff;color:#8a9276;font-size:14px;cursor:pointer;line-height:24px;text-align:center}',
      '.kbs .hmodal .hhd .hx:hover{background:#fbe7e5;color:#b3372e;border-color:#f0c5c0}',
      '.kbs .hmodal .hbd{padding:12px 18px 16px;overflow-y:auto}',
      '.kbs .hmodal .dcard{background:#fff;border:1px solid #e2dccb;border-radius:10px;padding:6px 14px}',
      '.kbs .hmodal .row .lb{color:#b7791f}',
      '.kbs .hmodal .row .vl{color:#333b30}',
      '.kbs .hmodal .dh .dn{font-size:20px;color:#1e3d27}',
      '.kbs .hmodal .dh .dk{color:#7a6a3c;border-color:#d9cda6;background:#faf5e6}',
      '.kbs .kb .cnt{color:#cfe4c8;font-size:11px;white-space:nowrap}',
      '.kbs .chips{display:flex;gap:6px;flex-wrap:wrap;padding:7px 12px 0;background:#123f28;flex:none;padding-bottom:8px}',
      '.kbs .chips .lb{font-size:10.5px;color:#a9c4a5;flex:none;line-height:22px;letter-spacing:1px}',
      '.kbs .chips .c{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#e6efdd;border-radius:12px;padding:2px 10px;font-size:11px;cursor:pointer;white-space:nowrap;line-height:18px}',
      '.kbs .chips .c:hover{background:rgba(255,255,255,.22)}',
      '.kbs .chips .c.on{background:#f0c164;border-color:#f0c164;color:#3c2c08;font-weight:600}',
      '.kbs .body{flex:1;display:flex;min-height:0}',
      '.kbs .list{width:278px;min-width:240px;background:#fff;border-right:1px solid #e2dccb;display:flex;flex-direction:column}',
      '.kbs .lhead{flex:none;font-size:10.5px;color:#9a9c8a;padding:6px 12px 3px;letter-spacing:1px}',
      '.kbs .lbox{flex:1;overflow-y:auto}',
      '.kbs .li{padding:8px 12px;border-bottom:1px solid #f0ecdd;cursor:pointer;display:flex;flex-direction:column;gap:2px}',
      '.kbs .li:hover{background:#f3f5e8}',
      '.kbs .li.sel{background:#eef2e3;box-shadow:inset 3px 0 0 #2f5d3a}',
      '.kbs .li .r1{display:flex;align-items:center;gap:6px;min-width:0}',
      '.kbs .li .nm{font-size:13px;font-weight:600;color:#1e3d27;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbs .pk{font-size:9.5px;border-radius:4px;padding:0 5px;line-height:15px;flex:none;font-weight:400}',
      '.kbs .pk.f{background:#e6f1fb;color:#185fa5;border:1px solid #b5d4f4}',
      '.kbs .pk.p{background:#fbeaf0;color:#993556;border:1px solid #f4c0d1}',
      '.kbs .pk.h{background:#e1f5ee;color:#0f6e56;border:1px solid #9fe1cb}',
      '.kbs .pk.u{background:#fdf1da;color:#9a6b12;border:1px solid #ecd9a8}',
      '.kbs .li .sub{font-size:11px;color:#6a7562;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.45}',
      '.kbs .li .src{font-size:10.5px;color:#a49a7a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbs .det{flex:1;min-width:0;overflow-y:auto;padding:18px 26px 30px;background:#f6f3e9}',
      '.kbs .empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#a2a493;gap:6px}',
      '.kbs .empty .big{font-family:KaiTi,serif;font-size:44px;color:#cdd3b8}',
      // 详情内容列：限宽居中，大气留白
      '.kbs .dwrap{max-width:860px;margin:0 auto}',
      '.kbs .kback{display:inline-block;font-size:12px;color:#2f5d3a;background:#eef2e3;border:1px solid #d5dcc3;border-radius:20px;padding:2px 12px;cursor:pointer;user-select:none}',
      '.kbs .kback:hover{background:#e2e9d2}',
      '.kbs .lhead.west{color:#96610d;background:#faf1dc}',
      '.kbs .wxk{display:inline-block;color:#2f5d3a;background:#eef4e4;border:1px solid #cfe0bc;border-radius:9px;padding:0 7px;margin:1px 4px 1px 2px;font-size:11px;cursor:pointer;line-height:17px}',
      '.kbs .wxk:hover{background:#dcead0}',
      '.kbs{position:relative}',
      '.kbs .ksug{position:absolute;z-index:60;background:#fff;border:1px solid #d8ddc6;border-radius:9px;box-shadow:0 12px 28px rgba(20,30,16,.22);max-height:250px;overflow:auto;display:none}',
      '.kbs .ksug .sugi{padding:6px 10px;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px;color:#23311f}',
      '.kbs .ksug .sugi:hover,.kbs .ksug .sugi.cur{background:#eef2e3}',
      '.kbs .ksug .sk{flex:none;width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;font-size:10px;color:#fff;background:#2f5d3a}',
      '.kbs .ksug .sugi[data-k="h"] .sk{background:#7a5d33}',
      '.kbs .ksug .sugi[data-k="t"] .sk{background:#4a6fa5}',
      '.kbs .ksug .ss{margin-left:auto;font-size:10.5px;color:#a49a7a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52%}',
      '.kbs .dh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;padding-bottom:12px;border-bottom:1px solid #e6e0cd}',
      '.kbs .dh .dn{font-family:KaiTi,serif;font-size:26px;color:#1e3d27;letter-spacing:1px}',
      '.kbs .dh .dk{font-size:10.5px;color:#7a6a3c;border:1px solid #d9cda6;background:#faf5e6;border-radius:5px;padding:1px 7px}',
      '.kbs .dmeta{font-size:11.5px;color:#6a7562;margin-bottom:10px}',
      // 字段卡：白底圆角卡承载字段行，行间虚线分隔
      '.kbs .dcard{background:#fff;border:1px solid #e2dccb;border-radius:10px;padding:4px 16px;margin:8px 0 12px;box-shadow:0 1px 3px rgba(80,80,50,.05)}',
      '.kbs .row{display:flex;gap:10px;padding:5px 0;font-size:12.5px;line-height:1.75}',
      '.kbs .row+.row{border-top:1px dashed #f2edde}',
      '.kbs .row .lb{flex:none;width:96px;color:#b7791f;font-weight:600;text-align:right}',
      '.kbs .row .vl{flex:1;color:#333b30;word-break:break-all;min-width:0}',
      '.kbs .sec{border:1px solid #e2dccb;border-radius:9px;background:#fff;padding:9px 13px;margin-top:10px}',
      '.kbs .sec .st{font-size:12px;font-weight:700;color:#1e3d27;border-left:3px solid #b7791f;padding-left:8px;margin-bottom:6px;letter-spacing:1px}',
      '.kbs .sec .vl{font-size:12.5px;line-height:1.9;color:#333b30}',
      '.kbs .drow-empty{padding:6px 0;font-size:11px;color:#a2a493}',
      '.kbs .bdg{font-size:10px;border-radius:4px;padding:1px 6px;background:#ecefe0;color:#4a5646;margin-left:2px}',
      '.kbs .bdg.b-builtin{background:#eef0e3;color:#4a5646;border:1px solid #d5dcc3}',
      '.kbs .bdg.b-user{background:#e1f5ee;color:#0f6e56;border:1px solid #9fe1cb}',
      '.kbs .bdg.b-over{background:#fdf1da;color:#9a6b12;border:1px solid #ecd9a8}',
      '.kbs .tox{font-size:9.5px;border-radius:4px;padding:0 5px;line-height:15px;background:#fbe7e5;color:#b3372e;margin-left:2px}',
      // 医保支付类别徽章（甲/乙丙/自费）
      '.kbs .yb{display:inline-block;font-size:9.5px;border-radius:4px;padding:0 5px;line-height:15px;font-weight:600;flex:none;white-space:nowrap;border:1px solid transparent}',
      '.kbs .yb.jia{background:#e8f3e4;color:#2e7d32;border-color:#c4e2bd}',
      '.kbs .yb.yi{background:#faf3e0;color:#96610d;border-color:#ecdcae}',
      '.kbs .yb.zf{background:#fdecea;color:#b3372e;border-color:#f3c8c3}',
      '.kbs .row .vl .yb{margin-right:6px;vertical-align:middle}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // 症状直达（常见症状 → 关键词检索中药/方剂）
  var QUICK_SX = ['感冒', '咳嗽', '发热', '咽痛', '鼻塞', '头痛', '眩晕', '失眠', '心悸', '胸闷', '口疮', '牙痛', '耳鸣', '胃痛', '胃胀', '恶心呕吐', '呃逆', '腹痛', '腹胀', '便秘', '泄泻', '水肿', '淋证', '腰痛', '关节痛', '痛经', '月经不调', '带下', '湿疹', '皮肤瘙痒', '食积', '中暑'];
  // 西医症状/病名 → 中医对应术语：检索时自动扩展命中 + 列表顶部提示（面向非中医人员 Demo 关键）
  var WEST_MAP = {
    '高血压': ['眩晕', '头痛', '肝阳上亢', '平肝'],
    '糖尿病': ['消渴', '滋阴', '生津', '烦渴'],
    '高血脂': ['痰浊', '化浊', '湿浊', '降脂'],
    '冠心病': ['胸痹', '心痛', '活血', '宽胸', '薤白'],
    '胃炎': ['胃痛', '痞满', '和胃', '胃脘'],
    '胃溃疡': ['胃痛', '泛酸', '制酸', '和胃'],
    '消化不良': ['食积', '消食', '痞满', '运脾'],
    '反流性食管炎': ['吐酸', '泛酸', '和胃降逆', '噎膈'],
    '气管炎': ['咳嗽', '痰饮', '止咳', '化痰'],
    '支气管炎': ['咳嗽', '化痰', '止咳'],
    '肺炎': ['咳嗽', '肺热', '清热化痰', '喘咳'],
    '哮喘': ['哮喘', '平喘', '定喘', '痰鸣'],
    '神经衰弱': ['不寐', '失眠', '安神', '心悸'],
    '贫血': ['血虚', '补血', '养血', '萎黄'],
    '荨麻疹': ['瘾疹', '祛风', '止痒', '风疹'],
    '湿疹': ['湿疮', '祛湿', '止痒', '渗湿'],
    '关节炎': ['痹证', '痹症', '风湿', '通络止痛'],
    '关节痛': ['痹证', '痹症', '风湿', '通络止痛'],
    '胃胀': ['痞满', '消食', '行气', '腹胀'],
    '颈椎病': ['项痹', '项强', '舒筋', '颈肩'],
    '腰椎间盘突出': ['腰痛', '活血通络', '强腰', '肾虚'],
    '尿路感染': ['淋证', '利尿通淋', '湿热下注', '尿频'],
    '肾炎': ['水肿', '利水', '宣肺利水'],
    '胆囊炎': ['胁痛', '利胆', '疏肝利胆', '黄疸'],
    '胆结石': ['胁痛', '排石', '利胆', '砂淋'],
    '口腔溃疡': ['口疮', '清心', '泻火', '生肌'],
    '更年期综合征': ['脏躁', '烘热', '滋肾', '经断'],
    '月经不调': ['月经', '调经', '活血调经'],
    '痛经': ['痛经', '调经止痛', '活血'],
    '阳痿': ['阳痿', '壮阳', '命门火衰'],
    '遗精': ['遗精', '固精', '涩精'],
    '痤疮': ['粉刺', '凉血', '清肺', '清热解毒'],
    '中暑': ['中暑', '清暑', '解暑', '暑湿'],
    '肥胖': ['痰湿', '减肥', '消脂', '化湿']
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function cleanArr(v) { return Array.isArray(v) ? v : []; }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toxT(v) { return ['', '小毒', '有毒', '大毒'][v || 0] || ''; }
  function preT(v) { return { 0: '', 1: '孕妇慎用', 2: '孕妇禁用' }[v] || ''; }

  // ===== 术语拼音（症状/西医词/证型）：panel.html 需先引入 pinyin-pro UMD（全局 pinyinPro） =====
  var PYFN = (typeof window !== 'undefined' && window.pinyinPro && window.pinyinPro.pinyin) || null;
  function pyFull(s) { try { return PYFN ? PYFN(String(s), { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').replace(/\s+/g, '').toLowerCase() : ''; } catch (e) { return ''; } }
  function pyInit(s) { try { return PYFN ? PYFN(String(s), { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').replace(/\s+/g, '').toLowerCase() : ''; } catch (e) { return ''; } }
  var VOCAB = null;
  // 术语拼音表：症状直达 + 西医映射键 + 全部方剂证型标签 → 支持纯字母检索症状/证型（shm→失眠 等）
  function buildVocab(all) {
    if (VOCAB) return VOCAB;
    var seen = {}, list = [];
    function add(t, k) {
      t = String(t || '').trim();
      if (t && t.length >= 2 && !seen[t]) { seen[t] = 1; list.push({ t: t, k: k, py: pyFull(t), py0: pyInit(t) }); }
    }
    QUICK_SX.forEach(function (t) { add(t, '症状'); });
    Object.keys(WEST_MAP).forEach(function (t) { add(t, '西医'); });
    ((all && all.formulas) || []).forEach(function (f) { cleanArr(f.s).forEach(function (t) { add(t, '证型'); }); });
    VOCAB = list;
    return VOCAB;
  }
  // 纯字母检索词 → 命中的术语列表（全拼或首字母包含）
  function vocabHit(all, kw) {
    if (!kw || !/^[a-z]+$/.test(kw)) return null;
    var hits = buildVocab(all).filter(function (v) {
      return (v.py && v.py.indexOf(kw) !== -1) || (v.py0 && v.py0.indexOf(kw) !== -1);
    });
    return hits.length ? hits.slice(0, 8) : null;
  }

  // ===== 医保规则（与后台「医保规则」页签同库 knowledge/yibao.json） =====
  var YB_MAP = null;
  function ybCls(t) { return t === '自费' ? 'zf' : (t === '甲类' ? 'jia' : 'yi'); }
  function ybOf(nm) { return YB_MAP && YB_MAP[nm] && YB_MAP[nm].payType ? YB_MAP[nm] : null; }
  var CUR_STATE = null;
  var HIST = []; // 浏览历史栈：支持「返回上一级」
  // document 级委托与弹窗节点提升到模块级：mount 可重复调用（panel 每次进知识检索都重挂载），
  // 旧委托若不移除会叠加，一次点击触发 N 次 doBack 把历史栈弹光 → 「返回」失效
  var DOC_CLICK_FN = null, DOC_KEY_FN = null;
  var kModalEl = null;
  // 方剂级治法词 → 代表中药（这类词在中药功效文本中不会出现，需概念映射兜底；药名均已在库校验）
  var G_RELATED = {"宣利肺气":["苦杏仁","桔梗","前胡"],"辛凉透表":["薄荷","蝉蜕","牛蒡子"],"辛凉宣泄":["麻黄","石膏","苦杏仁"],"清养肺胃":["麦冬","玉竹","沙参"],"滋养肺肾":["百合","麦冬","熟地黄","山茱萸"],"清胃热":["石膏","黄连","升麻","知母"],"升清止利":["葛根","升麻","柴胡"],"和解少阳":["柴胡","黄芩","半夏","青蒿"],"填精益髓":["熟地黄","山茱萸","龟甲","枸杞子"],"滋养肺胃":["麦冬","玉竹","沙参","石斛"],"轻宣凉燥":["紫苏叶","苦杏仁","桔梗","前胡"],"清宣温燥":["桑叶","菊花","沙参","麦冬"],"宣畅气机":["藿香","厚朴","豆蔻","薏苡仁"],"清上泄下":["连翘","大黄","栀子","芒硝"],"消散疔疮":["金银花","野菊花","紫花地丁","蒲公英"],"固冲摄血":["山茱萸","黄芪","龙骨","牡蛎"],"宣降肺气":["苦杏仁","麻黄","紫苏子","桑白皮"],"和营续骨":["续断","当归","自然铜","乳香"],"兼清里热":["黄芩","石膏","知母","栀子"],"升津舒经":["葛根","白芍","桂枝"],"开达膜原":["槟榔","厚朴","知母","黄芩"],"清肝胆实火":["龙胆","栀子","黄芩","夏枯草"],"泻下焦湿热":["龙胆","黄柏","栀子","车前子"],"破癥消结":["三棱","莪术","鳖甲","牡丹皮"],"清宣郁热":["栀子","连翘","薄荷","牛蒡子"],"消补兼施":["白术","木香","砂仁","枳实"],"通达内外":["柴胡","黄芩","半夏","生姜"],"泻热逐水破结":["大黄","芒硝","甘遂"],"平调寒热":["黄连","干姜","桂枝","半夏"],"苦寒降泄":["黄连","大黄","黄芩"],"酸甘化阴":["白芍","甘草","乌梅","木瓜"],"轻下热结":["大黄","芒硝","厚朴","甘草"],"温化水饮":["茯苓","桂枝","白术","干姜"],"兼清郁热":["黄连","黄芩","栀子","连翘"],"荡涤实饮":["甘遂","大戟","芫花","大枣"],"前后分消":["防己","大黄","厚朴","槟榔"],"固摄止利":["赤石脂","诃子","肉豆蔻","干姜"],"宣气利湿泄浊":["薏苡仁","防己","滑石","蚕沙"],"升清降浊":["半夏","白术","茯苓","黄连"],"清上燥火":["桑叶","黄芩","栀子","麦冬"],"甘凉救燥":["沙参","麦冬","玉竹","石斛"],"甘凉濡润":["麦冬","玉竹","石斛","沙参"],"回阳益气固脱":["人参","附子","山茱萸","五味子"]};
  function pushHist(st) {
    HIST.push({ kind: st.kind, kw: st.q.value, cat: st.cat, fkind: st.fkind, ybf: st.ybf, sel: st.sel });
    if (HIST.length > 20) HIST.shift();
  }
  function linkifyComp(t) {
    if (!t || !CUR_STATE) return esc(t || '');
    var names = (CUR_STATE.all.herbs || []).map(function (h) { return h.n || h.name; }).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    var toks = []; var s = String(t);
    names.forEach(function (nm, i) { var tok = '\u0000' + i + '\u0000'; if (s.indexOf(nm) !== -1) { s = s.split(nm).join(tok); toks[i] = nm; } });
    return esc(s).replace(/\u0000(\d+)\u0000/g, function (m, i) {
      var nm = toks[i] || '';
      return '<a class="flink" data-h="' + escAttr(nm) + '" title="查看中药详情">' + esc(nm) + '</a>';
    });
  }
  function syndChips(arr) {
    return (arr || []).map(function (sv) {
      return '<a class="flinkS" data-s="' + escAttr(sv) + '" title="查看主治此证型的方剂">' + esc(sv) + '</a>';
    }).join('');
  }
  function gChips(t) { // 功效文本拆词为可点 chips（renderDetail 模块级也在用，必须放模块层）
    if (!t) return '';
    var terms = []; var seen = {};
    String(t).split(/[，、,；;。\s]+/).forEach(function (x) { if (x.length >= 2 && !seen[x]) { seen[x] = 1; terms.push(x); } });
    return terms.map(function (x) { return '<a class="glink" data-g="' + escAttr(x) + '" title="查看具有此功效的中药">' + esc(x) + '</a>'; }).join('');
  }
  function ybPill(r) {
    if (!r) return '';
    return '<span class="yb ' + ybCls(r.payType) + '" title="医保' + esc(r.payType) + (r.limit ? ' · ' + esc(r.limit) : '') + '">医保' + esc(r.payType) + '</span>';
  }
  function ybRow(r) {
    if (!r) return '';
    var txt = [r.code ? ('编码 ' + r.code) : '', r.limit, r.copay ? ('自付 ' + r.copay + '%') : '', r.note]
      .filter(Boolean).join('；') || '按当地医保目录支付';
    return '<div class="row"><span class="lb">医保</span><span class="vl">' + ybPill(r) + esc(txt) + '</span></div>';
  }
  function loadYb() {
    try {
      return window.qhjf.ybList().then(function (list) {
        YB_MAP = {};
        (list || []).forEach(function (r) { if (r && r.name && !YB_MAP[r.name]) YB_MAP[r.name] = r; });
      }).catch(function () { YB_MAP = {}; });
    } catch (e) { YB_MAP = {}; return Promise.resolve(); }
  }

  function buildSearchText(x, kind) {
    var s;
    if (kind === 'h') {
      s = [x.n, cleanArr(x.aliases).join(' '), x.prop, x.fx, x.use, x.note, x.category, x.pinyin, x.py, x.py0,
        x.indications, x.origin, x.source, x.interactions, x.combinations, x.modern, x.desc].join(' ');
    } else {
      s = [x.n, cleanArr(x.aka).join(' '), cleanArr(x.s).join(' '), x.c, x.g, x.m, x.u, x.j, x.x,
        x.origin, x.source, x.category, x.desc, x.py, x.py0].join(' ');
    }
    return String(s || '').toLowerCase();
  }

  function herbSub(x) {
    var parts = [];
    if (x.category) parts.push(x.category);
    if (x.fx) parts.push(x.fx);
    else if (x.prop) parts.push(x.prop);
    return parts.join(' · ');
  }
  function formulaSub(x) {
    var parts = [];
    if (cleanArr(x.s).length) parts.push(cleanArr(x.s).join('、'));
    if (x.g) parts.push(x.g);
    return parts.join(' · ');
  }
  function srcOf(x, kind) {
    var s = (kind === 'h' ? (x.origin || x.source) : (x.origin || x.source)) || '';
    return String(s);
  }

  function badgeOf(x, kind) {
    var arr = [];
    if (kind === 'f') {
      if (x.k === 'p') arr.push('<span class="pk p">成药</span>');
      arr.push('<span class="pk f">方</span>');
    } else arr.push('<span class="pk h">药</span>');
    if (x.user) arr.push('<span class="pk u">' + (x.overrides ? '覆盖内置' : '用户') + '</span>');
    else arr.push('<span class="pk" style="background:#eef0e3;color:#4a5646;border:1px solid #d5dcc3">内置</span>');
    return arr.join('');
  }

  function renderDetail(x, kind, host, noBack) {
    if (!x) { host.innerHTML = '<div class="empty"><div class="big">岐</div>选择左侧条目查看详情</div>'; return; }
    var backHtml = (!noBack && HIST.length) ? '<div style="margin-bottom:6px"><a class="kback" title="返回上一级">← 返回</a></div>' : '';
    var rows = [];
    function add(lb, v) { if (v) rows.push('<div class="row"><span class="lb">' + lb + '</span><span class="vl">' + esc(v) + '</span></div>'); }
    if (kind === 'h') {
      add('药名', x.n);
      add('别名', cleanArr(x.aliases).join('、'));
      add('拼音', x.pinyin);
      add('分类', x.category);
      add('性味归经', x.prop);
      rows.push('<div class="row"><span class="lb">功效</span><span class="vl" style="line-height:2">' + gChips(x.fx) + '</span></div>'); // 功效拆词可点弹窗
      add('主治', x.indications);
      add('用法用量', x.use);
      add('煎服', x.decoction);
      add('注意事项', x.note);
      add('配伍注意', x.interactions);
      add('常用配伍', x.combinations);
      add('现代药理', x.modern);
      // 相关方剂：组成包含该药的全部方剂
      var hn = x.n || x.name;
      var relF = ((CUR_STATE && CUR_STATE.all.formulas) || []).filter(function (f) { return f.c && String(f.c).indexOf(hn) !== -1; });
      var relHtml = relF.length ? '<div class="sec"><div class="st">相关方剂 · ' + relF.length + ' 首（点击查看）</div><div style="line-height:2">' + relF.map(function (f) { return '<a class="flinkF" data-f="' + escAttr(f.n) + '" title="查看该方详情">' + esc(f.n) + '</a>'; }).join('') + '</div></div>' : '';
      var tox = toxT(x.tox), pre = preT(x.pre);
      if (tox || pre) add('安全等级', (tox ? '毒性 ' + tox + ' ' : '') + (pre || ''));
      add('基原 / 出处', x.origin || x.source);
      var yb = ybOf(x.n);
      if (yb) rows.push(ybRow(yb));
      var dh = '<div class="dh"><span class="dn">' + esc(x.n) + '</span>' + (x.category ? '<span class="dk">' + esc(x.category) + '</span>' : '') + badgeOf(x, 'h') + ybPill(yb) +
        (tox ? '<span class="tox">毒</span>' : '') + (x.pre === 2 ? '<span class="tox">孕妇禁用</span>' : x.pre === 1 ? '<span class="tox">孕妇慎用</span>' : '') + '</div>';
      var meta = (x.user ? '用户导入' : '内置知识库') + (srcOf(x, 'h') ? ' · 来源见下' : '');
      var extra = x.desc ? '<div class="sec"><div class="st">详细说明</div><div class="vl">' + esc(x.desc) + '</div></div>' : '';
      host.innerHTML = '<div class="dwrap">' + backHtml + dh + '<div class="dmeta">' + esc(meta) + '</div><div class="dcard">' + rows.join('') + '</div>' + extra + relHtml + '</div>';
    } else {
      add('方名', x.n);
      add('别名', cleanArr(x.aka).join('、'));
      add('剂型', x.k === 'p' ? '中成药 / 丸散' : '汤剂（可随证加减）');
      rows.push('<div class="row"><span class="lb">主治证型</span><span class="vl">' + syndChips(cleanArr(x.s)) + '</span></div>');
      add('分类', x.category);
      rows.push('<div class="row"><span class="lb">组成</span><span class="vl" style="line-height:2">' + linkifyComp(x.c) + '</span></div>');
      rows.push('<div class="row"><span class="lb">功效</span><span class="vl" style="line-height:2">' + gChips(x.g) + '</span></div>');
      add('主治', x.m);
      add('用法', x.u);
      if (x.j) rows.push('<div class="row"><span class="lb">加减</span><span class="vl" style="line-height:2">' + linkifyComp(x.j) + '</span></div>');
      add('注意', x.x);
      add('出处', x.origin || x.source);
      var dh2 = '<div class="dh"><span class="dn">' + esc(x.n) + '</span><span class="dk">' + (x.k === 'p' ? '中成药' : '汤方') + '</span>' + badgeOf(x, 'f') + '</div>';
      var meta2 = (x.user ? '用户导入' : '内置知识库') + (x.user && !x.overrides ? ' · 新增条目' : '');
      var extra2 = x.desc ? '<div class="sec"><div class="st">方解 / 详细说明</div><div class="vl">' + esc(x.desc) + '</div></div>' : '';
      host.innerHTML = '<div class="dwrap">' + backHtml + dh2 + '<div class="dmeta">' + esc(meta2) + '</div><div class="dcard">' + rows.join('') + '</div>' + extra2 + '</div>';
    }
  }

  function renderList(state) {
    var kw = state.q.value.trim().toLowerCase();
    var host = state.lbox;
    var formulas = state.all.formulas || [];
    var herbs = state.all.herbs || [];
    var out = [];

    // 西医症状映射：检索词命中映射表时，自动扩展中医术语命中 + 列表顶部提示
    // 支持前缀输入：「糖尿」即命中「糖尿病」（前缀匹配映射键）
    var west = (function () {
      if (!kw) return null;
      if (WEST_MAP[kw]) return WEST_MAP[kw];
      var keys = Object.keys(WEST_MAP).filter(function (k) { return k.indexOf(kw) === 0; });
      if (!keys.length) return null;
      var seen = {}, merged = [];
      keys.forEach(function (k) { WEST_MAP[k].forEach(function (t) { if (!seen[t]) { seen[t] = 1; merged.push(t); } }); });
      return merged;
    })();
    // 症状/证型/西医词拼音检索：纯字母输入按术语拼音表扩展为中文术语（shm→失眠、tnb→糖尿病、pxx→脾虚…）
    var pyTerms = vocabHit(state.all, kw);
    function textHit(t) {
      if (!kw) return true;
      if (t.indexOf(kw) !== -1) return true;
      if (west) { for (var i = 0; i < west.length; i++) if (t.indexOf(west[i]) !== -1) return true; }
      if (pyTerms) { for (var j = 0; j < pyTerms.length; j++) if (t.indexOf(pyTerms[j].t) !== -1) return true; }
      return false;
    }
    if (west) {
      out.push('<div class="lhead west">西医「' + esc(kw) + '」→ 中医对应：' +
        west.map(function (k) { return '<span class="wxk" data-kw="' + esc(k) + '" title="按此中医术语检索">' + esc(k) + '</span>'; }).join('') + '</div>');
    }
    if (pyTerms) {
      out.push('<div class="lhead west">拼音「' + esc(kw) + '」→ 术语：' +
        pyTerms.map(function (v) { return '<span class="wxk" data-kw="' + esc(v.t) + '" title="按此术语检索">' + esc(v.t) + '<i style="font-style:normal;opacity:.6;margin-left:3px">' + esc(v.k) + '</i></span>'; }).join('') + '</div>');
    }

    function head(label) { out.push('<div class="lhead">' + label + '</div>'); }
    function li(x, kind, idxKey) {
      var nm = x.n || x.name || '';
      var sub = kind === 'h' ? herbSub(x) : formulaSub(x);
      var src = srcOf(x, kind);
      var subHtml = sub ? '<div class="sub">' + esc(sub) + '</div>' : '';
      var srcHtml = src ? '<div class="src">' + esc(src) + '</div>' : '';
      var sel = state.sel && state.sel.kind === kind && state.sel.name === nm ? ' sel' : '';
      out.push('<div class="li' + sel + '" data-k="' + kind + '" data-n="' + esc(nm) + '">' +
        '<div class="r1"><span class="nm">' + esc(nm) + '</span>' + badgeOf(x, kind) + (kind === 'h' ? ybPill(ybOf(nm)) : '') + '</div>' + subHtml + srcHtml + '</div>');
    }

    if (state.kind === 'f' || state.kind === 'all') {
      var fs = formulas.filter(function (x) {
        if (state.fkind && (x.k || 'f') !== state.fkind) return false;
        return textHit(buildSearchText(x, 'f'));
      });
      if (state.kind === 'all') head('方剂 · ' + fs.length + ' 首');
      fs.forEach(function (x) { li(x, 'f'); });
    }
    if (state.kind === 'h' || state.kind === 'all') {
      var hs = herbs.filter(function (x) {
        if (state.cat && (x.category || '未分类') !== state.cat) return false;
        if (state.ybf) { var y = ybOf(x.n); if (!y || y.payType !== state.ybf) return false; }
        return textHit(buildSearchText(x, 'h'));
      });
      if (state.kind === 'all') head('中药 · ' + hs.length + ' 味');
      hs.forEach(function (x) { li(x, 'h'); });
    }
    var total = out.length;
    state.cnt.textContent = (state.kind === 'all' ? '共 ' : '') + total + ' 条';
    if (!out.length) {
      host.innerHTML = '<div style="padding:30px 16px;color:#a2a493;text-align:center;line-height:1.9">没有匹配条目<br><span style="font-size:11px">试试：名称 / 别名 / 功效 / 主治 / 组成 / 出处</span></div>';
    } else {
      host.innerHTML = out.join('');
    }
    host.querySelectorAll('.li').forEach(function (el) {
      el.addEventListener('click', function () {
        pushHist(state);
        state.sel = { kind: el.dataset.k, name: el.dataset.n };
        var arr = el.dataset.k === 'h' ? herbs : formulas;
        var x = arr.find(function (i) { return (i.n || i.name) === el.dataset.n; });
        renderDetail(x, el.dataset.k, state.det);
        renderList(state);
      });
    });
  }

  function mount(host, opts) {
    injectCss();
    // 重复挂载防护：移除上一份 document 级委托、清理残留弹窗节点、重置历史栈
    if (DOC_CLICK_FN) document.removeEventListener('click', DOC_CLICK_FN);
    if (DOC_KEY_FN) document.removeEventListener('keydown', DOC_KEY_FN);
    if (kModalEl && kModalEl.parentNode) kModalEl.parentNode.removeChild(kModalEl);
    kModalEl = null;
    HIST.length = 0;
    DOC_CLICK_FN = null; DOC_KEY_FN = null;
    opts = opts || {};
    host.innerHTML = '' +
      '<div class="kbs">' +
        '<div class="kb">' +
          '<input class="inp" placeholder="搜索 中药/方剂：名称 · 别名 · 功效 · 主治 · 组成 · 症状…" />' +
          '<div class="fs">' +
            '<button data-k="all" class="on">全部</button>' +
            '<button data-k="f">方剂</button>' +
            '<button data-k="h">中药</button>' +
          '</div>' +
          '<select class="ybsel" title="按医保支付类别筛选（中药）">' +
            '<option value="">医保全部</option><option>甲类</option><option>乙类</option><option>丙类</option><option>自费</option>' +
          '</select>' +
          '<span class="cnt">—</span>' +
        '</div>' +
        '<div class="chips" id="kbsSx"></div>' +
        '<div class="chips" id="kbsCat"></div>' +
        '<div class="body">' +
          '<div class="list"><div class="lbox"></div></div>' +
          '<div class="det"></div>' +
        '</div>' +
      '</div>';

    var root = host.firstElementChild;
    if (opts.height) root.style.height = opts.height + 'px';

    var state = {
      all: { herbs: [], formulas: [] },
      kind: 'all',
      cat: '',      // 中药分类筛选
      fkind: '',    // 方剂剂型筛选：''|'f'|'p'
      ybf: '',      // 医保支付类别筛选：''|甲类|乙类|丙类|自费
      q: root.querySelector('.inp'),
      cnt: root.querySelector('.cnt'),
      lbox: root.querySelector('.lbox'),
      det: root.querySelector('.det'),
      sxBar: root.querySelector('#kbsSx'),
      catBar: root.querySelector('#kbsCat'),
      sel: null
    };
    CUR_STATE = state;
    renderDetail(null, 'h', state.det);
    // 输入防抖 150ms：联想下拉 + 列表统一延后渲染，避免每键全量过滤
    state.q.addEventListener('input', function () {
      clearTimeout(state._dInT);
      state._dInT = setTimeout(function () { renderList(state); buildSug(); }, 150);
    });
    state.q.addEventListener('blur', function () { setTimeout(closeSug, 150); });
    state.q.addEventListener('keydown', function (e) { sugKey(e); });

    // ===== 搜索联想下拉：中文名 / 全拼(py) / 首字母(py0) / 别名 统一匹配，键盘↑↓回车可选 =====
    var sugEl = null, sugHits = [], sugIdx = 0;
    function closeSug() { if (sugEl) sugEl.style.display = 'none'; }
    function pickSug(it) {
      closeSug();
      if (it.kind === 't') { // 术语（症状/证型/西医词）：填入检索词列出命中条目
        pushHist(state);
        state.q.value = it.nm;
        state.sel = null;
        state.cat = ''; state.fkind = ''; state.ybf = '';
        root.querySelectorAll('.fs button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === 'all'); });
        state.sxBar.querySelectorAll('.c').forEach(function (x) { x.classList.remove('on'); });
        renderCatChips(); renderList(state);
        return;
      }
      pushHist(state);
      state.q.value = it.nm;
      state.sel = { kind: it.kind, name: it.nm };
      state.cat = ''; state.fkind = ''; state.ybf = '';
      root.querySelectorAll('.fs button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === it.kind); });
      state.sxBar.querySelectorAll('.c').forEach(function (x) { x.classList.remove('on'); });
      renderCatChips(); renderList(state);
      renderDetail(it.x, it.kind, state.det);
    }
    function buildSug() {
      var kw = state.q.value.trim().toLowerCase();
      if (!kw) { closeSug(); return; }
      var pool = [];
      ((CUR_STATE.all.formulas) || []).forEach(function (x) { pool.push({ kind: 'f', nm: x.n || '', x: x }); });
      ((CUR_STATE.all.herbs) || []).forEach(function (x) { pool.push({ kind: 'h', nm: x.n || x.name || '', x: x }); });
      sugHits = pool.filter(function (it) {
        var nm = it.nm.toLowerCase();
        var alias = ((it.x.aliases || []).concat(it.x.aka || [])).join(' ').toLowerCase();
        var py = ((it.x.py || '') + ' ' + (it.x.py0 || '')).toLowerCase();
        return nm.indexOf(kw) !== -1 || py.indexOf(kw) !== -1 || (kw.length >= 2 && alias.indexOf(kw) !== -1);
      });
      // 纯字母输入时补术语候选（症状/证型/西医词，按拼音命中），方药在前
      if (/^[a-z]+$/.test(kw)) {
        buildVocab(CUR_STATE.all).forEach(function (v) {
          if (sugHits.length >= 8) return;
          if ((v.py && v.py.indexOf(kw) !== -1) || (v.py0 && v.py0.indexOf(kw) !== -1)) sugHits.push({ kind: 't', nm: v.t, tag: v.k });
        });
      }
      sugHits = sugHits.slice(0, 8);
      if (!sugHits.length) { closeSug(); return; }
      if (!sugEl) {
        sugEl = document.createElement('div');
        sugEl.className = 'ksug';
        sugEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
        root.appendChild(sugEl);
      }
      sugEl.innerHTML = sugHits.map(function (it, i) {
        var sub = it.kind === 't' ? (it.tag || '术语') : ((it.kind === 'h' ? herbSub(it.x) : formulaSub(it.x)) || '');
        var badge = it.kind === 'f' ? '方' : it.kind === 'h' ? '药' : ({ '症状': '症', '证型': '证', '西医': '西' }[it.tag] || '术');
        return '<div class="sugi' + (i === sugIdx ? ' cur' : '') + '" data-i="' + i + '" data-k="' + it.kind + '"><span class="sk">' + badge + '</span>' + esc(it.nm) + '<span class="ss">' + esc(sub.slice(0, 24)) + '</span></div>';
      }).join('');
      var rr = root.getBoundingClientRect(), ir = state.q.getBoundingClientRect();
      sugEl.style.top = (ir.bottom - rr.top + 4) + 'px';
      sugEl.style.left = (ir.left - rr.left) + 'px';
      sugEl.style.width = ir.width + 'px';
      sugEl.style.display = 'block';
      sugEl.querySelectorAll('.sugi').forEach(function (el) {
        el.addEventListener('click', function () { pickSug(sugHits[+el.dataset.i]); });
      });
      sugIdx = 0;
    }
    function sugKey(e) {
      if (!sugEl || sugEl.style.display !== 'block') return;
      var items = sugEl.querySelectorAll('.sugi');
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (el, i) { el.classList.toggle('cur', i === sugIdx); });
      } else if (e.key === 'Enter') {
        if (items[sugIdx]) { e.preventDefault(); pickSug(sugHits[sugIdx]); }
      } else if (e.key === 'Escape') { closeSug(); }
    }
    var ybSel = root.querySelector('.ybsel');
    ybSel.addEventListener('change', function () {
      state.ybf = ybSel.value;
      state.sel = null;
      renderList(state);
    });

    // 症状直达 chips
    state.sxBar.innerHTML = '<span class="lb">症状直达</span>' + QUICK_SX.map(function (s) {
      return '<span class="c" data-sx="' + esc(s) + '">' + esc(s) + '</span>';
    }).join('');
    state.sxBar.querySelectorAll('.c').forEach(function (c) {
      c.addEventListener('click', function () {
        var on = c.classList.contains('on');
        state.sxBar.querySelectorAll('.c').forEach(function (x) { x.classList.remove('on'); });
        if (on) { state.q.value = ''; } else { c.classList.add('on'); state.q.value = c.dataset.sx; }
        state.cat = ''; state.fkind = ''; // 症状直达跨分类检索，清空分类筛选
        state.sel = null;
        renderCatChips();
        renderList(state);
      });
    });

    // 分类/剂型 chips（按页签类型渲染）
    function renderCatChips() {
      var herbs = state.all.herbs || [], formulas = state.all.formulas || [];
      var html = '';
      if (state.kind === 'h') {
        var cd = {};
        herbs.forEach(function (x) { var c = x.category || '未分类'; cd[c] = (cd[c] || 0) + 1; });
        var cats = Object.keys(cd).filter(function (c) { return c !== '未分类'; }).sort(function (a, b) { return cd[b] - cd[a]; });
        html = '<span class="c' + (state.cat ? '' : ' on') + '" data-cat="">全部 ' + herbs.length + '</span>' +
          cats.map(function (c) { return '<span class="c' + (state.cat === c ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + ' ' + cd[c] + '</span>'; }).join('');
      } else if (state.kind === 'f') {
        var np = formulas.filter(function (x) { return (x.k || 'f') === 'p'; }).length;
        html = '<span class="c' + (state.fkind ? '' : ' on') + '" data-fk="">全部 ' + formulas.length + '</span>' +
          '<span class="c' + (state.fkind === 'f' ? ' on' : '') + '" data-fk="f">汤方 ' + (formulas.length - np) + '</span>' +
          '<span class="c' + (state.fkind === 'p' ? ' on' : '') + '" data-fk="p">中成药 ' + np + '</span>';
      } else {
        html = '<span class="lb">中药分类 · 方剂剂型</span><span style="font-size:10.5px;color:#a9c4a5;line-height:22px">切到「中药」或「方剂」页签按分类筛选</span>';
      }
      state.catBar.innerHTML = html;
      state.catBar.querySelectorAll('.c').forEach(function (c) {
        c.addEventListener('click', function () {
          if (c.dataset.cat !== undefined) state.cat = c.dataset.cat;
          if (c.dataset.fk !== undefined) state.fkind = c.dataset.fk;
          state.sel = null;
          renderCatChips();
          renderList(state);
        });
      });
    }

    var fs = root.querySelectorAll('.fs button');
    fs.forEach(function (b) {
      b.addEventListener('click', function () {
        pushHist(state);
        state.kind = b.dataset.k;
        state.cat = ''; state.fkind = '';
        state.sel = null;
        fs.forEach(function (x) { x.classList.toggle('on', x === b); });
        renderCatChips();
        renderList(state);
      });
    });

    function load() {
      state.cnt.textContent = '加载中…';
      return Promise.all([
        window.qhjf.kbListAll(),
        loadYb()
      ]).then(function (res) {
        state.all = res[0] || { herbs: [], formulas: [] };
        renderCatChips();
        renderList(state);
      }).catch(function () { state.cnt.textContent = '加载失败'; });
    }
    load();
    function focusSearch(kind, kw) {
      pushHist(state);
      state.kind = kind; state.cat = ''; state.fkind = ''; state.ybf = ''; state.sel = null;
      state.q.value = kw || '';
      root.querySelectorAll('.fs button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === kind); });
      renderCatChips(); renderList(state);
    }
    // 跳到方剂页签并显示该方详情
    function gotoFormula(nm) {
      focusSearch('f', nm);
      var x = ((CUR_STATE && CUR_STATE.all.formulas) || []).find(function (v) { return v.n === nm; });
      if (x && CUR_STATE) {
        CUR_STATE.sel = { kind: 'f', name: nm };
        renderDetail(x, 'f', CUR_STATE.det);
        renderList(CUR_STATE);
      }
    }
    DOC_CLICK_FN = function (e) {
      if (!e.target.closest) return;
      var wx = e.target.closest('.wxk'); // 西医→中医映射术语点击：直接按该术语检索
      if (wx) {
        state.q.value = wx.getAttribute('data-kw');
        state.cat = ''; state.fkind = ''; state.ybf = ''; state.sel = null;
        state.sxBar.querySelectorAll('.c').forEach(function (x) { x.classList.toggle('on', x.dataset.sx === state.q.value); });
        renderCatChips(); renderList(state);
        return;
      }
      var bk = e.target.closest('.kback'); if (bk) { kModalClose(); doBack(); return; }
      var h = e.target.closest('.flink'); if (h) { herbPopup(h.getAttribute('data-h')); return; }
      var ff = e.target.closest('.flinkF'); if (ff) { kModalClose(); gotoFormula(ff.getAttribute('data-f')); return; }
      var gl = e.target.closest('.glink'); if (gl) { gPopup(gl.getAttribute('data-g')); return; }
      var sb = e.target.closest('.flinkS'); if (sb) { syndPopup(sb.getAttribute('data-s')); }
    };
    document.addEventListener('click', DOC_CLICK_FN);
    // 通用详情弹窗：中药 / 功效 / 证型 共用（kModalEl 为模块级变量，重挂载时已清理）
    function kModalShow(ht, dk, bodyHtml) {
      if (!kModalEl) {
        kModalEl = document.createElement('div');
        kModalEl.className = 'kbs hmodal-mask'; // 必须带 kbs：样式选择器为 .kbs.hmodal-mask 复合类，丢了会裸奔
        kModalEl.innerHTML = '<div class="hmodal"><div class="hhd"><span class="ht"></span><span class="dk"></span><button class="hx" title="关闭（ESC）">✕</button></div><div class="hbd"></div></div>';
        kModalEl.addEventListener('click', function (e) { if (e.target === kModalEl) kModalClose(); }); // 只点遮罩空白才关，不拦截冒泡（否则弹窗内链接委托全失效）
        kModalEl.querySelector('.hx').addEventListener('click', function () { kModalClose(); });
        document.body.appendChild(kModalEl);
      }
      kModalEl.querySelector('.ht').textContent = ht || '';
      kModalEl.querySelector('.dk').textContent = dk || '';
      kModalEl.querySelector('.hbd').innerHTML = bodyHtml;
      kModalEl.style.display = 'flex';
    }
    function kModalClose() { if (kModalEl) kModalEl.style.display = 'none'; }
    DOC_KEY_FN = function (e) { if (e.key === 'Escape' && kModalEl && kModalEl.style.display !== 'none') kModalClose(); };
    document.addEventListener('keydown', DOC_KEY_FN);
    // 组成药 / 加减药 弹窗
    function herbPopup(nm) {
      var x = (CUR_STATE && CUR_STATE.all.herbs || []).find(function (v) { return (v.n || v.name) === nm; });
      if (!x) { focusSearch('h', nm); return; } // 库中找不到时退回检索
      var tmp = document.createElement('div');
      renderDetail(x, 'h', tmp, true); // 弹窗内不放返回按钮
      kModalShow(x.n || x.name, x.category || '', tmp.innerHTML);
    }
    // 证型弹窗：主治此证型的全部方剂
    function syndPopup(sv) {
      var list = ((CUR_STATE && CUR_STATE.all.formulas) || []).filter(function (f) { return cleanArr(f.s).indexOf(sv) !== -1; });
      var body = list.length
        ? '<div class="pmeta">共 ' + list.length + ' 首方剂主治「' + esc(sv) + '」，点击查看：</div><div style="line-height:2">' + list.map(function (f) { return '<a class="flinkF" data-f="' + escAttr(f.n) + '" title="查看该方详情">' + esc(f.n) + '</a>'; }).join('') + '</div>'
        : '<div class="pmeta">知识库中没有主治「' + esc(sv) + '」的方剂</div>';
      kModalShow(sv, '证型 · 相关方剂', body);
    }
    // 功效模糊匹配评分：1=字面包含 0.9=同义词归一后包含 0.75=短语包含 ≥0.5=二字相邻词重合（方剂功效与中药功效措辞差异大，必须模糊匹配）
    function gScore(t, fx) {
      if (!fx) return 0;
      var s = String(fx);
      if (s.indexOf(t) !== -1) return 1;
      var NORM = { '益气': '补气', '熄风': '息风', '滋阴': '养阴', '滋肾': '补肾', '滋肺': '补肺', '滋脾': '补脾', '滋肝': '补肝', '滋心': '补心', '滋血': '养血', '滋肝': '补肝', '宣肺利水': '宣肺行水', '清虚热': '退虚热' };
      var norm = function (w) {
        w = ' ' + w + ' ';
        Object.keys(NORM).forEach(function (k) { w = w.split(k).join(NORM[k]); });
        return w.replace(/[的于及与、，,；;\s]/g, '');
      };
      var T = norm(t), F = norm(s);
      if (F.indexOf(T) !== -1) return 0.9;
      if (T.indexOf(F) !== -1 && F.length >= 4) return 0.75;
      var tb = [], fb = [], i, hit = 0;
      for (i = 0; i < T.length - 1; i++) tb.push(T.substr(i, 2));
      for (i = 0; i < F.length - 1; i++) fb.push(F.substr(i, 2));
      if (!tb.length || !fb.length) return 0;
      tb.forEach(function (b) { if (fb.indexOf(b) !== -1) hit++; });
      return hit / tb.length * 0.75; // 任一二字词命中即为「相近」档，≥2/3 重合升为强匹配
    }
    // 功效弹窗：三档匹配——强匹配(≥0.5) / 相近(>0) / 治法映射(G_RELATED)
    function gPopup(t) {
      var herbs = ((CUR_STATE && CUR_STATE.all.herbs) || []);
      var scored = herbs.map(function (h) { return { h: h, s: gScore(t, h.fx) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; });
      var strong = scored.filter(function (x) { return x.s >= 0.5; });
      var near = scored.filter(function (x) { return x.s < 0.5; }).slice(0, 10);
      var link = function (n) { return '<a class="flink" data-h="' + escAttr(n) + '" title="查看中药详情">' + esc(n) + '</a>'; };
      var body;
      if (strong.length) {
        body = '<div class="pmeta">共 ' + strong.length + ' 味中药功效含「' + esc(t) + '」，点击查看：</div><div style="line-height:2">' + strong.map(function (x) { return link(x.h.n || x.h.name); }).join('') + '</div>';
      } else if (near.length) {
        body = '<div class="pmeta">知识库中没有功效完全含「' + esc(t) + '」的中药，以下为功效相近的中药：</div><div style="line-height:2">' + near.map(function (x) { return link(x.h.n || x.h.name); }).join('') + '</div>';
      } else {
        var rel = (G_RELATED[t] || []).filter(function (n) { return herbs.some(function (h) { return (h.n || h.name) === n; }); });
        body = rel.length
          ? '<div class="pmeta">「' + esc(t) + '」为方剂整体治法，代表中药如下：</div><div style="line-height:2">' + rel.map(link).join('') + '</div>'
          : '<div class="pmeta">知识库中没有功效含「' + esc(t) + '」的中药</div>';
      }
      kModalShow(t, '功效 · 相关中药', body);
    }
    // 返回上一级：恢复历史栈顶快照
    function doBack() {
      var s = HIST.pop();
      if (!s) return;
      state.kind = s.kind; state.q.value = s.kw; state.cat = s.cat; state.fkind = s.fkind; state.ybf = s.ybf; state.sel = s.sel;
      root.querySelectorAll('.fs button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === state.kind); });
      state.sxBar.querySelectorAll('.c').forEach(function (x) { x.classList.toggle('on', x.dataset.sx === state.q.value); });
      var ysel = root.querySelector('.ybsel'); if (ysel) ysel.value = state.ybf;
      renderCatChips(); renderList(state);
      var x = null;
      if (state.sel) {
        var pool = state.sel.kind === 'h' ? (state.all.herbs || []) : (state.all.formulas || []);
        x = pool.find(function (v) { return (v.n || v.name) === state.sel.name; });
      }
      renderDetail(x, state.sel ? state.sel.kind : 'h', state.det);
    }
    return { reload: load, focusSearch: focusSearch };
  }

  window.KBSearch = { mount: mount };
})();
