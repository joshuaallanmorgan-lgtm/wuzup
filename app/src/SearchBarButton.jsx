// SearchBarButton — Stage 2 Tier 3 de-dup. The .loc-search "tap to open the global
// search" pill was copy-pasted into HotView (Events) and LocationsView (Spots).
// One shared component now; the CSS is unchanged
// (.loc-search / .loc-search-ic / .loc-search-ph in locations.css).
// (The old MapView floating variant was retired with the map — D8/A5.)
//
// The className compose uses .filter(Boolean) so the no-modifier sites render the
// exact original string "loc-search pressable" (no stray double-space) while the
// Map gets "loc-search map-search pressable" in the same source order — so CSS
// specificity + the .map-search shadow override resolve exactly as before.
export default function SearchBarButton({ placeholder, onClick, ariaLabel, className = '', icon = '🔎' }) {
  const cls = ['loc-search', className, 'pressable'].filter(Boolean).join(' ')
  return (
    <button className={cls} onClick={onClick} aria-label={ariaLabel}>
      <span className="loc-search-ic" aria-hidden>
        {icon}
      </span>
      <span className="loc-search-ph">{placeholder}</span>
    </button>
  )
}
