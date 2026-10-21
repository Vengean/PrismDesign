import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { ArrowLeft, KeyRound, LogOut, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Layout() {
  const {user,isAdmin,logout} = useAuth();
  const {pathname} = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  return <div className="app-shell">
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/projects" className="brand" aria-label="Prism Studio 首页"><img src="/prism-logo.png" alt="" className="size-8 shrink-0" /><span>Prism<span className="font-normal text-muted-foreground"> Studio</span></span></Link>
        {pathname !== "/projects" && <Link to="/projects" aria-label="返回项目列表" title="返回项目列表" className="ml-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground sm:ml-5"><ArrowLeft size={16} /><span className="hidden sm:inline">所有项目</span></Link>}
        <div className="ml-auto flex items-center gap-3">
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="打开账号菜单" className="avatar-button">{user.id[0]?.toUpperCase()}</button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={12} className="w-52 rounded-2xl p-1.5 shadow-lg shadow-black/5">
            <div className="px-3 py-2"><p className="truncate text-sm font-medium" title={user.id}>{user.id}</p><p className="mt-1 text-xs text-muted-foreground">{isAdmin?"平台管理员":"普通用户"}</p></div><DropdownMenuSeparator />
            {isAdmin && <DropdownMenuItem asChild className="rounded-lg px-3 py-2.5"><Link to="/admin/users"><Users size={16} />用户管理</Link></DropdownMenuItem>}
            <DropdownMenuItem asChild className="rounded-lg px-3 py-2.5"><Link to="/settings/password"><KeyRound size={16} />修改密码</Link></DropdownMenuItem><DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout} className="rounded-lg px-3 py-2.5 text-destructive focus:bg-destructive/5 focus:text-destructive"><LogOut size={16} />退出登录</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
        </div>
      </div>
    </header>
    <main id="main-content" className="app-main"><Outlet /></main>
  </div>;
}
