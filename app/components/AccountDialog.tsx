"use client";

import { ArrowRight, Check, Eye, EyeOff, Leaf, LogOut, MapPin, Package, Pencil, Plus, Save, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, errorMessage } from "../lib/api";
import type { Address, AuthSession, AuthUser, CustomerProfile, StoreOrder, StoreSettings } from "../store-types";

type Props = {
  user: AuthUser | null;
  onSession: (user: AuthUser | null) => void;
  onClose: () => void;
  settings: StoreSettings;
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

const malaysiaStates = ["Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu"];

function unwrapProfile(value: CustomerProfile | { profile: CustomerProfile }): CustomerProfile {
  return "profile" in value ? value.profile : value;
}

function unwrapOrders(value: StoreOrder[] | { orders: StoreOrder[] }): StoreOrder[] {
  return Array.isArray(value) ? value : value.orders || [];
}

export default function AccountDialog({ user, onSession, onClose, settings }: Props) {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [tab, setTab] = useState<"profile" | "addresses" | "orders">("profile");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
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
          apiRequest<CustomerProfile | { profile: CustomerProfile }>("/profile"),
          apiRequest<StoreOrder[] | { orders: StoreOrder[] }>("/orders"),
        ]);
      })
      .then(([profileResult, orderResult]) => {
        if (cancelled) return;
        const nextProfile = unwrapProfile(profileResult);
        setProfile(nextProfile);
        setFullName(nextProfile.fullName || "");
        setPhone(nextProfile.phone || "");
        setOrders(unwrapOrders(orderResult));
      })
      .catch((reason) => !cancelled && setError(errorMessage(reason)))
      .finally(() => !cancelled && setLoadingAccount(false));
    return () => { cancelled = true; };
  }, [isCustomer, user?.id]);

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
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
      const result = await apiRequest<AuthSession>(authMode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: authMode === "register" ? { fullName, email, phone, password } : { email, password },
      });
      if (!result.user) throw new Error("Your account session could not be started.");
      onSession(result.user);
      setPassword("");
      setConfirmPassword("");
      setNotice(authMode === "register" ? "Welcome to 3R&Co. Your account is ready." : "Welcome back.");
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
      const result = await apiRequest<CustomerProfile | { profile: CustomerProfile }>("/profile", {
        method: "PATCH",
        body: { fullName, phone, birthDate: profile.birthDate || null, marketingConsent: !!profile.marketingConsent },
      });
      const nextProfile = unwrapProfile(result);
      setProfile(nextProfile);
      onSession({ ...user!, fullName: nextProfile.fullName, phone: nextProfile.phone });
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
      const path = addressDraft.id ? `/profile/addresses/${addressDraft.id}` : "/profile/addresses";
      const result = await apiRequest<Address | { address: Address }>(path, {
        method: addressDraft.id ? "PATCH" : "POST",
        body: addressDraft,
      });
      const saved = "address" in result ? result.address : result;
      setProfile((current) => current ? {
        ...current,
        addresses: addressDraft.id
          ? current.addresses.map((address) => address.id === saved.id ? saved : address)
          : [...current.addresses, saved],
      } : current);
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
      await apiRequest(`/profile/addresses/${address.id}`, { method: "DELETE" });
      setProfile((current) => current ? { ...current, addresses: current.addresses.filter((item) => item.id !== address.id) } : current);
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
    <div className="account-overlay" role="dialog" aria-modal="true" aria-label={isCustomer ? "My 3R&Co account" : "Sign in or register"}>
      <button className="overlay-backdrop" onClick={onClose} aria-label="Close account" />
      <section className="account-dialog">
        <button className="account-dialog__close" onClick={onClose} aria-label="Close account"><X /></button>
        <aside className="account-dialog__art">
          <img src="/images/generated-v3/moringa-study-v3.webp" alt="Fresh moringa, kaffir lime, black seed and botanical oils" />
          <div><Leaf /><p className="eyebrow">Your care, gathered</p><h2>A quieter place<br /><em>to return to.</em></h2><p>Keep your details, delivery addresses and ritual history together.</p></div>
        </aside>

        {!user ? (
          <div className="account-auth">
            <div className="account-auth__tabs" role="tablist" aria-label="Account access"><button className={authMode === "login" ? "is-active" : ""} onClick={() => { setAuthMode("login"); setError(""); }} role="tab" aria-selected={authMode === "login"}>Sign in</button><button className={authMode === "register" ? "is-active" : ""} onClick={() => { setAuthMode("register"); setError(""); }} role="tab" aria-selected={authMode === "register"}>Create account</button></div>
            <p className="eyebrow">3R&Co account</p>
            <h2>{authMode === "login" ? "Welcome back." : "Begin your ritual."}</h2>
            <p>{authMode === "login" ? "Sign in to continue to your profile and orders." : "Create an account for checkout, saved addresses and order history."}</p>
            <form onSubmit={authenticate} className="account-form">
              {authMode === "register" && <><label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required /></label><label>Mobile number<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" autoComplete="tel" required /></label></>}
              <label>Email address<input value={email} onChange={(event) => setEmail(event.target.value)} type="text" inputMode="email" autoComplete="username" required /></label>
              <label>Password<span className="password-field"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={authMode === "register" ? 10 : undefined} autoComplete={authMode === "login" ? "current-password" : "new-password"} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff /> : <Eye />}</button></span></label>
              {authMode === "register" && <label>Confirm password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type={showPassword ? "text" : "password"} minLength={10} autoComplete="new-password" required /></label>}
              {error && <p className="form-alert" role="alert">{error}</p>}
              {notice && <p className="form-success" role="status"><Check size={15} />{notice}</p>}
              <button className="button button--dark button--wide" disabled={busy}>{busy ? "Please wait…" : authMode === "login" ? "Sign in" : "Create my account"}<ArrowRight size={16} /></button>
            </form>
            <p className="account-auth__care"><ShieldCheck size={16} /> Your password is sent only to the secure 3R&Co account service.</p>
          </div>
        ) : !isCustomer ? (
          <div className="account-auth"><p className="eyebrow">Admin account</p><h2>Signed in as {user.fullName || user.email}.</h2><p>Use the Admin portal to manage the store, or sign out to access a customer account.</p>{error && <p className="form-alert">{error}</p>}<button className="button button--dark" onClick={logout} disabled={busy}><LogOut size={16} /> Sign out</button></div>
        ) : (
          <div className="account-home">
            <header><div><p className="eyebrow">My 3R&Co</p><h2>Hello, {user.fullName?.split(" ")[0] || "there"}.</h2><p>{user.email}</p></div><button onClick={logout} disabled={busy}><LogOut size={16} /> Sign out</button></header>
            <nav aria-label="Account sections"><button className={tab === "profile" ? "is-active" : ""} onClick={() => setTab("profile")}><UserRound size={17} />Profile</button><button className={tab === "addresses" ? "is-active" : ""} onClick={() => setTab("addresses")}><MapPin size={17} />Addresses</button><button className={tab === "orders" ? "is-active" : ""} onClick={() => setTab("orders")}><Package size={17} />Orders</button></nav>
            {loadingAccount ? <div className="account-loading"><Leaf /> Gathering your details…</div> : <div className="account-panel">
              {error && <p className="form-alert" role="alert">{error}</p>}
              {notice && <p className="form-success" role="status"><Check size={15} />{notice}</p>}
              {tab === "profile" && profile && <><form className="account-form account-form--profile" onSubmit={saveProfile}><div className="account-panel__heading"><div><p className="eyebrow">Personal details</p><h3>Your profile</h3></div><button className="button button--dark" disabled={busy}><Save size={15} /> Save profile</button></div><div className="form-grid"><label className="full">Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required /></label><label>Email address<input value={profile.email} readOnly /></label><label>Mobile number<input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" required /></label><label>Date of birth<input type="date" value={profile.birthDate || ""} onChange={(event) => setProfile({ ...profile, birthDate: event.target.value })} /></label><label className="check-field"><input type="checkbox" checked={!!profile.marketingConsent} onChange={(event) => setProfile({ ...profile, marketingConsent: event.target.checked })} />Receive occasional ritual notes and offers</label></div></form><CustomerPasswordChange /></>}
              {tab === "addresses" && profile && <div><div className="account-panel__heading"><div><p className="eyebrow">Delivery</p><h3>Saved addresses</h3></div><button className="button button--dark" onClick={() => setAddressDraft({ ...blankAddress, recipientName: profile.fullName, phone: profile.phone || "" })}><Plus size={15} /> Add address</button></div>{!profile.addresses.length ? <EmptyAccount icon={<MapPin />} title="No saved addresses yet." copy="Add a delivery address to make checkout a little calmer." /> : <div className="address-list">{profile.addresses.map((address) => <article key={address.id || address.line1}><span><MapPin /></span><div><h4>{address.label}{address.isDefault && <b>Default</b>}</h4><p>{address.recipientName} · {address.phone}<br />{address.line1}{address.line2 ? `, ${address.line2}` : ""}<br />{address.postcode} {address.city}, {address.state}</p></div><div><button onClick={() => setAddressDraft(address)} aria-label={`Edit ${address.label}`}><Pencil /></button><button onClick={() => deleteAddress(address)} aria-label={`Remove ${address.label}`}><Trash2 /></button></div></article>)}</div>}{addressDraft && <form className="address-editor" onSubmit={saveAddress}><div className="account-panel__heading"><h3>{addressDraft.id ? "Edit address" : "New address"}</h3><button type="button" onClick={() => setAddressDraft(null)}><X /></button></div><div className="form-grid"><label>Label<input value={addressDraft.label} onChange={(event) => setAddressDraft({ ...addressDraft, label: event.target.value })} required /></label><label>Recipient<input value={addressDraft.recipientName} onChange={(event) => setAddressDraft({ ...addressDraft, recipientName: event.target.value })} required /></label><label className="full">Mobile number<input value={addressDraft.phone} onChange={(event) => setAddressDraft({ ...addressDraft, phone: event.target.value })} required /></label><label className="full">Address line 1<input value={addressDraft.line1} onChange={(event) => setAddressDraft({ ...addressDraft, line1: event.target.value })} required /></label><label className="full">Address line 2<input value={addressDraft.line2 || ""} onChange={(event) => setAddressDraft({ ...addressDraft, line2: event.target.value })} /></label><label>City<input value={addressDraft.city} onChange={(event) => setAddressDraft({ ...addressDraft, city: event.target.value })} required /></label><label>Postcode<input inputMode="numeric" maxLength={5} value={addressDraft.postcode} onChange={(event) => setAddressDraft({ ...addressDraft, postcode: event.target.value.replace(/\D/g, "") })} required /></label><label className="full">State<select value={addressDraft.state} onChange={(event) => setAddressDraft({ ...addressDraft, state: event.target.value })}>{malaysiaStates.map((state) => <option key={state}>{state}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={!!addressDraft.isDefault} onChange={(event) => setAddressDraft({ ...addressDraft, isDefault: event.target.checked })} />Use as default delivery address</label></div><button className="button button--dark" disabled={busy}><Save size={15} /> Save address</button></form>}</div>}
              {tab === "orders" && <div><div className="account-panel__heading"><div><p className="eyebrow">Order history</p><h3>Your rituals</h3></div></div>{!sortedOrders.length ? <EmptyAccount icon={<Package />} title="No orders yet." copy="Your first completed checkout will appear here." /> : <div className="account-orders">{sortedOrders.map((order) => <article key={order.id}><div><span>{order.orderNumber || order.id}</span><time>{new Date(order.createdAt).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</time></div><p>{order.lines?.map((line) => `${line.name} ×${line.quantity}`).join(", ") || order.items || "3R&Co ritual"}</p><strong>RM{Number(order.total).toFixed(2)}</strong><b>{order.status}</b></article>)}</div>}</div>}
            </div>}
          </div>
        )}
        <a className="account-support" href={`mailto:${settings.supportEmail}`}>Need account help? {settings.supportEmail}</a>
      </section>
    </div>
  );
}

function EmptyAccount({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="account-empty"><span>{icon}</span><h4>{title}</h4><p>{copy}</p></div>;
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
    if (newPassword !== confirmPassword) { setError("New passwords do not match."); return; }
    setBusy(true);
    try {
      await apiRequest("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
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

  return <section className="customer-password"><div><span><ShieldCheck /></span><div><h3>Password & security</h3><p>Use a unique password you do not use anywhere else.</p></div><button type="button" onClick={() => { setOpen((value) => !value); setError(""); }}>{open ? "Cancel" : "Change password"}</button></div>{notice && <p className="form-success" role="status"><Check size={15} />{notice}</p>}{open && <form className="account-form" onSubmit={submit}><div className="form-grid"><label className="full">Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label><label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} autoComplete="new-password" required /></label><label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} autoComplete="new-password" required /></label></div>{error && <p className="form-alert" role="alert">{error}</p>}<button className="button button--dark" disabled={busy}>{busy ? "Changing password…" : "Save new password"}<ShieldCheck size={15} /></button></form>}</section>;
}
