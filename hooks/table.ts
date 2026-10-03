// The table's moves, as pure functions over Table: the wall, the deal, flower replacement, and four
// players who draw, throw, call (吃 碰 槓) and win (自摸, or on a discard). Every discard is offered
// round the table from the thrower's right: 胡 first (the nearest winner takes it, 截胡), then 碰 or
// 槓, then 吃 by the next player alone. On your own turn a kan of four drawn (暗槓) or of a pon's
// fourth tile (加槓), then a replacement draw; the tile added to a pon may be won on (搶槓胡), by
// the nearest after the one adding it. A win is scored (score.ts).
//
// Hands follow one another: the dealer (莊) keeps the deal on a win or a dry wall (連莊), else it
// passes to the next player; once it comes back to you, the round wind (圈風) moves on.
import type { Claim, Meld, Seat, Table, Tile } from '../types'
import { bestDiscard, isWinning, pickBy, shanten, throws } from './hand'
import { payments, score } from './score'
import { freshWall, isFlower, isSuited, name, sorted } from './tiles'

export const HAND_SIZE = 16
// bots in turn order after you: 下家 plays first, 上家 last; you are player 3, the next after p is
// (p + 1) % 4
export const SEAT_NAMES = ['下家', '對家', '上家']
export const YOU = 3
export const WIND_NAMES = ['東', '南', '西', '北']
const LEFT = 2
const VERB = { chi: '吃', pon: '碰', kan: '槓' } as const

// a player's seat wind, 0-3 東南西北: the dealer sits 東
export const seatWind = (t: Pick<Table, 'dealer'>, p: number) => (p - t.dealer + 4) % 4

// one tile from the wall, flowers set aside and replaced; null once the wall is empty
function draw(wall: Tile[], flowers: Tile[]): Tile | null {
  for (;;) {
    const t = wall.pop()
    if (t === undefined) return null
    if (!isFlower(t)) return t
    flowers.push(t)
  }
}

function without(hand: readonly Tile[], take: readonly Tile[]): Tile[] {
  const rest = [...hand]
  for (const t of take) {
    const i = rest.indexOf(t)
    if (i >= 0) rest.splice(i, 1)
  }
  return rest
}

// a bot's call, numbered after the last
const shout = (t: Table, p: number, verb: string) => ({ who: p, verb, n: (t.shout?.n ?? 0) + 1 })

const who = (t: Table, p: number) => (p === YOU ? '你' : t.seats[p]!.name)
const dry = (t: Table, more: Partial<Table>): Table => ({ ...t, ...more, phase: 'over', claims: [], win: null, event: '牌摸完了，流局' })
// nobody has called yet: what 天胡 and 地胡 ask, with the winner's own river still empty
const noCalls = (t: Table) => t.melds.length === 0 && t.seats.every(s => s.melds.length === 0)

// p wins on `tile`, from `from` (null: 自摸), holding `hand` besides it; `t` already holds the draw.
// `how`: on the eighth flower (八仙過海), or on a tile added to a pon (搶槓胡)
function won(t: Table, p: number, tile: Tile, from: number | null, hand: readonly Tile[], how: 'eight' | 'robbed' | null = null): Table {
  const eightFlowers = how === 'eight'
  const melds = p === YOU ? t.melds : t.seats[p]!.melds
  const flowers = p === YOU ? t.flowers : t.seats[p]!.flowers
  const river = p === YOU ? t.river : t.seats[p]!.river
  const selfDrawn = from === null
  const tai = score({
    hand, tile, melds, flowers, selfDrawn, eightFlowers,
    seatWind: seatWind(t, p), roundWind: t.wind, isDealer: p === t.dealer,
    dealerPays: p === t.dealer || from === t.dealer || selfDrawn, streak: t.streak,
    first: selfDrawn && noCalls(t) && river.length === 0, last: selfDrawn && t.wall.length === 0,
    replaced: selfDrawn && t.replaced, robbed: how === 'robbed',
  })
  const event = eightFlowers ? `${who(t, p)}八仙過海`
    : how === 'robbed' ? `${who(t, p)}搶槓胡 ${name(tile)}`
    : selfDrawn ? `${who(t, p)}自摸 ${name(tile)}`
    : `${who(t, p)}胡 ${name(tile)}，${who(t, from)}放槍`
  const pay = payments(tai, p, from, t.dealer)
  return {
    ...t, phase: 'over', claims: [], robbing: null, scores: t.scores.map((n, q) => n + pay[q]!),
    win: { who: p, tile, from, hand: sorted(hand), melds, flowers, tai, pay }, event,
  }
}

