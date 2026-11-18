// renderer/strip-rules.js —— AI 识别「剔除噪音」规则的解析与执行（唯一实现）
//
// 被两处共用，避免前后端判定漂移（改这里 = 两处同时生效）：
//   · 主进程 lib/ai.js：AI 视觉识别结果落库前统一清除界面噪音
//   · 后台页面 admin.html：「AI 设置 → 自动清理噪音 → 试一试」的实时预览
// （.NET 宿主侧镜像：net/QhjfCapture/Domain/Ai.cs 的 StripRuleLists/ApplyStripRules）
//
// 规则逐行一条：
//   普通文本        → 行内剔除该片段
//   /正则/flags     → 按正则剔除片段
//   ~文本 或 ~/正则/ → 命中的整行剔除
//   # 开头          → 注释，不生效
// 剔除后为空的行自动丢弃。
(function (factory) {
  var api = (typeof module !== 'undefined' && module.exports)
    ? module.exports
    : (window.StripRules = window.StripRules || {});
  factory(api);
})(function (api) {
  var RE_RE = /^\/(.+)\/([gimsuy]*)$/s;

  /** 规则文本 → { drop:[整行剔除], cut:[行内剔除] }，元素形如 {sub:'文本'} 或 {re:/正则/} */
  api.parse = function (src) {
    var drop = [], cut = [];
    String(src || '').split('\n').map(function (s) { return s.trim(); }).forEach(function (raw) {
      if (!raw || raw.charAt(0) === '#') return;
      var isDrop = raw.charAt(0) === '~';
      var body = (isDrop ? raw.slice(1) : raw).trim();
      if (!body) return;
      var item, m = body.match(RE_RE);
      if (m) {
        try { item = { re: new RegExp(m[1], m[2]) }; }
        catch (e) { item = { sub: body }; } // 正则写错按普通文本兜底
      } else {
        item = { sub: body };
      }
      (isDrop ? drop : cut).push(item);
    });
    return { drop: drop, cut: cut };
  };

  /** 对 lines（[{text,...}]）应用规则；无规则时原样返回 */
  api.apply = function (lines, src) {
    var r = api.parse(src);
    if (!r.drop.length && !r.cut.length) return lines || [];
    var out = [];
    for (var i = 0; i < (lines || []).length; i++) {
      var l = lines[i];
      var t = String((l && l.text) || '');
      if (!t) continue;
      var hit = false;
      for (var d = 0; d < r.drop.length; d++) {
        var dr = r.drop[d];
        if (dr.re ? dr.re.test(t) : t.indexOf(dr.sub) >= 0) { hit = true; break; }
      }
      if (hit) continue;
      for (var c = 0; c < r.cut.length; c++) {
        var cu = r.cut[c];
        t = cu.re ? t.replace(cu.re, '') : t.split(cu.sub).join('');
      }
      t = t.trim();
      if (t) out.push(Object.assign({}, l, { text: t }));
    }
    return out;
  };

  /** 纯文本版（预览用）：输入一段文本，返回清理后的行数组 */
  api.applyText = function (text, src) {
    var lines = String(text || '').split('\n').map(function (t) { return { text: t }; });
    return api.apply(lines, src).map(function (l) { return l.text; });
  };
});
