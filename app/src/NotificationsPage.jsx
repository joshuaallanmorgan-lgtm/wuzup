// NotificationsPage — HOME_PHASE2: reached from HomeView's bell icon.
// The app doesn't have a live push-notification system yet, so this shows an
// honest empty state — never fabricates notifications.
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import './notifications.css'

export default function NotificationsPage() {
  const { closePage } = useNav()

  return (
    <div className="pg notif-pg">
      <header className="pg-head">
        <button className="pg-back" onClick={closePage} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Notifications</h1>
      </header>
      <div className="pg-body notif-body">
        <div className="notif-empty">
          <div className="notif-empty-icon" aria-hidden>
            🔔
          </div>
          <div className="notif-empty-title">You&apos;re all caught up</div>
          <div className="notif-empty-sub">
            We&apos;ll let you know when something great is happening near you.
          </div>
        </div>
      </div>
    </div>
  )
}