export type Round = Pick<Table, 'dealer' | 'wind' | 'streak' | 'scores'>
const FIRST: Round = { dealer: YOU, wind: 0, streak: 0, scores: [0, 0, 0, 0] }

// sixteen each, then the dealer's seventeenth: yours as the drawn tile, a bot's into its hand
export function deal(rand: () => number, round: Round = FIRST): Table {
  const wall = freshWall(rand)
  const flowers: Tile[] = []
  const hand: Tile[] = []
  const seats: Seat[] = SEAT_NAMES.map(n => ({ name: n, hand: [], melds: [], flowers: [], river: [] }))
  for (let i = 0; i < HAND_SIZE; i++) {
    hand.push(draw(wall, flowers)!)
    for (const s of seats) s.hand.push(draw(wall, s.flowers)!)
  }
  const base = {
    wall, hand: sorted(hand), drawn: null, cursor: HAND_SIZE, melds: [], flowers, river: [], seats,
    claims: [], from: 0, thrown: null, robbing: null, shout: null, win: null, clickable: false, replaced: false, ...round,
  }
  if (round.dealer === YOU) {
    const drawn = draw(wall, flowers)
    for (const s of seats) s.hand = sorted(s.hand)
    return { ...base, drawn, phase: 'discard', turn: YOU, event: `開局，摸到 ${name(drawn!)}` }
  }
  seats[round.dealer]!.hand.push(draw(wall, seats[round.dealer]!.flowers)!)
  for (const s of seats) s.hand = sorted(s.hand)
  return { ...base, phase: 'ai', turn: round.dealer, event: `開局，${SEAT_NAMES[round.dealer]}當莊` }
}

// the hand after this one: the dealer keeps the deal on its win or a dry wall, else it passes on
export function nextHand(t: Table, rand: () => number): Table {
  if (t.phase !== 'over') return t
  const keep = !t.win || t.win.who === t.dealer
  const dealer = keep ? t.dealer : (t.dealer + 1) % 4
  const wind = !keep && dealer === YOU ? (t.wind + 1) % 4 : t.wind
  // the shout carries on, so the next hand's numbers follow on from it
  return { ...deal(rand, { dealer, wind, streak: keep ? t.streak + 1 : 0, scores: t.scores }), clickable: t.clickable, shout: t.shout }
}

// how many tiles the cursor walks over: the hand and the drawn tile
export const reach = (t: Table) => t.hand.length + (t.drawn ? 1 : 0)

export function move(t: Table, by: number): Table {
  const n = reach(t)
  return n ? { ...t, cursor: (((t.cursor + by) % n) + n) % n } : t
}

export const select = (t: Table, i: number): Table => ({ ...t, cursor: Math.max(0, Math.min(i, reach(t) - 1)) })

export function discard(t: Table): Table {
  if (t.phase !== 'discard') return t
  const all = t.drawn ? [...t.hand, t.drawn] : [...t.hand]
  const out = all[t.cursor]
  if (out === undefined) return t
  all.splice(t.cursor, 1)
  return offer({ ...t, hand: sorted(all), drawn: null, river: [...t.river, out], replaced: false, event: `你打出 ${name(out)}` }, YOU, out)
}

