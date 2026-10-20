import clsx from 'clsx'

export function BrandLogo({
  className,
  blend = false,
}: {
  className?: string
  blend?: boolean
}) {
  return (
    <img
      src="/edupath-academy.jpeg"
      alt="Edupath Academy"
      className={clsx('h-16 w-[220px] max-w-none object-contain object-left', blend && 'mix-blend-lighten', className)}
    />
  )
}
