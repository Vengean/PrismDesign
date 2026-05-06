import { useState } from 'react'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar'
import { Switch } from './components/ui/switch'
import { Separator } from './components/ui/separator'
import { Checkbox } from './components/ui/checkbox'
import {
  Bell,
  GitFork,
  Mail,
  Lock,
  AlertCircle,
  CheckCircle,
  Info,
  Palette,
  Layers,
  Zap,
  Accessibility,
  Heart,
  Star,
  ChevronRight,
} from 'lucide-react'

const teamMembers = [
  { name: '张三', role: 'UI Designer', fallback: 'ZS' },
  { name: '李四', role: 'Frontend Dev', fallback: 'LS' },
  { name: '王五', role: 'Product Manager', fallback: 'WW' },
]

const notifications = [
  { avatar: 'LM', name: '李明', action: '评论了你的文章', time: '刚刚', unread: true },
  { avatar: 'WH', name: '王华', action: '关注了你', time: '5 分钟前', unread: true },
  { avatar: 'ZY', name: '赵云', action: '点赞了你的作品', time: '1 小时前', unread: true },
  { avatar: 'CX', name: '陈鑫', action: '分享了你的设计', time: '2 小时前', unread: false },
  { avatar: 'SY', name: '孙燕', action: '回复了你的评论', time: '昨天', unread: false },
]

const switchItems = ['评论通知', '点赞通知', '系统消息']
const notificationSettings = [
  { label: '新评论', desc: '当有人评论你的内容' },
  { label: '新关注', desc: '当有人关注了你' },
  { label: '系统通知', desc: '重要的系统更新' },
]

