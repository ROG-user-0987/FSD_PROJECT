// Stock in / stock out / adjust. Each time the dialog opens it gets a new idempotency
// key, so a double click or a network retry can never move the stock twice.
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { TRANSACTION_LABELS } from '@/components/badges'
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
import { useAuth } from '@/hooks/useAuth'
import { useProductOptions, useWarehouses } from '@/hooks/useLookups'
import { api, ApiError } from '@/services/api'
import { stockKeys } from '@/services/queryKeys'
import type { MovementResponse, TransactionType } from '@/types/api'
import { FormSelect } from './FormSelect'

export type MovementMode = 'in' | 'out' | 'adjust'

const COPY: Record<MovementMode, { title: string; description: string; submit: string }> = {
  in: {
    title: 'Stock in',
    description: 'Record goods arriving at a warehouse.',
    submit: 'Add stock',
  },
  out: {
    title: 'Stock out',
    description: 'Record goods leaving a warehouse.',
    submit: 'Remove stock',
  },
  adjust: {
    title: 'Adjust stock',
    description:
      'Correct the quantity after a stock count. History is never edited: this adds a correction.',
    submit: 'Save adjustment',
  },
}

const TYPES: Record<'in' | 'out', TransactionType[]> = {
  in: ['PURCHASE', 'STOCK_IN', 'RETURN'],
  out: ['SALE', 'STOCK_OUT'],
}

const makeSchema = (mode: MovementMode) =>
  z
    .object({
      productId: z.string().min(1, 'Choose a product'),
      warehouseId: z.string().min(1, 'Choose a warehouse'),
      quantity: z
        .number({ message: 'Enter a whole number' })
        .int('Enter a whole number')
        .min(1, 'At least 1')
        .max(1_000_000),
      type: z.string(),
      direction: z.enum(['add', 'remove']),
      unitCost: z
        .string()
        .regex(/^(\d{1,8}(\.\d{1,4})?)?$/, 'A number with up to 4 decimals')
        .optional(),
      reason: z.string().trim().max(300).optional(),
      reference: z.string().trim().max(100).optional(),
    })
    .refine((v) => mode !== 'adjust' || (v.reason?.length ?? 0) >= 3, {
      message: 'Explain the adjustment (at least 3 characters)',
      path: ['reason'],
    })

type Values = z.infer<ReturnType<typeof makeSchema>>

export type MovementDefaults = { productId?: number; warehouseId?: number }

function MovementForm({
  mode,
  defaults,
  onDone,
}: {
  mode: MovementMode
  defaults?: MovementDefaults
  onDone: () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const products = useProductOptions()
  const warehouses = useWarehouses()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const schema = useMemo(() => makeSchema(mode), [mode])

  const ownWarehouse = user?.role === 'EMPLOYEE' ? user.warehouseId : null
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: defaults?.productId ? String(defaults.productId) : '',
      warehouseId: String(ownWarehouse ?? defaults?.warehouseId ?? ''),
      type: mode === 'in' ? 'PURCHASE' : 'SALE',
      direction: 'remove',
      unitCost: '',
      reason: '',
      reference: '',
    },
  })
  const type = watch('type')

  const productOptions = (products.data ?? []).map((p) => ({
    value: String(p.id),
    label: `${p.sku} · ${p.name}`,
  }))
  const warehouseOptions = (warehouses.data ?? [])
    .filter((w) => ownWarehouse === null || w.id === ownWarehouse)
    .map((w) => ({ value: String(w.id), label: `${w.code} · ${w.name}` }))

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    const base = {
      productId: Number(values.productId),
      warehouseId: Number(values.warehouseId),
      reason: values.reason || undefined,
    }
    const [path, body] =
      mode === 'adjust'
        ? [
            '/inventory/adjust',
            {
              ...base,
              quantityChange: values.direction === 'add' ? values.quantity : -values.quantity,
            },
          ]
        : [
            mode === 'in' ? '/inventory/stock-in' : '/inventory/stock-out',
            {
              ...base,
              quantity: values.quantity,
              type: values.type,
              reference: values.reference || undefined,
              ...(mode === 'in' && values.unitCost && { unitCost: values.unitCost }),
            },
          ]
    try {
      const result = await api.post<MovementResponse>(path, body, idempotencyKey)
      toast.success(`Stock updated: ${result.previousQuantity} → ${result.newQuantity}`)
      if (result.alert) {
        toast.warning(
          result.alert === 'OUT_OF_STOCK' ? 'Now out of stock' : 'Now below the reorder level',
        )
      }
      for (const queryKey of stockKeys) void queryClient.invalidateQueries({ queryKey })
      onDone()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the change')
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormSelect
          control={control}
          name="productId"
          label="Product"
          options={productOptions}
          disabled={Boolean(defaults?.productId)}
        />
        <FormSelect
          control={control}
          name="warehouseId"
          label="Warehouse"
          options={warehouseOptions}
          disabled={Boolean(defaults?.warehouseId) || ownWarehouse !== null}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'adjust' ? (
            <FormSelect
              control={control}
              name="direction"
              label="Direction"
              options={[
                { value: 'remove', label: 'Remove (damaged, missing)' },
                { value: 'add', label: 'Add (found in count)' },
              ]}
            />
          ) : (
            <FormSelect
              control={control}
              name="type"
              label="Type"
              options={TYPES[mode].map((t) => ({ value: t, label: TRANSACTION_LABELS[t] }))}
            />
          )}
          <Field data-invalid={Boolean(errors.quantity)}>
            <FieldLabel htmlFor="quantity">Quantity</FieldLabel>
            <Input
              id="quantity"
              type="number"
              min={1}
              inputMode="numeric"
              aria-invalid={Boolean(errors.quantity)}
              {...register('quantity', { valueAsNumber: true })}
            />
            <FieldError errors={[errors.quantity]} />
          </Field>
        </div>
        {mode === 'in' && (type === 'PURCHASE' || type === 'STOCK_IN') && (
          <Field data-invalid={Boolean(errors.unitCost)}>
            <FieldLabel htmlFor="unitCost">Unit cost (₹, optional)</FieldLabel>
            <Input
              id="unitCost"
              inputMode="decimal"
              placeholder="Updates the average cost"
              {...register('unitCost')}
            />
            <FieldError errors={[errors.unitCost]} />
          </Field>
        )}
        {mode !== 'adjust' && (
          <Field>
            <FieldLabel htmlFor="reference">Reference (optional)</FieldLabel>
            <Input
              id="reference"
              placeholder="Invoice or order number"
              {...register('reference')}
            />
          </Field>
        )}
        <Field data-invalid={Boolean(errors.reason)}>
          <FieldLabel htmlFor="reason">
            {mode === 'adjust' ? 'Reason' : 'Note (optional)'}
          </FieldLabel>
          <Input id="reason" aria-invalid={Boolean(errors.reason)} {...register('reason')} />
          <FieldError errors={[errors.reason]} />
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
          {COPY[mode].submit}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function StockMovementDialog({
  mode,
  open,
  onOpenChange,
  defaults,
}: {
  mode: MovementMode
  open: boolean
  onOpenChange: (open: boolean) => void
  defaults?: MovementDefaults
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{COPY[mode].title}</DialogTitle>
          <DialogDescription>{COPY[mode].description}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: every opening starts with a fresh form and key. */}
        {open && (
          <MovementForm mode={mode} defaults={defaults} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}
