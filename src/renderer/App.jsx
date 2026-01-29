import React, { useEffect, useMemo, useState } from "react";

const defaultSettings = {
  targetDuration: 30,
  aspect: "9:16",
  subtitleStyle: "boxed",
  highlightMode: "reactions",
  burnCaptions: true,
  whisperLanguage: "auto",
  whisperModel: "base",
  withCuda: false,
  captionStyle: "clean",
  captionSize: 52,
  captionPosition: "bottom",
  captionMaxWords: 6,
  captionMaxChars: 36,
  wordLevelCaptions: false,
  captionOffsetMs: 0,
  autoCaptionOffset: true,
  captionSpeed: 100,
  minWordDurationMs: 120
};

export default function App() {
  const [videoPath, setVideoPath] = useState("");
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem("shorts-settings");
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch (error) {
      return defaultSettings;
    }
  });
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Drop a video to begin");
  const [processing, setProcessing] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [updateStatus, setUpdateStatus] = useState({ status: "idle" });
  const [updateChannel, setUpdateChannel] = useState("stable");
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [appVersion, setAppVersion] = useState("0.0.0");
  const [updateProgress, setUpdateProgress] = useState(null);

  const badge = useMemo(() => {
    if (!videoPath) return "No file";
    const parts = videoPath.split(/[/\\]/);
    return parts[parts.length - 1];
  }, [videoPath]);

  useEffect(() => {
    try {
      localStorage.setItem("shorts-settings", JSON.stringify(settings));
    } catch (error) {
      // ignore persistence errors
    }
  }, [settings]);

  useEffect(() => {
    const unsubscribe = window.api?.onUpdateStatus?.((data) => {
      if (data) {
        setUpdateStatus(data);
        if (data.status === "downloaded" && !data.snoozed) {
          setShowUpdatePrompt(true);
        }
      }
    });
    const unsubscribeProgress = window.api?.onUpdateProgress?.((data) => {
      if (typeof data?.percent === "number") {
        setUpdateProgress(data.percent);
      }
    });
    window.api?.getUpdateChannel?.().then((res) => {
      if (res?.channel) setUpdateChannel(res.channel);
    });
    window.api?.getAppVersion?.().then((res) => {
      if (res?.version) setAppVersion(res.version);
    });
    window.api?.checkForUpdates?.();
    const interval = setInterval(() => {
      window.api?.checkForUpdates?.();
    }, 4 * 60 * 60 * 1000);
    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribeProgress) unsubscribeProgress();
      clearInterval(interval);
    };
  }, []);

  const handleDrop = async (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setVideoPath(file.path || file.name);
      setStatus("Ready to analyze");
    }
  };

  const openDialog = async () => {
    const picked = await window.api?.openFileDialog?.();
    if (picked) {
      setVideoPath(picked);
      setStatus("Ready to analyze");
    }
  };

  const runPipeline = async () => {
    if (!videoPath || processing) return;
    if (!window.api?.processVideo) {
      setStatus("Electron API not available. Run via Electron (npm run dev).");
      return;
    }
    setProcessing(true);
    setProgress(0);
    setStatus("Analyzing audio + reactions...");

    const unsubscribe = window.api?.onProgress?.((value, message) => {
      setProgress(value);
      if (message) setStatus(message);
    });
    const unsubscribeError = window.api?.onError?.((message) => {
      setStatus(message || "Processing failed");
    });

    try {
      const result = await window.api?.processVideo?.({
        inputPath: videoPath,
        settings
      });
      if (result?.error) {
        setStatus(result.error);
      } else if (result?.outputPath) {
        setOutputPath(result.outputPath);
        setStatus(result?.message || "Short created");
      } else {
        setStatus("Processing finished with no output. Check logs.");
      }
    } catch (err) {
      setStatus(err?.message || "Processing failed");
    } finally {
      setProcessing(false);
      if (unsubscribe) unsubscribe();
      if (unsubscribeError) unsubscribeError();
    }
  };

  const openUpload = () => {
    window.api?.openExternal?.("https://studio.youtube.com");
  };

  const handleUpdate = () => {
    const url = updateStatus?.asset?.browser_download_url;
    if (url) {
      window.api?.installUpdate?.(url);
    }
  };

  const downloadAndInstall = () => {
    if (updateStatus?.asset) {
      setUpdateProgress(0);
      window.api?.downloadAndInstallUpdate?.(updateStatus.asset);
    }
  };

  const remindLater = () => {
    window.api?.remindUpdateLater?.();
    setUpdateStatus({ status: "remind" });
  };

  const dismissUpdatePrompt = () => {
    setShowUpdatePrompt(false);
  };

  const changeUpdateChannel = async (event) => {
    const channel = event.target.value;
    setUpdateChannel(channel);
    await window.api?.setUpdateChannel?.(channel);
    window.api?.checkForUpdates?.();
  };

  return (
    <div className="min-h-screen bg-ink text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-grid bg-[length:28px_28px] opacity-20" />
      <div className="pointer-events-none fixed inset-0 bg-glow" />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] neon-text">Shorts Lab</p>
            <h1 className="mt-2 font-display text-4xl font-semibold text-white md:text-5xl">
              Build viral Shorts from long videos
            </h1>
            <p className="mt-3 max-w-2xl text-base text-slate-300">
              Local, self-hosted pipeline that detects standout reactions, trims the best moments,
              and burns Whisper captions in a vertical 9:16 format.
            </p>
          </div>
        </header>

        <section
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
          onClick={openDialog}
          className="group relative flex min-h-[220px] cursor-pointer items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 via-white/0 to-white/5 p-8 shadow-2xl shadow-black/40"
        >
          <div className="absolute inset-4 rounded-2xl border border-dashed border-white/10 transition group-hover:border-neon/60" />
          <div className="relative text-center">
            <p className="text-lg font-medium text-white">Drag & drop a video</p>
            <p className="mt-2 text-sm text-slate-400">
              Supported: mp4, mov, mkv. Click anywhere to import.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-neon" />
              {badge}
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-[1.3fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Pipeline</h2>
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>1. Audio + reaction scoring</span>
                <span className="text-neon">Auto</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>2. Best moment selection</span>
                <span className="text-neon">Top 1</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>3. Whisper captions</span>
                <span className="text-neon">Burned in</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>4. 9:16 crop + export</span>
                <span className="text-neon">1080x1920</span>
              </div>
            </div>
            <p className="mt-6 text-xs text-slate-400">
              Alpha build: expect rough edges. Please double-check settings and results. More tools
              and fixes are on the way.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Settings</h2>
            <div className="mt-6 space-y-3 text-sm">
              <details className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white">
                  Clip settings
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="flex items-center justify-between">
                    <span>Target duration (sec)</span>
                    <input
                      type="number"
                      value={settings.targetDuration}
                      min={15}
                      max={60}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          targetDuration: Number(event.target.value)
                        }))
                      }
                      className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Aspect ratio</span>
                    <select
                      value={settings.aspect}
                      onChange={(event) =>
                        setSettings((prev) => ({ ...prev, aspect: event.target.value }))
                      }
                      className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                    >
                      <option value="9:16">9:16</option>
                      <option value="4:5">4:5</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Highlight mode</span>
                    <select
                      value={settings.highlightMode}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          highlightMode: event.target.value
                        }))
                      }
                      className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                    >
                      <option value="reactions">Reactions + energy</option>
                      <option value="dialog">Dialogue peaks</option>
                    </select>
                  </label>
                </div>
              </details>

              <details className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white">
                  Caption settings
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="flex items-center justify-between">
                    <span>Add captions (Whisper)</span>
                    <input
                      type="checkbox"
                      checked={settings.burnCaptions}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          burnCaptions: event.target.checked
                        }))
                      }
                      className="h-4 w-4 accent-neon"
                    />
                  </label>
                  {settings.burnCaptions ? (
                    <>
                      <label className="flex items-center justify-between">
                        <span>Whisper language</span>
                        <select
                          value={settings.whisperLanguage}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              whisperLanguage: event.target.value
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                        >
                          <option value="auto">Auto detect</option>
                          <option value="en">English</option>
                          <option value="es">Spanish</option>
                          <option value="fr">French</option>
                          <option value="de">German</option>
                          <option value="pt">Portuguese</option>
                          <option value="hi">Hindi</option>
                          <option value="ja">Japanese</option>
                          <option value="ko">Korean</option>
                          <option value="ar">Arabic</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Whisper model</span>
                        <select
                          value={settings.whisperModel}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              whisperModel: event.target.value
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                        >
                          <option value="tiny">Tiny (fast)</option>
                          <option value="tiny.en">Tiny (English)</option>
                          <option value="base">Base</option>
                          <option value="base.en">Base (English)</option>
                          <option value="small">Small</option>
                          <option value="small.en">Small (English)</option>
                          <option value="medium">Medium</option>
                          <option value="medium.en">Medium (English)</option>
                          <option value="large-v1">Large v1</option>
                          <option value="large">Large v2</option>
                          <option value="large-v3-turbo">Large v3 turbo</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Caption style</span>
                        <select
                          value={settings.captionStyle}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionStyle: event.target.value
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                        >
                          <option value="clean">Clean</option>
                          <option value="neon">Neon</option>
                          <option value="boxed">Boxed</option>
                          <option value="punchy">Punchy</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Caption size</span>
                        <input
                          type="number"
                          min={28}
                          max={96}
                          value={settings.captionSize}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionSize: Number(event.target.value)
                            }))
                          }
                          className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Caption position</span>
                        <select
                          value={settings.captionPosition}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionPosition: event.target.value
                            }))
                          }
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                        >
                          <option value="bottom">Bottom</option>
                          <option value="middle">Middle</option>
                        </select>
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Word-level captions</span>
                        <input
                          type="checkbox"
                          checked={settings.wordLevelCaptions}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              wordLevelCaptions: event.target.checked
                            }))
                          }
                          className="h-4 w-4 accent-neon"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Auto align to speech</span>
                        <input
                          type="checkbox"
                          checked={settings.autoCaptionOffset}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              autoCaptionOffset: event.target.checked
                            }))
                          }
                          className="h-4 w-4 accent-neon"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Caption offset (ms)</span>
                        <input
                          type="number"
                          min={-1000}
                          max={1000}
                          step={25}
                          value={settings.captionOffsetMs}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionOffsetMs: Number(event.target.value)
                            }))
                          }
                          className="w-24 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Caption speed (%)</span>
                        <input
                          type="number"
                          min={80}
                          max={140}
                          step={5}
                          value={settings.captionSpeed}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionSpeed: Number(event.target.value)
                            }))
                          }
                          className="w-24 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Min word duration (ms)</span>
                        <input
                          type="number"
                          min={50}
                          max={300}
                          step={10}
                          value={settings.minWordDurationMs}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              minWordDurationMs: Number(event.target.value)
                            }))
                          }
                          className="w-24 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Max words per line</span>
                        <input
                          type="number"
                          min={2}
                          max={10}
                          value={settings.captionMaxWords}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionMaxWords: Number(event.target.value)
                            }))
                          }
                          className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                        />
                      </label>
                      <label className="flex items-center justify-between">
                        <span>Max chars per line</span>
                        <input
                          type="number"
                          min={16}
                          max={60}
                          value={settings.captionMaxChars}
                          onChange={(event) =>
                            setSettings((prev) => ({
                              ...prev,
                              captionMaxChars: Number(event.target.value)
                            }))
                          }
                          className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-right text-white"
                        />
                      </label>
                      <p className="text-xs text-white/60">
                        Whisper models will auto-download on first use (requires internet once).
                      </p>
                    </>
                  ) : null}
                </div>
              </details>

              <details className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white">
                  Performance
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="flex items-center justify-between">
                    <span>Use NVIDIA CUDA</span>
                    <input
                      type="checkbox"
                      checked={settings.withCuda}
                      onChange={(event) =>
                        setSettings((prev) => ({ ...prev, withCuda: event.target.checked }))
                      }
                      className="h-4 w-4 accent-neon"
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Update channel</span>
                    <select
                      value={updateChannel}
                      onChange={changeUpdateChannel}
                      className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-white"
                    >
                      <option value="stable">Stable (releases)</option>
                      <option value="beta">Beta (pre-releases)</option>
                    </select>
                  </label>
                </div>
              </details>
            </div>
          </div>
        </section>

        {updateStatus.status === "available" ? (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-white/70">Update</p>
                <p className="mt-2 text-lg font-medium text-white">
                  Update available
                </p>
                <p className="mt-1 text-sm text-white/70">
                  Version {updateStatus.latestVersion} is available (current {appVersion}).
                </p>
                <p className="mt-2 text-xs text-white/60">
                  Channel: {updateChannel === "beta" ? "Beta (pre-releases)" : "Stable (releases)"}
                </p>
                {updateStatus.snoozed ? (
                  <p className="mt-1 text-xs text-white/50">Updates are snoozed for now.</p>
                ) : null}
                {typeof updateProgress === "number" ? (
                  <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-neon transition-all"
                      style={{ width: `${updateProgress}%` }}
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={downloadAndInstall}
                  className="rounded-full bg-neon px-5 py-2 text-sm font-semibold text-ink shadow-xl shadow-neon/30 transition hover:brightness-110"
                >
                  Download & install
                </button>
                <button
                  onClick={remindLater}
                  className="rounded-full border border-white/15 bg-black/50 px-5 py-2 text-sm font-semibold text-white transition hover:border-neon/60 hover:text-neon"
                >
                  Remind me later
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {updateStatus.status === "none" || updateStatus.status === "checking" ? (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm uppercase tracking-[0.2em] text-white/70">Update</p>
            <p className="mt-2 text-lg font-medium text-white">
              {updateStatus.status === "checking" ? "Checking for updates..." : "Up to date"}
            </p>
            <p className="mt-1 text-sm text-white/70">
              Version {appVersion} • Channel{" "}
              {updateChannel === "beta" ? "Beta (pre-releases)" : "Stable (releases)"}
            </p>
          </section>
        ) : null}

        {showUpdatePrompt ? (
          <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-6">
            <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-ink p-6 shadow-2xl shadow-black/50">
              <p className="text-sm uppercase tracking-[0.2em] text-white/70">Update ready</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Download update now?
              </h3>
              <p className="mt-2 text-sm text-white/70">
                We will open the release asset in your browser.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={downloadAndInstall}
                  className="rounded-full bg-neon px-5 py-2 text-sm font-semibold text-ink shadow-xl shadow-neon/30 transition hover:brightness-110"
                >
                  Download & install
                </button>
                <button
                  onClick={dismissUpdatePrompt}
                  className="rounded-full border border-white/15 bg-black/50 px-5 py-2 text-sm font-semibold text-white transition hover:border-neon/60 hover:text-neon"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-gradient-to-r from-electric/30 via-white/5 to-neon/20 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-white/70">Status</p>
              <p className="mt-2 text-lg font-medium text-white">{status}</p>
              {outputPath ? (
                <p className="mt-1 text-xs text-white/70">
                  Output: <span className="text-neon">{outputPath}</span>
                </p>
              ) : null}
              <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-neon transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={runPipeline}
                disabled={!videoPath || processing}
                className="rounded-full bg-neon px-6 py-3 text-sm font-semibold text-ink shadow-xl shadow-neon/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {processing ? "Processing..." : "Create short"}
              </button>
              <button
                onClick={openUpload}
                className="rounded-full border border-white/15 bg-black/50 px-6 py-3 text-sm font-semibold text-white transition hover:border-neon/60 hover:text-neon"
              >
                Open YouTube Upload
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
