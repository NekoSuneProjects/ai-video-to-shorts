const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const { transcribeWithWhisper } = require("./whisper.cjs");

function runCommand(command, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      onProgress?.(50, "Encoding video...");
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

function parseDurationSeconds(stderr) {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(match[4]) / 100;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function parseTimeSeconds(line) {
  const match = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(match[4]) / 100;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function runFfmpegWithProgress(command, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    let totalSeconds = null;

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.trim().length > 0) {
        onProgress?.(35, "FFmpeg running...");
      }
      if (totalSeconds === null) {
        const duration = parseDurationSeconds(text);
        if (duration) totalSeconds = duration;
      }
      const current = parseTimeSeconds(text);
      if (current && totalSeconds) {
        const ratio = Math.min(current / totalSeconds, 1);
        const progress = 40 + Math.round(ratio * 55);
        onProgress?.(progress, "Encoding video...");
      }
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg failed with exit code ${code}`));
    });
  });
}

function resolvePackedBinary(binPath) {
  if (!binPath) return null;
  const unpacked = binPath.replace("app.asar", "app.asar.unpacked");
  if (fs.existsSync(unpacked)) return unpacked;
  return binPath;
}

function selectBestMoment(_inputPath, _settings) {
  // TODO: Implement audio-energy + reaction detection (smiles/laughs/cheers) scoring.
  return { start: 0, duration: _settings?.targetDuration || 30 };
}

function parseSrtTime(time) {
  const match = time.match(/(\d+):(\d+):(\d+),(\d+)/);
  if (!match) return "0:00:00.00";
  const hours = match[1].padStart(1, "0");
  const minutes = match[2].padStart(2, "0");
  const seconds = match[3].padStart(2, "0");
  const centis = String(Math.floor(Number(match[4]) / 10)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}.${centis}`;
}

function splitCaptionText(text, maxWords, maxChars) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const word of words) {
    const nextLen = currentLen + (current.length ? 1 : 0) + word.length;
    if (
      (maxWords && current.length >= maxWords) ||
      (maxChars && nextLen > maxChars)
    ) {
      chunks.push(current.join(" "));
      current = [word];
      currentLen = word.length;
    } else {
      current.push(word);
      currentLen = nextLen;
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function parseAssSeconds(time) {
  const match = time.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const centis = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + centis / 100;
}

function formatAssSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centis = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(centis).padStart(2, "0")}`;
}

function detectLeadingSilenceSec(audioPath) {
  if (!ffmpegStatic || !audioPath) return 0;
  try {
    const result = spawn(ffmpegStatic, [
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-35dB:d=0.2",
      "-f",
      "null",
      "-"
    ]);
    let stderr = "";
    result.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    return new Promise((resolve) => {
      result.on("close", () => {
        const match = stderr.match(/silence_end:\s*([\d.]+)/);
        if (!match) return resolve(0);
        resolve(Number(match[1]) || 0);
      });
    });
  } catch (error) {
    return 0;
  }
}

function parseWtsFile(wtsPath) {
  const content = fs.readFileSync(wtsPath, "utf8");
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const words = [];
  for (const line of lines) {
    const match = line.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(.*)$/);
    if (!match) continue;
    words.push({
      start: Number(match[1]),
      end: Number(match[2]),
      text: match[3].trim()
    });
  }

  if (!words.length) return [];

  const maxEnd = Math.max(...words.map((w) => w.end));
  const scale = maxEnd > 1000 ? 0.001 : 1;

  return words.map((w) => ({
    start: w.start * scale,
    end: w.end * scale,
    text: w.text.replace(/\{.*?\}/g, "")
  }));
}

function parseWhisperJson(jsonPath) {
  const raw = fs.readFileSync(jsonPath, "utf8");
  const data = JSON.parse(raw);
  const words = [];

  const transcription = data?.transcription || [];
  for (const segment of transcription) {
    const tokens = segment?.tokens || [];
    for (const token of tokens) {
      const offsets = token?.offsets;
      const timestamps = token?.timestamps;
      const start = Number(offsets?.from ?? 0);
      const end = Number(offsets?.to ?? 0);
      const text = String(token?.text ?? "").trim();
      if (!text) continue;
      if (text.startsWith("[_") && text.endsWith("]")) continue;
      if (text === "," || text === "." || text === "!" || text === "?") continue;
      words.push({
        start,
        end,
        text: text.replace(/\{.*?\}/g, "")
      });
    }
  }

  if (!words.length) return [];
  const maxEnd = Math.max(...words.map((w) => w.end));
  const scale = maxEnd > 1000 ? 0.001 : 1;
  return words.map((w) => ({
    start: w.start * scale,
    end: w.end * scale,
    text: w.text
  }));
}

function buildAssFromWordList(words, outputDir, settings, selection, offsetSec) {
  if (!words.length) throw new Error("No word timestamps found");
  const style = settings?.captionStyle || "clean";
  const fontSize = settings?.captionSize || 48;
  const position = settings?.captionPosition || "bottom";

  const styles = {
    clean: {
      font: "Segoe UI Semibold",
      size: fontSize,
      primary: "&H00FFFFFF",
      outline: "&H00111111",
      shadow: 1,
      borderStyle: 1,
      outlineSize: 3
    },
    neon: {
      font: "Space Grotesk",
      size: fontSize,
      primary: "&H00E8FFF5",
      outline: "&H0031C9A9",
      shadow: 2,
      borderStyle: 1,
      outlineSize: 4
    },
    boxed: {
      font: "IBM Plex Sans",
      size: fontSize,
      primary: "&H00FFFFFF",
      outline: "&H00111111",
      shadow: 0,
      borderStyle: 3,
      outlineSize: 3
    },
    punchy: {
      font: "Impact",
      size: fontSize + 4,
      primary: "&H00FFFFFF",
      outline: "&H00000000",
      shadow: 2,
      borderStyle: 1,
      outlineSize: 4
    }
  };

  const chosen = styles[style] || styles.clean;
  const alignment = position === "middle" ? 5 : 2;

  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${chosen.font},${chosen.size},${chosen.primary},&H00000000,${chosen.outline},&H80000000,0,0,0,0,100,100,0,0,${chosen.borderStyle},${chosen.outlineSize},${chosen.shadow},${alignment},60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const selectionStart = Number(selection?.start || 0);
  const selectionEnd = selectionStart + Number(selection?.duration || 0);

  const timeScale = 100 / Number(settings?.captionSpeed || 100);
  const minWordSec = Number(settings?.minWordDurationMs || 120) / 1000;

  const events = words
    .filter((word) => {
      if (selectionEnd > 0 && (word.end <= selectionStart || word.start >= selectionEnd)) {
        return false;
      }
      return true;
    })
    .map((word) => {
      const clippedStart = Math.max(word.start, selectionStart);
      const clippedEnd = selectionEnd > 0 ? Math.min(word.end, selectionEnd) : word.end;
      const adjustedStart = Math.max((clippedStart - selectionStart) * timeScale + offsetSec, 0);
      let adjustedEnd = Math.max((clippedEnd - selectionStart) * timeScale + offsetSec, 0);
      if (adjustedEnd - adjustedStart < minWordSec) {
        adjustedEnd = adjustedStart + minWordSec;
      }
      return `Dialogue: 0,${formatAssSeconds(adjustedStart)},${formatAssSeconds(
        adjustedEnd
      )},Default,,0,0,0,,${word.text}`;
    })
    .join("\n");

  const assPath = path.join(outputDir, `captions-${Date.now()}.ass`);
  fs.writeFileSync(assPath, assHeader + events, "utf8");
  return assPath;
}

function buildAssFromWts(wtsPath, outputDir, settings, selection, offsetSec) {
  const words = parseWtsFile(wtsPath);
  return buildAssFromWordList(words, outputDir, settings, selection, offsetSec);
}

function buildAssFromSrt(srtPath, outputDir, settings, selection, offsetSec) {
  const raw = fs.readFileSync(srtPath, "utf8");
  const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean);

  const style = settings?.captionStyle || "clean";
  const fontSize = settings?.captionSize || 48;
  const position = settings?.captionPosition || "bottom";

  const styles = {
    clean: {
      font: "Segoe UI Semibold",
      size: fontSize,
      primary: "&H00FFFFFF",
      outline: "&H00111111",
      shadow: 1,
      borderStyle: 1,
      outlineSize: 3
    },
    neon: {
      font: "Space Grotesk",
      size: fontSize,
      primary: "&H00E8FFF5",
      outline: "&H0031C9A9",
      shadow: 2,
      borderStyle: 1,
      outlineSize: 4
    },
    boxed: {
      font: "IBM Plex Sans",
      size: fontSize,
      primary: "&H00FFFFFF",
      outline: "&H00111111",
      shadow: 0,
      borderStyle: 3,
      outlineSize: 3
    },
    punchy: {
      font: "Impact",
      size: fontSize + 4,
      primary: "&H00FFFFFF",
      outline: "&H00000000",
      shadow: 2,
      borderStyle: 1,
      outlineSize: 4
    }
  };

  const chosen = styles[style] || styles.clean;

  const alignment = position === "middle" ? 5 : 2; // 2=bottom-center, 5=middle-center
  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${chosen.font},${chosen.size},${chosen.primary},&H00000000,${chosen.outline},&H80000000,0,0,0,0,100,100,0,0,${chosen.borderStyle},${chosen.outlineSize},${chosen.shadow},${alignment},60,60,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const maxWords = settings?.captionMaxWords || 6;
  const maxChars = settings?.captionMaxChars || 36;

  const selectionStart = Number(selection?.start || 0);
  const selectionEnd = selectionStart + Number(selection?.duration || 0);

  const timeScale = 100 / Number(settings?.captionSpeed || 100);
  const events = blocks
    .map((block) => block.split(/\r?\n/))
    .flatMap((lines) => {
      const timeLine = lines.find((line) => line.includes("-->"));
      if (!timeLine) return [];
      const [startRaw, endRaw] = timeLine.split("-->").map((s) => s.trim());
      const start = parseSrtTime(startRaw);
      const end = parseSrtTime(endRaw);
      const startSec = parseAssSeconds(start);
      const endSec = parseAssSeconds(end);

      if (selectionEnd > 0 && (endSec <= selectionStart || startSec >= selectionEnd)) {
        return [];
      }

      const clippedStart = Math.max(startSec, selectionStart);
      const clippedEnd = selectionEnd > 0 ? Math.min(endSec, selectionEnd) : endSec;
      if (clippedEnd <= clippedStart) return [];
      const textLines = lines.filter(
        (line) => line && !line.includes("-->") && !/^\d+$/.test(line)
      );
      const text = textLines.join(" ").replace(/\{.*?\}/g, "").trim();
      if (!text) return [];

      const chunks = splitCaptionText(text, maxWords, maxChars);
      const adjustedStart = Math.max((clippedStart - selectionStart) * timeScale + offsetSec, 0);
      const adjustedEnd = Math.max((clippedEnd - selectionStart) * timeScale + offsetSec, 0);
      if (chunks.length <= 1) {
        return [
          `Dialogue: 0,${formatAssSeconds(adjustedStart)},${formatAssSeconds(
            adjustedEnd
          )},Default,,0,0,0,,${text}`
        ];
      }

      const total = Math.max(adjustedEnd - adjustedStart, 0.1);
      const slice = total / chunks.length;

      return chunks.map((chunk, index) => {
        const segStart = formatAssSeconds(adjustedStart + slice * index);
        const segEnd = formatAssSeconds(adjustedStart + slice * (index + 1));
        return `Dialogue: 0,${segStart},${segEnd},Default,,0,0,0,,${chunk}`;
      });
    })
    .join("\n");

  const assPath = path.join(outputDir, `captions-${Date.now()}.ass`);
  fs.writeFileSync(assPath, assHeader + events, "utf8");
  return assPath;
}

async function processVideo(payload, onProgress) {
  if (!payload?.inputPath) throw new Error("No input video provided");

  const settings = payload.settings || {};
  onProgress?.(5, "Analyzing audio + reactions...");

  const inputPath = payload.inputPath;
  const baseDir = path.join(path.dirname(inputPath), "ai-short-maker");
  const outputDir = path.join(baseDir, "output");
  const captionsDir = path.join(baseDir, "captions");
  const audioDir = path.join(baseDir, "audio");
  [baseDir, outputDir, captionsDir, audioDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  const outputPath = path.join(outputDir, `short-${Date.now()}.mp4`);
  const selection = selectBestMoment(inputPath, settings);
  let captionsPath = null;
  let wtsPath = null;
  let jsonPath = null;
  let wavPath = null;

  let assPath = null;

  if (settings.burnCaptions) {
    onProgress?.(15, "Running Whisper transcription...");
    try {
      const result = await transcribeWithWhisper(
        inputPath,
        captionsDir,
        audioDir,
        settings,
        onProgress,
        selection
      );
      captionsPath = result?.srtPath || null;
      wtsPath = result?.wtsPath || null;
      jsonPath = result?.jsonPath || null;
      wavPath = result?.wavPath || null;
    } catch (error) {
      const message = error?.message || "Whisper failed";
      throw new Error(`Whisper failed: ${message}`);
    }
  }

  onProgress?.(30, "Preparing FFmpeg...");

  const filterChain = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920"
  ];

  if (settings.burnCaptions) {
    if (!captionsPath) {
      throw new Error("Whisper captions not found. Cannot burn subtitles.");
    }
    const manualOffsetSec = Number(settings?.captionOffsetMs || 0) / 1000;
    const autoOffsetSec = settings?.autoCaptionOffset ? await detectLeadingSilenceSec(wavPath) : 0;
    const offsetSec = manualOffsetSec + autoOffsetSec;
    const captionSelection = { start: 0, duration: selection.duration };
    if (settings.wordLevelCaptions) {
      let built = false;
      if (wtsPath) {
        try {
          assPath = buildAssFromWts(wtsPath, captionsDir, settings, captionSelection, offsetSec);
          built = true;
        } catch (error) {
          onProgress?.(35, "Word timestamps missing in .wts, trying JSON...");
        }
      }
      if (!built && jsonPath) {
        const words = parseWhisperJson(jsonPath);
        if (words.length) {
          assPath = buildAssFromWordList(words, captionsDir, settings, captionSelection, offsetSec);
          built = true;
        }
      }
      if (!built) {
        onProgress?.(35, "Word timestamps not supported by this binary. Using SRT lines.");
        assPath = buildAssFromSrt(captionsPath, captionsDir, settings, captionSelection, offsetSec);
      }
    } else {
      assPath = buildAssFromSrt(captionsPath, captionsDir, settings, captionSelection, offsetSec);
    }
    const escapedPath = captionsPath
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    const escapedAss = assPath
      .replace(/\\/g, "/")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    filterChain.push(`subtitles='${escapedAss}'`);
  }

  const ffmpegArgs = [
    "-y",
    "-ss",
    String(selection.start),
    "-i",
    inputPath,
    "-vf",
    filterChain.join(","),
    "-t",
    String(selection.duration),
    "-reset_timestamps",
    "1",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-af",
    "aresample=async=1",
    outputPath
  ];

  try {
    const ffmpegPath = resolvePackedBinary(ffmpegStatic) || "ffmpeg";
    await runFfmpegWithProgress(ffmpegPath, ffmpegArgs, onProgress);
  } catch (error) {
    throw new Error("FFmpeg failed. Install FFmpeg or bundle ffmpeg-static.");
  } finally {
    if (captionsPath) safeDelete(captionsPath);
    if (assPath) safeDelete(assPath);
    if (wtsPath) safeDelete(wtsPath);
    if (jsonPath) safeDelete(jsonPath);
    if (wavPath) safeDelete(wavPath);
  }

  onProgress?.(100, "Short created");
  return { outputPath, message: "Short created. Check output folder." };
}

function safeDelete(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // ignore cleanup failures
  }
}

module.exports = { processVideo };
