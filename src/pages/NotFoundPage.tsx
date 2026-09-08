import { Compass } from 'lucide-react'
import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-surface-soft text-ink-3">
        <Compass className="size-7" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Page not found
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          That route isn&apos;t part of the shell.
        </p>
      </div>
      <Link
        to="/today"
        className="rounded-control bg-accent px-5 py-2.5 text-sm font-bold text-ink transition-transform duration-fast active:scale-95"
      >
        Back to Today
      </Link>
    </div>
  )
}
