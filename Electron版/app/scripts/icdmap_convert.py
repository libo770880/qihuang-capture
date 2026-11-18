# scripts/icdmap_convert.py - 桌面《编码对照表.xlsx》→ data/icd10-map.json
# 表结构：国临版编码 | 国临版名称 | 医保版2.0编码 | 医保版2.0名称
import json, os, sys
import openpyxl

SRC = os.path.expanduser('~/Desktop/编码对照表.xlsx')
DST = os.path.join(os.path.dirname(__file__), '..', 'data', 'icd10-map.json')

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb.worksheets[0]

rows = []
header_checked = False
for r in ws.iter_rows(values_only=True):
    if not header_checked:
        header_checked = True
        continue  # 跳过表头
    if not r or not r[0]:
        continue
    glc, gln, ybc, ybn = [str(x).strip() if x is not None else '' for x in (r[0], r[1], r[2], r[3])]
    if not glc:
        continue
    rows.append([glc, gln, ybc or glc, ybn or gln])

with open(DST, 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))

same_code = sum(1 for x in rows if x[0] == x[2])
same_name = sum(1 for x in rows if x[1] == x[3])
print(f'rows={len(rows)} same_code={same_code} diff_code={len(rows)-same_code} same_name={same_name} diff_name={len(rows)-same_name}')
print(f'-> {os.path.abspath(DST)} ({os.path.getsize(DST)//1024} KB)')
