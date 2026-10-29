// npm run seed
//
// 1. Always: the 5 warehouses and the first ADMIN (SEED_ADMIN_* in .env).
// 2. On an empty catalogue: realistic demo data, deterministic (fixed random seeds):
//    10 suppliers, 8 categories, 128 products, 2 managers, 5 employees (one per
//    warehouse), 1 viewer, and 12 months of stock history simulated day by day:
//    - weekly seasonality per category (weekend-heavy, weekday-heavy or flat)
//    - a gentle trend per product and festival bumps (Oct-Nov, Apr-May) for some
//    - slow movers, and "dead" products that stopped selling months ago
//    - restocking driven by supplier lead times; ~10% of reorders are missed, which
//      causes realistic stockouts (the forecast job treats those days as censored)
//    - customer returns, display samples, monthly stock-count adjustments
//    - completed, in-transit, approved, requested and cancelled transfers
//    History is inserted directly (fast), with each row's balanceAfter and frozen
//    unitCost computed by the simulation. Inventory.quantity is set to the ledger sums
//    and the consistency check at the end must pass.
//
// To start over: stop the API, delete prisma/dev.db*, then
//   npx prisma migrate deploy && npm run seed
import { fakerEN_IN as faker } from '@faker-js/faker'
import bcrypt from 'bcrypt'
import type {
  Prisma,
  Role,
  TransactionType,
  TransferStatus,
} from '../src/generated/prisma/client.js'
import { env } from '../src/config/env.js'
import { initDatabase, prisma } from '../src/config/prisma.js'
import { checkConsistency } from '../src/services/consistency.service.js'
import { BCRYPT_COST } from '../src/services/user.service.js'
import { decimal, roundCost, weightedAverageCost, type Decimal } from '../src/utils/money.js'

const WAREHOUSES = [
  {
    name: 'Hyderabad Central',
    code: 'HYD',
    city: 'Hyderabad',
    address: 'Plot 14, IDA Uppal, Hyderabad 500039',
  },
  {
    name: 'Bangalore North',
    code: 'BLR',
    city: 'Bangalore',
    address: 'KIADB Industrial Area, Hoskote, Bengaluru 562114',
  },
  {
    name: 'Mumbai Port',
    code: 'BOM',
    city: 'Mumbai',
    address: 'Bhiwandi Logistics Park, Thane 421302',
  },
  {
    name: 'Chennai South',
    code: 'MAA',
    city: 'Chennai',
    address: 'SIPCOT Industrial Park, Sriperumbudur 602105',
  },
  {
    name: 'Delhi NCR',
    code: 'DEL',
    city: 'Delhi',
    address: 'Sector 37, Bilaspur, Gurugram 122413',
  },
]

type Weekly = 'weekend' | 'weekday' | 'flat'
type CategorySpec = {
  name: string
  code: string
  weekly: Weekly
  bumpMonths: number[] // 0 = January
  cost: [number, number]
  margin: [number, number]
  brands: string[]
  items: string[]
}

