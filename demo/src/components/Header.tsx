import { ShoppingCart } from 'lucide-react'
import { Button } from './ui/button'
import './Header.css'

interface HeaderProps {
  title: string
  cartCount: number
}

export function Header({ title, cartCount }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <h4 className="header-logo">
          <span className="header-icon">🎨</span>
          {title}
        </h4>
        <nav className="header-nav">
          <a className="nav-link active" href="#">首页</a>
          <a className="nav-link" href="#">分类</a>
          <a className="nav-link" href="#">优惠</a>
        </nav>
        <div className="relative">
          <Button className="flex items-center gap-1.5">
            <ShoppingCart size={16} />
            购物车
          </Button>
          {cartCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
              {cartCount}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
