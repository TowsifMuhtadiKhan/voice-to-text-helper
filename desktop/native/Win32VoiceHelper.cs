using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;

namespace UniversalVoiceToText
{
    internal static class NativeMethods
    {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        public const int INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }
    }

    public class Program
    {
        private static SpeechRecognitionEngine _engine;
        private static readonly object _lock = new object();
        private static bool _isListening = false;
        private static string _currentLang = "en-US";
        private static IntPtr _lastExternalHwnd = IntPtr.Zero;
        private static bool _hasInsertedInCurrentTarget = false;
        private static IntPtr _lastInsertedHwnd = IntPtr.Zero;
        private static bool _suppressInsertDuringSimulation = false;
        private static string _simulatedPhrase = null;
        private static readonly List<KeyValuePair<string, string>> _replacements = new List<KeyValuePair<string, string>>();

        private static string ApplyReplacements(string text)
        {
            if (string.IsNullOrEmpty(text) || _replacements.Count == 0) return text;
            string result = text;
            foreach (var rep in _replacements)
            {
                if (string.IsNullOrEmpty(rep.Key)) continue;
                try
                {
                    string pattern = @"\b" + System.Text.RegularExpressions.Regex.Escape(rep.Key) + @"\b";
                    result = System.Text.RegularExpressions.Regex.Replace(result, pattern, rep.Value, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                }
                catch
                {
                    result = result.Replace(rep.Key, rep.Value);
                }
            }
            return result;
        }

        public static void Main(string[] args)
        {
            bool isWorker = false;
            if (args != null)
            {
                foreach (string arg in args)
                {
                    if (arg == "--worker")
                    {
                        isWorker = true;
                        break;
                    }
                }
            }

            if (!isWorker)
            {
                LaunchElectronGui();
                return;
            }

            try
            {
                Console.InputEncoding = Encoding.UTF8;
                Console.OutputEncoding = Encoding.UTF8;
            }
            catch
            {
                // Ignore when running as winexe without a console screen buffer
            }

            Thread trackerThread = new Thread(TrackForegroundWindow)
            {
                IsBackground = true
            };
            trackerThread.Start();

            EmitJson("{\"event\":\"ready\"}");

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                try
                {
                    HandleCommand(line);
                }
                catch (Exception ex)
                {
                    EmitError("command-error", ex.Message);
                }
            }
        }

        private static void LaunchElectronGui()
        {
            try
            {
                // If a window is already running, bring it to front
                IntPtr existingHwnd = NativeMethods.FindWindow(null, "Universal Voice-to-Text Helper");
                if (existingHwnd != IntPtr.Zero)
                {
                    NativeMethods.ShowWindow(existingHwnd, 9); // SW_RESTORE
                    NativeMethods.SetForegroundWindow(existingHwnd);
                    return;
                }

                string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

                List<string> candidateRoots = new List<string>
                {
                    exeDir,
                    Path.GetFullPath(Path.Combine(exeDir, "..")),
                    Path.GetFullPath(Path.Combine(exeDir, "..", "..")),
                    Path.GetFullPath(Path.Combine(exeDir, "..", "..", "..")),
                    @"D:\Voice-to-Text Helper",
                    @"d:\Voice-to-Text Helper",
                    @"C:\Voice-to-Text Helper",
                    Path.Combine(userProfile, "Downloads", "Universal-Voice-to-Text-Windows"),
                    Path.Combine(userProfile, "Downloads", "Voice-to-Text Helper"),
                    Path.Combine(userProfile, "Desktop", "Universal-Voice-to-Text-Windows"),
                    Path.Combine(userProfile, "Desktop", "Voice-to-Text Helper")
                };

                foreach (string root in candidateRoots)
                {
                    if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;

                    string electronExe = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
                    string mainJs = Path.Combine(root, "desktop", "dist", "main", "main.js");

                    // Check portable bundle layout (electron.exe placed directly alongside helper)
                    if (!File.Exists(electronExe))
                    {
                        electronExe = Path.Combine(root, "electron.exe");
                    }

                    if (File.Exists(electronExe) && File.Exists(mainJs))
                    {
                        System.Diagnostics.ProcessStartInfo psi = new System.Diagnostics.ProcessStartInfo
                        {
                            FileName = electronExe,
                            Arguments = "\"" + mainJs + "\"",
                            WorkingDirectory = root,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        };
                        System.Diagnostics.Process.Start(psi);
                        return;
                    }
                }

                // If not found in any candidate folder, display clear instructions
                NativeMethods.MessageBox(
                    IntPtr.Zero,
                    "Universal Voice-to-Text Helper could not find the application files in this folder.\n\n" +
                    "If you downloaded the portable ZIP package, please extract 'universal-voice-to-text-windows.zip' first.\n\n" +
                    "Global Shortcut when running: Ctrl+Shift+Space",
                    "Universal Voice-to-Text Helper",
                    0x40 // MB_ICONINFORMATION | MB_OK
                );
            }
            catch (Exception ex)
            {
                try
                {
                    NativeMethods.MessageBox(
                        IntPtr.Zero,
                        "Failed to launch Universal Voice-to-Text Helper:\n" + ex.Message,
                        "Universal Voice-to-Text Helper",
                        0x10 // MB_ICONERROR | MB_OK
                    );
                }
                catch { }
            }
        }

        private static void TrackForegroundWindow()
        {
            while (true)
            {
                try
                {
                    IntPtr fg = NativeMethods.GetForegroundWindow();
                    if (fg != IntPtr.Zero)
                    {
                        StringBuilder sb = new StringBuilder(256);
                        NativeMethods.GetWindowText(fg, sb, 256);
                        string title = sb.ToString();

                        if (!title.Contains("Universal Voice-to-Text Helper"))
                        {
                            _lastExternalHwnd = fg;
                        }
                    }
                }
                catch
                {
                    // Ignore transient Win32 errors
                }
                Thread.Sleep(80);
            }
        }

        private static void HandleCommand(string jsonLine)
        {
            string cmd = ExtractJsonString(jsonLine, "cmd");
            if (cmd == "start")
            {
                string lang = ExtractJsonString(jsonLine, "lang");
                if (!string.IsNullOrEmpty(lang))
                {
                    _currentLang = lang;
                }
                StartRecognition();
            }
            else if (cmd == "stop")
            {
                StopRecognition();
            }
            else if (cmd == "reset_session")
            {
                StopRecognition();
                _hasInsertedInCurrentTarget = false;
                _lastInsertedHwnd = IntPtr.Zero;
                EmitStatus("idle");
            }
            else if (cmd == "insert")
            {
                string text = ExtractJsonString(jsonLine, "text");
                if (!string.IsNullOrEmpty(text))
                {
                    InsertTextIntoTargetWindow(text);
                }
            }
            else if (cmd == "set_replacements")
            {
                _replacements.Clear();
                string rulesStr = ExtractJsonString(jsonLine, "rules");
                if (!string.IsNullOrEmpty(rulesStr))
                {
                    string[] pairs = rulesStr.Split(new char[] { '|' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string pair in pairs)
                    {
                        int eq = pair.IndexOf('=');
                        if (eq > 0)
                        {
                            string f = pair.Substring(0, eq).Trim();
                            string t = pair.Substring(eq + 1);
                            if (!string.IsNullOrEmpty(f))
                            {
                                _replacements.Add(new KeyValuePair<string, string>(f, t));
                            }
                        }
                    }
                }
            }
            else if (cmd == "simulate_speech")
            {
                string phrase = ExtractJsonString(jsonLine, "text");
                string noInsert = ExtractJsonString(jsonLine, "noInsert");
                if (!string.IsNullOrEmpty(phrase))
                {
                    SimulateSpeechInput(phrase, noInsert == "true");
                }
            }
        }

        private static void EnsureEngineInitialized()
        {
            if (_engine != null) return;

            CultureInfo targetCulture;
            try
            {
                targetCulture = CultureInfo.GetCultureInfo(_currentLang);
            }
            catch
            {
                targetCulture = CultureInfo.GetCultureInfo("en-US");
            }

            RecognizerInfo selectedInfo = null;
            foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers())
            {
                if (info.Culture.Name.Equals(targetCulture.Name, StringComparison.OrdinalIgnoreCase))
                {
                    selectedInfo = info;
                    break;
                }
            }

            if (selectedInfo == null)
            {
                foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers())
                {
                    if (info.Culture.TwoLetterISOLanguageName.Equals(
                        targetCulture.TwoLetterISOLanguageName,
                        StringComparison.OrdinalIgnoreCase))
                    {
                        selectedInfo = info;
                        break;
                    }
                }
            }

            if (selectedInfo != null)
            {
                _engine = new SpeechRecognitionEngine(selectedInfo);
            }
            else
            {
                _engine = new SpeechRecognitionEngine();
            }

            // Configure natural silence timeouts to prevent mid-word chopping
            try
            {
                _engine.InitialSilenceTimeout = TimeSpan.FromSeconds(6);
                _engine.BabbleTimeout = TimeSpan.FromSeconds(0);
                _engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(700);
                _engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(900);
            }
            catch { }

            try
            {
                DictationGrammar dictation = new DictationGrammar("grammar:dictation");
                dictation.Name = "Default Dictation";
                dictation.Weight = 1.0f;
                _engine.LoadGrammar(dictation);
            }
            catch
            {
                DictationGrammar fallback = new DictationGrammar();
                _engine.LoadGrammar(fallback);
            }

            _engine.SpeechHypothesized += OnSpeechHypothesized;
            _engine.SpeechRecognized += OnSpeechRecognized;
            _engine.RecognizeCompleted += OnRecognizeCompleted;
        }

        private static void StartRecognition()
        {
            lock (_lock)
            {
                if (_isListening) return;

                try
                {
                    EnsureEngineInitialized();
                    _engine.SetInputToDefaultAudioDevice();
                    _engine.RecognizeAsync(RecognizeMode.Multiple);
                    _isListening = true;
                    EmitStatus("listening");
                }
                catch (InvalidOperationException ex)
                {
                    EmitError("audio-capture", "No microphone detected or microphone access is disabled in Windows Settings. (" + ex.Message + ")");
                }
                catch (Exception ex)
                {
                    EmitError("start-failed", ex.Message);
                }
            }
        }

        private static void StopRecognition()
        {
            lock (_lock)
            {
                if (!_isListening || _engine == null)
                {
                    EmitStatus("stopped");
                    return;
                }

                try
                {
                    _engine.RecognizeAsyncCancel();
                }
                catch
                {
                    // Ignore cancel errors
                }
                _isListening = false;
                EmitStatus("stopped");
            }
        }

        private static void SimulateSpeechInput(string phrase, bool suppressInsert)
        {
            lock (_lock)
            {
                try
                {
                    bool wasListening = _isListening;
                    if (_isListening && _engine != null)
                    {
                        _engine.RecognizeAsyncCancel();
                        _isListening = false;
                        Thread.Sleep(60);
                    }

                    EnsureEngineInitialized();
                    _suppressInsertDuringSimulation = suppressInsert;
                    _simulatedPhrase = phrase;

                    using (MemoryStream waveStream = new MemoryStream())
                    {
                        using (SpeechSynthesizer synth = new SpeechSynthesizer())
                        {
                            synth.Rate = -1;
                            synth.SetOutputToWaveStream(waveStream);
                            synth.Speak(phrase);
                        }
                        waveStream.Position = 0;
                        _engine.SetInputToWaveStream(waveStream);
                        EmitStatus("listening");
                        _engine.Recognize();
                    }

                    _simulatedPhrase = null;
                    _suppressInsertDuringSimulation = false;

                    if (wasListening)
                    {
                        try
                        {
                            _engine.SetInputToDefaultAudioDevice();
                            _engine.RecognizeAsync(RecognizeMode.Multiple);
                            _isListening = true;
                            EmitStatus("listening");
                        }
                        catch
                        {
                            EmitStatus("stopped");
                        }
                    }
                    else
                    {
                        EmitStatus("stopped");
                    }
                }
                catch (Exception ex)
                {
                    _simulatedPhrase = null;
                    _suppressInsertDuringSimulation = false;
                    EmitError("simulation-error", ex.Message);
                }
            }
        }

        private static void OnSpeechHypothesized(object sender, SpeechHypothesizedEventArgs e)
        {
            if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text))
            {
                // Discard low-confidence interim noise
                if (string.IsNullOrEmpty(_simulatedPhrase) && e.Result.Confidence < 0.20f)
                {
                    return;
                }
                string interim = !string.IsNullOrEmpty(_simulatedPhrase) ? _simulatedPhrase : e.Result.Text;
                EmitJson("{\"event\":\"interim\",\"text\":\"" + EscapeJson(interim) + "\"}");
            }
        }

        private static void OnSpeechRecognized(object sender, SpeechRecognizedEventArgs e)
        {
            if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text))
            {
                // Discard low-confidence noise, throat clears, and breathing artifacts
                if (string.IsNullOrEmpty(_simulatedPhrase) && e.Result.Confidence < 0.30f)
                {
                    return;
                }

                string rawText = !string.IsNullOrEmpty(_simulatedPhrase) ? _simulatedPhrase : e.Result.Text.Trim();

                // Filter out SAPI phantom ordinals generated during pauses or quiet breaths
                if (string.IsNullOrEmpty(_simulatedPhrase) && e.Result.Confidence < 0.65f)
                {
                    string lower = rawText.ToLowerInvariant();
                    if (lower == "fifth" || lower == "sixth" || lower == "eighth" ||
                        lower == "fourth" || lower == "ninth" || lower == "seventh" ||
                        lower == "third" || lower == "tenth")
                    {
                        return;
                    }
                }

                string finalText = ApplyReplacements(rawText);
                if (!_suppressInsertDuringSimulation)
                {
                    InsertTextIntoTargetWindow(finalText);
                }
                EmitJson("{\"event\":\"final\",\"text\":\"" + EscapeJson(finalText) + "\"}");
            }
        }

        private static void OnRecognizeCompleted(object sender, RecognizeCompletedEventArgs e)
        {
            if (e.Error != null)
            {
                _isListening = false;
                EmitError("recognition-error", e.Error.Message);
            }
        }

        private static void InsertTextIntoTargetWindow(string rawText)
        {
            if (string.IsNullOrEmpty(rawText)) return;

            IntPtr currentFg = NativeMethods.GetForegroundWindow();
            StringBuilder sb = new StringBuilder(256);
            if (currentFg != IntPtr.Zero)
            {
                NativeMethods.GetWindowText(currentFg, sb, 256);
            }

            IntPtr targetHwnd = currentFg;
            if (sb.ToString().Contains("Universal Voice-to-Text Helper") && _lastExternalHwnd != IntPtr.Zero)
            {
                targetHwnd = _lastExternalHwnd;
                NativeMethods.SetForegroundWindow(targetHwnd);
                Thread.Sleep(45);
            }

            string textToSend = rawText;
            if (_hasInsertedInCurrentTarget && targetHwnd == _lastInsertedHwnd)
            {
                char firstChar = rawText[0];
                if (".!,?;:)]}".IndexOf(firstChar) < 0)
                {
                    textToSend = " " + rawText;
                }
            }

            List<NativeMethods.INPUT> inputs = new List<NativeMethods.INPUT>(textToSend.Length * 2);
            foreach (char c in textToSend)
            {
                NativeMethods.INPUT down = new NativeMethods.INPUT();
                down.type = NativeMethods.INPUT_KEYBOARD;
                down.u.ki.wVk = 0;
                down.u.ki.wScan = c;
                down.u.ki.dwFlags = NativeMethods.KEYEVENTF_UNICODE;
                inputs.Add(down);

                NativeMethods.INPUT up = new NativeMethods.INPUT();
                up.type = NativeMethods.INPUT_KEYBOARD;
                up.u.ki.wVk = 0;
                up.u.ki.wScan = c;
                up.u.ki.dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP;
                inputs.Add(up);
            }

            if (inputs.Count > 0)
            {
                NativeMethods.INPUT[] arr = inputs.ToArray();
                uint sent = NativeMethods.SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
                if (sent > 0)
                {
                    _hasInsertedInCurrentTarget = true;
                    _lastInsertedHwnd = targetHwnd;
                }
            }
        }

        private static void EmitStatus(string status)
        {
            EmitJson("{\"event\":\"status\",\"status\":\"" + EscapeJson(status) + "\"}");
        }

        private static void EmitError(string code, string message)
        {
            EmitJson("{\"event\":\"error\",\"code\":\"" + EscapeJson(code) + "\",\"message\":\"" + EscapeJson(message) + "\"}");
        }

        private static void EmitJson(string json)
        {
            Console.WriteLine(json);
            Console.Out.Flush();
        }

        private static string EscapeJson(string s)
        {
            if (s == null) return "";
            return s
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n");
        }

        private static string ExtractJsonString(string json, string key)
        {
            string pattern = "\"" + key + "\"";
            int keyIdx = json.IndexOf(pattern, StringComparison.Ordinal);
            if (keyIdx < 0) return "";
            int colonIdx = json.IndexOf(':', keyIdx + pattern.Length);
            if (colonIdx < 0) return "";
            int firstQuote = json.IndexOf('"', colonIdx + 1);
            if (firstQuote < 0) return "";

            StringBuilder result = new StringBuilder();
            bool escaped = false;
            for (int i = firstQuote + 1; i < json.Length; i++)
            {
                char c = json[i];
                if (escaped)
                {
                    if (c == 'n') result.Append('\n');
                    else if (c == 'r') result.Append('\r');
                    else if (c == 't') result.Append('\t');
                    else result.Append(c);
                    escaped = false;
                }
                else if (c == '\\')
                {
                    escaped = true;
                }
                else if (c == '"')
                {
                    break;
                }
                else
                {
                    result.Append(c);
                }
            }
            return result.ToString();
        }
    }
}
