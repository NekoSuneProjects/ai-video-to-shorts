const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { spawn, spawnSync } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const extract = require("extract-zip");

const MODEL_FILES = {
  tiny: "ggml-tiny.bin",
  "tiny.en": "ggml-tiny.en.bin",
  base: "ggml-base.bin",
  "base.en": "ggml-base.en.bin",
  small: "ggml-small.bin",
  "small.en": "ggml-small.en.bin",
  medium: "ggml-medium.bin",
  "medium.en": "ggml-medium.en.bin",
  "large-v1": "ggml-large-v1.bin",
  large: "ggml-large.bin",
  "large-v3-turbo": "ggml-large-v3-turbo.bin"
};

function getStorageRoot() {
  try {
    // Only available inside Electron main process
    const { app } = require("electron");
    if (app?.getPath) {
      return app.getPath("userData");
    }
  } catch (error) {
    // ignore, use cwd
  }
  return process.cwd();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function detectCudaVersion() {
  try {
    const result = spawnSync("nvidia-smi", [], { encoding: "utf8" });
    if (result.status !== 0) return null;
    const match = result.stdout.match(/CUDA Version:\s*([\d.]+)/i);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

function detectCudaAvailable() {
  return !!detectCudaVersion();
}

function resolvePackedBinary(binPath) {
  if (!binPath) return null;
  const unpacked = binPath.replace("app.asar", "app.asar.unpacked");
  if (fs.existsSync(unpacked)) return unpacked;
  return binPath;
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      resolve(response);
    });
    request.on("error", reject);
  });
}

async function downloadFile(url, destination, onProgress) {
  const tempPath = `${destination}.partial`;
  const headers = { "User-Agent": "shorts-lab" };

  const response = await httpsGet(url, headers);
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    return downloadFile(response.headers.location, destination, onProgress);
  }

  if (response.statusCode !== 200) {
    throw new Error(`Download failed: ${response.statusCode} ${response.statusMessage}`);
  }

  const total = Number(response.headers["content-length"] || 0);
  let received = 0;

  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(tempPath);
    response.on("data", (chunk) => {
      received += chunk.length;
      if (total > 0 && onProgress) {
        const pct = Math.min(Math.round((received / total) * 100), 100);
        onProgress(pct);
      }
    });
    response.pipe(fileStream);
    fileStream.on("finish", () => fileStream.close(resolve));
    fileStream.on("error", reject);
  });

  fs.renameSync(tempPath, destination);
}

async function fetchLatestReleaseAsset(target) {
  const headers = {
    "User-Agent": "shorts-lab",
    Accept: "application/vnd.github+json"
  };
  const response = await httpsGet(
    "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest",
    headers
  );
  if (response.statusCode !== 200) {
    throw new Error("Failed to fetch whisper.cpp releases");
  }

  const body = await new Promise((resolve, reject) => {
    let data = "";
    response.on("data", (chunk) => (data += chunk));
    response.on("end", () => resolve(data));
    response.on("error", reject);
  });

  const release = JSON.parse(body);
  const assets = release.assets || [];

  const pick = (patterns) =>
    assets.find((asset) => patterns.some((pattern) => pattern.test(asset.name)));

  const cpuPatterns = [];
  const cudaPatterns = [];

  if (target.platform === "win32") {
    cpuPatterns.push(/whisper.*bin.*win.*x64.*\.zip/i, /whisper.*win.*x64.*\.zip/i);
    cudaPatterns.push(/cublas.*win.*x64.*\.zip/i, /whisper.*cublas.*x64.*\.zip/i);
  } else if (target.platform === "darwin") {
    if (target.arch === "arm64") {
      cpuPatterns.push(/whisper.*mac.*arm64.*\.zip/i);
    } else {
      cpuPatterns.push(/whisper.*mac.*x64.*\.zip/i);
    }
  } else {
    cpuPatterns.push(/whisper.*linux.*x64.*\.zip/i, /whisper.*linux.*x86_64.*\.zip/i);
    cudaPatterns.push(/cublas.*linux.*x64.*\.zip/i, /whisper.*cublas.*x64.*\.zip/i);
  }

  const useCuda = target.withCuda;
  let asset = useCuda ? pick(cudaPatterns) || pick(cpuPatterns) : pick(cpuPatterns);

  if (!asset) {
    const platformKey =
      target.platform === "win32"
        ? /win/i
        : target.platform === "darwin"
          ? /mac|darwin/i
          : /linux/i;
    const archKey = target.arch === "arm64" ? /arm64|aarch64/i : /x64|x86_64|amd64/i;
    const zipAssets = assets.filter((a) => /\.zip$/i.test(a.name));
    asset =
      zipAssets.find((a) => platformKey.test(a.name) && archKey.test(a.name) && /whisper/i.test(a.name)) ||
      zipAssets.find((a) => platformKey.test(a.name) && /whisper/i.test(a.name)) ||
      zipAssets.find((a) => platformKey.test(a.name)) ||
      zipAssets[0];
  }

  if (!asset) {
    throw new Error("No matching whisper.cpp binary found in latest release.");
  }

  return asset.browser_download_url;
}

