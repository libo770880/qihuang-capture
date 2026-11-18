# -*- coding: utf-8 -*-
"""生成 WPF SplashScreen 启动图（构建期嵌入程序集，CLR 初始化期立即显示）。

产物：net/QhjfCapture/assets/splash.png（460x300 @96dpi）
风格与 Ui/SplashWindow.cs 保持一致：米白底 + 中医绿描边/标题。
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 460, 300
BG = (0xFB, 0xFB, 0xF8, 255)
ACCENT = (0x2F, 0x7D, 0x5D, 255)
INK = (0x33, 0x33, 0x2E, 255)
MUTED = (0x8A, 0x8A, 0x82, 255)
TRACK = (0xE9, 0xE9, 0xE2, 255)

img = Image.new("RGBA", (W, H), BG)
d = ImageDraw.Draw(img)

# 外描边（与进度窗 BorderBrush 一致）
d.rectangle([0, 0, W - 1, H - 1], outline=ACCENT, width=1)
d.rectangle([1, 1, W - 2, H - 2], outline=(0xF2, 0xF4, 0xEE, 255), width=1)

f_title = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 34)
f_sub = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
f_tip = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 12)

def center(draw, text, font, y, fill):
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((W - (box[2] - box[0])) / 2, y), text, font=font, fill=fill)

center(d, "岐黄鉴方", f_title, 88, ACCENT)
center(d, "悬浮采集助手", f_sub, 148, INK)

# 静态进度条（示意：约 40% 处），真正的进度由 SplashWindow 接管
bar_w, bar_h = 300, 6
x0 = (W - bar_w) // 2
y0 = 208
d.rounded_rectangle([x0, y0, x0 + bar_w, y0 + bar_h], radius=3, fill=TRACK)
d.rounded_rectangle([x0, y0, x0 + int(bar_w * 0.4), y0 + bar_h], radius=3, fill=ACCENT)

center(d, "正在启动…", f_tip, 232, MUTED)

out = os.path.join(os.path.dirname(__file__), "..", "net", "QhjfCapture", "assets", "splash.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
img.save(out)
print("saved:", os.path.abspath(out), img.size)
