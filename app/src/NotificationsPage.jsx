// NotificationsPage — HOME_PHASE2 + TOUCHUP P2: reached from HomeView's bell.
// There's no push backend, so every item is DERIVED from real app state and
// honest by construction — never a fabricated alert:
//   • saved events coming up in the next 3 days (from the saves store)
//   • a weather heads-up when the real forecast shows rain/storms soon
//   • a weekend roundup (a true count of this weekend's listings)
// If none of those produce anything, the honest "all caught up" empty state shows.
import { useMemo } from 'react'
import { addDayTs, BUBBLES, calendarDayDistance, CITY, fmtLocale, formatDayTs, Icon, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { CardImg } from './cards.jsx'
import { shelfItems, useSaves } from './saves.js'
import { CONDITION, dateKey } from './weather.js'
import './notifications.css'

const WEEKEND_BUBBLE = BUBBLES.find((b) => b.id === 'weekend')
const RAINY = new Set(['🌧️', '⛈️', '🌦️'])

const relDay = (ts, todayTs) => {
  const d = calendarDayDistance(todayTs, ts)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  return formatDayTs(ts, { weekday: 'long' })
}

export default function NotificationsPage({ events = [], retainedEvents = events, anchors, wx }) {
  const { closePage, openDetail, openBubble, openForecast } = useNav()
  const { list: savedList } = useSaves()

  const items = useMemo(() => {
    const out = []

    // 1) saved events coming up in the next 3 days
    const shelf = shelfItems(savedList, retainedEvents, anchors)
    for (const { e, lifecycle } of shelf) {
      if (!lifecycle.actionable) continue
      const day = e._clamp ?? e._day
      if (day == null) continue
      const offset = calendarDayDistance(anchors.todayTs, day)
      if (offset < 0 || offset > 3) continue
      out.push({
        id: 'save-' + keyOf(e),
        img: e, // real event photo (CardImg falls to the category-art floor if none) — never fabricated
        title: e.title,
        sub: `On your list · coming up ${relDay(day, anchors.todayTs)}`,
        onClick: () => openDetail(e),
      })
    }

    // 2) a real weather heads-up — first rainy/stormy day in the next 3
    if (wx) {
      for (let i = 0; i <= 3; i++) {
        const ts = addDayTs(anchors.todayTs, i)
        const w = wx[dateKey(ts)]
        if (w && (RAINY.has(w.emoji) || (w.rain != null && w.rain >= 50))) {
          out.push({
            id: 'wx-' + i,
            icon: w.emoji,
            title: `${CONDITION[w.emoji] || 'Rain'} ${relDay(ts, anchors.todayTs)}`,
            // only cite the % when it's meaningful — avoids "storms · 4% chance" noise
            sub: w.rain != null && w.rain >= 30 ? `${w.rain}% chance of rain — keep an indoor backup` : 'Keep an indoor backup handy',
            onClick: openForecast,
          })
          break
        }
      }
    }

    // 3) weekend roundup — a true count of this weekend's listings
    const weekendCount = events.filter(
      (e) => e._weekend === true && e._day != null && (e._endDay ?? e._day) >= anchors.todayTs
    ).length
    if (weekendCount > 0 && WEEKEND_BUBBLE) {
      out.push({
        id: 'weekend',
        icon: '🎉',
        title: `This weekend in ${CITY.name}`,
        sub: `${weekendCount.toLocaleString(fmtLocale)} events on — take a look`,
        onClick: () => openBubble(WEEKEND_BUBBLE),
      })
    }

    return out
  }, [savedList, events, retainedEvents, anchors, wx, openDetail, openBubble, openForecast])

  return (
    <div className="pg notif-pg">
      <header className="pg-head">
        <button className="pg-back" onClick={closePage} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Notifications</h1>
      </header>
      <div className={'pg-body' + (items.length === 0 ? ' notif-body' : '')}>
        {items.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon" aria-hidden>🔔</div>
            <div className="notif-empty-title">You&apos;re all caught up</div>
            <div className="notif-empty-sub">
              Save an event or two and we&apos;ll remind you here when it&apos;s coming up.
            </div>
          </div>
        ) : (
          <div className="notif-list">
            {items.map((n) => (
              <button key={n.id} className="notif-item pressable" onClick={n.onClick}>
                {n.img ? (
                  <CardImg e={n.img} className="notif-thumb" />
                ) : (
                  <span className="notif-item-icon" aria-hidden>{n.icon}</span>
                )}
                <span className="notif-item-main">
                  <span className="notif-item-title">{n.title}</span>
                  <span className="notif-item-sub">{n.sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
