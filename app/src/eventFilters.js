// Pure event-filter contract shared by the filter sheet destination and tests.
// Every selected dimension is conjunctive: When AND Price AND Category.
export function matchesEventFilters(event, filters = {}, anchors = {}) {
  if (!event || typeof event !== 'object') return false

  if (filters.when) {
    if (filters.when === 'tonight' && event._tonight !== true) return false
    else if (filters.when === 'tomorrow' && event._day !== anchors.tomorrowTs) return false
    else if (filters.when === 'weekend' && event._weekend !== true) return false
    else if (!['tonight', 'tomorrow', 'weekend'].includes(filters.when)) return false
  }

  if (filters.price) {
    if (filters.price !== 'free') return false
    if (event._free !== true && event.isFree !== true) return false
  }

  if (filters.category && event.category !== filters.category) return false
  return true
}

export function filterEvents(events, filters, anchors) {
  return (Array.isArray(events) ? events : []).filter((event) => matchesEventFilters(event, filters, anchors))
}
