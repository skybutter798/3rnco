"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ImagePlus,
  LayoutDashboard,
  Link2,
  Leaf,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Trash2,
  Upload,
  Users,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  ApiError,
  apiRequest,
  errorMessage,
  uploadAdminImage,
} from "../lib/api";
import type {
  AuthSession,
  AuthUser,
  Bundle,
  CustomerProfile,
  Enquiry,
  Product,
  Promo,
  Slide,
  StoreOrder,
  StoreSettings,
  StaffMember,
  PaymentMethod,
  ReferralCommission,
  ReferralLink,
} from "../store-types";

type Props = {
  section: string;
  setSection: (section: string) => void;
  sessionUser: AuthUser | null;
  sessionChecked: boolean;
  onSession: (user: AuthUser | null) => void;
  settings: StoreSettings;
  setSettings: Dispatch<SetStateAction<StoreSettings>>;
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  slides: Slide[];
  setSlides: Dispatch<SetStateAction<Slide[]>>;
  bundles: Bundle[];
  setBundles: Dispatch<SetStateAction<Bundle[]>>;
  onStore: () => void;
};

type AdminCustomer = CustomerProfile & {
  orderCount?: number;
  totalSpent?: number;
  lastOrderAt?: string;
  status?: "active" | "disabled" | string;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  orders?: StoreOrder[];
  referralLinks?: ReferralLink[];
  referredBy?: { code: string; name: string; attributedAt?: string } | null;
};
type CustomerEditorDraft = AdminCustomer & { temporaryPassword: string };
type DashboardData = {
  revenue?: number;
  paidOrders?: number;
  averageOrderValue?: number;
  unitsSold?: number;
  customerCount?: number;
  openEnquiries?: number;
  recentOrders?: StoreOrder[];
};

const navItems = [
  ["Dashboard", LayoutDashboard],
  ["Orders", ShoppingBag],
  ["Products", Package],
  ["Sliders", SlidersHorizontal],
  ["Mix & Match", Sparkles],
  ["Customers", Users],
  ["Promo Codes", Tag],
  ["Referrals", Link2],
  ["Enquiries", MessageCircle],
  ["Staff Access", UserCog],
  ["Store Settings", Settings],
] as const;
type AdminSection = (typeof navItems)[number][0];

const blankProduct: Product = {
  id: "",
  slug: "",
  name: "",
  shortName: "",
  price: 0,
  badge: "",
  description: "",
  detail: "",
  ingredients: "",
  ritual: "",
  volume: "",
  image: "",
  editorial: "",
  editorialPosition: "50% 50%",
  texture: "",
  benefits: [],
  storyImages: [],
  stock: 0,
  active: true,
};

const blankSlide: Slide = {
  image: "",
  eyebrow: "",
  title: "",
  emphasis: "",
  copy: "",
  caption: "",
  tone: "dark",
  position: "center",
  active: true,
  sortOrder: 0,
};
const blankPromo: Promo = {
  id: "",
  code: "",
  description: "",
  type: "percentage",
  value: 0,
  minimumSpend: 0,
  maximumDiscount: 0,
  usageLimit: undefined,
  perCustomerLimit: undefined,
  active: true,
};
const blankReferral: ReferralLink = {
  id: "",
  code: "",
  name: "",
  referrerUserId: "",
  discountPercent: 15,
  discountScope: "first_purchase",
  commissionPercent: 15,
  attributionDays: 30,
  active: true,
};
const blankAdminAddress = {
  label: "Home", recipientName: "", phone: "", line1: "", line2: "", city: "",
  postcode: "", state: "Kuala Lumpur", country: "Malaysia", isDefault: true,
};
const blankAdminCustomer: CustomerEditorDraft = {
  id: "", email: "", fullName: "", phone: "", role: "customer", birthDate: "",
  marketingConsent: false, addresses: [], status: "active", temporaryPassword: "",
};
const adminMalaysiaStates = ["Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu"];

function listFrom<T>(value: unknown, keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys)
    if (Array.isArray(record[key])) return record[key] as T[];
  return [];
}

function itemFrom<T>(value: unknown, keys: string[]): T {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of keys)
      if (record[key] && typeof record[key] === "object")
        return record[key] as T;
  }
  return value as T;
}

function normalizeBundle(
  bundle:
    | Bundle
    | (Bundle & {
        steps?: Array<
          Bundle["steps"][number] & {
            options?: Array<string | { productId?: string; id?: string }>;
          }
        >;
      }),
): Bundle {
  return {
    ...bundle,
    steps: (bundle.steps || []).map((step) => ({
      ...step,
      productIds: step.productIds?.length
        ? step.productIds
        : (
            (
              step as {
                options?: Array<string | { productId?: string; id?: string }>;
              }
            ).options || []
          )
            .map((option) =>
              typeof option === "string"
                ? option
                : option.productId || option.id || "",
            )
            .filter(Boolean),
    })),
  };
}

