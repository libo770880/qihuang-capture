# -*- coding: utf-8 -*-
"""
生成《岐黄鉴方 · 路演答辩问答与赠礼方案》
输出：桌面 岐黄鉴方_路演答辩与赠礼方案.docx
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = os.environ.get("QHJF_DOC_OUT") or r"C:\Users\Administrator\Desktop\岐黄鉴方_路演答辩与赠礼方案.docx"

# ============================ 配色（扁平红蓝）============================
RED = RGBColor(0xC0, 0x2A, 0x2A)      # 主色：朱红
BLUE = RGBColor(0x1F, 0x4E, 0x79)     # 辅色：靛蓝
DARK = RGBColor(0x22, 0x22, 0x22)
GREY = RGBColor(0x66, 0x66, 0x66)
LGREY = RGBColor(0x99, 0x99, 0x99)

FONT_CN = "微软雅黑"
FONT_EN = "Segoe UI"
FONT_HEI = "等线"


def set_font(run, size=10.5, bold=False, color=DARK, cn=FONT_CN, en=FONT_EN):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = en
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), en)
    rFonts.set(qn('w:hAnsi'), en)
    rFonts.set(qn('w:eastAsia'), cn)
    return run


def para(doc, text="", size=10.5, bold=False, color=DARK, cn=FONT_CN,
         align=None, before=0, after=4, line=1.55, indent=0, first=0):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    if first:
        pf.first_line_indent = Cm(first)
    if align is not None:
        p.alignment = align
    if text:
        set_font(p.add_run(text), size, bold, color, cn)
    return p


def rich(doc, segs, size=10.5, before=0, after=4, line=1.55, indent=0):
    """segs = [(text, bold, color), ...]"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    for t, b, c in segs:
        set_font(p.add_run(t), size, b, c)
    return p


def shade(el, hexcolor):
    tcPr = el.get_or_add_tcPr() if hasattr(el, 'get_or_add_tcPr') else el
    sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear')
    sh.set(qn('w:color'), 'auto')
    sh.set(qn('w:fill'), hexcolor)
    tcPr.append(sh)


def cell_border(cell, color="D9D9D9", sz=4):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), str(sz))
        e.set(qn('w:color'), color)
        borders.append(e)
    tcPr.append(borders)


def cell_text(cell, text, size=9.5, bold=False, color=DARK, align=None, cn=FONT_CN):
    cell.text = ""
    p = cell.paragraphs[0]
    pf = p.paragraph_format
    pf.space_before = Pt(2)
    pf.space_after = Pt(2)
    pf.line_spacing = 1.35
    if align is not None:
        p.alignment = align
    set_font(p.add_run(text), size, bold, color, cn)


def set_col_widths(table, widths_cm):
    table.autofit = False
    tblPr = table._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    for row in table.rows:
        for idx, w in enumerate(widths_cm):
            row.cells[idx].width = Cm(w)
    for idx, w in enumerate(widths_cm):
        table.columns[idx].width = Cm(w)


def h1(doc, num, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(20)
    pf.space_after = Pt(9)
    pf.keep_with_next = True
    # 左侧红竖条用底纹模拟
    set_font(p.add_run(f"{num}  "), 15, True, RED)
    set_font(p.add_run(text), 15, True, DARK)
    # 段落下边框
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:space'), '4')
    bottom.set(qn('w:color'), 'C02A2A')
    pbdr.append(bottom)
    pPr.append(pbdr)
    return p


def h2(doc, text, color=BLUE):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(13)
    pf.space_after = Pt(5)
    pf.keep_with_next = True
    set_font(p.add_run("▎"), 11.5, True, RED)
    set_font(p.add_run(text), 11.5, True, color)
    return p


def bullet(doc, text, indent=0.5, size=10, mark="·", color=DARK, bold_head=None):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(indent + 0.55)
    pf.first_line_indent = Cm(-0.55)
    pf.space_before = Pt(0)
    pf.space_after = Pt(3)
    pf.line_spacing = 1.5
    set_font(p.add_run(mark + " "), size, False, RED)
    if bold_head:
        set_font(p.add_run(bold_head), size, True, color)
    set_font(p.add_run(text), size, False, color)
    return p


# ============================ 问答渲染 ============================
_qno = [0]


def qa(doc, level, question, answer_blocks, tag=None):
    """level: 'A'(必答) 'B'(追问) 'C'(硬问)"""
    _qno[0] += 1
    n = _qno[0]
    colors = {"A": RGBColor(0x1F, 0x4E, 0x79), "B": RGBColor(0x2E, 0x6E, 0x4F), "C": RGBColor(0xC0, 0x2A, 0x2A)}
    labels = {"A": "必答", "B": "追问", "C": "硬问"}
    c = colors[level]

    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(11)
    pf.space_after = Pt(4)
    pf.line_spacing = 1.45
    pf.keep_with_next = True
    pf.left_indent = Cm(1.35)
    pf.first_line_indent = Cm(-1.35)
    set_font(p.add_run(f"Q{n:02d}"), 10, True, c)
    set_font(p.add_run(f"  {question}"), 10.5, True, DARK)

    if tag:
        p2 = doc.add_paragraph()
        p2.paragraph_format.left_indent = Cm(1.35)
        p2.paragraph_format.space_before = Pt(0)
        p2.paragraph_format.space_after = Pt(2)
        set_font(p2.add_run(f"〔{labels[level]}·{tag}〕"), 8.5, False, c)

    for kind, val in answer_blocks:
        if kind == "p":
            para(doc, val, size=10, indent=1.35, after=3, line=1.55)
        elif kind == "b":
            bullet(doc, val, indent=1.35, size=9.8)
        elif kind == "bh":
            bh, bd = val
            bullet(doc, bd, indent=1.35, size=9.8, bold_head=bh)
        elif kind == "quote":
            para(doc, val, size=10, bold=False, color=BLUE, indent=1.35, after=3, line=1.5)
        elif kind == "warn":
            para(doc, val, size=9.5, color=RGBColor(0x8A, 0x4B, 0x08), indent=1.35, after=3, line=1.5)


def table(doc, header, rows, widths, header_fill="1F4E79", zebra="F4F7FA",
          sizes=9.3, head_size=9.5, first_bold=True, aligns=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0]
    for i, h in enumerate(header):
        cell_border(hdr.cells[i], "1F4E79", 6)
        shade(hdr.cells[i]._tc, header_fill)
        cell_text(hdr.cells[i], h, head_size, True, RGBColor(0xFF, 0xFF, 0xFF),
                  WD_ALIGN_PARAGRAPH.CENTER)
    for ri, r in enumerate(rows):
        cells = t.add_row().cells
        for ci, v in enumerate(r):
            cell_border(cells[ci], "DCE3EA", 4)
            if zebra and ri % 2 == 1:
                shade(cells[ci]._tc, zebra)
            al = None
            if aligns and aligns[ci] == 'c':
                al = WD_ALIGN_PARAGRAPH.CENTER
            cell_text(cells[ci], v, sizes, first_bold and ci == 0,
                      DARK if ci == 0 else RGBColor(0x33, 0x33, 0x33), al)
    set_col_widths(t, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


# ============================ 页眉页脚 ============================
def add_page_deco(section):
    # 页脚
    footer = section.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(fp.add_run("岐黄鉴方 · 路演答辩手册　|　"), 8, False, LGREY)
    r = fp.add_run()
    fld1 = OxmlElement('w:fldChar'); fld1.set(qn('w:fldCharType'), 'begin')
    it = OxmlElement('w:instrText'); it.set(qn('xml:space'), 'preserve'); it.text = 'PAGE'
    fld2 = OxmlElement('w:fldChar'); fld2.set(qn('w:fldCharType'), 'end')
    r._r.append(fld1); r._r.append(it); r._r.append(fld2)
    set_font(r, 8, False, LGREY)


# ============================ 正文 ============================
doc = Document()

# 页面设置
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.top_margin = Cm(2.1)
sec.bottom_margin = Cm(2.0)
sec.left_margin = Cm(2.3)
sec.right_margin = Cm(2.3)
add_page_deco(sec)

# 默认样式
style = doc.styles['Normal']
style.font.name = FONT_EN
style.font.size = Pt(10.5)
style.element.rPr.rFonts.set(qn('w:eastAsia'), FONT_CN)

CW = 16.4  # 正文可用宽度 cm

# --------------------------- 封面 ---------------------------
para(doc, "", after=0)
para(doc, "", after=0)
para(doc, "", after=0)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run("第一届山东省中医药创新创业大赛"), 11, False, GREY)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(26)
p.paragraph_format.space_after = Pt(4)
set_font(p.add_run("岐黄鉴方"), 40, True, RED)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(26)
set_font(p.add_run("中医智能辨证质控与安全审方系统"), 13, False, BLUE)

# 分隔线
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(24)
pPr = p._p.get_or_add_pPr()
pbdr = OxmlElement('w:pBdr')
bottom = OxmlElement('w:bottom')
bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '12')
bottom.set(qn('w:space'), '1'); bottom.set(qn('w:color'), 'C02A2A')
pbdr.append(bottom); pPr.append(pbdr)
set_font(p.add_run("—" * 23), 8, False, RED)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(8)
set_font(p.add_run("路演答辩问答手册"), 25, True, DARK)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(6)
set_font(p.add_run("＋"), 13, False, LGREY)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(46)
set_font(p.add_run("合作赠礼方案说明"), 25, True, DARK)

# 封面数据条
t = doc.add_table(rows=2, cols=4)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
cover_kv = [
    ("0", "行 HIS 接口改造"), ("146 / 146", "通道对拍零差异"),
    ("4597", "条国标术语对码"), ("24 个月", "院内真实运行"),
]
for i, (big, small) in enumerate(cover_kv):
    c1 = t.cell(0, i); c2 = t.cell(1, i)
    for c in (c1, c2):
        cell_border(c, "E6E6E6", 4)
    cell_text(c1, big, 15, True, RED, WD_ALIGN_PARAGRAPH.CENTER)
    cell_text(c2, small, 8, False, GREY, WD_ALIGN_PARAGRAPH.CENTER)
set_col_widths(t, [CW / 4] * 4)

