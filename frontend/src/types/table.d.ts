import '@tanstack/react-table'

// Lets columns carry a className for alignment (e.g. right-aligned numbers).
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}
