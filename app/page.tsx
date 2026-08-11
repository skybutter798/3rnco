"use client";

import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Copy,
  CreditCard,
  Gift,
  House,
  Leaf,
  Menu,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Upload,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AccountDialog from "./components/AccountDialog";
import AdminDashboard from "./components/AdminDashboard";
import BundleBuilder from "./components/BundleBuilder";
import { ApiError, apiRequest, errorMessage } from "./lib/api";
import type {
  AuthSession,
  AuthUser,
  Bundle,
  BundleStep,
  GalleryItem,
  PaymentMethod,
  Product,
  Slide,
  StorefrontPayload,
  StoreOrder,
  StoreSettings,
} from "./store-types";

type CartLine = { product: Product; quantity: number };
type ChatMessage = { from: "brand" | "user"; text: string };

type CheckoutData = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postcode: string;
  state: string;
  payment: "manual_confirmation";
};

const fallbackProducts: Product[] = [
  {
    id: "body-cream",
    name: "Body Cream",
    shortName: "Cream",
    price: 69,
    badge: "Texture 02",
    description:
      "A velvety moringa body cream for skin that needs lasting comfort.",
    detail:
      "A rich yet easy-to-spread cream designed as the final layer of your daily ritual. Moringa extract and plant oils leave skin feeling soft, supple and cared for, while kaffir lime adds a fresh botanical note.",
    ingredients:
      "Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.",
    ritual:
      "Massage a small amount into clean, slightly damp skin, focusing on elbows, knees and areas that need extra comfort.",
    volume: "Extra hydration · Jar",
    image: "/images/products/body-cream.webp",
    editorial: "/images/product-stories/body-cream-poster-v2.png",
    editorialPosition: "50% 50%",
    texture:
      "Velvety and cushion-rich, with a smooth finish and fresh botanical scent.",
    benefits: [
      "Helps soften dry-feeling skin",
      "Comforting moisture for daily care",
      "Moringa and plant-oil blend",
    ],
    storyImages: [
      {
        image: "/images/generated-v3/body-cream-texture-v4.webp",
        alt: "Ivory cream texture with fresh moringa and kaffir lime peel",
        eyebrow: "Texture study",
        title: "A richer layer of care.",
        copy: "Velvety cream wraps skin in comforting moisture, with moringa extract and plant oils at the centre.",
      },
      {
        image: "/images/generated-v3/body-cream-ritual-v3.webp",
        alt: "A hand slowly smoothing body cream over a forearm",
        eyebrow: "The application",
        title: "Smooth. Press. Restore.",
        copy: "Warm a small amount between the palms, then massage it over clean, slightly damp skin in slow, upward movements.",
      },
    ],
    stock: 0,
  },
  {
    id: "champion-soap",
    name: "Champion Soap Bar",
    shortName: "Soap",
    price: 57,
    badge: "Cleansing companion",
    description:
      "A grounding scrub bar that begins the everyday ritual with water.",
    detail:
      "A handmade cleansing bar with a tactile mineral finish. Begin with warm water, work gently between the hands, and rinse thoroughly.",
    ingredients:
      "Aqua, sodium hydroxide, extra virgin olive oil, moringa powder, black seed powder, coconut powder, ginger, lime and vanilla essential oils.",
    ritual: "Work between wet hands, glide over skin and rinse thoroughly.",
    volume: "Handmade scrub bar",
    image: "/images/products/champion-soap.webp",
    editorial: "/images/product-stories/champion-soap-poster-v2.png",
    editorialPosition: "50% 50%",
    texture: "A firm handmade bar with a gently tactile scrub character.",
    benefits: [
      "Fresh-feeling cleanse",
      "Tactile body polish",
      "Easy everyday ritual",
    ],
    storyImages: [
      {
        image: "/images/generated-v3/soap-lather-v3.webp",
        alt: "Irregular translucent handmade soap bar covered in fresh lather",
        eyebrow: "The true soap character",
        title: "Handmade, tactile, alive.",
        copy: "The irregular translucent bar and active lather follow the supplied soap reference, rebuilt as a fresh editorial scene.",
      },
      {
        image: "/images/generated-v3/soap-oil-study-v3.webp",
        alt: "Translucent soap beside golden botanical oil and fresh moringa",
        eyebrow: "Cleansing study",
        title: "Water first. Pressure light.",
        copy: "Build a soft lather between wet hands, glide over the body and rinse well before the next layer.",
      },
    ],
    stock: 0,
  },
  {
    id: "tree-body-oil",
    name: "Tree Body Oil",
    shortName: "Body Oil",
    price: 138,
    badge: "Texture 01",
    description:
      "The signature botanical oil, made for a slow and sensorial finish.",
    detail:
      "Our signature body ritual blends familiar botanical oils into a sensorial finishing layer. Apply sparingly and massage with intention.",
    ingredients:
      "Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.",
    ritual: "Apply a small amount to slightly damp skin and massage gently.",
    volume: "Full size · Pump bottle",
    image: "/images/products/tree-body-oil.webp",
    editorial: "/images/product-stories/tree-body-oil-poster-v2.png",
    editorialPosition: "50% 50%",
    texture: "Silken, fluid and luminous with a warm botanical aroma.",
    benefits: [
      "Massage-friendly glide",
      "Soft-looking finish",
      "Signature moringa ritual",
    ],
    storyImages: [
      {
        image: "/images/generated-v3/body-oil-texture-v3.webp",
        alt: "Luminous golden botanical oil with a fresh moringa branch",
        eyebrow: "Oil study",
        title: "A luminous finishing layer.",
        copy: "A little goes a long way: the fluid texture offers enough slip for a slow, considered massage.",
      },
      {
        image: "/images/generated-v3/body-oil-ritual-v3.webp",
        alt: "A hand massaging body oil over a forearm",
        eyebrow: "The application",
        title: "Begin on damp skin.",
        copy: "Apply sparingly after bathing so the oil can move easily while the skin still holds a trace of water.",
      },
    ],
    stock: 0,
  },
  {
    id: "tree-body-oil-travel",
    name: "Tree Body Oil Travel",
    shortName: "Travel Oil",
    price: 49,
    badge: "Keep it close",
    description: "A compact companion for care beyond home.",
    detail:
      "The signature ritual in a 10ml roll-on for your daily bag, weekend ritual or first introduction to 3R&Co.",
    ingredients:
      "Extra virgin olive oil, grapeseed oil, moringa extract, black seed extract, sweet almond oil, vitamin E and kaffir lime essential oil.",
    ritual: "Keep close and use whenever your day needs a softer reset.",
    volume: "10ml · Roll-on",
    image: "/images/product-stories/tree-body-oil-travel-single-v2.png",
    editorial: "/images/product-stories/tree-body-oil-travel-single-v2.png",
    editorialPosition: "50% 50%",
    texture: "The same silken oil ritual in a controlled, compact format.",
    benefits: [
      "Single 10ml bottle",
      "Bag-ready format",
      "Targeted roll-on ritual",
    ],
    storyImages: [
      {
        image: "/images/generated-v3/travel-pouch-v3.webp",
        alt: "One small amber roll-on oil bottle beside a linen travel pouch",
        eyebrow: "One small oil",
        title: "Moringa travels, too.",
        copy: "The small format keeps the collection's central botanical story close without adding a second product.",
      },
      {
        image: "/images/generated-v3/travel-hand-v3.webp",
        alt: "A hand holding one small amber travel oil above an everyday bag",
        eyebrow: "Keep it close",
        title: "A pause that fits the day.",
        copy: "Roll a small amount onto the skin whenever you want to return to the familiar 3R&Co ritual.",
      },
    ],
    stock: 0,
  },
];

const fallbackGallery: GalleryItem[] = [
  {
    image: "/images/instagram/brand-ritual.jpg",
    alt: "3R&Co Body Cream, Body Oil and cleansing bar with green fruit and botanicals",
    caption: "Care began at home.",
    href: "https://www.instagram.com/3rnco/p/DbdV8N1iT0h/",
  },
  {
    image: "/images/instagram/body-oil.jpg",
    alt: "Full-size and travel Tree Body Oil bottles among fresh green fruit",
    caption: "Two sizes. One familiar ritual.",
    href: "https://www.instagram.com/3rnco/p/Dbdbei4CVva/",
  },
  {
    image: "/images/instagram/family-care.jpg",
    alt: "A woman applying body oil during a quiet family-care moment",
    caption: "Care, held close.",
    href: "https://www.instagram.com/3rnco/p/Dbrmj6hCee8/",
  },
  {
    image: "/images/instagram/oil-texture.jpg",
    alt: "A 3R&Co Tree Body Oil pump bottle being used",
    caption: "A little warmth, returned to skin.",
    href: "https://www.instagram.com/3rnco/p/Dbdbei4CVva/",
  },
  {
    image: "/images/instagram/story-products.jpg",
    alt: "3R&Co products with the words Made for one, now shared with the right ones",
    caption: "Made for one. Shared with the right ones.",
    href: "https://www.instagram.com/3rnco/p/DbesZwppgDA/",
  },
  {
    image: "/images/instagram/care-began-home.jpg",
    alt: "3R&Co body ritual products with the words Began at home",
    caption: "Two textures. One complete ritual.",
    href: "https://www.instagram.com/3rnco/p/DbdV8N1iT0h/",
  },
  {
    image: "/images/instagram/body-cream.jpg",
    alt: "Golden botanical oil in a shallow bowl with a wooden spoon",
    caption: "Botanical oil, slowly gathered.",
    href: "https://www.instagram.com/3rnco/p/Dbdbei4CVva/",
  },
  {
    image: "/images/instagram-more/heritage-reel.jpg",
    alt: "3R&Co small travel oil in a warm home interior",
    caption: "The small ritual, kept close.",
    href: "https://www.instagram.com/3rnco/reel/C-Uvs3RSHZE/",
  },
  {
    image: "/images/instagram-more/care-reel.jpg",
    alt: "3R&Co body-care texture being massaged into skin",
    caption: "Feel the wonder in every layer.",
    href: "https://www.instagram.com/3rnco/reel/Cd-P866p5CK/",
  },
  {
    image: "/images/instagram-more/ritual-reel.jpg",
    alt: "3R&Co Body Cream and Tree Body Oil together",
    caption: "Two textures, one decision.",
    href: "https://www.instagram.com/3rnco/reel/DEPZlQiSBJ3/",
  },
  {
    image: "/images/instagram-more/moringa-reel.jpg",
    alt: "3R&Co green botanical product packaging",
    caption: "Hello to a botanical favourite.",
    href: "https://www.instagram.com/3rnco/reel/CsXeNU5s0LG/",
  },
];