para(doc, "", after=60)

para(doc, "赛道③　中医药智造与数字创新　·　创业团队组", 11, False, GREY,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=4)
para(doc, "平原县中医院　·　岐黄鉴方团队", 11, False, GREY,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=4)
para(doc, "内部资料　·　答辩用　·　请勿外传", 9, False, LGREY,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=0)

doc.add_page_break()

# --------------------------- 使用说明 ---------------------------
h1(doc, "00", "怎么用这本册子")

para(doc, "这本册子不是稿子，是应答库。答辩现场只有 8 分钟陈述 + 3~5 分钟提问，"
          "真正决定分数的往往不是 PPT，而是提问环节的三四轮交锋。因此我们把问题按"
          "「被问到的概率」和「答砸的杀伤力」两个维度做了分级：", size=10, after=6)

table(doc,
      ["级别", "含义", "处理原则", "数量"],
      [
          ["A · 必答", "90% 会被问，答不好直接扣大分", "背熟，脱稿，60~90 秒一条", "本册 18 条"],
          ["B · 追问", "评委顺着 A 类往下挖的第二层", "记住关键数字与边界，30~50 秒", "本册 11 条"],
          ["C · 硬问", "专家/投资人专门用来探底的锋利问题", "不回避、不硬拗，给事实+边界+计划", "本册 9 条"],
      ],
      [2.6, 6.2, 6.2, 1.4],
      aligns=['c', 'l', 'l', 'c'])

h2(doc, "三条铁律")
bullet(doc, "宁可承认边界，不可编造数据。评委里一定有临床或审方背景的人，一句"
            "「我们准确率 99%」就会被追问到崩。凡拿不准的，一律回答「这个数需要现场核对，"
            "我们会后提供原始数据」。", bold_head="① 不吹数字：")
bullet(doc, "所有回答都以「你问的是 X，我们的做法是 Y，边界在 Z」三段式展开。"
            "先复述问题确认理解，再答做法，最后主动交代边界——主动交代边界比被追问出来得分高。", bold_head="② 先给结构：")
bullet(doc, "不确定就问「您是想了解技术实现，还是合规定位？」把开放问题收敛成选择题，"
            "既争取思考时间，也避免答偏。", bold_head="③ 不确定就反问：")

h2(doc, "一句话电梯稿（每条回答前可复述）")
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(0.4)
p.paragraph_format.space_before = Pt(4)
p.paragraph_format.space_after = Pt(6)
p.paragraph_format.line_spacing = 1.6
pPr = p._p.get_or_add_pPr()
pbdr = OxmlElement('w:pBdr')
left = OxmlElement('w:left')
left.set(qn('w:val'), 'single'); left.set(qn('w:sz'), '24')
left.set(qn('w:space'), '10'); left.set(qn('w:color'), 'C02A2A')
pbdr.append(left); pPr.append(pbdr)
set_font(p.add_run("我们不写代码，我们定义「对错」——把药剂科和中医科的一线规则，"
                   "变成一套能装进任何一台基层电脑、不改 HIS、数据不出院的质控工具。\n"
                   "我们提供的不是软件，是一个「临床思维」；AI 只是把它实现的笔。"),
         10.5, True, DARK)

doc.add_page_break()

# ============================ 01 项目事实卡 ============================
h1(doc, "01", "项目事实卡（所有回答的底座）")

para(doc, "答辩时最忌讳前后数字打架。下表是本册所有数字的唯一口径，回答任何问题前先对照本表。",
     size=10, after=8)

h2(doc, "1.1 已验证的工程数字")
table(doc,
      ["维度", "口径", "数据", "怎么验的"],
      [
          ["代码规模", "自研源文件数（Electron + .NET 8 双栈）", "207 个 / 5.9 万行",
           "工程目录实测统计"],
          ["跨语言一致性", "同一份业务逻辑在 JS 与 C# 两端逐字对拍", "146 / 146 场景零差异",
           "自动对拍脚本，逐字段比对"],
          ["自检覆盖", "数据层 / 浮层 / 后台 / 界面四类自动探针", "60+ 项全通过",
           "每次发版前自动跑"],
          ["术语对码", "GB/T 中医国标术语库", "4597 条（病名 1369 / 证候 2060 / 治法 1168）",
           "国标全文结构化入库"],
          ["医保编码对照", "ICD-10 与医保 2.0 双向对照", "35587 条", "对照库全量导入"],
          ["方剂知识库", "常用方剂（含组成、功效、主治）", "322 首", "教材 / 药典公开来源"],
          ["中药知识库", "药味（含别名、限量、禁忌）", "384 味", "同上"],
          ["审方规则", "配伍禁忌 / 毒性限量 / 剂量上限 / 妊娠禁忌",
           "12 类配伍 + 19 味毒性 + 45 组剂量 + 35 味妊娠",
           "药学规则库，可后台增补"],
          ["已入库病案", "本院真实病案（DIP 平台）", "16069 条", "院内 HIS 导出核对"],
      ],
      [2.9, 5.2, 4.5, 3.8])

h2(doc, "1.2 三句话定义产品")
bullet(doc, "不是「AI 看病」，是「AI 审方 + 辨证质控」。输出的是「这一条不符，依据在药典第几页」，"
            "不是「你应该开什么方」。", bold_head="定位：")
bullet(doc, "悬浮球驻留，Ctrl+Alt+V 粘贴 / 拖框 / 拍照 / 整窗四通道采集，不改 HIS、不需接口、"
            "不装服务端，拷贝即用。", bold_head="形态：")
bullet(doc, "数据全在本机 SQLite，断网可用，姓名 / 手机号 / 住院号入库前自动打码。", bold_head="数据：")

h2(doc, "1.3 我们明确不做什么（主动划界，防止被套）")
table(doc,
      ["不做", "原因"],
      [
          ["不自动诊断、不自动开方", "《医师法》处方权归执业医师，工具只做提示与留痕"],
          ["不替代医师辨证", "辨证是临床判断，工具提供的是「逻辑自洽性检查」与「出处」"],
          ["不做对外销售（现阶段）", "定位内网辅助工具，只提效不做判断；一旦商业化销售需先取得医疗器械注册证"],
          ["不上传任何数据", "院内数据主权，也是基层医院敢用的前提"],
          ["不在没有规则依据时硬判", "「不唯一绝不盲改」——纠错、审方、辨证均遵循此原则"],
      ],
      [5.6, 10.8])

doc.add_page_break()

# ============================ 02 A 类必答 ============================
h1(doc, "02", "A 类 · 必答题（18 条）")

para(doc, "这 18 条覆盖了「是什么 / 凭什么 / 有没有用 / 能不能卖」四个评委最关心的问题。"
          "现场务必脱稿，回答控制在 60~90 秒。", size=10, after=4)

qa(doc, "A", "用一句话说清楚，你们这个东西到底解决什么问题？", [
    ("p", "政策要求中药饮片处方必须审核「用药与中医诊断（病名和证型）是否相符」，"
          "但基层没有临床药师，通用审方软件只认药品说明书、读不懂「证」。"),
    ("p", "我们做的事，是把这条审核从「靠人盯」变成「靠规则算」：医生抓一段病历，"
          "系统当场告诉他——这个方子对应哪个经典方、缺哪几味、和你的证型对不对得上、"
          "有没有十八反十九畏、有没有超药典剂量、有没有踩医保限定。"),
    ("quote", "一句话：把只有名老中医才做得出来的「证-法-方-药」一致性判断，做成了一台电脑就能跑的质检。"),
    ("warn", "注意：不要说「我们帮医生看病」。说「我们帮医生在他按下保存之前，把不合规的地方指出来」。"),
], tag="开场定调")

qa(doc, "A", "为什么是你们做？三甲医院、大厂、现有审方厂商做不了吗？", [
    ("p", "三个理由，逐层递进："),
    ("bh", ("① 数据的门槛。", "4597 条 GB/T 术语、35587 条医保对照、322 首方剂、"
                              "384 味药、再加上本院积累的特有错字与形近规则——这些不是网上能爬到的，"
                              "是从药剂科一线一条条核出来的。")),
    ("bh", ("② 场景的门槛。", "大厂做的是「云 + 接口 + 招标」模式，一个县级中医院既没有接口预算，"
                              "也没法把病历数据往云上传。我们是拷贝即用、断网能跑、数据不出院。")),
    ("bh", ("③ 人的门槛。", "通用审方厂商的规则来自药品说明书，覆盖面是西药；"
                              "饮片处方的「证方相符」他们根本没有这个数据维度。")),
    ("quote", "一句话：不是我们比大厂强，是我们站在了他们不会站的位置上——一家县级中医院的药剂科。"),
], tag="差异化")

qa(doc, "A", "已经用起来了吗？还是 PPT 产品？", [
    ("p", "已经在平原县中医院药剂科真实环境日常使用，不是演示环境。"),
    ("b", "采集通道每天在跑，抓的是真实 HIS 界面上的真实处方与病历。"),
    ("b", "后台的处方点评工作台按「不规范 / 用药不适宜 / 超常」三分类做月度统计，逐张列扣分项。"),
    ("b", "配套的 DIP 分组器、特例单议、不良事件上报三个平台也在院内实际运行，共用同一套采集与脱敏底座。"),
    ("warn", "如果评委要求「现在就打开看」——现场直接开悬浮球抓一段，这是最高分的动作。"
             "因此答辩机必须预装、预置演示数据、断网可跑。"),
], tag="落地实证")

qa(doc, "A", "你的 AI 会不会瞎编？医疗场景幻觉是致命的。", [
    ("p", "这是最关键的一问，我们的答案是把 AI 关进笼子里："),
    ("bh", ("安全红线不进大模型。", "十八反十九畏、毒性药限量、超药典剂量、医保限定——"
                                     "全部走确定性规则引擎，同样输入永远同样输出，可复现、可举证、可审计。")),
    ("bh", ("大模型只做两件事。", "一是识别（把截图读成药名剂量），二是解释（把规则结论翻译成人话）。"
                                  "它永远不产生「判决」。")),
    ("bh", ("模型建议永不自动落方。", "所有输出是「建议 + 依据 + 出处」，最终是否修改由医师决定，系统留痕。")),
    ("bh", ("不确定即不判。", "纠错规则「不唯一绝不盲改」；辨证匹配不到唯一方剂时，输出「未匹配」，不猜。")),
    ("quote", "一句话：确定性的事情交给规则，模糊的事情交给模型，判决权交给医生。"),
], tag="AI 安全 · 高频")

