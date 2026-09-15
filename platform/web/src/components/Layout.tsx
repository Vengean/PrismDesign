import { useState, useRef, useEffect } from "react";
import { Outlet, NavLink, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { LayoutDashboard, Users, KeyRound, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="p-5">
          <h1 className="text-lg font-bold tracking-tight">PrismDesign</h1>
          <p className="text-xs text-muted-foreground mt-0.5">管理平台</p>
        </div>
        <Separator />

        <nav className="flex-1 p-3 space-y-1">
          <SidebarLink to="/dashboard" icon={<LayoutDashboard size={18} />}>
            工作台
          </SidebarLink>
          {isAdmin && (
            <SidebarLink to="/admin/users" icon={<Users size={18} />}>
              用户管理
            </SidebarLink>
          )}
          <SidebarLink to="/settings/password" icon={<KeyRound size={18} />}>
            修改密码
          </SidebarLink>
        </nav>
      </aside>

      {/* Right area: top bar + content */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="h-14 border-b bg-card flex items-center justify-end px-6 shrink-0">
          <UserMenu user={user} onLogout={logout} />
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto bg-muted/30">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function UserMenu({ user, onLogout }: { user: { id: string }; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-accent transition-colors"
      >
        <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
          {user.id[0].toUpperCase()}
        </div>
        <span className="text-sm font-medium">{user.id}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border bg-card shadow-md py-1 z-50">
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
          >
            <LogOut size={15} />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
