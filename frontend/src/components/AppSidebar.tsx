import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  History,
  LayoutDashboard,
  Package,
  ScrollText,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useAuth } from '@/hooks/useAuth'
import { navFor, type NavItem } from '@/utils/permissions'

const ICONS: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/inventory': Boxes,
  '/products': Package,
  '/transfers': ArrowLeftRight,
  '/transactions': History,
  '/warehouses': Warehouse,
  '/suppliers': Truck,
  '/analytics': BarChart3,
  '/forecasts': TrendingUp,
  '/users': Users,
  '/audit-log': ScrollText,
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const { pathname } = useLocation()
  if (items.length === 0) return null
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = ICONS[item.to] ?? Boxes
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.to || pathname.startsWith(item.to + '/')}
                  tooltip={item.label}
                >
                  <NavLink to={item.to}>
                    <Icon />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar() {
  const { user } = useAuth()
  const items = user ? navFor(user.role) : []

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Boxes className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="font-semibold">InventoryOS</span>
                  <span className="text-xs text-muted-foreground">Stock & forecasting</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Operations" items={items.filter((item) => item.group === 'main')} />
        <NavGroup label="Administration" items={items.filter((item) => item.group === 'admin')} />
      </SidebarContent>
      <SidebarFooter>
        {user?.warehouse && (
          <p className="truncate px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {user.warehouse.name}
          </p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
