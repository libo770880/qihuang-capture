// 岐黄鉴方 · 悬浮采集助手 极小启动器
// 职责：单实例互斥 → 启动 runtime\electron.exe 运行 app\ → 立即返回
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;

static class Launcher
{
    [STAThread]
    static int Main()
    {
        bool createdNew;
        using (var mutex = new Mutex(true, "QHJF_Capture_SingleInstance", out createdNew))
        {
            if (!createdNew) return 0; // 已在运行，直接退出
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string electron = Path.Combine(baseDir, "runtime", "electron.exe");
            string appDir = Path.Combine(baseDir, "app");
            if (!File.Exists(electron)) return 2;
            if (!File.Exists(Path.Combine(appDir, "package.json"))) return 3;

            var psi = new ProcessStartInfo
            {
                FileName = electron,
                Arguments = "\"" + appDir + "\"",
                WorkingDirectory = appDir,
                UseShellExecute = false
            };
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE"); // 防环境变量干扰
            Process.Start(psi);
            return 0;
        }
    }
}