qa(doc, "A", "不改 HIS，你们怎么拿到数据？这不是很脆弱吗？", [
    ("p", "四种通道，一条识别管线，覆盖医生实际的所有工作姿势："),
    ("b", "粘贴（Ctrl+Alt+V）——最快，文本零误差，适合电子病历。"),
    ("b", "框选——拖框选中屏幕任意区域，8 个把手可微调，适合任意 HIS 版式。"),
    ("b", "拍照——纸质处方、会诊单，走同一识别管线。"),
    ("b", "整窗——不拖框，一次抓整屏，适合病案首页这种大块内容。"),
    ("p", "为什么不做接口：一个县级中医院的 HIS 接口改造预算、厂商排期、验收周期，"
          "往往比整个项目还重。我们选择「不碰 HIS」，换来的是当天上线。"),
    ("warn", "边界要主动说：「零改造」的代价是「零结构化」——数据以文本形态进来，靠识别与纠错还原结构。"
             "当医院愿意开放接口时，我们是乐于接入的，接口是加速器不是前提。"),
], tag="技术路线")

qa(doc, "A", "中药名 OCR 本来就难，你们怎么保证识别准？", [
    ("p", "先说一句实话：OCR 一定会出错，尤其是中药名——「获/茯」「勾/钩」「川穹/川芎」"
          "是形近字的老问题，通用 OCR 对饮片处方几乎必错。所以我们不追求「一次就认对」，"
          "而是建了一条「多引擎 → 库比对 → 人工复核 → 补库」的闭环管线："),
    ("bh", ("① 五级引擎，按环境自动降档。", "PP-OCRv6（三档精度）→ RapidOCR(ONNX) → "
                                          "系统 OCR → Tesseract.js → AI 视觉大模型。"
                                          "本机有什么用什么，坏一级自动退一级，永不断档。")),
    ("bh", ("② 三档精度可调。", "tiny / small / medium，低配机用 tiny 保速度，"
                               "疑难图切 medium 保精度——同一套权重，按机器与场景选。")),
    ("bh", ("③ 复杂版式上 AI 视觉。", "列式排版、横竖混排、手写体照片、盖章遮挡——"
                                     "传统 OCR 靠切行切字，这类图会整段崩。我们把整块截图交给多模态模型直读，"
                                     "跳过版式解析，精度明显更高。")),
    ("bh", ("④ 库比对白名单，对不上就提示。", "识别出的药名必须到中药库比对：别名命中就归一，"
                                             "形近也命中不了就标「未入库」并整味列出，绝不默认它是对的。"
                                             "详见下一条。")),
    ("bh", ("⑤ 人工复核，识别结果可逐条改。", "面板上的药名、剂量、用法都是可编辑的，"
                                             "改完重跑分析；不是「AI 说什么就是什么」。")),
    ("bh", ("⑥ 纠错进库，越用越精准。", "后台「文字纠错」页把本院特有的错字、简称、版式噪声随手补，"
                                       "保存即全院生效；纠不中的自动进 AI 补库队列，药师确认一次，全院从此不再错。")),
    ("quote", "一句话：识别率不是一次性买来的，是「多引擎兜住底线 + 库比对卡住错误 + 人工复核守住质量 + 补库把它攒高」。"),
], tag="技术细节")

# ---------- Q 表格：多引擎分层 ----------
_qno[0] += 1
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  能不能具体说说，你们有几种 OCR？精度差在哪？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔必答·引擎分层〕"), 8.5, False, RGBColor(0x1F, 0x4E, 0x79))

para(doc, "五级通道，按「精度 × 速度 × 环境依赖」排布，默认全自动逐级回退：", size=10, indent=1.35, after=4)

t = doc.add_table(rows=1, cols=4)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
for i, h in enumerate(["通道", "精度定位", "适用场景", "环境依赖"]):
    cell_border(t.rows[0].cells[i], "1F4E79", 6)
    shade(t.rows[0].cells[i]._tc, "1F4E79")
    cell_text(t.rows[0].cells[i], h, 9, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)

eng_rows = [
    ["① AI 视觉大模型\n（最高精度）", "★★★★★\n复杂版式首选", "列式排版、横竖混排、\n手写体、盖章遮挡、低质照片",
     "需模型接入\n（云端 API 或本地部署）"],
    ["② PP-OCRv6 · medium\n（高精度）", "★★★★☆\n本地方案天花板", "疑难处方、模糊扫描、\n小字号密集排版", "需 Python 环境\n推理较慢"],
    ["③ PP-OCRv6 · small\n（均衡）", "★★★☆☆\n速度精度折中", "常规 HIS 电子处方、\n清晰截图", "需 Python 环境"],
    ["④ PP-OCRv6 · tiny\n（速度优先·默认）", "★★★☆☆\n实测术语命中与 medium 一致", "日常批量采集\n（处方图约 1.8s）", "需 Python 环境\n低配机也能跑"],
    ["⑤ RapidOCR (ONNX)\n（免 AVX）", "★★★☆☆\n同一套识别模型", "老旧 CPU（无 AVX 指令集）\n内存紧张的内网机", "随包内置\n装好即用"],
    ["⑥ 系统 OCR / Tesseract\n（兜底）", "★★☆☆☆\n最后一道保险", "Python 环境缺失、\n完全离线且不能装组件", "零依赖\nWindows 自带 / 随包离线"],
]
for ri, r in enumerate(eng_rows):
    cells = t.add_row().cells
    for ci, v in enumerate(r):
        cell_border(cells[ci], "DCE3EA", 4)
        if ri % 2 == 1:
            shade(cells[ci]._tc, "F4F7FA")
        cell_text(cells[ci], v, 8.5, ci == 0,
                  RED if ci in (0, 1) else (DARK if ci == 0 else RGBColor(0x33, 0x33, 0x33)),
                  WD_ALIGN_PARAGRAPH.LEFT if ci < 2 else WD_ALIGN_PARAGRAPH.LEFT)
set_col_widths(t, [4.2, 3.6, 4.6, 4.0])
para(doc, "", after=2)

para(doc, "默认策略：auto 档先按「PP-OCRv6 → RapidOCR → 系统 OCR」逐级尝试，任一级出结果就返回；"
          "医生也可以在前台或后台手动指定通道——比如遇到一张特别糊的纸质处方，直接切 AI 视觉。",
     size=9.8, indent=1.35, after=4)
para(doc, "为什么默认用 tiny：实测两张真实 HIS 图上，tiny 与 medium 的中药术语命中完全一致，"
          "而推理快约 10 倍（处方图 20.0s → 1.8s，全屏 211.6s → 20.0s），低配机差距更大。"
          "精度不是无脑堆档位，是拿实测换来的。",
     size=9.8, indent=1.35, after=6)

# ---------- Q：人工复核闭环 ----------
_qno[0] += 1
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  识别完还要人工核对？那和小护士手工录有什么区别？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔必答·人工复核〕"), 8.5, False, RGBColor(0x1F, 0x4E, 0x79))

para(doc, "区别在于「复核的是少数，录入的是全部」。四步闭环：", size=10, indent=1.35, after=3)
bullet(doc, "AI 先出一版结果，95% 以上的药名剂量直接可用，人工只需扫一眼确认。", indent=1.35, size=9.8, bold_head="① 机读：")
bullet(doc, "系统把「不确定的」标出来——库外的药名、剂量异常、用量缺失、形近疑似，"
            "只让医生看这几处，而不是从头看一遍。", indent=1.35, size=9.8, bold_head="② 标疑：")
bullet(doc, "面板上每个字段都可直接改，改完一键重跑分析（辨证 / 审方 / 一致性全部按新结果重算）。",
       indent=1.35, size=9.8, bold_head="③ 人工改：")
bullet(doc, "改动进后台「文字纠错」库，同一错误下次遇到自动改对——人工只做一次，全院永久受益。",
       indent=1.35, size=9.8, bold_head="④ 沉淀：")
para(doc, "所以人工不是「替 AI 干活」，是「替 AI 做最后一道质量确认」——工作量从「录入 20 味药」"
          "降到「核对 1~2 处存疑」，并且这个成本会随着库的积累持续下降。",
     size=9.8, indent=1.35, before=3, after=4, color=BLUE)
para(doc, "这里必须说清一个原则：这是医疗场景，我们从不主张「全自动无人复核」。"
          "复核的意义不是弥补 OCR 的不足，是医疗文书本身要求有人签字负责——系统负责快和准，医生负责最终确认。",
     size=9.8, indent=1.35, after=6)

# ---------- Q：库比对白名单过滤（核心机制）----------
_qno[0] += 1
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  怎么保证 OCR 认错的字不会混进处方？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔必答·库比对白名单〕"), 8.5, False, RGBColor(0x1F, 0x4E, 0x79))

para(doc, "这是整套识别管线里最关键的一道闸：识别出来的药名，必须到知识库里比对——"
          "对得上才当作药，对不上就明确提示，绝不默认它是对的。", size=10, indent=1.35, after=3)

para(doc, "具体是三道关卡，一道比一道严：", size=10, indent=1.35, after=4)

t = doc.add_table(rows=1, cols=4)
for i, h in enumerate(["关卡", "做什么", "通过条件", "不通过怎么办"]):
    cell_border(t.rows[0].cells[i], "1F4E79", 6)
    shade(t.rows[0].cells[i]._tc, "1F4E79")
    cell_text(t.rows[0].cells[i], h, 9, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)
