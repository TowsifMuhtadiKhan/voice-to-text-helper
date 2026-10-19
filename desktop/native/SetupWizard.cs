using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace UniversalVoiceToText.Installer
{
    public class SetupWizardForm : Form
    {
        private Panel headerPanel;
        private Label titleLabel;
        private Label subtitleLabel;
        private Label pathLabel;
        private TextBox pathTextBox;
        private CheckBox desktopShortcutCheck;
        private CheckBox startMenuShortcutCheck;
        private CheckBox launchNowCheck;
        private ProgressBar progressBar;
        private Label statusLabel;
        private Button installButton;
        private Button cancelButton;

        private readonly string installDir;
        private bool isFinished = false;

        public SetupWizardForm()
        {
            installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs",
                "Universal Voice-to-Text Helper"
            );

            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "Universal Voice-to-Text Helper Setup";
            this.Size = new Size(540, 440);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = true;
            this.BackColor = Color.FromArgb(248, 249, 250);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // Header Panel
            headerPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 85,
                BackColor = Color.FromArgb(24, 27, 36)
            };

            titleLabel = new Label
            {
                Text = "Universal Voice-to-Text Helper",
                Font = new Font("Segoe UI", 14f, FontStyle.Bold),
                ForeColor = Color.White,
                Location = new Point(24, 18),
                AutoSize = true
            };

            subtitleLabel = new Label
            {
                Text = "Windows Setup Wizard  •  Global Shortcut: Ctrl+Shift+Space",
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                ForeColor = Color.FromArgb(160, 168, 185),
                Location = new Point(25, 48),
                AutoSize = true
            };

            headerPanel.Controls.Add(titleLabel);
            headerPanel.Controls.Add(subtitleLabel);

            // Destination Path Controls
            pathLabel = new Label
            {
                Text = "Installation Location:",
                Location = new Point(24, 105),
                AutoSize = true,
                ForeColor = Color.FromArgb(40, 44, 52),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };

            pathTextBox = new TextBox
            {
                Text = installDir,
                Location = new Point(24, 130),
                Width = 475,
                ReadOnly = true,
                BackColor = Color.White,
                ForeColor = Color.FromArgb(60, 64, 72)
            };

            // Checkbox Options
            desktopShortcutCheck = new CheckBox
            {
                Text = "Create Desktop Shortcut",
                Checked = true,
                Location = new Point(25, 172),
                AutoSize = true,
                ForeColor = Color.FromArgb(30, 34, 42)
            };

            startMenuShortcutCheck = new CheckBox
            {
                Text = "Create Start Menu Shortcut & register in Windows Apps",
                Checked = true,
                Location = new Point(25, 202),
                AutoSize = true,
                ForeColor = Color.FromArgb(30, 34, 42)
            };

            launchNowCheck = new CheckBox
            {
                Text = "Launch Universal Voice-to-Text Helper when installation finishes",
                Checked = true,
                Location = new Point(25, 232),
                AutoSize = true,
                ForeColor = Color.FromArgb(30, 34, 42)
            };

            // Progress Controls
            statusLabel = new Label
            {
                Text = "Ready to install. Click Install to begin.",
                Location = new Point(24, 275),
                AutoSize = true,
                ForeColor = Color.FromArgb(70, 75, 85)
            };

            progressBar = new ProgressBar
            {
                Location = new Point(24, 300),
                Width = 475,
                Height = 22,
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            // Action Buttons
            installButton = new Button
            {
                Text = "Install",
                Location = new Point(310, 345),
                Size = new Size(100, 34),
                BackColor = Color.FromArgb(79, 70, 229),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            installButton.FlatAppearance.BorderSize = 0;
            installButton.Click += InstallButton_Click;

            cancelButton = new Button
            {
                Text = "Cancel",
                Location = new Point(418, 345),
                Size = new Size(82, 34),
                BackColor = Color.FromArgb(229, 231, 235),
                ForeColor = Color.FromArgb(55, 65, 81),
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            cancelButton.FlatAppearance.BorderSize = 0;
            cancelButton.Click += (s, e) => this.Close();

            // Assemble Form
            this.Controls.Add(headerPanel);
            this.Controls.Add(pathLabel);
            this.Controls.Add(pathTextBox);
            this.Controls.Add(desktopShortcutCheck);
            this.Controls.Add(startMenuShortcutCheck);
            this.Controls.Add(launchNowCheck);
            this.Controls.Add(statusLabel);
            this.Controls.Add(progressBar);
            this.Controls.Add(installButton);
            this.Controls.Add(cancelButton);
        }

        private void InstallButton_Click(object sender, EventArgs e)
        {
            if (isFinished)
            {
                this.Close();
                return;
            }

            installButton.Enabled = false;
            cancelButton.Enabled = false;

            Thread worker = new Thread(DoInstallation)
            {
                IsBackground = true
            };
            worker.Start();
        }

        private void UpdateProgress(int percent, string message)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action<int, string>(UpdateProgress), percent, message);
                return;
            }

            progressBar.Value = Math.Min(100, Math.Max(0, percent));
            statusLabel.Text = message;
        }

        private void DoInstallation()
        {
            try
            {
                UpdateProgress(10, "Closing existing background instances...");
                try
                {
                    foreach (var proc in Process.GetProcessesByName("electron"))
                    {
                        if (proc.MainWindowTitle.Contains("Universal Voice-to-Text"))
                        {
                            proc.Kill();
                        }
                    }
                    foreach (var proc in Process.GetProcessesByName("Win32VoiceHelper"))
                    {
                        proc.Kill();
                    }
                }
                catch { }

                UpdateProgress(25, "Preparing destination directory...");
                Directory.CreateDirectory(installDir);

                // Locate source files
                string sourceRoot = FindSourceRoot();
                if (string.IsNullOrEmpty(sourceRoot))
                {
                    throw new Exception("Application source files could not be located.");
                }

                UpdateProgress(40, "Copying application core runtime...");
                string electronDist = Path.Combine(sourceRoot, "node_modules", "electron", "dist");
                if (Directory.Exists(electronDist))
                {
                    CopyDirectory(electronDist, installDir);
                }

                UpdateProgress(60, "Copying desktop packages and user interface...");
                string desktopDist = Path.Combine(sourceRoot, "desktop", "dist");
                if (Directory.Exists(desktopDist))
                {
                    CopyDirectory(desktopDist, Path.Combine(installDir, "desktop", "dist"));
                }

                string assetsDir = Path.Combine(sourceRoot, "assets");
                if (Directory.Exists(assetsDir))
                {
                    CopyDirectory(assetsDir, Path.Combine(installDir, "assets"));
                }

                string packageJson = Path.Combine(sourceRoot, "package.json");
                if (File.Exists(packageJson))
                {
                    File.Copy(packageJson, Path.Combine(installDir, "package.json"), true);
                }

                string rootExe = Path.Combine(sourceRoot, "Universal Voice-to-Text Helper.exe");
                if (File.Exists(rootExe))
                {
                    File.Copy(rootExe, Path.Combine(installDir, "Universal Voice-to-Text Helper.exe"), true);
                }

                UpdateProgress(75, "Creating Windows shortcuts and uninstaller...");
                string installedExe = Path.Combine(installDir, "Universal Voice-to-Text Helper.exe");

                // Create Uninstaller script
                string uninstallerPath = Path.Combine(installDir, "Uninstall.bat");
                string uninstallerScript = string.Format(
                    "@echo off\r\n" +
                    "taskkill /f /im electron.exe >nul 2>&1\r\n" +
                    "taskkill /f /im Win32VoiceHelper.exe >nul 2>&1\r\n" +
                    "del /f /q \"{0}\\Universal Voice-to-Text Helper.lnk\" >nul 2>&1\r\n" +
                    "rmdir /s /q \"{1}\\Universal Voice-to-Text\" >nul 2>&1\r\n" +
                    "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\UniversalVoiceToTextHelper\" /f >nul 2>&1\r\n" +
                    "echo Universal Voice-to-Text Helper uninstalled successfully.\r\n" +
                    "pause\r\n",
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs")
                );
                File.WriteAllText(uninstallerPath, uninstallerScript);

                if (desktopShortcutCheck.Checked)
                {
                    string desktopLink = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                        "Universal Voice-to-Text Helper.lnk"
                    );
                    CreateShortcut(desktopLink, installedExe, installDir, "Universal Voice-to-Text Helper (Ctrl+Shift+Space)");
                }

                if (startMenuShortcutCheck.Checked)
                {
                    string startMenuFolder = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                        "Programs",
                        "Universal Voice-to-Text"
                    );
                    Directory.CreateDirectory(startMenuFolder);
                    string startMenuLink = Path.Combine(startMenuFolder, "Universal Voice-to-Text Helper.lnk");
                    CreateShortcut(startMenuLink, installedExe, installDir, "Universal Voice-to-Text Helper (Ctrl+Shift+Space)");

                    // Register in Windows Installed Apps Registry
                    RegisterInWindows(installDir, installedExe, uninstallerPath);
                }

                UpdateProgress(90, "Finalizing installation...");
                Thread.Sleep(300);

                if (launchNowCheck.Checked && File.Exists(installedExe))
                {
                    UpdateProgress(98, "Launching Universal Voice-to-Text Helper...");
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = installedExe,
                        WorkingDirectory = installDir
                    });
                }

                this.BeginInvoke(new Action(() =>
                {
                    isFinished = true;
                    progressBar.Value = 100;
                    statusLabel.Text = "Installation completed successfully! Global shortcut: Ctrl+Shift+Space";
                    statusLabel.ForeColor = Color.FromArgb(16, 149, 193);
                    installButton.Text = "Finish";
                    installButton.Enabled = true;
                    cancelButton.Visible = false;
                }));
            }
            catch (Exception ex)
            {
                this.BeginInvoke(new Action(() =>
                {
                    progressBar.Value = 0;
                    statusLabel.Text = "Installation failed: " + ex.Message;
                    statusLabel.ForeColor = Color.Crimson;
                    installButton.Enabled = true;
                    cancelButton.Enabled = true;
                    MessageBox.Show(
                        "Installation could not be completed:\n" + ex.Message,
                        "Setup Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                }));
            }
        }

        private static string FindSourceRoot()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            string localAppDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Universal Voice-to-Text Helper");
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

            string[] candidates = new string[]
            {
                exeDir,
                Path.GetFullPath(Path.Combine(exeDir, "..")),
                Path.GetFullPath(Path.Combine(exeDir, "..", "..")),
                @"D:\Voice-to-Text Helper",
                @"d:\Voice-to-Text Helper",
                @"C:\Voice-to-Text Helper",
                Path.Combine(userProfile, "Downloads", "Universal-Voice-to-Text-Windows"),
                localAppDir
            };

            foreach (var root in candidates)
            {
                if (Directory.Exists(root))
                {
                    string electronDist = Path.Combine(root, "node_modules", "electron", "dist");
                    string mainJs = Path.Combine(root, "desktop", "dist", "main", "main.js");
                    if (Directory.Exists(electronDist) && File.Exists(mainJs))
                    {
                        return root;
                    }
                }
            }

            return null;
        }

        private static void CopyDirectory(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);
            foreach (var file in Directory.GetFiles(sourceDir))
            {
                string targetFile = Path.Combine(destDir, Path.GetFileName(file));
                File.Copy(file, targetFile, true);
            }
            foreach (var subDir in Directory.GetDirectories(sourceDir))
            {
                string targetSubDir = Path.Combine(destDir, Path.GetFileName(subDir));
                CopyDirectory(subDir, targetSubDir);
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = workingDir;
                shortcut.Description = description;
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Save();
            }
            catch
            {
                // Fallback: ignore if COM is restricted
            }
        }

        private static void RegisterInWindows(string installLocation, string displayIcon, string uninstallString)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\UniversalVoiceToTextHelper"))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "Universal Voice-to-Text Helper");
                        key.SetValue("DisplayVersion", "1.0.0");
                        key.SetValue("Publisher", "Universal Voice-to-Text");
                        key.SetValue("InstallLocation", installLocation);
                        key.SetValue("DisplayIcon", displayIcon);
                        key.SetValue("UninstallString", "\"" + uninstallString + "\"");
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                }
            }
            catch
            {
                // Ignore registry access errors
            }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWizardForm());
        }
    }
}
