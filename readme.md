# Rourin Radio

A web player for YouTube karaoke recordings, with songs played continuously and conversation skipped by default.

[Come take a listen!](https://rourin.am/)

## Listening

- **Playback:** **Yap Off** plays marked songs; **Yap On** plays full streams, including conversation. Loop a track or stream, or shuffle streams.
- **Find songs:** Search accepts approximate matches. The **🎵** button appears when other versions of the current song are available; click it to search them. Click the status bar for the current stream’s song list; select any song to play it.
- **Queue:** Add songs from search, the song list, or current playback. Queued songs take priority until the queue is empty. Use **Queue** to manage entries or play one immediately. **Loop Stream** becomes **Loop Queue** to repeat queued songs; **Previous Song** steps backward through the loop. Shuffle picks queued songs randomly, avoiding immediate repeats when possible.
- **Remembered state:** Yap, Loop, Shuffle, Member Mode, and the last stream and timestamp persist across visits. **Previous Stream** retraces shuffled playback history while the tab remains open.

## More options

- **Copy Stream URL:** Share the current stream and timestamp (`?v=…&t=…`); opening the link starts there.
- **Member Mode:** Show members-only streams, hidden by default. Playback requires an active YouTube membership and third-party cookies.
- **Import:** **Replace** or **Extend** automatically accepts playlist JSON, raw YouTube links or an exported queue from the clipboard. Queue imports skip songs missing from your playlist. **Export queue** copies the current queue as Base64; **Reset playlist** restores the defaults.
- **Restore running messages:** Bring back dismissed, rotating community announcements below the player.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| **Shift+S** or **double-tap Shift** | Toggle search |
| **Shift+A** | Toggle song list |
| **Shift+C** | Copy stream URL and timestamp |
| **Shift+M** | Toggle Member Mode |
| **Shift+I** | Toggle import menu |
| **Shift+Q** | Toggle queue |
| **Shift+E** | Queue the highlighted search/list song, or current song |
| **Escape** | Close the topmost panel |
| **↑ / ↓** | Navigate search results or song list |
| **Enter** | Play the highlighted song |
| **Shift+click Previous Stream** | Go to the previous stream in playlist order, bypassing history |

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or sponsored by Chroma Shift, Roca Rourin, rights holders, or any associated companies. All trademarks and copyrighted material remain the property of their respective owners.
