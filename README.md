# Pixel Play

A pixel-art music player for Claude Code. It docks as a pane beside the conversation: you keep talking to Claude on the left while a pixel-art character dances to your playlist on the right.

```
┌─ conversation ───────────────────┐┌─ ♪ Pixel Player ──────────┐
│ > refactor the auth module       ││      (animated sprite)    │
│                                  ││                           │
│ ● I'll start by reading ...      ││ ▶ lofi hip hop radio      │
│                                  ││ ██████░░░░░░  01:12/02:45 │
│                                  ││ ▃▅▇▂▆▃▇▅                  │
│                                  ││ [⏮] [▶] [■] [⏭]           │
│                                  ││ ─ Playlist (3) ─          │
│                                  ││ ▸ 1. lofi hip hop radio   │
└──────────────────────────────────┘└───────────────────────────┘
```

It is a Claude Code mod (a plugin of function hooks). Playback goes through [mpv](https://mpv.io), controlled over its IPC socket, which streams YouTube links with [yt-dlp](https://github.com/yt-dlp/yt-dlp) without downloading the whole file first.

## Requirements

- Claude Code with mod (hooks module) support
- macOS (other systems should work wherever mpv runs, but are untested)
- `brew install mpv yt-dlp`
- A terminal with truecolor (iTerm2, Ghostty, kitty, WezTerm, ...)
- For the side-by-side layout: Claude Code's fullscreen layout and a terminal at least 110 columns wide. Claude Code decides this, not the mod: below 110 columns the pane opens above the prompt, where the player switches to a compact layout (small sprite beside the controls). Docked, it asks for about 30% of the terminal's width (30 to 44 columns) and shrinks the sprite on short windows. Drag the dock's edge to override the width.

## Install

The repository is its own plugin marketplace:

```sh
claude plugin marketplace add chrisluo5311/Pixel-Play
claude plugin install pixel-player@pixel-play
```

Restart Claude Code (or run `/reload-plugins`) and `/music` is available in every session. Update later with `claude plugin marketplace update pixel-play && claude plugin update pixel-player@pixel-play`.

To try it without installing: `git clone https://github.com/chrisluo5311/Pixel-Play.git && claude --plugin-dir ./Pixel-Play`.

Then add some tracks and start playing:

```
/music add https://www.youtube.com/watch?v=...
/music play
```

Your playlist lives in `~/.claude/pixel-play/playlist.txt`, outside the plugin folder, so updates never touch it. `playlist.example.txt` shows the format.

## Commands

| Command | What it does |
| --- | --- |
| `/music` | Open the player pane |
| `/music play [n]` | Play the playlist, optionally from track n |
| `/music pause` | Pause, or resume when paused |
| `/music resume` | Resume a paused track (`/music play` with no number also resumes) |
| `/music stop` | Stop |
| `/music next` / `/music prev` | Skip forward or back |
| `/music add <url>` | Append a YouTube link, direct audio URL or local file |
| `/music reload` | Re-read the playlist after editing it by hand |
| `/music skins` | List the skins |
| `/music skin [name or number]` | Switch skin (no argument: next skin) |
| `/music vol <0-100>` | Set the volume |

With the pane focused: `p` play / pause / resume, `s` stop, `n` next, `b` previous, `k` next skin, `u` / `d` volume up / down. Click a track in the playlist to play it.

## Playlist format

```
# Lines starting with # are comments.
https://www.youtube.com/watch?v=abc123
https://www.youtube.com/watch?v=def456 # Optional title shown until the real one loads
/Users/me/Music/song.mp3
```

Anything mpv can open works: YouTube and other sites yt-dlp supports, direct audio URLs, and local files.

## Skins

Ten animated skins, generated with [PixelLab](https://pixellab.ai) and drawn with half-block characters (`▀`), two pixels per terminal cell:

vinyl · headphone-kid · cat · cassette · anime-girl · handheld · shiba-dj · boombox · rainy-window · penguin

The source PNGs live in `assets/`. To add or change a skin, put a 40×40 PNG in `assets/png/NN-name.png` (and optionally its animation frames in `assets/frames/NN-name/0.png`, `1.png`, ...), then regenerate the sprite module:

```sh
node scripts/png2sprite.mjs
```

## Known limitations

- The volume applies from the next track on; the running mpv process is not controlled live yet.
- The equalizer is decorative; it is not driven by the audio.
- Streaming YouTube audio with yt-dlp may conflict with YouTube's Terms of Service. Use it for your own listening, at your own discretion.

## Development

```sh
claude plugin validate .
claude plugin test .
```

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | The `/music` command, playback, and the pane |
| `hooks/player.ts` | Playlist parsing, progress parsing, formatting |
| `hooks/pixel.tsx` | Half-block sprite renderer |
| `hooks/skins.gen.ts` | Generated sprite data (do not edit by hand) |
| `mpv/progress.lua` | mpv script that reports the playback position |
| `scripts/png2sprite.mjs` | PNG to sprite converter (Node, no dependencies) |
| `types/index.d.ts` | The mod's state contract |
| `player.test.ts` | Tests |
