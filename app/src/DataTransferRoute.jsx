import { StateTransferProvider } from './StateTransferProvider.jsx'
import DataTransferPage from './DataTransferPage.jsx'

// This provider reads every retained-value store. Keep that work out of boot
// and mount it only for the explicit Data transfer route, still inside the
// saved/planner/activity providers whose snapshots it coordinates.
export default function DataTransferRoute({ city }) {
  return (
    <StateTransferProvider city={city}>
      <DataTransferPage />
    </StateTransferProvider>
  )
}