async function downloadWhisperBinary(binDir, onProgress, withCuda) {
  ensureDir(binDir);

  const explicitUrl = process.env.WHISPER_BIN_URL;
  const target = {
    platform: process.platform,
    arch: process.arch,
    withCuda
  };

  const url = explicitUrl || (await fetchLatestReleaseAsset(target));
  const zipPath = path.join(binDir, "whisper-bin.zip");

  onProgress?.(10, "Whisper: downloading binary...");
  await downloadFile(url, zipPath, (pct) => {
    onProgress?.(10 + Math.round((pct / 100) * 20), "Whisper: downloading binary...");
  });

  onProgress?.(35, "Whisper: extracting binary...");
  await extract(zipPath, { dir: binDir });
  fs.unlinkSync(zipPath);
}

function findWhisperBinary(binDir) {
  const candidates = [];
  const stack = [binDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const name = entry.name.toLowerCase();
      if (name === "whisper-cli.exe" || name === "whisper-cli") {
        candidates.push(full);
      }
    }
  }
  return candidates[0] || null;
}

async function ensureWhisperBinary(onProgress, withCuda) {
  const root = getStorageRoot();
  const binDir = path.join(root, "whisper", "bin");
  ensureDir(binDir);

  let binary = findWhisperBinary(binDir);
  if (!binary) {
    const legacy = findLegacyBinary(binDir);
    if (legacy) {
      onProgress?.(5, "Whisper: removing deprecated binary...");
      try {
        fs.unlinkSync(legacy);
      } catch (error) {
        // ignore
      }
    }
  }
  if (!binary) {
    await downloadWhisperBinary(binDir, onProgress, withCuda);
    binary = findWhisperBinary(binDir);
  }

  if (!binary) {
    throw new Error("Whisper binary not found after download (whisper-cli missing).");
  }
  return binary;
}

function findLegacyBinary(binDir) {
  const candidates = [];
  const stack = [binDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || !fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      const name = entry.name.toLowerCase();
      if (name === "main.exe" || name === "main") {
        candidates.push(full);
      }
    }
  }
  return candidates[0] || null;
}

