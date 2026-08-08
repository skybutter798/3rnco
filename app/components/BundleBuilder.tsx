"use client";

import { ArrowRight, Check, Leaf, ShoppingBag, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Bundle, Product } from "../store-types";

export default function BundleBuilder({
  bundle,
  products,
  onClose,
  onAdd,
}: {
  bundle: Bundle;
  products: Product[];
  onClose: () => void;
  onAdd: (productIds: string[], selections: Record<string, string>) => void;
}) {
  const steps = bundle.steps.filter((step) => step.productIds.length);
  const firstAvailable = (productIds: string[]) =>
    productIds.find((id) => {
      const product = products.find((item) => item.id === id);
      return product && product.active !== false && Number(product.stock) > 0;
    }) || "";
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      steps.map((step) => [step.id, firstAvailable(step.productIds)]),
    ),
  );

  const selectedProducts = useMemo(
    () =>
      steps
        .map((step) =>
          products.find(
            (product) =>
              product.id === selections[step.id] &&
              product.active !== false &&
              Number(product.stock) > 0,
          ),
        )
        .filter(Boolean) as Product[],
    [products, selections, steps],
  );
  const complete =
    steps.length > 0 &&
    selectedProducts.length === steps.length &&
    selectedProducts.every((product) => Number(product.stock) > 0);
  const subtotal = selectedProducts.reduce(
    (sum, product) => sum + Number(product.price),
    0,
  );
  const discount =
    bundle.discountType === "percentage"
      ? (subtotal * Number(bundle.discountValue || 0)) / 100
      : bundle.discountType === "fixed"
        ? Number(bundle.discountValue || 0)
      : 0;
  const hasOffer = bundle.discountType !== "none" && Number(bundle.discountValue || 0) > 0;
  const total = Math.max(0, subtotal - Math.min(subtotal, discount));

  return (
    <div
      className="bundle-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={bundle.name}
    >
      <button
        className="overlay-backdrop"
        onClick={onClose}
        aria-label="Close set builder"
      />
      <section className="bundle-builder">
        <button
          className="bundle-builder__close"
          onClick={onClose}
          aria-label="Close set builder"
        >
          <X />
        </button>
        <header>
          <div>
            <p className="eyebrow">Mix & match</p>
            <h2>{bundle.title || bundle.name}</h2>
            <p>{bundle.description}</p>
          {hasOffer && (
              <span className="bundle-builder__offer">
                {bundle.discountType === "percentage"
                  ? `${bundle.discountValue}% set saving`
                  : `RM${Number(bundle.discountValue).toFixed(2)} set saving`}
              </span>
            )}
          </div>
          <Leaf />
        </header>
        <div className="bundle-steps">
          {steps.map((step, index) => (
            <fieldset key={step.id}>
              <legend>
                <span>0{index + 1}</span>
                <div>
                  <b>{step.label}</b>
                  {step.description && <small>{step.description}</small>}
                </div>
              </legend>
              <div>
                {step.productIds.map((productId) => {
                  const product = products.find(
                    (item) => item.id === productId,
                  );
                  if (!product || product.active === false) return null;
                  const unavailable = Number(product.stock) <= 0;
                  const selected = selections[step.id] === productId;
                  return (
                    <button
                      type="button"
                      className={`${selected ? "is-selected" : ""} ${unavailable ? "is-unavailable" : ""}`}
                      disabled={unavailable}
                      onClick={() =>
                        setSelections((current) => ({
                          ...current,
                          [step.id]: productId,
                        }))
                      }
                      aria-pressed={selected}
                      key={productId}
                    >
                      <img src={product.editorial || product.image} alt="" />
                      <span>
                        <small>
                          {unavailable ? "Unavailable" : product.badge}
                        </small>
                        <b>{product.name}</b>
                        <em>
                          {unavailable
                            ? "Restocking soon"
                            : `RM${Number(product.price).toFixed(2)}`}
                        </em>
                      </span>
                      {selected && !unavailable && (
                        <i>
                          <Check />
                        </i>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <footer>
          <div>
            <span>{bundle.name}</span>
            <strong>RM{total.toFixed(2)}</strong>
            {discount > 0 && complete && <del>RM{subtotal.toFixed(2)}</del>}
            <small>
              {complete
                ? selectedProducts
                    .map((product) => product.shortName || product.name)
                    .join(" + ")
                : "Choose one available product in each step"}
            </small>
          </div>
          <button
            className="button button--dark"
            disabled={!complete}
            onClick={() =>
              complete &&
              onAdd(
                selectedProducts.map((product) => product.id),
                selections,
              )
            }
          >
            Add set to ritual <ShoppingBag size={16} />
            <ArrowRight size={15} />
          </button>
        </footer>
      </section>
    </div>
  );
}
