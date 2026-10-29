// Create a transfer (multi-item) and the transfer detail drawer with its timeline and
// the actions the current user may take.
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Loader2, Plus, Trash2, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { TRANSFER_LABELS, TransferStatusBadge } from '@/components/badges'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { useProductOptions, useWarehouses } from '@/hooks/useLookups'
import { api, ApiError } from '@/services/api'
import { queryKeys, stockKeys } from '@/services/queryKeys'
import type { Transfer, TransferAction } from '@/types/api'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { FormSelect } from './FormSelect'

// ---------------------------------------------------------------- Create

const schema = z
  .object({
    fromWarehouseId: z.string().min(1, 'Choose the source'),
    toWarehouseId: z.string().min(1, 'Choose the destination'),
    note: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1, 'Choose a product'),
          quantity: z.number({ message: 'Enter a quantity' }).int().min(1, 'At least 1'),
        }),
      )
      .min(1, 'Add at least one item'),
  })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    message: 'Destination must differ from the source',
    path: ['toWarehouseId'],
  })
  .refine((v) => new Set(v.items.map((item) => item.productId)).size === v.items.length, {
    message: 'Each product may appear only once',
    path: ['items'],
  })
type Values = z.infer<typeof schema>

function CreateTransferForm({
  onDone,
  onCreated,
}: {
  onDone: () => void
  onCreated: (id: number) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const warehouses = useWarehouses()
  const products = useProductOptions()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const ownWarehouse = user?.role === 'EMPLOYEE' ? user.warehouseId : null

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      fromWarehouseId: ownWarehouse ? String(ownWarehouse) : '',
      toWarehouseId: '',
      note: '',
      items: [{ productId: '', quantity: 1 }],
    },
  })
  const items = useFieldArray({ control, name: 'items' })

  const warehouseOptions = (warehouses.data ?? []).map((w) => ({
    value: String(w.id),
    label: `${w.code} · ${w.name}`,
  }))
  const productOptions = (products.data ?? []).map((p) => ({
    value: String(p.id),
    label: `${p.sku} · ${p.name}`,
  }))

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const transfer = await api.post<Transfer>(
        '/transfers',
        {
          fromWarehouseId: Number(values.fromWarehouseId),
          toWarehouseId: Number(values.toWarehouseId),
          note: values.note || undefined,
          items: values.items.map((item) => ({
            productId: Number(item.productId),
            quantity: item.quantity,
          })),
        },
        idempotencyKey,
      )
      toast.success(`Transfer #${transfer.id} requested`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.transfers })
      onDone()
      onCreated(transfer.id)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the transfer')
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormSelect
            control={control}
            name="fromWarehouseId"
            label="From"
            options={warehouseOptions}
            disabled={ownWarehouse !== null}
          />
          <FormSelect
            control={control}
            name="toWarehouseId"
            label="To"
            options={warehouseOptions}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel>Items</FieldLabel>
          {items.fields.map((field, index) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="flex-1">
                <FormSelect
                  control={control}
                  name={`items.${index}.productId`}
                  label={`Product ${index + 1}`}
                  options={productOptions}
                />
              </div>
              <Field className="w-24" data-invalid={Boolean(errors.items?.[index]?.quantity)}>
                <FieldLabel htmlFor={`qty-${index}`}>Qty</FieldLabel>
                <Input
                  id={`qty-${index}`}
                  type="number"
                  min={1}
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-7"
                aria-label={`Remove item ${index + 1}`}
                disabled={items.fields.length === 1}
                onClick={() => items.remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <FieldError
            errors={[errors.items?.root ?? (errors.items as { message?: string } | undefined)]}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => items.append({ productId: '', quantity: 1 })}
            disabled={items.fields.length >= 50}
          >
            <Plus /> Add item
          </Button>
        </div>
        <Field>
          <FieldLabel htmlFor="note">Note (optional)</FieldLabel>
          <Input id="note" placeholder="Why is this transfer needed?" {...register('note')} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Request transfer
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CreateTransferDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: number) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New transfer</DialogTitle>
          <DialogDescription>
            Stock moves only when the transfer is dispatched (leaves the source) and received.
          </DialogDescription>
        </DialogHeader>
        {open && <CreateTransferForm onDone={() => onOpenChange(false)} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Detail drawer

const ACTIONS: Record<
  TransferAction,
  { label: string; icon: typeof Check; variant: 'default' | 'outline' | 'destructive' }
> = {
  approve: { label: 'Approve', icon: Check, variant: 'default' },
  dispatch: { label: 'Dispatch', icon: Truck, variant: 'default' },
  receive: { label: 'Receive', icon: Check, variant: 'default' },
  cancel: { label: 'Cancel transfer', icon: X, variant: 'destructive' },
}

const STEPS = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] as const

function Timeline({ transfer }: { transfer: Transfer }) {
  const reached = new Map(transfer.timeline.map((step) => [step.status, step]))
  const cancelled = reached.get('CANCELLED')
  const steps = cancelled
    ? [...STEPS.filter((status) => reached.has(status)), 'CANCELLED' as const]
    : STEPS
  return (
    <ol className="space-y-3">
      {steps.map((status) => {
        const step = reached.get(status)
        return (
          <li key={status} className="flex gap-3">
            <span
              className={cn(
                'mt-1 size-2.5 shrink-0 rounded-full border-2',
                step
                  ? status === 'CANCELLED'
                    ? 'border-destructive bg-destructive'
                    : 'border-primary bg-primary'
                  : 'border-muted-foreground/40',
              )}
            />
            <div className="text-sm">
              <div className={cn('font-medium', !step && 'text-muted-foreground')}>
                {TRANSFER_LABELS[status]}
              </div>
              {step && (
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(step.at)}
                  {step.by && ` · ${step.by.name}`}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function TransferSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<TransferAction | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const query = useQuery({
    queryKey: [...queryKeys.transfers, 'detail', id],
    queryFn: () => api.get<Transfer>(`/transfers/${id}`),
    enabled: id !== null,
  })
  const transfer = query.data

  async function run(action: TransferAction) {
    if (!transfer) return
    setBusy(action)
    try {
      const updated = await api.put<Transfer>(
        `/transfers/${transfer.id}/${action}`,
        undefined,
        crypto.randomUUID(),
      )
      toast.success(`Transfer #${updated.id} ${TRANSFER_LABELS[updated.status].toLowerCase()}`)
      for (const warning of updated.warnings ?? []) toast.warning(`Short at source: ${warning}`)
      for (const queryKey of stockKeys) void queryClient.invalidateQueries({ queryKey })
    } catch (caught) {
      toast.error(caught instanceof ApiError ? caught.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Transfer #{id}</SheetTitle>
          <SheetDescription>
            {transfer ? (
              <span className="inline-flex items-center gap-1.5">
                {transfer.fromWarehouse.name} <ArrowRight className="size-3.5" />{' '}
                {transfer.toWarehouse.name}
              </span>
            ) : (
              'Loading…'
            )}
          </SheetDescription>
        </SheetHeader>
        {!transfer ? (
          <div className="space-y-3 px-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-6 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <TransferStatusBadge status={transfer.status} />
              <span className="text-sm text-muted-foreground">
                {transfer.units} units · {formatCurrency(transfer.value)}
              </span>
            </div>
            {transfer.note && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">{transfer.note}</p>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Items</h3>
              <ul className="divide-y rounded-md border text-sm">
                {transfer.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <Link to={`/products/${item.productId}`} className="hover:underline">
                      <div>{item.product.name}</div>
                      <div className="text-xs text-muted-foreground">{item.product.sku}</div>
                    </Link>
                    <div className="text-right tabular-nums">
                      <div>{item.quantity} units</div>
                      <div className="text-xs text-muted-foreground">
                        {item.unitCost
                          ? `${formatCurrency(item.unitCost)} each (frozen)`
                          : 'cost set on dispatch'}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Timeline</h3>
              <Timeline transfer={transfer} />
            </section>

            {transfer.actions.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {transfer.actions.map((action) => {
                  const { label, icon: Icon, variant } = ACTIONS[action]
                  return (
                    <Button
                      key={action}
                      variant={variant}
                      disabled={busy !== null}
                      onClick={() =>
                        action === 'cancel' ? setConfirmCancel(true) : void run(action)
                      }
                    >
                      {busy === action ? <Loader2 className="animate-spin" /> : <Icon />}
                      {label}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel transfer #{id}?</AlertDialogTitle>
              <AlertDialogDescription>
                No stock has moved yet. This cannot be undone; a new transfer would have to be
                requested.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run('cancel')}>
                Cancel transfer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}