export default function AdminDashboard(props: Props) {
  const {
    section,
    setSection,
    sessionUser,
    sessionChecked,
    onSession,
    settings,
    setSettings,
    products,
    setProducts,
    slides,
    setSlides,
    bundles,
    setBundles,
    onStore,
  } = props;
  const isAdmin = ["admin", "staff", "superadmin"].includes(sessionUser?.role || "");
  const isOwner = sessionUser?.role === "admin" || sessionUser?.role === "superadmin";
  const locked = !!sessionUser?.mustChangePassword;
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [referrals, setReferrals] = useState<ReferralLink[]>([]);
  const [commissions, setCommissions] = useState<ReferralCommission[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData>({});
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [productEditor, setProductEditor] = useState<Product | null>(null);
  const [slideEditor, setSlideEditor] = useState<Slide | null>(null);
  const [promoEditor, setPromoEditor] = useState<Promo | null>(null);
  const [referralEditor, setReferralEditor] = useState<ReferralLink | null>(null);
  const [customerEditor, setCustomerEditor] = useState<CustomerEditorDraft | null>(null);
  const [activeEnquiryId, setActiveEnquiryId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setLoading(true);
          setLoadError("");
        }
        return Promise.allSettled([
          apiRequest<unknown>("/admin/dashboard"),
          apiRequest<unknown>("/admin/settings"),
          apiRequest<unknown>("/admin/products"),
          apiRequest<unknown>("/admin/slides"),
          apiRequest<unknown>("/admin/bundles"),
          apiRequest<unknown>("/admin/orders"),
          apiRequest<unknown>("/admin/customers"),
          apiRequest<unknown>("/admin/promos"),
          apiRequest<unknown>("/admin/referrals"),
          apiRequest<unknown>("/admin/referral-commissions"),
          apiRequest<unknown>("/admin/enquiries"),
          isOwner ? apiRequest<unknown>("/admin/staff") : Promise.resolve({ staff: [] }),
        ]);
      })
      .then((results) => {
        if (cancelled) return;
        const [
          dashboardResult,
          settingsResult,
          productResult,
          slideResult,
          bundleResult,
          orderResult,
          customerResult,
          promoResult,
          referralResult,
          commissionResult,
          enquiryResult,
          staffResult,
        ] = results;
        setApiConnected(
          dashboardResult.status === "fulfilled" &&
            settingsResult.status === "fulfilled",
        );
        if (dashboardResult.status === "fulfilled")
          setDashboard(
            itemFrom<DashboardData>(dashboardResult.value, [
              "dashboard",
              "stats",
            ]),
          );
        if (settingsResult.status === "fulfilled")
          setSettings((current) => ({
            ...current,
            ...itemFrom<Partial<StoreSettings>>(settingsResult.value, [
              "settings",
            ]),
          }));
        if (productResult.status === "fulfilled") {
          const next = listFrom<Product>(productResult.value, [
            "products",
            "items",
          ]);
          setProducts(
            next.map((item) => ({
              ...item,
              price: Number(item.price),
              stock: Number(item.stock || 0),
            })),
          );
        }
        if (slideResult.status === "fulfilled")
          setSlides(listFrom<Slide>(slideResult.value, ["slides", "items"]));
        if (bundleResult.status === "fulfilled")
          setBundles(
            listFrom<Bundle>(bundleResult.value, ["bundles", "items"]).map(
              normalizeBundle,
            ),
          );
        if (orderResult.status === "fulfilled")
          setOrders(
            listFrom<StoreOrder>(orderResult.value, ["orders", "items"]),
          );
        if (customerResult.status === "fulfilled")
          setCustomers(
            listFrom<AdminCustomer>(customerResult.value, [
              "customers",
              "items",
            ]),
          );
        if (promoResult.status === "fulfilled")
          setPromos(listFrom<Promo>(promoResult.value, ["promos", "items"]));
        if (referralResult.status === "fulfilled")
          setReferrals(listFrom<ReferralLink>(referralResult.value, ["referrals", "items"]));
        if (commissionResult.status === "fulfilled")
          setCommissions(listFrom<ReferralCommission>(commissionResult.value, ["commissions", "items"]));
        if (enquiryResult.status === "fulfilled")
          setEnquiries(
            listFrom<Enquiry>(enquiryResult.value, ["enquiries", "items"]),
          );
        if (staffResult.status === "fulfilled") setStaff(listFrom<StaffMember>(staffResult.value, ["staff", "items"]));
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected")
          setLoadError(errorMessage(rejected.reason));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isAdmin, isOwner, setBundles, setProducts, setSettings, setSlides]);

  if (!sessionChecked)
    return (
      <AdminGate onStore={onStore}>
        <div className="admin-gate__loading">
          <Leaf /> Preparing the store…
        </div>
      </AdminGate>
    );
  if (!sessionUser || !isAdmin) return <AdminLogin onSession={onSession} onStore={onStore} />;

  const logout = async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      onSession(null);
      setSection("Store Settings");
    } catch (reason) {
      setLoadError(`Unable to sign out: ${errorMessage(reason)}`);
    }
  };

  const sectionPermission: Record<string, string> = { Dashboard: "dashboard", Orders: "orders", Products: "content", Sliders: "content", "Mix & Match": "content", Customers: "customers", "Promo Codes": "promos", Referrals: "referrals", Enquiries: "enquiries" };
  const canOpen = (label: string) => {
    if (label === "Staff Access") return isOwner && !locked;
    if (label === "Store Settings") return isOwner || locked;
    if (locked) return false;
    return isOwner || (sessionUser?.permissions || []).includes(sectionPermission[label] || "");
  };
  const selectedEnquiry =
    enquiries.find((enquiry) => enquiry.id === activeEnquiryId) ||
    enquiries[0] ||
    null;
  const filteredOrders = orders.filter((order) =>
    `${order.orderNumber || order.id} ${order.customerName || ""} ${order.customerEmail || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const refreshStorefront = async () => {
    try {
      const result = await apiRequest<{
        products?: Product[];
        slides?: Slide[];
        bundles?: Bundle[];
        settings?: Partial<StoreSettings>;
      }>("/storefront");
      if (result.products) setProducts(result.products);
      if (result.slides) setSlides(result.slides);
      if (result.bundles) setBundles(result.bundles.map(normalizeBundle));
      if (result.settings)
        setSettings((current) => ({ ...current, ...result.settings }));
    } catch {
      /* admin mutation already succeeded; storefront refresh can happen on reload */
    }
  };

  const saveProduct = async (draft: Product) => {
    const existing = products.find((product) => product.id === draft.id);
    const creating = !existing;
    const body: Record<string, unknown> = {
      ...(draft as unknown as Record<string, unknown>),
    };
    if (existing) body.expectedStock = Number(existing.stock);
    try {
      const result = await apiRequest<unknown>(
        creating ? "/admin/products" : `/admin/products/${draft.id}`,
        { method: creating ? "POST" : "PATCH", body },
      );
      const saved = itemFrom<Product>(result, ["product"]);
      setProducts((current) =>
        creating
          ? [...current, saved]
          : current.map((product) =>
              product.id === saved.id ? saved : product,
            ),
      );
      setProductEditor(null);
      setNotice(`${saved.name} saved.`);
      void refreshStorefront();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "INVENTORY_CHANGED") {
        await refreshStorefront();
        setProductEditor(null);
        setLoadError(
          "Inventory changed while this product was open. The latest stock has been loaded; reopen the product and apply the edit again.",
        );
      }
      throw reason;
    }
  };

  const deleteProduct = async (product: Product) => {
    if (locked || !window.confirm(`Remove ${product.name} from the catalogue?`))
      return;
    await apiRequest(`/admin/products/${product.id}`, { method: "DELETE" });
    setProducts((current) => current.filter((item) => item.id !== product.id));
    setNotice(`${product.name} removed.`);
  };

  const saveSlide = async (draft: Slide) => {
    const creating = !draft.id;
    const result = await apiRequest<unknown>(
      creating ? "/admin/slides" : `/admin/slides/${draft.id}`,
      {
        method: creating ? "POST" : "PATCH",
        body: draft as unknown as Record<string, unknown>,
      },
    );
    const saved = itemFrom<Slide>(result, ["slide"]);
    setSlides((current) =>
      creating
        ? [...current, saved]
        : current.map((slide) => (slide.id === saved.id ? saved : slide)),
    );
    setSlideEditor(null);
    setNotice("Slider saved.");
    void refreshStorefront();
  };

  const deleteSlide = async (slide: Slide) => {
    if (!slide.id || locked || !window.confirm("Remove this slider?")) return;
    await apiRequest(`/admin/slides/${slide.id}`, { method: "DELETE" });
    setSlides((current) => current.filter((item) => item.id !== slide.id));
    setNotice("Slider removed.");
  };

  const saveBundle = async (draft: Bundle) => {
    const result = await apiRequest<unknown>(`/admin/bundles/${draft.id}`, {
      method: "PATCH",
      body: draft as unknown as Record<string, unknown>,
    });
    const saved = normalizeBundle(itemFrom<Bundle>(result, ["bundle"]));
    setBundles((current) =>
      current.map((bundle) => (bundle.id === saved.id ? saved : bundle)),
    );
    setNotice(`${saved.name} has been updated.`);
    void refreshStorefront();
  };

  const savePromo = async (draft: Promo) => {
    const creating = !draft.id;
    const result = await apiRequest<unknown>(
      creating ? "/admin/promos" : `/admin/promos/${draft.id}`,
      {
        method: creating ? "POST" : "PATCH",
        body: draft as unknown as Record<string, unknown>,
      },
    );
    const saved = itemFrom<Promo>(result, ["promo"]);
    setPromos((current) =>
      creating
        ? [...current, saved]
        : current.map((promo) => (promo.id === saved.id ? saved : promo)),
    );
    setPromoEditor(null);
    setNotice(`${saved.code} saved.`);
  };

  const deletePromo = async (promo: Promo) => {
    if (locked || !window.confirm(`Delete ${promo.code}?`)) return;
    await apiRequest(`/admin/promos/${promo.id}`, { method: "DELETE" });
    setPromos((current) => current.filter((item) => item.id !== promo.id));
  };

  const saveReferral = async (draft: ReferralLink) => {
    const creating = !draft.id;
    const result = await apiRequest<unknown>(
      creating ? "/admin/referrals" : `/admin/referrals/${draft.id}`,
      { method: creating ? "POST" : "PATCH", body: draft as unknown as Record<string, unknown> },
    );
    const saved = itemFrom<ReferralLink>(result, ["referral"]);
    setReferrals((current) => creating ? [saved, ...current] : current.map((link) => link.id === saved.id ? saved : link));
    setReferralEditor(null);
    setNotice(`${saved.code} referral link saved.`);
  };

  const openCustomer = async (customer?: AdminCustomer) => {
    if (!customer) {
      setCustomerEditor({ ...blankAdminCustomer, addresses: [] });
      return;
    }
    setCustomerEditor({ ...customer, addresses: [...(customer.addresses || [])], temporaryPassword: "" });
    try {
      const result = await apiRequest<unknown>(`/admin/customers/${customer.id}`);
      const detailed = itemFrom<AdminCustomer>(result, ["customer"]);
      setCustomerEditor({ ...detailed, addresses: [...(detailed.addresses || [])], temporaryPassword: "" });
    } catch (reason) {
      setLoadError(errorMessage(reason));
      setCustomerEditor(null);
    }
  };

  const saveCustomer = async (draft: CustomerEditorDraft) => {
    const creating = !draft.id;
    const body = {
      fullName: draft.fullName, email: draft.email, phone: draft.phone || "", birthDate: draft.birthDate || null,
      status: draft.status || "active", marketingConsent: !!draft.marketingConsent,
      temporaryPassword: draft.temporaryPassword || undefined, addresses: draft.addresses,
    };
    const result = await apiRequest<unknown>(creating ? "/admin/customers" : `/admin/customers/${draft.id}`, {
      method: creating ? "POST" : "PATCH", body,
    });
    const saved = itemFrom<AdminCustomer>(result, ["customer"]);
    setCustomers((current) => creating ? [saved, ...current] : current.map((item) => item.id === saved.id ? saved : item));
    setCustomerEditor(null);
    setNotice(`${saved.fullName} customer account saved.`);
  };

  const deleteReferral = async (link: ReferralLink) => {
    if (locked || !window.confirm(`Disable referral link ${link.code}?`)) return;
    await apiRequest(`/admin/referrals/${link.id}`, { method: "DELETE" });
    setReferrals((current) => current.map((item) => item.id === link.id ? { ...item, active: false } : item));
    setNotice(`${link.code} has been disabled.`);
  };

  const updateCommission = async (commission: ReferralCommission, status: "paid" | "void") => {
    if (!window.confirm(status === "paid" ? `Mark ${commission.orderNumber} commission as paid?` : `Void commission for ${commission.orderNumber}?`)) return;
    const result = await apiRequest<unknown>(`/admin/referral-commissions/${commission.id}`, { method: "PATCH", body: { status } });
    const saved = itemFrom<ReferralCommission>(result, ["commission"]);
    setCommissions((current) => current.map((item) => item.id === saved.id ? saved : item));
    setNotice(`Commission for ${commission.orderNumber} marked ${status}.`);
  };

  const exportCommissions = () => {
    const cell = (value: unknown) => {
      const raw = String(value ?? "");
      const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [
      ["Order", "Referral", "Referrer", "Customer", "Basis MYR", "Rate %", "Commission MYR", "Status", "Created"],
      ...commissions.map((item) => [item.orderNumber, item.code, item.referrerName, item.customerName, item.basis.toFixed(2), item.ratePercent.toFixed(2), item.amount.toFixed(2), item.status, item.createdAt]),
    ];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "3rnco-referral-commissions.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const updateOrderStatus = async (order: StoreOrder, status: string) => {
    const result = await apiRequest<unknown>(`/admin/orders/${order.id}`, {
      method: "PATCH",
      body: { status },
    });
    const saved = itemFrom<StoreOrder>(result, ["order"]);
    setOrders((current) =>
      current.map((item) =>
        item.id === order.id ? { ...item, ...saved, status } : item,
      ),
    );
    setNotice(`${order.orderNumber || order.id} moved to ${status}.`);
  };

  const reviewReceipt = async (order: StoreOrder, status: "verified" | "rejected", reviewNote?: string) => {
    const receipt = order.paymentReceipt;
    if (!receipt) return;
    const result = await apiRequest<{ order?: StoreOrder; receipt?: StoreOrder["paymentReceipt"] }>(`/admin/payment-receipts/${receipt.id}`, { method: "PATCH", body: { status, reviewNote: reviewNote || null } });
    setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...(result.order || {}), status: status === "verified" ? "payment_confirmed" : item.status, paymentStatus: status === "verified" ? "confirmed" : item.paymentStatus, paymentReceipt: result.receipt || { ...receipt, status, reviewNote } } : item));
    setNotice(status === "verified" ? `${order.orderNumber || order.id} payment verified.` : "Receipt rejected; the customer can upload another one.");
  };

  const exportOrders = () => {
    const cell = (value: unknown) => {
      const raw = String(value ?? "");
      const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [
      ["Order", "Created", "Customer", "Email", "Total MYR", "Status"],
      ...filteredOrders.map((order) => [
        order.orderNumber || order.id,
        order.createdAt,
        order.customerName,
        order.customerEmail,
        Number(order.total).toFixed(2),
        order.status,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "3rnco-orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <button
          className="admin-logo"
          onClick={onStore}
          aria-label="Return to 3R&Co storefront"
        >
          <AdminBrand />
        </button>
        <div className="admin-store">
          <span>3R</span>
          <p>
            <b>{settings.storeName}</b>
            <small>Production store</small>
          </p>
          <ChevronDown size={15} />
        </div>
        <nav aria-label="Admin sections">
          {navItems.filter(([label]) => label !== "Staff Access" || isOwner).filter(([label]) => label !== "Store Settings" || isOwner || locked).map(([label, Icon]) => (
            <button
              className={section === label ? "is-active" : ""}
              onClick={() => canOpen(label) && setSection(label)}
              disabled={!canOpen(label)}
              aria-current={section === label ? "page" : undefined}
              title={
                !canOpen(label)
                  ? "Change the temporary password first"
                  : undefined
              }
              key={label}
            >
              <Icon size={18} />
              {label}
              {label === "Orders" && <b>{orders.length}</b>}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__bottom">
          <button onClick={onStore}>
            <Store size={17} />
            View storefront <ArrowUpRight size={14} />
          </button>
          <div>
            <span>
              {(sessionUser.fullName || "Admin")
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <p>
              <b>{sessionUser.fullName || "Admin"}</b>
              <small>{sessionUser.role}</small>
            </p>
          </div>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p>3R&Co / {section}</p>
            <span className={apiConnected ? "" : "is-offline"}>
              <i />{" "}
              {loading
                ? "Checking store API"
                : apiConnected
                  ? "Store API connected"
                  : "Store API unavailable"}
            </span>
          </div>
          <div>
            <button
              className="admin-search"
              onClick={() => setSection("Orders")}
              disabled={locked}
            >
              <Search size={16} /> Search orders
            </button>
            <button
              className="admin-icon"
              onClick={() => setSection("Enquiries")}
              disabled={locked}
              aria-label="Open enquiries"
            >
              <MessageCircle size={18} />
              {enquiries.length > 0 && <i />}
            </button>
            <button className="button button--light" onClick={logout}>
              <LogOut size={15} /> Sign out
            </button>
            <button className="button button--dark" onClick={onStore}>
              Open store <ArrowUpRight size={15} />
            </button>
          </div>
        </header>
        <div id="main-content" className="admin-content" tabIndex={-1}>
          {locked && (
            <div className="admin-lock-banner">
              <LockKeyhole />
              <div>
                <b>Secure this admin account before managing the store.</b>
                <p>
                  Change the temporary password in Store Settings. All other
                  management actions are locked until then.
                </p>
              </div>
            </div>
          )}
          {notice && (
            <p className="admin-notice" role="status">
              <Check size={15} />
              {notice}
              <button onClick={() => setNotice("")} aria-label="Dismiss">
                <X size={14} />
              </button>
            </p>
          )}
          {loadError && (
            <p className="form-alert" role="alert">
              {loadError}
            </p>
          )}
          {loading && (
            <p className="admin-loading">
              <Leaf /> Refreshing store data…
            </p>
          )}
          {section === "Dashboard" && (
            <DashboardView
              data={dashboard}
              orders={orders}
              customers={customers}
              enquiries={enquiries}
              settings={settings}
              products={products}
              slides={slides}
              bundles={bundles}
              onSection={setSection}
            />
          )}
          {section === "Orders" && (
            <>
              <AdminHeading
                eyebrow="Commerce"
                title="Orders"
                copy="Manage every order from manual payment confirmation through delivery."
              >
                <button
                  className="button button--dark"
                  onClick={exportOrders}
                  disabled={!filteredOrders.length}
                >
                  Export CSV <ArrowUpRight size={15} />
                </button>
              </AdminHeading>
              <div className="orders-toolbar">
                <label>
                  <Search size={17} />
                  <span className="sr-only">Search orders</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search order, customer or email"
                  />
                </label>
              </div>
              <AdminOrders
                orders={filteredOrders}
                locked={locked}
                onStatus={updateOrderStatus}
                onReceipt={reviewReceipt}
              />
            </>
          )}
          {section === "Products" && (
            <>
              <AdminHeading
                eyebrow="Catalogue"
                title="Products"
                copy="Edit product stories, pricing, stock, imagery and availability."
              >
                <button
                  className="button button--dark"
                  onClick={() => setProductEditor({ ...blankProduct })}
                  disabled={locked}
                >
                  <Plus size={16} />
                  Add product
                </button>
              </AdminHeading>
              {!products.length ? (
                <AdminEmpty
                  icon={<Package />}
                  title="No products yet."
                  copy="Add the first product to begin the catalogue."
                />
              ) : (
                <div className="inventory-grid">
                  {products.map((product) => (
                    <article key={product.id}>
                      <div className="inventory-image">
                        <img
                          src={product.image || product.editorial}
                          alt={product.name}
                        />
                        <span>
                          {product.active === false ? "Hidden" : product.badge}
                        </span>
                      </div>
                      <p>{product.volume}</p>
                      <h2>{product.name}</h2>
                      <div>
                        <strong>RM{Number(product.price).toFixed(2)}</strong>
                        <span className={product.stock < 12 ? "low-stock" : ""}>
                          {product.stock} in stock
                        </span>
                      </div>
                      <div className="admin-card-actions">
                        <button
                          onClick={() => setProductEditor(product)}
                          disabled={locked}
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          onClick={() => void deleteProduct(product)}
                          disabled={locked}
                        >
                          <Trash2 size={14} />
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {section === "Sliders" && (
            <>
              <AdminHeading
                eyebrow="Landing page"
                title="Hero sliders"
                copy="Control the main images, story order and headlines shown at the top of the store."
              >
                <button
                  className="button button--dark"
                  onClick={() =>
                    setSlideEditor({ ...blankSlide, sortOrder: slides.length })
                  }
                  disabled={locked}
                >
                  <Plus size={16} />
                  Add slider
                </button>
              </AdminHeading>
              {!slides.length ? (
                <AdminEmpty
                  icon={<SlidersHorizontal />}
                  title="No sliders yet."
                  copy="Add a slider to lead the landing page."
                />
              ) : (
                <div className="slider-admin-grid">
                  {slides.map((slide, index) => (
                    <article key={slide.id || `${slide.image}-${index}`}>
                      <img
                        src={slide.image}
                        alt=""
                        style={{ objectPosition: slide.position }}
                      />
                      <div>
                        <span>
                          0{index + 1} ·{" "}
                          {slide.active === false ? "Hidden" : slide.tone}
                        </span>
                        <h2>
                          {slide.title} <em>{slide.emphasis}</em>
                        </h2>
                        <p>{slide.copy}</p>
                        <div className="admin-card-actions">
                          <button
                            onClick={() => setSlideEditor(slide)}
                            disabled={locked}
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button
                            onClick={() => void deleteSlide(slide)}
                            disabled={locked}
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {section === "Mix & Match" && (
            <>
              <AdminHeading
                eyebrow="Curated sets"
                title="Gift & ritual set builder"
                copy="Preset every customer choice and apply an automatic fixed or percentage saving when a complete set is selected."
              />
              {bundles.length ? (
                <div className="bundle-admin-list">
                  {bundles.map((bundle) => (
                    <BundleAdminEditor
                      bundle={bundle}
                      products={products}
                      locked={locked}
                      onSave={saveBundle}
                      key={bundle.id}
                    />
                  ))}
                </div>
              ) : (
                <AdminEmpty
                  icon={<Sparkles />}
                  title="No sets are configured."
                  copy="Create a set through the store API, then choose its product options and automatic saving here."
                />
              )}
            </>
          )}
          {section === "Customers" && (
            <>
              <AdminHeading
                eyebrow="Community"
                title="Customers"
                copy="Create accounts, manage personal details and delivery addresses, reset access, and review every customer's commerce history."
              >
                <button className="button button--dark" onClick={() => void openCustomer()} disabled={locked}><Plus size={16} />Add customer</button>
              </AdminHeading>
              {!customers.length ? (
                <AdminEmpty
                  icon={<Users />}
                  title="No customers yet."
                  copy="New registrations will appear here automatically."
                />
              ) : (
                <div className="customer-list">
                  {customers.map((customer) => (
                    <article key={customer.id}>
                      <span>
                        {customer.fullName
                          .split(" ")
                          .map((part) => part[0])
                          .join("")
                          .slice(0, 2)}
                      </span>
                      <div>
                        <h3>{customer.fullName}</h3>
                        <p>
                          {customer.email} · {customer.phone || "No phone"}
                        </p>
                      </div>
                      <p>{customer.orderCount || 0} orders</p>
                      <strong>
                        RM{Number(customer.totalSpent || 0).toFixed(2)}
                      </strong>
                      <b>{customer.status || "active"}</b>
                      <button type="button" onClick={() => void openCustomer(customer)}><Pencil size={14} />Manage</button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {section === "Promo Codes" && (
            <>
              <AdminHeading
                eyebrow="Offers"
                title="Promo codes"
                copy="Create server-validated offers with clear limits and dates."
              >
                <button
                  className="button button--dark"
                  onClick={() => setPromoEditor({ ...blankPromo })}
                  disabled={locked}
                >
                  <Plus size={16} />
                  Create code
                </button>
              </AdminHeading>
              {!promos.length ? (
                <AdminEmpty
                  icon={<Tag />}
                  title="No promo codes."
                  copy="The store launches without any active promotion."
                />
              ) : (
                <div className="promo-list">
                  {promos.map((promo) => (
                    <article key={promo.id}>
                      <span>
                        <Tag size={18} />
                      </span>
                      <div>
                        <h3>{promo.code}</h3>
                        <p>{promo.description}</p>
                      </div>
                      <b className={promo.active ? "active" : "ended"}>
                        <i />
                        {promo.active ? "Active" : "Inactive"}
                      </b>
                      <p>{promo.usageCount || 0} uses</p>
                      <button
                        onClick={() => setPromoEditor(promo)}
                        disabled={locked}
                      >
                        Manage <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-danger"
                        onClick={() => void deletePromo(promo)}
                        disabled={locked}
                        aria-label={`Delete ${promo.code}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {section === "Referrals" && (
            <ReferralsView
              referrals={referrals}
              commissions={commissions}
              locked={locked}
              onCreate={() => setReferralEditor({ ...blankReferral, referrerUserId: customers[0]?.id || "" })}
              onEdit={setReferralEditor}
              onDisable={deleteReferral}
              onCommission={updateCommission}
              onExport={exportCommissions}
            />
          )}
          {section === "Enquiries" && (
            <>
              <AdminHeading
                eyebrow="Care queue"
                title="Enquiries"
                copy="Review customer questions and keep each handoff accountable."
              />
              {!enquiries.length ? (
                <AdminEmpty
                  icon={<MessageCircle />}
                  title="No enquiries."
                  copy="New care enquiries will arrive here."
                />
              ) : (
                <EnquiriesView
                  enquiries={enquiries}
                  selected={selectedEnquiry}
                  locked={locked}
                  onSelect={setActiveEnquiryId}
                  onChange={setEnquiries}
                  settings={settings}
                />
              )}
            </>
          )}
          {section === "Staff Access" && isOwner && (
            <StaffAccessView staff={staff} setStaff={setStaff} locked={locked} onNotice={setNotice} />
          )}
          {section === "Store Settings" && (
            <StoreSettingsView
              key={JSON.stringify(settings)}
              settings={settings}
              setSettings={setSettings}
              locked={locked}
              user={sessionUser}
              onSession={onSession}
              onNotice={setNotice}
            />
          )}
        </div>
      </section>
      {productEditor && (
        <ProductEditor
          product={productEditor}
          existingIds={products.map((product) => product.id)}
          onClose={() => setProductEditor(null)}
          onSave={saveProduct}
        />
      )}
      {slideEditor && (
        <SlideEditor
          slide={slideEditor}
          onClose={() => setSlideEditor(null)}
          onSave={saveSlide}
        />
      )}
      {promoEditor && (
        <PromoEditor
          promo={promoEditor}
          onClose={() => setPromoEditor(null)}
          onSave={savePromo}
        />
      )}
      {referralEditor && (
        <ReferralEditor
          referral={referralEditor}
          customers={customers}
          onClose={() => setReferralEditor(null)}
          onSave={saveReferral}
        />
      )}
      {customerEditor && (
        <CustomerEditor customer={customerEditor} onClose={() => setCustomerEditor(null)} onSave={saveCustomer} />
      )}
    </main>
  );
}

