# -*- coding: utf-8 -*-
# 生成「岐黄鉴方」应用图标：蓝底圆角方 + 白「岐」 + 右下红印章「方」
# 产物: build/icon.ico (多尺寸), build/icon.png (512), build/tray.png (32)
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'build')
os.makedirs(OUT, exist_ok=True)
KAITI = r'C:\Windows\Fonts\simkai.ttf'

BLUE_TOP = (37, 99, 235)    # #2563eb
BLUE_BOT = (18, 58, 117)    # #123a75
RED      = (185, 28, 28)    # #b91c1c
RED_DK   = (146, 22, 22)

def vgrad(size, top, bot):
    img = Image.new('RGB', (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        img.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img.resize((size, size))

def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def make_icon(size):
    s = size * 4  # 4x 超采样
    img = vgrad(s, BLUE_TOP, BLUE_BOT).convert('RGBA')
    # 圆角蒙版（半径 ~22%）
    mask = rounded_mask(s, int(s * 0.22))
    # 细高光内描边
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([int(s*0.02)]*2 + [s-int(s*0.02)-1]*2, radius=int(s*0.205),
                        outline=(255, 255, 255, 46), width=max(1, s//110))
    # 主字「岐」
    f = ImageFont.truetype(KAITI, int(s * 0.62))
    bb = d.textbbox((0, 0), '岐', font=f)
    w, h = bb[2]-bb[0], bb[3]-bb[1]
    d.text((s/2 - w/2 - bb[0], s*0.47 - h/2 - bb[1]), '岐', font=f, fill=(255, 255, 255, 255))
    # 右下红印章「方」
    seal = int(s * 0.34)
    sx, sy = s - seal - int(s*0.06), s - seal - int(s*0.06)
    sr = int(seal * 0.22)
    d.rounded_rectangle([sx, sy, sx+seal, sy+seal], radius=sr, fill=RED+(255,),
                        outline=(255, 255, 255, 220), width=max(1, s//90))
    f2 = ImageFont.truetype(KAITI, int(seal * 0.72))
    bb2 = d.textbbox((0, 0), '方', font=f2)
    w2, h2 = bb2[2]-bb2[0], bb2[3]-bb2[1]
    d.text((sx + seal/2 - w2/2 - bb2[0], sy + seal/2 - h2/2 - bb2[1]), '方', font=f2, fill=(255, 255, 255, 255))
    # 应用圆角 + 下采样
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)

def make_tray(size):
    # 托盘：圆形蓝球 + 白「岐」（无边角，小尺寸清晰）
    s = size * 6
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(s * 0.04)
    d.ellipse([pad, pad, s-pad-1, s-pad-1], fill=BLUE_BOT + (255,))
    d.ellipse([int(s*0.10), int(s*0.10), int(s*0.90), int(s*0.90)], fill=BLUE_TOP + (255,))
    f = ImageFont.truetype(KAITI, int(s * 0.52))
    bb = d.textbbox((0, 0), '岐', font=f)
    w, h = bb[2]-bb[0], bb[3]-bb[1]
    d.text((s/2 - w/2 - bb[0], s/2 - h/2 - bb[1]), '岐', font=f, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)

# 多尺寸 icon.ico
base = make_icon(256)
base.save(os.path.join(OUT, 'icon.ico'), sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
base.resize((512,512), Image.LANCZOS).save(os.path.join(OUT, 'icon.png'))
make_icon(256).save(os.path.join(OUT, 'icon256.png'))
make_tray(32).save(os.path.join(OUT, 'tray.png'))
make_tray(20).save(os.path.join(OUT, 'tray20.png'))
print('OK ->', os.path.abspath(OUT))
