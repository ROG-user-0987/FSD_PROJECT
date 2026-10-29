// Signed-in shell: sidebar + top bar + page. Also starts the live-update listeners.
import { Outlet } from 'react-router'
import { AppSidebar } from '@/components/AppSidebar'
import { TopBar } from '@/components/TopBar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useLiveUpdates } from '@/hooks/useLiveUpdates'

export function AppLayout() {
  useLiveUpdates()
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <TopBar />
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
