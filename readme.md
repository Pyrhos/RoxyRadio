# Rourin Radio

Rourin Radio is a web player that turns karaoke VODs into a timestamped “radio” of songs.

## Features

- **Song-only vs. full-stream playback**
    - **Standard mode (Yap Off)** – plays only marked song segments and skips everything in between.
    - **Yap Mode (On)** – plays the full stream continuously with gaps and talk present.

- **Loop & shuffle**
    - **Loop Track** – repeat the current song indefinitely.
    - **Loop Stream** – loop all songs in the current stream.
    - **Shuffle** – randomizes the next stream; previous-stream button uses a session history so you can backtrack shuffled picks.

- **Session history & persistence**
    - Remembers your **Yap**, **Loop**, **Shuffle** settings and the last played stream + timecode across sessions.
    - Keeps a short **session-only history**, so you can jump back through previously played streams while the tab is open.

- **Search & duplicates**
    - Fuzzy search across all available songs.
    - Multiples detection – a note button appears when the current song has other versions across streams; clicking it opens search pre-filled with the song name.

- **Song list panel**
    - Click the status bar to expand a scrollable song list for the current stream.
    - Click or keyboard-navigate (Arrow keys + Enter) to jump to any song.

- **Sharing & URL parameters**
    - Share a direct link to the current stream and timecode with **Shift+C** (copies a `?v=…&t=…` URL to clipboard).
    - Opening a shared link jumps straight to that stream and timestamp.

- **Member-only streams**
    - Some streams are marked as member-only and hidden by default.
    - **Shift+M** toggles member mode on/off (persisted across sessions). Playback requires an active YouTube membership and third-party cookies.

- **Playlist import**
    - **Shift+I** opens the import modal. Paste a valid segments JSON into your clipboard, then choose **Replace** (swap the entire playlist) or **Extend** (merge with the built-in data).

- **Message bar**
    - A rotating announcement bar shows community messages between the player and the controls.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| **Shift+S** | Open / close search |
| **Double-tap Shift** | Open / close search (alternative) |
| **Shift+A** | Open / close song list panel |
| **Shift+C** | Copy shareable URL to clipboard |
| **Shift+M** | Toggle member-only streams |
| **Shift+I** | Open / close playlist import |
| **Escape** | Close the topmost open panel or modal |
| **Arrow Up / Down** | Navigate search results or song list |
| **Enter** | Select the highlighted search result or song |
| **Shift+click Previous Stream** | Bypass shuffle history and go to the actual previous stream |

---

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or sponsored by Chroma Shift, Roca Rourin, rights holders, or any associated companies. All trademarks and copyrighted material remain the property of their respective owners.
