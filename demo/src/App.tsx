import { useState, useRef, useEffect } from 'react'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/ui/card'
import { Input } from './components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Avatar, AvatarFallback } from './components/ui/avatar'
import { Separator } from './components/ui/separator'
import {
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneMissed,
  Clock,
  Users,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Headphones,
  BarChart3,
  Activity,
  Target,
  CalendarDays,
  Download,
  RefreshCw,
  ChevronRight,
  UserCheck,
  Timer,
  MessageSquareText,
  Send,
  Bot,
  X,
  Sparkles,
  User,
} from 'lucide-react'

const kpiCards = [
  {
    title: '今日外呼总量',
    value: '3,842',
    change: '+12.5%',
    trend: 'up' as const,
    desc: '较昨日',
    icon: Phone,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-50',
  },
  {
    title: '接通率',
    value: '68.7%',
    change: '+3.2%',
    trend: 'up' as const,
    desc: '较昨日',
    icon: PhoneCall,
    iconColor: 'text-green-600',
    iconBg: 'bg-green-50',
  },
  {
    title: '平均通话时长',
    value: '4m 32s',
    change: '-8s',
    trend: 'down' as const,
    desc: '较昨日',
    icon: Timer,
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-50',
  },
  {
    title: '意向客户数',
    value: '286',
    change: '+18.3%',
    trend: 'up' as const,
    desc: '较昨日',
    icon: UserCheck,
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-50',
  },
]

const weeklyData = [
  { day: '周一', calls: 3200, connected: 2180 },
  { day: '周二', calls: 3580, connected: 2450 },
  { day: '周三', calls: 2900, connected: 1920 },
  { day: '周四', calls: 3750, connected: 2600 },
  { day: '周五', calls: 4100, connected: 2870 },
  { day: '周六', calls: 1200, connected: 780 },
  { day: '周日', calls: 800, connected: 520 },
]
const maxCalls = Math.max(...weeklyData.map((d) => d.calls))

const callStatusData = [
  { label: '已接通', count: 2638, percentage: 68.7, color: 'bg-green-500' },
  { label: '无人接听', count: 654, percentage: 17.0, color: 'bg-orange-500' },
  { label: '忙线中', count: 312, percentage: 8.1, color: 'bg-yellow-500' },
  { label: '号码无效', count: 156, percentage: 4.1, color: 'bg-red-500' },
  { label: '主动挂断', count: 82, percentage: 2.1, color: 'bg-gray-400' },
]

const hourlyData = [
  { hour: '09:00', value: 85 },
  { hour: '10:00', value: 92 },
  { hour: '11:00', value: 78 },
  { hour: '12:00', value: 45 },
  { hour: '13:00', value: 30 },
  { hour: '14:00', value: 88 },
  { hour: '15:00', value: 95 },
  { hour: '16:00', value: 100 },
  { hour: '17:00', value: 72 },
  { hour: '18:00', value: 40 },
]
const maxHourly = Math.max(...hourlyData.map((d) => d.value))

const agents = [
  { name: '王丽娜', fallback: 'WL', calls: 486, connected: 342, rate: 70.4, avgDuration: '4m 48s', intent: 38, status: 'online' },
  { name: '张明远', fallback: 'ZM', calls: 462, connected: 318, rate: 68.8, avgDuration: '5m 12s', intent: 35, status: 'online' },
  { name: '李思琪', fallback: 'LS', calls: 445, connected: 312, rate: 70.1, avgDuration: '4m 22s', intent: 33, status: 'busy' },
  { name: '陈浩然', fallback: 'CH', calls: 428, connected: 289, rate: 67.5, avgDuration: '3m 56s', intent: 30, status: 'online' },
  { name: '赵雨萱', fallback: 'ZY', calls: 410, connected: 275, rate: 67.1, avgDuration: '4m 05s', intent: 28, status: 'offline' },
  { name: '刘子轩', fallback: 'LZ', calls: 398, connected: 260, rate: 65.3, avgDuration: '3m 45s', intent: 26, status: 'online' },
]

