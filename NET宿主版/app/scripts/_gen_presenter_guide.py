# -*- coding: utf-8 -*-
"""
生成《岐黄鉴方 · 路演主讲人简明手册（零计算机基础）》
输出：桌面 岐黄鉴方_主讲人简明手册.docx
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = os.environ.get("QHJF_GUIDE_OUT") or r"C:\Users\Administrator\Desktop\岐黄鉴方_主讲人简明手册.docx"

RED = RGBColor(0xC0, 0x2A, 0x2A)
BLUE = RGBColor(0x1F, 0x4E, 0x79)
DARK = RGBColor(0x22, 0x22, 0x22)
GREY = RGBColor(0x55, 0x55, 0x55)
LGREY = RGBColor(0x8C, 0x8C, 0x8C)

FONT_CN = "微软雅黑"
FONT_EN = "Segoe UI"


def set_font(run, size=12, bold=False, color=DARK, cn=FONT_CN, en=FONT_EN):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = en
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:ascii'), en)
    rFonts.set(qn('w:hAnsi'), en)
    rFonts.set(qn('w:eastAsia'), cn)
    return run


def para(doc, text="", size=12, bold=False, color=DARK, align=None,
         before=0, after=4, line=1.6, indent=0, cn=FONT_CN):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    if align is not None:
        p.alignment = align
    if text:
        set_font(p.add_run(text), size, bold, color, cn)
    return p


def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear')
    sh.set(qn('w:color'), 'auto')
    sh.set(qn('w:fill'), hexcolor)
    tcPr.append(sh)


def cell_text(cell, text, size=10.5, bold=False, color=DARK, align=None, cn=FONT_CN):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.35
    if align is not None:
        p.alignment = align
    set_font(p.add_run(text), size, bold, color, cn)


def set_col_widths(table, widths_cm):
    table.autofit = False
    for row in table.rows:
        for i, w in enumerate(widths_cm):
            row.cells[i].width = Cm(w)
    for i, w in enumerate(widths_cm):
        table.columns[i].width = Cm(w)


def table(doc, headers, rows, widths, head_fill="C02A2A", first_bold=True, size=10.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        shade(c, head_fill)
        cell_text(c, h, size=size, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF),
                  align=WD_ALIGN_PARAGRAPH.CENTER)
    for r in rows:
        cells = t.add_row().cells
        for i, v in enumerate(r):
            cell_text(cells[i], v, size=size, bold=(first_bold and i == 0))
    set_col_widths(t, widths)
    para(doc, "", after=2)
    return t


def h1(doc, num, title):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    set_font(p.add_run(f"{num}  "), 15, True, RED)
    set_font(p.add_run(title), 15, True, BLUE)
    # 下划红线
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:space'), '3')
    bottom.set(qn('w:color'), 'C02A2A')
    pbdr.append(bottom)
    pPr.append(pbdr)
    return p


def quote(doc, text, color=BLUE, size=12):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.55
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    left = OxmlElement('w:left')
    left.set(qn('w:val'), 'single')
    left.set(qn('w:sz'), '24')
    left.set(qn('w:space'), '8')
    left.set(qn('w:color'), 'C02A2A')
    pbdr.append(left)
    pPr.append(pbdr)
    set_font(p.add_run(text), size, True, color)
    return p


def check(doc, text, size=12):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.4)
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.5
    set_font(p.add_run("□  "), size, True, RED)
    set_font(p.add_run(text), size, False, DARK)
    return p


doc = Document()
sec = doc.sections[0]
sec.page_width = Cm(21.0)
sec.page_height = Cm(29.7)
sec.left_margin = Cm(2.2)
sec.right_margin = Cm(2.2)
sec.top_margin = Cm(2.0)
sec.bottom_margin = Cm(1.9)

st = doc.styles['Normal']
st.font.name = FONT_EN
st.font.size = Pt(12)
st.element.rPr.rFonts.set(qn('w:eastAsia'), FONT_CN)

# ============================ 封面 ============================
para(doc, "", after=40)
para(doc, "路演主讲人", size=13, bold=True, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER, after=6)
para(doc, "简明操作手册", size=34, bold=True, color=RED, align=WD_ALIGN_PARAGRAPH.CENTER, after=10)
para(doc, "不用懂电脑，只要记住「三步 · 四句话」", size=14, bold=True, color=BLUE,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=30)
para(doc, "岐黄鉴方 · 中医处方智能质控与安全审方系统", size=11.5, color=GREY,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=4)
para(doc, "2026-10-28  ·  内部使用", size=11, color=LGREY, align=WD_ALIGN_PARAGRAPH.CENTER, after=40)

quote(doc, "你不需要解释它是怎么做出来的。\n你只需要让评委看见：它替医生多看了一眼。", size=13)

para(doc, "", after=30)
para(doc, "本册只回答四个问题", size=10.5, bold=True, color=LGREY, align=WD_ALIGN_PARAGRAPH.CENTER, after=6)
para(doc, "它是什么   ·   上台前检查什么   ·   台上按哪里说什么   ·   被问住了怎么接",
     size=11, color=GREY, align=WD_ALIGN_PARAGRAPH.CENTER)

doc.add_page_break()

# ============================ 01 这是什么 ============================
h1(doc, "01", "这套东西到底是什么（30 秒说清）")

para(doc, "不要讲技术。就打一个比方——", size=12, color=GREY, after=6)

quote(doc, "它像机场的安检机：行李（处方）过去，机器几秒钟扫一遍，"
          "把有问题的挑出来放到你面前。开箱检查、决定放不放行，还是人。")

table(doc,
      ["", "机器干的活", "人干的活"],
      [["过去", "医生自己一页页核对：这味药和那味药能不能一起用、量超没超、和诊断对不对得上",
        "全靠经验和记忆，忙起来就容易漏"],
       ["现在", "几秒钟扫一遍，把「配伍禁忌、剂量超限、妊娠禁忌、方证不符、味数过多、用法缺失」挑出来标红",
        "只看标红的那两三处，判断改不改、签不签字"]],
      [1.8, 8.0, 6.6], size=10.5)

para(doc, "三段话，背下来就够开场：", size=12, bold=True, color=BLUE, before=6, after=4)
para(doc, "第一句：我们把老药师把关的规矩，写成了一张机器能执行的检查表。", size=12, indent=0.5, after=3)
para(doc, "第二句：医生开完方，几秒钟先过一遍，该看的都摆到眼前。", size=12, indent=0.5, after=3)
para(doc, "第三句：它不替医生做决定，签字负责的永远是医生。", size=12, indent=0.5, after=3)

doc.add_page_break()

# ============================ 02 上台前 ============================
h1(doc, "02", "上台前 5 分钟，照着打勾")

para(doc, "这一步比背稿重要。全部打勾，台上就不会慌。", size=12, color=GREY, after=8)

check(doc, "双击桌面上的「岐黄鉴方采集助手」，屏幕右下角出现一个小圆球")
check(doc, "小圆球能拖动 —— 拖到不挡字的位置，别压在 PPT 上")
check(doc, "医院系统已经打开，并且登录着（随便点开一张有处方的页面）")
check(doc, "试一次完整流程：选中文字 → 按 Ctrl+C → 按 Ctrl+Alt+V → 看到分析结果")
check(doc, "面板左侧列表里有 3~5 条记录（让技术同事提前准备，别在台上现采）")
check(doc, "关掉微信、QQ、钉钉的弹窗；手机静音")
check(doc, "PPT 已全屏，翻页笔按一下能翻页")

para(doc, "", after=6)
para(doc, "如果第 4 条试不出来 —— 立刻找技术同事，不要带着问题上台。",
     size=11.5, bold=True, color=RED, after=4)
para(doc, "备用方案：让技术同事全程坐在第一排，你只需要说「这一页我请同事帮大家演示」。",
     size=11.5, color=GREY)

# ============================ 03 演示三步 ============================
h1(doc, "03", "台上演示：三步，照着做")

para(doc, "全程只碰三个动作，不要临场发挥。", size=12, color=GREY, after=8)

table(doc,
      ["", "手上做什么", "嘴上说什么"],
      [["第 1 步\n复制",
        "在医院系统里，用鼠标选中一段病历或一张处方文字，按 Ctrl+C",
        "「这是一张真实的门诊处方，20 味药。平时医生要花十几分钟核对。」"],
       ["第 2 步\n采集",
        "按 Ctrl+Alt+V（两个键一起按）。\n不想记快捷键：点右下角小圆球 → 点「粘贴采集」",
        "「现在按一下快捷键，内容就进来了 —— 不用改医院系统，不用装接口。」"],
       ["第 3 步\n看结果",
        "等几秒钟，面板自己弹出来。用鼠标指着屏幕从上往下讲",
        "「结果出来了。最上面是结论，中间是方子，下面标红的是要注意的地方。」"]],
      [2.0, 6.4, 8.0], size=10.5)

para(doc, "只有这三种情况才需要点鼠标：", size=12, bold=True, color=BLUE, before=4, after=4)
para(doc, "① 想换一条记录看 —— 点左边列表里的另一条；", size=11.5, indent=0.5, after=2)
para(doc, "② 想给大家看「问题在哪」—— 点上方的数字方块，页面会自动滚到那一条并闪烁；", size=11.5, indent=0.5, after=2)
para(doc, "③ 想展示中医辨证 —— 点右上角「脉 辨证咨询」，选一个证型看推荐方。", size=11.5, indent=0.5, after=2)

para(doc, "", after=4)
para(doc, "不要碰的地方：后台管理、设置、任何带「删除」字样的按钮。", size=11.5, bold=True, color=RED)

# ============================ 04 屏幕五块 ============================
h1(doc, "04", "屏幕从上到下，五块内容怎么讲")

table(doc,
      ["位置", "它是什么", "你的一句话"],
      [["最上面\n大字",
        "一句话结论。绿色＝基本没问题；橙红色＝有需要关注的地方",
        "「先看结论：这一张需要关注，问题在下面标红的地方。」"],
       ["三块\n数字",
        "① 方证支撑：开的方子和诊断对不对得上\n② 知识库命中：多少味药是我们药典里有的\n③ 需关注：几条问题",
        "「这三个数字是给医生看的体检指标，点一下就能跳到对应位置。」"],
       ["中间\n方子",
        "方名、每一味药、剂量、用法",
        "「这就是原方，和医院系统里一字不差 —— 我们不改一个字。」"],
       ["标红\n条目",
        "具体问题：配伍禁忌、剂量超限、妊娠禁忌、方证不符、味数过多、用法缺失",
        "「标红的这几条，就是刚才说的安检挑出来的东西。」"],
       ["最下面\nAI 解读",
        "一段大白话解释（可看可不看）",
        "「最后这段是给年轻医生看的解释，老医生一般直接看上面。」"]],
      [2.2, 7.4, 6.8], size=10.5)

para(doc, "评委问「这一屏都是什么意思」时，就按这个顺序从上往下指一遍，不要跳着讲。",
     size=11.5, color=GREY)

# ============================ 05 换词表 ============================
h1(doc, "05", "这八个词，千万别说（换成人话）")

table(doc,
      ["别说这个", "改成这样说"],
      [["文字识别 / OCR", "「就像手机扫一扫，把纸上的字读进来」"],
       ["大模型 / AI 模型 / token", "「一个读过很多医案的助手」"],
       ["本地部署 / 离线运行", "「装在医院自己的电脑上，拔了网线也能用」"],
       ["接口 / 对接 HIS", "「不用改医院系统，装个软件就能用」"],
       ["算法 / 规则引擎", "「把老药师把关的规矩，写成一张检查表」"],
       ["数据库 / 知识库", "「一本收着 385 味药、322 首方子的药典」"],
       ["幻觉 / 准确率 / 召回率", "「它也会猜错，所以最后一定是医生拍板」"],
       ["准确率 99%", "「它先过一遍，人只看标红的那几处」"]],
      [5.6, 10.8], size=11)

para(doc, "记不住就记一条：凡是英文词、凡是百分比，一律换成一个生活里的东西。",
     size=11.5, bold=True, color=BLUE, before=4)

# ============================ 06 三句话 ============================
h1(doc, "06", "被问住时，只用这三句话")

para(doc, "评委的问题你听不懂，不是你的问题。硬答才是问题。", size=12, color=GREY, after=8)

table(doc,
      ["场景", "你就说"],
      [["问技术细节\n（用什么模型、什么架构、多少行代码）",
        "「这个技术细节我请我们工程师回答。我先说它解决了什么问题 ——\n"
        "医生不用改习惯，几秒钟多一道检查。」"],
       ["问「AI 会不会出错」",
        "「一定会。所以它只提示、不做决定；标出来的地方，改不改是医生说了算。」"],
       ["问「数据安全吗」",
        "「全部存在医院这台电脑里，不出院、不上云，断网也能用。」"]],
      [5.4, 11.0], size=11)

para(doc, "", after=4)
para(doc, "保命一句（真的听不懂时就说这句）：", size=12, bold=True, color=RED, after=3)
quote(doc, "「这个我不敢乱讲，怕说错。请我们技术同事来回答。」", size=12.5)
para(doc, "说完笑一下，把话筒递过去。评委记住的是你的诚实，不是你答不上来。",
     size=11.5, color=GREY, after=4)

doc.add_page_break()

# ============================ 07 翻车 ============================
h1(doc, "07", "万一当场翻车，怎么办")

table(doc,
      ["出了什么", "怎么办", "别说"],
      [["按了没反应\n面板不出来",
        "点右下角小圆球 → 点「粘贴采集」试一次。\n还不行就切回 PPT，说「这一页我讲设计思路」，"
        "演示交给技术同事补",
        "「不好意思稍等」「这电脑有问题」"],
       ["结果看着不对",
        "如果是提前准备的问题处方：「这一份是我们特意留的问题样本，正好能看出它挑错的能力。」\n"
        "如果不是：「这一份确实有问题，我换一份正常的给您看。」",
        "「不可能啊」「刚才还好好的」"],
       ["软件卡住 / 闪退",
        "双击桌面图标重启，30 秒回来。期间讲下一页 PPT，语速放慢",
        "「崩了」「这软件不稳定」"],
       ["投影没信号",
        "按 Windows 键 + P，选「复制」；不行就叫工作人员",
        "现场自己钻到桌子底下接线"]],
      [3.4, 8.6, 4.4], size=10.5)

para(doc, "一条铁律：台上永远不要修电脑。超过 20 秒没解决，就交给技术同事，你继续讲。",
     size=11.5, bold=True, color=RED, before=2)

# ============================ 08 速记 ============================
h1(doc, "08", "一页速记（打印出来拿在手上）")

para(doc, "三 步", size=13, bold=True, color=RED, before=2, after=3)
para(doc, "选中文字 → Ctrl+C　→　Ctrl+Alt+V　→　等几秒看结果", size=13, indent=0.5, after=6)

para(doc, "四 句 话", size=13, bold=True, color=RED, after=3)
para(doc, "① 它是安检，不是医生。", size=12.5, indent=0.5, after=2)
para(doc, "② 机器只提示，签字的是医生。", size=12.5, indent=0.5, after=2)
para(doc, "③ 数据不出医院这台电脑，断网也能用。", size=12.5, indent=0.5, after=2)
para(doc, "④ 不用改医院系统，装个软件就能用。", size=12.5, indent=0.5, after=8)

para(doc, "三 个 数 字", size=13, bold=True, color=RED, after=3)
para(doc, "385 味中药　·　322 首方剂　·　4597 条中医术语", size=12.5, indent=0.5, after=8)

para(doc, "一 句 收 尾", size=13, bold=True, color=RED, after=3)
quote(doc, "「我们不是让机器替医生开方，是让每一位医生，都多一双看过几万张方的眼睛。」", size=12.5)

para(doc, "", after=10)
para(doc, "本册只讲「怎么讲、怎么按」。技术细节与答辩深水区，见《路演答辩与赠礼方案》第 02–04 章。",
     size=10, color=LGREY, align=WD_ALIGN_PARAGRAPH.CENTER)

doc.save(OUT)
print("saved:", OUT)
print("段落:", len(doc.paragraphs), "表格:", len(doc.tables))