function AdminBrand() {
  return (
    <span className="brand-mark">
      <img
        className="brand-mark__image"
        src="/images/brand/3rnco-logo.png"
        width={294}
        height={157}
        alt="3R&Co"
      />
    </span>
  );
}
function AdminGate({
  children,
  onStore,
}: {
  children: React.ReactNode;
  onStore: () => void;
}) {
  return (
    <main className="admin-gate">
      <button className="admin-gate__back" onClick={onStore}>
        <ArrowLeft size={16} />
        Storefront
      </button>
      <div className="admin-gate__brand">
        <AdminBrand />
      </div>
      {children}
    </main>
  );
}

function AdminLogin({
  onSession,
  onStore,
}: {
  onSession: (user: AuthUser) => void;
  onStore: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<AuthSession>("/auth/login", {
        method: "POST",
        body: { email: username, password },
      });
      if (!result.user || !["admin", "superadmin"].includes(result.user.role)) {
        await apiRequest("/auth/logout", { method: "POST" });
        throw new Error("This account does not have admin access.");
      }
      onSession(result.user);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminGate onStore={onStore}>
      <section className="admin-login">
        <div className="admin-login__image">
          <img
            src="/images/generated-v3/body-oil-ritual-v3.webp"
            alt="A quiet 3R&Co body-care ritual"
          />
          <span>
            <Leaf />
            Private store management
          </span>
        </div>
        <div className="admin-login__form">
          <p className="eyebrow">3R&Co administration</p>
          <h1>Welcome back.</h1>
          <p>Sign in with your admin username and password.</p>
          <form onSubmit={submit}>
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <span className="password-field">
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            {error && (
              <p className="form-alert" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button--dark button--wide"
              disabled={busy}
            >
              {busy ? "Signing in…" : "Sign in securely"}
              <ArrowRight size={16} />
            </button>
          </form>
          <p className="admin-login__note">
            <ShieldCheck />
            Credentials are verified by the protected store service.
          </p>
        </div>
      </section>
    </AdminGate>
  );
}

function AdminHeading({
  eyebrow,
  title,
  copy,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="admin-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {children}
    </div>
  );
}
function AdminEmpty({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="admin-empty">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function DashboardView({
  data,
  orders,
  customers,
  enquiries,
  settings,
  products,
  slides,
  bundles,
  onSection,
}: {
  data: DashboardData;
  orders: StoreOrder[];
  customers: AdminCustomer[];
  enquiries: Enquiry[];
  settings: StoreSettings;
  products: Product[];
  slides: Slide[];
  bundles: Bundle[];
  onSection: (section: AdminSection) => void;
}) {
  const revenue = Number(data.revenue || 0);
  const paid = Number(
    data.paidOrders ||
      orders.filter(
        (order) =>
          !["pending", "awaiting_payment", "cancelled"].includes(
            order.status.toLowerCase(),
          ),
      ).length,
  );
  const aov = Number(data.averageOrderValue || (paid ? revenue / paid : 0));
  const units = Number(data.unitsSold || 0);
  const metrics: Array<[string, string, LucideIcon]> = [
    ["Collected revenue", `RM${revenue.toFixed(2)}`, BarChart3],
    ["Paid orders", String(paid), ShoppingBag],
    ["Average order value", `RM${aov.toFixed(2)}`, Sparkles],
    ["Units sold", String(units), Package],
  ];
  const controls: Array<{
    section: AdminSection;
    label: string;
    value: string;
    detail: string;
    icon: LucideIcon;
  }> = [
    {
      section: "Store Settings",
      label: "Top announcement",
      value: settings.announcement || "Not set",
      detail: "Edit the strip above the navigation",
      icon: MessageCircle,
    },
    {
      section: "Products",
      label: "Products",
      value: `${products.length} listed`,
      detail: `${products.reduce((sum, product) => sum + Number(product.stock || 0), 0)} units in stock`,
      icon: Package,
    },
    {
      section: "Sliders",
      label: "Hero sliders",
      value: `${slides.filter((slide) => slide.active !== false).length} active`,
      detail: "Edit imagery, copy and order",
      icon: SlidersHorizontal,
    },
    {
      section: "Mix & Match",
      label: "Gift & ritual sets",
      value: `${bundles.filter((bundle) => bundle.active !== false).length} active`,
      detail: "Preset choices and automatic savings",
      icon: Sparkles,
    },
  ];
  return (
    <>
      <AdminHeading
        eyebrow="Store overview"
        title="Dashboard"
        copy="Live totals and the main storefront controls in one place."
      />
      <div className="metric-grid">
        {metrics.map(([label, value, Icon]) => (
          <article key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value}</strong>
            <small>Live store data</small>
          </article>
        ))}
      </div>
      <section
        className="admin-control-panel"
        aria-labelledby="storefront-controls-title"
      >
        <div className="admin-control-panel__heading">
          <div>
            <p className="eyebrow">Quick edit</p>
            <h2 id="storefront-controls-title">Storefront controls</h2>
          </div>
          <p>Jump straight to the content customers see.</p>
        </div>
        <div className="admin-control-grid">
          {controls.map(({ section, label, value, detail, icon: Icon }) => (
            <button
              type="button"
              onClick={() => onSection(section)}
              key={section}
            >
              <span>
                <Icon size={17} />
              </span>
              <small>{label}</small>
              <strong>{value}</strong>
              <em>{detail}</em>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>
      {!orders.length ? (
        <AdminEmpty
          icon={<LayoutDashboard />}
          title="The store is ready."
          copy="Revenue, order and customer activity will build here from the first real order."
        />
      ) : (
        <div className="dashboard-live-grid">
          <article>
            <h2>Recent orders</h2>
            {orders.slice(0, 5).map((order) => (
              <button key={order.id} onClick={() => onSection("Orders")}>
                <span>{order.orderNumber || order.id}</span>
                <b>RM{Number(order.total).toFixed(2)}</b>
                <small>{order.status}</small>
              </button>
            ))}
          </article>
          <article>
            <h2>Community</h2>
            <strong>{data.customerCount || customers.length}</strong>
            <p>registered customers</p>
            <strong>
              {data.openEnquiries ||
                enquiries.filter((item) => item.status !== "closed").length}
            </strong>
            <p>open enquiries</p>
          </article>
        </div>
      )}
    </>
  );
}

function AdminOrders({
  orders,
  locked,
  onStatus,
  onReceipt,
}: {
  orders: StoreOrder[];
  locked: boolean;
  onStatus: (order: StoreOrder, status: string) => Promise<void>;
  onReceipt: (order: StoreOrder, status: "verified" | "rejected", note?: string) => Promise<void>;
}) {
  if (!orders.length)
    return (
      <AdminEmpty
        icon={<ShoppingBag />}
        title="No orders yet."
        copy="The first customer order will appear here."
      />
    );
  return (
    <div
      className="orders-table admin-orders-table"
      role="table"
      aria-label="Orders"
    >
      <div className="orders-table__head" role="row">
        <span>Order</span>
        <span>Customer</span>
        <span>Items</span>
        <span>Total</span>
        <span>Status</span>
        <span>Update</span>
      </div>
      {orders.map((order) => (
        <div role="row" key={order.id}>
          <span>
            <b>{order.orderNumber || order.id}</b>
            <small>
              {new Date(order.createdAt).toLocaleDateString("en-MY")}
            </small>
          </span>
          <span>
            <b>{order.customerName || "Customer"}</b>
            <small>{order.customerEmail || ""}</small>
          </span>
          <span>
            {order.lines
              ?.map((line) => `${line.name} ×${line.quantity}`)
              .join(", ") ||
              order.items ||
              "—"}
          </span>
          <span>
            <b>RM{Number(order.total).toFixed(2)}</b>
            <small>{order.paymentMethod || "manual confirmation"}</small>
          </span>
          <span>
            <Status status={order.status} />
          </span>
          <span>
            <select
              value={order.status}
              onChange={(event) => void onStatus(order, event.target.value)}
              disabled={locked}
              aria-label={`Update ${order.orderNumber || order.id}`}
            >
              <option value="pending_payment">Pending payment</option>
              <option value="payment_confirmed">Payment confirmed</option>
              <option value="processing">Processing</option>
              <option value="packing">Packing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
            {order.paymentReceipt?.status === "submitted" && <div className="receipt-review">
              <a href={`/api/v1/admin/payment-receipts/${encodeURIComponent(order.paymentReceipt.id)}/file`} target="_blank" rel="noreferrer">View receipt</a>
              <button type="button" onClick={() => void onReceipt(order, "verified")} disabled={locked}>Verify</button>
              <button type="button" onClick={() => { const note = window.prompt("Tell the customer why this receipt cannot be accepted:") || "Please upload a clearer or correct payment receipt."; void onReceipt(order, "rejected", note); }} disabled={locked}>Reject</button>
            </div>}
            {order.paymentReceipt && order.paymentReceipt.status !== "submitted" && <small className={`receipt-label receipt-label--${order.paymentReceipt.status}`}>Receipt {order.paymentReceipt.status}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span
      className={`status-badge status-badge--${status.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-")}`}
    >
      <i />
      {status.replaceAll("_", " ")}
    </span>
  );
}

const staffPermissionOptions = [
  ["dashboard", "Dashboard"], ["orders", "Orders & payment verification"], ["customers", "Customers"],
  ["content", "Products, sliders & Mix and Match"], ["promos", "Promo codes"], ["referrals", "Referral links & commissions"], ["enquiries", "Enquiries"],
] as const;

function PaymentMethodEditor({ method, disabled, onChange }: { method: PaymentMethod; disabled: boolean; onChange: (method: PaymentMethod) => void }) {
  const [uploading, setUploading] = useState(false);
  const uploadQr = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { onChange({ ...method, qrImage: await uploadAdminImage(file) }); } finally { setUploading(false); }
  };
  return <article className={method.active ? "is-active" : ""}>
    <header><div><CreditCardIcon type={method.type} /><span><b>{method.name}</b><small>{method.type === "bank_transfer" ? "Account details" : "Scan-to-pay QR"}</small></span></div><label className="switch-field"><input type="checkbox" checked={method.active} disabled={disabled} onChange={(event) => onChange({ ...method, active: event.target.checked })} /><span />{method.active ? "Active" : "Hidden"}</label></header>
    <div className="form-grid"><label>Customer label<input value={method.name} onChange={(event) => onChange({ ...method, name: event.target.value })} required /></label><label className="full">Payment instructions<textarea value={method.instructions || ""} onChange={(event) => onChange({ ...method, instructions: event.target.value })} placeholder="What the customer should do before uploading a receipt" /></label>
      {method.type !== "bank_transfer" ? <label className="full payment-qr-upload">QR image{method.qrImage && <img src={method.qrImage} alt="Current payment QR" />}<span><Upload size={15} />{uploading ? "Uploading…" : method.qrImage ? "Replace QR" : "Upload QR"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadQr(event.target.files?.[0])} /></span></label> : <><label>Bank name<input value={method.bankName || ""} onChange={(event) => onChange({ ...method, bankName: event.target.value })} /></label><label>Account name<input value={method.accountName || ""} onChange={(event) => onChange({ ...method, accountName: event.target.value })} /></label><label className="full">Account number<input value={method.accountNumber || ""} onChange={(event) => onChange({ ...method, accountNumber: event.target.value })} /></label></>}
    </div>
  </article>;
}

function CreditCardIcon({ type }: { type: PaymentMethod["type"] }) { return <span className="payment-method-icon">{type === "duitnow_qr" ? "DN" : type === "tng_qr" ? "TNG" : "BANK"}</span>; }

function StaffAccessView({ staff, setStaff, locked, onNotice }: { staff: StaffMember[]; setStaff: Dispatch<SetStateAction<StaffMember[]>>; locked: boolean; onNotice: (message: string) => void }) {
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ username: "", fullName: "", email: "", password: "", permissions: staffPermissionOptions.map(([key]) => key as string), status: "active" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const openCreate = () => { setEditing(null); setCreating(true); setDraft({ username: "", fullName: "", email: "", password: "", permissions: staffPermissionOptions.map(([key]) => key as string), status: "active" }); setError(""); };
  const openEdit = (member: StaffMember) => { setEditing(member); setCreating(false); setDraft({ username: member.username, fullName: member.fullName, email: member.email || "", password: "", permissions: member.permissions, status: member.status }); setError(""); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const path = editing ? `/admin/staff/${editing.id}` : "/admin/staff";
      const body = { ...draft, email: draft.email || null, password: draft.password || undefined };
      const result = await apiRequest<{ staff: StaffMember }>(path, { method: editing ? "PATCH" : "POST", body });
      setStaff((current) => editing ? current.map((item) => item.id === result.staff.id ? result.staff : item) : [result.staff, ...current]);
      setEditing(null); setCreating(false); onNotice(editing ? "Staff access updated." : "Staff account created with a temporary password.");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <>
    <AdminHeading eyebrow="Team access" title="Staff access" copy="Create individual sign-ins, choose what each teammate can manage, and disable access without sharing the owner account."><button className="button button--dark" onClick={openCreate} disabled={locked}><Plus size={16} />Create staff</button></AdminHeading>
    {(creating || editing) && <form className="staff-editor" onSubmit={save}>
      <div className="settings-section-heading"><div><p className="eyebrow">{editing ? "Edit access" : "New teammate"}</p><h2>{editing ? editing.fullName : "Create staff sign-in"}</h2></div><button type="button" onClick={() => { setEditing(null); setCreating(false); }}><X /></button></div>
      <div className="form-grid"><label>Username<input value={draft.username} disabled={!!editing} onChange={(event) => setDraft({ ...draft, username: event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "") })} minLength={3} required /></label><label>Full name<input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} required /></label><label>Email (optional)<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label><label>{editing ? "New temporary password (optional)" : "Temporary password"}<input type="password" minLength={8} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} required={!editing} /><small>8 or more characters. Staff must change it after first sign-in.</small></label>{editing && <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>}</div>
      <fieldset className="staff-permissions"><legend>Allowed sections</legend>{staffPermissionOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.permissions.includes(key)} onChange={(event) => setDraft({ ...draft, permissions: event.target.checked ? [...draft.permissions, key] : draft.permissions.filter((item) => item !== key) })} />{label}</label>)}</fieldset>
      {error && <p className="form-alert">{error}</p>}<button className="button button--dark" disabled={busy}>{busy ? "Saving…" : editing ? "Save staff access" : "Create staff account"}</button>
    </form>}
    {!staff.length ? <AdminEmpty icon={<UserCog />} title="No staff accounts." copy="Create a separate sign-in for teammates who help with orders, content or enquiries." /> : <div className="staff-list">{staff.map((member) => <article key={member.id}><span>{member.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><h3>{member.fullName}</h3><p>@{member.username}{member.email ? ` · ${member.email}` : ""}</p><small>{member.permissions.map((permission) => staffPermissionOptions.find(([key]) => key === permission)?.[1] || permission).join(" · ")}</small></div><b className={member.status === "active" ? "active" : "ended"}>{member.status}</b><button onClick={() => openEdit(member)}><Pencil size={14} />Edit access</button></article>)}</div>}
  </>;
}

function StoreSettingsView({
  settings,
  setSettings,
  locked,
  user,
  onSession,
  onNotice,
}: {
  settings: StoreSettings;
  setSettings: Dispatch<SetStateAction<StoreSettings>>;
  locked: boolean;
  user: AuthUser;
  onSession: (user: AuthUser) => void;
  onNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<unknown>("/admin/settings", {
        method: "PATCH",
        body: draft as unknown as Record<string, unknown>,
      });
      const saved = {
        ...draft,
        ...itemFrom<Partial<StoreSettings>>(result, ["settings"]),
      };
      setSettings(saved);
      setDraft(saved);
      onNotice("Store settings saved.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  if (user.role === "staff") return <><AdminHeading eyebrow="Account security" title="Set your staff password" copy="Replace the temporary password before opening your assigned sections." />{locked && <PasswordChange user={user} onSession={onSession} />}</>;
  return (
    <>
      <AdminHeading
        eyebrow="Configuration"
        title="Store settings"
        copy="Keep the announcement, contact, social and delivery details current."
      />
      {locked && <PasswordChange user={user} onSession={onSession} />}
      <form className="settings-production" onSubmit={save}>
        <section className="top-note-editor">
          <div className="settings-section-heading">
            <div>
              <p className="eyebrow">Landing page</p>
              <h2>Top announcement</h2>
            </div>
            <span>{draft.announcement.length}/240</span>
          </div>
          <p className="settings-section-copy">
            This message appears in the slim bar above the main navigation on
            desktop and mobile.
          </p>
          <label>
            Announcement text
            <input
              value={draft.announcement}
              maxLength={240}
              onChange={(event) =>
                setDraft({ ...draft, announcement: event.target.value })
              }
              placeholder="A quiet ritual, made for every body."
              required
            />
          </label>
          <div
            className="top-note-editor__preview"
            aria-label="Top announcement preview"
          >
            <Leaf size={13} />
            <span>{draft.announcement || "Your announcement preview"}</span>
          </div>
        </section>
        <section className="payment-settings">
          <div className="settings-section-heading"><div><p className="eyebrow">Manual verification</p><h2>Payment methods</h2></div><span>{(draft.paymentMethods || []).filter((method) => method.active).length} active</span></div>
          <p className="settings-section-copy">Customers see these destinations inside each pending order, then submit a private receipt for staff review.</p>
          <div className="payment-method-editor-list">
            {(draft.paymentMethods || []).map((method, index) => <PaymentMethodEditor key={method.id} method={method} disabled={locked} onChange={(next) => setDraft({ ...draft, paymentMethods: (draft.paymentMethods || []).map((item, itemIndex) => itemIndex === index ? next : item) })} />)}
          </div>
        </section>
        <section>
          <h2>Brand & contact</h2>
          <div className="form-grid">
            <label className="full">
              Store name
              <input
                value={draft.storeName}
                onChange={(event) =>
                  setDraft({ ...draft, storeName: event.target.value })
                }
                required
              />
            </label>
            <label>
              Support email
              <input
                type="email"
                value={draft.supportEmail}
                onChange={(event) =>
                  setDraft({ ...draft, supportEmail: event.target.value })
                }
                required
              />
            </label>
            <label>
              WhatsApp display
              <input
                value={draft.whatsappDisplay}
                onChange={(event) =>
                  setDraft({ ...draft, whatsappDisplay: event.target.value })
                }
                required
              />
            </label>
            <label>
              WhatsApp number
              <input
                inputMode="numeric"
                value={draft.whatsappNumber}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    whatsappNumber: event.target.value.replace(/\D/g, ""),
                  })
                }
                required
              />
            </label>
            <label>
              Instagram handle
              <input
                value={draft.instagramHandle}
                onChange={(event) =>
                  setDraft({ ...draft, instagramHandle: event.target.value })
                }
              />
            </label>
            <label className="full">
              Instagram URL
              <input
                type="url"
                value={draft.instagramUrl}
                onChange={(event) =>
                  setDraft({ ...draft, instagramUrl: event.target.value })
                }
              />
            </label>
            <label className="full">
              Facebook URL
              <input
                type="url"
                value={draft.facebookUrl}
                onChange={(event) =>
                  setDraft({ ...draft, facebookUrl: event.target.value })
                }
              />
            </label>
          </div>
        </section>
        <section>
          <h2>Delivery</h2>
          <div className="form-grid">
            <label>
              Complimentary from (RM)
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.shippingThreshold}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    shippingThreshold: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Standard fee (RM)
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.shippingFee}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    shippingFee: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Currency
              <input
                value={draft.currency}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    currency: event.target.value.toUpperCase(),
                  })
                }
              />
            </label>
            <label>
              Country
              <input
                value={draft.country}
                onChange={(event) =>
                  setDraft({ ...draft, country: event.target.value })
                }
              />
            </label>
          </div>
        </section>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <button className="button button--dark" disabled={locked || busy}>
          <Save size={16} />
          {busy ? "Saving…" : "Save store settings"}
        </button>
        {locked && (
          <p className="locked-help">
            <LockKeyhole size={15} />
            Change the temporary admin password above to enable store edits.
          </p>
        )}
      </form>
    </>
  );
}

