// renderer/md.js - 岐黄鉴方 迷你 Markdown 渲染（安全子集：标题/列表/加粗/行内码/引用/代码块）
// 全局挂 window.MD.render(text) -> html 字符串；先转义再替换，保证不注入脚本。
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>');
  }
  function render(src) {
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    const out = [];
    let list = null, listType = null, para = [];
    const flushPara = function () {
      if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
    };
    const flushList = function () {
      if (list && list.length) { out.push('<' + listType + '>' + list.join('') + '</' + listType + '>'); }
      list = null; listType = null;
    };
    let i = 0;
    const blockTags = new Set(['p', 'ul', 'ol', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr']);
    for (i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { flushPara(); flushList(); continue; }
      // 代码块围栏
      if (/^```/.test(t)) {
        flushPara(); flushList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(esc(lines[i])); i++; }
        out.push('<pre>' + buf.join('\n') + '</pre>');
        continue;
      }
      // 标题
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        const lv = Math.min(h[1].length + 2, 6);
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        continue;
      }
      // 表格：连续以 | 开头的行（第二行 --- 分隔线则首行为表头）
      if (t.startsWith('|')) {
        flushPara(); flushList();
        const rows = [];
        while (i < lines.length) {
          const lt = lines[i].trim();
          if (!lt.startsWith('|')) break;
          // 去掉首尾 | 后按 | 切分（行内的转义 \| 先占位保护）
          const cells = lt.replace(/^\|/, '').replace(/\|\s*$/, '').split('\\|').join('\u0001').split('|').map(c => c.trim().replace(/\u0001/g, '|'));
          rows.push(cells);
          i++;
        }
        i--; // 外层 for 还会 ++，回退一行
        if (rows.length) {
          const isSep = r => r.length >= 1 && r.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')));
          let head = null;
          if (rows.length >= 2 && isSep(rows[1])) { head = rows.shift(); rows.shift(); } // 表头 + 分隔行
          let html = '<table class="md-table">';
          if (head) html += '<thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead>';
          html += '<tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
          out.push(html);
        }
        continue;
      }
      // 分隔线
      if (/^---+$/.test(t) || /^\*\*\*+$/.test(t)) {
        flushPara(); flushList(); out.push('<hr>'); continue;
      }
      // 引用
      if (/^>\s?/.test(t)) {
        flushPara(); flushList();
        out.push('<blockquote>' + inline(t.replace(/^>\s?/, '')) + '</blockquote>');
        continue;
      }
      // 无序列表
      const ul = t.match(/^[-*•]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (listType !== 'ul') { flushList(); list = []; listType = 'ul'; }
        list.push('<li>' + inline(ul[1]) + '</li>');
        continue;
      }
      // 有序列表
      const ol = t.match(/^\d+[.、]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (listType !== 'ol') { flushList(); list = []; listType = 'ol'; }
        list.push('<li>' + inline(ol[1]) + '</li>');
        continue;
      }
      flushPara(); flushList();
      // 普通文本：连续行合并为一个 <p>
      para.push(t);
    }
    flushPara(); flushList();
    return out.join('');
  }
  window.MD = { render: render };
})();
