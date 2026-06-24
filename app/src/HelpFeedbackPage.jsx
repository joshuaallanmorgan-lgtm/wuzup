// HelpFeedbackPage — the Help & feedback row's destination (PROFILE_PHASE2 #5;
// replaces the inert "Coming soon" stub). A warm intro + a CSS hero placeholder
// (no image asset) + rows that each open a real mailto: draft — honest actions,
// not fake UI. Back via closePage → the Profile tab.
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import './profile.css'

const SUPPORT = 'hello@wuzup.app' // placeholder support inbox (⚑ real address TBD)
const ROWS = [
  { label: 'FAQ', desc: 'Find answers to common questions', subject: 'Question about Wuzup' },
  { label: 'Contact support', desc: 'Get help from our team', subject: 'Support request' },
  { label: 'Report a problem', desc: 'Tell us what went wrong', subject: 'Bug report' },
  { label: 'Suggest a feature', desc: 'Share your ideas with us', subject: 'Feature idea' },
  { label: 'Give feedback', desc: 'Share your thoughts', subject: 'Feedback' },
]

export default function HelpFeedbackPage() {
  const { closePage: onClose } = useNav()
  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Help &amp; feedback</h1>
      </header>
      <div className="pg-body">
        <div className="hf-hero" aria-hidden>
          <div className="hf-hero-title">We love hearing from you ❤️</div>
          <div className="hf-hero-sub">Your feedback helps us build the best days.</div>
        </div>
        <div className="pf-menu hf-menu">
          {ROWS.map((r) => (
            <a
              key={r.label}
              className="pf-row hf-row"
              href={'mailto:' + SUPPORT + '?subject=' + encodeURIComponent(r.subject)}
            >
              <span className="pf-row-text">
                <span className="pf-row-label">{r.label}</span>
                <span className="pf-row-desc">{r.desc}</span>
              </span>
              <span className="pf-row-go" aria-hidden>
                <Icon.chevron />
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