const CATEGORIES: CategorySpec[] = [
  {
    name: 'Electronics',
    code: 'ELE',
    weekly: 'weekend',
    bumpMonths: [9, 10],
    cost: [250, 9000],
    margin: [1.18, 1.45],
    brands: ['boAt', 'Noise', 'Mi', 'Realme', 'Ambrane', 'Portronics', 'TP-Link', 'Syska'],
    items: [
      'Bluetooth Speaker',
      'Wireless Earbuds',
      'Power Bank 10000mAh',
      'Smart Watch',
      'USB-C Charger 65W',
      'LED Desk Lamp',
      'Wi-Fi Router',
      'Portable SSD 1TB',
      'Mechanical Keyboard',
      'Webcam 1080p',
      'HDMI Cable 2m',
      'Smart Plug',
      'ANC Headphones',
      'Fitness Band',
      'Extension Board 6-Socket',
      'Wireless Mouse',
    ],
  },
  {
    name: 'Home & Kitchen',
    code: 'HMK',
    weekly: 'weekend',
    bumpMonths: [9, 10],
    cost: [120, 3500],
    margin: [1.25, 1.6],
    brands: ['Prestige', 'Pigeon', 'Milton', 'Cello', 'Borosil', 'Butterfly', 'Bajaj', 'Solimo'],
    items: [
      'Non-Stick Tawa 28cm',
      'Pressure Cooker 5L',
      'Steel Water Bottle 1L',
      'Dinner Set 24pc',
      'Mixer Grinder 750W',
      'Electric Kettle 1.5L',
      'Storage Container Set',
      'Cotton Bedsheet Double',
      'Bath Towel Pack of 2',
      'Wall Clock',
      'Induction Cooktop',
      'Kadai with Lid',
      'Kitchen Knife Set',
      'Glass Tumbler Set',
      'Laundry Basket',
      'Coir Doormat',
    ],
  },
  {
    name: 'Groceries',
    code: 'GRC',
    weekly: 'weekend',
    bumpMonths: [],
    cost: [35, 750],
    margin: [1.12, 1.3],
    brands: [
      'Tata',
      'Aashirvaad',
      'Fortune',
      'Saffola',
      'Organic India',
      'Daawat',
      '24 Mantra',
      'Amul',
    ],
    items: [
      'Basmati Rice 5kg',
      'Toor Dal 1kg',
      'Sunflower Oil 1L',
      'Whole Wheat Atta 10kg',
      'Green Tea 100 Bags',
      'Instant Coffee 200g',
      'Almonds 500g',
      'Organic Jaggery 1kg',
      'Masala Oats 500g',
      'Honey 500g',
      'Cow Ghee 1L',
      'Peanut Butter 1kg',
      'Poha 1kg',
      'Rock Salt 1kg',
      'Turmeric Powder 200g',
      'Cashews 250g',
    ],
  },
  {
    name: 'Personal Care',
    code: 'PRC',
    weekly: 'flat',
    bumpMonths: [],
    cost: [45, 1600],
    margin: [1.3, 1.7],
    brands: ['Himalaya', 'Dove', 'Nivea', 'Mamaearth', 'Philips', 'Biotique', 'Parachute', 'WOW'],
    items: [
      'Aloe Vera Gel',
      'Herbal Shampoo 650ml',
      'Face Wash 150ml',
      'Sunscreen SPF 50',
      'Beard Oil',
      'Hair Dryer',
      'Body Lotion 400ml',
      'Toothpaste Pack of 3',
      'Electric Trimmer',
      'Hand Wash Refill',
      'Lip Balm',
      'Deodorant 150ml',
      'Shaving Foam',
      'Coconut Hair Oil 300ml',
      'Face Serum 30ml',
      'Bath Soap Pack of 4',
    ],
  },
  {
    name: 'Office Supplies',
    code: 'OFS',
    weekly: 'weekday',
    bumpMonths: [5],
    cost: [15, 2800],
    margin: [1.3, 1.8],
    brands: [
      'Classmate',
      'Kangaro',
      'Faber-Castell',
      'Camlin',
      'Casio',
      'Reynolds',
      'Luxor',
      'Deli',
    ],
    items: [
      'A4 Paper 500 Sheets',
      'Gel Pen Pack of 10',
      'Heavy Duty Stapler',
      'Sticky Notes Pack',
      'Whiteboard Marker Set',
      'File Folder Pack of 5',
      'Desk Organizer',
      'Chair Back Cushion',
      'Scientific Calculator',
      'Notebook A5 Pack of 4',
      'Highlighter Set',
      'A4 Laminator',
      'Paper Shredder',
      'Label Printer',
      'Correction Tape',
      'Document Tray',
    ],
  },
  {
    name: 'Sports & Fitness',
    code: 'SPF',
    weekly: 'weekend',
    bumpMonths: [3, 4],
    cost: [60, 6000],
    margin: [1.25, 1.6],
    brands: ['Nivia', 'Cosco', 'Kipsta', 'Yonex', 'SG', 'Boldfit', 'Strauss', 'Vector X'],
    items: [
      'Yoga Mat 6mm',
      'Dumbbell Set 10kg',
      'Skipping Rope',
      'English Willow Cricket Bat',
      'Football Size 5',
      'Badminton Racket',
      'Resistance Bands Set',
      'Cycling Helmet',
      'Gym Gloves',
      'Protein Shaker',
      'Tennis Balls Pack of 3',
      'Running Shoes',
      'Push-up Bars',
      'Swimming Goggles',
      'Ab Roller',
      'Sports Water Bottle',
    ],
  },
  {
    name: 'Toys & Games',
    code: 'TOY',
    weekly: 'weekend',
    bumpMonths: [9, 10],
    cost: [80, 4500],
    margin: [1.35, 1.8],
    brands: [
      'Funskool',
      'Hasbro',
      'Mattel',
      'Lego',
      'Hamleys',
      'Smartivity',
      'Skillmatics',
      'Toyshine',
    ],
    items: [
      'Building Blocks 500pc',
      'Remote Control Car',
      'Classic Board Game',
      'Jigsaw Puzzle 1000pc',
      'Teddy Bear 60cm',
      'Kids Art Set',
      'Speed Cube 3x3',
      'Doll House',
      'Toy Kitchen Set',
      'Science Experiment Kit',
      'UNO Card Game',
      'Water Blaster',
      'Wooden Train Set',
      'Magnetic Tiles 60pc',
      'Wooden Chess Set',
      'Kids Scooter',
    ],
  },
  {
    name: 'Apparel',
    code: 'APP',
    weekly: 'weekend',
    bumpMonths: [9, 10],
    cost: [120, 3200],
    margin: [1.5, 2.2],
    brands: ['Allen Solly', 'Fabindia', "Levi's", 'Puma', 'Jockey', 'Biba', 'Peter England', 'Max'],
    items: [
      'Cotton Crew T-Shirt',
      'Slim Fit Denim Jeans',
      'Cotton Kurta',
      'Pullover Hoodie',
      'Track Pants',
      'Formal Shirt',
      'Cotton Saree',
      'Ankle Socks Pack of 3',
      'Polo T-Shirt',
      'Ankle Leggings',
      'Padded Winter Jacket',
      'Baseball Cap',
      'Casual Shorts',
      'Printed Dupatta',
      'Fleece Sweatshirt',
      'Rain Jacket',
    ],
  },
]

