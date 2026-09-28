# CutCap

**One command → remove silence automatically → get an editable CapCut project.**

Windows only. No UI. No render. No logo. No manual threshold.

## Install once

1. Install CapCut and create/open at least one normal project once, then **close CapCut**.
2. Download this repo as ZIP and extract it.
3. Double-click `install.cmd`.

`install.cmd` sets up:

- Node.js LTS if needed
- `capcut-cli 0.26.0`
- `Auto-Editor 31.6.0`
- the global `cutcap` command

## Use

```bat
cutcap "D:\Videos\video.mp4"
```

Then open CapCut. The new project will already be in the project list with the cuts on the timeline.

## Automatic settings

- Silence threshold: **recommended value calculated separately for each video**
- Before speech: **0.0s**
- After speech: **0.0s**
- Minimum cut: **0.35s**
- Minimum clip: **0.10s**
- Output: **editable CapCut project**

CapCut must stay closed while `cutcap` is running so its project index cannot be modified by two programs at the same time.

## Example

```text
1/3 تحليل الصوت...
2/3 الموصى به: 6.3% — قص السكوت...
3/3 تم: My Video - Auto Cut
القصات: 42 | الحساسية: 6.3% | قبل/بعد: 0/0 ثانية
افتح CapCut وهتلاقي المشروع جاهز.
```

## Credits

Built on:

- [Auto-Editor](https://github.com/WyattBlue/auto-editor)
- [capcut-cli](https://github.com/renezander030/capcut-cli)