// what may be called on a discard: 胡 first, from anyone; chi only by the next player, pon and kan
// by anyone
export function claimsFor(hand: readonly Tile[], tile: Tile, canChi: boolean): Claim[] {
  const out: Claim[] = []
  if (isWinning([...hand, tile])) out.push({ kind: 'hu', tiles: [] })
  if (canChi && isSuited(tile)) {
    const s = tile[0]!
    const v = Number(tile[1])
    for (const [a, b] of [[v - 2, v - 1], [v - 1, v + 1], [v + 1, v + 2]] as const) {
      if (a >= 1 && b <= 9 && hand.includes(`${s}${a}`) && hand.includes(`${s}${b}`)) out.push({ kind: 'chi', tiles: [`${s}${a}`, `${s}${b}`] })
    }
  }
  const same = hand.filter(h => h === tile).length
  if (same >= 2) out.push({ kind: 'pon', tiles: [tile, tile] })
  if (same >= 3) out.push({ kind: 'kan', tiles: [tile, tile, tile] })
  return out
}

// what a bot calls: 胡 always; 槓 when it costs no progress; 碰 or 吃 when, after the best throw,
// the hand stands nearer ready than it does now
export function botClaim(hand: readonly Tile[], tile: Tile, canChi: boolean): Claim | null {
  const claims = claimsFor(hand, tile, canChi)
  if (claims[0]?.kind === 'hu') return claims[0]
  const now = shanten(hand)
  const kan = claims.find(c => c.kind === 'kan')
  if (kan && shanten(without(hand, kan.tiles)) <= now) return kan
  let pick: Claim | null = null
  let best = now
  for (const c of claims) {
    if (c.kind === 'kan') continue
    const rest = without(hand, c.tiles)
    const after = shanten(without(rest, [bestDiscard(rest)]))
    if (after < best) (pick = c, best = after)
  }
  return pick
}

// a discard goes round: your calls wait for you; with none, it settles at once
function offer(thrownBy: Table, from: number, tile: Tile): Table {
  const t = { ...thrownBy, thrown: from }
  const mine = from === YOU ? [] : claimsFor(t.hand, tile, from === LEFT)
  if (mine.length) return { ...t, phase: 'claim', claims: mine, from }
  return settle(t, from, tile, null)
}

// who takes the discard, if anyone: 胡 nearest the thrower's right, then 碰 or 槓, then 吃
function settle(t: Table, from: number, tile: Tile, mine: Claim | null): Table {
  const wants = [1, 2, 3].map(k => (from + k) % 4).map(p => ({
    p,
    c: p === YOU ? mine : botClaim(t.seats[p]!.hand, tile, p === (from + 1) % 4),
  }))
  const taker = wants.find(w => w.c?.kind === 'hu')
    ?? wants.find(w => w.c?.kind === 'pon' || w.c?.kind === 'kan')
    ?? wants.find(w => w.c?.kind === 'chi')
  const left = { ...t, claims: [], replaced: false }
  if (!taker?.c) return { ...left, phase: 'ai', turn: (from + 1) % 4 }
  // taken, the tile is the river's newest no more
  const base = { ...left, thrown: null }

  // the tile leaves the thrower's river
  const rivers = from === YOU
    ? { river: t.river.slice(0, -1), seats: t.seats }
    : { river: t.river, seats: t.seats.map((s, k) => (k === from ? { ...s, river: s.river.slice(0, -1) } : s)) }
  const { p, c } = taker
  if (c.kind === 'hu') {
    const hand = p === YOU ? t.hand : t.seats[p]!.hand
    return won({ ...base, ...rivers, drawn: p === YOU ? tile : t.drawn }, p, tile, from, hand)
  }
  const meld: Meld = { kind: c.kind, tiles: sorted([...c.tiles, tile]) }
  const event = `${who(t, p)}${VERB[c.kind]} ${name(tile)}`
  if (p !== YOU) {
    // the bot throws next; after a kan it first draws a replacement, its hand coming up a tile short
    const seats = rivers.seats.map((s, k) => (k === p ? { ...s, hand: without(s.hand, c.tiles), melds: [...s.melds, meld] } : s))
    return { ...base, river: rivers.river, seats, phase: 'ai', turn: p, replaced: c.kind === 'kan', shout: shout(t, p, VERB[c.kind]), event }
  }
  const hand = without(t.hand, c.tiles)
  const yours = { ...base, ...rivers, hand, melds: [...t.melds, meld], phase: 'discard' as const, turn: YOU }
  if (c.kind !== 'kan') return { ...yours, drawn: null, cursor: hand.length - 1, event: `${event}，請出牌` }
  const wall = [...t.wall]
  const flowers = [...t.flowers]
  const got = draw(wall, flowers)
  if (!got) return dry(yours, { wall, flowers, drawn: null })
  return { ...yours, wall, flowers, drawn: got, cursor: hand.length, replaced: true, event: `你槓 ${name(tile)}，補摸 ${name(got)}` }
}

