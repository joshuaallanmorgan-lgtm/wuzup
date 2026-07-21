import { Component } from 'react'

const DIAGNOSTIC_CODE = 'WUZUP-RENDER-001'

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.reloadPage = this.reloadPage.bind(this)
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    // Keep operational diagnostics fixed and bounded. Error messages and stacks
    // can contain event, profile, or device state and must not be echoed here.
    console.error(`[Wuzup] Root render failed (${DIAGNOSTIC_CODE}).`)
  }

  reloadPage() {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main
        className="app-error-boundary"
        role="alert"
        aria-live="assertive"
        data-app-runtime-status="failed"
      >
        <section className="app-error-boundary-card" aria-labelledby="app-error-boundary-title">
          <p className="app-error-boundary-kicker">App recovery</p>
          <h1 id="app-error-boundary-title">Wuzup couldn&apos;t finish this screen.</h1>
          <p>Something went wrong while Wuzup was displaying this screen. Reload to try again.</p>
          <button type="button" onClick={this.reloadPage}>Reload Wuzup</button>
          <p className="app-error-boundary-diagnostic">
            Support code: <code>{DIAGNOSTIC_CODE}</code>
          </p>
        </section>
      </main>
    )
  }
}
