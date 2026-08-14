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
  paymentMethods: PaymentMethod[];
};

export type PaymentMethod = {
  id: string;
  type: "duitnow_qr" | "tng_qr" | "bank_transfer";
  name: string;
  active: boolean;
  instructions?: string | null;
  qrImage?: string | null;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  sortOrder?: number;
};

export type PaymentReceipt = {
  id: string;
  status: "submitted" | "verified" | "rejected" | string;
  paymentMethodId: string;
  paymentMethodName?: string;
  customerReference?: string | null;
  customerNote?: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
};

export type StaffMember = {
  id: string;
  username: string;
  email?: string | null;
  fullName: string;
  status: "active" | "disabled" | string;
  permissions: string[];
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
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
  permissions?: string[];
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
  referralCode?: string | null;
  referralDiscount?: number;
  lines?: OrderLine[];
  items?: string;
  paymentReceipt?: PaymentReceipt | null;
};

export type ReferralLink = {
  id: string;
  code: string;
  name: string;
  referrerUserId: string;
  referrerName?: string;
  referrerEmail?: string;
  discountPercent: number;
  discountScope: "none" | "first_purchase" | "every_purchase" | string;
  commissionPercent: number;
  attributionDays: number;
  active: boolean;
  startsAt?: string;
  endsAt?: string;
  visits?: number;
  downlines?: number;
  paidOrders?: number;
  paidRevenue?: number;
  pendingCommission?: number;
  approvedCommission?: number;
  paidCommission?: number;
};

export type ReferralCommission = {
  id: string;
  code: string;
  orderId: string;
  orderNumber: string;
  referrerName: string;
  customerName: string;
  basis: number;
  ratePercent: number;
  amount: number;
  status: "pending" | "approved" | "paid" | "void" | string;
  note?: string | null;
  createdAt: string;
  approvedAt?: string;
  paidAt?: string;
};

export type CustomerReferralCommission = {
  id: string;
  code: string;
  orderId: string;
  orderNumber: string;
  basis: number;
  ratePercent: number;
  amount: number;
  status: "pending" | "approved" | "paid" | "void" | string;
  note?: string | null;
  createdAt: string;
  approvedAt?: string;
  paidAt?: string;
};

export type CustomerReferralDashboard = {
  links: ReferralLink[];
  commissions: CustomerReferralCommission[];
  totals: {
    pending: number;
    approved: number;
    paid: number;
    earned: number;
  };
};

export type ReferralOffer = {
  code: string;
  name: string;
  referrerName: string;
  discountPercent: number;
  discountScope: "none" | "first_purchase" | "every_purchase" | string;
  attributionDays: number;
  message: string;
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
  paymentMethods?: PaymentMethod[];
};
