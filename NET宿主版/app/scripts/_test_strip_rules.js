// 剔除规则引擎单测（与 lib/ai.js 同逻辑；node scripts/_test_strip_rules.js）
const cfg = { stripRules: [
  '# 示例',
  '1克*1g/g',
  '✓',
  '/^\\d+[.、]\\s*/',
  '~/^共\\d+味/',
  '~/^(用法|煎服法)[：:]/'
].join('\n') };

function parse(src) {
  const drop = [], cut = [];
  src.split('\n').map(s => s.trim()).forEach(raw => {
    if (!raw || raw.startsWith('#')) return;
    const isDrop = raw.startsWith('~');
    const body = (isDrop ? raw.slice(1) : raw).trim();
    if (!body) return;
    let item;
    const m = body.match(/^\/(.+)\/([gimsuy]*)$/s);
    if (m) { try { item = { re: new RegExp(m[1], m[2]) }; } catch (e) { item = { sub: body }; } }
    else item = { sub: body };
    (isDrop ? drop : cut).push(item);
  });
  return { drop, cut };
}
function apply(lines) {
  const { drop, cut } = parse(cfg.stripRules);
  const out = [];
  for (const l of lines) {
    let t = l.text; if (!t) continue;
    if (drop.some(d => (d.re ? d.re.test(t) : t.includes(d.sub)))) continue;
    for (const c of cut) t = c.re ? t.replace(c.re, '') : t.split(c.sub).join('');
    t = t.trim(); if (t) out.push({ text: t });
  }
  return out;
}

const input = [
  { text: '1. 党参 20g' },
  { text: '茯神 30g 1克*1g/g ✓' },
  { text: '共13味药' },
  { text: '用法：水煎服，日一剂' },
  { text: '川芎 6g' }
];
const out = apply(input);
console.log(out.map(l => l.text).join('\n'));
const ok =
  out[0].text === '党参 20g' &&   // 行首序号被正则剔除
  out[1].text === '茯神 30g' &&   // 规格列 + 对勾被片段剔除
  out.length === 3;               // 统计行/用法行被整行剔除
console.log(ok ? 'TEST_OK' : 'TEST_FAIL');
process.exit(ok ? 0 : 1);