// a kan on your own turn, from a hand of 3n+2: four alike (暗槓), or a pon's fourth tile (加槓)
export type SelfKan = { tile: Tile; kind: 'an' | 'jia' }

export function kansFor(hand: readonly Tile[], melds: readonly Meld[]): SelfKan[] {
  const out: SelfKan[] = []
  for (const x of new Set(hand)) if (hand.filter(h => h === x).length === 4) out.push({ tile: x, kind: 'an' })
  for (const m of melds) if (m.kind === 'pon' && hand.includes(m.tiles[0]!)) out.push({ tile: m.tiles[0]!, kind: 'jia' })
  return out
}

function laidKan(hand: readonly Tile[], melds: readonly Meld[], k: SelfKan): { hand: Tile[]; melds: Meld[] } {
  if (k.kind === 'an') return { hand: without(hand, [k.tile, k.tile, k.tile, k.tile]), melds: [...melds, { kind: 'kan', tiles: [k.tile, k.tile, k.tile, k.tile], concealed: true }] }
  return {
    hand: without(hand, [k.tile]),
    melds: melds.map(m => (m.kind === 'pon' && m.tiles[0] === k.tile ? { kind: 'kan', tiles: [...m.tiles, k.tile] } : m)),
  }
}

// a bot's kan: one that leaves it no further from ready than its best throw would
function botKan(hand: readonly Tile[], melds: readonly Meld[]): SelfKan | null {
  const kans = kansFor(hand, melds)
  if (!kans.length) return null
  const throwing = shanten(without(hand, [bestDiscard(hand)]))
  return kans.find(k => shanten(laidKan(hand, melds, k).hand) <= throwing) ?? null
}

// your kans now: on your turn, before you throw
export const yourKans = (t: Table): SelfKan[] => (t.phase === 'discard' ? kansFor(t.drawn ? [...t.hand, t.drawn] : t.hand, t.melds) : [])

// who would win on the tile p adds to a pon, nearest after p first
function robbers(t: Table, p: number, tile: Tile): number[] {
  return [1, 2, 3].map(k => (p + k) % 4).filter(q => isWinning([...(q === YOU ? t.hand : t.seats[q]!.hand), tile]))
}

export function selfKan(t: Table, i: number): Table {
  const k = yourKans(t)[i]
  if (!k) return t
  if (k.kind === 'jia') {
    const robber = robbers(t, YOU, k.tile)[0]
    if (robber !== undefined) {
      const hand = sorted(without(t.drawn ? [...t.hand, t.drawn] : t.hand, [k.tile]))
      return won({ ...t, hand, drawn: null }, robber, k.tile, YOU, t.seats[robber]!.hand, 'robbed')
    }
  }
  const laid = laidKan(t.drawn ? [...t.hand, t.drawn] : t.hand, t.melds, k)
  const wall = [...t.wall]
  const flowers = [...t.flowers]
  const got = draw(wall, flowers)
  const hand = sorted(laid.hand)
  if (!got) return dry(t, { wall, flowers, hand, melds: laid.melds, drawn: null })
  const what = k.kind === 'an' ? '暗槓' : `加槓 ${name(k.tile)}`
  return { ...t, wall, flowers, hand, melds: laid.melds, drawn: got, cursor: hand.length, replaced: true, event: `你${what}，補摸 ${name(got)}` }
}

