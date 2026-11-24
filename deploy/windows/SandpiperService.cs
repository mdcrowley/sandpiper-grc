// Sandpiper GRC service host for Windows (E42-02).
//
// A small Windows service that runs the server (node.exe server\src\main.ts) with the settings in
// a configuration file, restarts it if it stops by itself, stops it cleanly and keeps its console
// output in the logs folder. Built by tools\installer\build.ps1 with the C# compiler that comes with
// the .NET Framework 4 in every supported Windows (csc.exe), so it adds no runtime and no download.
// Written for that compiler: C# 5, no newer syntax.
//
//   SandpiperService.exe --name <service name> --config <grc.env>             (run by the service manager)
//   SandpiperService.exe --name <service name> --config <grc.env> --console   (in a window, for a test; Enter stops it)
//
// The configuration file holds KEY=VALUE lines (# starts a comment). They are given to the server
// as environment variables, on top of the service's own environment. Paths of the program files
// are worked out from where this file is: node\node.exe and app\ beside it.
//
// Stopping: the server watches for <GRC_DATA_DIR>\grc.stop and shuts down cleanly when it appears
// (finishing requests, waiting for a running backup and closing the embedded database). This host
// creates that file and waits up to 40 seconds before ending the process by force.
//
// Restarting: if the server stops without being asked to, it is started again after 5 seconds,
// doubling up to a minute while it keeps failing; a run of ten minutes or more resets the wait.
// The service manager's own recovery actions (set by the installer) restart this host if it fails.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace Sandpiper
{
    public class ServiceHost : ServiceBase
    {
        private const int StopWaitMs = 40000;
        private const long LogMaxBytes = 10L * 1024 * 1024;
        private const int LogKeep = 3;

        private readonly string configFile;
        private readonly string baseDir;
        private readonly object gate = new object();
        private Dictionary<string, string> settings;
        private Process child;
        private volatile bool stopping;
        private Thread supervisor;
        private readonly ManualResetEvent stopSignal = new ManualResetEvent(false);
        private string logFile;

        public ServiceHost(string name, string configFile)
        {
            this.ServiceName = name;
            this.CanStop = true;
            this.CanShutdown = true;
            this.AutoLog = true;
            this.configFile = configFile;
            this.baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        }

        public static int Main(string[] args)
        {
            string name = "SandpiperGRC";
            string config = null;
            bool console = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--name" && i + 1 < args.Length) name = args[++i];
                else if (args[i] == "--config" && i + 1 < args.Length) config = args[++i];
                else if (args[i] == "--console") console = true;
            }
            if (config == null)
            {
                Console.Error.WriteLine("Usage: SandpiperService.exe --name <service name> --config <grc.env> [--console]");
                return 2;
            }
            ServiceHost host = new ServiceHost(name, config);
            if (console)
            {
                host.StartHost();
                Console.WriteLine("Sandpiper GRC is starting. Press Enter to stop it.");
                Console.ReadLine();
                host.StopHost();
                return 0;
            }
            ServiceBase.Run(host);
            return 0;
        }

        /// <summary>KEY=VALUE lines; blank lines and lines starting with # are skipped.</summary>
        public static Dictionary<string, string> ReadSettings(string file)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string raw in File.ReadAllLines(file, Encoding.UTF8))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                values[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return values;
        }

        private string Setting(string key, string fallback)
        {
            string value;
            return settings != null && settings.TryGetValue(key, out value) && value.Length > 0 ? value : fallback;
        }

        protected override void OnStart(string[] args) { StartHost(); }

        protected override void OnStop()
        {
            RequestAdditionalTime(StopWaitMs + 10000);
            StopHost();
        }

        protected override void OnShutdown()
        {
            RequestAdditionalTime(StopWaitMs + 10000);
            StopHost();
        }

        public void StartHost()
        {
            settings = ReadSettings(configFile);
            string logDir = Setting("GRC_LOG_DIR", Path.Combine(Path.GetDirectoryName(Path.GetFullPath(configFile)), "..\\logs"));
            Directory.CreateDirectory(logDir);
            logFile = Path.Combine(logDir, "service.log");
            stopping = false;
            stopSignal.Reset();
            Log("Service host starting (" + ServiceName + ", settings " + configFile + ").");
            supervisor = new Thread(Supervise);
            supervisor.IsBackground = true;
            supervisor.Start();
        }

        public void StopHost()
        {
            stopping = true;
            stopSignal.Set();
            Process p;
            lock (gate) { p = child; }
            if (p != null && !HasExited(p))
            {
                string dataDir = Setting("GRC_DATA_DIR", null);
                try
                {
                    if (dataDir != null) File.WriteAllText(Path.Combine(dataDir, "grc.stop"), "");
                    Log("Asked the server to stop (grc.stop).");
                }
                catch (Exception e) { Log("Could not write grc.stop: " + e.Message); }
                if (!p.WaitForExit(StopWaitMs))
                {
                    Log("The server did not stop within " + (StopWaitMs / 1000) + " seconds; ending it.");
                    try { p.Kill(); p.WaitForExit(5000); } catch (Exception e) { Log("Could not end it: " + e.Message); }
                }
                else Log("The server stopped cleanly.");
            }
            if (supervisor != null) supervisor.Join(5000);
            Log("Service host stopped.");
        }

        private static bool HasExited(Process p)
        {
            try { return p.HasExited; } catch { return true; }
        }

        private void Supervise()
        {
            int waitMs = 5000;
            while (!stopping)
            {
                DateTime started = DateTime.UtcNow;
                Process p = null;
                try
                {
                    p = Launch();
                    lock (gate) { child = p; }
                    p.WaitForExit();
                }
                catch (Exception e)
                {
                    Log("Could not start the server: " + e.Message);
                }
                if (stopping) break;
                int code = -1;
                try { if (p != null) code = p.ExitCode; } catch { }
                if ((DateTime.UtcNow - started).TotalMinutes >= 10) waitMs = 5000;
                Log("The server stopped by itself (exit code " + code + "). Starting it again in " + (waitMs / 1000) + " seconds.");
                if (stopSignal.WaitOne(waitMs)) break;
                waitMs = Math.Min(waitMs * 2, 60000);
            }
        }

        private Process Launch()
        {
            settings = ReadSettings(configFile);
            string node = Path.Combine(baseDir, "node\\node.exe");
            string app = Path.Combine(baseDir, "app");
            ProcessStartInfo psi = new ProcessStartInfo(node,
                "--experimental-transform-types --disable-warning=ExperimentalWarning server\\src\\main.ts");
            psi.WorkingDirectory = app;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables["GRC_WEB_DIST"] = Path.Combine(app, "dist\\web");
            // The commit the installer was built from (shown with the version), unless the settings name one.
            string commitFile = Path.Combine(app, "COMMIT");
            if (File.Exists(commitFile)) psi.EnvironmentVariables["GRC_COMMIT"] = File.ReadAllText(commitFile).Trim();
            foreach (KeyValuePair<string, string> kv in settings) psi.EnvironmentVariables[kv.Key] = kv.Value;
            // A stop file left from an earlier run would stop the new server at once.
            string dataDir = Setting("GRC_DATA_DIR", null);
            if (dataDir != null) { try { File.Delete(Path.Combine(dataDir, "grc.stop")); } catch { } }
            Process p = new Process();
            p.StartInfo = psi;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
            p.Start();
            KillWithHost.Add(p);
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            Log("Started the server (process " + p.Id + ").");
            return p;
        }

        /// <summary>
        /// A job object that ends the server if this host ends without stopping it (a crash, or the
        /// process being killed), so a stray server never keeps the data folder locked.
        /// </summary>
        private static class KillWithHost
        {
            [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
            private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
            [System.Runtime.InteropServices.DllImport("kernel32.dll")]
            private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int length);
            [System.Runtime.InteropServices.DllImport("kernel32.dll")]
            private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

            [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
            private struct BasicLimits
            {
                public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
                public int LimitFlags;
                public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
                public int ActiveProcessLimit;
                public UIntPtr Affinity;
                public int PriorityClass, SchedulingClass;
            }
            [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
            private struct IoCounters { public ulong a, b, c, d, e, f; }
            [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
            private struct ExtendedLimits
            {
                public BasicLimits Basic;
                public IoCounters Io;
                public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
            }

            private static IntPtr job = IntPtr.Zero;

            public static void Add(Process p)
            {
                try
                {
                    if (job == IntPtr.Zero)
                    {
                        job = CreateJobObject(IntPtr.Zero, null);
                        ExtendedLimits info = new ExtendedLimits();
                        info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                        SetInformationJobObject(job, 9, ref info, System.Runtime.InteropServices.Marshal.SizeOf(typeof(ExtendedLimits)));
                    }
                    AssignProcessToJobObject(job, p.Handle);
                }
                catch { /* best effort */ }
            }
        }

        private readonly object logGate = new object();

        private void Log(string text)
        {
            lock (logGate)
            {
                try
                {
                    FileInfo info = new FileInfo(logFile);
                    if (info.Exists && info.Length > LogMaxBytes)
                    {
                        for (int i = LogKeep - 1; i >= 1; i--)
                        {
                            string from = logFile + "." + i, to = logFile + "." + (i + 1);
                            if (File.Exists(to)) File.Delete(to);
                            if (File.Exists(from)) File.Move(from, to);
                        }
                        File.Move(logFile, logFile + ".1");
                    }
                    File.AppendAllText(logFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + text + Environment.NewLine, Encoding.UTF8);
                }
                catch { /* the log must never stop the service */ }
            }
        }
    }
}