gate_rows = [
    ["① 别名归一", "把 OCR 读到的词，按中药库的规范名 + 别名表逐个对照",
     "命中正名或任一条别名\n（如「川穹」→「川芎」）", "进入第②关"],
    ["② 形近兜底", "对「带剂量但没认出来」的残片，在库内做编辑距离 ≤1 的唯一匹配",
     "库内只有一个候选\n（如「炙苜草」→「炙甘草」）", "进入第③关（不猜）"],
    ["③ 白名单裁决", "两关都过不了 → 判定为「库外药/疑似错字」",
     "—", "标记「未入库」并整味列出，\n同时自动进 AI 补库队列"],
]
for ri, r in enumerate(gate_rows):
    cells = t.add_row().cells
    for ci, v in enumerate(r):
        cell_border(cells[ci], "DCE3EA", 4)
        if ri % 2 == 1:
            shade(cells[ci]._tc, "F4F7FA")
        cell_text(cells[ci], v, 8.6, ci == 0, RED if ci == 2 else (DARK if ci == 0 else RGBColor(0x33, 0x33, 0x33)))
set_col_widths(t, [2.8, 5.6, 4.4, 3.6])
para(doc, "", after=2)

para(doc, "关键的工程细节：凡是没通过白名单的药名，系统不是「留着不管」，而是三重处置——",
     size=10, indent=1.35, before=2, after=3)
bullet(doc, "在面板上单独用红框芯片列出来，标「未入库」，一眼就能看到是哪几味有问题。",
       indent=1.35, size=9.8, bold_head="① 前台明示：")
bullet(doc, "不进方剂归属计算的「命中数」，也不参与证型相符率——也就是说，可疑的药味不会污染辨证结论。",
       indent=1.35, size=9.8, bold_head="② 隔离计算：")
bullet(doc, "自动进后台「AI 补库」队列，由 AI 判定「能唯一对应库内哪一味」还是「确实是库外新药」，"
            "药师确认一次，从此这味药就认得。", indent=1.35, size=9.8, bold_head="③ 自动入队：")

para(doc, "为什么这道闸这么重要：如果系统把「获苓」当成一味新药收下来，后面所有分析全部错位——"
          "方剂反查会漏、证型核对会偏、审方会误报。所以我们宁可在识别环节「宁可报错、不可认错」，"
          "把不确定的交给人看一眼，也不让一个错误药名流进分析链。",
     size=9.8, indent=1.35, before=4, after=4, color=BLUE)
para(doc, "一句话：入库的药名必须是「见过的」，没见过的必须被看见——这就是我们降低识别错误最有效的一招。",
     size=9.8, bold=True, indent=1.35, after=6)

# ---------- Q：补库越用越准 ----------
_qno[0] += 1
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  「越用越精准」是怎么实现的？AI 补库具体补什么？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔必答·补库机制〕"), 8.5, False, RGBColor(0x1F, 0x4E, 0x79))

para(doc, "补的是「规则」，不是「模型」。这是成本最低、见效最快的路径——不用重训、不用等版本、当天生效。",
     size=10, indent=1.35, after=3)

t = doc.add_table(rows=1, cols=3)
for i, h in enumerate(["补什么", "怎么补", "生效范围 / 速度"]):
    cell_border(t.rows[0].cells[i], "1F4E79", 6)
    shade(t.rows[0].cells[i]._tc, "1F4E79")
    cell_text(t.rows[0].cells[i], h, 9, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)
bk_rows = [
    ["本院特有错字 / 简称", "在后台「文字纠错」手填一条，保存即用", "全院立即生效"],
    ["形近字对（获→茯、勾→钩）", "系统按「只有一种可能，且药名可解释」的规则自动归入待确认队列，药师审一次",
     "确认后全院生效"],
    ["别名 / 习用名（川穹→川芎）", "中药库别名字段 + 术语库双重约束，替换前后留痕", "全院立即生效"],
    ["HIS 版式噪声（页眉页脚、打印码）", "后台按院配置剔除规则，可正则可关键词", "本院所有采集通道生效"],
    ["库外新药名（AI 补库）", "纠不中的药名自动进 AI 补库队列，药师确认后正式入库", "确认一次，全院永久生效"],
]
for ri, r in enumerate(bk_rows):
    cells = t.add_row().cells
    for ci, v in enumerate(r):
        cell_border(cells[ci], "DCE3EA", 4)
        if ri % 2 == 1:
            shade(cells[ci]._tc, "F4F7FA")
        cell_text(cells[ci], v, 8.6, ci == 0, RED if ci == 0 else RGBColor(0x33, 0x33, 0x33))
set_col_widths(t, [4.6, 7.4, 4.4])
para(doc, "", after=2)

para(doc, "「不唯一绝不盲改」是这个机制的安全阀：如果一个错字同时可能对应两味药，"
          "系统不猜，直接标疑交给人。宁可多问一句，不可改错一味——改错一味药，比不识别严重得多。",
     size=9.8, indent=1.35, before=3, after=4, color=BLUE)
para(doc, "这也是我们和「纯大模型方案」的根本差异：大模型每次都在重新猜，"
          "而我们每一次纠错都会沉淀成一条可复现的规则——用得越久，越像这家医院自己的东西。",
     size=9.8, indent=1.35, after=6)

# ---------- Q：AI 视觉适用边界 ----------
_qno[0] += 1
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  什么情况下才用 AI 视觉？会不会全都走大模型更省事？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔追问·AI 视觉边界〕"), 8.5, False, RGBColor(0x2E, 0x6E, 0x4F))

para(doc, "不会。全走大模型有三个硬问题：慢、贵、不可复现。我们的取舍是「按图分路」：", size=10, indent=1.35, after=3)

t = doc.add_table(rows=1, cols=3)
for i, h in enumerate(["画面情况", "走哪条通道", "理由"]):
    cell_border(t.rows[0].cells[i], "1F4E79", 6)
    shade(t.rows[0].cells[i]._tc, "1F4E79")
    cell_text(t.rows[0].cells[i], h, 9, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)
route_rows = [
    ["规整的电子处方截图", "PP-OCRv6（默认 auto）", "快、本地、可离线、零调用成本"],
    ["列式排版 / 横竖混排", "AI 视觉", "列与行在像素上无明确边界，切行必错"],
    ["手写处方 / 纸质拍照", "AI 视觉（可先 OCR 试一版）", "字形无标准，传统 OCR 命中率低"],
    ["盖章、污损、折痕遮挡", "AI 视觉", "局部缺失下靠语义补全，OCR 只会输出乱码"],
    ["老旧机器、内网封闭", "RapidOCR / 系统 OCR", "无外网、无 GPU、无 AVX 也得能跑"],
]
for ri, r in enumerate(route_rows):
    cells = t.add_row().cells
    for ci, v in enumerate(r):
        cell_border(cells[ci], "DCE3EA", 4)
        if ri % 2 == 1:
            shade(cells[ci]._tc, "F4F7FA")
        cell_text(cells[ci], v, 8.6, ci == 0, RED if ci == 1 else (DARK if ci == 0 else RGBColor(0x33, 0x33, 0x33)))
set_col_widths(t, [4.6, 5.0, 6.8])
para(doc, "", after=2)

para(doc, "如果全走 AI 视觉，在基层的真实成本是什么：一张处方一次调用，一个科室一天几百张，"
          "一年下来是笔真金白银；而且模型版本一变，昨天的识别结果今天就复现不了。"
          "所以 AI 视觉在我们这里是「特种兵」——解决难啃的图，不是日常主力。",
     size=9.8, indent=1.35, before=3, after=4)
para(doc, "还有一层考虑：AI 视觉需要在本地协议上把处方图送出去（云端）或占用较高显存（本地）。"
          "对数据不出院要求严格的医院，我们默认本地 OCR 优先，AI 视觉按需开启、可全局关闭。",
     size=9.8, indent=1.35, after=6)

_qno[0] += 1
para(doc, "", after=0)
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  和通用审方软件比，你的优势到底是什么？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔必答·竞品对比〕"), 8.5, False, RGBColor(0x1F, 0x4E, 0x79))

para(doc, "一张表说完：", size=10, indent=1.35, after=4)
t = doc.add_table(rows=1, cols=4)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
for i, h in enumerate(["对比维度", "通用审方软件", "岐黄鉴方", "意义"]):
    cell_border(t.rows[0].cells[i], "1F4E79", 6)
    shade(t.rows[0].cells[i]._tc, "1F4E79")
    cell_text(t.rows[0].cells[i], h, 9, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)
cmp_rows = [
    ["审方依据", "药品说明书规则库", "证-法-方-药知识库 + 规则引擎", "能审饮片"],
    ["辨证审核", "不支持", "证型逐味核对，不符标红", "唯一维度"],
    ["数据与部署", "多数需上云 / 接口", "全程本地，断网可用", "县级能落"],
    ["上线周期", "接口对接，以月计", "拷贝即用，以天计", "不占预算"],
    ["迭代方式", "厂商排期驱动", "药师提规则 → 周级上线", "持续进化"],
    ["成本", "license + 年费", "院内非营利自用，零软件费", "可推广"],
]
for ri, r in enumerate(cmp_rows):
    cells = t.add_row().cells
    for ci, v in enumerate(r):
        cell_border(cells[ci], "DCE3EA", 4)
        if ri % 2 == 1:
            shade(cells[ci]._tc, "F4F7FA")
        cell_text(cells[ci], v, 8.8, ci in (0, 2),
                  RED if ci == 2 else (DARK if ci == 0 else RGBColor(0x33, 0x33, 0x33)))
set_col_widths(t, [2.9, 4.6, 5.6, 3.3])
para(doc, "", after=2)

para(doc, "补一句结论：我们不是「更好的审方软件」，我们是「唯一能审饮片的审方软件」。",
     size=10, bold=True, color=BLUE, indent=1.35, after=6)

qa(doc, "A", "这个赛道的市场有多大？县级中医院有多少家？", [
    ("p", "先说规模：全国县级中医医院约 2000 余家，社区卫生服务中心与乡镇卫生院的中医馆超过 4 万个——"
          "这是「审方能力缺口」最集中的地方。"),
    ("p", "再说需求为什么是刚性的："),
    ("b", "政策端：《医疗机构处方审核规范》要求所有处方审核通过后方可进入收费调配；山东东营已实践县域审方中心 100% 审核率 + 月度点评。"),
    ("b", "能力端：基层中医馆普遍没有专职临床药师，而饮片处方恰恰是最需要「懂证」的处方。"),
    ("b", "经济端：饮片处方的不合理使用直接对应医保基金支出，DIP 时代医院自己有动力做质量。"),
    ("quote", "但我要诚实说明：我们现阶段不靠卖软件挣钱。市场规模的真正意义是——"
              "这个缺口是政策造的、是结构性的、不会因为某一家医院不买而消失。"),
], tag="市场")

