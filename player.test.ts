import { expect, mock, test } from 'claude-code/testing'

import { equalizer, formatTime, parsePlaylist, parseProgress, progressBar } from './hooks/player'
import { rasterize } from './hooks/pixel'
import { SKINS } from './hooks/skins.gen'

test('playlist.txt: comments skipped, optional titles kept', () => {
  const list = parsePlaylist(
    [
      '# my mix',
      '',
      'https://www.youtube.com/watch?v=abc123 # Lofi beats',
      '  https://youtu.be/xyz  ',
      '/Users/me/Music/song.mp3',
    ].join('\n'),
  )
  expect(list).toEqual([
    { url: 'https://www.youtube.com/watch?v=abc123', title: 'Lofi beats' },
    { url: 'https://youtu.be/xyz' },
    { url: '/Users/me/Music/song.mp3' },
  ])
})

test('progress lines from mpv/progress.lua', () => {
  expect(parseProgress('noise\n@@pos|1.0|200.5|A\n@@pos|2.0|200.5|Song | Live\n')).toEqual({
    position: 2,
    duration: 200.5,
    title: 'Song | Live',
  })
  expect(parseProgress('nothing here')).toBe(undefined)
})

test('time, bar and equalizer formatting', () => {
  expect(formatTime(72)).toBe('01:12')
  expect(formatTime(3725)).toBe('1:02:05')
  expect(formatTime(-1)).toBe('--:--')
  expect(progressBar(50, 100, 10)).toBe('█████░░░░░')
  expect(progressBar(5, -1, 6)).toBe('░░░░░░')
  expect(equalizer(3, 8, false)).toBe('▁▁▁▁▁▁▁▁')
  expect(equalizer(3, 8, true).length).toBe(8)
})

test('every skin rasterizes into half-block rows within the width', () => {
  expect(SKINS.length).toBe(10)
  for (const sprite of SKINS) {
    expect(sprite.frames.length).toBe(5)
    for (let f = 0; f < sprite.frames.length; f++) {
      const rows = rasterize(sprite, f, 40)
      expect(rows.length <= 20).toBe(true)
      for (const runs of rows) {
        expect(runs.reduce((n, r) => n + r.text.length, 0) <= 40).toBe(true)
      }
    }
    // A narrow pane halves the picture.
    const narrow = rasterize(sprite, 0, 20)
    for (const runs of narrow) expect(runs.reduce((n, r) => n + r.text.length, 0) <= 20).toBe(true)
  }
})

test('/music skin switches and remembers the skin', async ($, on) => {
  mock.store(on)
  const music = (args: string) =>
    $.command.run({
      command: 'music',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  expect(await music('skin penguin')).toEqual(expect.objectContaining({ text: 'Skin: penguin' }))
  // Penguin is the last skin, so the next one wraps around to the first.
  expect(await music('skin')).toEqual(expect.objectContaining({ text: 'Skin: vinyl' }))
  expect(await music('skin nope')).toEqual(expect.objectContaining({ text: expect.stringContaining('No skin') }))
  expect(await music('skin 3')).toEqual(expect.objectContaining({ text: 'Skin: cat' }))
  expect(await music('skins')).toEqual(expect.objectContaining({ text: expect.stringContaining('▸  3. cat') }))
})

for (const bodyColumns of [44, 24]) {
  test(`the pane draws on the terminal at ${bodyColumns} columns`, async ($, on) => {
    mock.store(on)
    const ui = await $.ui.mount({
      plugin: 'pixel-player',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'pixel-player',
      props: {
        title: '♪ Pixel Player',
        isFocused: false,
        bodyColumns,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ key: 'play' })).toBeDefined()
    expect(await ui.find({ key: 'skin' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Nothing queued/ })).toBeDefined()
  })
}
