// Mah-jong: Taiwanese 16-tile mahjong against three bots, in a four-row band above the prompt.
//
//   rows 1-2  three areas for the bots, 上家 對家 下家 left to right as they sit: their melds and
//             flower count, wrapping onto the second row, bold on the bot's turn; until its first
//             call an area shows the bot's seat wind, and 莊 for the dealer; a bot's call (碰,
//             暗槓) flashes white for two seconds, two cells after its area's second row. At the
//             right, what just happened over whose turn it is. Once someone wins, the winning hand laid
//             open in the middle instead: what happened and the 台 over the concealed tiles, the
//             winning tile inverse, the melds
//   row 3     your hand, sorted, the drawn tile apart; the cursor tile inverse
//   row 4     the keys (a ◀  d ▶  q 打出  c 上色), led by w 胡 when your draw wins (自摸) and
//             e r t: 槓 for each kan you may lay (暗槓, 加槓); or while a discard waits for you, the
//             calls (q 過, then w e r t y u: 胡 吃 碰 槓); or once the hand is over, q 下一局 and the
//             台 item by item. Then your melds (789萬 中x3) and flowers; at the right v 河底, the
//             round wind, your seat, and the dealer's run (東風圈 你:南 連1)
//
// v shows or hides the river (河底) above the table, as wide: the tiles left in the wall, then each
// player's discards in the order thrown, the newest inverse while it lies there.
//
// The keys are letters, so they need the band focused (ctrl+x tab, or a click).
// Tiles are colored Text, which cannot be pressed; `c` turns the color off, swapping them for plain
// Buttons, which can be clicked but not colored: for a light terminal, where the colors read poorly,
// or to play by mouse. 上色 is dim while it is off.
// With the color off the focus ring is the cursor: a click, Tab or the arrows move the cursor with
// it, and a/d, a draw or a call move the ring onto the cursor.
// The bots play on a fixed beat.
// /mj shows or hides the band, /mj-deal starts a new game.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, StateDollar } from 'claude-code'

import type { Claim, Table } from '../types'
import { WIND_NAMES, YOU, call, canTsumo, deal, discard, move, nextHand, pass, reach, seatWind, select, selfKan, step, tsumo, waiting, yourKans } from './table'
import { total } from './score'
import { color, glyph, label, meldText, name, rng } from './tiles'

const REF = { plugin: 'mah-jong', key: 'table' } as const
// a fixed first deal, so a test sees a known table; a session deals afresh as it starts
const table = atom(REF, deal(rng(1)))
const isHidden = atom({ plugin: 'mah-jong', key: 'isHidden' } as const, false)
const BEAT_MS = 700
const flash = atom({ plugin: 'mah-jong', key: 'flash' } as const, { seen: 0, shown: 0 })
// how long a bot's call stays up in its area
const FLASH_MS = 2000
const isRiverShown = atom({ plugin: 'mah-jong', key: 'isRiverShown' } as const, false)
// the river's rows, as the band's areas run and then you: 上家 對家 下家 你
const RIVER_ORDER = [2, 1, 0, 3]
const VERB: Record<Claim['kind'], string> = { hu: '胡', chi: '吃', pon: '碰', kan: '槓' }
// left to right as the bots sit around you: 上家 對家 下家
const SEATING = [2, 1, 0]
// the status column at the right of rows 1-2, in cells: the longest event fits. With a gap of one,
// each bot's area is 17 cells at 74 columns, three five-cell melds a row
const STATUS_COLUMNS = 20

// a tile's Button: t0b..t15b in hand, drawnb for the drawn tile
const tileKey = (t: Table, i: number) => (i < t.hand.length ? `t${i}b` : 'drawnb')
const tileIndex = (t: Table, key: string) => (key === 'drawnb' ? (t.drawn ? t.hand.length : -1) : Number(/^t(\d+)b$/.exec(key)?.[1] ?? -1))

type Dollar = StateDollar & Pick<EngineInterface, 'ui' | 'clock'>

// the band's id, for moving its focus ring; set as it draws
let band: string | undefined

// a bot's new call goes up in its area, and comes down after FLASH_MS
async function flashShout($: Dollar) {
  const s = (await read($, table)).shout
  if (!s || s.n === (await read($, flash)).seen) return
  await update($, flash, () => ({ seen: s.n, shown: s.n }))
  $.clock.after(FLASH_MS, () => void update($, flash, f => (f.shown === s.n ? { ...f, shown: 0 } : f)))
}

