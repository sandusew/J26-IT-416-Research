import clsx from 'clsx'
import type { ReactNode } from 'react'
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl text-navy-950 md:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-navy-800/70">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card flex items-center gap-3 text-navy-800/70" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-teal-700" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="card border-dashed text-center">
      <p className="font-medium text-navy-900">{title}</p>
      {detail ? <p className="mt-1 text-sm text-navy-800/65">{detail}</p> : null}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="card border-red-200 bg-red-50 text-red-900" role="alert">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{message}</p>
          {onRetry ? (
            <button type="button" className="btn-secondary mt-3" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" aria-hidden />
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
      {message}
    </div>
  )
}

export function Badge({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <span className={clsx('badge', className)}>{children}</span>
}

export function JsonDisclosure({
  label,
  data,
}: {
  label: string
  data: unknown
}) {
  return (
    <details className="mt-3 rounded-lg border border-navy-800/10 bg-sand-50 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-navy-800">{label}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-navy-800/80">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}
