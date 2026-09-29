# CutCap

**One CLI for fast video prep: silence cutting + editable CapCut timelines + YouTube clip downloads.**

Windows only. No GUI. The original one-command workflow still works.

## Install once

1. Install CapCut and create/open at least one normal project once, then **close CapCut**.
2. Download this repo as ZIP and extract it.
3. Double-click `install.cmd`.

The installer sets up:

- Node.js 22+ if needed
- `capcut-cli 0.26.0`
- `Auto-Editor 31.6.0`
- bundled `FFmpeg 6.1.1` via `ffmpeg-static 5.3.0`
- `yt-dlp 2026.08.19`
- the global `cutcap` command

## Interactive mode

Run:

```bat
cutcap
```

Menu:

```text
1) Auto-cut silence -> editable CapCut project
2) Download a YouTube clip
3) Download a full YouTube video
4) Download YouTube audio
5) Update YouTube downloader
6) Help
0) Exit
```

## Auto-cut silence

Original command, unchanged:

```bat
cutcap "D:\Videos\video.mp4"
```

Or explicitly:

```bat
cutcap cut "D:\Videos\video.mp4"
```

Automatic settings:

- Silence threshold: recommended value calculated separately for each video
- Before speech: **0.10s**
- After speech: **0.10s**
- Minimum cut: **0.35s**
- Minimum clip: **0.10s**
- Output: editable CapCut project

CapCut must stay closed while CutCap creates/registers the project.

## Download only part of a YouTube video

```bat
cutcap yt "https://youtu.be/VIDEO_ID" --from 12:30 --to 14:00 --quality 720
```

This uses yt-dlp `--download-sections` so it requests the selected time range instead of intentionally downloading the whole video first.

Important: media formats are segmented and seek around keyframes, so the downloader can fetch some extra adjacent data. Network usage is therefore not guaranteed to equal the exact final clip size.

### Exact cut mode

```bat
cutcap yt "https://youtu.be/VIDEO_ID" --from 12:30 --to 14:00 --quality 1080 --exact
```

`--exact` enables yt-dlp's `--force-keyframes-at-cuts`. It can make boundaries more exact, but it is slower because FFmpeg re-encodes around the cuts.

Fast mode is the default because it is better for quick downloads and low CPU usage.

If YouTube returns a `403 Forbidden` / SABR media error, CutCap automatically retries with an alternate YouTube player client. If that also fails, run `cutcap update` and retry.

## Download a full YouTube video

```bat
cutcap yt "https://youtu.be/VIDEO_ID" --quality 720
```

Supported quality caps:

`240`, `360`, `480`, `720`, `1080`, `1440`, `2160`, `best`

## Download audio

```bat
cutcap audio "https://youtu.be/VIDEO_ID"
```

Output: MP3.

A time range also works:

```bat
cutcap audio "https://youtu.be/VIDEO_ID" --from 01:10 --to 02:30
```

## Custom output folder

```bat
cutcap yt "https://youtu.be/VIDEO_ID" --from 10:00 --to 11:00 --output "D:\Clips"
```

Default output folder: Windows `Downloads`.

## Update yt-dlp

```bat
cutcap update
```

## Why FFmpeg is bundled

CutCap pins the YouTube workflow to the bundled FFmpeg instead of using any random FFmpeg found on the PC. This makes section downloads more predictable and avoids known regressions in newer FFmpeg builds.

## Credits

Built on:

- [Auto-Editor](https://github.com/WyattBlue/auto-editor)
- [capcut-cli](https://github.com/renezander030/capcut-cli)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
