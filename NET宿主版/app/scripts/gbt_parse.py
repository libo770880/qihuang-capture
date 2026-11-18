# -*- coding: utf-8 -*-
# 解析《中医病证分类与代码》GB/T 15657-2021.pdf → 结构化 JSON
# 输出: { disease:[], syndrome:[], therapy:[] }  每条 {seq,code,name,aliases[]}
# 列模型(每页表格竖线): col1序号 col2代码 col3名称 col4可选用词
# B证候页: 代码列可能与证名同格连写(正则剥离); 名称/别名均可折行续行(无序号行续拼)。
import pdfplumber, json, re

SRC = r'F:/微信聊天记录/xwechat_files/meiker_cfb1/msg/file/2026-09/《中医病证分类与代码》GBT 15657-2021.pdf'
OUT = 'data/gbt-15657.json'

CODE_RE = re.compile(r'^([A-Z]\d{2}(?:\.\d{1,3})*\.?)\s*(.*)$')
SEQ_RE = re.compile(r'^\d{1,5}$')
LINE_GAP = 11.0   # 同一行内列错位<=8pt, 相邻行距约13.5pt

def col_boundaries(pg):
    xs = sorted({round(v['x0']) for v in (pg.lines or [])} | {round(v['x0']) for v in (pg.rects or [])})
    if len(xs) < 5:
        return None
    return xs[:5]

def main():
    pdf = pdfplumber.open(SRC)
    out = {'disease': [], 'syndrome': [], 'therapy': []}
    cur = None          # 当前记录
    last_bound = None

    def new_record(seq, code, nm, alias_txt):
        nonlocal cur
        rec = {'seq': seq, 'code': code, 'name': nm, 'aliasesRaw': alias_txt}
        cur = rec
        part = 'disease' if code.startswith('A') else ('syndrome' if code.startswith('B') else 'therapy')
        out[part].append(rec)

    for pno, pg in enumerate(pdf.pages):
        words = pg.extract_words(x_tolerance=1)
        if not words:
            continue
        bound = col_boundaries(pg) or last_bound
        if bound:
            last_bound = bound
        else:
            continue
        v1, v2, v3, v4 = bound[1], bound[2], bound[3], bound[4]

        # 行聚类: 相邻词 top 差 > LINE_GAP 视为换行
        words.sort(key=lambda w: (w['top'], w['x0']))
        groups = []
        for w in words:
            if groups and (w['top'] - groups[-1]['anchor']) <= LINE_GAP:
                groups[-1]['ws'].append(w)
            else:
                groups.append({'anchor': w['top'], 'ws': [w]})

        def colof(x0):
            if x0 < v1: return 1
            if x0 < v2: return 2
            if x0 < v3: return 3
            return 4

        for g in groups:
            ws = sorted(g['ws'], key=lambda w: w['x0'])
            cells = {1: '', 2: '', 3: '', 4: ''}
            for w in ws:
                cells[colof(w['x0'])] += w['text']
            seq_raw, code_raw, name_raw, alias_raw = cells[1].strip(), cells[2].strip(), cells[3].strip(), cells[4].strip()

            if ('代码' in (seq_raw + code_raw) and ('名' in (code_raw + name_raw) or '证' in (code_raw + name_raw))) or '可选用词' in ''.join(cells.values()):
                continue
            if SEQ_RE.match(seq_raw) and re.match(r'^[A-Z]\d{2}', code_raw):
                # 新记录: 代码列与名称列拼合后剥离代码
                m = CODE_RE.match(code_raw)
                code = m.group(1) if m else code_raw
                nm = ((m.group(2) if m else '') + name_raw).strip()
                if not nm:
                    continue
                new_record(int(seq_raw), code, nm, alias_raw)
                continue
            if not cur:
                continue
            if not SEQ_RE.match(seq_raw) and not re.match(r'^[A-Z]\d{2}', code_raw):
                # 续行: 名称折行(col2残段/col3) 或 别名折行(col4)
                seg_name = (code_raw + name_raw).strip()
                if seg_name:
                    cur['name'] += seg_name
                if alias_raw:
                    cur['aliasesRaw'] += alias_raw
            # 其它(如页眉孤词)忽略

    pdf.close()

    result = {}
    for k, arr in out.items():
        for it in arr:
            raw = it.pop('aliasesRaw', '')
            # 首行别名也可能以；结尾带出续行, split 后过滤空段与等于正名的
            its = [a.strip() for a in re.split(r'[；;]', raw) if a.strip()]
            it['aliases'] = [a for a in its if a != it['name']]
        result[k] = arr
        print(k, 'entries=', len(arr))

    with open(OUT, 'w', encoding='utf8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print('saved ->', OUT)

if __name__ == '__main__':
    main()