export default function App() {
  const [rememberMe, setRememberMe] = useState(false)
  const [twoFactor, setTwoFactor] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3L21.5 20H2.5L12 3Z" fill="currentColor" />
              <path d="M12 9L18.5 20H12V9Z" fill="white" fillOpacity="0.25" />
            </svg>
            <span className="font-semibold">棱镜</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#components" className="text-muted-foreground hover:text-foreground transition-colors">组件</a>
            <a href="#examples" className="text-muted-foreground hover:text-foreground transition-colors">示例</a>
            <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">文档</a>
            <a href="#community" className="text-muted-foreground hover:text-foreground transition-colors">社区</a>
          </nav>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon">
              <GitFork className="h-4 w-4" />
            </Button>
            <Button size="sm">快速开始</Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="py-20 px-6 text-center border-b">
          <div className="mx-auto max-w-3xl">
            <Badge variant="secondary" className="mb-4 rounded-full px-3">开源 · 可定制 · 无障碍访问</Badge>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl mb-4">
              构建你的组件系统
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              精心设计的组件集合，基于 Radix UI 和 Tailwind CSS 构建。
              <br />
              开箱可用，完全可定制，代码归你所有。
            </p>
            <div className="flex justify-center gap-4 flex-wrap">
              <Button size="lg">
                <Zap className="h-4 w-4" />
                快速开始
              </Button>
              <Button variant="outline" size="lg">
                <GitFork className="h-4 w-4" />
                GitHub
              </Button>
            </div>
            <div className="mt-10 flex justify-center gap-8 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" /> 无需安装包</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" /> 完全可定制</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" /> TypeScript 支持</span>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-14 px-6 border-b bg-muted/30">
          <div className="mx-auto max-w-7xl grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { Icon: Layers, title: '组件即代码', desc: '复制代码到你的项目，完全掌控每一行逻辑，而不是依赖黑盒 npm 包。' },
              { Icon: Palette, title: '主题可定制', desc: '通过 CSS 变量驱动的设计系统，轻松调整颜色、圆角、间距等视觉风格。' },
              { Icon: Accessibility, title: '无障碍支持', desc: '基于 Radix UI 原语构建，支持屏幕阅读器和键盘导航，让所有用户都能无障碍使用。' },
            ].map(({ Icon, title, desc }) => (
              <Card key={title} className="border-0 shadow-none bg-transparent">
                <CardHeader className="pb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-2">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Component Showcase */}
        <section id="components" className="py-16 px-6 border-b">
          <div className="mx-auto max-w-7xl">
            <div className="mb-10">
              <h2 className="text-2xl font-bold tracking-tight mb-2">组件展示</h2>
              <p className="text-muted-foreground">浏览所有可用组件，每个组件都支持多种变体和尺寸。</p>
            </div>

            {/* Buttons */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                Button
              </h3>
              <Card>
                <CardContent className="pt-6 space-y-5">
                  <div>
                    <p className="text-xs text-muted-foreground mb-3 font-medium">变体</p>
                    <div className="flex flex-wrap gap-3">
                      <Button>Default</Button>
                      <Button variant="secondary">Secondary</Button>
                      <Button variant="destructive">Destructive</Button>
                      <Button variant="outline">Outline</Button>
                      <Button variant="ghost">Ghost</Button>
                      <Button variant="link">Link</Button>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-3 font-medium">尺寸</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button size="sm">Small</Button>
                      <Button>Default</Button>
                      <Button size="lg">Large</Button>
                      <Button size="icon"><Star className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-3 font-medium">带图标</p>
                    <div className="flex flex-wrap gap-3">
                      <Button><Mail className="h-4 w-4" /> 发送邮件</Button>
                      <Button variant="outline"><GitFork className="h-4 w-4" /> 登录 GitHub</Button>
                      <Button variant="secondary"><Heart className="h-4 w-4" /> 点赞</Button>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground mb-3 font-medium">禁用状态</p>
                    <div className="flex flex-wrap gap-3">
                      <Button disabled>Disabled</Button>
                      <Button variant="outline" disabled>Disabled Outline</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Badge */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                Badge
              </h3>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap gap-3">
                    <Badge>Default</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="destructive">Destructive</Badge>
                    <Badge variant="outline">Outline</Badge>
                    <Badge className="gap-1 rounded-full"><Star className="h-3 w-3" /> 精选</Badge>
                    <Badge variant="secondary" className="gap-1 rounded-full">
                      <CheckCircle className="h-3 w-3" /> 已完成
                    </Badge>
                    <Badge variant="destructive" className="gap-1 rounded-full">
                      <AlertCircle className="h-3 w-3" /> 错误
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Alert */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                Alert
              </h3>
              <div className="space-y-3">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>提示信息</AlertTitle>
                  <AlertDescription>
                    shadcn/ui 组件不是 npm 包，而是直接复制到项目中的代码。这意味着你拥有完整的控制权。
                  </AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>会话已过期</AlertTitle>
                  <AlertDescription>
                    你的登录状态已失效，请重新登录以继续使用。
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            {/* Avatar */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                Avatar
              </h3>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap items-center gap-4">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="https://github.com/shadcn.png" alt="shadcn" />
                      <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <Avatar className="h-10 w-10">
                      <AvatarImage src="https://github.com/shadcn.png" alt="shadcn" />
                      <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <Avatar className="h-12 w-12">
                      <AvatarImage src="https://github.com/shadcn.png" alt="shadcn" />
                      <AvatarFallback>CN</AvatarFallback>
                    </Avatar>
                    <Avatar className="h-10 w-10"><AvatarFallback>AB</AvatarFallback></Avatar>
                    <Avatar className="h-10 w-10"><AvatarFallback>YZ</AvatarFallback></Avatar>
                    <Avatar className="h-10 w-10 ring-2 ring-primary ring-offset-2">
                      <AvatarFallback>VIP</AvatarFallback>
                    </Avatar>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Form Elements */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                表单组件
              </h3>
              <Card>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="input-email">邮箱地址</Label>
                        <Input id="input-email" type="email" placeholder="name@example.com" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="input-password">密码</Label>
                        <Input id="input-password" type="password" placeholder="输入你的密码" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="input-disabled">禁用状态</Label>
                        <Input id="input-disabled" placeholder="此输入框已禁用" disabled />
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <p className="text-sm font-medium mb-3">Checkbox 复选框</p>
                        <div className="space-y-2.5">
                          {['接受服务条款', '订阅邮件通知', '记住我的偏好'].map((label) => (
                            <div key={label} className="flex items-center gap-2">
                              <Checkbox id={`cb-${label}`} />
                              <Label htmlFor={`cb-${label}`} className="cursor-pointer font-normal">{label}</Label>
                            </div>
                          ))}
                        </div>
                      </div>
                      <Separator />
                      <div>
                        <p className="text-sm font-medium mb-3">Switch 开关</p>
                        <div className="space-y-3">
                          {switchItems.map((label) => (
                            <div key={label} className="flex items-center justify-between">
                              <Label className="font-normal">{label}</Label>
                              <Switch />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                Tabs
              </h3>
              <Tabs defaultValue="preview">
                <TabsList>
                  <TabsTrigger value="preview">预览</TabsTrigger>
                  <TabsTrigger value="code">代码</TabsTrigger>
                  <TabsTrigger value="api">API</TabsTrigger>
                </TabsList>
                <TabsContent value="preview">
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground mb-4">
                        Tabs 组件由 Radix UI 提供无障碍支持，通过键盘方向键即可切换标签。
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <Badge>React</Badge>
                        <Badge variant="secondary">TypeScript</Badge>
                        <Badge variant="outline">Tailwind CSS</Badge>
                        <Badge variant="outline">Radix UI</Badge>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="code">
                  <Card>
                    <CardContent className="pt-6">
                      <pre className="text-sm bg-muted rounded-md p-4 overflow-auto text-muted-foreground"><code>{`<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">
    Content 1
  </TabsContent>
  <TabsContent value="tab2">
    Content 2
  </TabsContent>
</Tabs>`}</code></pre>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="api">
                  <Card>
                    <CardContent className="pt-6">
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-3 gap-4 font-medium text-xs uppercase tracking-wide text-muted-foreground pb-2 border-b">
                          <span>属性</span>
                          <span>类型</span>
                          <span>描述</span>
                        </div>
                        {[
                          ['defaultValue', 'string', '默认激活的标签页'],
                          ['value', 'string', '受控模式下的当前值'],
                          ['onValueChange', '(v: string) => void', '值变化时的回调函数'],
                        ].map(([prop, type, desc]) => (
                          <div key={prop} className="grid grid-cols-3 gap-4 py-2 border-b border-border/50">
                            <code className="text-xs font-mono">{prop}</code>
                            <code className="text-xs text-muted-foreground font-mono">{type}</code>
                            <span className="text-xs text-muted-foreground">{desc}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>

            {/* Card */}
            <div className="mb-2">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-muted-foreground uppercase tracking-wide">
                Card
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>基础卡片</CardTitle>
                    <CardDescription>卡片是内容分组的基础容器</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      可以在卡片内放置任意内容，包括文字、图片、表单等。
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button size="sm" variant="outline" className="w-full">查看详情</Button>
                  </CardFooter>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>通知设置</CardTitle>
                      <Badge variant="secondary">3 未读</Badge>
                    </div>
                    <CardDescription>管理你的推送通知偏好</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {switchItems.map((item) => (
                        <div key={item} className="flex items-center justify-between">
                          <span className="text-sm">{item}</span>
                          <Switch />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>团队成员</CardTitle>
                    <CardDescription>当前团队共 {teamMembers.length} 位成员</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {teamMembers.map(({ name, role, fallback }) => (
                        <div key={name} className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                            <p className="text-xs text-muted-foreground truncate">{role}</p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">查看</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Best Practice Examples */}
        <section id="examples" className="py-16 px-6 bg-muted/30 border-b">
          <div className="mx-auto max-w-7xl">
            <div className="mb-10">
              <h2 className="text-2xl font-bold tracking-tight mb-2">最佳实践</h2>
              <p className="text-muted-foreground">组合多个组件，构建真实场景的 UI 界面。</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
              {/* Login Form */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">登录表单</p>
                <Card>
                  <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl">登录账户</CardTitle>
                    <CardDescription>输入你的邮箱和密码以登录</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">邮箱</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input id="login-email" type="email" placeholder="name@example.com" className="pl-9" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="login-password">密码</Label>
                        <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          忘记密码？
                        </a>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input id="login-password" type="password" placeholder="••••••••" className="pl-9" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="remember-me"
                        checked={rememberMe}
                        onCheckedChange={(v) => setRememberMe(v === true)}
                      />
                      <Label htmlFor="remember-me" className="cursor-pointer font-normal text-sm">
                        记住我
                      </Label>
                    </div>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-3">
                    <Button className="w-full">登录</Button>
                    <Button variant="outline" className="w-full">
                      <GitFork className="h-4 w-4" />
                      使用 GitHub 登录
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      还没有账号？
                      <a href="#" className="underline underline-offset-4 hover:text-foreground">立即注册</a>
                    </p>
                  </CardFooter>
                </Card>
              </div>

              {/* User Settings */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">用户设置</p>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarFallback>ZS</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-base">张设计师</CardTitle>
                        <CardDescription>designer@example.com</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <Separator />
                  <CardContent className="pt-4">
                    <Tabs defaultValue="profile">
                      <TabsList className="w-full">
                        <TabsTrigger value="profile" className="flex-1">资料</TabsTrigger>
                        <TabsTrigger value="notifications" className="flex-1">通知</TabsTrigger>
                        <TabsTrigger value="security" className="flex-1">安全</TabsTrigger>
                      </TabsList>
                      <TabsContent value="profile" className="mt-4 space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="display-name">显示名称</Label>
                          <Input id="display-name" defaultValue="张设计师" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bio">个人简介</Label>
                          <Input id="bio" placeholder="介绍一下自己..." />
                        </div>
                      </TabsContent>
                      <TabsContent value="notifications" className="mt-4 space-y-3">
                        {notificationSettings.map(({ label, desc }) => (
                          <div key={label} className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium">{label}</p>
                              <p className="text-xs text-muted-foreground">{desc}</p>
                            </div>
                            <Switch />
                          </div>
                        ))}
                      </TabsContent>
                      <TabsContent value="security" className="mt-4 space-y-3">
                        <div className="flex items-center justify-between p-3 border rounded-lg">
                          <div>
                            <p className="text-sm font-medium">两步验证</p>
                            <p className="text-xs text-muted-foreground">使用 Google Authenticator</p>
                          </div>
                          <Switch
                            checked={twoFactor}
                            onCheckedChange={setTwoFactor}
                          />
                        </div>
                        {twoFactor && (
                          <Alert>
                            <CheckCircle className="h-4 w-4" />
                            <AlertTitle>两步验证已开启</AlertTitle>
                            <AlertDescription>你的账号安全性已大幅提升。</AlertDescription>
                          </Alert>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                  <CardFooter>
                    <Button size="sm" className="ml-auto">保存设置</Button>
                  </CardFooter>
                </Card>
              </div>

              {/* Notifications Panel */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">通知中心</p>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Bell className="h-4 w-4" />
                        通知
                      </CardTitle>
                      <Badge>
                        {notifications.filter((n) => n.unread).length} 条未读
                      </Badge>
                    </div>
                  </CardHeader>
                  <Separator />
                  <CardContent className="p-0">
                    {notifications.map(({ avatar, name, action, time, unread }) => (
                      <div
                        key={name}
                        className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors ${unread ? 'bg-primary/5' : ''}`}
                      >
                        <Avatar className="h-8 w-8 mt-0.5 shrink-0">
                          <AvatarFallback className="text-xs">{avatar}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-snug">
                            <span className="font-medium">{name}</span>
                            <span className="text-muted-foreground"> {action}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{time}</p>
                        </div>
                        {unread && (
                          <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                        )}
                      </div>
                    ))}
                  </CardContent>
                  <CardFooter className="pt-3">
                    <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
                      查看全部通知
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            </div>
          </div>
        </section>
      </main>

        {/* Community */}
        <section id="community" className="py-16 px-6 border-b">
          <div className="mx-auto max-w-4xl">
            <div className="mb-10">
              <h2 className="text-2xl font-bold tracking-tight mb-2">社区</h2>
              <p className="text-muted-foreground">在这里与来自各地的开发者共同交流组件设计心得、分享实战经验、探讨技术难题，共同推动前端生态的发展。</p>
            </div>

            {/* Post composer */}
            <Card className="mb-6">
              <CardContent className="pt-4">
                <div className="flex gap-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback>我</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-3">
                    <Input placeholder="分享你的想法、问题或作品…" />
                    <div className="flex justify-end">
                      <Button size="sm">发布</Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Post list */}
            <div className="space-y-4">
              {[
                {
                  avatar: 'ZS', name: '张设计师', time: '2 小时前',
                  tags: ['分享'],
                  title: '用棱镜组件库搭了一套后台管理系统',
                  body: '花了两天时间，基于 Card + Tabs + Switch 等组件搭建了一套后台管理界面，主题切换非常丝滑，强烈推荐！',
                  likes: 42, comments: 8,
                },
                {
                  avatar: 'LM', name: '李明', time: '5 小时前',
                  tags: ['问题'],
                  title: 'Avatar 组件在 Safari 上圆角失效怎么处理？',
                  body: '发现在 Safari 15 以下 `overflow-hidden` + `rounded-full` 组合会失效，尝试加 `isolate` 没有效果，有遇到类似问题的吗？',
                  likes: 17, comments: 12,
                },
                {
                  avatar: 'WH', name: '王华', time: '昨天',
                  tags: ['展示'],
                  title: '基于棱镜做的暗色主题 Dashboard 截图',
                  body: '调整了 CSS 变量实现了自定义暗色主题，整体风格偏 Linear 风格，欢迎大家反馈意见。',
                  likes: 89, comments: 24,
                },
              ].map(({ avatar, name, time, tags, title, body, likes, comments }) => (
                <Card key={title}>
                  <CardContent className="pt-5">
                    <div className="flex gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-xs">{avatar}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium">{name}</span>
                          <span className="text-xs text-muted-foreground">{time}</span>
                          {tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0 h-5">{tag}</Badge>
                          ))}
                        </div>
                        <p className="text-sm font-semibold mb-1">{title}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-3">{body}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                            <Heart className="h-3.5 w-3.5" />
                            {likes}
                          </button>
                          <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                            <Mail className="h-3.5 w-3.5" />
                            {comments} 回复
                          </button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="mt-6 text-center">
              <Button variant="outline">加载更多</Button>
            </div>
          </div>
        </section>

      <footer className="border-t py-8 px-6">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-foreground" />
            <span>shadcn/ui 组件展示</span>
          </div>
          <p>基于 Radix UI + Tailwind CSS 构建 · {new Date().getFullYear()}</p>
          <div className="flex items-center gap-4">
            <a href="#" className="hover:text-foreground transition-colors">文档</a>
            <a href="#" className="hover:text-foreground transition-colors">GitHub</a>
            <a href="#" className="hover:text-foreground transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
