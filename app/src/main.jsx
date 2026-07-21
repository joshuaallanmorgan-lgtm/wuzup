import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { RUNTIME_CITY } from './city.js'
import { RuntimeCityFailure, RuntimeCityProvider } from './RuntimeCityProvider.jsx'

const root = createRoot(document.getElementById('root'))
const render = (content) => root.render(<StrictMode>{content}</StrictMode>)

if (RUNTIME_CITY.ok) {
  import('./App.jsx')
    .then(({ default: App }) => render(
      <RuntimeCityProvider selection={RUNTIME_CITY}>
        <App />
      </RuntimeCityProvider>,
    ))
    .catch(() => render(
      <RuntimeCityFailure selection={{ ...RUNTIME_CITY, ok: false, code: 'CITY_APP_LOAD_FAILED' }} />,
    ))
} else {
  render(<RuntimeCityFailure selection={RUNTIME_CITY} />)
}
