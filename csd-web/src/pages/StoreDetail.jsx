import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FiArrowLeft, FiExternalLink } from "react-icons/fi";
import { stores, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");

const Row = ({ label, children }) => (
  <div className="flex flex-col gap-1 border-b border-navy-100 py-3 last:border-b-0 sm:flex-row">
    <dt className="w-52 shrink-0 text-xs font-semibold uppercase tracking-wider text-navy-500">
      {label}
    </dt>
    <dd className="text-sm text-navy-900">{children ?? "—"}</dd>
  </div>
);

const StoreDetail = () => {
  const { storeId } = useParams();
  const [store, setStore] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    stores
      .get(storeId)
      .then((d) => alive && setStore(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load this store.")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [storeId]);

  if (loading) return <p className="text-sm text-navy-500">Loading store…</p>;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to="/stores" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
          <FiArrowLeft aria-hidden="true" /> Back to stores
        </Link>
        <p className="mt-6 text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const r = store.restaurant;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/stores" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
        <FiArrowLeft aria-hidden="true" /> Back to stores
      </Link>

      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-navy-900">{store.restaurantName}</h1>
        <StatusBadge status={store.status} />
        <span className="rounded-lg bg-navy-100 px-2 py-1 font-mono text-sm text-navy-700">
          {store.storeId}
        </span>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-navy-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Owner</h2>
          <dl>
            <Row label="Owner name">{store.ownerName}</Row>
            <Row label="Owner phone">{store.ownerPhone ? `+91 ${store.ownerPhone}` : null}</Row>
            <Row label="Owner email">{r?.ownerEmail}</Row>
          </dl>
        </section>

        <section className="rounded-2xl border border-navy-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Location</h2>
          <dl>
            <Row label="Address">{store.address}</Row>
            <Row label="City">{store.city}</Row>
            <Row label="State">{store.state}</Row>
            <Row label="PIN code">{r?.address?.postalCode}</Row>
            <Row label="Maps">
              {r?.mapsLink ? (
                <a
                  href={r.mapsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
                >
                  Open in Maps <FiExternalLink aria-hidden="true" />
                </a>
              ) : null}
            </Row>
          </dl>
        </section>

        <section className="rounded-2xl border border-navy-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Compliance</h2>
          <dl>
            <Row label="GSTIN">{r?.taxId}</Row>
            <Row label="FSSAI number">{r?.fssaiNumber}</Row>
            <Row label="Legal name">{r?.legalName}</Row>
          </dl>
        </section>

        <section className="rounded-2xl border border-navy-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Account</h2>
          <dl>
            <Row label="Status"><StatusBadge status={store.status} /></Row>
            {store.closedUntil && <Row label="Closed until">{fmt(store.closedUntil)}</Row>}
            <Row label="Plan">{r?.subscription?.plan}</Row>
            <Row label="Subscription">{r?.subscription?.status}</Row>
            <Row label="Currency">{r?.currency}</Row>
            <Row label="Registered on">{fmt(store.createdAt)}</Row>
          </dl>
        </section>
      </div>

      <p className="mt-5 text-xs text-navy-500">
        Orders for this store will be searchable from the Search Console in phase 3.
      </p>
    </div>
  );
};

export default StoreDetail;
