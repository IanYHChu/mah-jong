import { expect, mock, test } from 'claude-code/testing'

import { bestDiscard, isWinning, shanten } from './hand'
import { BASE, PER_TAI, payments, score, total } from './score'
import { HAND_SIZE, YOU, botClaim, botThrow, nextHand, seatWind, call, canTsumo, claimsFor, deal, discard, kansFor, pass, selfKan, step, tsumo, yourKans } from './table'
import { label, meldText, rng, sorted } from './tiles'

const BAND = {
  plugin: 'mah-jong',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('tiles draw three cells wide, melds as one word', () => {
  expect(label('m5')).toBe('5萬')
  expect(label('z1')).toBe(' 東')
  expect(meldText({ kind: 'chi', tiles: ['m5', 'm3', 'm4'] })).toBe('345萬')
  expect(meldText({ kind: 'pon', tiles: ['z5', 'z5', 'z5'] })).toBe('中x3')
  expect(meldText({ kind: 'kan', tiles: ['p5', 'p5', 'p5', 'p5'] })).toBe('5筒x4')
})

test('the deal: sixteen in hand and one drawn, flowers set aside, 144 tiles in all', () => {
  const t = deal(rng(7))
  expect(t.hand.length).toBe(HAND_SIZE)
  expect(t.drawn).not.toBeNull()
  expect([...t.hand, t.drawn!].some(x => x[0] === 'f')).toBe(false)
  const flowers = t.flowers.length + t.seats.reduce((n, s) => n + s.flowers.length, 0)
  expect(t.wall.length + HAND_SIZE * 4 + 1 + flowers).toBe(144)
})

test('chi only from 上家; pon and kan from anyone', () => {
  const hand = ['m3', 'm4', 'm6', 'p2', 'p2', 'p2']
  expect(claimsFor(hand, 'm5', true).map(c => c.tiles.join())).toEqual(['m3,m4', 'm4,m6'])
  expect(claimsFor(hand, 'm5', false)).toEqual([])
  expect(claimsFor(hand, 'p2', false).map(c => c.kind)).toEqual(['pon', 'kan'])
})

test('a hand wins as melds and one pair', () => {
  // 44筒 67筒 123條 567條 waits on 5筒 or 8筒
  const hand = ['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 's7']
  expect(isWinning([...hand, 'p8'])).toBe(true)
  expect(isWinning([...hand, 'p5'])).toBe(true)
  expect(isWinning([...hand, 'p9'])).toBe(false)
  // seventeen concealed: five melds and the pair; 111234萬 splits as 111 234, 111236萬 does not split
  const rest = ['p2', 'p3', 'p4', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'z5', 'z5']
  expect(isWinning(['m1', 'm1', 'm1', 'm2', 'm3', 'm4', ...rest])).toBe(true)
  expect(isWinning(['m1', 'm1', 'm1', 'm2', 'm3', 'm6', ...rest])).toBe(false)
  // honors make no runs
  expect(isWinning(['z1', 'z2', 'z3', 'm5', 'm5'])).toBe(false)
  // five melds down: the pair alone
  expect(isWinning(['z7', 'z7'])).toBe(true)
  expect(isWinning(['z7', 'f1'])).toBe(false)
})

test('胡 leads the calls on a winning discard, and 自摸 on a winning draw', () => {
  const hand = ['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 's7']
  expect(claimsFor(hand, 'p8', true).map(c => c.kind)).toEqual(['hu', 'chi'])
  expect(claimsFor(hand, 'p8', false).map(c => c.kind)).toEqual(['hu'])

  const base = deal(rng(3))
  const seats = base.seats.map((s, i) => (i === 2 ? { ...s, river: ['p8'] } : s))
  const won = call({ ...base, hand, drawn: null, seats, phase: 'claim', from: 2, claims: claimsFor(hand, 'p8', true) }, 0)
  expect(won.phase).toBe('over')
  expect(won.drawn).toBe('p8')
  expect(won.event).toBe('你胡 8筒，上家放槍')
  expect(won.win).toMatchObject({ who: 3, tile: 'p8', from: 2, hand: sorted(hand), melds: [] })

  const drew = { ...base, hand, drawn: 'p5', phase: 'discard' as const }
  expect(canTsumo(drew)).toBe(true)
  expect(tsumo(drew).phase).toBe('over')
  expect(canTsumo({ ...drew, drawn: 'p9' })).toBe(false)
  expect(tsumo({ ...drew, drawn: 'p9' }).phase).toBe('discard')
})

test('shanten: how far from ready', () => {
  const ready = ['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 's7']
  expect(shanten(ready)).toBe(0)
  expect(shanten([...ready, 'p8'])).toBe(-1)
  // one tile off: 44筒 67筒 123條 56條 9萬
  expect(shanten(['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 'm9'])).toBe(1)
})

test('a bot throws its loosest tile, keeping what is near ready', () => {
  // 44筒 67筒 123條 567條 and a lone 北: the 北 goes
  expect(bestDiscard(['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 's7', 'z4'])).toBe('z4')
  // a lone 9萬 before a lone 5萬
  expect(bestDiscard(['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 'm5', 'm9'])).toBe('m9')
})

test('a bot wins when it can, and calls only what brings it nearer', () => {
  const ready = ['p4', 'p4', 'p6', 'p7', 's1', 's2', 's3', 's5', 's6', 's7']
  expect(botClaim(ready, 'p8', false)?.kind).toBe('hu')
  // a pon of 4筒 would break the pair it waits on
  expect(botClaim(ready, 'p4', false)).toBeNull()
  // 中中 among loose tiles: the pon helps
  expect(botClaim(['z5', 'z5', 'm1', 'm4', 'm7', 'p2', 'p5'], 'z5', false)?.kind).toBe('pon')
})

test('a whole hand plays out: someone wins or the wall runs dry, every tile accounted for', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let t = deal(rng(seed))
    for (let i = 0; i < 400 && t.phase !== 'over'; i++) {
      if (t.phase === 'discard') t = discard({ ...t, cursor: t.hand.length })
      else if (t.phase === 'claim') t = pass(t)
      else t = step(t)
    }
    expect(t.phase).toBe('over')
    if (t.win) {
      // the winning hand, laid open, is complete
      const n = t.win.hand.length + 1 + t.win.melds.length * 3
      expect(n).toBe(17)
      expect(isWinning([...t.win.hand, t.win.tile])).toBe(true)
    } else expect(t.event).toBe('牌摸完了，流局')
    const melds = (ms: { tiles: string[] }[]) => ms.reduce((k, m) => k + m.tiles.length, 0)
    const held = t.hand.length + (t.drawn ? 1 : 0) + melds(t.melds) + t.river.length + t.flowers.length
      + t.seats.reduce((k, s) => k + s.hand.length + melds(s.melds) + s.river.length + s.flowers.length, 0)
    // a bot's winning tile, drawn or taken from a river, sits in no hand or river; yours is drawn
    const loose = t.win && t.win.who !== YOU ? 1 : 0
    expect(t.wall.length + held + loose).toBe(144)
  }
})

test('your own kans: four alike face down (暗槓), the fourth tile on a pon (加槓), each with a replacement draw', () => {
  const pon = { kind: 'pon' as const, tiles: ['z5', 'z5', 'z5'] }
  expect(kansFor(['m1', 'm1', 'm1', 'm1', 'z5', 'p2'], [pon])).toEqual([{ tile: 'm1', kind: 'an' }, { tile: 'z5', kind: 'jia' }])
  expect(kansFor(['m1', 'm1', 'm1', 'p2', 'p3'], [])).toEqual([])

  const base = deal(rng(3))
  const t = { ...base, hand: ['m1', 'm1', 'm1', 'p2', 'p3', 's5', 's5', 'z5'], drawn: 'm1', melds: [pon], phase: 'discard' as const }
  expect(yourKans(t).map(k => k.kind)).toEqual(['an', 'jia'])
  const an = selfKan(t, 0)
  expect(an.melds[1]).toEqual({ kind: 'kan', tiles: ['m1', 'm1', 'm1', 'm1'], concealed: true })
  expect(an.hand).toEqual(['p2', 'p3', 's5', 's5', 'z5'])
  expect(an.drawn).not.toBeNull()
  expect(an.wall.length).toBeLessThan(base.wall.length)
  expect(meldText(an.melds[1]!, true)).toBe('暗槓')
  expect(meldText(an.melds[1]!)).toBe('1萬x4')
  const jia = selfKan(t, 1)
  expect(jia.melds[0]).toEqual({ kind: 'kan', tiles: ['z5', 'z5', 'z5', 'z5'] })
  expect(jia.event).toMatch(/^你加槓 中，補摸 /)
})

test('a bot lays a kan it draws into, then draws again', () => {
  const base = deal(rng(3))
  // 下家 holds three 1萬 and the wall's next tile is the fourth
  const wall = [...base.wall.filter(x => x !== 'm1'), 'm1']
  const hand = ['m1', 'm1', 'm1', 'p2', 'p3', 'p4', 's6', 's7', 's8', 'z1', 'z1', 'z1', 'm5', 'm6', 'm7', 'z7']
  const t = { ...base, wall, phase: 'ai' as const, turn: 0, seats: base.seats.map((s, i) => (i === 0 ? { ...s, hand } : s)) }
  const kan = step(t)
  expect(kan.event).toBe('下家暗槓')
  expect(kan.seats[0]!.melds).toEqual([{ kind: 'kan', tiles: ['m1', 'm1', 'm1', 'm1'], concealed: true }])
  // sixteen and the drawn fourth, less the four: a tile short, so it draws again
  expect(kan.seats[0]!.hand.length).toBe(13)
  // its turn still: the next beat draws the replacement
  expect(kan.turn).toBe(0)
  expect(kan.phase).toBe('ai')
  const next = step(kan)
  expect(next.seats[0]!.river.length + (next.phase === 'over' ? 1 : 0)).toBe(1)
})

const FACTS = {
  melds: [], flowers: [], selfDrawn: false, seatWind: 1, roundWind: 0, isDealer: false, dealerPays: false,
  streak: 0, first: false, last: false, replaced: false, eightFlowers: false, robbed: false,
}
const names = (tai: { name: string; n: number }[]) => tai.map(x => `${x.name}${x.n}`).sort()

test('台: 門清自摸 平胡 on a two-sided wait', () => {
  // 123萬 456萬 123筒 789筒 99萬, 56條 waiting on 4條 or 7條
  const hand = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'p1', 'p2', 'p3', 'p7', 'p8', 'p9', 'm9', 'm9', 's5', 's6']
  const tai = score({ ...FACTS, hand, tile: 's7', selfDrawn: true })
  expect(names(tai)).toEqual(['平胡2', '門清自摸3'])
  // on a discard: 門清 alone, and 獨聽 on an edge wait (12 waiting on 3)
  const edge = [...hand.slice(0, 14), 's1', 's2']
  expect(names(score({ ...FACTS, hand: edge, tile: 's3' }))).toEqual(['平胡2', '獨聽1', '門清1'])
})

test('台: 大三元 碰碰胡 三暗刻, the triplet finished on a discard counted open', () => {
  // 發 laid down; 中中中 1萬x3 9筒x3 concealed, 白白 and 2條2條 waiting on either (雙碰), 白 thrown
  const hand = ['z5', 'z5', 'z5', 'm1', 'm1', 'm1', 'p9', 'p9', 'p9', 'z7', 'z7', 's2', 's2']
  const tai = score({ ...FACTS, hand, tile: 'z7', melds: [{ kind: 'pon', tiles: ['z6', 'z6', 'z6'] }] })
  expect(names(tai)).toEqual(['三暗刻2', '大三元8', '碰碰胡4'])
  expect(total(tai)).toBe(14)
  // drawn instead, the 白 triplet is concealed too: 四暗刻, and 自摸
  expect(names(score({ ...FACTS, hand, tile: 'z7', selfDrawn: true, melds: [{ kind: 'pon', tiles: ['z6', 'z6', 'z6'] }] })))
    .toEqual(['四暗刻5', '大三元8', '碰碰胡4', '自摸1'])
})

test('台: the dealer and its run, your own flowers, one suit with honors, seat and round winds', () => {
  const hand = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'z1', 'z1', 'z1', 'z2', 'z2', 'm5', 'm5']
  const tai = score({ ...FACTS, hand, tile: 'z2', dealerPays: true, streak: 2, flowers: ['f2', 'f6', 'f1'], seatWind: 1, roundWind: 0 })
  // 南 seat: 夏 and 蘭 are its own flowers, 春 is not; 東 is the round's wind, 南 the seat's
  expect(names(tai)).toEqual(['圈風1', '混一色4', '花牌1', '花牌1', '莊家1', '連2拉24', '門清1', '門風1'])
})

test('payments: the thrower alone pays, or on 自摸 all three; the dealer\'s 台 only between it and the winner', () => {
  const plain = [{ name: '平胡', n: 2 }, { name: '門清', n: 1 }]
  // 下家 wins on 對家's discard, you dealing: 對家 pays 底 and 3 台
  expect(payments(plain, 0, 1, YOU)).toEqual([BASE + 3 * PER_TAI, -(BASE + 3 * PER_TAI), 0, 0])
  // 下家 自摸 with you dealing on your second hand: you pay its 自摸 and your 莊家 and 連1拉1, the others its 自摸
  const drawn = [{ name: '自摸', n: 1 }, { name: '莊家', n: 1 }, { name: '連1拉1', n: 2 }]
  expect(payments(drawn, 0, null, YOU)).toEqual([2 * (BASE + PER_TAI) + BASE + 4 * PER_TAI, -(BASE + PER_TAI), -(BASE + PER_TAI), -(BASE + 4 * PER_TAI)])
  // you deal and draw it: everyone pays the dealer's 台
  expect(payments(drawn, YOU, null, YOU)).toEqual([-180, -180, -180, 540])
})

test('hands follow on: the dealer keeps the deal on its win or a dry wall, else it passes, and the round wind turns', () => {
  const t = deal(rng(3))
  expect(t.dealer).toBe(YOU)
  expect(seatWind(t, YOU)).toBe(0)
  const dry = nextHand({ ...t, phase: 'over', win: null }, rng(4))
  expect([dry.dealer, dry.wind, dry.streak]).toEqual([YOU, 0, 1])
  const lost = nextHand({ ...t, phase: 'over', win: { who: 1, tile: 'm1', from: null, hand: [], melds: [], flowers: [], tai: [], pay: [0, 0, 0, 0] } }, rng(4))
  expect([lost.dealer, lost.wind, lost.streak]).toEqual([0, 0, 0])
  // 下家 deals: its seventeenth in hand, its turn to throw
  expect(lost.phase).toBe('ai')
  expect(lost.turn).toBe(0)
  expect(lost.seats[0]!.hand.length).toBe(17)
  expect(lost.drawn).toBeNull()
  // back round to you, the wind moves on to 南
  const back = nextHand({ ...lost, dealer: 2, phase: 'over', win: { who: 0, tile: 'm1', from: null, hand: [], melds: [], flowers: [], tai: [], pay: [0, 0, 0, 0] } }, rng(5))
  expect([back.dealer, back.wind]).toEqual([YOU, 1])
})

test('搶槓胡: a tile added to a pon is won on, by the nearest; passed, the kan stands', () => {
  const base = deal(rng(3))
  // 下家 has 5筒x3 laid down and draws the fourth; your 46筒 waits on 5筒
  const ready = ['p4', 'p6', 's1', 's2', 's3', 's5', 's6', 's7', 'm1', 'm1', 'm1', 'z1', 'z1']
  const wall = [...base.wall.filter(x => x !== 'p5'), 'p5']
  const botHand = ['m2', 'm3', 'm4', 'p7', 'p8', 'p9', 's4', 's4', 'z6', 'z6', 'z7', 'z7', 'z3']
  const seats = base.seats.map((s, i) => (i === 0 ? { ...s, hand: botHand, melds: [{ kind: 'pon' as const, tiles: ['p5', 'p5', 'p5'] }] } : s))
  // make sure no other bot can win on 5筒
  const quiet = seats.map((s, i) => (i === 0 ? s : { ...s, hand: ['m1', 'm4', 'm7', 'p1', 'p9', 's1', 's9', 'z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'm9', 'p2'] }))
  const t = { ...base, wall, hand: ready, drawn: null, phase: 'ai' as const, turn: 0, seats: quiet }
  const asked = step(t)
  expect(asked.phase).toBe('claim')
  expect(asked.robbing).toBe('p5')
  expect(asked.event).toBe('下家加槓 5筒')
  expect(asked.claims.map(c => c.kind)).toEqual(['hu'])

  const robbed = call(asked, 0)
  expect(robbed.phase).toBe('over')
  expect(robbed.win).toMatchObject({ who: YOU, tile: 'p5', from: 0 })
  expect(robbed.win!.tai.map(x => x.name)).toContain('搶槓胡')
  // the pon stays a pon, the tile gone from 下家's hand
  expect(robbed.seats[0]!.melds).toEqual([{ kind: 'pon', tiles: ['p5', 'p5', 'p5'] }])

  const passed = pass(asked)
  expect(passed.phase).toBe('ai')
  expect(passed.seats[0]!.melds).toEqual([{ kind: 'kan', tiles: ['p5', 'p5', 'p5', 'p5'] }])
  expect(passed.replaced).toBe(true)
  expect(passed.event).toBe('下家加槓 5筒')
})

test('a bot far from ready, facing three melds down, throws what lies in that river (現物)', () => {
  const base = deal(rng(3))
  const laid = [{ kind: 'pon' as const, tiles: ['z5', 'z5', 'z5'] }, { kind: 'chi' as const, tiles: ['m1', 'm2', 'm3'] }, { kind: 'pon' as const, tiles: ['p9', 'p9', 'p9'] }]
  // 下家, scattered, holds a lone 5萬 and a lone 7條; you have 7條 in your river
  const hand = ['m5', 's7', 'p1', 'p4', 's2', 'z1', 'z3', 'm8', 'p6', 's9', 'z6', 'm2', 'p2', 's5']
  const facing = { ...base, melds: laid, river: ['s7'], seats: base.seats.map((s, i) => (i === 0 ? { ...s, hand, river: [] } : s)) }
  expect(botThrow(facing, 0, hand)).toBe('s7')
  // nobody threatening: its loosest honor instead
  const calm = { ...facing, melds: [] }
  expect(botThrow(calm, 0, hand)[0]).toBe('z')
})

test('a discard hands the turn to the bots, and the beat comes back to your draw', () => {
  let t = discard(deal(rng(3)))
  expect(t.phase).toBe('ai')
  expect(t.hand.length).toBe(HAND_SIZE)
  for (let i = 0; i < 20 && (t.phase === 'ai' || t.phase === 'claim'); i++) t = t.phase === 'claim' ? pass(t) : step(t)
  // back to you, or the hand ended on the way
  expect(['discard', 'over']).toContain(t.phase)
  if (t.phase === 'discard') expect(t.hand.length + (t.drawn ? 1 : 0) + t.melds.length * 3).toBe(HAND_SIZE + 1)
})

test('a pon lays the meld down and leaves you a tile to throw', () => {
  const base = deal(rng(3))
  const t = call({ ...base, phase: 'claim', from: 0, claims: [{ kind: 'pon', tiles: ['z5', 'z5'] }], hand: ['z5', 'z5', ...base.hand.slice(2)], drawn: null,
    seats: base.seats.map((s, i) => (i === 0 ? { ...s, river: ['z5'] } : s)) }, 0)
  expect(t.phase).toBe('discard')
  expect(t.melds.map(m => meldText(m))).toEqual(['中x3'])
  expect(t.hand.length).toBe(HAND_SIZE - 2)
  expect(t.seats[0]!.river).toEqual([])
})

test('the band: four rows, the hand, and the cursor walking over it', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  for (const k of ['seats', 'seat0', 'seat1', 'seat2', 'event', 'hand', 'keys', 'moves', 'drawn', 't0', 't15']) expect(await ui.find({ key: k })).toBeDefined()
  // no bot has called yet: each area shows only its seat wind (you deal, so you sit 東), no counts
  for (const name of ['南', '西', '北']) expect(await ui.find({ type: 'Text', text: name })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '東風圈 你:東 莊' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /張/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '輪到你出牌' })).toBeDefined()
  await ui.press({ key: 'discard' })
  expect(await ui.find({ key: 'drawn' })).toBeUndefined()
  // thrown, or taken at once by a bot
  expect(await ui.find({ type: 'Text', text: /^(你打出|[上對下]家[吃碰槓胡]) / })).toBeDefined()
  await ui.unmount()
})

test('turning 上色 off makes every tile a Button, the cursor tile too', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'mode' })
  // the focus ring marks the cursor, so no tile is drawn inverse Text
  for (const k of ['t0b', 't3b', 't15b', 'drawnb']) expect(await ui.find({ key: k })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\d[萬筒條]$|^ \S$/ })).toBeUndefined()
  await ui.press({ key: 'left' })
  await ui.press({ key: 't3b' })
  expect(await ui.find({ key: 't3b' })).toBeDefined()
  await ui.unmount()
})

test('v shows the river above the table: the wall, then a row per player, in the band\'s order and then you', async $ => {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'river' })).toBeUndefined()
  await ui.press({ key: 'riverKey' })
  for (const k of ['river', 'river2', 'river1', 'river0', 'river3', 'table']) expect(await ui.find({ key: k })).toBeDefined()
  for (const who of ['北 上家', '西 對家', '南 下家', '東 你']) expect(await ui.find({ type: 'Text', text: who })).toBeDefined()
  // the wall, then everyone's running score
  expect(await ui.find({ type: 'Text', text: /^牌牆剩 \d+ 張 +上家 0 +對家 0 +下家 0 +你 0$/ })).toBeDefined()
  await ui.press({ key: 'riverKey' })
  expect(await ui.find({ key: 'river' })).toBeUndefined()
  await ui.unmount()
})

test('a bot\'s call is numbered, and flashes in its area for two seconds', async ($, on) => {
  // the first deal: your opening throw, 9筒, is 碰'd by 上家 at once
  const t = discard(deal(rng(1)))
  expect(t.shout).toEqual({ who: 2, verb: '碰', n: 1 })
  const clock = mock.clock(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'shout2' })).toBeUndefined()
  await ui.press({ key: 'discard' })
  expect(await ui.find({ key: 'shout2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '碰' })).toBeDefined()
  await clock.advance(1999)
  expect(await ui.find({ key: 'shout2' })).toBeDefined()
  await clock.advance(1)
  expect(await ui.find({ key: 'shout2' })).toBeUndefined()
  await ui.unmount()
})

test('the band yields to a survey', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: 'engine survey' })).toBeDefined()
  await ui.unmount()
})