// how dangerous a tile is to throw, from what lies open: for each player who looks near winning
// (three melds down, or anyone once the wall runs low), nothing if it lies in their river (現物);
// else an honor the less the more of it shows, a terminal less than the middle
const LOW_WALL = 20

function threats(t: Table, p: number): number[] {
  return [0, 1, 2, 3].filter(q => q !== p && (t.wall.length < LOW_WALL || (q === YOU ? t.melds : t.seats[q]!.melds).length >= 3))
}

function danger(t: Table, against: readonly number[], tile: Tile): number {
  const rivers = [t.river, ...t.seats.map(s => s.river)]
  const melds = [t.melds, ...t.seats.map(s => s.melds)].flat()
  const shown = rivers.flat().filter(x => x === tile).length + melds.flatMap(m => m.tiles).filter(x => x === tile).length
  const rank = Number(tile[1])
  const risk = tile[0] === 'z' ? [1, 1, 0.4, 0.1, 0][shown]! : rank === 1 || rank === 9 ? 0.7 : rank === 2 || rank === 8 ? 0.85 : 1
  return against.reduce((sum, q) => sum + ((q === YOU ? t.river : t.seats[q]!.river).includes(tile) ? 0 : risk), 0)
}

// what a bot throws: with nobody threatening, its best tile; near ready itself (one from ready or
// nearer), the best that is safest; further off, the safest, keeping what it can
export function botThrow(t: Table, p: number, hand: readonly Tile[]): Tile {
  const against = threats(t, p)
  if (!against.length) return bestDiscard(hand)
  const options = throws(hand)
  const near = Math.min(...options.map(w => w.shanten)) <= 1
  return pickBy(options, w => {
    const risk = danger(t, against, w.tile)
    return near ? [w.shanten, risk, ...w.loose] : [risk, w.shanten, ...w.loose]
  }).tile
}

// one beat: on your turn you draw; otherwise a bot draws (unless a call or the deal left it a tile
// to throw), wins on it, lays a kan (and draws again next beat) or throws, and the throw goes round.
// A player drawing the eighth flower wins at once (八仙過海)
export function step(t: Table): Table {
  if (t.phase !== 'ai') return t
  const wall = [...t.wall]
  if (t.turn === YOU) {
    const flowers = [...t.flowers]
    const got = draw(wall, flowers)
    if (!got) return dry(t, { wall, flowers })
    const extra = flowers.length - t.flowers.length
    const drew = { ...t, wall, flowers, drawn: got, cursor: t.hand.length, phase: 'discard' as const, replaced: extra > 0 }
    if (flowers.length === 8) return won(drew, YOU, flowers[7]!, null, [...t.hand, got], 'eight')
    return { ...drew, event: `${extra ? `補花 ${extra} 張，` : '你'}摸到 ${name(got)}` }
  }
  const p = t.turn
  const seat = t.seats[p]!
  const flowers = [...seat.flowers]
  let hand = [...seat.hand]
  let replaced = t.replaced
  if (hand.length % 3 === 1) {
    const got = draw(wall, flowers)
    if (!got) return dry(t, { wall })
    replaced ||= flowers.length > seat.flowers.length
    const drew = { ...t, wall, replaced, seats: t.seats.map((s, k) => (k === p ? { ...s, flowers } : s)) }
    if (flowers.length === 8) return won(drew, p, flowers[7]!, null, [...hand, got], 'eight')
    if (isWinning([...hand, got])) return won(drew, p, got, null, hand)
    hand = sorted([...hand, got])
  } else if (seat.river.length === 0 && p === t.dealer && noCalls(t) && isWinning(hand)) {
    // 天胡: the dealer's seventeen dealt complete
    return won(t, p, hand.at(-1)!, null, hand.slice(0, -1))
  }
  const kan = botKan(hand, seat.melds)
  if (kan?.kind === 'jia') {
    // the added tile may be won on: you are asked; a bot nearer takes it at once
    const held = { ...t, wall, seats: t.seats.map((s, k) => (k === p ? { ...s, hand, flowers } : s)) }
    const robber = robbers(held, p, kan.tile)[0]
    const event = `${seat.name}加槓 ${name(kan.tile)}`
    if (robber === YOU) return { ...held, phase: 'claim', claims: [{ kind: 'hu', tiles: [] }], from: p, robbing: kan.tile, event }
    if (robber !== undefined) return robbedFrom(held, p, kan.tile, robber)
  }
  if (kan) return laidBy(t, p, { hand, flowers, wall }, kan)
  const out = botThrow(t, p, hand)
  hand = without(hand, [out])
  const seats = t.seats.map((s, k) => (k === p ? { ...s, hand, flowers, river: [...s.river, out] } : s))
  return offer({ ...t, wall, seats, replaced: false, event: `${seat.name}打出 ${name(out)}` }, p, out)
}

