export type ProductStoryImage = {
  id?: string;
  image: string;
  alt: string;
  eyebrow: string;
  title: string;
  copy: string;
  position?: string;
  sortOrder?: number;
};

export type Product = {
  id: string;
  slug?: string;
  name: string;
  shortName: string;
  price: number;
  badge: string;
  description: string;
  detail: string;
  ingredients: string;
  ritual: string;
  volume: string;
  image: string;
  editorial: string;
  editorialPosition?: string;
  texture: string;
  benefits: string[];
  storyImages: ProductStoryImage[];
  stock: number;
  active?: boolean;
  sortOrder?: number;
};

export type Slide = {
  id?: string;
  image: string;
  eyebrow: string;
  title: string;
  emphasis: string;
  copy: string;
  caption: string;
  tone: "dark" | "light";
  position: string;
  active?: boolean;
  sortOrder?: number;
};

export type GalleryItem = {
  id?: string;
  image: string;
  alt: string;
  caption: string;
  href: string;
  active?: boolean;
  sortOrder?: number;
};

export type StoreSettings = {
  storeName: string;
  supportEmail: string;
  whatsappDisplay: string;
  whatsappNumber: string;
  instagramHandle: string;
  instagramUrl: string;
  facebookUrl: string;
  announcement: string;
  shippingThreshold: number;
  shippingFee: number;
  currency: string;
  country: string;
};

export type BundleStep = {
  id: string;
  label: string;
  description?: string;
  productIds: string[];
  minSelections?: number;
  maxSelections?: number;
  sortOrder?: number;
};

export type Bundle = {
  id: string;
  slug?: string;
  name: string;
  title?: string;
  description: string;
  active?: boolean;
  discountType?: "none" | "fixed" | "percentage";
  discountValue?: number;
  steps: BundleStep[];
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: "customer" | "admin" | "superadmin" | string;
  mustChangePassword?: boolean;
};

export type AuthSession = { user: AuthUser | null; csrfToken?: string };

export type Address = {
  id?: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  postcode: string;
  state: string;
  country: string;
  isDefault?: boolean;
};

export type CustomerProfile = AuthUser & {
  birthDate?: string;
  marketingConsent?: boolean;
  addresses: Address[];
  createdAt?: string;
};

export type OrderLine = {
  id?: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  image?: string;
};

export type StoreOrder = {
  id: string;
  orderNumber?: string;
  createdAt: string;
  customerName?: string;
  customerEmail?: string;
  status: string;
  paymentStatus?: string;
  paymentMethod?: string;
  total: number;
  subtotal?: number;
  shipping?: number;
  discount?: number;
  lines?: OrderLine[];
  items?: string;
};

export type Promo = {
  id: string;
  code: string;
  description: string;
  type: "percentage" | "fixed" | "free_shipping" | string;
  value: number;
  minimumSpend?: number;
  maximumDiscount?: number;
  usageLimit?: number;
  perCustomerLimit?: number;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
  usageCount?: number;
};

export type Enquiry = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  channel?: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
  replies?: {
    id?: string;
    message: string;
    createdAt: string;
    author?: string;
  }[];
};

export type StorefrontPayload = {
  settings?: Partial<StoreSettings>;
  products?: Product[];
  slides?: Slide[];
  gallery?: GalleryItem[];
  bundles?: Bundle[];
};