function PasswordChange({
  user,
  onSession,
}: {
  user: AuthUser;
  onSession: (user: AuthUser) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<AuthSession | { user?: AuthUser }>(
        "/auth/change-password",
        { method: "POST", body: { currentPassword, newPassword } },
      );
      onSession({ ...(result.user || user), mustChangePassword: false });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="password-change">
      <div>
        <span>
          <LockKeyhole />
        </span>
        <div>
          <p className="eyebrow">Required first step</p>
          <h2>Choose a private admin password.</h2>
          <p>
            Store changes remain locked until this temporary password is
            replaced.
          </p>
        </div>
      </div>
      <form onSubmit={submit}>
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <button className="button button--dark" disabled={busy}>
          {busy ? "Securing account…" : "Change password & unlock"}
          <ShieldCheck size={16} />
        </button>
      </form>
    </section>
  );
}

function ProductEditor({
  product,
  existingIds,
  onClose,
  onSave,
}: {
  product: Product;
  existingIds: string[];
  onClose: () => void;
  onSave: (product: Product) => Promise<void>;
}) {
  const isNew = !existingIds.includes(product.id);
  const [draft, setDraft] = useState<Product>({
    ...product,
    storyImages: [...product.storyImages],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...draft,
        id:
          draft.id ||
          draft.slug ||
          draft.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
        slug: draft.slug || draft.id,
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const story = (index: number) =>
    draft.storyImages[index] || {
      image: "",
      alt: "",
      eyebrow: "",
      title: "",
      copy: "",
    };
  const setStory = (
    index: number,
    value: Partial<Product["storyImages"][number]>,
  ) => {
    const next = [...draft.storyImages];
    next[index] = { ...story(index), ...value };
    setDraft({ ...draft, storyImages: next });
  };
  return (
    <EditorShell
      title={isNew ? "Add product" : `Edit ${product.name}`}
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <div className="form-grid">
          <label>
            Product ID
            <input
              value={draft.id}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  id: event.target.value.toLowerCase().replace(/\s+/g, "-"),
                })
              }
              readOnly={!isNew}
              required
            />
          </label>
          <label>
            Short name
            <input
              value={draft.shortName}
              onChange={(event) =>
                setDraft({ ...draft, shortName: event.target.value })
              }
              required
            />
          </label>
          <label className="full">
            Product name
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              required
            />
          </label>
          <label>
            Price (RM)
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.price}
              onChange={(event) =>
                setDraft({ ...draft, price: Number(event.target.value) })
              }
              required
            />
          </label>
          <label>
            Stock
            <input
              type="number"
              min="0"
              value={draft.stock}
              onChange={(event) =>
                setDraft({ ...draft, stock: Number(event.target.value) })
              }
              required
            />
          </label>
          <label>
            Badge
            <input
              value={draft.badge}
              onChange={(event) =>
                setDraft({ ...draft, badge: event.target.value })
              }
            />
          </label>
          <label>
            Format / volume
            <input
              value={draft.volume}
              onChange={(event) =>
                setDraft({ ...draft, volume: event.target.value })
              }
            />
          </label>
          <label className="full">
            Card description
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              required
            />
          </label>
          <label className="full">
            Full product story
            <textarea
              value={draft.detail}
              onChange={(event) =>
                setDraft({ ...draft, detail: event.target.value })
              }
              required
            />
          </label>
          <label className="full">
            Ingredients
            <textarea
              value={draft.ingredients}
              onChange={(event) =>
                setDraft({ ...draft, ingredients: event.target.value })
              }
            />
          </label>
          <label className="full">
            Ritual instructions
            <textarea
              value={draft.ritual}
              onChange={(event) =>
                setDraft({ ...draft, ritual: event.target.value })
              }
            />
          </label>
          <label className="full">
            Texture
            <textarea
              value={draft.texture}
              onChange={(event) =>
                setDraft({ ...draft, texture: event.target.value })
              }
            />
          </label>
          <label className="full">
            Benefits (one per line)
            <textarea
              value={draft.benefits.join("\n")}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  benefits: event.target.value
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
        <div className="editor-media-grid">
          <ImageField
            label="Cart image"
            value={draft.image}
            onChange={(image) => setDraft({ ...draft, image })}
          />
          <ImageField
            label="Editorial card image"
            value={draft.editorial}
            onChange={(editorial) => setDraft({ ...draft, editorial })}
          />
          {[0, 1].map((index) => (
            <div className="story-image-editor" key={index}>
              <ImageField
                label={`Story image ${index + 1}`}
                value={story(index).image}
                onChange={(image) => setStory(index, { image })}
              />
              <label>
                Alt text
                <input
                  value={story(index).alt}
                  onChange={(event) =>
                    setStory(index, { alt: event.target.value })
                  }
                />
              </label>
              <label>
                Eyebrow
                <input
                  value={story(index).eyebrow}
                  onChange={(event) =>
                    setStory(index, { eyebrow: event.target.value })
                  }
                />
              </label>
              <label>
                Title
                <input
                  value={story(index).title}
                  onChange={(event) =>
                    setStory(index, { title: event.target.value })
                  }
                />
              </label>
              <label>
                Copy
                <textarea
                  value={story(index).copy}
                  onChange={(event) =>
                    setStory(index, { copy: event.target.value })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.active !== false}
            onChange={(event) =>
              setDraft({ ...draft, active: event.target.checked })
            }
          />
          Visible on the storefront
        </label>
        {error && <p className="form-alert">{error}</p>}
        <div className="editor-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button--dark" disabled={busy}>
            <Save size={15} />
            {busy ? "Saving…" : "Save product"}
          </button>
        </div>
      </form>
    </EditorShell>
  );
}

function SlideEditor({
  slide,
  onClose,
  onSave,
}: {
  slide: Slide;
  onClose: () => void;
  onSave: (slide: Slide) => Promise<void>;
}) {
  const [draft, setDraft] = useState(slide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave(draft);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorShell
      title={slide.id ? "Edit slider" : "Add slider"}
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <ImageField
          label="Slider image"
          value={draft.image}
          onChange={(image) => setDraft({ ...draft, image })}
        />
        <div className="form-grid">
          <label>
            Eyebrow
            <input
              value={draft.eyebrow}
              onChange={(event) =>
                setDraft({ ...draft, eyebrow: event.target.value })
              }
            />
          </label>
          <label>
            Image position
            <input
              value={draft.position}
              onChange={(event) =>
                setDraft({ ...draft, position: event.target.value })
              }
              placeholder="center"
            />
          </label>
          <label>
            Headline
            <input
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              required
            />
          </label>
          <label>
            Emphasis
            <input
              value={draft.emphasis}
              onChange={(event) =>
                setDraft({ ...draft, emphasis: event.target.value })
              }
              required
            />
          </label>
          <label className="full">
            Supporting copy
            <textarea
              value={draft.copy}
              onChange={(event) =>
                setDraft({ ...draft, copy: event.target.value })
              }
              required
            />
          </label>
          <label className="full">
            Caption
            <input
              value={draft.caption}
              onChange={(event) =>
                setDraft({ ...draft, caption: event.target.value })
              }
            />
          </label>
          <label>
            Tone
            <select
              value={draft.tone}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  tone: event.target.value as Slide["tone"],
                })
              }
            >
              <option value="dark">Dark image</option>
              <option value="light">Light image</option>
            </select>
          </label>
          <label>
            Sort order
            <input
              type="number"
              value={draft.sortOrder || 0}
              onChange={(event) =>
                setDraft({ ...draft, sortOrder: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.active !== false}
            onChange={(event) =>
              setDraft({ ...draft, active: event.target.checked })
            }
          />
          Visible on the storefront
        </label>
        {error && <p className="form-alert">{error}</p>}
        <div className="editor-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button--dark" disabled={busy}>
            <Save size={15} />
            {busy ? "Saving…" : "Save slider"}
          </button>
        </div>
      </form>
    </EditorShell>
  );
}

