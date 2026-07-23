import { useRuntimeCity } from './RuntimeCityProvider.jsx'

export default function CityCoverageSelector({ compact = false }) {
  const runtime = useRuntimeCity()
  return (
    <div className={'runtime-city-selector' + (compact ? ' is-compact' : '')}>
      <nav className="runtime-city-options" aria-label="Available Wuzup coverage areas">
        {runtime.destinations.map((destination) => {
          const body = (
            <>
              <strong>{destination.coverageLabel}</strong>
              <span>{destination.coverageDetail}</span>
            </>
          )
          return destination.active ? (
            <span
              className="runtime-city-option is-active"
              aria-current="location"
              key={destination.cityId}
            >
              {body}
              <small>Current area</small>
            </span>
          ) : destination.available && destination.href ? (
            <a className="runtime-city-option" href={destination.href} key={destination.cityId}>
              {body}
              <small>Open this area</small>
            </a>
          ) : (
            <span className="runtime-city-option is-unavailable" key={destination.cityId}>
              {body}
              <small>Not available from this local build</small>
            </span>
          )
        })}
      </nav>
      {!compact && (
        <p className="runtime-city-selector-note">
          Each area opens its own verified listings. Plans, saves, taste, and location settings stay separate.
        </p>
      )}
    </div>
  )
}