const recentCalls = [
  { customer: '上海鑫达贸易', phone: '138****6721', agent: '王丽娜', duration: '5m 23s', result: '意向', time: '16:42', tag: 'A级' },
  { customer: '北京中润科技', phone: '159****3348', agent: '张明远', duration: '3m 10s', result: '待跟进', time: '16:38', tag: 'B级' },
  { customer: '深圳创新材料', phone: '186****9012', agent: '李思琪', duration: '0s', result: '未接通', time: '16:35', tag: '' },
  { customer: '杭州云数网络', phone: '135****4567', agent: '陈浩然', duration: '6m 45s', result: '意向', time: '16:30', tag: 'A级' },
  { customer: '广州智联物流', phone: '177****8890', agent: '王丽娜', duration: '2m 08s', result: '拒绝', time: '16:25', tag: '' },
  { customer: '成都华瑞电子', phone: '150****2234', agent: '赵雨萱', duration: '4m 52s', result: '待跟进', time: '16:20', tag: 'B级' },
  { customer: '武汉盛世地产', phone: '188****5567', agent: '刘子轩', duration: '1m 30s', result: '拒绝', time: '16:15', tag: '' },
  { customer: '南京明辉化工', phone: '136****7789', agent: '张明远', duration: '7m 18s', result: '意向', time: '16:10', tag: 'A级' },
]

const resultBadge: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  '意向': { variant: 'default', label: '意向' },
  '待跟进': { variant: 'secondary', label: '待跟进' },
  '未接通': { variant: 'outline', label: '未接通' },
  '拒绝': { variant: 'destructive', label: '拒绝' },
}

const statusColor: Record<string, string> = {
  online: 'bg-green-500',
  busy: 'bg-yellow-500',
  offline: 'bg-gray-300',
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  time: string
}

const mockResponses: { keywords: string[]; response: string }[] = [
  {
    keywords: ['接通率', '接通'],
    response: '**今日接通率分析**\n\n当前接通率为 **68.7%**，较昨日提升 3.2 个百分点。\n\n- 上午时段（9:00-12:00）接通率最高，达 **74.2%**\n- 午休时段（12:00-14:00）降至 **52.1%**\n- 下午时段（14:00-18:00）回升至 **69.8%**\n\n建议将重点外呼任务集中在上午时段，可有效提升整体接通率约 5-8%。',
  },
  {
    keywords: ['坐席', '排名', '排行', '绩效', '表现'],
    response: '**坐席绩效分析**\n\n今日 TOP 3 坐席表现：\n\n1. **王丽娜** — 外呼 486 通，接通率 70.4%，意向客户 38 个\n2. **张明远** — 外呼 462 通，接通率 68.8%，意向客户 35 个\n3. **李思琪** — 外呼 445 通，接通率 70.1%，意向客户 33 个\n\n王丽娜和李思琪的接通率均突破 70%，建议团队学习其话术技巧。刘子轩接通率偏低（65.3%），建议安排针对性培训。',
  },
  {
    keywords: ['意向', '客户', '转化'],
    response: '**意向客户分析**\n\n今日新增意向客户 **286 个**，较昨日增长 18.3%。\n\n按客户等级分布：\n- A级（高意向）：**68 个**（23.8%）\n- B级（中意向）：**124 个**（43.4%）\n- C级（低意向）：**94 个**（32.8%）\n\n意向转化率为 **7.4%**（286/3842），高于行业平均水平 5.2%。建议优先跟进 A 级客户，48 小时内安排二次回访。',
  },
  {
    keywords: ['趋势', '本周', '周'],
    response: '**本周外呼趋势分析**\n\n本周工作日外呼总量呈上升趋势：\n\n- 周一：3,200 通（接通率 68.1%）\n- 周二：3,580 通（接通率 68.4%）\n- 周三：2,900 通（接通率 66.2%）⚠️ 低谷\n- 周四：3,750 通（接通率 69.3%）\n- 周五：4,100 通（接通率 70.0%）📈 峰值\n\n周三外呼量下降 19%，主因是 3 名坐席请假。周五表现最佳，建议分析该日话术和名单质量。',
  },
  {
    keywords: ['时段', '时间', '什么时候', '高峰'],
    response: '**时段效率分析**\n\n今日各时段外呼效率排名：\n\n🔥 **高峰时段**\n- 16:00（活跃度 100）— 外呼量最大\n- 15:00（活跃度 95）\n- 10:00（活跃度 92）\n\n❄️ **低谷时段**\n- 13:00（活跃度 30）— 午休后恢复期\n- 18:00（活跃度 40）— 临近下班\n\n建议：将高价值客户名单安排在 10:00 和 15:00-16:00 拨打，可提升约 12% 的接通率。',
  },
  {
    keywords: ['号码', '无效', '失败', '未接通'],
    response: '**未接通分析**\n\n今日未接通呼叫共 **1,204 通**（31.3%），具体分布：\n\n- 无人接听：654 通（54.3%）\n- 忙线中：312 通（25.9%）\n- 号码无效：156 通（13.0%）\n- 主动挂断：82 通（6.8%）\n\n号码无效率为 4.1%，较上周的 3.6% 有所上升。建议：\n1. 对名单来源进行质量审查\n2. 无人接听号码在 2 小时后自动加入重拨队列\n3. 忙线号码在 30 分钟后重试',
  },
]