// with the color off, put the ring on the cursor tile. A deny (the band not focused) or a throw
// (nothing answers it: the test kit, inside a press) leaves the ring where it was; the move stands
async function syncRing($: Dollar) {
  const t = await read($, table)
  if (!band || !t.clickable || t.phase !== 'discard') return
  await $.ui.focus({ requestId: band, key: tileKey(t, t.cursor) }).catch(() => undefined)
}

// the calls' keys after q 過, in the order the calls come: 胡 first, then 吃 碰 槓
const CALL_KEYS = ['w', 'e', 'r', 't', 'y', 'u']

// your own kans' keys, after w 胡: four alike or a pon's fourth, rarely more than one at once
const KAN_KEYS = ['e', 'r', 't', 'y', 'u']

// a word in a bot's area: a meld, the seat, the flower count
type Word = { text: string; dim?: boolean; color?: string }

// cells a string takes: two for a CJK glyph, one for the rest
const cells = (text: string) => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0)

// words laid into a first row as wide as `columns` holds, one cell apart, and the rest
function twoRows(words: readonly Word[], columns: number): [Word[], Word[]] {
  let used = 0
  let k = 0
  for (; k < words.length; k++) {
    const next = used + (k ? 1 : 0) + cells(words[k]!.text)
    if (next > columns) break
    used = next
  }
  return [words.slice(0, k), words.slice(k)]
}

// a score with its sign: +340, -120, 0
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

const claimLabel = (c: Claim) => (c.kind === 'chi' ? `${VERB.chi}${c.tiles.map(t => t.slice(1)).join('')}` : VERB[c.kind])