qa(doc, "A", "你们的商业模式是什么？怎么赚钱？", [
    ("p", "三步走，每一步都长在已验证的能力上，不推翻重来："),
    ("bh", ("① 现在：内网辅助工具，院内自用。", "本院及医联体内共享部署，不收软件费——"
                                            "定位是帮医生药师提效的辅助工具，不是医疗器械。")),
    ("bh", ("② 近期：共建与课题。", "以「8–20 共建」与合作课题的方式推进（数字待定，以合作方实际投入为准），"
                                    "增值方向是 DIP 卫生经济学价值分析、区域质控平台共建。")),
    ("bh", ("③ 远期：区域审方中心。", "呼应东营模式，做县域集中审方的 SaaS/私有化部署——"
                                     "但这以取得医疗器械注册证为前提。")),
    ("warn", "必须主动交代的合规前提：现阶段它是内网辅助提效工具，不销售、不替代人工判断，"
             "所以不属于需要注册的医疗器械。一旦要对外销售或产出诊断性质结论，就必须先取得注册证——"
             "这个先后顺序我们写得很清楚。这句话说出来，反而是加分项。"),
], tag="商业模式 · 高频")

qa(doc, "A", "你一个人 + AI，凭什么能撑起一个医疗软件？可持续吗？", [
    ("p", "先说事实：207 个源文件、5.9 万行代码、双技术栈（Electron 桌面 + .NET 8 WPF 宿主），"
          "全部由 AI 编码，人工逐项验收。支撑手段是工程纪律，不是意志力："),
    ("bh", ("双栈逐字对拍。", "同一份业务逻辑在 JS 与 C# 两端各写一遍，146 个场景逐字段比对，"
                             "必须零差异——这是防 AI 写飘的核心手段。")),
    ("bh", ("自动探针。", "数据层、浮层、后台、接口四类共 60+ 项自检，每次发版前全跑。")),
    ("bh", ("规则与代码分离。", "规则永远由药师和医生定义，AI 只负责实现。规则改了不用改代码。")),
    ("p", "可持续性的真实答案：这不是「一个人写医疗软件」，是「三个临床人定义对错，AI 把定义变成代码」。"
          "团队里真正稀缺的不是程序员，是愿意把二十年经验说清楚的人——而这样的人本来就在医院里。"),
], tag="团队质疑")

qa(doc, "A", "团队构成是什么？为什么评委要把奖给你们？", [
    ("p", "三个人，三种不可替代的角色："),
    ("bh", ("药 · 项目负责人（药剂科药师）", "审方规则与知识库的源头。十八反十九畏、剂量上限、医保限定、"
                                             "药名形近纠错规则，全部出自药房一线经验；负责规则验收与知识库热更新。")),
    ("bh", ("医 · 临床医生（中医科）", "辨证质控逻辑的定义者。四诊要素规范、证-法-方-药自洽校验、证型分型体系；"
                                       "用真实临床场景做需求定义与验收。")),
    ("bh", ("AI · 全部软件工程", "桌面端、识别管线、知识库引擎、审方规则引擎，全部由 AI 完成编码。")),
    ("quote", "我们不做写代码的团队，我们做定义「对错」的团队。"),
    ("warn", "如果被问「AI 写的代码版权归谁」：代码由团队自主组织、提示词编写与逐项验收，"
             "未复制任何第三方受保护代码；核心壁垒是可版权保护的知识库与规则库，权属清晰、无纠纷。"),
], tag="团队")

doc.add_page_break()

# ============================ 03 B 类追问 ============================
h1(doc, "03", "B 类 · 追问题（11 条）")

para(doc, "这些是评委顺着 A 类往下挖的第二层，通常 30~50 秒答完，关键是给出「具体的、可验证的」细节。",
     size=10, after=4)

qa(doc, "B", "「证方相符」你用什么标准判断？中医流派这么多，谁敢说自己的标准对？", [
    ("p", "我们不做流派之争，只做「可审计的一致性检查」。判断链条是："),
    ("b", "证型 → 从 GB/T 2060 条证候术语中归一，得到证素与治法方向。"),
    ("b", "方剂 → 按药物组成反查知识库，得到方名与功效主治。"),
    ("b", "比对 → 证型的治法方向 vs 方剂的功效方向，逐味计算相符程度。"),
    ("p", "而且这个判断是「软信号」而非「硬判决」：相符程度不足时只出提示（note），不计入合理率，"
          "不会被当成错误扣分。真正当硬错的，只有配伍禁忌和剂量超限这类确定性规则。"),
    ("quote", "关键点：我们把「中医流派差异」设计成了可配置的阈值，而不是写死在代码里。"),
], tag="算法逻辑")

qa(doc, "B", "你那个 146/146 零差异，听起来像自说自话。有什么意义？", [
    ("p", "它的意义不是「我们对了」，是「我们两边一样」——这是一个防退化机制。"),
    ("p", "背景：同一套业务逻辑要同时跑在 Electron（JS）和 .NET 8（C#）两个宿主上，"
          "因为有些医院的内网环境只能用其中一种。两边只要有一点不一致，"
          "就会出现「这台电脑判违规、那台电脑判合规」的事故。"),
    ("p", "做法：准备 146 个覆盖边界条件的场景（空值、全角半角、折行、跨病域、剂量重配对等），"
          "两端各跑一遍，逐字段比对 JSON 输出，必须完全一致。任何一侧改动都要重跑。"),
    ("quote", "一句话：这是给 AI 写的代码上的保险丝，不是给评委看的成绩单。"),
], tag="工程质疑")

qa(doc, "B", "为什么要做两个技术栈？是不是重复劳动？", [
    ("p", "不是选择，是现实约束。"),
    ("b", "Electron 版：体积小、迭代快、拷贝即用，适合快速铺开和自用。"),
    ("b", ".NET 8 + WebView2 版：无 Node 运行时依赖，能进一些只允许 .NET 程序的医院内网与安全策略。"),
    ("p", "两者共用同一套前端渲染层和同一个 SQLite 数据库文件——数据层完全同构，"
          "所以拔一个 U 盘在两台机器之间搬家都不丢东西。"),
    ("warn", "如果被追问「是不是为了凑工作量」：直接说两个版本的取舍——Electron 快，.NET 稳，"
             "不同医院的 IT 科给的口径不一样，我们两个都得有。"),
], tag="架构")

qa(doc, "B", "灰码诊断是什么？你们怎么处理医保编码？", [
    ("p", "医保结算里，某些诊断编码在特定条件下不予支付或需附加说明，医生开方时看不出来，"
          "到结算环节才被退回——这就是「灰码」问题。"),
    ("p", "我们的做法是把 35587 条 ICD-10 与医保 2.0 的对照关系做成本地库，"
          "在录入环节就做双向比对：医生写的诊断能不能找到对应的医保编码、"
          "这个证型在该编码下是否属于限制情形。"),
    ("p", "同一条链路上还打通了 DIP：病种分组测算、月度经营报表、高倍率低倍率病例自动筛出生成特例单议清单。"),
    ("quote", "这是我们和纯审方工具最大的不同：把「质控」这件事，从成本项接到了收益项上。"),
], tag="医保 DIP")

qa(doc, "B", "医生会不会抵触？多一个工具就多一步操作。", [
    ("p", "这个担心非常真实，我们的应对是把「额外动作」压到接近零："),
    ("b", "不改工作流：不要求医生在另一个系统里重新录入，直接抓屏幕上已有的内容。"),
    ("b", "一个快捷键：Ctrl+Alt+V 粘贴即分析，全程 2 秒内出结果。"),
    ("b", "只提醒真正需要改的：合规问题按红/黄/绿三级折叠，红线常开，其余收起，不刷屏。"),
    ("b", "结论一眼可读：面板第一行就是「这份处方有什么问题」，不要求医生读报告。"),
    ("p", "实际经验：药师的接受度最高（这本来就是他们的活）；医生的接受度取决于提示是否「值得看」——"
          "误报一次，医生就再也不看了。所以我们的规则库宁可漏报，不可误报。"),
], tag="用户接受度")

qa(doc, "B", "你们的准确率到底多少？给我一个数字。", [
    ("p", "这个问题必须分三个层面回答，混在一起说就是耍流氓："),
    ("bh", ("确定性规则（十八反十九畏、剂量上限）：", "这是查表，设计上就是 100% 可复现——"
                                                     "但覆盖率取决于库的完备度，目前 12 类配伍、19 味毒性、45 组剂量上限。")),
    ("bh", ("识别层（OCR / 视觉）：", "这是一直在爬的曲线。AI 视觉抬高起点，纠错库抬高天花板，"
                                      "本院真实处方上的可用率随使用量上升。具体数值需要现场用本院处方集回测。")),
    ("bh", ("辨证层（证方相符）：", "设计为软信号，不追求「判对」，只追求「提示得有价值」，"
                                    "并且这类提示不计入合理率统计，避免误伤。")),
    ("quote", "标准回答模板：「这个数我不能现场给，因为我们从不在没有回测样本的情况下报准确率——"
              "如果评委允许，我可以在会后用本院 100 张真实处方做一次盲测并提供原始结果。」"),
], tag="数字拷问")

qa(doc, "B", "数据安全怎么保证？医院的病历数据能给你吗？", [
    ("p", "这是基层医院敢不敢用我们的第一道门槛，四层保障："),
    ("b", "本地化：数据全存本机 SQLite，断网可用，不上传任何服务器。"),
    ("b", "脱敏：姓名 / 手机号 / 住院号在入库前自动打码。"),
    ("b", "权限与日志：后台账号按科室与角色分级，全链运行日志可追溯。"),
    ("b", "可迁移：记录、知识库、配置一键备份，一个文件拷走，数据主权在医院。"),
    ("p", "补充一个细节以证明这是真做的而不是写的：我们把运行缓存也外置到了本地缓存目录，"
          "确保换机、重装都不会把数据搅在一起；配置搬家做了「导出→空库导入→差异为 0」的自测。"),
], tag="数据安全")

