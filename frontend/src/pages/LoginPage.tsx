import { zodResolver } from '@hookform/resolvers/zod'
import { Boxes, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { FullPageLoader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { ApiError } from '@/services/api'
import { homePathFor } from '@/utils/permissions'

const schema = z.object({
  // Same limits as the API; the server validates again (the client is never trusted).
  email: z.email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
})
type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const { status, user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  if (status === 'loading') return <FullPageLoader />
  if (user) return <Navigate to={homePathFor(user.role)} replace />

  const from = (location.state as { from?: string } | null)?.from

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null)
    try {
      const signedIn = await login(email, password)
      navigate(from ?? homePathFor(signedIn.role), { replace: true })
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Could not sign in')
    }
  })

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="size-5" />
          </div>
          <span className="text-xl font-semibold">InventoryOS</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Accounts are created by your administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.email)}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    maxLength={254}
                    aria-invalid={Boolean(errors.email)}
                    {...register('email')}
                  />
                  <FieldError errors={[errors.email]} />
                </Field>
                <Field data-invalid={Boolean(errors.password)}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    maxLength={200}
                    aria-invalid={Boolean(errors.password)}
                    {...register('password')}
                  />
                  <FieldError errors={[errors.password]} />
                </Field>
                {formError && (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="animate-spin" />}
                  Sign in
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
