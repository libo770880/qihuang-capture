# -*- coding: utf-8 -*-
"""完整采集链端到端实测：框选 → 确认 → HUD 进度 → OCR → 入库 → 面板投递。
验证 STA 编组修复：HUD 应弹出、日志应无「调用线程必须为 STA」、面板应收到结果。
用法：python scripts/_ui_probe_capture.py [exe路径]
前置：无运行中的 QhjfCapture 实例。
"""
import ctypes, ctypes.wintypes as wt, subprocess, time, sys, os, re

u32 = ctypes.windll.user32
g32 = ctypes.windll.gdi32
u32.SetProcessDPIAware()

LOG = os.path.join(r"C:\Users\Administrator\AppData\Roaming", "岐黄鉴方·悬浮采集助手", "logs", "app.log")
EXE = sys.argv[1] if len(sys.argv) > 1 else \
    r"E:\capture-tool\net\QhjfCapture\bin\Release\net8.0-windows10.0.17763.0\QhjfCapture.exe"
ENV = dict(os.environ, APPDATA=r"C:\Users\Administrator\AppData\Roaming",
           DOTNET_ROOT=r"C:\Users\Administrator\.workbuddy\binaries\dotnet")

def log(*a):
    print(*a); sys.stdout.flush()

def log_size():
    try: return os.path.getsize(LOG)
    except OSError: return 0

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

def get_pixel(x, y):
    hdc = u32.GetDC(0)
    c = g32.GetPixel(hdc, x, y)
    u32.ReleaseDC(0, hdc)
    return (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF)

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004

def click(x, y):
    u32.SetCursorPos(x, y); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.07)
    u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.2)

def find_overlay(pid):
    for w in enum_windows(pid):
        if w[3] > 2000 and w[4] > 1000:
            return w
    return None

def drag(x1, y1, x2, y2, steps=6):
    u32.SetCursorPos(x1, y1); time.sleep(0.12)
    u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); time.sleep(0.08)
    for i in range(1, steps + 1):
        u32.SetCursorPos(x1 + (x2 - x1) * i // steps, y1 + (y2 - y1) * i // steps)
        time.sleep(0.05)
    time.sleep(0.15)
    u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); time.sleep(0.3)

# ---------- 启动 ----------
pos0 = log_size()
proc = subprocess.Popen([EXE], cwd=os.path.dirname(EXE), env=ENV)
log("PID =", proc.pid)
time.sleep(8)

ball = find_ball(proc.pid)
if not ball:
    log("FAIL: 未找到悬浮球窗口"); sys.exit(1)
h, bl, bt, bw, bh = ball
log(f"悬浮球: {bw}x{bh} @({bl},{bt})")

# ---------- 展开并点「框选抓取」 ----------
click(bl + bw // 2, bt + bh // 2)
time.sleep(1.0)
exp = find_ball(proc.pid, lo=100, hi=700)
if not exp:
    log("FAIL: 未展开"); os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
eh, el, et, ew, eh2 = exp[0], exp[1], exp[2], exp[3], exp[4]
sf = ew / 214.0
btn_x = el + int(ew / 2)
item_h = (eh2 - int(42 * sf) - int(8 * sf) - 8 * int(4 * sf) - int(36 * sf)) / 8.0
btn_y = et + int((42 + 2 + item_h * 1.5 + 4) * sf)
log(f"点击框选按钮: ({btn_x},{btn_y})")
click(btn_x, btn_y)
time.sleep(3.0)

overlay = find_overlay(proc.pid)
if not overlay:
    log("FAIL: 未出现遮罩"); os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1"); sys.exit(1)
ol, ot, ow, oh = overlay[1], overlay[2], overlay[3], overlay[4]
log(f"遮罩: {ow}x{oh} @({ol},{ot})")

# ---------- 拖选一个小区域（css = 物理/1.25） ----------
SF = 1.25
x1, y1, x2, y2 = ol + 200, ot + 200, ol + 500, ot + 450
drag(x1, y1, x2, y2)
time.sleep(0.6)
# 工具条实测校准（每按钮 45 物理px）：x2-31→AI、x2+14→✕、✓ ≈ x2+59
ok_x = x2 + 59
ok_y = y2 + 40
log(f"点击确认✓: ({ok_x},{ok_y})")
click(ok_x, ok_y)

# ---------- 等 HUD 出现（380x168 DIP ≈ 475x210 物理，右下角） ----------
hud = None
for _ in range(10):
    time.sleep(0.6)
    for w in enum_windows(proc.pid):
        if 400 <= w[3] <= 560 and 160 <= w[4] <= 260:
            hud = w; break
    if hud: break
if hud:
    hp = get_pixel(hud[1] + hud[3] // 2, hud[2] + hud[4] // 2)
    log(f"RESULT hud = OK 出现 {hud[3]}x{hud[4]} @({hud[1]},{hud[2]}) 中心色={hp}（卡片底色≈(252,253,248) 为正常）")
else:
    log("RESULT hud = FAIL 未出现（等待 6s）")

# ---------- 等 OCR 完成（record saved，上限 75s） ----------
saved = None
t0 = time.time()
while time.time() - t0 < 75:
    time.sleep(2)
    txt = log_new(pos0)
    if "] saved id=" in txt:
        m = re.search(r"\[region\] ocr ok.*", txt)
        saved = txt
        break
if saved:
    log("RESULT ocr = OK", (m.group(0) if m else "record saved").strip()[:90])
else:
    log("RESULT ocr = FAIL 75s 内未见 record saved")

# ---------- 面板投递 + STA 检查 ----------
time.sleep(2)
txt = log_new(pos0)
sta = txt.count("STA")
log("RESULT sta-errors =", sta, "（应为 0）")
if "capture:result" in txt or "panel" in txt:
    lines = [l for l in txt.splitlines() if "panel" in l or "record saved" in l]
    for l in lines[:6]: log("  |", l.strip()[:120])

os.system(f"taskkill /PID {proc.pid} /F >nul 2>&1")
log("--- 测毕 ---")
