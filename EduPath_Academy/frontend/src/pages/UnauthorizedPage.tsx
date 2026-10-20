import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { PageHeader } from '../components/ui'

export default function UnauthorizedPage() {
  return (
    <div>
      <PageHeader
        title="Access denied"
        subtitle="Your account does not have permission to view this page."
      />
      <div className="card flex flex-col items-center gap-4 text-center">
        <ShieldAlert className="h-10 w-10 text-amber-600" aria-hidden />
        <p className="text-sm text-navy-800/75">
          If you believe this is a mistake, sign in with a different role or contact your
          administrator.
        </p>
        <Link to="/dashboard" className="btn-primary">
          Go to dashboard
        </Link>
      </div>
    </div>
  )
}
