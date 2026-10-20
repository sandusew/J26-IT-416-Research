import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'
import { PageHeader } from '../components/ui'

export default function NotFoundPage() {
  return (
    <div>
      <PageHeader title="Page not found" subtitle="The link may be outdated or mistyped." />
      <div className="card flex flex-col items-center gap-4 text-center">
        <MapPinOff className="h-10 w-10 text-navy-800/40" aria-hidden />
        <Link to="/dashboard" className="btn-primary">
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
