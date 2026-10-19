using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace VoiceTextHelper
{
    public class HotkeyApp : Form
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private const uint MOD_ALT = 0x0001;
        private const uint MOD_CONTROL = 0x0002;
        private const uint MOD_SHIFT = 0x0004;
        private const int WM_HOTKEY = 0x0312;

        private const uint VK_V = 0x56; // 'V'
        private const uint VK_S = 0x53; // 'S'
        private const uint VK_T = 0x54; // 'T'

        static Mutex singleInstance;

        public HotkeyApp()
        {
            this.WindowState = FormWindowState.Minimized;
            this.ShowInTaskbar = false;
            this.FormBorderStyle = FormBorderStyle.None;
            this.Size = new System.Drawing.Size(0, 0);

            // Register Hotkeys:
            // 1: Ctrl + Shift + V
            RegisterHotKey(this.Handle, 1, MOD_CONTROL | MOD_SHIFT, VK_V);

            // 2: Ctrl + Alt + S
            RegisterHotKey(this.Handle, 2, MOD_CONTROL | MOD_ALT, VK_S);

            // 3: Ctrl + Alt + T
            RegisterHotKey(this.Handle, 3, MOD_CONTROL | MOD_ALT, VK_T);

            // 4: Alt + Shift + V
            RegisterHotKey(this.Handle, 4, MOD_ALT | MOD_SHIFT, VK_V);
        }

        protected override void SetVisibleCore(bool value)
        {
            base.SetVisibleCore(false);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY)
            {
                LaunchAppWindow();
            }
            base.WndProc(ref m);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            UnregisterHotKey(this.Handle, 1);
            UnregisterHotKey(this.Handle, 2);
            UnregisterHotKey(this.Handle, 3);
            UnregisterHotKey(this.Handle, 4);
            base.OnFormClosing(e);
        }

        [STAThread]
        static void Main()
        {
            bool createdNew;
            singleInstance = new Mutex(true, "UniversalVoiceTextHotkeyFormMutex", out createdNew);
            if (!createdNew)
            {
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new HotkeyApp());
        }

        static void LaunchAppWindow()
        {
            try
            {
                EnsureServerRunning();

                string chrome = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
                if (!File.Exists(chrome))
                {
                    chrome = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
                }

                string edge = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
                if (!File.Exists(edge))
                {
                    edge = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
                }

                string browser = File.Exists(chrome) ? chrome : (File.Exists(edge) ? edge : null);

                if (browser != null)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = "--app=\"http://localhost:3000\"",
                        UseShellExecute = true
                    });
                }
                else
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "http://localhost:3000",
                        UseShellExecute = true
                    });
                }
            }
            catch
            {
                // Ignore
            }
        }

        static void EnsureServerRunning()
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", 3000, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(200);
                    if (success && client.Connected)
                    {
                        client.EndConnect(result);
                        return;
                    }
                }
            }
            catch
            {
                // Server not reachable
            }

            try
            {
                string scriptDir = AppDomain.CurrentDomain.BaseDirectory;
                string serverScript = Path.Combine(scriptDir, "web", "server.mjs");
                if (!File.Exists(serverScript))
                {
                    serverScript = Path.Combine(scriptDir, "..", "web", "server.mjs");
                }

                if (File.Exists(serverScript))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "node",
                        Arguments = "\"" + serverScript + "\"",
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        UseShellExecute = false
                    });
                    Thread.Sleep(500);
                }
            }
            catch
            {
                // Ignore
            }
        }
    }
}