function BundleAdminEditor({
  bundle,
  products,
  locked,
  onSave,
}: {
  bundle: Bundle;
  products: Product[];
  locked: boolean;
  onSave: (bundle: Bundle) => Promise<void>;
}) {
  const [draft, setDraft] = useState(normalizeBundle(bundle));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (stepIndex: number, productId: string) => {
    const steps = draft.steps.map((step, index) =>
      index === stepIndex
        ? {
            ...step,
            productIds: step.productIds.includes(productId)
              ? step.productIds.filter((id) => id !== productId)
              : [...step.productIds, productId],
          }
        : step,
    );
    setDraft({ ...draft, steps });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.steps.some((step) => !step.productIds.length)) {
      setError("Choose at least one product for each step.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(draft);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="bundle-admin" onSubmit={save}>
      <div className="bundle-admin__heading">
        <div>
          <p className="eyebrow">Set preset</p>
          <h2>{bundle.name}</h2>
        </div>
        <span>{draft.active === false ? "Hidden" : "Live"}</span>
      </div>
      <div className="bundle-admin__intro">
        <label>
          Set name
          <input
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <label>
          Storefront headline
          <input
            value={draft.title || ""}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
        </label>
        <label className="full">
          Description
          <textarea
            value={draft.description}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
          />
        </label>
        <label>
          Automatic saving
          <select
            value={draft.discountType || "none"}
            onChange={(event) =>
              setDraft({
                ...draft,
                discountType: event.target.value as Bundle["discountType"],
                discountValue:
                  event.target.value === "none" ? 0 : draft.discountValue || 0,
              })
            }
          >
            <option value="none">No set saving</option>
            <option value="fixed">Fixed amount (RM)</option>
            <option value="percentage">Percentage (%)</option>
          </select>
        </label>
        <label>
          Saving value
          <input
            type="number"
            min="0"
            max={draft.discountType === "percentage" ? 100 : undefined}
            step="0.01"
            value={draft.discountValue || 0}
            onChange={(event) =>
              setDraft({ ...draft, discountValue: Number(event.target.value) })
            }
            disabled={!draft.discountType || draft.discountType === "none"}
          />
        </label>
        <p className="bundle-admin__help">
          Applied automatically only after the customer completes every step. No
          promo code is needed.
        </p>
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.active !== false}
            onChange={(event) =>
              setDraft({ ...draft, active: event.target.checked })
            }
          />
          Available on the storefront
        </label>
      </div>
      <div className="bundle-admin__steps">
        {draft.steps.map((step, index) => (
          <fieldset key={step.id}>
            <legend className="sr-only">Set step {index + 1}</legend>
            <div className="bundle-admin__step-head">
              <span><small>Step</small>{String(index + 1).padStart(2, "0")}</span>
              <div className="bundle-admin__step-fields">
                <label>
                  Customer-facing label
                  <input
                    value={step.label}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Short guidance
                  <input
                    value={step.description || ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        steps: draft.steps.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            </div>
            <div className="bundle-admin__products">
              {products.map((product) => (
                <label
                  className={
                    step.productIds.includes(product.id) ? "is-selected" : ""
                  }
                  key={product.id}
                >
                  <input
                    type="checkbox"
                    checked={step.productIds.includes(product.id)}
                    onChange={() => toggle(index, product.id)}
                  />
                  <img src={product.image || product.editorial} alt="" />
                  <span>
                    <b>{product.name}</b>
                    <small>RM{Number(product.price).toFixed(2)}</small>
                  </span>
                  <Check />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {error && <p className="form-alert">{error}</p>}
      <button className="button button--dark" disabled={locked || busy}>
        <Save size={16} />
        {busy ? "Saving…" : `Save ${draft.name}`}
      </button>
    </form>
  );
}

function ReferralsView({
  referrals,
  commissions,
  locked,
  onCreate,
  onEdit,
  onDisable,
  onCommission,
  onExport,
}: {
  referrals: ReferralLink[];
  commissions: ReferralCommission[];
  locked: boolean;
  onCreate: () => void;
  onEdit: (link: ReferralLink) => void;
  onDisable: (link: ReferralLink) => Promise<void>;
  onCommission: (commission: ReferralCommission, status: "paid" | "void") => Promise<void>;
  onExport: () => void;
}) {
  const approved = commissions.filter((item) => item.status === "approved").reduce((sum, item) => sum + item.amount, 0);
  const paid = commissions.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);
  const revenue = referrals.reduce((sum, link) => sum + Number(link.paidRevenue || 0), 0);
  const copyLink = async (code: string) => navigator.clipboard.writeText(`${window.location.origin}/?ref=${code}`);
  return (
    <>
      <AdminHeading eyebrow="Referral commerce" title="Referral links & commissions" copy="Set a shopper discount and partner commission independently for every referral link.">
        <button className="button button--light" onClick={onExport} disabled={!commissions.length}>Export report <ArrowUpRight size={15} /></button>
        <button className="button button--dark" onClick={onCreate} disabled={locked}><Plus size={16} />Create referral</button>
      </AdminHeading>
      <div className="referral-kpis">
        <article><span>Attributed revenue</span><strong>RM{revenue.toFixed(2)}</strong><small>Paid referred orders</small></article>
        <article><span>Approved to pay</span><strong>RM{approved.toFixed(2)}</strong><small>Verified commission</small></article>
        <article><span>Paid commission</span><strong>RM{paid.toFixed(2)}</strong><small>Completed payouts</small></article>
        <article><span>Downlines</span><strong>{referrals.reduce((sum, link) => sum + Number(link.downlines || 0), 0)}</strong><small>Attributed customers</small></article>
      </div>
      {!referrals.length ? (
        <AdminEmpty icon={<Link2 />} title="No referral links yet." copy="Create the first link, choose its owner, discount rule and commission rate." />
      ) : (
        <div className="referral-link-grid">
          {referrals.map((link) => (
            <article key={link.id} className={!link.active ? "is-inactive" : ""}>
              <header><div><span>{link.active ? "Active link" : "Inactive"}</span><h2>?ref={link.code}</h2></div><b>{link.commissionPercent}% commission</b></header>
              <p>{link.name}</p>
              <dl>
                <div><dt>Owner</dt><dd>{link.referrerName || link.referrerEmail}</dd></div>
                <div><dt>Shopper saving</dt><dd>{link.discountPercent}% · {link.discountScope === "first_purchase" ? "first purchase" : link.discountScope === "every_purchase" ? "every purchase" : "none"}</dd></div>
                <div><dt>Visits / downlines</dt><dd>{link.visits || 0} / {link.downlines || 0}</dd></div>
                <div><dt>Paid orders</dt><dd>{link.paidOrders || 0}</dd></div>
              </dl>
              <footer>
                <button onClick={() => void copyLink(link.code)}><Link2 size={14} />Copy link</button>
                <button onClick={() => onEdit(link)} disabled={locked}><Pencil size={14} />Edit</button>
                {link.active && <button onClick={() => void onDisable(link)} disabled={locked}><Trash2 size={14} />Disable</button>}
              </footer>
            </article>
          ))}
        </div>
      )}
      <section className="referral-report">
        <div><p className="eyebrow">Commission ledger</p><h2>Order-by-order report</h2><p>Pending entries become approved only after payment is verified. Historical rates stay fixed.</p></div>
        {!commissions.length ? <p className="referral-report__empty">Commission entries will appear after an attributed order is placed.</p> : (
          <div className="referral-commission-table" role="table" aria-label="Referral commission report">
            <div role="row"><b>Order</b><b>Partner / customer</b><b>Basis</b><b>Commission</b><b>Status</b><b>Action</b></div>
            {commissions.map((item) => <div role="row" key={item.id}>
              <span><b>{item.orderNumber}</b><small>?ref={item.code}</small></span>
              <span><b>{item.referrerName}</b><small>{item.customerName}</small></span>
              <span>RM{item.basis.toFixed(2)}</span>
              <span><b>RM{item.amount.toFixed(2)}</b><small>{item.ratePercent}%</small></span>
              <span><i className={`commission-status commission-status--${item.status}`}>{item.status}</i></span>
              <span className="commission-actions">{item.status === "approved" && <button onClick={() => void onCommission(item, "paid")} disabled={locked}>Mark paid</button>}{["pending", "approved"].includes(item.status) && <button onClick={() => void onCommission(item, "void")} disabled={locked}>Void</button>}</span>
            </div>)}
          </div>
        )}
      </section>
    </>
  );
}

function CustomerEditor({ customer, onClose, onSave }: { customer: CustomerEditorDraft; onClose: () => void; onSave: (customer: CustomerEditorDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<CustomerEditorDraft>({ ...customer, addresses: customer.addresses.map((address) => ({ ...address })) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creating = !draft.id;
  const updateAddress = (index: number, value: Partial<CustomerEditorDraft["addresses"][number]>) => setDraft((current) => ({
    ...current,
    addresses: current.addresses.map((address, itemIndex) => itemIndex === index ? { ...address, ...value } : value.isDefault ? { ...address, isDefault: false } : address),
  }));
  const addAddress = () => setDraft((current) => ({ ...current, addresses: [...current.addresses, {
    ...blankAdminAddress, recipientName: current.fullName, phone: current.phone || "", isDefault: current.addresses.length === 0,
  }] }));
  const removeAddress = (index: number) => setDraft((current) => {
    const addresses = current.addresses.filter((_, itemIndex) => itemIndex !== index);
    if (addresses.length && !addresses.some((address) => address.isDefault)) addresses[0] = { ...addresses[0], isDefault: true };
    return { ...current, addresses };
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(draft); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <EditorShell title={creating ? "Add customer" : `Manage ${draft.fullName}`} onClose={onClose}>
    <form className="editor-form customer-editor" onSubmit={save}>
      <section className="customer-editor__section">
        <div className="settings-section-heading"><div><p className="eyebrow">Account</p><h3>Customer details</h3></div><span className={`status-badge status-badge--${draft.status || "active"}`}>{draft.status || "active"}</span></div>
        <div className="form-grid">
          <label className="full">Full name<input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} autoComplete="off" required /></label>
          <label>Email address<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} autoComplete="off" required /></label>
          <label>Mobile number<input value={draft.phone || ""} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} autoComplete="off" required /></label>
          <label>Date of birth<input type="date" value={draft.birthDate || ""} onChange={(event) => setDraft({ ...draft, birthDate: event.target.value })} /></label>
          <label>Account status<select value={draft.status || "active"} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
          <label className="full">{creating ? "Temporary password" : "New temporary password (optional)"}<input type="password" value={draft.temporaryPassword} onChange={(event) => setDraft({ ...draft, temporaryPassword: event.target.value })} minLength={8} autoComplete="new-password" required={creating} /><small>{creating ? "Customer must change this password after first sign-in." : "Setting a password signs the customer out everywhere and requires a change at next sign-in."}</small></label>
          <label className="check-field"><input type="checkbox" checked={!!draft.marketingConsent} onChange={(event) => setDraft({ ...draft, marketingConsent: event.target.checked })} />Customer agreed to receive marketing notes and offers</label>
        </div>
        {!creating && <div className="customer-security-grid">
          <article><ShieldCheck /><span><b>{draft.emailVerified ? "Email verified" : "Email not verified"}</b><small>Verification state</small></span></article>
          <article><LockKeyhole /><span><b>{draft.mustChangePassword ? "Password change required" : "Password current"}</b><small>Account access</small></span></article>
          <article><Users /><span><b>{draft.lastLoginAt ? new Date(draft.lastLoginAt).toLocaleString("en-MY") : "Never signed in"}</b><small>Last login</small></span></article>
        </div>}
      </section>

      <section className="customer-editor__section">
        <div className="settings-section-heading"><div><p className="eyebrow">Delivery</p><h3>Saved addresses</h3></div><button type="button" className="button button--ghost" onClick={addAddress}><Plus size={14} />Add address</button></div>
        {!draft.addresses.length ? <div className="customer-inline-empty">No delivery address saved.</div> : <div className="customer-address-editors">{draft.addresses.map((address, index) => <article key={address.id || index}>
          <header><b>{address.label || `Address ${index + 1}`}</b><button type="button" onClick={() => removeAddress(index)} aria-label="Remove address"><Trash2 size={14} /></button></header>
          <div className="form-grid">
            <label>Label<input value={address.label} onChange={(event) => updateAddress(index, { label: event.target.value })} required /></label>
            <label>Recipient<input value={address.recipientName} onChange={(event) => updateAddress(index, { recipientName: event.target.value })} required /></label>
            <label>Phone<input value={address.phone} onChange={(event) => updateAddress(index, { phone: event.target.value })} required /></label>
            <label>Postcode<input value={address.postcode} maxLength={5} onChange={(event) => updateAddress(index, { postcode: event.target.value.replace(/\D/g, "") })} required /></label>
            <label className="full">Address line 1<input value={address.line1} onChange={(event) => updateAddress(index, { line1: event.target.value })} required /></label>
            <label className="full">Address line 2<input value={address.line2 || ""} onChange={(event) => updateAddress(index, { line2: event.target.value })} /></label>
            <label>City<input value={address.city} onChange={(event) => updateAddress(index, { city: event.target.value })} required /></label>
            <label>State<select value={address.state} onChange={(event) => updateAddress(index, { state: event.target.value })}>{adminMalaysiaStates.map((state) => <option key={state}>{state}</option>)}</select></label>
            <label className="check-field"><input type="checkbox" checked={!!address.isDefault} onChange={(event) => updateAddress(index, { isDefault: event.target.checked })} />Default delivery address</label>
          </div>
        </article>)}</div>}
      </section>

      {!creating && <section className="customer-editor__section">
        <div className="settings-section-heading"><div><p className="eyebrow">Commerce</p><h3>Customer activity</h3></div></div>
        <div className="customer-commerce-kpis"><article><span>Orders</span><strong>{draft.orderCount || 0}</strong></article><article><span>Paid value</span><strong>RM{Number(draft.totalSpent || 0).toFixed(2)}</strong></article><article><span>Member since</span><strong>{draft.createdAt ? new Date(draft.createdAt).toLocaleDateString("en-MY") : "—"}</strong></article></div>
        <div className="customer-activity-grid">
          <div><h4>Recent orders</h4>{!draft.orders?.length ? <p>No orders yet.</p> : draft.orders.map((order) => <article key={order.id}><span><b>{order.orderNumber || order.id}</b><small>{new Date(order.createdAt).toLocaleDateString("en-MY")}</small></span><strong>RM{Number(order.total).toFixed(2)}</strong><em>{order.status.replaceAll("_", " ")}</em></article>)}</div>
          <div><h4>Referral relationship</h4>{draft.referredBy && <article><span><b>Referred via ?ref={draft.referredBy.code}</b><small>{draft.referredBy.name}</small></span></article>}{!draft.referralLinks?.length ? <p>No owned referral links.</p> : draft.referralLinks.map((link) => <article key={link.id}><span><b>?ref={link.code}</b><small>{link.commissionPercent}% commission · {link.discountPercent}% shopper discount</small></span><em>{link.active ? "active" : "paused"}</em></article>)}</div>
        </div>
      </section>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--dark" disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save customer"}</button></div>
    </form>
  </EditorShell>;
}

function ReferralEditor({ referral, customers, onClose, onSave }: { referral: ReferralLink; customers: AdminCustomer[]; onClose: () => void; onSave: (link: ReferralLink) => Promise<void> }) {
  const [draft, setDraft] = useState(referral);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await onSave({ ...draft, code: draft.code.trim().toLowerCase() }); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <EditorShell title={referral.id ? `Edit ?ref=${referral.code}` : "Create referral link"} onClose={onClose}>
    <form className="editor-form referral-editor-form" onSubmit={save}>
      <div className="referral-editor-intro"><Link2 /><div><b>One link, two independent rates</b><p>The discount rewards the shopper. Commission rewards the link owner after payment is verified.</p></div></div>
      <div className="form-grid">
        <label className="full">Referral owner<select value={draft.referrerUserId} onChange={(event) => setDraft({ ...draft, referrerUserId: event.target.value })} required><option value="">Choose a customer</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.fullName} · {customer.email}</option>)}</select></label>
        <label>Link code<input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} placeholder="skybutter" required /></label>
        <label>Internal name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Skybutter partner link" required /></label>
        <label>Shopper discount %<input type="number" min="0" max="100" step="0.01" value={draft.discountPercent} onChange={(event) => setDraft({ ...draft, discountPercent: Number(event.target.value) })} required /></label>
        <label>Discount applies to<select value={draft.discountScope} onChange={(event) => setDraft({ ...draft, discountScope: event.target.value })}><option value="first_purchase">First purchase only</option><option value="every_purchase">Every purchase</option><option value="none">No shopper discount</option></select></label>
        <label>Partner commission %<input type="number" min="0" max="100" step="0.01" value={draft.commissionPercent} onChange={(event) => setDraft({ ...draft, commissionPercent: Number(event.target.value) })} required /></label>
        <label>Attribution window (days)<input type="number" min="1" max="365" value={draft.attributionDays} onChange={(event) => setDraft({ ...draft, attributionDays: Number(event.target.value) })} required /></label>
        <label>Starts at<input type="datetime-local" value={draft.startsAt?.slice(0, 16) || ""} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value || undefined })} /></label>
        <label>Ends at<input type="datetime-local" value={draft.endsAt?.slice(0, 16) || ""} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value || undefined })} /></label>
      </div>
      <label className="check-field"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Referral link is active</label>
      {error && <p className="form-alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--dark" disabled={busy || !customers.length}><Save size={15} />{busy ? "Saving…" : "Save referral"}</button></div>
    </form>
  </EditorShell>;
}

