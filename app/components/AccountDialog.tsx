"use client";

import {
  ArrowRight,
  Check,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Leaf,
  Link2,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, errorMessage } from "../lib/api";
import type {
  Address,
  AuthSession,
  AuthUser,
  CustomerProfile,
  CustomerReferralDashboard,
  StoreOrder,
  StoreSettings,
  PaymentMethod,
} from "../store-types";

type Props = {
  user: AuthUser | null;
  onSession: (user: AuthUser | null) => void;
  onClose: () => void;
  settings: StoreSettings;
  referralCode?: string;
};

const blankAddress: Address = {
  label: "Home",
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  postcode: "",
  state: "Kuala Lumpur",
  country: "Malaysia",
  isDefault: true,
};

const malaysiaStates = [
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
];

function unwrapProfile(
  value: CustomerProfile | { profile: CustomerProfile },
): CustomerProfile {
  return "profile" in value ? value.profile : value;
}

function unwrapOrders(
  value: StoreOrder[] | { orders: StoreOrder[] },
): StoreOrder[] {
  return Array.isArray(value) ? value : value.orders || [];
}

export default function AccountDialog({
  user,
  onSession,
  onClose,
  settings,
  referralCode,
}: Props) {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [tab, setTab] = useState<"profile" | "addresses" | "orders" | "referrals">("profile");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [referrals, setReferrals] = useState<CustomerReferralDashboard | null>(null);
  const [addressDraft, setAddressDraft] = useState<Address | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const isCustomer = user?.role === "customer";

  useEffect(() => {
    if (!isCustomer) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoadingAccount(true);
        return Promise.all([
          apiRequest<CustomerProfile | { profile: CustomerProfile }>(
            "/profile",
          ),
          apiRequest<StoreOrder[] | { orders: StoreOrder[] }>("/orders"),
          apiRequest<CustomerReferralDashboard>("/account/referrals"),
        ]);
      })
      .then(([profileResult, orderResult, referralResult]) => {
        if (cancelled) return;
        const nextProfile = unwrapProfile(profileResult);
        setProfile(nextProfile);
        setFullName(nextProfile.fullName || "");
        setPhone(nextProfile.phone || "");
        setOrders(unwrapOrders(orderResult));
        setReferrals(referralResult);
      })
      .catch((reason) => !cancelled && setError(errorMessage(reason)))
      .finally(() => !cancelled && setLoadingAccount(false));
    return () => {
      cancelled = true;
    };
  }, [isCustomer, user?.id]);

  const sortedOrders = useMemo(
    () =>
      [...orders].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [orders],
  );

  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (authMode === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<AuthSession>(
        authMode === "register" ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body:
            authMode === "register"
              ? { fullName, email, phone, password, referralCode: referralCode || undefined }
              : { email, password },
        },
      );
      if (!result.user)
        throw new Error("Your account session could not be started.");
      onSession(result.user);
      setPassword("");
      setConfirmPassword("");
      setNotice(
        authMode === "register"
          ? "Welcome to 3R&Co. Your account is ready."
          : "Welcome back.",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest<
        CustomerProfile | { profile: CustomerProfile }
      >("/profile", {
        method: "PATCH",
        body: {
          fullName,
          phone,
          birthDate: profile.birthDate || null,
          marketingConsent: !!profile.marketingConsent,
        },
      });
      const nextProfile = unwrapProfile(result);
      setProfile(nextProfile);
      onSession({
        ...user!,
        fullName: nextProfile.fullName,
        phone: nextProfile.phone,
      });
      setNotice("Your profile has been updated.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const saveAddress = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!addressDraft) return;
    setBusy(true);
    setError("");
    try {
      const path = addressDraft.id
        ? `/profile/addresses/${addressDraft.id}`
        : "/profile/addresses";
      const result = await apiRequest<Address | { address: Address }>(path, {
        method: addressDraft.id ? "PATCH" : "POST",
        body: addressDraft,
      });
      const saved = "address" in result ? result.address : result;
      setProfile((current) =>
        current
          ? {
              ...current,
              addresses: addressDraft.id
                ? current.addresses.map((address) =>
                    address.id === saved.id ? saved : address,
                  )
                : [...current.addresses, saved],
            }
          : current,
      );
      setAddressDraft(null);
      setNotice("Delivery address saved.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const deleteAddress = async (address: Address) => {
    if (!address.id || !window.confirm(`Remove ${address.label}?`)) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/profile/addresses/${address.id}`, {
        method: "DELETE",
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              addresses: current.addresses.filter(
                (item) => item.id !== address.id,
              ),
            }
          : current,
      );
      setNotice("Delivery address removed.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      await apiRequest("/auth/logout", { method: "POST" });
      onSession(null);
      setProfile(null);
      setOrders([]);
      setNotice("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="account-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isCustomer ? "My 3R&Co account" : "Sign in or register"}
    >
      <button
        className="overlay-backdrop"
        onClick={onClose}
        aria-label="Close account"
      />
      <section className="account-dialog">
        <button
          className="account-dialog__close"
          onClick={onClose}
          aria-label="Close account"
        >
          <X />
        </button>
        <aside className="account-dialog__art">
          <img
            src="/images/generated-v3/moringa-study-v3.webp"
            alt="Fresh moringa, kaffir lime, black seed and botanical oils"
          />
          <div>
            <Leaf />
            <p className="eyebrow">Your care, gathered</p>
            <h2>
              A quieter place
              <br />
              <em>to return to.</em>
            </h2>
            <p>
              Keep your details, delivery addresses and ritual history together.
            </p>
          </div>
        </aside>

        {!user ? (
          <div className="account-auth">
            <div
              className="account-auth__tabs"
              role="tablist"
              aria-label="Account access"
            >
              <button
                className={authMode === "login" ? "is-active" : ""}
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                }}
                role="tab"
                aria-selected={authMode === "login"}
              >
                Sign in
              </button>
              <button
                className={authMode === "register" ? "is-active" : ""}
                onClick={() => {
                  setAuthMode("register");
                  setError("");
                }}
                role="tab"
                aria-selected={authMode === "register"}
              >
                Create account
              </button>
            </div>
            <p className="eyebrow">3R&Co account</p>
            <h2>
              {authMode === "login" ? "Welcome back." : "Begin your ritual."}
            </h2>
            <p>
              {authMode === "login"
                ? "Sign in to continue to your profile and orders."
                : "Create an account for checkout, saved addresses and order history."}
            </p>
            <form onSubmit={authenticate} className="account-form">
              {authMode === "register" && (
                <>
                  <label>
                    Full name
                    <input
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                      autoComplete="name"
                      required
                    />
                  </label>
                  <label>
                    Mobile number
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      type="tel"
                      autoComplete="tel"
                      required
                    />
                  </label>
                </>
              )}
              <label>
                Email address
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="text"
                  inputMode="email"
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
                    type={showPassword ? "text" : "password"}
                    minLength={authMode === "register" ? 8 : undefined}
                    autoComplete={
                      authMode === "login" ? "current-password" : "new-password"
                    }
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </span>
              </label>
              {authMode === "register" && (
                <>
                  <small className="password-help">
                    Use any 8 or more characters. Capitals, numbers and symbols
                    are optional.
                  </small>
                  <label>
                    Confirm password
                    <input
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      type={showPassword ? "text" : "password"}
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </>
              )}
              {error && (
                <p className="form-alert" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="form-success" role="status">
                  <Check size={15} />
                  {notice}
                </p>
              )}
              <button
                className="button button--dark button--wide"
                disabled={busy}
              >
                {busy
                  ? "Please wait…"
                  : authMode === "login"
                    ? "Sign in"
                    : "Create my account"}
                <ArrowRight size={16} />
              </button>
            </form>
            <p className="account-auth__care">
              <ShieldCheck size={16} /> Your password is sent only to the secure
              3R&Co account service.
            </p>
          </div>
        ) : !isCustomer ? (
          <div className="account-auth">
            <p className="eyebrow">Admin account</p>
            <h2>Signed in as {user.fullName || user.email}.</h2>
            <p>
              Use the Admin portal to manage the store, or sign out to access a
              customer account.
            </p>
            {error && <p className="form-alert">{error}</p>}
            <button
              className="button button--dark"
              onClick={logout}
              disabled={busy}
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        ) : (
          <div className="account-home">
            <header>
              <div>
                <p className="eyebrow">My 3R&Co</p>
                <h2>Hello, {user.fullName?.split(" ")[0] || "there"}.</h2>
                <p>{user.email}</p>
              </div>
              <button onClick={logout} disabled={busy}>
                <LogOut size={16} /> Sign out
              </button>
            </header>
            <nav aria-label="Account sections">
              <button
                className={tab === "profile" ? "is-active" : ""}
                onClick={() => setTab("profile")}
              >
                <UserRound size={17} />
                Profile
              </button>
              <button
                className={tab === "addresses" ? "is-active" : ""}
                onClick={() => setTab("addresses")}
              >
                <MapPin size={17} />
                Addresses
              </button>
              <button
                className={tab === "orders" ? "is-active" : ""}
                onClick={() => setTab("orders")}
              >
                <Package size={17} />
                Orders
              </button>
              <button
                className={tab === "referrals" ? "is-active" : ""}
                onClick={() => setTab("referrals")}
              >
                <Link2 size={17} />
                My Referrals
              </button>
            </nav>
            {loadingAccount ? (
              <div className="account-loading">
                <Leaf /> Gathering your details…
              </div>
            ) : (
              <div className="account-panel">
                {error && (
                  <p className="form-alert" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="form-success" role="status">
                    <Check size={15} />
                    {notice}
                  </p>
                )}
                {tab === "profile" && profile && (
                  <>
                    <form
                      className="account-form account-form--profile"
                      onSubmit={saveProfile}
                    >
                      <div className="account-panel__heading">
                        <div>
                          <p className="eyebrow">Personal details</p>
                          <h3>Your profile</h3>
                        </div>
                        <button className="button button--dark" disabled={busy}>
                          <Save size={15} /> Save profile
                        </button>
                      </div>
                      <div className="form-grid">
                        <label className="full">
                          Full name
                          <input
                            value={fullName}
                            onChange={(event) =>
                              setFullName(event.target.value)
                            }
                            autoComplete="name"
                            required
                          />
                        </label>
                        <label>
                          Email address
                          <input value={profile.email} readOnly />
                        </label>
                        <label>
                          Mobile number
                          <input
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                            autoComplete="tel"
                            required
                          />
                        </label>
                        <label>
                          Date of birth
                          <input
                            type="date"
                            value={profile.birthDate || ""}
                            onChange={(event) =>
                              setProfile({
                                ...profile,
                                birthDate: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={!!profile.marketingConsent}
                            onChange={(event) =>
                              setProfile({
                                ...profile,
                                marketingConsent: event.target.checked,
                              })
                            }
                          />
                          Receive occasional ritual notes and offers
                        </label>
                      </div>
                    </form>
                    <CustomerPasswordChange />
                  </>
                )}
                {tab === "addresses" && profile && (
                  <div>
                    <div className="account-panel__heading">
                      <div>
                        <p className="eyebrow">Delivery</p>
                        <h3>Saved addresses</h3>
                      </div>
                      <button
                        className="button button--dark"
                        onClick={() =>
                          setAddressDraft({
                            ...blankAddress,
                            recipientName: profile.fullName,
                            phone: profile.phone || "",
                          })
                        }
                      >
                        <Plus size={15} /> Add address
                      </button>
                    </div>
                    {!profile.addresses.length ? (
                      <EmptyAccount
                        icon={<MapPin />}
                        title="No saved addresses yet."
                        copy="Add a delivery address to make checkout a little calmer."
                      />
                    ) : (
                      <div className="address-list">
                        {profile.addresses.map((address) => (
                          <article key={address.id || address.line1}>
                            <span>
                              <MapPin />
                            </span>
                            <div>
                              <h4>
                                {address.label}
                                {address.isDefault && <b>Default</b>}
                              </h4>
                              <p>
                                {address.recipientName} · {address.phone}
                                <br />
                                {address.line1}
                                {address.line2 ? `, ${address.line2}` : ""}
                                <br />
                                {address.postcode} {address.city},{" "}
                                {address.state}
                              </p>
                            </div>
                            <div>
                              <button
                                onClick={() => setAddressDraft(address)}
                                aria-label={`Edit ${address.label}`}
                              >
                                <Pencil />
                              </button>
                              <button
                                onClick={() => deleteAddress(address)}
                                aria-label={`Remove ${address.label}`}
                              >
                                <Trash2 />
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    {addressDraft && (
                      <form className="address-editor" onSubmit={saveAddress}>
                        <div className="account-panel__heading">
                          <h3>
                            {addressDraft.id ? "Edit address" : "New address"}
                          </h3>
                          <button
                            type="button"
                            onClick={() => setAddressDraft(null)}
                          >
                            <X />
                          </button>
                        </div>
                        <div className="form-grid">
                          <label>
                            Label
                            <input
                              value={addressDraft.label}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  label: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Recipient
                            <input
                              value={addressDraft.recipientName}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  recipientName: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="full">
                            Mobile number
                            <input
                              value={addressDraft.phone}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  phone: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="full">
                            Address line 1
                            <input
                              value={addressDraft.line1}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  line1: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label className="full">
                            Address line 2
                            <input
                              value={addressDraft.line2 || ""}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  line2: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            City
                            <input
                              value={addressDraft.city}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  city: event.target.value,
                                })
                              }
                              required
                            />
                          </label>
                          <label>
                            Postcode
                            <input
                              inputMode="numeric"
                              maxLength={5}
                              value={addressDraft.postcode}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  postcode: event.target.value.replace(
                                    /\D/g,
                                    "",
                                  ),
                                })
                              }
                              required
                            />
                          </label>
                          <label className="full">
                            State
                            <select
                              value={addressDraft.state}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  state: event.target.value,
                                })
                              }
                            >
                              {malaysiaStates.map((state) => (
                                <option key={state}>{state}</option>
                              ))}
                            </select>
                          </label>
                          <label className="check-field">
                            <input
                              type="checkbox"
                              checked={!!addressDraft.isDefault}
                              onChange={(event) =>
                                setAddressDraft({
                                  ...addressDraft,
                                  isDefault: event.target.checked,
                                })
                              }
                            />
                            Use as default delivery address
                          </label>
                        </div>
                        <button className="button button--dark" disabled={busy}>
                          <Save size={15} /> Save address
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {tab === "orders" && (
                  <div>
                    <div className="account-panel__heading">
                      <div>
                        <p className="eyebrow">Order history</p>
                        <h3>Your rituals</h3>
                      </div>
                    </div>
                    {!sortedOrders.length ? (
                      <EmptyAccount
                        icon={<Package />}
                        title="No orders yet."
                        copy="Your first completed checkout will appear here."
                      />
                    ) : (
                      <div className="account-orders">
                        {sortedOrders.map((order) => (
                          <PaymentOrderCard
                            key={order.id}
                            order={order}
                            methods={(settings.paymentMethods || []).filter((method) => method.active)}
                            onUpdated={(updated) => setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {tab === "referrals" && referrals && (
                  <div className="account-referrals">
                    <div className="account-panel__heading">
                      <div>
                        <p className="eyebrow">Referral partner</p>
                        <h3>My referrals</h3>
                        <p>Share your active link and follow each commission from order to payout.</p>
                      </div>
                    </div>
                    {!referrals.links.length ? (
                      <EmptyAccount
                        icon={<Link2 />}
                        title="No referral link assigned yet."
                        copy="Once the 3R&Co team activates a referral link for your account, it will appear here with your commission report."
                      />
                    ) : (
                      <>
                        <div className="referral-wallet">
                          <article><span>Pending</span><strong>RM{referrals.totals.pending.toFixed(2)}</strong><small>Waiting for payment confirmation</small></article>
                          <article><span>Approved</span><strong>RM{referrals.totals.approved.toFixed(2)}</strong><small>Ready for the next payout</small></article>
                          <article><span>Paid</span><strong>RM{referrals.totals.paid.toFixed(2)}</strong><small>Total commission paid</small></article>
                        </div>
                        <div className="referral-link-list">
                          {referrals.links.map((link) => {
                            const shareUrl = typeof window === "undefined" ? `/?ref=${link.code}` : `${window.location.origin}/?ref=${link.code}`;
                            return (
                              <article key={link.id}>
                                <header>
                                  <div><span className={`status-badge ${link.active ? "status-badge--active" : "status-badge--disabled"}`}>{link.active ? "Active" : "Paused"}</span><h4>{link.name}</h4></div>
                                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(shareUrl); setNotice("Referral link copied."); }}><Copy size={15} /> Copy link</button>
                                </header>
                                <div className="referral-share-url">{shareUrl}</div>
                                <dl>
                                  <div><dt>Shopper saving</dt><dd>{link.discountPercent}% · {link.discountScope === "first_purchase" ? "first purchase" : link.discountScope === "every_purchase" ? "every purchase" : "no discount"}</dd></div>
                                  <div><dt>Your commission</dt><dd>{link.commissionPercent}% per paid order</dd></div>
                                  <div><dt>Visits</dt><dd>{link.visits || 0}</dd></div>
                                  <div><dt>Referred customers</dt><dd>{link.downlines || 0}</dd></div>
                                  <div><dt>Paid orders</dt><dd>{link.paidOrders || 0}</dd></div>
                                  <div><dt>Referred revenue</dt><dd>RM{Number(link.paidRevenue || 0).toFixed(2)}</dd></div>
                                </dl>
                              </article>
                            );
                          })}
                        </div>
                        <section className="referral-commission-report">
                          <header><WalletCards size={20} /><div><h4>Commission report</h4><p>Customer identities stay private; each row is tied to its order number.</p></div></header>
                          {!referrals.commissions.length ? <p className="referral-report-empty">No commission activity yet.</p> : (
                            <div className="referral-commission-table">
                              <div className="referral-commission-row referral-commission-row--head"><span>Order</span><span>Date</span><span>Rate</span><span>Amount</span><span>Status</span></div>
                              {referrals.commissions.map((commission) => (
                                <div className="referral-commission-row" key={commission.id}>
                                  <span><b>{commission.orderNumber}</b><small>?ref={commission.code}</small></span>
                                  <span>{new Date(commission.createdAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</span>
                                  <span>{commission.ratePercent}%<small>RM{commission.basis.toFixed(2)} basis</small></span>
                                  <strong>RM{commission.amount.toFixed(2)}</strong>
                                  <em className={`status-badge status-badge--${commission.status}`}>{commission.status}</em>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <a className="account-support" href={`mailto:${settings.supportEmail}`}>
          Need account help? {settings.supportEmail}
        </a>
      </section>
    </div>
  );
}

function PaymentOrderCard({ order, methods, onUpdated }: { order: StoreOrder; methods: PaymentMethod[]; onUpdated: (order: StoreOrder) => void }) {
  const pending = order.status === "pending_payment" && (order.paymentStatus || "pending") === "pending";
  const [methodId, setMethodId] = useState(methods[0]?.id || "");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const method = methods.find((item) => item.id === methodId);
  const receipt = order.paymentReceipt;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !methodId) return setError("Choose a payment method and receipt file.");
    setBusy(true); setError(""); setNotice("");
    const form = new FormData();
    form.append("file", file); form.append("paymentMethodId", methodId);
    if (reference) form.append("customerReference", reference);
    if (note) form.append("customerNote", note);
    try {
      const result = await apiRequest<{ order?: StoreOrder; receipt?: StoreOrder["paymentReceipt"] }>(`/orders/${encodeURIComponent(order.id)}/receipt`, { method: "POST", body: form });
      if (result.order) onUpdated(result.order);
      else if (result.receipt) onUpdated({ ...order, paymentReceipt: result.receipt });
      setNotice("Receipt submitted. Our team will verify it before confirming your order.");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return (
    <details className="account-order-card" open={pending}>
      <summary>
        <span><b>{order.orderNumber || order.id}</b><time>{new Date(order.createdAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</time></span>
        <strong>RM{Number(order.total).toFixed(2)}</strong>
        <em className={`status-badge status-badge--${order.status.replaceAll("_", "-")}`}>{order.status.replaceAll("_", " ")}</em>
      </summary>
      <div className="account-order-detail">
        <div className="account-order-lines">
          {(order.lines || []).map((line) => <p key={line.id || `${line.productId}-${line.name}`}><span>{line.name} × {line.quantity}</span><b>RM{(line.unitPrice * line.quantity).toFixed(2)}</b></p>)}
          <p><span>Subtotal</span><b>RM{Number(order.subtotal ?? order.total).toFixed(2)}</b></p>
          {!!order.discount && <p><span>Saving</span><b>−RM{Number(order.discount).toFixed(2)}</b></p>}
          <p><span>Delivery</span><b>{order.shipping ? `RM${Number(order.shipping).toFixed(2)}` : "Complimentary"}</b></p>
        </div>
        {receipt && <div className={`receipt-state receipt-state--${receipt.status}`}><ShieldCheck /><div><b>{receipt.status === "verified" ? "Payment verified" : receipt.status === "rejected" ? "Receipt needs attention" : "Receipt under review"}</b><p>{receipt.reviewNote || `${receipt.originalName} · ${receipt.paymentMethodName || "manual payment"}`}</p></div></div>}
        {pending && (!receipt || receipt.status === "rejected") && (
          <form className="manual-payment" onSubmit={submit}>
            <div className="manual-payment__heading"><CreditCard /><div><b>Complete manual payment</b><p>Choose where to pay, then upload your receipt here. We verify every payment manually.</p></div></div>
            {!methods.length ? <p className="form-alert">Payment destinations are being prepared. Please contact support before transferring.</p> : <>
              <div className="payment-method-tabs">{methods.map((item) => <button type="button" className={item.id === methodId ? "is-selected" : ""} onClick={() => setMethodId(item.id)} key={item.id}>{item.name}</button>)}</div>
              {method && <div className="payment-destination">
                {method.qrImage && <img src={method.qrImage} alt={`${method.name} payment QR`} />}
                <div><h4>{method.name}</h4>{method.bankName && <p>{method.bankName}</p>}{method.accountName && <p>Account name: <b>{method.accountName}</b></p>}{method.accountNumber && <p>Account number: <b>{method.accountNumber}</b> <button type="button" onClick={() => void navigator.clipboard?.writeText(method.accountNumber || "")}>Copy</button></p>}<small>{method.instructions}</small></div>
              </div>}
              <div className="form-grid"><label>Payment reference (optional)<input value={reference} maxLength={160} onChange={(event) => setReference(event.target.value)} placeholder="Bank reference or sender name" /></label><label>Short note (optional)<input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Anything our team should know" /></label><label className="full receipt-upload"><Upload /><span>{file ? file.name : "Choose receipt image or PDF"}<small>JPEG, PNG, WebP or PDF · up to 8 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></label></div>
              {error && <p className="form-alert" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
              <button className="button button--dark" disabled={busy || !file}>{busy ? "Uploading…" : "Submit receipt for verification"}</button>
            </>}
          </form>
        )}
      </div>
    </details>
  );
}

function EmptyAccount({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="account-empty">
      <span>{icon}</span>
      <h4>{title}</h4>
      <p>{copy}</p>
    </div>
  );
}

function CustomerPasswordChange() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Your password has been changed.");
      setOpen(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="customer-password">
      <div>
        <span>
          <ShieldCheck />
        </span>
        <div>
          <h3>Password & security</h3>
          <p>Use a unique password you do not use anywhere else.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setError("");
          }}
        >
          {open ? "Cancel" : "Change password"}
        </button>
      </div>
      {notice && (
        <p className="form-success" role="status">
          <Check size={15} />
          {notice}
        </p>
      )}
      {open && (
        <form className="account-form" onSubmit={submit}>
          <p className="password-help">
            Use any 8 or more characters. Capitals, numbers and symbols are
            optional.
          </p>
          <div className="form-grid">
            <label className="full">
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
                minLength={8}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                required
              />
            </label>
          </div>
          {error && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}
          <button className="button button--dark" disabled={busy}>
            {busy ? "Changing password…" : "Save new password"}
            <ShieldCheck size={15} />
          </button>
        </form>
      )}
    </section>
  );
}
