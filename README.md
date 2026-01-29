# Shorts Lab

Shorts Lab is a local, self-hosted Electron app that turns long videos into YouTube Shorts format. It can auto-detect standout moments, crop to 9:16, and optionally burn captions using a local Whisper.cpp binary.

## Features

- Drag & drop or click to import videos
- Auto 9:16 vertical crop + export
- Optional captions via Whisper (multi-language)
- Word-level captions (karaoke style) when supported
- Caption styling (style, size, position)
- Caption timing controls (offset, speed, auto align)
- GPU toggle for Whisper (CUDA if available)
- Local processing only (no uploads)

## How it works

1. Select a video (drag & drop or click).
2. Pick settings (duration, captions, styles).
3. Process: the app
   - trims to the selected moment,
   - generates captions (optional),
   - burns subtitles into a 9:16 output MP4.

### Whisper flow

- Downloads a compatible whisper-cli binary and the selected model on first run.
- Converts audio to mono 16k WAV.
- Generates SRT (and optionally word timestamps via JSON/WTS).
- Burns captions into the final MP4.

## Project structure

- electron/   Electron main process + processing pipeline
- src/renderer/   UI (React + Tailwind)

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Package (optional)

```bash
npm run dist
```

## Output folders

Exports are stored next to the input video under:

```
ai-short-maker/
  output/   # final MP4
  captions/ # temporary caption files (deleted after export)
  audio/    # temporary WAV files (deleted after export)
```

## Notes

- First caption run downloads models + whisper binary (requires internet once).
- Word-level captions need a whisper-cli build that supports JSON/WTS output.
- If captions drift, use Caption offset (ms) or Caption speed (%).

## Troubleshooting

- No captions: Make sure “Add captions (Whisper)” is enabled.
- Whisper errors on Windows: Ensure VC++ Redistributable 2015–2022 is installed.
- Word-level missing: Some binaries do not output word timestamps; the app falls back to SRT.

## Roadmap

- Smarter highlight detection
- Timeline preview and manual trim
- Preset styles and templates
- Upload presets and creator profiles

## License

MIT