export const register: Register = on => {
  let beat: { cancel(): void } | undefined

  on('session.start', async ($, e, next) => {
    // a new session deals; a hot reload keeps the table it holds
    if ((await $.state.get(REF)).version === 0) await $.state.set(REF, deal(Math.random))
    beat?.cancel()
    beat = $.clock.every(BEAT_MS, () => {
      void (async () => {
        if (await read($, isHidden)) return
        if ((await read($, table)).phase !== 'ai') return
        await update($, table, step)
        await flashShout($)
        await syncRing($)
      })()
    })
    await $.command.register({ name: 'mj', description: 'Mah-jong: show or hide the table' })
    await $.command.register({ name: 'mj-deal', description: 'Mah-jong: a new game, from 東風圈 with you dealing' })
    return next(e)
  })

  on('command.run', { command: 'mj' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    return { text: hidden ? 'Mah-jong hidden (/mj brings it back).' : 'Mah-jong shown above the prompt.' }
  })
  on('command.run', { command: 'mj-deal' }, async $ => {
    await update($, table, () => deal(Math.random))
    // the new game's calls count from one again
    await update($, flash, () => ({ seen: 0, shown: 0 }))
    await update($, isHidden, () => false)
    return { text: 'Mah-jong: a new game is dealt.' }
  })

  // the ring landing on a tile moves the cursor there
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.plugin === 'mah-jong' && e.element) {
      const key = e.element
      await update($, table, t => {
        const i = tileIndex(t, key)
        return t.clickable && t.phase === 'discard' && i >= 0 && i !== t.cursor ? select(t, i) : t
      })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, table)
    band = e.requestId
    // a move of yours, and whatever a bot calls on it
    const act = (fn: (s: Table) => Table) => async () => {
      await update($, table, fn)
      await flashShout($)
    }
    // the same, then the ring onto the cursor
    const actRing = (fn: (s: Table) => Table) => async () => {
      await update($, table, fn)
      await flashShout($)
      await syncRing($)
    }

    // a tile's color, none while the color is off
    const paint = (x: string) => (t.clickable ? undefined : color(x))

    // rows 1-2: an area per bot, the status at the right
    const shown = (await read($, flash)).shown
    const turn = t.phase === 'ai' ? t.seats[t.turn]?.name : undefined
    const status = t.phase === 'discard' ? '輪到你出牌'
      : t.phase === 'claim' ? (t.robbing ? '要搶槓嗎' : '要吃碰嗎')
      : t.phase === 'over' ? 'q 下一局'
      : turn ? `輪到${turn}` : ''
    // each area's width, as the row shares it out (rounded down: better a wrap early than a cell
    // lost), and its words laid into two rows by hand, so a call can follow the second row's end
    const areaColumns = Math.floor((e.props.bodyColumns - STATUS_COLUMNS - SEATING.length) / SEATING.length)
    const bots = (
      <Box key="seats" flexDirection="row" height={2} columnGap={1}>
        {SEATING.map(i => {
          const s = t.seats[i]!
          const isTurn = t.phase === 'ai' && t.turn === i
          const words: Word[] = [
            ...(s.melds.length
              ? s.melds.map(m => ({ text: meldText(m, true) }))
              : [{ text: `${WIND_NAMES[seatWind(t, i)]}${i === t.dealer ? ' 莊' : ''}`, dim: true }]),
            ...(s.flowers.length ? [{ text: `花${s.flowers.length}`, color: 'magenta' }] : []),
          ]
          const [first, second] = twoRows(words, areaColumns)
          const draw = (w: Word) => <Text bold={isTurn} dimColor={w.dim} color={w.color}>{w.text}</Text>
          const isShouting = t.shout?.who === i && t.shout.n === shown
          return (
            <Box key={`seat${i}`} flexGrow={1} width={0} height={2} flexDirection="column" overflow="hidden">
              <Box flexDirection="row" columnGap={1}>{first.map(draw)}</Box>
              <Box flexDirection="row" columnGap={1}>
                {second.map(draw)}
                {/* two cells after the second row's last word, or two in from its start */}
                {isShouting && (
                  <Box key={`shout${i}`} marginLeft={second.length ? 1 : 2} flexShrink={0}>
                    <Text bold color="black" backgroundColor="white">{t.shout!.verb}</Text>
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
        <Box key="event" flexDirection="column" width={STATUS_COLUMNS} flexShrink={0}>
          {t.phase === 'claim'
            // the discard you may call, in its own color: the event ends with its name
            ? <Text wrap="truncate" bold>{t.event.slice(0, -name(waiting(t)).length)}<Text color={paint(waiting(t))}>{name(waiting(t))}</Text></Text>
            : <Text wrap="truncate">{t.event}</Text>}
          <Text wrap="truncate" dimColor>{status}</Text>
        </Box>
      </Box>
    )

    // rows 1-2 once someone wins: the whole hand, centred
    const win = t.phase === 'over' ? t.win : null
    const winGap = win && e.props.bodyColumns >= win.hand.length * 4 + 4 + win.melds.length * 6 ? 1 : 0
    const opened = win && (
      <Box key="win" flexDirection="column" height={2} alignItems="center">
        <Box key="winHead" flexDirection="row" columnGap={2}>
          <Text bold color="yellow">{`${t.event}  ${total(win.tai)} 台`}</Text>
          {win.pay[YOU] !== 0 && <Text bold color={win.pay[YOU]! > 0 ? 'green' : 'red'}>{`你 ${signed(win.pay[YOU]!)}`}</Text>}
          <Text dimColor>q 下一局</Text>
        </Box>
        <Box key="winHand" flexDirection="row" columnGap={1}>
          <Box flexDirection="row" columnGap={winGap}>{win.hand.map(x => <Text color={paint(x)}>{label(x)}</Text>)}</Box>
          <Text color={paint(win.tile)} inverse>{label(win.tile)}</Text>
          {win.melds.map(m => <Text>{meldText(m)}</Text>)}
        </Box>
      </Box>
    )

    // row 3: the hand; one space between tiles where the band is wide enough, none where not
    const n = reach(t)
    const gap = e.props.bodyColumns >= n * 4 + 2 ? 1 : 0
    const tile = (tl: string, i: number, key: string) => {
      const isAt = t.phase === 'discard' && t.cursor === i
      // keyed Box per tile: two equal tiles would otherwise share a Button's default key.
      // With the color off every tile is a Button and the focus ring marks the cursor; a cursor
      // tile drawn as Text instead would drop out of the ring and leave it on another tile
      return (
        <Box key={key}>
          {t.clickable
            ? <Button key={`${key}b`} label={label(tl)} plain onPress={act(s => select(s, i))} />
            : <Text color={color(tl)} inverse={isAt}>{label(tl)}</Text>}
        </Box>
      )
    }
    const hand = (
      <Box key="hand" flexDirection="row">
        <Box flexDirection="row" columnGap={gap}>{t.hand.map((tl, i) => tile(tl, i, `t${i}`))}</Box>
        {t.drawn && <Box marginLeft={2}>{tile(t.drawn, t.hand.length, 'drawn')}</Box>}
      </Box>
    )

    // row 4: the keys, or the calls while a discard waits for you, or once the hand is over the
    // next hand and the 台; your melds and flowers; at the right the round
    const canDiscard = t.phase === 'discard'
    const round = `${WIND_NAMES[t.wind]}風圈 你:${WIND_NAMES[seatWind(t, YOU)]}${t.dealer === YOU ? ' 莊' : ''}${t.streak ? ` 連${t.streak}` : ''}`
    const keys = (
      <Box key="keys" flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" columnGap={1} flexShrink={1} overflow="hidden">
          {t.phase === 'over' ? (
            <Box key="over" flexDirection="row" columnGap={2}>
              <Button key="next" label="下一局" hotkey="q" plain onPress={actRing(s => nextHand(s, Math.random))} />
              {win && <Text wrap="truncate">{win.tai.map(x => `${x.name} ${x.n}`).join('  ')}</Text>}
            </Box>
          ) : t.phase === 'claim' ? (
            <Box key="claims" flexDirection="row" columnGap={1}>
              <Button key="pass" label="過" hotkey="q" plain onPress={act(pass)} />
              {t.claims.map((c, i) => <Button key={`claim${i}`} label={claimLabel(c)} hotkey={CALL_KEYS[i]} plain onPress={actRing(s => call(s, i))} />)}
            </Box>
          ) : (
            <Box key="moves" flexDirection="row" columnGap={1}>
              {canTsumo(t) && <Button key="tsumo" label="胡" hotkey="w" plain onPress={act(tsumo)} />}
              {yourKans(t).map((k, i) => <Button key={`kan${i}`} label={`槓${name(k.tile)}`} hotkey={KAN_KEYS[i]} plain onPress={actRing(s => selfKan(s, i))} />)}
              <Button key="left" label="◀" hotkey="a" plain dimColor={!canDiscard} onPress={actRing(s => move(s, -1))} />
              <Button key="right" label="▶" hotkey="d" plain dimColor={!canDiscard} onPress={actRing(s => move(s, 1))} />
              <Button key="discard" label="打出" hotkey="q" plain dimColor={!canDiscard} onPress={act(discard)} />
              <Button key="mode" label="上色" hotkey="c" plain dimColor={t.clickable} onPress={actRing(s => ({ ...s, clickable: !s.clickable }))} />
            </Box>
          )}
          {!win && t.melds.length > 0 && <Text>{`  ${t.melds.map(m => meldText(m)).join(' ')}`}</Text>}
          {!win && t.flowers.length > 0 && <Text color="magenta">{`  花 ${t.flowers.map(glyph).join('')}`}</Text>}
        </Box>
        <Box key="aside" flexDirection="row" columnGap={2} flexShrink={0}>
          <Button key="riverKey" label="河底" hotkey="v" plain dimColor onPress={() => update($, isRiverShown, v => !v)} />
          <Text dimColor wrap="truncate">{round}</Text>
        </Box>
      </Box>
    )

    // above the table, while v has it shown: the wall, then each player's discards, a row each,
    // wrapping, the newest inverse while it lies there; a rule under it
    const river = (await read($, isRiverShown)) && (
      <Box key="river" flexDirection="column">
        <Text key="wall" dimColor>{`牌牆剩 ${t.wall.length} 張    ${RIVER_ORDER.map(p => `${p === YOU ? '你' : t.seats[p]!.name} ${signed(t.scores[p]!)}`).join('  ')}`}</Text>
        {RIVER_ORDER.map(p => {
          const thrown = p === YOU ? t.river : t.seats[p]!.river
          const who = `${WIND_NAMES[seatWind(t, p)]} ${p === YOU ? '你' : t.seats[p]!.name}`
          return (
            <Box key={`river${p}`} flexDirection="row">
              <Box width={8} flexShrink={0}><Text dimColor>{who}</Text></Box>
              <Box flexGrow={1} width={0} flexDirection="row" flexWrap="wrap" columnGap={1}>
                {thrown.map((x, i) => <Text color={paint(x)} inverse={t.thrown === p && i === thrown.length - 1}>{label(x)}</Text>)}
              </Box>
            </Box>
          )
        })}
        <Text dimColor wrap="truncate">{'─'.repeat(e.props.bodyColumns)}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {river}
        <Box key="table" flexDirection="column" height={4}>
          {opened || bots}
          {hand}
          {keys}
        </Box>
      </Box>
    )
  })
}

