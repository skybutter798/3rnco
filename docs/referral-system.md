# Referral system

## Purpose

Each referral link belongs to one active customer. The link can independently control:

- shopper discount percentage;
- shopper discount scope: no discount, first purchase only, or every purchase;
- referrer commission percentage;
- browser attribution window;
- active dates and active/inactive status.

Example: `/?ref=skybutter` can give the shopper 15% off their first purchase while paying Sky Butter 15% commission on every order made by that directly attributed customer.

## Attribution rules

1. The storefront reads the `ref` query parameter and asks the server to validate it.
2. A valid code is retained in that browser for the link's configured attribution period.
3. The first order made with a valid code permanently assigns that customer to the referral owner.
4. A customer can have only one direct referrer. Later links cannot overwrite the assignment.
5. Self-referral is rejected by the server.
6. A disabled or out-of-date link cannot create a new attribution or shopper discount.

This is a single-level referral model: the owner earns from purchases by directly attributed customers only. It does not create multi-level or recursive commission.

## Discount rules

The server is authoritative. Browser calculations are for display only.

- `none`: no shopper discount; attribution and commission can still operate.
- `first_purchase`: apply the configured discount only when the customer has no prior non-cancelled order.
- `every_purchase`: apply the configured discount on each eligible order.

The referral discount is calculated after any bundle discount. Promo and referral discounts currently stack. The final discount cannot exceed the remaining merchandise subtotal.

## Commission rules

Commission is calculated from net merchandise value after bundle, promo, and referral discounts. Shipping and tax are excluded.

For a RM49.00 item with a 15% first-purchase discount and 15% commission:

- referral discount: RM7.35;
- commission basis: RM41.65;
- commission: RM6.25 after currency rounding.

Each order stores snapshots of its referral code, shopper discount, commission rate, basis, and commission amount. Editing a link affects future orders only.

## Commission lifecycle

- `pending`: order created but payment not confirmed;
- `approved`: payment confirmed or the order advances into fulfilment;
- `paid`: an administrator records the partner payout;
- `void`: order cancelled, reservation expired, or an administrator voids the commission.

Only approved commission can be marked paid. Pending or approved commission can be voided. These transitions and referral-link changes are included in the admin audit log.

## Admin workflow

Open **Admin > Referrals** to:

1. create or edit a referral link;
2. select the customer who owns the link;
3. set the code used in `?ref=...`;
4. configure the discount percentage and first/every/no-discount scope;
5. configure the commission percentage;
6. set the attribution days, active period, and status;
7. copy the complete storefront link;
8. review visits, downlines, paid orders, paid revenue, and pending/approved/paid commission;
9. export the commission report to CSV;
10. mark approved rows paid or void invalid rows.

Staff can be granted the dedicated `referrals` permission without receiving full owner access.

## Customer workflow

The referral owner signs in to the storefront and opens **My Account > My Referrals**. The dashboard shows:

- every referral link assigned to that account and a copyable share URL;
- the shopper discount rule and the owner's commission rate;
- visits, directly attributed customers, paid orders, and paid revenue;
- pending, approved, paid, and lifetime-earned commission totals;
- an order-level commission report with basis, rate, amount, and status.

The customer view never exposes the referred shopper's name, email, phone, or address. Customers can report on their own links and commissions, but only an administrator can change commercial terms or payout state.

## Customer administration

Open **Admin > Customers** to create an account or select **Manage** for an existing customer. Administrators can maintain the customer's name, email, phone, birth date, marketing consent, active/disabled status, temporary password, and all delivery addresses. The detailed view also contains sign-in state, recent orders, spend, owned referral links, and the link that referred the customer.

Changing an email clears its previous verification state. Setting a temporary password, changing an email, or disabling an account revokes its active sessions. Customer removal is implemented as a reversible account disable rather than deleting commerce history.

## Data model

- `referral_links`: configurable link and rate definitions;
- `customer_referrals`: permanent direct-customer attribution;
- `referral_visits`: privacy-reduced visit records using a visitor hash;
- `referral_commissions`: order-level commission ledger and payout status;
- `orders`: immutable referral snapshots for financial reconciliation.

Both supported production backends implement the same model: Cloudflare Worker/D1 and PHP with SQLite or MySQL.

## Operational controls

- Percentages are restricted to 0–100%.
- Referral codes accept lowercase letters, numbers, `_`, and `-` only.
- Codes are unique.
- Attribution windows are restricted to 1–365 days.
- Start/end dates are validated.
- Order creation remains idempotent, preventing duplicate commission from retries.
- Commission approval follows server-side payment status, never a browser claim.
- Existing history is retained when a referral link is disabled.
