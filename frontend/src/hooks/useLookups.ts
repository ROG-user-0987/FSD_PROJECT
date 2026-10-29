// Small reference lists used by filters and forms. Cached for a few minutes.
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { Category, ProductListItem, Supplier, Warehouse } from '@/types/api'

const FIVE_MINUTES = 5 * 60_000

export function useWarehouses() {
  return useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => api.get<Warehouse[]>('/warehouses'),
    staleTime: FIVE_MINUTES,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.get<Category[]>('/categories'),
    staleTime: FIVE_MINUTES,
  })
}

export function useSuppliers() {
  return useQuery({
    queryKey: [...queryKeys.suppliers, 'all'],
    queryFn: async () => (await api.page<Supplier>('/suppliers', { pageSize: 200 })).data,
    staleTime: FIVE_MINUTES,
  })
}

// Every active product (id, SKU, name) for pickers.
export function useProductOptions() {
  return useQuery({
    queryKey: [...queryKeys.products, 'options'],
    queryFn: async () =>
      (await api.page<ProductListItem>('/products', { pageSize: 200, sort: 'name' })).data,
    staleTime: FIVE_MINUTES,
  })
}
