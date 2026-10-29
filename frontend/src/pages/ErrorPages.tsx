import { Compass, TriangleAlert } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { EmptyState } from '@/components/states'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <EmptyState icon={Compass} title="Page not found" description="This page does not exist.">
        <Button asChild variant="outline" size="sm">
          <Link to="/">Go home</Link>
        </Button>
      </EmptyState>
    </div>
  )
}

// Shown when a page throws while rendering (React Router errorElement).
export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'An unexpected error occurred.'
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <EmptyState icon={TriangleAlert} title="Something went wrong" description={message}>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </EmptyState>
    </div>
  )
}
