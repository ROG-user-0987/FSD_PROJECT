// Create a product or a supplier (ADMIN / MANAGER).
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useCategories, useSuppliers } from '@/hooks/useLookups'
import { api, ApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { ProductListItem, Supplier } from '@/types/api'
import { can } from '@/utils/permissions'
import { FormSelect } from './FormSelect'

const money = (decimals: number) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,10}(\\.\\d{1,${decimals}})?$`),
      `A number with up to ${decimals} decimals`,
    )

function TextField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: { message?: string }
  hint?: string
  children: ReactNode
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  )
}

function FormShell({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && children}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Product

const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/, '3-32 letters, digits or dashes'),
  name: z.string().trim().min(1, 'Enter a name').max(160),
  categoryId: z.string().min(1, 'Choose a category'),
  supplierId: z.string().min(1, 'Choose a supplier'),
  brand: z.string().trim().max(80).optional(),
  costPrice: money(4),
  sellingPrice: money(2),
  reorderLevel: z.number({ message: 'Enter a whole number' }).int().min(0).max(1_000_000),
  description: z.string().trim().max(2000).optional(),
})
type ProductValues = z.infer<typeof productSchema>

function ProductForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const categories = useCategories()
  const suppliers = useSuppliers()
  const [error, setError] = useState<string | null>(null)
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { reorderLevel: 0, categoryId: '', supplierId: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const product = await api.post<ProductListItem>('/products', {
        ...values,
        categoryId: Number(values.categoryId),
        supplierId: Number(values.supplierId),
        brand: values.brand || undefined,
        description: values.description || undefined,
      })
      toast.success(`${product.name} created`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.products })
      onDone()
      navigate(`/products/${product.id}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the product')
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="sku" label="SKU" error={errors.sku}>
            <Input id="sku" placeholder="ELE-017" {...register('sku')} />
          </TextField>
          <TextField id="brand" label="Brand (optional)" error={errors.brand}>
            <Input id="brand" {...register('brand')} />
          </TextField>
        </div>
        <TextField id="name" label="Name" error={errors.name}>
          <Input id="name" {...register('name')} />
        </TextField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormSelect
            control={control}
            name="categoryId"
            label="Category"
            options={(categories.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          />
          <FormSelect
            control={control}
            name="supplierId"
            label="Supplier"
            options={(suppliers.data ?? []).map((s) => ({
              value: String(s.id),
              label: `${s.name} (${s.leadTimeDays}d)`,
            }))}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField id="costPrice" label="Cost price (₹)" error={errors.costPrice}>
            <Input id="costPrice" inputMode="decimal" {...register('costPrice')} />
          </TextField>
          <TextField id="sellingPrice" label="Selling price (₹)" error={errors.sellingPrice}>
            <Input id="sellingPrice" inputMode="decimal" {...register('sellingPrice')} />
          </TextField>
          <TextField
            id="reorderLevel"
            label="Reorder level"
            error={errors.reorderLevel}
            hint={can(user?.role, 'products.reorderLevel') ? undefined : 'Set by an admin'}
          >
            <Input
              id="reorderLevel"
              type="number"
              min={0}
              disabled={!can(user?.role, 'products.reorderLevel')}
              {...register('reorderLevel', { valueAsNumber: true })}
            />
          </TextField>
        </div>
        <TextField id="description" label="Description (optional)" error={errors.description}>
          <Textarea id="description" rows={3} {...register('description')} />
        </TextField>
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
          Create product
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ProductDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <FormShell {...props} title="New product" description="Add an item to the catalogue.">
      <ProductForm onDone={() => props.onOpenChange(false)} />
    </FormShell>
  )
}

// ---------------------------------------------------------------- Supplier

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  email: z.union([z.literal(''), z.email('Enter a valid email')]).optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(300).optional(),
  leadTimeDays: z.number({ message: 'Enter a whole number' }).int().min(1).max(365),
  rating: z
    .string()
    .regex(/^(([0-4](\.\d)?)|(5(\.0)?))?$/, '0.0 to 5.0')
    .optional(),
})
type SupplierValues = z.infer<typeof supplierSchema>

function SupplierForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SupplierValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { leadTimeDays: 5 },
  })

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const supplier = await api.post<Supplier>('/suppliers', {
        name: values.name,
        leadTimeDays: values.leadTimeDays,
        email: values.email || undefined,
        phone: values.phone || undefined,
        address: values.address || undefined,
        rating: values.rating || undefined,
      })
      toast.success(`${supplier.name} added`)
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers })
      onDone()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not add the supplier')
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField id="name" label="Name" error={errors.name}>
          <Input id="name" {...register('name')} />
        </TextField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="email" label="Email (optional)" error={errors.email}>
            <Input id="email" type="email" {...register('email')} />
          </TextField>
          <TextField id="phone" label="Phone (optional)" error={errors.phone}>
            <Input id="phone" type="tel" {...register('phone')} />
          </TextField>
        </div>
        <TextField id="address" label="Address (optional)" error={errors.address}>
          <Input id="address" {...register('address')} />
        </TextField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="leadTimeDays"
            label="Lead time (days)"
            error={errors.leadTimeDays}
            hint="Order to delivery; drives reorder advice"
          >
            <Input
              id="leadTimeDays"
              type="number"
              min={1}
              {...register('leadTimeDays', { valueAsNumber: true })}
            />
          </TextField>
          <TextField id="rating" label="Rating (optional)" error={errors.rating}>
            <Input id="rating" inputMode="decimal" placeholder="4.5" {...register('rating')} />
          </TextField>
        </div>
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
          Add supplier
        </Button>
      </DialogFooter>
    </form>
  )
}

export function SupplierDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <FormShell {...props} title="New supplier" description="Who you buy from.">
      <SupplierForm onDone={() => props.onOpenChange(false)} />
    </FormShell>
  )
}
