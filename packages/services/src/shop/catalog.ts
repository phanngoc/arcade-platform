// Danh mục SKU (CONTRACT.md). Giá VND. Không có hộp ngẫu nhiên, không bán cấp quân.
export type Limit = 'once' | 'day' | 'week' | 'account' | 'season' | 'none'
export type Sku = {
  sku: string; game: 'castle' | 'tank'; price: number
  kind: 'cosmetic' | 'boost' | 'cosmetic+boost'; label: string; limit: Limit; needsUnit?: boolean
}

export const SEASON = 's1'

export const CATALOG: Sku[] = [
  { sku: 'castle.skin.ice', game: 'castle', price: 29000, kind: 'cosmetic', label: 'Skin Gạch Băng', limit: 'once' },
  { sku: 'castle.skin.redstone', game: 'castle', price: 39000, kind: 'cosmetic', label: 'Skin Đá Đỏ', limit: 'once' },
  { sku: 'castle.skin.bamboo', game: 'castle', price: 49000, kind: 'cosmetic', label: 'Skin Tre Làng', limit: 'once' },
  { sku: 'castle.pass.s1', game: 'castle', price: 59000, kind: 'cosmetic+boost', label: 'Pass Cờ Hiệu Plus (28 ngày)', limit: 'season' },
  { sku: 'castle.gold.daily', game: 'castle', price: 15000, kind: 'boost', label: 'Gói vàng ngày (1.500 vàng)', limit: 'day' },
  { sku: 'castle.cards.pick', game: 'castle', price: 20000, kind: 'boost', label: '50 thẻ cho quân tự chọn', limit: 'week', needsUnit: true },
  { sku: 'castle.starter', game: 'castle', price: 25000, kind: 'boost', label: 'Gói khởi đầu (2.000 vàng, 100 thẻ, skin Gạch Băng)', limit: 'account', needsUnit: true },
  { sku: 'tank.skin.jade', game: 'tank', price: 19000, kind: 'cosmetic', label: 'Skin Ngọc Bích', limit: 'once' },
  { sku: 'tank.skin.gold', game: 'tank', price: 29000, kind: 'cosmetic', label: 'Skin Vàng', limit: 'once' },
  { sku: 'tank.pass.coop', game: 'tank', price: 39000, kind: 'cosmetic', label: 'Pass co-op (28 ngày)', limit: 'season' },
  { sku: 'tank.room.festival', game: 'tank', price: 29000, kind: 'cosmetic', label: 'Phòng Lễ Hội', limit: 'none' },
]

export const LIMIT_MAX: Record<Limit, number> = { once: 1, day: 1, week: 3, account: 1, season: 1, none: Infinity }

export const findSku = (sku: unknown) => CATALOG.find((s) => s.sku === sku)