const fallbackSlides: Slide[] = [
  {
    image: "/images/campaign/story-care-essence-v3.webp",
    eyebrow: "Relieve · Restore · Rejuvenate",
    title: "Come home",
    emphasis: "to care.",
    copy: "Born from family care in 2019, our moringa-led body ritual is made to relieve, restore and bring you gently back to yourself.",
    caption: "Family care · Made in Malaysia · Since 2019",
    tone: "light",
    position: "center",
  },
  {
    image: "/images/generated-v3/slider-botanical-leaf-v3.webp",
    eyebrow: "Main ingredient · Moringa leaves",
    title: "From moringa,",
    emphasis: "care takes root.",
    copy: "Fresh moringa leaves are the botanical centre of our Body Oil and Body Cream ritual.",
    caption: "Moringa oleifera · Body Oil · Body Cream",
    tone: "light",
    position: "center",
  },
  {
    image: "/images/moringa-slider/moringa-ingredient-table.webp",
    eyebrow: "The complete ritual",
    title: "Rooted in",
    emphasis: "moringa.",
    copy: "One botanical story, expressed through a fluid Body Oil and a rich Body Cream texture.",
    caption: "Two textures · One botanical heart",
    tone: "light",
    position: "center",
  },
];

const fallbackSettings: StoreSettings = {
  storeName: "3R&Co Malaysia",
  supportEmail: "support@3rnco.com.my",
  whatsappDisplay: "+60 17-781 6398",
  whatsappNumber: "60177816398",
  instagramHandle: "@3rnco",
  instagramUrl: "https://www.instagram.com/3rnco",
  facebookUrl: "https://www.facebook.com/officially3randco/",
  announcement: "Moringa-led body care · Made in Malaysia",
  shippingThreshold: 180,
  shippingFee: 12,
  currency: "MYR",
  country: "Malaysia",
  paymentMethods: [],
};

const fallbackBundle: Bundle = {
  id: "two-step-set",
  slug: "two-step-set",
  name: "Build the two-step set",
  title: "Choose two textures. Make it yours.",
  description:
    "Begin with a cleansing step, then choose the finishing layer that suits your ritual.",
  active: true,
  steps: [
    {
      id: "cleanse",
      label: "Step one · Cleanse",
      description: "Choose the first movement.",
      productIds: ["champion-soap"],
    },
    {
      id: "layer",
      label: "Step two · Layer",
      description: "Choose a cream or oil finish.",
      productIds: ["body-cream", "tree-body-oil"],
    },
  ],
};

const fallbackGiftBundle: Bundle = {
  id: "gift-set",
  slug: "gift-set",
  name: "Build a gift set",
  title: "Gather three gestures of care.",
  description:
    "Choose a cleansing companion, a nourishing layer, and something to carry close.",
  active: true,
  steps: [
    {
      id: "gift-cleanse",
      label: "Step one · Cleanse",
      description: "Begin the gift with a grounding cleanse.",
      productIds: ["champion-soap"],
    },
    {
      id: "gift-care",
      label: "Step two · Care",
      description: "Choose a cream or full-size botanical oil.",
      productIds: ["body-cream", "tree-body-oil"],
    },
    {
      id: "gift-carry",
      label: "Step three · Carry",
      description: "Add a travel ritual for care away from home.",
      productIds: ["tree-body-oil-travel"],
    },
  ],
};

function normalizeStoreBundle(
  bundle: Bundle & {
    steps?: Array<
      Bundle["steps"][number] & {
        options?: Array<string | { productId?: string; id?: string }>;
      }
    >;
  },
): Bundle {
  const steps = (bundle.steps || []) as Array<
    BundleStep & {
      options?: Array<string | { productId?: string; id?: string }>;
    }
  >;
  return {
    ...bundle,
    steps: steps.map((step) => ({
      ...step,
      productIds: step.productIds?.length
        ? step.productIds
        : (step.options || [])
            .map((option) =>
              typeof option === "string"
                ? option
                : option.productId || option.id || "",
            )
            .filter(Boolean),
    })),
  };
}

