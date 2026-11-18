# -*- coding: utf-8 -*-
# scripts/_make_paper_rx.py - 生成「纸质处方笺手机拍照」样张（伪摄像头画面用）
# 输出 .probe/paper-rx.png：纸面 + 轻微旋转 + 桌面阴影 + 暗角，模拟手持拍照质感
import math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".probe", "paper-rx.png")
KAI = "C:/Windows/Fonts/simkai.ttf"     # 楷体（近手写处方体）
FANG = "C:/Windows/Fonts/simfang.ttf"   # 仿宋（表单印刷体）
MSYH = "C:/Windows/Fonts/msyh.ttc"

random.seed(7)
W, H = 1180, 1560                       # 纸张（竖版 A5 比例）
f_head = ImageFont.truetype(KAI, 64)
f_sub = ImageFont.truetype(FANG, 34)
f_lb = ImageFont.truetype(FANG, 36)
f_rx = ImageFont.truetype(KAI, 46)
f_rx2 = ImageFont.truetype(KAI, 40)
f_foot = ImageFont.truetype(FANG, 32)

# ---------- 纸面 ----------
paper = Image.new("RGB", (W, H), (248, 243, 228))
d = ImageDraw.Draw(paper)
# 纸纹噪点
for _ in range(2600):
    x, y = random.randrange(W), random.randrange(H)
    g = random.randint(-6, 6)
    d.point((x, y), fill=(248 + g, 243 + g, 228 + g))
# 顶部红色头
d.rectangle([0, 0, W, 12], fill=(178, 44, 38))
cx = W // 2
d.text((cx, 78), "岐黄鉴方中医医院", font=f_head, fill=(178, 44, 38), anchor="mm")
d.text((cx, 156), "普 通 处 方 笺", font=f_sub, fill=(90, 60, 40), anchor="mm")
d.line([70, 205, W - 70, 205], fill=(178, 44, 38), width=3)
# 基本信息两列
info = [
    ("姓名：周某某", "性别：女　年龄：47岁"),
    ("科别：骨伤科", "日期：2026-10-21"),
    ("门诊号：MZ2026091203", "临床诊断：腰痹病（气滞血瘀证）"),
]
y = 268
for l, r in info:
    d.text((90, y), l, font=f_lb, fill=(50, 46, 40))
    d.text((W // 2 + 40, y), r, font=f_lb, fill=(50, 46, 40))
    y += 66
d.line([70, y + 6, W - 70, y + 6], fill=(120, 110, 95), width=2)
y += 42
d.text((90, y), "Rp：", font=f_rx, fill=(30, 28, 24)); y += 84
# 药味（楷体，模拟手写）
rows = [
    "杜仲 12g　　桑寄生 15g　　川断 12g",
    "牛膝 9g　　 独活 9g　　   当归 12g",
    "延胡索 9g　 狗脊 12g　　  伸筋草 15g",
    "甘草 6g",
]
for row in rows:
    # 每行轻微起伏，像手写
    wobble = math.sin(y / 130) * 2.2
    d.text((120, y + wobble), row, font=f_rx2, fill=(28, 26, 22))
    y += 78
y += 30
d.text((120, y), "医嘱：水煎400ml，日一剂，早晚温服 × 7剂", font=f_rx2, fill=(28, 26, 22))
# 底部签名区
d.line([70, H - 210, W - 70, H - 210], fill=(120, 110, 95), width=2)
d.text((90, H - 170), "医师：王XX　　　　审核/调配：　　　　金额：￥46.30", font=f_foot, fill=(70, 64, 55))
d.text((90, H - 110), "（本处方当日有效）", font=f_foot, fill=(150, 60, 50))
# 红章
stamp = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
sd = ImageDraw.Draw(stamp)
sd.ellipse([8, 8, 292, 292], outline=(196, 40, 34, 200), width=7)
sd.text((150, 118), "岐黄鉴方", font=ImageFont.truetype(KAI, 52), fill=(196, 40, 34, 190), anchor="mm")
sd.text((150, 186), "中医骨伤科", font=ImageFont.truetype(KAI, 40), fill=(196, 40, 34, 175), anchor="mm")
stamp = stamp.rotate(-14, expand=True, resample=Image.BICUBIC)
paper.paste(stamp, (W - 400, H - 430), stamp)

# ---------- 拍照感：旋转 + 阴影 + 桌面 + 暗角 ----------
ANG = -2.4
big = paper.rotate(ANG, expand=True, resample=Image.BICUBIC)
DW, DH = 1280, 1600
desk = Image.new("RGB", (DW, DH), (38, 41, 36))
dd = ImageDraw.Draw(desk)
for _ in range(1800):  # 桌面纹理
    x, y = random.randrange(DW), random.randrange(DH)
    g = random.randint(-5, 5)
    dd.point((x, y), fill=(38 + g, 41 + g, 36 + g))
px, py = (DW - big.width) // 2, (DH - big.height) // 2
shadow = Image.new("RGBA", (DW, DH), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rectangle([px + 16, py + 22, px + big.width + 16, py + big.height + 22], fill=(0, 0, 0, 130))
desk.paste(Image.alpha_composite(desk.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(14))).convert("RGB"), (0, 0))
desk.paste(big, (px, py))
# 暗角 + 轻微亮度渐变（手机拍照）
vig = Image.new("L", (DW, DH), 0)
vd = ImageDraw.Draw(vig)
for i in range(240):
    a = int(150 * (i / 240) ** 2)
    vd.rectangle([i * DW // 480 - 1, i * DH // 600 - 1, DW - i * DW // 480 + 1, DH - i * DH // 600 + 1], outline=a)
vig = vig.filter(ImageFilter.GaussianBlur(60))
desk = Image.composite(Image.new("RGB", (DW, DH), (12, 14, 12)), desk, vig.point(lambda v: v // 2))
desk = desk.filter(ImageFilter.GaussianBlur(0.4))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
desk.save(OUT)
print("saved", OUT, desk.size)