function getAIResponse(input: string): string {
  const lower = input.toLowerCase()
  for (const { keywords, response } of mockResponses) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return response
    }
  }
  return `**分析结果**\n\n根据当前数据，今日外呼总量 **3,842 通**，接通率 **68.7%**，意向客户 **286 个**，整体表现优于昨日。\n\n您可以尝试问我：\n- "分析今日接通率"\n- "坐席绩效排名如何？"\n- "意向客户转化情况"\n- "本周趋势怎么样？"\n- "哪个时段效率最高？"\n- "未接通原因分析"`
}

function getNow() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const initialMessages: ChatMessage[] = [
  {
    role: 'assistant',
    content: '你好！我是数据分析助手，可以帮你分析外呼系统的各项数据指标。\n\n你可以问我关于 **接通率、坐席绩效、意向客户、时段分布** 等问题。',
    time: '16:40',
  },
]

export default function App() {
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  function handleSend() {
    const text = inputValue.trim()
    if (!text || isTyping) return

    const userMsg: ChatMessage = { role: 'user', content: text, time: getNow() }
    setMessages((prev) => [...prev, userMsg])
    setInputValue('')
    setIsTyping(true)

    setTimeout(() => {
      const aiMsg: ChatMessage = { role: 'assistant', content: getAIResponse(text), time: getNow() }
      setMessages((prev) => [...prev, aiMsg])
      setIsTyping(false)
    }, 800 + Math.random() * 700)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto max-w-[1400px] flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Headphones className="h-4 w-4" />
            </div>
            <span className="font-semibold text-lg">外呼数据中心</span>
            <Badge variant="secondary" className="text-xs">实时</Badge>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <a href="#" className="text-foreground font-medium">数据看板</a>
            <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">任务管理</a>
            <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">客户列表</a>
            <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">坐席管理</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5" />
              导出报表
            </Button>
            <Button size="sm">
              <RefreshCw className="h-3.5 w-3.5" />
              刷新数据
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-6 space-y-6">
        {/* Page Title */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">数据看板</h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              2026年5月8日 · 数据更新于 16:45
            </p>
          </div>
          <Tabs defaultValue="today">
            <TabsList>
              <TabsTrigger value="today">今日</TabsTrigger>
              <TabsTrigger value="week">本周</TabsTrigger>
              <TabsTrigger value="month">本月</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map(({ title, value, change, trend, desc, icon: Icon, iconColor, iconBg }) => (
            <Card key={title}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{title}</p>
                    <p className="text-3xl font-bold tracking-tight">{value}</p>
                    <div className="flex items-center gap-1 text-xs">
                      {trend === 'up' ? (
                        <span className="flex items-center gap-0.5 text-green-600">
                          <ArrowUpRight className="h-3 w-3" />
                          {change}
                        </span>
                      ) : (
                        <span className="flex items-center gap-0.5 text-orange-600">
                          <ArrowDownRight className="h-3 w-3" />
                          {change}
                        </span>
                      )}
                      <span className="text-muted-foreground">{desc}</span>
                    </div>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}>
                    <Icon className={`h-5 w-5 ${iconColor}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Weekly Trend */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    近7天外呼趋势
                  </CardTitle>
                  <CardDescription>外呼总量与接通量对比</CardDescription>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                    外呼总量
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-primary/40" />
                    接通量
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 h-48">
                {weeklyData.map(({ day, calls, connected }) => (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium text-muted-foreground">{calls}</span>
                    <div className="w-full flex gap-1 items-end" style={{ height: '140px' }}>
                      <div
                        className="flex-1 bg-primary rounded-t-sm transition-all duration-500"
                        style={{ height: `${(calls / maxCalls) * 100}%` }}
                      />
                      <div
                        className="flex-1 bg-primary/40 rounded-t-sm transition-all duration-500"
                        style={{ height: `${(connected / maxCalls) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{day}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Call Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                呼叫状态分布
              </CardTitle>
              <CardDescription>今日各状态占比</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Donut visualization */}
              <div className="flex justify-center">
                <div className="relative h-32 w-32">
                  <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                    {(() => {
                      let offset = 0
                      const colors = ['#22c55e', '#f97316', '#eab308', '#ef4444', '#9ca3af']
                      return callStatusData.map((item, i) => {
                        const dash = item.percentage * 2.51327
                        const gap = 251.327 - dash
                        const el = (
                          <circle
                            key={item.label}
                            cx="50"
                            cy="50"
                            r="40"
                            fill="none"
                            stroke={colors[i]}
                            strokeWidth="12"
                            strokeDasharray={`${dash} ${gap}`}
                            strokeDashoffset={-offset}
                          />
                        )
                        offset += dash
                        return el
                      })
                    })()}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold">3,842</span>
                    <span className="text-xs text-muted-foreground">总呼叫</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2.5">
                {callStatusData.map(({ label, count, percentage, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full ${color} shrink-0`} />
                    <span className="text-sm flex-1">{label}</span>
                    <span className="text-sm font-medium">{count}</span>
                    <span className="text-xs text-muted-foreground w-10 text-right">{percentage}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Hourly Activity + Agent Ranking */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Hourly Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                今日时段分布
              </CardTitle>
              <CardDescription>各时段外呼活跃度</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {hourlyData.map(({ hour, value }) => (
                  <div key={hour} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-10 shrink-0">{hour}</span>
                    <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded-full transition-all duration-500"
                        style={{ width: `${(value / maxHourly) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium w-6 text-right">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Agent Ranking */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    坐席排行榜
                  </CardTitle>
                  <CardDescription>按外呼总量排名</CardDescription>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  查看全部
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {/* Table header */}
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <span>坐席</span>
                  <span className="text-right">外呼量</span>
                  <span className="text-right">接通量</span>
                  <span className="text-right">接通率</span>
                  <span className="text-right">均时长</span>
                  <span className="text-right">意向客户</span>
                </div>
                <Separator />
                {agents.map(({ name, fallback, calls, connected, rate, avgDuration, intent, status }, index) => (
                  <div
                    key={name}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors items-center"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-muted-foreground w-4">{index + 1}</span>
                      <div className="relative">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">{fallback}</AvatarFallback>
                        </Avatar>
                        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${statusColor[status]}`} />
                      </div>
                      <span className="text-sm font-medium">{name}</span>
                    </div>
                    <span className="text-sm text-right font-medium">{calls}</span>
                    <span className="text-sm text-right">{connected}</span>
                    <span className={`text-sm text-right font-medium ${rate >= 70 ? 'text-green-600' : ''}`}>{rate}%</span>
                    <span className="text-sm text-right text-muted-foreground">{avgDuration}</span>
                    <span className="text-sm text-right font-medium">{intent}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Summary Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: '外呼任务完成率', value: '92.3%', icon: Target, color: 'text-blue-600' },
            { label: '今日在线坐席', value: '24 / 30', icon: Headphones, color: 'text-green-600' },
            { label: '平均等待时长', value: '12s', icon: Clock, color: 'text-orange-600' },
            { label: '客户满意度', value: '4.6 / 5.0', icon: TrendingUp, color: 'text-purple-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${color}`} />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Recent Calls */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  最近通话记录
                </CardTitle>
                <CardDescription>实时更新的通话流水</CardDescription>
              </div>
              <Button variant="outline" size="sm">
                查看全部
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Table header */}
            <div className="grid grid-cols-[1.5fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.6fr] gap-4 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <span>客户名称</span>
              <span>联系电话</span>
              <span>坐席</span>
              <span>通话时长</span>
              <span>通话结果</span>
              <span>客户等级</span>
              <span className="text-right">时间</span>
            </div>
            <Separator />
            {recentCalls.map(({ customer, phone, agent, duration, result, time, tag }, index) => (
              <div key={index}>
                <div className="grid grid-cols-[1.5fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.6fr] gap-4 px-3 py-3 hover:bg-muted/50 transition-colors items-center">
                  <span className="text-sm font-medium">{customer}</span>
                  <span className="text-sm text-muted-foreground font-mono">{phone}</span>
                  <span className="text-sm">{agent}</span>
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    {result === '未接通' ? (
                      <PhoneOff className="h-3 w-3 text-red-400" />
                    ) : (
                      <PhoneCall className="h-3 w-3 text-green-500" />
                    )}
                    {duration}
                  </span>
                  <span>
                    <Badge variant={resultBadge[result]?.variant ?? 'outline'} className="text-xs">
                      {result}
                    </Badge>
                  </span>
                  <span>
                    {tag ? (
                      <Badge variant={tag === 'A级' ? 'default' : 'secondary'} className="text-xs">
                        {tag}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground text-right">{time}</span>
                </div>
                {index < recentCalls.length - 1 && <Separator className="opacity-50" />}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>

      <footer className="border-t py-6 px-6 mt-6">
        <div className="mx-auto max-w-[1400px] flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Headphones className="h-4 w-4" />
            <span>外呼数据中心 v1.0</span>
          </div>
          <p>数据每 5 分钟自动刷新 · {new Date().getFullYear()}</p>
        </div>
      </footer>

      {/* Chat Toggle Button */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95"
        >
          <MessageSquareText className="h-6 w-6" />
        </button>
      )}

      {/* Chat Panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[420px] max-w-full bg-background border-l shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Chat Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-background shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">数据分析助手</h3>
              <p className="text-xs text-muted-foreground">基于看板数据智能分析</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setChatOpen(false)} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                <AvatarFallback className="text-xs">
                  {msg.role === 'assistant' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
              <div className={`max-w-[85%] space-y-1 ${msg.role === 'user' ? 'items-end' : ''}`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted rounded-bl-md'
                  }`}
                  dangerouslySetInnerHTML={{
                    __html: msg.content
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                      .replace(/\n/g, '<br/>'),
                  }}
                />
                <p className={`text-[10px] text-muted-foreground px-1 ${msg.role === 'user' ? 'text-right' : ''}`}>
                  {msg.time}
                </p>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                <AvatarFallback className="text-xs">
                  <Bot className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Actions */}
        <div className="px-5 pb-2 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {['接通率分析', '坐席绩效', '意向客户', '时段分布'].map((label) => (
              <button
                key={label}
                onClick={() => {
                  if (isTyping) return
                  setInputValue(label)
                }}
                className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Chat Input */}
        <div className="px-5 py-4 border-t bg-background shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="输入数据分析问题..."
              className="flex-1"
              disabled={isTyping}
            />
            <Button type="submit" size="icon" disabled={!inputValue.trim() || isTyping} className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>

      {/* Overlay */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity"
          onClick={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}
