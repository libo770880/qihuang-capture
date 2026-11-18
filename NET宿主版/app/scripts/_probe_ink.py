# -*- coding: utf-8 -*-
"""带标注抓取「笔迹进入最终图片」端到端实证。

用法：python scripts/_probe_ink.py [exe路径] [标签]
流程：启动 → 展开浮球 → 框选抓取 → 拖选区域 → 选画笔 → 画一笔 → 屏幕取色确认笔迹
      → 点✓确认 → 等入库 → 在新落库 PNG 里统计红色笔迹像素。

判定：
  ink-screen > 0  笔迹确实画到了遮罩上
  ink-file   > 0  笔迹确实进入了最终存档图（核心断言）
前置：无运行中的 QhjfCapture 实例。
"""
import ctypes, ctypes.wintypes as wt, subprocess, time, sys, os, re, glob

u32 = ctypes.windll.user32
g32 = ctypes.windll.gdi32
u32.SetProcessDPIAware()

APPDATA = r"C:\Users\Administrator\AppData\Roaming"
LOG = os.path.join(APPDATA, "岐黄鉴方·悬浮采集助手", "logs", "app.log")
REC = os.path.join(APPDATA, "岐黄鉴方·悬浮采集助手", "records")
EXE = sys.argv[1] if len(sys.argv) > 1 else \
    r"E:\capture-tool\net\QhjfCapture\bin\Release\net8.0-windows10.0.17763.0\QhjfCapture.exe"
TAG = sys.argv[2] if len(sys.argv) > 2 else "new"
ENV = dict(os.environ, APPDATA=APPDATA,
           DOTNET_ROOT=r"C:\Users\Administrator\.workbuddy\binaries\dotnet")


def log(*a):
    print(*a)
    sys.stdout.flush()


def log_size():
    try:
        return os.path.getsize(LOG)
    except OSError:
        return 0


def log_new(pos):
    with open(LOG, "r", encoding="utf-8", errors="replace") as f:
        f.seek(pos)
        return f.read()


def enum_windows(pid):
    out = []
    CB = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(h, lp):
        if not u32.IsWindowVisible(h):
            return True
        p = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid:
            return True
        r = wt.RECT()
        u32.GetWindowRect(h, ctypes.byref(r))
        out.append((h, r.left, r.top, r.right - r.left, r.bottom - r.top))
        return True

    u32.EnumWindows(CB(cb), 0)
    return out


def find_ball(pid, lo=60, hi=95):
    for w in enum_windows(pid):
        if lo <= w[3] <= hi and lo <= w[4] <= hi:
            return w
    return None


def find_overlay(pid):
    for w in enum_windows(pid):
        if w[3] > 2000 and w[4] > 1000:
            return w
    return None


def get_pixel(x, y):
    hdc = u32.GetDC(0)
    c = g32.GetPixel(hdc, x, y)
    u32.ReleaseDC(0, hdc)
    return (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF)


def is_red(px):
    r, g, b = px
    return r > 190 and g < 150 and b < 150 and r - g > 60


DOWN, UP = 0x0002, 0x0004


def click(x, y):
    u32.SetCursorPos(x, y)
    time.sleep(0.12)
    u32.mouse_event(DOWN, 0, 0, 0, 0)
    time.sleep(0.07)
    u32.mouse_event(UP, 0, 0, 0, 0)
    time.sleep(0.25)