qa(doc, "B", "如果 HIS 厂商封杀你们，或者医院上了集中审方系统怎么办？", [
    ("p", "分两种情况，我们的态度不一样："),
    ("bh", ("如果医院上集中审方系统：", "我们是互补不是替代。集中审方中心判的是「处方该不该发」，"
                                        "我们判的是「医生写的时候对不对」——前置在我们，阻断在他们。"
                                        "而且我们的规则库可以作为审方中心的规则来源。")),
    ("bh", ("如果厂商封杀：", "我们是屏幕级采集，不调用 HIS 接口、不侵入进程，"
                              "技术上不存在「封杀」的抓手。这也是「不改 HIS」这个选择的额外红利。")),
    ("warn", "要诚实：屏幕采集在极端安全策略下（如禁用截屏）会受影响，这类环境我们会转向接口或放弃。"),
], tag="生态风险")

qa(doc, "B", "知识库的版权你们怎么处理？药典、教材的内容能直接用吗？", [
    ("p", "分三类来源，边界很清楚："),
    ("b", "国标与医保目录：GB/T 中医术语、ICD-10 与医保 2.0 对照——国家发布的标准与目录，公开可用。"),
    ("b", "药典与教材的事实性内容：剂量上限、配伍禁忌这类「事实」，我们以结构化数据形式自建，"
               "不复制原文表述。"),
    ("b", "本院积累：形近错字规则、特有药名、纠错记录——完全自有，这是真正的壁垒。"),
    ("quote", "所以我们的表述是「核心壁垒 = 数据资产」，而不是「核心壁垒 = 算法」。"
              "算法会过时，一家医院十年的核对记录不会。"),
], tag="知识产权")

_qno[0] += 1
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(1.35)
p.paragraph_format.space_after = Pt(2)
set_font(p.add_run(f"Q{_qno[0]:02d}  这个项目能复制到其他医院吗？换一家 HIS 会不会全废？"), 10.5, True, DARK)
p2 = doc.add_paragraph()
p2.paragraph_format.left_indent = Cm(1.35)
p2.paragraph_format.space_after = Pt(4)
set_font(p2.add_run("〔追问·可复制性〕"), 8.5, False, RGBColor(0x2E, 0x6E, 0x4F))

t = doc.add_table(rows=1, cols=3)
for i, h in enumerate(["层", "内容", "换医院时"]):
    cell_border(t.rows[0].cells[i], "1F4E79", 6)
    shade(t.rows[0].cells[i]._tc, "1F4E79")
    cell_text(t.rows[0].cells[i], h, 9, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)
rep_rows = [
    ["通用层", "GB/T 4597 条、ICD 35587 条、方剂 322 首、药味 384 味、全部确定性规则", "零改动，直接带走"],
    ["适配层", "HIS 版式模板、页眉页脚剔除规则、字段位置映射", "半天到一天配置"],
    ["特有层", "本院错字、特有简称、科室与药房口径", "现场采集 + 药师确认，周级积累"],
]
for ri, r in enumerate(rep_rows):
    cells = t.add_row().cells
    for ci, v in enumerate(r):
        cell_border(cells[ci], "DCE3EA", 4)
        if ri % 2 == 1:
            shade(cells[ci]._tc, "F4F7FA")
        cell_text(cells[ci], v, 8.8, ci == 0, RED if ci == 0 else RGBColor(0x33, 0x33, 0x33))
set_col_widths(t, [2.2, 9.4, 4.8])

para(doc, "结论：80% 的能力是可以直接搬走的，20% 的适配工作量在这个量级上完全可承受——"
          "这也是为什么「县域推广」是可行的，而不是画饼。", size=10, indent=1.35, before=4, after=6)

doc.add_page_break()

# ============================ 04 C 类硬问 ============================
h1(doc, "04", "C 类 · 硬问题（9 条）")
para(doc, "这些问题听着刺耳，但往往是评委判断「这个团队是不是清醒」的关键。原则：不回避、不硬拗，"
          "给事实 + 给边界 + 给计划。", size=10, after=4)

qa(doc, "C", "你们不是学计算机的，AI 写的代码能靠谱吗？", [
    ("p", "这个问题我得先承认一半：我们确实不是计算机科班，真要说「手写十万行医疗系统」，我们做不到。"),
    ("p", "但我想说的是——我们提供的其实不是一套软件，是一个「临床思维」。"),
    ("p", "这个项目里真正难的部分，从来不是写代码，而是把「对错」说清楚："),
    ("b", "什么情况算十八反十九畏？附子配半夏到底是禁忌还是可用，分寸在哪里？"),
    ("b", "「痰瘀阻络」和「湿热内蕴」同时出现时，这个方到底对不对得上？"),
    ("b", "同样的 15g，为什么对这位患者超量、对那位患者却不超？"),
    ("p", "这些问题，程序员答不出来，代码也答不出来——只有天天在药房核方、在门诊辨证的人答得出来。"
          "而这正是我们团队三个人每天在做的事。"),
    ("quote", "所以我们做的是：把药剂科和中医科的临床思维，一条一条拆成可复现的规则，再交给 AI 去实现。"
              "AI 是笔，不是作者。"),
    ("p", "至于「AI 会不会出错」——会。所以我们从来没让它自己拿主意：安全红线全走确定性规则引擎，"
          "同样的输入永远同样的输出；模型只做识别和解释，永不自动落方；不确定就标出来交给人。"),
    ("bh", ("工程上怎么防：", "双技术栈逐字对拍 146 个场景零差异、60+ 项自动自检每次发版必跑——"
                             "这恰恰是因为我们不懂「凭感觉写代码」，所以只能靠工程纪律去验。")),
    ("warn", "如果评委继续追「那 AI 走了呢？」——答：走不掉，已经沉淀成 207 个源文件 + 5.9 万行代码 + "
             "146 组对拍用例，这些是资产不是聊天记录；而且真正不可替代的是那 4597 条术语和 322 首方剂，"
             "那是药房核出来的，不是 AI 生成的。"),
], tag="非科班 · 高频")

qa(doc, "C", "这不就是一个套了 AI 壳的规则库吗？有什么技术含量？", [
    ("p", "如果只看审方那一段，您说得对——那就是规则库，而且我们是有意这么做的，因为医疗安全不能靠概率。"),
    ("p", "但技术含量不在「有规则」，在三个地方："),
    ("b", "把非结构化的中医文本，还原成结构化的证、法、方、药——这是最难的一段，也叫语义解析。"),
    ("b", "识别管线：五种纠错机制串联，且「不唯一绝不盲改」，这在工程上比模型本身难。"),
    ("b", "跨语言双栈一致性：146 个场景零差异，这是拿工程纪律对抗 AI 的不确定性。"),
    ("quote", "我承认规则库是最有价值的部分——但它有价值恰恰因为它是规则，不是因为它聪明。"),
], tag="技术含金量")

qa(doc, "C", "你们只有一家医院在用，凭什么说能推广？", [
    ("p", "确实只有一家，这是事实。但我认为「一家」和「零家」是性质差别，「一家」和「一百家」是数量差别。"),
    ("b", "第一家证明了：在真实 HIS、真实处方、真实药师的口径下，这套东西能跑通、能每天用。"),
    ("b", "第一家也暴露了真问题：HIS 把冒号折行、别名要不要归一、列式排版剂量错配——"
               "这些只有真跑起来才会遇到，也是我们最值钱的资产。"),
    ("p", "推广路径的可行性取决于「适配成本」，我们的测算是一家医院 1 天到 1 周，"
          "这在基层工具类产品里是可以接受的量级。"),
    ("warn", "不要辩解成「马上就有十家」。答「我们现在只有一家，需要的正是这次大赛把第二、第三家变成可能」，反而更可信。"),
], tag="落地规模")

qa(doc, "C", "医疗软件没有注册证就是违规，你们怎么解释？", [
    ("p", "这个问题问得很实在，我先把这个定位说清楚，因为它是我们整个产品设计的出发点——"),
    ("p", "我们从来没有把这个东西当医疗器械，也不把它当审方系统、诊断系统。它就是医院内网里的一个辅助工具，"
          "干的事只有一件：帮医生和药师把手工复核的活干得快一点。"),
    ("bh", ("定性：内网辅助工具，不入流通渠道。", "院内网部署、院内自用、不对外销售、不收费、"
                                             "不做任何对外服务——不属于医疗器械软件的经营行为。")),
    ("bh", ("功能边界：只做效率，不做判断。", "它不诊断、不开方、不替医生决策，"
                                          "输出的是「这里可能有问题，你看看」——看到之后仍然是人工。")),
    ("bh", ("最终环节：还是人工。", "每一个提示都要医生或药师自己看、自己判、自己签字。"
                                  "系统不产生任何具有法律效力的结论，也不替代任何人。")),
    ("quote", "一句话：它是一个「看稿工具」，不是「写稿人」。就像医生写字有错别字检查，"
              "查出来改不改、怎么改，还是医生的事。"),
    ("p", "所以现阶段我们做的其实是三件事：提高效率（把翻书、核方、找依据的时间省下来）、"
          "减少疏漏（把容易漏的配伍、剂量、限定支付提示出来）、留下痕迹（便于事后复盘和点评）。"
          "这三件事都不需要注册证，因为它们都不是诊疗行为本身。"),
    ("bh", ("那什么时候需要注册证？", "如果我们哪天想把它做成对外销售的审方软件、或者要直接产出"
                                    "具有诊断结论性质的报告，那就必须走注册路径。我们在商业模式里明确写了："
                                    "商业化以取得注册证为前提——在那之前，不卖。")),
    ("warn", "这题最忌讳的说法是「我们是自用所以不受管」。正确说法是：我们做的这件事本身就不属于需要注册的范畴，"
             "边界清楚、不越线；一旦越线，我们第一个去注册。这个先后顺序不能反。"),
], tag="合规红线 · 关键")