// a bot's kan laid, from the hand it holds; it draws a replacement next beat
function laidBy(t: Table, p: number, held: { hand: Tile[]; flowers: Tile[]; wall: Tile[] }, kan: SelfKan): Table {
  const seat = t.seats[p]!
  const laid = laidKan(held.hand, seat.melds, kan)
  const seats = t.seats.map((s, k) => (k === p ? { ...s, ...laid, flowers: held.flowers } : s))
  const event = `${seat.name}${kan.kind === 'an' ? '暗槓' : `加槓 ${name(kan.tile)}`}`
  const verb = kan.kind === 'an' ? '暗槓' : '加槓'
  return { ...t, wall: held.wall, seats, phase: 'ai', turn: p, claims: [], robbing: null, replaced: true, shout: shout(t, p, verb), event }
}

// robber wins on the tile kanner was adding to its pon; the pon stays a pon
function robbedFrom(t: Table, kanner: number, tile: Tile, robber: number): Table {
  const seats = t.seats.map((s, k) => (k === kanner ? { ...s, hand: without(s.hand, [tile]) } : s))
  const hand = robber === YOU ? t.hand : t.seats[robber]!.hand
  return won({ ...t, seats, drawn: robber === YOU ? tile : t.drawn }, robber, tile, kanner, hand, 'robbed')
}

// the discard waiting on you, or the tile a bot is adding to its pon
export function waiting(t: Table): Tile {
  if (t.robbing) return t.robbing
  const r = t.from === YOU ? t.river : t.seats[t.from]!.river
  return r[r.length - 1]!
}

// your call on the discard; a bot's stronger call (胡 over 碰, 碰 over 吃) still takes it
export function call(t: Table, i: number): Table {
  const c = t.claims[i]
  if (t.phase !== 'claim' || !c) return t
  if (t.robbing) return robbedFrom(t, t.from, t.robbing, YOU)
  return settle(t, t.from, waiting(t), c)
}

// pass: on a kan's tile, a bot after you may still win on it; else the kan stands
export function pass(t: Table): Table {
  if (t.phase !== 'claim') return t
  if (t.robbing) {
    const after = robbers(t, t.from, t.robbing)
    const robber = after.slice(after.indexOf(YOU) + 1)[0]
    if (robber !== undefined) return robbedFrom(t, t.from, t.robbing, robber)
    const seat = t.seats[t.from]!
    return laidBy(t, t.from, { hand: seat.hand, flowers: seat.flowers, wall: t.wall }, { tile: t.robbing, kind: 'jia' })
  }
  return settle(t, t.from, waiting(t), null)
}

// 自摸: the drawn tile completes your hand
export const canTsumo = (t: Table) => t.phase === 'discard' && t.drawn !== null && isWinning([...t.hand, t.drawn])

export function tsumo(t: Table): Table {
  if (!canTsumo(t)) return t
  return won(t, YOU, t.drawn!, null, t.hand)
}