const money = (value: number) => `RM${value.toFixed(2)}`;

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand-mark ${compact ? "brand-mark--compact" : ""}`}>
      <img
        className="brand-mark__image"
        src="/images/brand/3rnco-logo.png"
        width={294}
        height={157}
        alt={compact ? "" : "3R&Co — Relieve, Restore, Rejuvenate"}
      />
    </span>
  );
}

export default function Home() {
  const [view, setView] = useState<"store" | "admin">("store");
  const [adminSection, setAdminSection] = useState("Store Settings");
  const [products, setProducts] = useState<Product[]>(fallbackProducts);
  const [slides, setSlides] = useState<Slide[]>(fallbackSlides);
  const [gallery, setGallery] = useState<GalleryItem[]>(fallbackGallery);
  const [settings, setSettings] = useState<StoreSettings>(fallbackSettings);
  const [bundles, setBundles] = useState<Bundle[]>([
    fallbackBundle,
    fallbackGiftBundle,
  ]);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [storeError, setStoreError] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<"home" | "shop" | "sets">("home");
  const [bundleBuilderId, setBundleBuilderId] = useState<string | null>(null);
  const [bundleSelection, setBundleSelection] = useState<{
    bundleId: string;
    selections: Record<string, string>;
  } | null>(null);
  const [resumeCheckout, setResumeCheckout] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<Product | null>(null);
  const [quickQty, setQuickQty] = useState(1);
  const [promoInput, setPromoInput] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoMessage, setPromoMessage] = useState("");
  const [discount, setDiscount] = useState(0);
  const [promoShipping, setPromoShipping] = useState<number | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(0);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutPaymentMethodId, setCheckoutPaymentMethodId] = useState("");
  const [checkoutReceipt, setCheckoutReceipt] = useState<File | null>(null);
  const [checkoutPaymentReference, setCheckoutPaymentReference] = useState("");
  const [checkoutPaymentNote, setCheckoutPaymentNote] = useState("");
  const [checkoutData, setCheckoutData] = useState<CheckoutData>({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postcode: "",
    state: "Kuala Lumpur",
    payment: "manual_confirmation",
  });
  const [confirmationId, setConfirmationId] = useState("");
  const [inventory, setInventory] = useState<Record<string, number>>(
    Object.fromEntries(
      fallbackProducts.map((product) => [product.id, product.stock]),
    ),
  );
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterDone, setNewsletterDone] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [waTyping, setWaTyping] = useState(false);
  const [waInput, setWaInput] = useState("");
  const [waStage, setWaStage] = useState("start");
  const [waProductId, setWaProductId] = useState<string | null>(null);
  const [waMessages, setWaMessages] = useState<ChatMessage[]>([
    {
      from: "brand",
      text: "Hello, you’ve reached 3R&Co. A little care goes a long way. How may we help today?",
    },
  ]);
  const mainRef = useRef<HTMLElement>(null);
  const waLogRef = useRef<HTMLDivElement>(null);
  const orderAttemptRef = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );

  const cartItems = useMemo<CartLine[]>(
    () =>
      products
        .filter((product) => cart[product.id])
        .map((product) => ({ product, quantity: cart[product.id] })),
    [cart, products],
  );
  const itemCount = cartItems.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cartItems.reduce(
    (sum, line) => sum + line.product.price * line.quantity,
    0,
  );

  const bundleDiscount = useMemo(() => {
    if (!bundleSelection) return 0;
    const bundle = bundles.find((item) => item.id === bundleSelection.bundleId);
    if (
      !bundle ||
      !bundle.discountType ||
      bundle.discountType === "none" ||
      !bundle.discountValue
    )
      return 0;
    const selectedIds = Object.values(bundleSelection.selections);
    if (selectedIds.some((id) => !cart[id])) return 0;
    const selectedSubtotal = selectedIds.reduce(
      (sum, id) =>
        sum + Number(products.find((product) => product.id === id)?.price || 0),
      0,
    );
    return Math.min(
      selectedSubtotal,
      bundle.discountType === "percentage"
        ? (selectedSubtotal * bundle.discountValue) / 100
        : bundle.discountValue,
    );
  }, [bundleSelection, bundles, cart, products]);

  const shipping =
    promoShipping ??
    (subtotal > 0 && subtotal < settings.shippingThreshold
      ? settings.shippingFee
      : 0);
  const total = Math.max(0, subtotal - discount - bundleDiscount + shipping);
  const activePaymentMethods = useMemo(
    () =>
      (settings.paymentMethods || [])
        .filter((method) => method.active)
        .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    [settings.paymentMethods],
  );
  const effectiveCheckoutPaymentMethodId = activePaymentMethods.some(
    (method) => method.id === checkoutPaymentMethodId,
  )
    ? checkoutPaymentMethodId
    : activePaymentMethods[0]?.id || "";

  const handleSession = (user: AuthUser | null) => {
    setSessionUser(user);
    if (!user) return;
    setCheckoutData((current) => ({
      ...current,
      name: current.name || user.fullName || "",
      email: current.email || user.email || "",
      phone: current.phone || user.phone || "",
    }));
    if (resumeCheckout) {
      setResumeCheckout(false);
      setAccountOpen(false);
      setCheckoutStep(0);
      setCheckoutError("");
      setCheckoutOpen(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [storeResult, sessionResult] = await Promise.allSettled([
        apiRequest<StorefrontPayload>("/storefront"),
        apiRequest<AuthSession>("/auth/session"),
      ]);
      if (cancelled) return;
      if (storeResult.status === "fulfilled") {
        const data = storeResult.value;
        if (data.settings)
          setSettings((current) => ({ ...current, ...data.settings, paymentMethods: data.paymentMethods ?? data.settings?.paymentMethods ?? current.paymentMethods }));
        {
          const nextProducts = (data.products ?? [])
            .filter((product) => product.active !== false)
            .map((product) => ({
              ...product,
              price: Number(product.price),
              stock: Number(product.stock || 0),
            }));
          setProducts(nextProducts);
          setInventory(
            Object.fromEntries(
              nextProducts.map((product) => [product.id, product.stock]),
            ),
          );
        }
        setSlides(
          (data.slides ?? []).filter((slide) => slide.active !== false),
        );
        setGallery(
          (data.gallery ?? []).filter((item) => item.active !== false),
        );
        setBundles(
          (data.bundles ?? [])
            .filter((bundle) => bundle.active !== false)
            .map(normalizeStoreBundle),
        );
      } else {
        setStoreError(
          "Online ordering is temporarily unavailable. The collection remains here to explore, and our care team is available by WhatsApp or email.",
        );
      }
      if (sessionResult.status === "fulfilled") {
        const user = sessionResult.value.user ?? null;
        setSessionUser(user);
        if (user)
          setCheckoutData((current) => ({
            ...current,
            name: current.name || user.fullName || "",
            email: current.email || user.email || "",
            phone: current.phone || user.phone || "",
          }));
      }
      setSessionChecked(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const applyBrowserRoute = () => {
      const route = window.location.pathname.replace(/\/+$/, "") || "/";
      if (route === "/admin" || route.startsWith("/admin/")) {
        setView("admin");
        setAccountOpen(false);
      } else if (route === "/account" || route.startsWith("/account/")) {
        setView("store");
        setAccountOpen(true);
      } else {
        setView("store");
      }
    };
    applyBrowserRoute();
    window.addEventListener("popstate", applyBrowserRoute);
    return () => window.removeEventListener("popstate", applyBrowserRoute);
  }, []);

  useEffect(() => {
    const onScroll = () => setHeaderSolid(window.scrollY > 30);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (
      view !== "store" ||
      heroPaused ||
      slides.length === 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(() => {
      setHeroSlide((current) => (current + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [view, heroPaused, slides.length]);

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(".reveal");
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach(
          (entry) =>
            entry.isIntersecting && entry.target.classList.add("is-visible"),
        ),
      { threshold: 0.12 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.body.classList.toggle(
      "modal-lock",
      navOpen ||
        cartOpen ||
        !!quickProduct ||
        checkoutOpen ||
        accountOpen ||
        !!bundleBuilderId,
    );
    return () => document.body.classList.remove("modal-lock");
  }, [
    navOpen,
    cartOpen,
    quickProduct,
    checkoutOpen,
    accountOpen,
    bundleBuilderId,
  ]);

  useEffect(() => {
    const hasModal =
      navOpen ||
      cartOpen ||
      !!quickProduct ||
      checkoutOpen ||
      accountOpen ||
      !!bundleBuilderId;
    if (!hasModal) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    );
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    window.setTimeout(
      () => dialog?.querySelector<HTMLElement>(focusableSelector)?.focus(),
      0,
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (checkoutOpen) setCheckoutOpen(false);
        else if (accountOpen) setAccountOpen(false);
        else if (bundleBuilderId) setBundleBuilderId(null);
        else if (quickProduct) setQuickProduct(null);
        else if (cartOpen) setCartOpen(false);
        else setNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [
    navOpen,
    cartOpen,
    quickProduct,
    checkoutOpen,
    accountOpen,
    bundleBuilderId,
  ]);

  useEffect(() => {
    if (!whatsappOpen || !waLogRef.current) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    waLogRef.current.scrollTo({ top: waLogRef.current.scrollHeight, behavior });
  }, [whatsappOpen, waMessages, waTyping]);

  const addToCart = (product: Product, quantity = 1) => {
    const available = inventory[product.id] || 0;
    if (available <= 0) {
      setToast(`${product.name} is currently out of stock.`);
      return;
    }
    setCart((current) => ({
      ...current,
      [product.id]: Math.min(
        6,
        available,
        (current[product.id] || 0) + quantity,
      ),
    }));
    if (promoCode) {
      setPromoCode("");
      setDiscount(0);
      setPromoShipping(null);
      setPromoMessage(
        "Your ritual changed, so the offer was removed. Apply it again when ready.",
      );
    }
    setToast(`${product.name} is now in your ritual.`);
  };

  const setQuantity = (productId: string, next: number) => {
    const updated = { ...cart };
    if (next <= 0) delete updated[productId];
    else updated[productId] = Math.min(6, inventory[productId] || 0, next);
    setCart(updated);
    if (
      bundleSelection &&
      Object.values(bundleSelection.selections).includes(productId)
    )
      setBundleSelection(null);

    if (promoCode) {
      setPromoCode("");
      setDiscount(0);
      setPromoShipping(null);
      setPromoMessage(
        "Your ritual changed, so the offer was removed. Apply it again when ready.",
      );
    }
  };

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code || !cartItems.length) return;
    setPromoBusy(true);
    try {
      const result = await apiRequest<{
        valid: boolean;
        code?: string;
        discount?: number;
        shipping?: number;
        message?: string;
      }>("/promos/validate", {
        method: "POST",
        body: {
          code,
          items: cartItems.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
          })),
        },
      });
      if (!result.valid)
        throw new Error(
          result.message || "That offer is not available for this ritual.",
        );
      setPromoCode(result.code || code);
      setDiscount(Number(result.discount || 0));
      setPromoShipping(
        typeof result.shipping === "number" ? Number(result.shipping) : null,
      );
      setPromoMessage(result.message || "A little care, added.");
    } catch (error) {
      setPromoCode("");
      setDiscount(0);
      setPromoShipping(null);
      setPromoMessage(errorMessage(error));
    } finally {
      setPromoBusy(false);
    }
  };

  const openCheckout = () => {
    if (!itemCount) return;
    setCartOpen(false);
    if (!sessionUser) {
      setResumeCheckout(true);
      setAccountOpen(true);
      return;
    }
    setCheckoutStep(0);
    setCheckoutError("");
    setConfirmationId("");
    setCheckoutOpen(true);
  };

  const nextCheckoutStep = () => {
    setCheckoutError("");
    const focusField = (id: string) =>
      window.setTimeout(() => document.getElementById(id)?.focus(), 0);
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      checkoutData.email.trim(),
    );
    const validPhone = checkoutData.phone.replace(/\D/g, "").length >= 8;
    if (checkoutStep === 0) {
      if (!checkoutData.name.trim()) {
        setCheckoutError("Please enter your full name.");
        focusField("checkout-name");
        return;
      }
      if (!validEmail) {
        setCheckoutError("Please enter a valid email address.");
        focusField("checkout-email");
        return;
      }
      if (!validPhone) {
        setCheckoutError("Please enter a valid mobile number.");
        focusField("checkout-phone");
        return;
      }
    }
    if (checkoutStep === 1) {
      if (!checkoutData.address.trim()) {
        setCheckoutError("Please enter a delivery address.");
        focusField("checkout-address");
        return;
      }
      if (!checkoutData.city.trim()) {
        setCheckoutError("Please enter a city.");
        focusField("checkout-city");
        return;
      }
      if (!/^\d{5}$/.test(checkoutData.postcode)) {
        setCheckoutError("Please enter a five-digit Malaysian postcode.");
        focusField("checkout-postcode");
        return;
      }
    }
    if (checkoutStep === 2) {
      if (!activePaymentMethods.length) {
        setCheckoutError(
          "Payment is temporarily unavailable. Please contact our care team for assistance.",
        );
        return;
      }
      if (
        !activePaymentMethods.some(
          (method) => method.id === effectiveCheckoutPaymentMethodId,
        )
      ) {
        setCheckoutError("Please choose an available payment method.");
        return;
      }
      if (!checkoutReceipt) {
        setCheckoutError("Please upload your payment receipt before continuing.");
        focusField("checkout-receipt");
        return;
      }
      if (checkoutReceipt.size < 1 || checkoutReceipt.size > 8_000_000) {
        setCheckoutError("Upload a receipt up to 8 MB.");
        focusField("checkout-receipt");
        return;
      }
      if (
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
          checkoutReceipt.type,
        )
      ) {
        setCheckoutError("Upload a JPEG, PNG, WebP or PDF receipt.");
        focusField("checkout-receipt");
        return;
      }
    }
    setCheckoutStep((step) => Math.min(3, step + 1));
  };

  const placeOrder = async () => {
    const selectedPaymentMethod = activePaymentMethods.find(
      (method) => method.id === effectiveCheckoutPaymentMethodId,
    );
    if (!selectedPaymentMethod || !checkoutReceipt) {
      setCheckoutError(
        "Please return to Payment, choose a method and upload your receipt.",
      );
      return;
    }
    const unavailable = cartItems.find(
      (line) => line.quantity > (inventory[line.product.id] || 0),
    );
    if (unavailable) {
      setCheckoutError(
        `${unavailable.product.name} no longer has enough stock. Please update your ritual.`,
      );
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError("");
    try {
      const orderBody = {
        items: cartItems.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
        shippingAddress: {
          recipientName: checkoutData.name,
          phone: checkoutData.phone,
          line1: checkoutData.address,
          city: checkoutData.city,
          postcode: checkoutData.postcode,
          state: checkoutData.state,
          country: settings.country,
        },
        paymentMethod: "manual_confirmation",
        promoCode: promoCode || undefined,
        bundleMetadata: bundleSelection
          ? [
              {
                bundleId: bundleSelection.bundleId,
                selections: Object.entries(bundleSelection.selections).map(
                  ([stepId, productId]) => ({
                    stepId,
                    productIds: [productId],
                  }),
                ),
              },
            ]
          : undefined,
      };
      const fingerprint = JSON.stringify(orderBody);
      if (
        !orderAttemptRef.current ||
        orderAttemptRef.current.fingerprint !== fingerprint
      ) {
        const key =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        orderAttemptRef.current = { fingerprint, key };
      }
      const result = await apiRequest<StoreOrder | { order: StoreOrder }>(
        "/orders",
        {
          method: "POST",
          headers: { "Idempotency-Key": orderAttemptRef.current.key },
          body: orderBody,
        },
      );
      const order = "order" in result ? result.order : result;
      const receiptForm = new FormData();
      receiptForm.append("file", checkoutReceipt);
      receiptForm.append("paymentMethodId", selectedPaymentMethod.id);
      if (checkoutPaymentReference.trim())
        receiptForm.append(
          "customerReference",
          checkoutPaymentReference.trim(),
        );
      if (checkoutPaymentNote.trim())
        receiptForm.append("customerNote", checkoutPaymentNote.trim());
      try {
        await apiRequest(`/orders/${order.id}/receipt`, {
          method: "POST",
          body: receiptForm,
        });
      } catch (error) {
        if (
          !(
            error instanceof ApiError &&
            error.code === "RECEIPT_ALREADY_SUBMITTED"
          )
        ) {
          setCheckoutError(
            `Order ${order.orderNumber || order.id} is saved, but the receipt upload did not finish. Try Submit again, or upload it from Profile > Orders. ${errorMessage(error)}`,
          );
          return;
        }
      }
      setInventory((current) => {
        const next = { ...current };
        cartItems.forEach((line) => {
          next[line.product.id] = Math.max(
            0,
            (next[line.product.id] || 0) - line.quantity,
          );
        });
        return next;
      });
      setConfirmationId(order.orderNumber || order.id);
      setCheckoutStep(4);
      setCart({});
      setPromoCode("");
      setPromoInput("");
      setPromoMessage("");
      setDiscount(0);
      setPromoShipping(null);
      setBundleSelection(null);
      setCheckoutReceipt(null);
      setCheckoutPaymentReference("");
      setCheckoutPaymentNote("");
      orderAttemptRef.current = null;
    } catch (error) {
      setCheckoutError(errorMessage(error));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const switchView = (next: "store" | "admin") => {
    setView(next);
    setNavOpen(false);
    const route = next === "admin" ? "/admin" : "/";
    if (window.location.pathname !== route)
      window.history.pushState(null, "", route);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    window.scrollTo({ top: 0, behavior });
  };

  const scrollPageTop = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    window.scrollTo({ top: 0, behavior });
  };

  const scrollTo = (id: string) => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    setNavOpen(false);
    if (view !== "store") {
      setView("store");
      if (window.location.pathname !== "/")
        window.history.pushState(null, "", "/");
      window.setTimeout(
        () => document.getElementById(id)?.scrollIntoView({ behavior }),
        120,
      );
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    if (view !== "store") return;
    const sections = [
      ["main-content", "home"],
      ["collection", "shop"],
      ["ritual", "sets"],
    ] as const;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const match = sections.find(([id]) => id === visible?.target.id);
        if (match) setMobileSection(match[1]);
      },
      { rootMargin: "-18% 0px -58%", threshold: [0, 0.15, 0.35] },
    );
    sections.forEach(([id]) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [view]);

  const sendWaChoice = (choice: string) => {
    setWaMessages((current) => [...current, { from: "user", text: choice }]);
    setWaTyping(true);
    window.setTimeout(() => {
      let reply =
        "Your message is with our care team. We usually reply during business hours.";
      let nextStage = "handoff";
      if (choice.includes("Choose")) {
        reply =
          "Which ritual are you considering: Body Cream, Champion Soap Bar, Tree Body Oil, or a travel size?";
        nextStage = "products";
      } else if (products.some((product) => product.name === choice)) {
        const selected = products.find((product) => product.name === choice)!;
        setWaProductId(selected.id);
        reply = `${selected.name} is ${money(selected.price)}. ${selected.ritual} Would you like to view it or build a set?`;
        nextStage = "product";
      } else if (choice.includes("Check")) {
        reply =
          "Sign in to your account to see your order history, or share your order number with our care team. Never send passwords or an OTP here.";
        nextStage = "order-input";
      } else if (choice.includes("Gifting")) {
        reply =
          "We’d be glad to help. Share the quantity, preferred delivery date and approximate budget, and our care team can continue from there.";
        nextStage = "handoff";
      } else if (choice.includes("Build")) {
        reply =
          "Choose a cleansing first step and the cream or oil finish that feels right for you.";
        nextStage = "set";
      } else if (choice.includes("person") || choice.includes("care team")) {
        reply = `Your note is ready for our care team. Continue in WhatsApp to send it securely, or email ${settings.supportEmail}.`;
        nextStage = "handoff";
      }
      setWaMessages((current) => [...current, { from: "brand", text: reply }]);
      setWaStage(nextStage);
      setWaTyping(false);
    }, 650);
  };

  const sendWaInput = () => {
    const value = waInput.trim();
    if (!value) return;
    setWaInput("");
    setWaMessages((current) => [...current, { from: "user", text: value }]);
    setWaTyping(true);
    window.setTimeout(() => {
      const reply = sessionUser
        ? "You can review the latest status securely in My account. Continue in WhatsApp if our care team should take a closer look."
        : "Thanks — sign in to review your orders securely, or continue in WhatsApp so our care team can verify your note.";
      setWaMessages((current) => [...current, { from: "brand", text: reply }]);
      setWaTyping(false);
      setWaStage("handoff");
    }, 650);
  };

  const activeHeroIndex = slides.length > 0 ? heroSlide % slides.length : 0;
  const activeHeroSlide = slides[activeHeroIndex] ?? null;
  const activeBundle =
    bundles.find(
      (item) => item.slug?.includes("two-step") || item.id.includes("two-step"),
    ) || null;
  const giftBundle =
    bundles.find(
      (item) => item.slug?.includes("gift") || item.id.includes("gift"),
    ) || null;
  const builderBundle =
    bundles.find((item) => item.id === bundleBuilderId) || null;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {view === "store" ? (
        <main ref={mainRef} className="site-shell">
          <div className="top-note">
            <p>
              <Leaf size={13} /> {settings.announcement}
            </p>
            <button onClick={() => scrollTo("collection")}>
              Complimentary Malaysia delivery from{" "}
              {money(settings.shippingThreshold)} <ArrowDownRight size={13} />
            </button>
          </div>
          {storeError && (
            <div className="store-api-alert" role="alert">
              <ShieldCheck size={15} />
              <span>{storeError}</span>
              <a
                href={`https://wa.me/${settings.whatsappNumber}`}
                target="_blank"
                rel="noreferrer"
              >
                Contact care <ArrowUpRight size={13} />
              </a>
            </div>
          )}

          <header
            className={`site-header ${headerSolid ? "site-header--solid" : activeHeroSlide?.tone === "light" ? "site-header--light" : ""}`}
          >
            <button
              className="mobile-menu"
              aria-label="Open menu"
              onClick={() => setNavOpen(true)}
            >
              <Menu />
            </button>
            <button
              className="logo-button"
              onClick={scrollPageTop}
              aria-label="3R&Co home"
            >
              <BrandMark />
            </button>
            <nav className="desktop-nav" aria-label="Primary navigation">
              <button onClick={() => scrollTo("collection")}>Shop</button>
              <button onClick={() => scrollTo("story")}>Our story</button>
              <button onClick={() => scrollTo("ritual")}>The ritual</button>
              <button onClick={() => scrollTo("journal")}>Journal</button>
            </nav>
            <div className="header-actions">
              <button
                className="icon-button hide-mobile"
                aria-label="Search collection"
                onClick={() => scrollTo("collection")}
              >
                <Search size={19} />
              </button>
              <button
                className="mode-pill hide-mobile"
                onClick={() => setAccountOpen(true)}
              >
                <CircleUserRound size={16} />{" "}
                {sessionUser?.role === "customer" ? "My account" : "Sign in"}
              </button>
              <button
                className="bag-button"
                onClick={() => setCartOpen(true)}
                aria-label={`Open cart with ${itemCount} items`}
              >
                <ShoppingBag size={19} /> <span>Ritual</span>
                <b>{itemCount}</b>
              </button>
            </div>
          </header>

          <section
            id="main-content"
            tabIndex={-1}
            className={`hero hero--${activeHeroSlide?.tone ?? "dark"} ${heroPaused ? "hero--paused" : ""}`}
            aria-labelledby="hero-title"
            aria-roledescription="carousel"
            aria-label="3R&Co moringa story"
          >
            <div className="hero__slides" aria-hidden="true">
              {slides.map((slide, index) => (
                <div
                  className={`hero__slide ${index === activeHeroIndex ? "is-active" : ""}`}
                  key={slide.image}
                >
                  <img
                    src={slide.image}
                    alt=""
                    style={{ objectPosition: slide.position }}
                  />
                </div>
              ))}
            </div>
            <div className="hero__shade" aria-hidden="true" />
            <div className="hero__content" key={activeHeroIndex}>
              <p className="eyebrow">
                {activeHeroSlide?.eyebrow ?? settings.storeName}
              </p>
              <h1 id="hero-title">
                {activeHeroSlide ? (
                  <>
                    {activeHeroSlide.title}
                    <br />
                    <em>{activeHeroSlide.emphasis}</em>
                  </>
                ) : (
                  <>
                    A new story
                    <br />
                    <em>is taking root.</em>
                  </>
                )}
              </h1>
              <p className="hero__copy">
                {activeHeroSlide?.copy ??
                  "Our landing story is being prepared. Explore the available collection or contact our care team."}
              </p>
              <div className="hero__actions">
                <button
                  className="button button--dark"
                  onClick={() => scrollTo("story")}
                >
                  Our story <ArrowDownRight size={17} />
                </button>
                <button
                  className="text-link"
                  onClick={() => scrollTo("collection")}
                >
                  Meet the ritual <span>↗</span>
                </button>
              </div>
            </div>
            {activeHeroSlide && (
              <>
                <div className="hero__meta" aria-hidden="true">
                  <span className="hero__caption">
                    {activeHeroSlide.caption}
                  </span>
                  <span className="hero__index">
                    0{activeHeroIndex + 1} / 0{slides.length}
                  </span>
                </div>
                <div
                  className="hero__controls"
                  role="group"
                  aria-label="Care and moringa story slides"
                >
                  <button
                    onClick={() => setHeroPaused((current) => !current)}
                    aria-label={heroPaused ? "Play slides" : "Pause slides"}
                    aria-pressed={heroPaused}
                  >
                    {heroPaused ? <Play size={15} /> : <Pause size={15} />}
                  </button>
                  <button
                    onClick={() =>
                      setHeroSlide(
                        (current) =>
                          (current - 1 + slides.length) % slides.length,
                      )
                    }
                    aria-label="Previous slide"
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <div className="hero__dots">
                    {slides.map((slide, index) => (
                      <button
                        className={index === activeHeroIndex ? "is-active" : ""}
                        onClick={() => setHeroSlide(index)}
                        aria-label={`Show slide ${index + 1}: ${slide.title} ${slide.emphasis}`}
                        aria-current={
                          index === activeHeroIndex ? "true" : undefined
                        }
                        key={slide.image}
                      >
                        <span />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      setHeroSlide((current) => (current + 1) % slides.length)
                    }
                    aria-label="Next slide"
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div className="hero__progress" aria-hidden="true">
                  <span key={activeHeroIndex} />
                </div>
              </>
            )}
          </section>

          <section id="introduction" className="manifesto section-pad reveal">
            <p className="section-number">01 — Philosophy</p>
            <div>
              <h2>
                Moringa at heart.
                <br />
                Care in every <em>layer.</em>
              </h2>
              <p>
                Moringa leaves are the main ingredient at the centre of 3R&Co.
                Their fresh botanical character carries through two
                complementary textures: fluid Body Oil and rich Body Cream.
              </p>
            </div>
            <div className="manifesto__aside">
              <Leaf size={25} strokeWidth={1.3} />
              <p>
                A complete body ritual rooted in moringa leaves, made for care
                at home and away.
              </p>
              <button
                className="circle-link"
                onClick={() => scrollTo("ritual")}
                aria-label="Explore the ritual"
              >
                <ArrowDownRight />
              </button>
            </div>
          </section>

          <section id="collection" className="collection section-pad">
            <div className="section-heading reveal">
              <div>
                <p className="eyebrow">The collection</p>
                <h2>
                  The ritual,
                  <br />
                  in four forms.
                </h2>
              </div>
              <p>
                At the heart of the collection are moringa-led Body Oil and Body
                Cream, joined by cleansing and travel companions for care at
                home and away.
              </p>
            </div>
            <div className="product-grid">
              {products.map((product, index) => (
                <article className="product-card reveal" key={product.id}>
                  <button
                    className="product-card__image"
                    onClick={() => {
                      setQuickProduct(product);
                      setQuickQty(1);
                    }}
                    aria-label={`Quick view ${product.name}`}
                  >
                    <span className="product-card__badge">{product.badge}</span>
                    <img
                      src={product.editorial}
                      alt={product.name}
                      style={{ objectPosition: product.editorialPosition }}
                    />
                    <span className="product-card__quick">
                      Discover product <ArrowUpRight size={14} />
                    </span>
                    <span className="product-card__no">0{index + 1}</span>
                  </button>
                  <div className="product-card__body">
                    <div>
                      <h3>{product.name}</h3>
                      <p>{product.volume}</p>
                    </div>
                    <strong>{money(product.price)}</strong>
                  </div>
                  <p className="product-card__desc">{product.description}</p>
                  <button
                    className="add-link"
                    disabled={(inventory[product.id] || 0) <= 0}
                    onClick={() => addToCart(product)}
                  >
                    {(inventory[product.id] || 0) > 0 ? (
                      <>
                        Add to ritual <Plus size={16} />
                      </>
                    ) : (
                      "Out of stock"
                    )}
                  </button>
                </article>
              ))}
            </div>
            <p className="product-note reveal">
              Refer to the product packaging for the latest ingredient
              information. For external use only; stop use if irritation occurs.
            </p>
          </section>

          <section className="editorial-break reveal">
            <img
              src="/images/campaign/quiet-return-v5.webp"
              alt="A handmade ceramic basin of water beside soft linen and amber glass in warm afternoon light"
            />
            <div className="editorial-break__overlay">
              <p className="eyebrow">A quiet return</p>
              <h2>
                Let the day
                <br />
                soften.{" "}<em>Return</em>
                <br />
                <em>to yourself.</em>
              </h2>
            </div>
          </section>

          <section id="story" className="story section-pad">
            <div className="story__media reveal">
              <img
                src="/images/instagram/family-care.jpg"
                alt="A woman applying 3R&Co body oil during a quiet moment of family care"
              />
              <p>Care began at home.</p>
            </div>
            <div className="story__copy reveal">
              <p className="section-number">02 — Our beginning</p>
              <h2>
                Born from
                <br />
                <em>family care.</em>
              </h2>
              <p className="story__lead">
                Since 2019, 3R&Co has grown from an intimate act of family care
                into a body ritual shared with others.
              </p>
              <p>
                A simple search for a gentler routine became a practice of
                research, making and patient refinement. What started at home
                continues through two thoughtful textures and the people who
                return to them.
              </p>
              <blockquote>
                “Made for one, then shared with those who understand.”
              </blockquote>
              <a
                className="text-link"
                href={settings.instagramUrl}
                target="_blank"
                rel="noreferrer"
              >
                Follow the story <ArrowUpRight size={15} />
              </a>
            </div>
          </section>

          <section id="ritual" className="ritual section-pad">
            <div className="section-heading section-heading--light reveal">
              <div>
                <p className="eyebrow">The everyday ritual</p>
                <h2>
                  Three small
                  <br />
                  movements.
                </h2>
              </div>
              <p>
                Let texture, warmth and your own pace do the work. Keep it
                simple enough to repeat.
              </p>
            </div>
            <div className="ritual-steps">
              {[
                [
                  "01",
                  "Cleanse",
                  "Begin with warm water and the Champion Soap Bar.",
                  "/images/generated-v3/ritual-cleanse-v3.webp",
                ],
                [
                  "02",
                  "Layer",
                  "Follow with Body Cream or Tree Body Oil, moving slowly over the skin.",
                  "/images/generated-v3/ritual-layer-v3.webp",
                ],
                [
                  "03",
                  "Carry",
                  "Keep Tree Body Oil Travel close for rituals away from home.",
                  "/images/generated-v3/ritual-carry-v3.webp",
                ],
              ].map(([number, title, copy, image]) => (
                <article className="ritual-step reveal" key={number}>
                  <div className="ritual-step__image">
                    <img src={image} alt="" />
                    <span>{number}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
            <button
              className="button button--cream"
              onClick={() =>
                activeBundle && setBundleBuilderId(activeBundle.id)
              }
              disabled={!activeBundle}
            >
              {activeBundle ? activeBundle.name : "Two-step set unavailable"}{" "}
              <Plus size={17} />
            </button>
          </section>

          <section className="gift section-pad reveal">
            <div className="gift__copy">
              <p className="eyebrow">A considered gift</p>
              <h2>
                Give someone
                <br />
                <em>a quieter moment.</em>
              </h2>
              <p>
                Build a ritual for birthdays, thank-yous, or simply because care
                is worth sharing.
              </p>
              <button
                className="button button--dark"
                onClick={() => giftBundle && setBundleBuilderId(giftBundle.id)}
                disabled={!giftBundle}
              >
                {giftBundle ? giftBundle.name : "Gift set unavailable"}{" "}
                <Gift size={17} />
              </button>
            </div>
            <div className="gift__media">
              <img
                src="/images/generated-v3/considered-gift-v3.webp"
                alt="3R&Co Body Oil, Body Cream and Champion Soap wrapped together as a considered gift"
              />
              <span>Gift notes available at checkout</span>
            </div>
          </section>

          <section id="journal" className="social-section">
            <div className="social-section__heading section-pad reveal">
              <div>
                <p className="eyebrow">From @3rnco</p>
                <h2>
                  Care began at home.
                  <br />
                  <em>It continues here.</em>
                </h2>
              </div>
              <div className="social-links">
                <a
                  href={settings.instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span
                    className="social-glyph social-glyph--ig"
                    aria-hidden="true"
                  >
                    ◎
                  </span>{" "}
                  Instagram <ArrowUpRight size={13} />
                </a>
                <a href={settings.facebookUrl} target="_blank" rel="noreferrer">
                  <span
                    className="social-glyph social-glyph--fb"
                    aria-hidden="true"
                  >
                    f
                  </span>{" "}
                  Facebook <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
            <div className="gallery-track">
              {gallery.map((item, index) => (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="gallery-card"
                  key={item.image}
                >
                  <img src={item.image} alt={item.alt} />
                  <span>
                    <span
                      className="social-glyph social-glyph--ig"
                      aria-hidden="true"
                    >
                      ◎
                    </span>{" "}
                    {item.caption}
                  </span>
                  <b aria-hidden="true">0{index + 1}</b>
                </a>
              ))}
            </div>
          </section>

          <section className="newsletter section-pad reveal">
            <div>
              <p className="eyebrow">Letters, softly sent</p>
              <h2>{newsletterDone ? "You’re on the list." : "Stay close."}</h2>
            </div>
            <p>
              {newsletterDone
                ? "We’ll write soon—with restraint."
                : "Ritual notes, new releases and occasional offerings, delivered with restraint."}
            </p>
            {!newsletterDone && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (newsletterEmail.includes("@")) setNewsletterDone(true);
                }}
              >
                <label className="sr-only" htmlFor="newsletter-email">
                  Your email address
                </label>
                <input
                  id="newsletter-email"
                  type="email"
                  value={newsletterEmail}
                  onChange={(event) => setNewsletterEmail(event.target.value)}
                  placeholder="Your email address"
                  required
                />
                <button type="submit" aria-label="Join mailing list">
                  <ArrowRight />
                </button>
              </form>
            )}
          </section>

          <footer className="footer section-pad">
            <div className="footer__brand">
              <BrandMark />
              <p>
                A ritual of care,
                <br />
                rooted in love.
              </p>
            </div>
            <div className="footer__column">
              <h3>Explore</h3>
              <button onClick={() => scrollTo("collection")}>Shop all</button>
              <button onClick={() => scrollTo("story")}>Our story</button>
              <button onClick={() => scrollTo("ritual")}>The ritual</button>
              <button onClick={() => setAccountOpen(true)}>My account</button>
            </div>
            <div className="footer__column">
              <h3>Care</h3>
              <button onClick={() => setWhatsappOpen(true)}>
                Product guidance
              </button>
              <a href={`mailto:${settings.supportEmail}`}>Email support</a>
              <a
                href={`https://wa.me/${settings.whatsappNumber}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp enquiry
              </a>
              <span>Made with care in Malaysia</span>
            </div>
            <div className="footer__contact">
              <p>Questions, gifting or product guidance?</p>
              <a
                href={`https://wa.me/${settings.whatsappNumber}?text=Hi%203R%26Co%2C%20I%27d%20like%20help%20choosing%20a%20body%20ritual.`}
                target="_blank"
                rel="noreferrer"
              >
                {settings.whatsappDisplay} <ArrowUpRight size={15} />
              </a>
              <a href={`mailto:${settings.supportEmail}`}>
                {settings.supportEmail} <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="footer__bottom">
              <span>© 2026 3R&Co. All rights reserved.</span>
              <span>Relieve. Restore. Rejuvenate.</span>
              <div>
                <a
                  href={settings.instagramUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                >
                  <span
                    className="social-glyph social-glyph--ig"
                    aria-hidden="true"
                  >
                    ◎
                  </span>
                </a>
                <a
                  href={settings.facebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Facebook"
                >
                  <span
                    className="social-glyph social-glyph--fb"
                    aria-hidden="true"
                  >
                    f
                  </span>
                </a>
              </div>
            </div>
          </footer>
          <nav className="mobile-app-nav" aria-label="Mobile app navigation">
            <button
              className={!accountOpen && !cartOpen && mobileSection === "home" ? "is-active" : ""}
              onClick={() => {
                setMobileSection("home");
                scrollPageTop();
              }}
              aria-current={!accountOpen && !cartOpen && mobileSection === "home" ? "page" : undefined}
            >
              <House />
              <span>Home</span>
            </button>
            <button
              className={!accountOpen && !cartOpen && mobileSection === "shop" ? "is-active" : ""}
              onClick={() => {
                setMobileSection("shop");
                scrollTo("collection");
              }}
              aria-current={!accountOpen && !cartOpen && mobileSection === "shop" ? "page" : undefined}
            >
              <Leaf />
              <span>Shop</span>
            </button>
            <button
              className={!accountOpen && !cartOpen && mobileSection === "sets" ? "is-active" : ""}
              onClick={() => {
                setMobileSection("sets");
                scrollTo("ritual");
              }}
              aria-current={!accountOpen && !cartOpen && mobileSection === "sets" ? "page" : undefined}
            >
              <Gift />
              <span>Sets</span>
            </button>
            <button
              className={accountOpen ? "is-active" : ""}
              onClick={() => setAccountOpen(true)}
              aria-current={accountOpen ? "page" : undefined}
            >
              <CircleUserRound />
              <span>Account</span>
            </button>
            <button
              className={cartOpen ? "is-active" : ""}
              onClick={() => setCartOpen(true)}
              aria-current={cartOpen ? "page" : undefined}
              aria-label={`Cart with ${itemCount} items`}
            >
              <ShoppingBag />
              <span>Cart</span>
              {itemCount > 0 && <b>{itemCount > 99 ? "99+" : itemCount}</b>}
            </button>
          </nav>
        </main>
      ) : (
        <AdminDashboard
          section={adminSection}
          setSection={setAdminSection}
          sessionUser={sessionUser}
          sessionChecked={sessionChecked}
          onSession={handleSession}
          settings={settings}
          setSettings={setSettings}
          products={products}
          setProducts={setProducts}
          slides={slides}
          setSlides={setSlides}
          bundles={bundles}
          setBundles={setBundles}
          onStore={() => switchView("store")}
        />
      )}

      {navOpen && (
        <div
          className="mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            className="mobile-drawer__close"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
          <BrandMark />
          <nav>
            <button onClick={() => scrollTo("collection")}>
              Shop <span>01</span>
            </button>
            <button onClick={() => scrollTo("story")}>
              Our story <span>02</span>
            </button>
            <button onClick={() => scrollTo("ritual")}>
              The ritual <span>03</span>
            </button>
            <button onClick={() => scrollTo("journal")}>
              Journal <span>04</span>
            </button>
          </nav>
          <div className="mobile-drawer__actions">
            <button
              className="button button--cream"
              onClick={() => {
                setNavOpen(false);
                setAccountOpen(true);
              }}
            >
              {sessionUser?.role === "customer"
                ? "My account"
                : "Sign in or register"}
            </button>
          </div>
        </div>
      )}

      {cartOpen && (
        <div className="overlay">
          <button
            className="overlay-backdrop"
            onClick={() => setCartOpen(false)}
            aria-label="Close cart"
          />
          <aside
            className="cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Your ritual cart"
          >
            <div className="drawer-heading">
              <div>
                <p className="eyebrow">Your selection</p>
                <h2>
                  Your ritual <span>({itemCount})</span>
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
              >
                <X />
              </button>
            </div>
            {!cartItems.length ? (
              <div className="empty-cart">
                <span>
                  <ShoppingBag size={28} />
                </span>
                <h3>Your ritual is waiting.</h3>
                <p>
                  Choose a first step, a finishing layer, or something to carry
                  with you.
                </p>
                <button
                  className="button button--dark"
                  onClick={() => {
                    setCartOpen(false);
                    scrollTo("collection");
                  }}
                >
                  Explore the collection
                </button>
              </div>
            ) : (
              <>
                <div className="delivery-progress">
                  <div>
                    <span>
                      {subtotal >= settings.shippingThreshold
                        ? "Complimentary delivery unlocked"
                        : `${money(settings.shippingThreshold - subtotal)} away from complimentary delivery`}
                    </span>
                    <Truck size={16} />
                  </div>
                  <i>
                    <b
                      style={{
                        width: `${Math.min(100, (subtotal / settings.shippingThreshold) * 100)}%`,
                      }}
                    />
                  </i>
                </div>
                <div className="cart-lines">
                  {cartItems.map(({ product, quantity }) => (
                    <div className="cart-line" key={product.id}>
                      <img src={product.image} alt="" />
                      <div className="cart-line__copy">
                        <p>{product.badge}</p>
                        <h3>{product.name}</h3>
                        <span>{money(product.price)}</span>
                        <div className="quantity">
                          <button
                            onClick={() =>
                              setQuantity(product.id, quantity - 1)
                            }
                            aria-label={`Decrease ${product.name}`}
                          >
                            <Minus size={13} />
                          </button>
                          <span>{quantity}</span>
                          <button
                            onClick={() =>
                              setQuantity(product.id, quantity + 1)
                            }
                            aria-label={`Increase ${product.name}`}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                      <button
                        className="remove-line"
                        onClick={() => setQuantity(product.id, 0)}
                        aria-label={`Remove ${product.name}`}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="promo-box">
                  <label htmlFor="promo">Ritual code</label>
                  <div>
                    <input
                      id="promo"
                      value={promoInput}
                      onChange={(event) => setPromoInput(event.target.value)}
                      placeholder="Enter your code"
                      aria-describedby={
                        promoMessage ? "promo-feedback" : undefined
                      }
                    />
                    <button
                      onClick={applyPromo}
                      disabled={promoBusy || !promoInput.trim()}
                    >
                      {promoBusy ? "Checking…" : "Apply"}
                    </button>
                  </div>
                  {promoMessage && (
                    <p
                      id="promo-feedback"
                      role="status"
                      className={promoCode ? "promo-success" : "promo-error"}
                    >
                      {promoCode && <Check size={13} />}
                      {promoMessage}
                    </p>
                  )}
                </div>
                <div className="cart-summary">
                  <p>
                    <span>Subtotal</span>
                    <b>{money(subtotal)}</b>
                  </p>
                  {bundleDiscount > 0 && (
                    <p className="discount-row">
                      <span>Set saving</span>
                      <b>−{money(bundleDiscount)}</b>
                    </p>
                  )}
                  {discount > 0 && (
                    <p className="discount-row">
                      <span>{promoCode}</span>
                      <b>−{money(discount)}</b>
                    </p>
                  )}
                  <p>
                    <span>Delivery</span>
                    <b>{shipping ? money(shipping) : "Complimentary"}</b>
                  </p>
                  <p className="cart-total">
                    <span>Total</span>
                    <b>{money(total)}</b>
                  </p>
                </div>
                <button
                  className="button button--dark button--wide"
                  onClick={openCheckout}
                >
                  Continue to checkout <ArrowRight size={17} />
                </button>
                <p className="secure-note">
                  <ShieldCheck size={14} /> Secure account checkout · payment
                  confirmed manually
                </p>
              </>
            )}
          </aside>
        </div>
      )}

      {quickProduct && (
        <div className="overlay overlay--center">
          <button
            className="overlay-backdrop"
            onClick={() => setQuickProduct(null)}
            aria-label="Close quick view"
          />
          <section
            className="quick-view"
            role="dialog"
            aria-modal="true"
            aria-label={`${quickProduct.name} product story`}
          >
            <button
              className="quick-view__close"
              onClick={() => setQuickProduct(null)}
              aria-label="Close product story"
            >
              <X />
            </button>
            <div className="quick-view__scroll">
              <header className="quick-view__hero">
                <div className="quick-view__media">
                  <img
                    src={quickProduct.editorial}
                    alt={`${quickProduct.name} hero`}
                    style={{ objectPosition: quickProduct.editorialPosition }}
                  />
                  <span>{quickProduct.badge}</span>
                  <small>3R&Co product story</small>
                </div>
                <div className="quick-view__copy">
                  <p className="eyebrow">The moringa collection</p>
                  <h2>{quickProduct.name}</h2>
                  <strong>{money(quickProduct.price)}</strong>
                  <p className="quick-view__lead">{quickProduct.detail}</p>
                  <div
                    className="quick-view__benefits"
                    aria-label="Product highlights"
                  >
                    {quickProduct.benefits.map((benefit) => (
                      <span key={benefit}>
                        <Leaf size={13} />
                        {benefit}
                      </span>
                    ))}
                  </div>
                  <div className="detail-list">
                    <p>
                      <span>Format</span>
                      {quickProduct.volume}
                    </p>
                    <p>
                      <span>Texture</span>
                      {quickProduct.texture}
                    </p>
                    <p>
                      <span>Ritual</span>
                      {quickProduct.ritual}
                    </p>
                    <details>
                      <summary>
                        Full ingredient story <ChevronDown size={15} />
                      </summary>
                      <p>{quickProduct.ingredients}</p>
                    </details>
                  </div>
                  <div className="quick-view__actions">
                    <div className="quantity">
                      <button
                        onClick={() =>
                          setQuickQty((qty) => Math.max(1, qty - 1))
                        }
                        disabled={
                          quickQty <= 1 ||
                          (inventory[quickProduct.id] || 0) <= 0
                        }
                        aria-label="Decrease quantity"
                      >
                        <Minus size={13} />
                      </button>
                      <span>
                        {(inventory[quickProduct.id] || 0) > 0 ? quickQty : 0}
                      </span>
                      <button
                        onClick={() =>
                          setQuickQty((qty) =>
                            Math.min(
                              6,
                              inventory[quickProduct.id] || 0,
                              qty + 1,
                            ),
                          )
                        }
                        disabled={
                          quickQty >=
                          Math.min(6, inventory[quickProduct.id] || 0)
                        }
                        aria-label="Increase quantity"
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <button
                      className="button button--dark"
                      disabled={(inventory[quickProduct.id] || 0) <= 0}
                      onClick={() => {
                        if ((inventory[quickProduct.id] || 0) > 0) {
                          addToCart(quickProduct, quickQty);
                          setQuickProduct(null);
                          setCartOpen(true);
                        }
                      }}
                    >
                      {(inventory[quickProduct.id] || 0) > 0
                        ? "Add to ritual"
                        : "Out of stock"}{" "}
                      <ShoppingBag size={16} />
                    </button>
                  </div>
                  <p className="quick-view__stock">
                    {(inventory[quickProduct.id] || 0) > 0
                      ? `In stock · ${inventory[quickProduct.id]} available`
                      : "Temporarily out of stock"}
                  </p>
                </div>
              </header>

              <div className="quick-view__gallery">
                {quickProduct.storyImages.map((story) => (
                  <figure className="product-story-card" key={story.image}>
                    <div>
                      <img
                        src={story.image}
                        alt={story.alt}
                        style={{ objectPosition: story.position }}
                      />
                    </div>
                    <figcaption>
                      <p className="eyebrow">{story.eyebrow}</p>
                      <h3>{story.title}</h3>
                      <p>{story.copy}</p>
                    </figcaption>
                  </figure>
                ))}
              </div>

              <footer className="quick-view__footer">
                <div>
                  <Leaf size={24} />
                  <p>
                    <b>Moringa-led care</b>
                    <span>
                      Moringa leaves remain the main ingredient story across the
                      3R&Co body ritual.
                    </span>
                  </p>
                </div>
                <p>
                  Product appearance is based on 3R&Co reference photography.
                  Natural variations in colour and texture may occur.
                </p>
              </footer>
            </div>
          </section>
        </div>
      )}

      {checkoutOpen && (
        <Checkout
          step={checkoutStep}
          setStep={setCheckoutStep}
          close={() => setCheckoutOpen(false)}
          data={checkoutData}
          setData={setCheckoutData}
          error={checkoutError}
          next={nextCheckoutStep}
          placeOrder={placeOrder}
          busy={checkoutBusy}
          confirmationId={confirmationId}
          cartItems={cartItems}
          subtotal={subtotal}
          shipping={shipping}
          discount={discount}
          bundleDiscount={bundleDiscount}
          promoCode={promoCode}
          total={total}
          paymentMethods={activePaymentMethods}
          paymentMethodId={effectiveCheckoutPaymentMethodId}
          setPaymentMethodId={setCheckoutPaymentMethodId}
          receipt={checkoutReceipt}
          setReceipt={setCheckoutReceipt}
          paymentReference={checkoutPaymentReference}
          setPaymentReference={setCheckoutPaymentReference}
          paymentNote={checkoutPaymentNote}
          setPaymentNote={setCheckoutPaymentNote}
          viewOrder={() => {
            setCheckoutOpen(false);
            setAccountOpen(true);
          }}
        />
      )}

      <button
        className={`whatsapp-fab ${whatsappOpen ? "whatsapp-fab--open" : ""}`}
        onClick={() => setWhatsappOpen((open) => !open)}
        aria-label={
          whatsappOpen ? "Close 3R&Co care guide" : "Open 3R&Co care guide"
        }
        aria-expanded={whatsappOpen}
        aria-controls="whatsapp-care-guide"
      >
        <span className="whatsapp-fab__mark">
          {whatsappOpen ? (
            <X />
          ) : (
            <>
              <BrandMark compact />
              <Leaf className="whatsapp-fab__leaf" />
            </>
          )}
        </span>
        <span className="whatsapp-fab__copy">
          <b>Ask 3R&Co</b>
          <small>Care guide</small>
        </span>
      </button>
      {whatsappOpen && (
        <aside
          id="whatsapp-care-guide"
          className="whatsapp-panel"
          role="region"
          aria-label="3R&Co product care guide"
        >
          <div className="whatsapp-panel__head">
            <span>
              <BrandMark compact />
            </span>
            <div>
              <b>3R&Co Care</b>
              <small>
                <i /> Product & order guide
              </small>
            </div>
            <button
              onClick={() => setWhatsappOpen(false)}
              aria-label="Close chat"
            >
              <X size={18} />
            </button>
          </div>
          <div className="whatsapp-panel__notice">
            For personal support, continue securely in WhatsApp
          </div>
          <div
            ref={waLogRef}
            className="whatsapp-panel__messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {waMessages.map((message, index) => (
              <p
                className={`chat-bubble chat-bubble--${message.from}`}
                key={`${message.text}-${index}`}
              >
                {message.text}
                <time>{message.from === "brand" ? "Now" : "You"}</time>
              </p>
            ))}
            {waTyping && (
              <div
                className="typing"
                role="status"
                aria-label="3R&Co is typing"
              >
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="wa-choices">
            {waStage === "start" &&
              [
                "1 — Choose a product",
                "2 — Check an order",
                "3 — Gifting or bulk enquiry",
                "4 — Speak with our care team",
              ].map((choice) => (
                <button onClick={() => sendWaChoice(choice)} key={choice}>
                  {choice}
                  <ChevronRight size={14} />
                </button>
              ))}
            {waStage === "products" &&
              [
                "Tree Body Oil",
                "Tree Body Oil Travel",
                "Body Cream",
                "Champion Soap Bar",
                ...(activeBundle ? ["Build a set"] : []),
              ].map((choice) => (
                <button onClick={() => sendWaChoice(choice)} key={choice}>
                  {choice}
                  <ChevronRight size={14} />
                </button>
              ))}
            {waStage === "product" &&
              [
                "View product",
                ...(activeBundle ? ["Build a set"] : []),
                "Ask a person",
              ].map((choice) => (
                <button
                  onClick={() => {
                    if (choice === "View product") {
                      const selected = products.find(
                        (product) => product.id === waProductId,
                      );
                      setWhatsappOpen(false);
                      if (selected) setQuickProduct(selected);
                    } else sendWaChoice(choice);
                  }}
                  key={choice}
                >
                  {choice}
                  <ChevronRight size={14} />
                </button>
              ))}
            {waStage === "set" && activeBundle && (
              <button
                onClick={() => {
                  setWhatsappOpen(false);
                  setBundleBuilderId(activeBundle.id);
                }}
              >
                Choose your two steps <Plus size={14} />
              </button>
            )}
          </div>
          <div className="wa-input">
            <input
              value={waInput}
              onChange={(event) => setWaInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && sendWaInput()}
              placeholder={
                waStage === "order-input"
                  ? "Enter your order number"
                  : "Ask a product question"
              }
              aria-label="Care guide message"
            />
            <button onClick={sendWaInput} aria-label="Ask the care guide">
              <Send size={16} />
            </button>
          </div>
          <a
            className="wa-live-link"
            href={`https://wa.me/${settings.whatsappNumber}?text=Hi%203R%26Co%2C%20I%27d%20like%20help%20choosing%20a%20body%20ritual.`}
            target="_blank"
            rel="noreferrer"
          >
            Continue in WhatsApp <ArrowUpRight size={14} />
          </a>
        </aside>
      )}

      {accountOpen && (
        <AccountDialog
          user={sessionUser}
          onSession={handleSession}
          onClose={() => {
            setAccountOpen(false);
            setResumeCheckout(false);
            if (window.location.pathname.startsWith("/account"))
              window.history.pushState(null, "", "/");
          }}
          settings={settings}
        />
      )}
      {builderBundle && (
        <BundleBuilder
          bundle={builderBundle}
          products={products.map((product) => ({
            ...product,
            stock: inventory[product.id] || 0,
          }))}
          onClose={() => setBundleBuilderId(null)}
          onAdd={(productIds, selections) => {
            if (!productIds.length) return;
            productIds.forEach((id) => {
              const product = products.find((item) => item.id === id);
              if (product) addToCart(product);
            });
            setBundleSelection({ bundleId: builderBundle.id, selections });
            setBundleBuilderId(null);
            setCartOpen(true);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </>
  );
}

type CheckoutProps = {
  step: number;
  setStep: (step: number) => void;
  close: () => void;
  data: CheckoutData;
  setData: Dispatch<SetStateAction<CheckoutData>>;
  error: string;
  next: () => void;
  placeOrder: () => void;
  busy: boolean;
  confirmationId: string;
  cartItems: CartLine[];
  subtotal: number;
  shipping: number;
  discount: number;
  bundleDiscount: number;
  promoCode: string;
  total: number;
  paymentMethods: PaymentMethod[];
  paymentMethodId: string;
  setPaymentMethodId: (id: string) => void;
  receipt: File | null;
  setReceipt: (file: File | null) => void;
  paymentReference: string;
  setPaymentReference: (value: string) => void;
  paymentNote: string;
  setPaymentNote: (value: string) => void;
  viewOrder: () => void;
};

function Checkout({
  step,
  setStep,
  close,
  data,
  setData,
  error,
  next,
  placeOrder,
  busy,
  confirmationId,
  cartItems,
  subtotal,
  shipping,
  discount,
  bundleDiscount,
  promoCode,
  total,
  paymentMethods,
  paymentMethodId,
  setPaymentMethodId,
  receipt,
  setReceipt,
  paymentReference,
  setPaymentReference,
  paymentNote,
  setPaymentNote,
  viewOrder,
}: CheckoutProps) {
  const update = (key: keyof CheckoutData, value: string) =>
    setData((current) => ({ ...current, [key]: value }));
  const labels = ["Contact", "Delivery", "Payment", "Review"];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copiedPayment, setCopiedPayment] = useState(false);
  const selectedPaymentMethod = paymentMethods.find(
    (method) => method.id === paymentMethodId,
  );

  const copyAccountNumber = async (accountNumber: string) => {
    try {
      await navigator.clipboard.writeText(accountNumber);
      setCopiedPayment(true);
      window.setTimeout(() => setCopiedPayment(false), 1800);
    } catch {
      setCopiedPayment(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => headingRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [step]);

  return (
    <div
      className="checkout-shell"
      role="dialog"
      aria-modal="true"
      aria-label="Checkout"
    >
      <header className="checkout-header">
        <BrandMark />
        <div className="checkout-preview">
          <ShieldCheck size={15} /> Secure checkout · signed-in customers only
        </div>
        <button onClick={close} aria-label="Close checkout">
          <X />
        </button>
      </header>
      {step < 4 ? (
        <div className="checkout-layout">
          <div className="checkout-main">
            <div className="checkout-steps" aria-label="Checkout progress">
              {labels.map((label, index) => (
                <button
                  key={label}
                  className={
                    step === index
                      ? "is-active"
                      : step > index
                        ? "is-complete"
                        : ""
                  }
                  onClick={() => index < step && setStep(index)}
                  disabled={index > step}
                  aria-current={step === index ? "step" : undefined}
                >
                  <span>{step > index ? <Check size={13} /> : index + 1}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="checkout-card">
              {step === 0 && (
                <>
                  <p className="eyebrow">Step 01</p>
                  <h2 ref={headingRef} tabIndex={-1}>
                    How may we reach you?
                  </h2>
                  <p className="checkout-intro">
                    Order updates will be connected to your signed-in account.
                  </p>
                  <div className="form-grid">
                    <label className="full">
                      Full name
                      <input
                        id="checkout-name"
                        value={data.name}
                        onChange={(event) => update("name", event.target.value)}
                        autoComplete="name"
                        required
                        aria-invalid={!!error && !data.name.trim()}
                        aria-describedby={error ? "checkout-error" : undefined}
                      />
                    </label>
                    <label>
                      Email address
                      <input
                        id="checkout-email"
                        type="email"
                        value={data.email}
                        readOnly
                        autoComplete="email"
                        required
                      />
                    </label>
                    <label>
                      Mobile number
                      <input
                        id="checkout-phone"
                        type="tel"
                        value={data.phone}
                        onChange={(event) =>
                          update("phone", event.target.value)
                        }
                        autoComplete="tel"
                        required
                        aria-invalid={
                          !!error && data.phone.replace(/\D/g, "").length < 8
                        }
                        aria-describedby={error ? "checkout-error" : undefined}
                      />
                    </label>
                  </div>
                </>
              )}
              {step === 1 && (
                <>
                  <p className="eyebrow">Step 02</p>
                  <h2 ref={headingRef} tabIndex={-1}>
                    Where is this ritual going?
                  </h2>
                  <p className="checkout-intro">
                    Malaysia standard delivery · estimated 2–5 working days.
                  </p>
                  <div className="form-grid">
                    <label className="full">
                      Address
                      <input
                        id="checkout-address"
                        value={data.address}
                        onChange={(event) =>
                          update("address", event.target.value)
                        }
                        autoComplete="street-address"
                        required
                        aria-invalid={!!error && !data.address.trim()}
                        aria-describedby={error ? "checkout-error" : undefined}
                      />
                    </label>
                    <label>
                      City
                      <input
                        id="checkout-city"
                        value={data.city}
                        onChange={(event) => update("city", event.target.value)}
                        autoComplete="address-level2"
                        required
                        aria-invalid={!!error && !data.city.trim()}
                        aria-describedby={error ? "checkout-error" : undefined}
                      />
                    </label>
                    <label>
                      Postcode
                      <input
                        id="checkout-postcode"
                        inputMode="numeric"
                        value={data.postcode}
                        maxLength={5}
                        onChange={(event) =>
                          update(
                            "postcode",
                            event.target.value.replace(/\D/g, ""),
                          )
                        }
                        autoComplete="postal-code"
                        required
                        aria-invalid={!!error && !/^\d{5}$/.test(data.postcode)}
                        aria-describedby={error ? "checkout-error" : undefined}
                      />
                    </label>
                    <label className="full">
                      State
                      <select
                        value={data.state}
                        onChange={(event) =>
                          update("state", event.target.value)
                        }
                        autoComplete="address-level1"
                        required
                      >
                        {[
                          "Johor",
                          "Kedah",
                          "Kelantan",
                          "Kuala Lumpur",
                          "Labuan",
                          "Melaka",
                          "Negeri Sembilan",
                          "Pahang",
                          "Penang",
                          "Perak",
                          "Perlis",
                          "Putrajaya",
                          "Sabah",
                          "Sarawak",
                          "Selangor",
                          "Terengganu",
                        ].map((state) => (
                          <option key={state}>{state}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="delivery-choice is-selected">
                    <Truck size={20} />
                    <div>
                      <b>Standard Malaysia delivery</b>
                      <span>
                        {shipping ? money(shipping) : "Complimentary"}
                      </span>
                    </div>
                    <CheckCircle2 size={18} />
                  </div>
                </>
              )}
              {step === 2 && (
                <>
                  <p className="eyebrow">Step 03</p>
                  <h2 ref={headingRef} tabIndex={-1}>
                    Payment confirmation.
                  </h2>
                  <p className="checkout-intro">
                    Choose an available method, complete the transfer and attach
                    your receipt. We will verify it before preparing your order.
                  </p>
                  {paymentMethods.length ? (
                    <>
                      <div className="payment-options checkout-payment-options">
                        {paymentMethods.map((method) => (
                          <button
                            type="button"
                            key={method.id}
                            className={
                              paymentMethodId === method.id ? "is-selected" : ""
                            }
                            aria-pressed={paymentMethodId === method.id}
                            onClick={() => setPaymentMethodId(method.id)}
                          >
                            <CreditCard size={21} />
                            <span>
                              <b>{method.name}</b>
                              <small>
                                {method.type === "bank_transfer"
                                  ? "Transfer using the bank details below"
                                  : "Scan the QR code and complete your payment"}
                              </small>
                            </span>
                            {paymentMethodId === method.id && (
                              <CheckCircle2 size={18} />
                            )}
                          </button>
                        ))}
                      </div>
                      {selectedPaymentMethod && (
                        <div className="payment-destination checkout-payment-destination">
                          {selectedPaymentMethod.qrImage && (
                            <img
                              src={selectedPaymentMethod.qrImage}
                              alt={`${selectedPaymentMethod.name} payment QR code`}
                            />
                          )}
                          <div>
                            <h4>{selectedPaymentMethod.name}</h4>
                            {selectedPaymentMethod.bankName && (
                              <p>
                                <b>Bank:</b> {selectedPaymentMethod.bankName}
                              </p>
                            )}
                            {selectedPaymentMethod.accountName && (
                              <p>
                                <b>Account name:</b>{" "}
                                {selectedPaymentMethod.accountName}
                              </p>
                            )}
                            {selectedPaymentMethod.accountNumber && (
                              <p>
                                <b>Account number:</b>{" "}
                                {selectedPaymentMethod.accountNumber}
                                <button
                                  type="button"
                                  onClick={() =>
                                    copyAccountNumber(
                                      selectedPaymentMethod.accountNumber || "",
                                    )
                                  }
                                >
                                  <Copy size={12} />
                                  {copiedPayment ? "Copied" : "Copy"}
                                </button>
                              </p>
                            )}
                            {selectedPaymentMethod.instructions && (
                              <p className="checkout-payment-instructions">
                                {selectedPaymentMethod.instructions}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="checkout-payment-fields">
                        <label className="receipt-upload checkout-receipt-upload">
                          <Upload size={21} />
                          <span>
                            <b>
                              {receipt
                                ? receipt.name
                                : "Upload payment receipt"}
                            </b>
                            <small>JPEG, PNG, WebP or PDF · maximum 8 MB</small>
                          </span>
                          <input
                            id="checkout-receipt"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) =>
                              setReceipt(event.target.files?.[0] || null)
                            }
                          />
                        </label>
                        <label>
                          Payment reference <span>Optional</span>
                          <input
                            value={paymentReference}
                            maxLength={160}
                            onChange={(event) =>
                              setPaymentReference(event.target.value)
                            }
                            placeholder="Transaction or reference number"
                          />
                        </label>
                        <label>
                          Note <span>Optional</span>
                          <textarea
                            value={paymentNote}
                            maxLength={1000}
                            onChange={(event) =>
                              setPaymentNote(event.target.value)
                            }
                            placeholder="Anything our care team should know"
                          />
                        </label>
                      </div>
                    </>
                  ) : (
                    <div className="checkout-payment-unavailable" role="status">
                      <CreditCard size={22} />
                      <p>
                        <b>Payment is temporarily unavailable.</b>
                        No payment method is active right now. Please contact our
                        care team for assistance.
                      </p>
                    </div>
                  )}
                  <div className="payment-sandbox">
                    <ShieldCheck size={19} />
                    <p>
                      <b>Protect your account</b> We never ask for a banking
                      password, full card details or an OTP in chat.
                    </p>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <p className="eyebrow">Step 04</p>
                  <h2 ref={headingRef} tabIndex={-1}>
                    Review your ritual.
                  </h2>
                  <p className="checkout-intro">
                    Prices, stock and any offer will be validated once more when
                    you place the order.
                  </p>
                  <div className="review-block">
                    <div>
                      <span>Contact</span>
                      <p>
                        <b>{data.name}</b>
                        <br />
                        {data.email}
                        <br />
                        {data.phone}
                      </p>
                      <button onClick={() => setStep(0)}>Edit</button>
                    </div>
                    <div>
                      <span>Delivery</span>
                      <p>
                        {data.address}
                        <br />
                        {data.postcode} {data.city}
                        <br />
                        {data.state}, Malaysia
                      </p>
                      <button onClick={() => setStep(1)}>Edit</button>
                    </div>
                    <div>
                      <span>Payment</span>
                      <p>
                        <b>{selectedPaymentMethod?.name || "Manual payment"}</b>
                        <br />
                        {receipt?.name || "Receipt not attached"}
                      </p>
                      <button onClick={() => setStep(2)}>Review</button>
                    </div>
                  </div>
                </>
              )}
              {error && (
                <p id="checkout-error" className="checkout-error" role="alert">
                  {error}
                </p>
              )}
              <div className="checkout-actions">
                {step > 0 ? (
                  <button
                    className="button button--ghost"
                    onClick={() => setStep(step - 1)}
                    disabled={busy}
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                ) : (
                  <span />
                )}
                {step < 3 ? (
                  <button className="button button--dark" onClick={next}>
                    Continue <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="button button--dark"
                    onClick={placeOrder}
                    disabled={busy}
                  >
                    {busy ? "Submitting order…" : "Submit order & receipt"}{" "}
                    <Check size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <aside className="checkout-summary">
            <p className="eyebrow">Your ritual</p>
            <div className="checkout-lines">
              {cartItems.map(({ product, quantity }) => (
                <div key={product.id}>
                  <span className="checkout-thumb">
                    <img src={product.image} alt="" />
                    <b>{quantity}</b>
                  </span>
                  <p>
                    {product.name}
                    <small>{product.volume}</small>
                  </p>
                  <strong>{money(product.price * quantity)}</strong>
                </div>
              ))}
            </div>
            <div className="checkout-totals">
              <p>
                <span>Subtotal</span>
                <b>{money(subtotal)}</b>
              </p>
              {bundleDiscount > 0 && (
                <p className="discount-row">
                  <span>Set saving</span>
                  <b>−{money(bundleDiscount)}</b>
                </p>
              )}
              {discount > 0 && (
                <p className="discount-row">
                  <span>{promoCode}</span>
                  <b>−{money(discount)}</b>
                </p>
              )}
              <p>
                <span>Delivery</span>
                <b>{shipping ? money(shipping) : "Complimentary"}</b>
              </p>
              <p>
                <span>Total</span>
                <b>{money(total)}</b>
              </p>
            </div>
            <div className="summary-note">
              <Leaf size={18} />
              <p>
                Your order total will be confirmed by the server before the
                order is created.
              </p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="order-success">
          <div className="order-success__visual">
            <span>
              <Check size={34} />
            </span>
            <i />
            <i />
          </div>
          <p className="eyebrow">Order received</p>
          <h1 ref={headingRef} tabIndex={-1}>
            Your ritual is
            <br />
            <em>being prepared.</em>
          </h1>
          <p>
            Your order <b>{confirmationId}</b> and payment receipt are safely
            recorded. Our care team will verify the payment and update its status.
          </p>
          <div>
            <button className="button button--dark" onClick={viewOrder}>
              View my orders <ShoppingBag size={17} />
            </button>
            <button className="button button--ghost" onClick={close}>
              Return to the shop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
