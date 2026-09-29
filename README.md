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
- Before speech: **0.20s**
- After speech: **0.40s**
- Minimum cut: **0.35s**
- Minimum clip: **0.10s**
- Output: **editable CapCut project**

CapCut must stay closed while `cutcap` is running so its project index cannot be modified by two programs at the same time.

## Example

```text
1/3 Analyzing audio...
2/3 Recommended threshold: 6.3% - cutting silence...
3/3 Done: My Video - Auto Cut
Clips: 42 | Threshold: 6.3% | Speech padding: 0.20s before / 0.40s after
Open CapCut. The editable project is ready in your project list.
```

## Credits

Built on:

- [Auto-Editor](https://github.com/WyattBlue/auto-editor)
- [capcut-cli](https://github.com/renezander030/capcut-cli)