const SUPPLIERS = [
  { name: 'Sri Venkateshwara Traders', leadTimeDays: 2, city: 'Hyderabad' },
  { name: 'Bharat Distributors', leadTimeDays: 3, city: 'Delhi' },
  { name: 'Coastal Supply Co.', leadTimeDays: 4, city: 'Chennai' },
  { name: 'Northern Wholesale Hub', leadTimeDays: 5, city: 'Ludhiana' },
  { name: 'Deccan Supply Chain', leadTimeDays: 6, city: 'Pune' },
  { name: 'Ganesh Enterprises', leadTimeDays: 7, city: 'Mumbai' },
  { name: 'Metro Import House', leadTimeDays: 8, city: 'Mumbai' },
  { name: 'Sunrise Agencies', leadTimeDays: 10, city: 'Ahmedabad' },
  { name: 'Kaveri Trading Co.', leadTimeDays: 12, city: 'Bengaluru' },
  { name: 'Himalayan Goods Pvt Ltd', leadTimeDays: 14, city: 'Dehradun' },
]

// One employee per warehouse, in WAREHOUSES order.
const EMPLOYEE_NAMES = ['Ravi Kumar', 'Ananya Rao', 'Imran Shaikh', 'Lakshmi Iyer', 'Vikram Singh']

const HISTORY_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------- Deterministic randomness

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(20261028)
const between = (min: number, max: number) => min + random() * (max - min)
const int = (min: number, max: number) => Math.floor(between(min, max + 1))
const chance = (p: number) => random() < p
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!
function sample<T>(items: readonly T[], count: number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy.slice(0, count)
}
function poisson(lambda: number) {
  if (lambda <= 0) return 0
  if (lambda > 40)
    return Math.max(
      0,
      Math.round(lambda + Math.sqrt(lambda) * (random() + random() + random() - 1.5) * 2),
    )
  const limit = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= random()
  } while (p > limit)
  return k - 1
}

// ---------------------------------------------------------------- Simulation types

type Profile = 'normal' | 'slow' | 'dead'

type ProductSim = {
  index: number
  id: number
  category: CategorySpec
  profile: Profile
  baseDemand: number // units per day, all warehouses combined
  trend: number // relative change over the year
  strongSeason: boolean
  deadFromDay: number // dead products stop selling on this day
  leadTimeDays: number
  costPrice: number
  avgCost: Decimal
  total: number // units in all warehouses (excludes stock in transit)
}

type PairSim = {
  product: ProductSim
  warehouse: number // index into WAREHOUSES
  share: number // share of the product's demand
  qty: number
  pending: { day: number; qty: number; cost: number }[]
  cooldown: number
}

type Row = Prisma.InventoryTransactionCreateManyInput & { transferRef?: number }

type PlannedTransfer = {
  ref: number
  from: number
  to: number
  status: TransferStatus
  dispatchDay: number | null
  receiveDay: number | null
  requestedAt: Date
  approvedAt: Date | null
  cancelledAt: Date | null
  items: { product: ProductSim; quantity: number; unitCost: Decimal | null }[]
  note: string
  id?: number
}

// Expected units per day for one warehouse (trend and festival bump, no weekday effect).
function expectedDaily(pair: PairSim, day: number) {
  const product = pair.product
  const month = new Date(Date.now() - (HISTORY_DAYS - day) * DAY_MS).getUTCMonth()
  let lambda = product.baseDemand * pair.share * (1 + product.trend * (day / HISTORY_DAYS - 0.5))
  if (product.category.bumpMonths.includes(month)) lambda *= product.strongSeason ? 2.8 : 1.5
  return lambda
}

function weekdayFactor(weekly: Weekly, day: number) {
  // 0 = Sunday ... 6 = Saturday
  if (weekly === 'weekend') return [1.35, 0.85, 0.85, 0.9, 0.95, 1.1, 1.4][day]!
  if (weekly === 'weekday') return [0.35, 1.2, 1.2, 1.15, 1.15, 1.1, 0.55][day]!
  return 1
}

const priceEnding = (value: number) => Math.max(9, Math.round(value / 10) * 10 - 1)