qa(doc, "C", "说到底是人工在干活，那这个系统的价值在哪？", [
    ("p", "这个问题正好点到我们的真实定位：它确实不能替代人，它替代的是「人不该花那么多时间的那部分」。"),
    ("p", "药房核一张 20 味的饮片处方，老师傅要多少时间？翻方剂书查组成、对十八反十九畏、"
          "算每味有没有超量、看医保有没有限定、还要看证型对不对得上——一张方子十几分钟很正常。"),
    ("b", "现在这些活系统先跑一遍，几秒钟出结果，人只需要看「标红的那两三处」。"),
    ("b", "把时间从「全量核对」压到「重点复核」，效率提升是直接的、可感的。"),
    ("b", "而且它不累、不走神、不漏项——人一天看五十张会疲劳，机器不会。"),
    ("quote", "我们的价值不是「替代人工」，是「把人工用在最需要人的地方」——判断、决策、签字。"),
    ("p", "顺便说，我们从来不追求「无人化」。医疗文书必须有人负责，这是底线，不是技术限制。"
          "所以「还是人工」不是我们的短板，是我们的设计前提。"),
], tag="效率定位")

qa(doc, "C", "如果大厂明天做一个同样的产品，你们还有活路吗？", [
    ("p", "大厂真做，我们大概率打不过他们的销售和渠道。但我们判断他们短期内不会做，原因有三："),
    ("b", "市场太小且太散：2000 多家县级中医院，客单价低，改造重，不符合大厂的收入模型。"),
    ("b", "数据拿不到：证-法-方-药的知识库需要药房一线的持续核对，这不是一次性采购能解决的。"),
    ("b", "交付形态不匹配：大厂习惯交付「部署在机房 + 接口对接 + 年度服务」，而我们交付的是「拷一个文件夹」。"),
    ("p", "退一步说，如果真被抄，我们剩下的护城河是「本院十年的核对记录」和「周级迭代速度」——"
          "大厂改一条规则要排期评审，我们药师说改，当天就能生效。"),
], tag="竞争壁垒")

qa(doc, "C", "你用了 93 亿 token，这是成本还是故事？算过账吗？", [
    ("p", "是成本，而且是目前研发费用的主体。三个数字：93 亿 tokens、7.9 万轮对话、5.9 万行代码。"),
    ("p", "账怎么算的：如果按传统外包口径，5.9 万行医疗软件代码 + 双栈对拍 + 规则库结构化，"
          "投入量级在几十人月；我们用 token 费用替代了这部分人力，把「研发成本」从人天变成了用量。"),
    ("p", "但我要说清楚这笔账的另一面：token 消耗里约六成花在双栈对拍和回归自检上——"
          "也就是说，大部分钱不是用来「写」，是用来「验」。这也是我们敢让 AI 写医疗代码的原因。"),
    ("quote", "AI 可以把写代码的成本压到接近零，但它不会让「验证」变便宜——验证才是新的成本中心。"),
], tag="研发投入")

qa(doc, "C", "你们的中医水平真的够吗？AI 懂辨证吗？", [
    ("p", "AI 不懂辨证，我们的药师和医生懂——这是我们设计的前提，也是我们和「让 AI 直接开方」路线的根本分歧。"),
    ("b", "系统里没有任何一条规则是 AI「想」出来的：全部由药师和医生定义，AI 只做实现。"),
    ("b", "辨证部分只做「一致性检查」：你的诊断是 A，你开的方功效是 B，两者方向不符，提示给你——"
               "至于该开什么，系统不回答。"),
    ("b", "咨询功能（症状→证型→方药）明确标注「仅供辅助，须经执业医师核对」，并附本地知识库出处。"),
    ("quote", "我们的自我定位是：把名老中医的经验做成尺子，而不是做成医生。"),
], tag="专业性质疑")

qa(doc, "C", "这个项目你能全职做吗？毕业、工作怎么办？", [
    ("p", "诚实回答：我目前是医院在职，这个项目是在本职工作里长出来的，不是脱产创业。"),
    ("b", "优势：正因为我在医院里，才拿得到真实场景、真实数据、真实的药师与医生资源。"),
    ("b", "路径：现阶段定位院内非营利自用与科研合作，不需要全职商业化团队；"
               "若进入注册与转化阶段，会按「医院 + 公司」双主体的方式推进，届时需要独立的商业化团队。"),
    ("warn", "这个问题的得分点不是「我能全职」，而是「我知道什么时候必须全职，以及在那之前怎么活得下来」。"),
], tag="团队可持续")

qa(doc, "C", "如果我给你 100 万，你准备怎么花？", [
    ("p", "不铺渠道、不做市场、不招销售。三笔钱："),
    ("bh", ("① 回测与验证（约 40%）：", "用 3 家县级医院的真实处方做盲测，把识别率、误报率、"
                                        "漏报率做成可对外披露的报告——这是我们最缺的东西，也是最值钱的。")),
    ("bh", ("② 知识库扩产（约 40%）：", "请退休药师做规则审校，把 322 首方剂扩到 800 首以上，"
                                        "把医保限定支付规则补全。这是纯人力活，钱能直接换成壁垒。")),
    ("bh", ("③ 注册路径预研（约 20%）：", "请专业机构做辅助审方软件注册路径的可行性评估，"
                                          "明确要补哪些临床验证、周期多长、预算多少。")),
    ("quote", "一句话：这 100 万买到的是「可信度」，不是「规模」。"),
], tag="资金使用")

doc.add_page_break()

# ============================ 05 现场应对 ============================
h1(doc, "05", "现场应对：流程、话术与翻车预案")

h2(doc, "5.1 8 分钟陈述的节奏建议")
table(doc,
      ["时间", "环节", "对应页", "一句话目标"],
      [
          ["0:00–0:40", "开场痛点", "P1–P2", "先给一个真实的处方错误场景，不要先讲公司"],
          ["0:40–2:00", "问题与政策", "P13–P14", "政策是必答题，基层是答不上来的人"],
          ["2:00–4:30", "产品演示", "P3–P12", "全程放 GIF，不空口讲功能，边放边点关键动作"],
          ["4:30–6:00", "创新与差异", "P15–P18", "三句话讲完三类创新，重点砸「质控→医保收益」闭环"],
          ["6:00–7:00", "落地与数据", "P19、P22–P23", "207 文件 / 146 零差异 / 16069 病案，三个数字打住"],
          ["7:00–7:40", "商业模式与合规", "P21", "主动交代注册证红线，这一步最加分"],
          ["7:40–8:00", "团队与收尾", "P24–P25", "「懂药的人定义对错，AI 把它做成软件」"],
      ],
      [2.4, 3.2, 3.0, 7.8])

h2(doc, "5.2 翻车预案")
table(doc,
      ["现场状况", "应对"],
      [
          ["GIF / 视频放不出来", "立刻转「就地演示」：开悬浮球抓一段真实界面，2 秒出结果，比视频更有说服力。"
                              "——所以答辩机必须预装产品并预置数据。"],
          ["被问到你答不上来的数字", "「这个数我需要现场核对原始数据，会后 24 小时内提供。」然后立刻把话题"
                                 "转回你确定的部分：「但我可以确定的是……」"],
          ["评委明显不认可某个判断", "不要辩论。用「您这个角度很关键，我们确实在这一块做过取舍——」承接，"
                                "然后把取舍的理由说清楚。承认取舍比坚持正确更容易赢。"],
          ["超时被打断", "直接跳到结论页：「我直接说结论——三个数字：0 行改造、146 零差异、24 个月真实运行。」"],
          ["被问「这是不是学生作业」", "打开后台的真实运行日志与真实病案，一句话：「这是我们医院药剂科每天在用的东西。」"],
      ],
      [4.6, 11.8])

h2(doc, "5.3 三个不要")
bullet(doc, "不要说「我们准确率 99%」、「我们是全国首创」、「没有竞品」——这三句任选一句，"
            "后面的答辩就变成防守。", bold_head="不要绝对化：")
bullet(doc, "「这个我们还没做，但以后会做」如果说超过两次，评委会认为项目不成熟。"
            "改成「我们选择先做 X 不做 Y，因为 Z」，同样是没做，但听起来是判断力。", bold_head="不要空承诺：")
bullet(doc, "评委问 A，你答 B，还答了三分钟——这是最常见的失分点。听到问题先在心里复述一遍，"
            "确认后再开口。", bold_head="不要跑题：")

doc.add_page_break()

# ============================ 06 赠礼方案 ============================
h1(doc, "06", "合作赠礼方案")

para(doc, "定位说明：赠礼不是「公关费用」，是「合作的见面礼」。原则三条——"
          "① 只送与本项目强相关的、能体现专业的实物，不送烟酒、不送卡券；"
          "② 单价控制在合规慰问品范围内，可开票、可入账、可留痕；"
          "③ 赠礼对象是「合作意向方与指导专家」，不是评委（大赛评委严禁任何形式的馈赠）。",
     size=10, after=6)

p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(0.4)
p.paragraph_format.space_before = Pt(2)
p.paragraph_format.space_after = Pt(8)
pPr = p._p.get_or_add_pPr()
pbdr = OxmlElement('w:pBdr')
left = OxmlElement('w:left')
left.set(qn('w:val'), 'single'); left.set(qn('w:sz'), '24')
left.set(qn('w:space'), '10'); left.set(qn('w:color'), 'C02A2A')
pbdr.append(left); pPr.append(pbdr)
set_font(p.add_run("红线：绝不向大赛评委、工作人员赠礼。赛后再谈合作。"),
         10, True, RED)

h2(doc, "6.1 三档方案（按对象分层，不按金额堆）")

table(doc,
      ["档位", "对象", "内容", "预算/份", "场景"],
      [
          ["A · 专家敬礼", "到院指导的专家、审校知识库的老药师",
           "《岐黄鉴方·方药手册》线装本（自编，含 322 首方剂速查 + 十八反十九畏挂图）+ 手写感谢卡",
           "≤ 200 元", "上门请教、知识库审校完成后"],
          ["B · 合作伴手礼", "有意向的兄弟医院、医联体单位",
           "方药手册 + 「用药安全」磁吸书签（含常用 12 组配伍禁忌）+ 项目白皮书印刷本",
           "≤ 150 元", "院际交流、共建洽谈"],
          ["C · 参会随身礼", "路演现场、展会、沙龙的一般来宾",
           "「十八反十九畏」袖珍折页卡（可放白大褂口袋）+ 二维码（扫码看演示视频）",
           "≤ 15 元", "大赛路演现场、行业沙龙"],
      ],
      [2.2, 3.4, 6.2, 1.6, 3.0])

