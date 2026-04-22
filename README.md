# Guidemaker

A fast, minimal screenshot markup tool for building SOPs. Drop in screenshots, draw orange boxes, arrows, and text over them, then export a PNG for each.

No build step. No dependencies. Open `index.html` in a browser.

## Features

- **Drop, paste, or browse** for images — queue as many as you want
- **Box** — orange rectangle outline
- **Arrow** — orange shaft + filled arrowhead
- **Text** — Helvetica Neue Bold, orange
- **Resize & move** anything after you draw it (drag handles or the shape itself)
- **Filmstrip** of all loaded images at the bottom — click to switch
- **Export** the active image as PNG (⌘E)
- Works offline. No server. No accounts.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select tool (pick older shapes to edit) |
| `B` | Box tool |
| `A` | Arrow tool |
| `T` | Text tool |
| `Tab` / `Shift+Tab` | Next / previous image |
| `⌘V` | Paste image from clipboard |
| `⌘Z` | Undo last markup |
| `⌘E` / `⌘S` | Export PNG |
| `Delete` / `Backspace` | Remove selected shape |
| `Escape` | Deselect / cancel text |
| `Enter` | Commit text |

## Workflow

1. Take screenshots (`⌘⇧⌃4` on macOS sends one to your clipboard).
2. Switch to Guidemaker and hit `⌘V` — or drop multiple files at once.
3. Press `B`, `A`, or `T` and mark up. New shapes are auto-selected, so you can drag the handles to resize or drag the body to move right away.
4. Press `V` later to reselect and edit an older shape.
5. Use the filmstrip to switch between images. Press `⌘E` to export whichever one is active.

## Opening it

Any of these work:

- **Double-click `Guidemaker.app`** in the folder — opens the tool in your default browser
- **Drag `Guidemaker.app` to the Dock** — then single-click anytime
- **Spotlight** — `⌘Space` → type "Guidemaker" → Enter
- **Double-click `index.html`** directly — same result, skips the launcher

The `.app` is just a 1 KB launcher that opens the sibling `index.html` in your browser — it's not a separate install. Delete the folder when you're done and everything goes with it.

## License

MIT