async function seedDemo(adminId: number) {
  faker.seed(2026)
  const start = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) -
      HISTORY_DAYS * DAY_MS,
  )
  const dateOf = (day: number) => new Date(start.getTime() + day * DAY_MS)
  // UTC minutes after midnight. 03:30 UTC = 09:00 IST, so the whole trading day stays on one date.
  const at = (day: number, minutes: number) =>
    new Date(start.getTime() + day * DAY_MS + minutes * 60_000 + int(0, 59) * 1000)

  // ------------------------------------------------------------ Reference data
  const warehouses = await prisma.warehouse.findMany({ orderBy: { id: 'asc' } })
  const warehouseIdByCode = new Map(warehouses.map((w) => [w.code, w.id]))
  const warehouseIds = WAREHOUSES.map((w) => warehouseIdByCode.get(w.code)!)

  const demoPassword = env.SEED_DEMO_PASSWORD ?? env.SEED_ADMIN_PASSWORD!
  const usedEmails = new Set<string>()
  const person = (role: Role, warehouseId: number | null, fixedName?: string) => {
    const name = fixedName ?? faker.person.fullName()
    const base = name
      .toLowerCase()
      .replace(/[^a-z]+/g, '.')
      .replace(/^\.|\.$/g, '')
    let email = `${base}@inventoryos.local`
    for (let n = 2; usedEmails.has(email); n++) email = `${base}${n}@inventoryos.local`
    usedEmails.add(email)
    return { name, email, role, warehouseId }
  }
  const people = [
    person('MANAGER', null, 'Priya Sharma'),
    person('MANAGER', null, 'Arjun Mehta'),
    ...warehouseIds.map((id, i) => person('EMPLOYEE', id, EMPLOYEE_NAMES[i])),
    person('VIEWER', null, 'Neha Kapoor'),
  ]
  const passwordHash = await bcrypt.hash(demoPassword, BCRYPT_COST)
  const users = await prisma.$transaction(async (tx) => {
    const created = []
    for (const p of people) {
      created.push(
        await tx.user.upsert({
          where: { email: p.email },
          update: {},
          create: { ...p, passwordHash },
        }),
      )
    }
    return created
  })
  const managers = users.filter((u) => u.role === 'MANAGER')
  const employeeOf = (warehouse: number) =>
    users.find((u) => u.warehouseId === warehouseIds[warehouse])!

  const { suppliers, categories } = await prisma.$transaction(async (tx) => {
    const suppliers = []
    for (const s of SUPPLIERS) {
      suppliers.push(
        await tx.supplier.create({
          data: {
            name: s.name,
            leadTimeDays: s.leadTimeDays,
            email: `orders@${s.name.toLowerCase().replace(/[^a-z]+/g, '')}.in`,
            phone: `+91 ${int(70000, 99999)} ${int(10000, 99999)}`,
            address: `${faker.location.streetAddress()}, ${s.city}`,
            rating: between(3.2, 4.9).toFixed(1),
          },
        }),
      )
    }
    const categories = []
    for (const c of CATEGORIES)
      categories.push(await tx.category.create({ data: { name: c.name } }))
    return { suppliers, categories }
  })

  // ------------------------------------------------------------ Products
  const productInputs: Prisma.ProductCreateManyInput[] = []
  const specs: Omit<ProductSim, 'id' | 'avgCost' | 'total'>[] = []
  CATEGORIES.forEach((category, c) => {
    category.items.forEach((item, i) => {
      const supplier = suppliers[(c * 3 + (i % 3)) % suppliers.length]!
      const costPrice =
        Math.round(
          Math.exp(between(Math.log(category.cost[0]), Math.log(category.cost[1]))) * 100,
        ) / 100
      const roll = random()
      const profile: Profile = roll < 0.08 ? 'dead' : roll < 0.24 ? 'slow' : 'normal'
      // Cheaper items sell more units.
      const baseDemand =
        profile === 'slow'
          ? between(0.05, 0.3)
          : Math.min(9, Math.max(0.6, (28 / Math.sqrt(costPrice / 40)) * between(0.5, 1.4)))
      const brand = pick(category.brands)
      specs.push({
        index: specs.length,
        category,
        profile,
        baseDemand,
        trend: between(-0.25, 0.35),
        strongSeason: category.bumpMonths.length > 0 && chance(0.2),
        deadFromDay: profile === 'dead' ? int(150, HISTORY_DAYS - 130) : HISTORY_DAYS + 1,
        leadTimeDays: supplier.leadTimeDays,
        costPrice,
      })
      const dailyPerWarehouse = baseDemand / 2
      productInputs.push({
        sku: `${category.code}-${String(i + 1).padStart(3, '0')}`,
        name: `${brand} ${item}`,
        description: faker.commerce.productDescription(),
        brand,
        categoryId: categories[c]!.id,
        supplierId: supplier.id,
        costPrice: costPrice.toFixed(4),
        avgCost: costPrice.toFixed(4),
        sellingPrice: priceEnding(
          costPrice * between(category.margin[0], category.margin[1]),
        ).toFixed(2),
        reorderLevel:
          profile === 'slow'
            ? int(1, 2)
            : Math.max(3, Math.round(dailyPerWarehouse * (supplier.leadTimeDays + 3))),
      })
    })
  })
  const createdProducts = await prisma.$transaction((tx) =>
    tx.product.createManyAndReturn({ data: productInputs }),
  )
  const products: ProductSim[] = specs.map((spec, i) => ({
    ...spec,
    id: createdProducts[i]!.id,
    avgCost: decimal(spec.costPrice),
    total: 0,
  }))

  // ------------------------------------------------------------ Where each product is stocked
  const pairs: PairSim[] = []
  const pairKey = (product: number, warehouse: number) => `${product}:${warehouse}`
  const pairMap = new Map<string, PairSim>()
  for (const product of products) {
    const count =
      product.profile === 'slow' ? int(1, 2) : int(1, 3) + (product.baseDemand > 4 ? 1 : 0)
    const chosen = sample([0, 1, 2, 3, 4], Math.min(count, 5))
    const weights = chosen.map(() => between(0.6, 1.4))
    const sum = weights.reduce((a, b) => a + b, 0)
    chosen.forEach((warehouse, i) => {
      const pair: PairSim = {
        product,
        warehouse,
        share: weights[i]! / sum,
        qty: 0,
        pending: [],
        cooldown: 0,
      }
      pairs.push(pair)
      pairMap.set(pairKey(product.index, warehouse), pair)
    })
  }
  const getPair = (product: ProductSim, warehouse: number) => {
    const key = pairKey(product.index, warehouse)
    let pair = pairMap.get(key)
    if (!pair) {
      pair = { product, warehouse, share: 0, qty: 0, pending: [], cooldown: 0 }
      pairs.push(pair)
      pairMap.set(key, pair)
    }
    return pair
  }

  // ------------------------------------------------------------ Transfers plan
  const normalPairs = pairs.filter((p) => p.product.profile === 'normal')
  const transfers: PlannedTransfer[] = []
  const planTransfer = (status: TransferStatus, dispatchDay: number | null) => {
    const source = pick(normalPairs)
    const from = source.warehouse
    const to = pick([0, 1, 2, 3, 4].filter((w) => w !== from))
    const candidates = normalPairs.filter((p) => p.warehouse === from)
    const items = sample(candidates, int(1, 3)).map((p) => ({
      product: p.product,
      quantity: int(3, 12),
      unitCost: null,
    }))
    const anchor = dispatchDay ?? HISTORY_DAYS
    const requestedAt =
      dispatchDay === null
        ? new Date(Date.now() - int(2, 30) * 3_600_000)
        : at(anchor - int(2, 4), int(240, 600))
    transfers.push({
      ref: transfers.length,
      from,
      to,
      status,
      dispatchDay,
      receiveDay: status === 'RECEIVED' && dispatchDay !== null ? dispatchDay + int(2, 4) : null,
      requestedAt,
      approvedAt:
        status === 'REQUESTED' || (status === 'CANCELLED' && chance(0.5))
          ? null
          : dispatchDay === null
            ? new Date(requestedAt.getTime() + int(1, 3) * 3_600_000)
            : at(anchor - 1, int(240, 600)),
      cancelledAt:
        status === 'CANCELLED' ? new Date(requestedAt.getTime() + int(4, 20) * 3_600_000) : null,
      items,
      note: pick([
        `Rebalance stock for ${WAREHOUSES[to]!.city} demand`,
        `Festival demand at ${WAREHOUSES[to]!.city}`,
        `Low stock at ${WAREHOUSES[to]!.code}`,
        `Clear excess from ${WAREHOUSES[from]!.code}`,
      ]),
    })
  }
  for (let i = 0; i < 16; i++) planTransfer('RECEIVED', int(30, HISTORY_DAYS - 8))
  for (let i = 0; i < 2; i++) planTransfer('IN_TRANSIT', HISTORY_DAYS - int(1, 2))
  for (let i = 0; i < 2; i++) planTransfer('CANCELLED', null)
  // Approved and requested transfers are planned after the simulation (no stock moves).
  const dispatchOn = new Map<number, PlannedTransfer[]>()
  const receiveOn = new Map<number, PlannedTransfer[]>()
  for (const t of transfers) {
    if (t.dispatchDay !== null)
      dispatchOn.set(t.dispatchDay, [...(dispatchOn.get(t.dispatchDay) ?? []), t])
    if (t.receiveDay !== null)
      receiveOn.set(t.receiveDay, [...(receiveOn.get(t.receiveDay) ?? []), t])
  }

  // ------------------------------------------------------------ Day-by-day simulation
  const rows: Row[] = []
  let poNumber = 1000
  const purchaser = () => pick(managers).id

  const receive = (
    pair: PairSim,
    day: number,
    quantity: number,
    cost: Decimal,
    type: TransactionType,
    extra: Partial<Row>,
    minutes: number,
  ) => {
    const product = pair.product
    if (type === 'STOCK_IN' || type === 'PURCHASE') {
      product.avgCost = weightedAverageCost(product.total, product.avgCost, quantity, cost)
    }
    product.total += quantity
    pair.qty += quantity
    rows.push({
      productId: product.id,
      warehouseId: warehouseIds[pair.warehouse]!,
      type,
      quantityChange: quantity,
      unitCost: (type === 'STOCK_IN' || type === 'PURCHASE' || type === 'TRANSFER_IN'
        ? cost
        : product.avgCost
      ).toFixed(4),
      balanceAfter: pair.qty,
      userId: adminId,
      createdAt: at(day, minutes),
      ...extra,
    })
  }

  const issue = (
    pair: PairSim,
    day: number,
    quantity: number,
    type: TransactionType,
    extra: Partial<Row>,
    minutes: number,
    cost?: Decimal,
  ) => {
    const product = pair.product
    product.total -= quantity
    pair.qty -= quantity
    rows.push({
      productId: product.id,
      warehouseId: warehouseIds[pair.warehouse]!,
      type,
      quantityChange: -quantity,
      unitCost: (cost ?? product.avgCost).toFixed(4),
      balanceAfter: pair.qty,
      userId: employeeOf(pair.warehouse).id,
      createdAt: at(day, minutes),
      ...extra,
    })
  }

  // Opening stock on day 0.
  for (const pair of pairs) {
    const daily = pair.product.baseDemand * pair.share
    const quantity =
      pair.product.profile === 'slow'
        ? int(3, 8)
        : Math.max(
            6,
            Math.round(
              daily * (pair.product.leadTimeDays + (pair.product.profile === 'dead' ? 70 : 25)),
            ),
          )
    receive(
      pair,
      0,
      quantity,
      decimal(pair.product.costPrice),
      'STOCK_IN',
      { reason: 'Opening stock', userId: adminId },
      200,
    )
  }

  for (let day = 0; day < HISTORY_DAYS; day++) {
    const date = dateOf(day)
    const weekday = date.getUTCDay()
    const inflation = 1 + 0.04 * (day / HISTORY_DAYS)

    // 1. Purchase orders arriving (morning).
    for (const pair of pairs) {
      const arriving = pair.pending.filter((order) => order.day === day)
      if (arriving.length === 0) continue
      pair.pending = pair.pending.filter((order) => order.day !== day)
      for (const order of arriving) {
        receive(
          pair,
          day,
          order.qty,
          roundCost(decimal(order.cost)),
          'PURCHASE',
          {
            reference: `PO-${poNumber++}`,
            reason: 'Supplier delivery',
            userId: purchaser(),
          },
          int(240, 300),
        )
      }
    }

    // 2. Transfers arriving.
    for (const transfer of receiveOn.get(day) ?? []) {
      for (const item of transfer.items) {
        if (item.unitCost === null) continue
        receive(
          getPair(item.product, transfer.to),
          day,
          item.quantity,
          item.unitCost,
          'TRANSFER_IN',
          {
            transferRef: transfer.ref,
            reference: `TRF-${transfer.ref}`,
            userId: employeeOf(transfer.to).id,
          },
          int(310, 340),
        )
      }
    }

    // 3. Sales (the demand signal). Demand above the available stock is lost.
    for (const pair of pairs) {
      const product = pair.product
      if (pair.share === 0 || day >= product.deadFromDay) continue
      const lambda = expectedDaily(pair, day) * weekdayFactor(product.category.weekly, weekday)
      const sold = Math.min(poisson(lambda), pair.qty)
      if (sold === 0) continue
      issue(
        pair,
        day,
        sold,
        'SALE',
        { reference: `INV-${date.toISOString().slice(2, 10).replace(/-/g, '')}-${rows.length}` },
        int(360, 840),
      )

      if (sold >= 2 && chance(0.025)) {
        receive(
          pair,
          day,
          1,
          product.avgCost,
          'RETURN',
          {
            reason: pick(['Customer return', 'Wrong size', 'Changed mind']),
            userId: employeeOf(pair.warehouse).id,
          },
          int(850, 880),
        )
      }
    }

    // 4. Display samples / internal use, and monthly stock-count adjustments.
    for (const pair of pairs) {
      if (pair.qty >= 2 && chance(0.003)) {
        issue(
          pair,
          day,
          1,
          'STOCK_OUT',
          { reason: pick(['Display sample', 'Internal use', 'Sent for quality check']) },
          int(890, 900),
        )
      }
      if (date.getUTCDate() === 1 && chance(0.05)) {
        if (pair.qty >= 3 && chance(0.7)) {
          issue(
            pair,
            day,
            int(1, 2),
            'ADJUSTMENT',
            { reason: 'Damaged in storage (stock count)', userId: pick(managers).id },
            int(905, 915),
          )
        } else {
          receive(
            pair,
            day,
            1,
            pair.product.avgCost,
            'ADJUSTMENT',
            { reason: 'Found during stock count', userId: pick(managers).id },
            int(905, 915),
          )
        }
      }
    }

    // 5. Transfers leaving (evening). Items the source cannot cover are dropped.
    for (const transfer of dispatchOn.get(day) ?? []) {
      for (const item of transfer.items) {
        const source = getPair(item.product, transfer.from)
        item.quantity = Math.min(item.quantity, source.qty)
        if (item.quantity <= 0) continue
        item.unitCost = item.product.avgCost
        issue(
          source,
          day,
          item.quantity,
          'TRANSFER_OUT',
          { transferRef: transfer.ref, reference: `TRF-${transfer.ref}` },
          int(920, 940),
          item.unitCost,
        )
      }
      transfer.items = transfer.items.filter((item) => item.quantity > 0)
      if (transfer.items.length === 0) {
        transfer.status = 'CANCELLED'
        transfer.cancelledAt = at(day, 925)
        transfer.receiveDay = null
      }
    }

    // 6. Reorder decisions (end of day), based on supplier lead time.
    for (const pair of pairs) {
      const product = pair.product
      // Dead products stop being reordered a month before they stop selling.
      if (pair.share === 0 || (product.profile === 'dead' && day >= product.deadFromDay - 30))
        continue
      if (pair.cooldown > 0) {
        pair.cooldown--
        continue
      }
      // Plan for the demand expected when the order arrives (festival seasons included).
      const daily = Math.max(
        expectedDaily(pair, day),
        expectedDaily(pair, day + product.leadTimeDays),
      )
      const reorderPoint =
        product.profile === 'slow' ? 1 : Math.ceil(daily * (product.leadTimeDays + 4))
      const pending = pair.pending.reduce((sum, order) => sum + order.qty, 0)
      if (pair.qty + pending > reorderPoint) continue
      if (chance(0.08)) {
        pair.cooldown = int(3, 7) // a missed reorder: this is how stockouts happen
        continue
      }
      const quantity =
        product.profile === 'slow'
          ? int(3, 6)
          : Math.max(5, Math.round(daily * (product.leadTimeDays + 21)))
      pair.pending.push({
        day: day + product.leadTimeDays + int(0, 2),
        qty: quantity,
        cost: Math.round(product.costPrice * inflation * between(0.94, 1.08) * 100) / 100,
      })
    }
  }

  // Transfers waiting for approval or dispatch (no stock has moved yet).
  for (let i = 0; i < 2; i++) planTransfer('APPROVED', null)
  for (let i = 0; i < 3; i++) planTransfer('REQUESTED', null)

  // ------------------------------------------------------------ Write everything
  await prisma.$transaction(async (tx) => {
    for (const t of transfers) {
      const dispatchedAt =
        t.dispatchDay !== null && t.status !== 'CANCELLED' ? at(t.dispatchDay, 925) : null
      const receivedAt = t.receiveDay !== null ? at(t.receiveDay, 330) : null
      const created = await tx.stockTransfer.create({
        data: {
          fromWarehouseId: warehouseIds[t.from]!,
          toWarehouseId: warehouseIds[t.to]!,
          status: t.status,
          note: t.note,
          requestedById: employeeOf(t.from).id,
          approvedById: t.approvedAt ? pick(managers).id : null,
          approvedAt: t.approvedAt,
          dispatchedById: dispatchedAt ? employeeOf(t.from).id : null,
          dispatchedAt,
          receivedById: receivedAt ? employeeOf(t.to).id : null,
          receivedAt,
          cancelledById: t.cancelledAt ? pick(managers).id : null,
          cancelledAt: t.cancelledAt,
          createdAt: t.requestedAt,
          items: {
            create: t.items.map((item) => ({
              productId: item.product.id,
              quantity: item.quantity,
              unitCost: item.unitCost?.toFixed(4) ?? null,
            })),
          },
        },
      })
      t.id = created.id
    }
  })
  const transferId = new Map(transfers.map((t) => [t.ref, t.id!]))

  const ledger = rows
    .map(({ transferRef, ...row }) => ({
      ...row,
      ...(transferRef !== undefined && {
        transferId: transferId.get(transferRef)!,
        reference: `TRF-${transferId.get(transferRef)}`,
      }),
    }))
    .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ledger.length; i += 2000) {
      await tx.inventoryTransaction.createMany({ data: ledger.slice(i, i + 2000) })
    }
    await tx.inventory.createMany({
      data: pairs.map((pair) => ({
        productId: pair.product.id,
        warehouseId: warehouseIds[pair.warehouse]!,
        quantity: pair.qty,
      })),
    })
    for (const product of products) {
      await tx.product.update({
        where: { id: product.id },
        data: { avgCost: product.avgCost.toFixed(4) },
      })
    }
  })

  // ------------------------------------------------------------ Sample notifications and audit
  const lowPairs = pairs
    .filter(
      (pair) =>
        pair.share > 0 && pair.qty <= (productInputs[pair.product.index]!.reorderLevel ?? 0),
    )
    .slice(0, 8)
  await prisma.$transaction(async (tx) => {
    const recipients = [adminId, ...managers.map((m) => m.id)]
    for (const [i, pair] of lowPairs.entries()) {
      const product = productInputs[pair.product.index]!
      const out = pair.qty === 0
      for (const userId of recipients) {
        await tx.notification.create({
          data: {
            userId,
            type: out ? 'OUT_OF_STOCK' : 'LOW_STOCK',
            title: `${out ? 'Out of stock' : 'Low stock'}: ${product.name}`,
            message: out
              ? `${WAREHOUSES[pair.warehouse]!.name} has no ${product.sku} left.`
              : `${WAREHOUSES[pair.warehouse]!.name} has ${pair.qty} left (reorder level ${product.reorderLevel}).`,
            data: {
              productId: pair.product.id,
              warehouseId: warehouseIds[pair.warehouse],
              quantity: pair.qty,
            },
            createdAt: new Date(Date.now() - (i + 1) * 5 * 3_600_000),
            readAt: i >= 4 ? new Date(Date.now() - i * 3_600_000) : null,
          },
        })
      }
    }
    for (const t of transfers.filter((t) => t.status === 'REQUESTED')) {
      for (const manager of managers) {
        await tx.notification.create({
          data: {
            userId: manager.id,
            type: 'TRANSFER',
            title: `Transfer #${t.id} needs approval`,
            message: `${employeeOf(t.from).name} requested ${t.items.length} item(s) from ${WAREHOUSES[t.from]!.code} to ${WAREHOUSES[t.to]!.code}.`,
            data: { transferId: t.id },
            createdAt: t.requestedAt,
          },
        })
      }
    }
    await tx.auditLog.create({
      data: {
        userId: adminId,
        action: 'seed.demoData',
        entity: 'System',
        entityId: 'seed',
        after: {
          products: products.length,
          transactions: ledger.length,
          transfers: transfers.length,
          users: users.length,
        },
      },
    })
  })

  return {
    users,
    products: products.length,
    transactions: ledger.length,
    transfers: transfers.length,
    demoPassword,
  }
}