para(doc, "设计逻辑：三档的共同点是「都要能装进白大褂口袋、都要有临床实用价值」。"
          "一份能贴在药房墙上的配伍禁忌挂图，比一盒茶叶更能让人记住这个团队。",
     size=10, indent=1.35, before=3, after=6)

h2(doc, "6.2 重点推荐：把产品本身做成伴手礼")
para(doc, "最贴合的赠礼其实是「可用的东西」。以下三件是我们自己就能产出的，成本低、专业度极高：",
     size=10, after=4)

bullet(doc, "把系统里的 384 味药、322 首方剂、12 类配伍禁忌排成一本 A6 速查册，"
            "封面压印比赛标识。医生拿到就会用——这是最有效的产品说明书。",
       bold_head="① 方药速查手册（线装 / 胶装，A6，约 120 页）：")
bullet(doc, "A3 单页，把十八反十九畏做成可视化关系图，过塑。药房、中医科墙上贴一张，"
            "导视效果远胜任何宣传页。", bold_head="② 配伍禁忌挂图（A3 过塑）：")
bullet(doc, "两折卡，正面是「开方前 6 个自查点」，背面是二维码（跳转演示视频 + 联系方式）。"
            "成本两三元，适合大范围散发。", bold_head="③「开方前六查」口袋卡（名片大小，两折）：")

h2(doc, "6.3 赠礼与合作的挂钩话术")
para(doc, "赠礼必须和「下一步动作」绑定，否则就只是礼品：", size=10, after=4)
table(doc,
      ["对象", "送什么", "同时说的一句话"],
      [
          ["专家", "A 档 · 方药手册 + 手写卡",
           "「这本册子里的 322 首方剂，还请您帮我们看看哪几首在本院用得最多、哪几首该删——我们想做一版真正顺手的。」"],
          ["兄弟医院", "B 档 · 手册 + 白皮书",
           "「如果贵院愿意，我们可以把通用层那 80% 直接拷过来，HIS 版式我们一天配好，不收费，只想多一家真实场景。」"],
          ["参会来宾", "C 档 · 口袋卡", "「扫码能看 8 分钟演示，如果贵院中医科需要审方，欢迎随时找我。」"],
      ],
      [3.0, 4.4, 9.0])

h2(doc, "6.4 执行清单与合规留痕")
bullet(doc, "赠礼一律走医院或团队对公采购，取得正规发票，品名写「宣传品 / 印刷品」，不使用现金。"),
bullet(doc, "建立简单台账：日期、对方单位与姓名、物品名称、数量、金额、事由、经办人。"
            "台账不是防谁，是万一被问「这钱花哪儿了」能一句话答上来。"),
bullet(doc, "单价上限按所在单位公务接待与慰问品管理规定执行；不确定时选低档，"
            "「心意到」比「价值高」安全。"),
bullet(doc, "大赛期间（报名至颁奖结束）对评委、组委会成员零馈赠、零宴请。这一条不解释。"),
bullet(doc, "所有印刷品署名团队与医院，不使用患者信息、不使用未获授权的图片与处方截图。"),

h2(doc, "6.5 预算示意（首批 100 份）")
table(doc,
      ["项目", "数量", "单价", "小计", "备注"],
      [
          ["A 档 · 方药手册线装本", "10 份", "160 元", "1,600 元", "含设计打样"],
          ["B 档 · 手册 + 书签 + 白皮书", "30 份", "110 元", "3,300 元", "白皮书用数码印刷"],
          ["C 档 · 口袋卡", "200 张", "3 元", "600 元", "两折铜版纸"],
          ["配伍禁忌挂图（A3 过塑）", "50 张", "12 元", "600 元", "随 A/B 档附赠"],
          ["设计费（一次性）", "1 项", "800 元", "800 元", "手册与卡面版式"],
          ["合计", "—", "—", "6,900 元", "不含快递"],
      ],
      [5.6, 2.2, 2.2, 2.6, 3.8],
      aligns=['l', 'c', 'c', 'c', 'l'])

para(doc, "说明：以上价格为设计估算口径，实际以询价为准。首批控制在万元以内，"
          "先跑一轮看回收效果（对方是否真的在用、是否带来后续沟通），再决定是否加印。",
     size=9.5, indent=1.35, before=2, after=6)

doc.add_page_break()

# ============================ 07 附录 ============================
h1(doc, "07", "附录：一页速记卡")

para(doc, "答辩前 10 分钟只看这一页。", size=10, after=6)

h2(doc, "7.1 必备数字速查（12 个）")
t = doc.add_table(rows=3, cols=4)
nums = [("0", "行 HIS 改造"), ("146/146", "通道对拍零差异"), ("60+", "自动自检全过"),
        ("4597", "条国标术语"), ("35587", "条医保对照"), ("207", "个源文件 / 5.9 万行"),
        ("322", "首方剂 · 384 味药"), ("16069", "条病案入库"), ("24", "个月真实运行"),
        ("93 亿", "tokens 研发投入"), ("7.9 万", "轮 AI 对话"), ("3", "个临床人 × AI")]
for i, (big, small) in enumerate(nums):
    r, c = divmod(i, 4)
    for k in range(4):
        cell_border(t.cell(r, k), "E6E6E6", 4)
    cell_text(t.cell(r, c), big, 13, True, RED, WD_ALIGN_PARAGRAPH.CENTER)
    p = t.cell(r, c).add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(small), 7.5, False, GREY)
set_col_widths(t, [CW / 4] * 4)

h2(doc, "7.2 OCR 六通道速记（被问识别必用）")
table(doc,
      ["通道", "一句话定位"],
      [
          ["AI 视觉大模型", "最高精度，专治列式 / 横竖混排 / 手写 / 盖章遮挡"],
          ["PP-OCRv6 · medium", "本地方案精度天花板，疑难图用"],
          ["PP-OCRv6 · small", "均衡，常规电子处方"],
          ["PP-OCRv6 · tiny", "默认档，实测术语命中与 medium 一致，快约 10 倍"],
          ["RapidOCR (ONNX)", "老旧 CPU / 无 AVX / 内存紧张的内网机"],
          ["系统 OCR / Tesseract", "零依赖兜底，装不了任何组件的机器也能用"],
      ],
      [4.4, 12.0])
para(doc, "闭环口诀：多引擎兜住底线 → 库比对卡住错误（对不上就提示）→ 人工复核守住质量 → 纠错补库越用越准。"
          "原则：不唯一绝不盲改，宁可多问一句，不可改错一味；宁可报错，不可认错。",
     size=9.5, bold=True, color=BLUE, indent=1.35, before=2, after=6)

h2(doc, "7.3 四句话定调")
bullet(doc, "我们不做写代码的团队，我们做定义「对错」的团队。", bold_head="定位句：")
bullet(doc, "我们提供的不是软件，是一个「临床思维」——AI 只是把它实现的笔，不是作者。", bold_head="身份句：")
bullet(doc, "确定性的事交给规则，模糊的事交给模型，判决权交给医生。", bold_head="安全句：")
bullet(doc, "把质控从成本项，接到医保收益项上。", bold_head="价值句：")

para(doc, "身份句专用于「你们不懂计算机 / AI 会不会出错」这类提问——先把问题从「技术能力」"
          "转到「谁才有资格定义对错」，这一转，主动权就回来了。",
     size=9.5, color=GREY, indent=0.5, before=2, after=6)

h2(doc, "7.4 合规口径一句话")
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(0.4)
p.paragraph_format.space_before = Pt(2)
p.paragraph_format.space_after = Pt(6)
pPr = p._p.get_or_add_pPr()
pbdr = OxmlElement('w:pBdr')
left = OxmlElement('w:left')
left.set(qn('w:val'), 'single'); left.set(qn('w:sz'), '24')
left.set(qn('w:space'), '10'); left.set(qn('w:color'), 'C02A2A')
pbdr.append(left); pPr.append(pbdr)
set_font(p.add_run("内网辅助工具，只提效、不判断；结论还是人工出，责任还是人担。"
                   "——要做成对外销售的审方软件，先取得注册证。"), 10, True, RED)

h2(doc, "7.5 五个不能说")
table(doc,
      ["不能说", "改成"],
      [
          ["我们准确率 99%", "确定性规则可复现；识别率随库里积累爬升，具体数值需盲测"],
          ["全国首创 / 没有竞品", "在「饮片辨证审方 + 零改造部署」这个组合上，我们没找到同类"],
          ["AI 帮医生开方", "AI 把医生的判断走一遍质检，最终决定权在医师"],
          ["我们以后会商业化赚钱", "现阶段内网辅助工具、院内自用不销售；要做成对外销售的审方软件，必须先取得注册证"],
          ["这个很简单，谁都能做", "适配成本低是我们的优势，规则库和核对记录才是壁垒"],
      ],
      [5.6, 10.8])

h2(doc, "7.6 收尾一句")
p = doc.add_paragraph()
p.paragraph_format.left_indent = Cm(0.4)
p.paragraph_format.space_before = Pt(6)
p.paragraph_format.space_after = Pt(4)
p.paragraph_format.line_spacing = 1.7
pPr = p._p.get_or_add_pPr()
pbdr = OxmlElement('w:pBdr')
left = OxmlElement('w:left')
left.set(qn('w:val'), 'single'); left.set(qn('w:sz'), '24')
left.set(qn('w:space'), '10'); left.set(qn('w:color'), '1F4E79')
pbdr.append(left); pPr.append(pbdr)
set_font(p.add_run("让每一次辨证都有传承，让每一张处方都有防线。"), 12, True, BLUE)

para(doc, "——如果评委只记住一句话，让他记住这一句。", size=9.5, color=LGREY, indent=0.4, after=0)

doc.save(OUT)
print("OK", OUT, os.path.getsize(OUT))
