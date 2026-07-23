// Provider-only read bridge for retained and tab-local recent activity.
// Persistence, migration, cross-tab synchronization, and mutation all belong
// to ActivityProvider; this module deliberately owns no storage or singleton.
import { useActivity } from './ActivityProvider.jsx'

export function useRecents() {
  const {
    retainedRecentRefs,
    sessionRecentRefs,
    recentRefs,
    resolveRecentRefs,
  } = useActivity()
  return {
    refs: recentRefs,
    retained: retainedRecentRefs,
    session: sessionRecentRefs,
    resolve: resolveRecentRefs,
  }
}
