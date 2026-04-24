import { FileText, MapPin, Settings } from 'lucide-react'
import { Card } from './ui/card'
import './UserProfile.css'

interface UserProfileProps {
  user: {
    name: string
    avatar: string
    role: string
    stats: {
      orders: number
      favorites: number
      coupons: number
    }
  }
}

export function UserProfile({ user }: UserProfileProps) {
  return (
    <Card className="user-profile-card">
      <div className="user-header">
        <div className="user-avatar w-12 h-12 rounded-full flex items-center justify-center">
          {user.avatar}
        </div>
        <div>
          <h5 className="font-semibold text-[#1e1b4b] text-sm m-0">{user.name}</h5>
          <p className="text-xs text-[#6b7280] m-0">{user.role}</p>
        </div>
      </div>

      <div className="user-stats">
        {[
          { label: '订单', value: user.stats.orders },
          { label: '收藏', value: user.stats.favorites },
          { label: '优惠券', value: user.stats.coupons },
        ].map(({ label, value }) => (
          <div key={label} className="stat-item">
            <div className="font-bold text-lg text-[#6366f1]">{value}</div>
            <div className="text-xs text-[#6b7280]">{label}</div>
          </div>
        ))}
      </div>

      <ul className="list-none p-0 m-0">
        {[
          { key: 'orders', icon: <FileText size={14} />, label: '我的订单' },
          { key: 'address', icon: <MapPin size={14} />, label: '收货地址' },
          { key: 'settings', icon: <Settings size={14} />, label: '账号设置' },
        ].map(({ key, icon, label }) => (
          <li
            key={key}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#1e1b4b] cursor-pointer hover:bg-[#f5f4fc] transition-colors"
          >
            <span className="text-[#6b7280]">{icon}</span>
            {label}
          </li>
        ))}
      </ul>
    </Card>
  )
}
