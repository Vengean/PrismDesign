import {Link,NavLink,Navigate,Outlet,useLocation} from 'react-router-dom';
import {ChevronRight,FolderKanban,KeyRound,LogOut,Users} from 'lucide-react';
import {useAuth} from '@/hooks/use-auth';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {loginLocation} from '@/lib/auth-redirect';

export default function Layout(){
 const {user,isAdmin,logout}=useAuth();
 const {pathname,search,hash}=useLocation();
 if(!user)return <Navigate to={loginLocation(pathname+search+hash)} replace/>;
 const section=pathname==='/projects/create'?'新建项目':pathname.includes('/releases/')?'发布详情':pathname.startsWith('/projects/')?'项目详情':pathname==='/admin/users'?'用户管理':pathname==='/settings/password'?'账号安全':pathname==='/preview/continue'?'打开工作区':'项目';
 const account=<DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="打开账号菜单" className="account-trigger"><span className="avatar-button">{user.id[0]?.toUpperCase()}</span><span className="account-name">{user.id}</span></button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={8} className="w-52">
  <div className="px-2 py-2"><p className="truncate text-xs font-medium">{user.id}</p><p className="mt-1 text-xs text-muted-foreground">{isAdmin?'平台管理员':'开发者'}</p></div><DropdownMenuSeparator/>
  {isAdmin&&<DropdownMenuItem asChild><Link to="/admin/users"><Users size={15}/>用户管理</Link></DropdownMenuItem>}
  <DropdownMenuItem asChild><Link to="/settings/password"><KeyRound size={15}/>修改密码</Link></DropdownMenuItem><DropdownMenuSeparator/>
  <DropdownMenuItem onSelect={logout} className="text-destructive focus:text-destructive"><LogOut size={15}/>退出登录</DropdownMenuItem>
 </DropdownMenuContent></DropdownMenu>;
 return <div className="app-shell">
  <aside className="app-sidebar"><Link to="/projects" className="brand" aria-label="Prism Studio 首页"><img src="/prism-logo.png" alt=""/><span>Prism Studio</span></Link><p className="sidebar-label">工作空间</p><nav aria-label="主导航"><NavLink to="/projects" className={({isActive})=>`sidebar-link ${isActive?'is-active':''}`}><FolderKanban size={16}/>项目</NavLink>{isAdmin&&<NavLink to="/admin/users" className={({isActive})=>`sidebar-link ${isActive?'is-active':''}`}><Users size={16}/>用户管理</NavLink>}<NavLink to="/settings/password" className={({isActive})=>`sidebar-link ${isActive?'is-active':''}`}><KeyRound size={16}/>账号安全</NavLink></nav><div className="sidebar-footer"><span className="size-1.5 rounded-full bg-primary/60"/>Prism 工作台</div></aside>
  <div className="app-workspace"><header className="app-header"><div className="app-header-inner"><Link to="/projects" className="mobile-brand" aria-label="Prism Studio 首页"><img src="/prism-logo.png" alt=""/></Link><nav aria-label="当前位置" className="header-breadcrumb"><Link to="/projects" aria-label="返回项目列表">工作空间</Link><ChevronRight size={13}/><span>{section}</span></nav><div className="ml-auto">{account}</div></div></header><main id="main-content" className="app-main"><Outlet/></main></div>
 </div>;
}