def drag(x1, y1, x2, y2, steps=10):
    u32.SetCursorPos(x1, y1)
    time.sleep(0.12)
    u32.mouse_event(DOWN, 0, 0, 0, 0)
    time.sleep(0.08)
    for i in range(1, steps + 1):
        u32.SetCursorPos(x1 + (x2 - x1) * i // steps, y1 + (y2 - y1) * i // steps)
        time.sleep(0.04)
    time.sleep(0.15)
    u32.mouse_event(UP, 0, 0, 0, 0)
    time.sleep(0.35)


# ---------- 启动 ----------
os.system("taskkill /IM QhjfCapture.exe /F >nul 2>&1")
time.sleep(1.5)
pos0 = log_size()
proc = subprocess.Popen([EXE], cwd=os.path.dirname(EXE), env=ENV)
log(f"[{TAG}] PID =", proc.pid)
ball = None
for _ in range(30):
    time.sleep(1)
    ball = find_ball(proc.pid)
    if ball:
        break
if not ball:
    log(f"[{TAG}] FAIL: 未找到悬浮球")
    os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
    sys.exit(1)
_, bl, bt, bw, bh = ball

click(bl + bw // 2, bt + bh // 2)
time.sleep(1.0)
exp = find_ball(proc.pid, lo=100, hi=700)
if not exp:
    log(f"[{TAG}] FAIL: 浮球未展开")
    os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
    sys.exit(1)
el, et, ew, eh2 = exp[1], exp[2], exp[3], exp[4]
sf = ew / 214.0
item_h = (eh2 - int(42 * sf) - int(8 * sf) - 8 * int(4 * sf) - int(36 * sf)) / 8.0
click(el + int(ew / 2), et + int((42 + 2 + item_h * 1.5 + 4) * sf))
time.sleep(3.0)

ov = find_overlay(proc.pid)
if not ov:
    log(f"[{TAG}] FAIL: 未出现遮罩")
    os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
    sys.exit(1)
ol, ot = ov[1], ov[2]

x1, y1, x2, y2 = ol + 200, ot + 200, ol + 500, ot + 450
drag(x1, y1, x2, y2)
time.sleep(0.6)

# ---------- 选画笔并画一笔（工具条实测锚点：✓≈x2+59；笔✎在✓左侧约 8 个位） ----------
bar_y = y2 + 40
sx1, sy, sx2 = x1 + 60, (y1 + y2) // 2, x1 + 240
ink_screen = 0

# 先记下无笔迹时的底色（避免屏幕上本就偏红的像素误判）
base = get_pixel((sx1 + sx2) // 2, sy)
for cand in (x2 - 333, x2 - 288, x2 - 378, x2 - 243):
    click(cand, bar_y)
    drag(sx1, sy, sx2, sy)
    mid = get_pixel((sx1 + sx2) // 2, sy)
    log(f"[{TAG}] 试画笔 x={cand} 底色={base} 画后={mid}")
    if is_red(mid) and not is_red(base):
        ink_screen = 1
        break
log(f"[{TAG}] RESULT ink-screen = {ink_screen} (1=笔迹已画到遮罩)")

# ---------- 确认 ----------
click(x2 + 59, bar_y)

saved_txt = None
t0 = time.time()
while time.time() - t0 < 90:
    time.sleep(2)
    txt = log_new(pos0)
    if "] saved id=" in txt or "[region] ocr ok" in txt:
        saved_txt = txt
        break
log(f"[{TAG}] RESULT saved = {'OK' if saved_txt else 'FAIL(90s 超时)'}")
if saved_txt:
    m = re.search(r"\[region\].*", saved_txt)
    if m:
        log("   |", m.group(0).strip()[:110])

# ---------- 统计落库 PNG 里的红色笔迹像素 ----------
pngs = [p for p in glob.glob(os.path.join(REC, "*.png"))]
newest = None
if pngs:
    newest = max(pngs, key=os.path.getmtime)
cnt = 0
if newest and time.time() - os.path.getmtime(newest) < 300:
    try:
        from PIL import Image
        im = Image.open(newest).convert("RGB")
        w, h = im.size
        px = im.load()
        for yy in range(0, h, 2):
            for xx in range(0, w, 2):
                r, g, b = px[xx, yy]
                if r > 190 and g < 150 and b < 150 and r - g > 60:
                    cnt += 1
        log(f"[{TAG}] 落库图 = {os.path.basename(newest)} {w}x{h}")
    except Exception as e:
        log(f"[{TAG}] 读图失败: {e}")
else:
    log(f"[{TAG}] 未找到新落库 PNG")
log(f"[{TAG}] RESULT ink-file = {cnt} (红色笔迹像素采样数，>0 即笔迹进入最终图片)")

os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
