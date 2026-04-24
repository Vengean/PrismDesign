import { ShoppingCart } from 'lucide-react'
import { Card } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import './ProductCard.css'

interface ProductCardProps {
  title: string
  price: number
  image: string
  tag: string
  onAddCart: () => void
}

export function ProductCard({ title, price, image, tag, onAddCart }: ProductCardProps) {
  return (
    <Card className="product-card overflow-hidden">
      <div className="product-image">
        {tag && <Badge className="product-tag">{tag}</Badge>}
        <span className="product-emoji">{image}</span>
      </div>
      <div className="p-4">
        <span className="product-title">{title}</span>
        <div className="product-bottom">
          <span className="product-price">¥{price}</span>
          <Button size="sm" onClick={onAddCart}>
            <ShoppingCart size={12} />
            加入购物车
          </Button>
        </div>
      </div>
    </Card>
  )
}
