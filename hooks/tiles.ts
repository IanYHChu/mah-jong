// The tiles: codes, how each is drawn, the order a hand is sorted in, and a fresh wall.
// A tile is drawn three cells wide: a digit and its suit (5萬), or a space and an honor ( 東),
// so a hand lines up whatever it holds. CJK glyphs are two cells in every terminal; the Unicode
// mahjong block and circled digits are not, so neither is used.
import type { Meld, Tile } from '../types'

const SUIT: Record<string, string> = { m: '萬', p: '筒', s: '條' }
const HONOR = ['東', '南', '西', '北', '中', '發', '白']
const FLOWER = ['春', '夏', '秋', '冬', '梅', '蘭', '竹', '菊']
// 萬 yellow, 筒 cyan, 條 blue
const SUIT_COLOR: Record<string, string> = { m: 'yellow', p: 'cyan', s: 'blue' }
// winds bright black; 中 red, 發 green, 白 white
const HONOR_COLOR = ['blackBright', 'blackBright', 'blackBright', 'blackBright', 'red', 'green', 'white']
const ORDER = 'mpszf'

export const isSuited = (t: Tile) => t.charAt(0) in SUIT
export const isFlower = (t: Tile) => t[0] === 'f'
const rank = (t: Tile) => Number(t.slice(1))

// the glyph alone: 萬 for a suited tile, 東 for an honor, 春 for a flower
export function glyph(t: Tile): string {
  if (isSuited(t)) return SUIT[t[0]!]!
  return (t[0] === 'z' ? HONOR : FLOWER)[rank(t) - 1] ?? '?'
}

// three cells: "5萬" or " 東"
export const label = (t: Tile) => (isSuited(t) ? `${rank(t)}${glyph(t)}` : ` ${glyph(t)}`)

// the same without the pad, for running text: "5萬", "東"
export const name = (t: Tile) => label(t).trim()

export function color(t: Tile): string | undefined {
  if (isSuited(t)) return SUIT_COLOR[t[0]!]
  return t[0] === 'z' ? HONOR_COLOR[rank(t) - 1] : 'magenta'
}

export const compare = (a: Tile, b: Tile) => ORDER.indexOf(a[0]!) - ORDER.indexOf(b[0]!) || rank(a) - rank(b)
export const sorted = (ts: readonly Tile[]) => [...ts].sort(compare)

// a meld as one word, five cells at most so five fit an area: 345萬, and the tile counted for a
// pon or kan: 5筒x3, 中x4; a 暗槓 face down, as the others see it, is 暗槓
export function meldText(m: Meld, faceDown = false): string {
  if (faceDown && m.concealed) return '暗槓'
  const ts = sorted(m.tiles)
  if (m.kind !== 'chi') return `${name(ts[0]!)}x${ts.length}`
  return `${ts.map(rank).join('')}${glyph(ts[0]!)}`
}

// a small seeded generator, so a test can deal the same hand twice
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 144 tiles: four of each of the 34 kinds, and the eight flowers, shuffled
export function freshWall(rand: () => number): Tile[] {
  const wall: Tile[] = []
  for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) wall.push(`${s}${n}`)
  for (let n = 1; n <= 7; n++) for (let k = 0; k < 4; k++) wall.push(`z${n}`)
  for (let n = 1; n <= 8; n++) wall.push(`f${n}`)
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[wall[i], wall[j]] = [wall[j]!, wall[i]!]
  }
  return wall
}
