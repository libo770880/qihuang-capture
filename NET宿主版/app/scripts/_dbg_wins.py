# -*- coding: utf-8 -*-
"""列出指定进程（或全部顶层）可见窗口的尺寸，用于校准 UI 探针。"""
import ctypes, ctypes.wintypes as wt, sys, time

u32 = ctypes.windll.user32
u32.SetProcessDPIAware()

pid = int(sys.argv[1]) if len(sys.argv) > 1 else None
out = []
CB = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def cb(h, lp):
    p = wt.DWORD()
    u32.GetWindowThreadProcessId(h, ctypes.byref(p))
    vis = u32.IsWindowVisible(h)
    r = wt.RECT()
    u32.GetWindowRect(h, ctypes.byref(r))
    if pid is None or p.value == pid:
        out.append((p.value, h, vis, r.left, r.top, r.right - r.left, r.bottom - r.top))
    return True


u32.EnumWindows(CB(cb), 0)
print("total", len(out))
for o in out[:40]:
    print(o)