function PromoEditor({
  promo,
  onClose,
  onSave,
}: {
  promo: Promo;
  onClose: () => void;
  onSave: (promo: Promo) => Promise<void>;
}) {
  const [draft, setDraft] = useState(promo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({ ...draft, code: draft.code.trim().toUpperCase() });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorShell
      title={promo.id ? `Edit ${promo.code}` : "Create promo code"}
      onClose={onClose}
    >
      <form className="editor-form" onSubmit={save}>
        <div className="form-grid">
          <label>
            Code
            <input
              value={draft.code}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  code: event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9_-]/g, ""),
                })
              }
              required
            />
          </label>
          <label>
            Offer type
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value })
              }
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount</option>
              <option value="free_shipping">Free shipping</option>
            </select>
          </label>
          <label className="full">
            Description
            <input
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              required
            />
          </label>
          <label>
            Value
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.value}
              onChange={(event) =>
                setDraft({ ...draft, value: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Minimum spend
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.minimumSpend || 0}
              onChange={(event) =>
                setDraft({ ...draft, minimumSpend: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Maximum discount
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.maximumDiscount || 0}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  maximumDiscount: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Total use limit
            <input
              type="number"
              min="1"
              step="1"
              value={draft.usageLimit ?? ""}
              placeholder="No limit"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  usageLimit: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            Uses per customer
            <input
              type="number"
              min="1"
              step="1"
              value={draft.perCustomerLimit ?? ""}
              placeholder="No limit"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  perCustomerLimit: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <label>
            Starts
            <input
              type="datetime-local"
              value={draft.startsAt?.slice(0, 16) || ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  startsAt: event.target.value || undefined,
                })
              }
            />
          </label>
          <label>
            Ends
            <input
              type="datetime-local"
              value={draft.endsAt?.slice(0, 16) || ""}
              onChange={(event) =>
                setDraft({ ...draft, endsAt: event.target.value || undefined })
              }
            />
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) =>
              setDraft({ ...draft, active: event.target.checked })
            }
          />
          Active
        </label>
        {error && <p className="form-alert">{error}</p>}
        <div className="editor-actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button--dark" disabled={busy}>
            <Save size={15} />
            {busy ? "Saving…" : "Save promo"}
          </button>
        </div>
      </form>
    </EditorShell>
  );
}

