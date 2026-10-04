export type Track = { url: string; title?: string }

export type PlayerStatus = 'stopped' | 'loading' | 'playing' | 'paused' | 'error'

export type Player = {
  status: PlayerStatus
  index: number
  title: string
  // Seconds; -1 while unknown (a live stream has no duration).
  position: number
  duration: number
  message?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-player': {
      player: Player
      playlist: Track[]
      skin: string
      frame: number
      volume: number
    }
  }
}