async function main() {
  const email = env.SEED_ADMIN_EMAIL?.toLowerCase()
  const password = env.SEED_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env first')
  }

  await initDatabase()
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const admin = await prisma.$transaction(async (tx) => {
    for (const warehouse of WAREHOUSES) {
      await tx.warehouse.upsert({
        where: { code: warehouse.code },
        update: { address: warehouse.address },
        create: warehouse,
      })
    }
    return tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name: env.SEED_ADMIN_NAME ?? 'System Admin', role: 'ADMIN', passwordHash },
    })
  })

  let demo: Awaited<ReturnType<typeof seedDemo>> | null = null
  if ((await prisma.product.count()) === 0) {
    console.log('Generating 12 months of demo data...')
    demo = await seedDemo(admin.id)
  } else {
    console.log(
      'Demo data already present (products exist); only the admin and warehouses were checked.',
    )
  }

  const report = await checkConsistency()
  console.log(
    `Warehouses: ${await prisma.warehouse.count()}, users: ${await prisma.user.count()}, ` +
      `products: ${await prisma.product.count()}, transactions: ${await prisma.inventoryTransaction.count()}, ` +
      `transfers: ${await prisma.stockTransfer.count()}`,
  )
  console.log(
    `Consistency check: ${report.ok ? `OK (${report.checkedPairs} stock records)` : `FAILED (${report.mismatches.length} mismatches)`}`,
  )
  if (!report.ok) process.exitCode = 1

  if (env.NODE_ENV === 'development') {
    console.log('\nDemo logins (development only):')
    const warehouseCodes = new Map((await prisma.warehouse.findMany()).map((w) => [w.id, w.code]))
    console.log(`  ADMIN     ${email} / ${password}`)
    for (const user of demo?.users ?? []) {
      const code = warehouseCodes.get(user.warehouseId ?? -1)
      const where = code ? ` (${code})` : ''
      console.log(`  ${user.role.padEnd(9)} ${user.email} / ${demo!.demoPassword}${where}`)
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