function EnquiriesView({
  enquiries,
  selected,
  locked,
  onSelect,
  onChange,
  settings,
}: {
  enquiries: Enquiry[];
  selected: Enquiry | null;
  locked: boolean;
  onSelect: (id: string) => void;
  onChange: Dispatch<SetStateAction<Enquiry[]>>;
  settings: StoreSettings;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!selected) return null;
  const saveNote = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<unknown>(
        `/admin/enquiries/${selected.id}/replies`,
        { method: "POST", body: { message: reply.trim() } },
      );
      const saved = itemFrom<Enquiry>(result, ["enquiry"]);
      onChange((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, ...saved } : item,
        ),
      );
      setReply("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const updateStatus = async (status: string) => {
    setBusy(true);
    try {
      await apiRequest(`/admin/enquiries/${selected.id}`, {
        method: "PATCH",
        body: { status },
      });
      onChange((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, status } : item,
        ),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="enquiry-layout">
      <div className="enquiry-list">
        {enquiries.map((enquiry) => (
          <button
            className={enquiry.id === selected.id ? "is-active" : ""}
            onClick={() => onSelect(enquiry.id)}
            key={enquiry.id}
          >
            <span>
              {enquiry.name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)}
            </span>
            <div>
              <b>{enquiry.name}</b>
              <p>{enquiry.subject}</p>
            </div>
            <small>
              {new Date(enquiry.createdAt).toLocaleDateString("en-MY")}
              <i>{enquiry.status}</i>
            </small>
          </button>
        ))}
      </div>
      <div className="enquiry-detail">
        <div>
          <span>
            {selected.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <p>
            <b>{selected.name}</b>
            <small>
              {selected.channel || "Store enquiry"} ·{" "}
              {selected.email || selected.phone || "Customer"}
            </small>
          </p>
          <a
            href={`https://wa.me/${settings.whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
          >
            <ArrowUpRight size={15} />
            Open WhatsApp
          </a>
        </div>
        <div className="enquiry-chat">
          <p className="chat-bubble chat-bubble--user">
            {selected.message}
            <time>Customer</time>
          </p>
          {selected.replies?.map((item) => (
            <p
              className="chat-bubble chat-bubble--brand"
              key={item.id || item.createdAt}
            >
              {item.message}
              <time>{item.author || "3R&Co"}</time>
            </p>
          ))}
        </div>
        <div className="enquiry-status-row">
          <label>
            Status
            <select
              value={selected.status}
              onChange={(event) => void updateStatus(event.target.value)}
              disabled={locked || busy}
            >
              <option value="new">New</option>
              <option value="open">Open</option>
              <option value="replied">Replied</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        {error && <p className="form-alert">{error}</p>}
        <div className="enquiry-compose">
          <small>
            Internal note only — this is not sent to the customer. Use WhatsApp
            or email to contact them.
          </small>
          <input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="Write an internal reply note…"
            disabled={locked}
          />
          <button
            onClick={() => void saveNote()}
            disabled={locked || busy || !reply.trim()}
          >
            <MessageCircle size={16} />
            Save reply note
          </button>
        </div>
      </div>
    </div>
  );
}

function EditorShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="admin-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        className="overlay-backdrop"
        onClick={onClose}
        aria-label="Close editor"
      />
      <section className="admin-editor">
        <header>
          <div>
            <p className="eyebrow">Store editor</p>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close editor">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await uploadAdminImage(file));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="image-field">
      <label>
        {label}
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Image URL"
        />
      </label>
      <div>
        {value ? (
          <img src={value} alt="" />
        ) : (
          <span>
            <ImagePlus />
          </span>
        )}
        <label className="image-field__upload">
          <Upload size={15} />
          {busy ? "Uploading…" : "Upload image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void upload(event.target.files?.[0])}
            disabled={busy}
          />
        </label>
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