async function ensureWhisperModel(modelName, onProgress) {
  const filename = MODEL_FILES[modelName];
  if (!filename) throw new Error(`Unknown model: ${modelName}`);

  const root = getStorageRoot();
  const modelDir = path.join(root, "whisper", "models");
  ensureDir(modelDir);

  const modelPath = path.join(modelDir, filename);
  if (fs.existsSync(modelPath)) return modelPath;

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${filename}`;
  onProgress?.(5, `Whisper: downloading model ${modelName}...`);
  await downloadFile(url, modelPath, (pct) => {
    onProgress?.(5 + Math.round((pct / 100) * 25), `Whisper: downloading model ${modelName}...`);
  });
  return modelPath;
}

function runWhisperCli(binary, args, onProgress, outputDir) {
  return new Promise((resolve, reject) => {
    const binaryDir = path.dirname(binary);
    const env = { ...process.env };
    if (!env.PATH?.includes(binaryDir)) {
      env.PATH = `${binaryDir}${path.delim}${env.PATH || ""}`;
    }
    const child = spawn(binary, args, { stdio: "pipe", cwd: outputDir, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (text.toLowerCase().includes("processing")) {
        onProgress?.(60, "Whisper: transcribing...");
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (text.toLowerCase().includes("processing")) {
        onProgress?.(60, "Whisper: transcribing...");
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
        if (process.platform === "win32" && code === 3221225781) {
          reject(
            new Error(
              "whisper-cli exited with code 3221225781 (missing DLL). Install Microsoft Visual C++ Redistributable 2015-2022 (x64) and retry."
            )
          );
          return;
        }
        reject(new Error(`whisper-cli exited with code ${code}${detail ? `\n${detail}` : ""}`));
      }
    });
  });
}

function convertToWav(inputPath, outputDir, trim) {
  const resolvedFfmpeg = resolvePackedBinary(ffmpegStatic);
  if (!resolvedFfmpeg) {
    throw new Error("ffmpeg-static not found for audio conversion");
  }
  const outputPath = path.join(outputDir, `${path.parse(inputPath).name}.wav`);
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      ...(trim?.start ? ["-ss", String(trim.start)] : []),
      ...(trim?.duration ? ["-t", String(trim.duration)] : []),
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      outputPath
    ];
    const child = spawn(resolvedFfmpeg, args, { stdio: "pipe" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error("Failed to convert audio to WAV"));
    });
  });
}

function findLatestSrt(outputDir) {
  if (!fs.existsSync(outputDir)) return null;
  const srtFiles = fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith(".srt"))
    .map((name) => ({
      path: path.join(outputDir, name),
      time: fs.statSync(path.join(outputDir, name)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time);
  return srtFiles.length ? srtFiles[0].path : null;
}

function findLatestWts(outputDir) {
  if (!fs.existsSync(outputDir)) return null;
  const wtsFiles = fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith(".wts"))
    .map((name) => ({
      path: path.join(outputDir, name),
      time: fs.statSync(path.join(outputDir, name)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time);
  return wtsFiles.length ? wtsFiles[0].path : null;
}

async function transcribeWithWhisper(inputPath, outputDir, audioDir, settings, onProgress, selection) {
  if (!inputPath) throw new Error("Missing input for whisper");

  const modelName = settings?.whisperModel || "base";
  const language = settings?.whisperLanguage || "auto";
  const wordLevel = settings?.wordLevelCaptions === true;

  const withCuda = settings?.withCuda === true && detectCudaAvailable();
  const binary = await ensureWhisperBinary(onProgress, withCuda);
  const modelPath = await ensureWhisperModel(modelName, onProgress);

  onProgress?.(40, "Whisper: preparing audio...");
  const wavPath = await convertToWav(inputPath, audioDir, selection);

  const outputBase = path.join(outputDir, `captions-${Date.now()}`);
  const args = ["-m", modelPath, "-f", wavPath, "-of", outputBase, "-osrt"];
  if (wordLevel) {
    args.push("-owts");
    args.push("-ojf");
  }
  if (language && language !== "auto") {
    args.push("-l", language);
  }

  onProgress?.(55, "Whisper: transcribing...");
  await runWhisperCli(binary, args, onProgress, outputDir);

  const srtPath = `${outputBase}.srt`;
  const wtsPath = `${outputBase}.wts`;
  const jsonPath = `${outputBase}.json`;
  const hasSrt = fs.existsSync(srtPath);
  const hasWts = fs.existsSync(wtsPath);
  const hasJson = fs.existsSync(jsonPath);
  const fallbackWts = hasWts ? wtsPath : findLatestWts(outputDir);
  const fallbackJson = hasJson ? jsonPath : null;

  if (!hasSrt) {
    const fallback = findLatestSrt(outputDir);
    if (fallback) {
      return { srtPath: fallback, wtsPath: fallbackWts, jsonPath: fallbackJson, wavPath };
    }
    throw new Error("Whisper did not output an SRT file");
  }

  return { srtPath, wtsPath: fallbackWts, jsonPath: fallbackJson, wavPath };
}

module.exports = { transcribeWithWhisper };
