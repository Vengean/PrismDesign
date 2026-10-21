import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const {user,login} = useAuth();
  const [username,setUsername] = useState("");const [password,setPassword] = useState("");
  const [showPassword,setShowPassword] = useState(false);const [error,setError] = useState("");const [loading,setLoading] = useState(false);
  if(user)return <Navigate to="/projects" replace />;
  async function submit(e:FormEvent){e.preventDefault();setError("");setLoading(true);try{await login(username,password);}catch(e){setError(e instanceof Error?e.message:"登录失败，请稍后重试");}finally{setLoading(false);}}
  return <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#f8faf5]">
    <div aria-hidden="true" className="pointer-events-none absolute -right-48 -top-48 size-[600px] rounded-full bg-[#e8efdd]/50 blur-[100px]" />
    <header className="relative px-6 py-7 sm:px-10"><span className="brand"><img src="/prism-logo.png" alt="" className="size-8 shrink-0" /><span>Prism<span className="font-normal text-muted-foreground"> Studio</span></span></span></header>
    <main className="relative flex flex-1 items-center justify-center px-5 pb-20 pt-8"><div className="w-full max-w-[390px]">
      <div className="mb-9 text-center"><img src="/prism-logo.png" alt="Prism Studio" className="mx-auto mb-6 size-14" /><h1 className="text-[30px] font-semibold tracking-tight">欢迎回到 Prism</h1><p className="mt-3 text-sm text-[#8e9585]">你的想法，值得一个实现它的空间。</p></div>
      <form onSubmit={submit} className="space-y-5 rounded-[26px] border border-[#e4e9dc] bg-white/90 p-6 shadow-[0_12px_60px_-30px_#54614725] sm:p-8">
        {error&&<p role="alert" className="rounded-xl border border-destructive/15 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
        <div className="space-y-2"><Label htmlFor="username" className="text-xs text-[#707966]">账号</Label><Input id="username" required autoComplete="username" placeholder="输入你的账号" value={username} onChange={e => setUsername(e.target.value)} className="h-11 rounded-xl bg-[#fbfcf9] shadow-none" /></div>
        <div className="space-y-2"><Label htmlFor="password" className="text-xs text-[#707966]">密码</Label><div className="relative"><Input id="password" required type={showPassword?"text":"password"} autoComplete="current-password" placeholder="输入密码" value={password} onChange={e => setPassword(e.target.value)} className="h-11 rounded-xl bg-[#fbfcf9] pr-11 shadow-none" /><button type="button" aria-label={showPassword?"隐藏密码":"显示密码"} onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-3 text-[#a2aa99]">{showPassword?<EyeOff size={17} />:<Eye size={17} />}</button></div></div>
        <Button className="mt-2 h-11 w-full rounded-full" disabled={loading}>{loading?<><Loader2 size={15} className="animate-spin" />正在登录</>:<>进入我的空间<ArrowRight size={15} /></>}</Button>
      </form><p className="mt-7 text-center text-[11px] text-[#a3aa99]">账号由平台管理员分配</p>
    </div></main><footer className="pb-6 text-center text-[10px] tracking-widest text-[#afb5a6]">PRISM STUDIO · BUILD TOGETHER</footer>
  </div>;
}
