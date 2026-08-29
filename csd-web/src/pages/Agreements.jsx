import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiArrowRight } from "react-icons/fi";
import { agreements as api, errorMessage } from "../api";
import AgreementStoreDialog from "../components/AgreementStoreDialog";

const Agreements = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(null);
  const [retrying, setRetrying] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api.list());
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Could not load agreements."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retry = async (id) => {
    setRetrying(id);
    try {
      await api.retryNotify(id);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not update the onboarding portal."));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Agreements</h1>
          <p className="mt-1 text-sm text-navy-500">
            Completed agreements from the onboarding portal, ready to become stores.
          </p>
        </div>
        <button type="button" onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-navy-300 px-3.5 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">
          <FiRefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </header>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* The portal link being unconfigured is a setup state, not an error —
          say what to do about it rather than showing an empty list. */}
      {data && !data.configured && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">The onboarding portal is not connected.</p>
            <p className="mt-1 text-xs">{data.message}</p>
          </div>
        </div>
      )}

      {data?.configured && (
        <>
          {data.pending > 0 && (
            <p className="mb-4 rounded-xl border border-brand-300 bg-brand-50 p-3 text-sm text-navy-800">
              <strong>{data.pending}</strong> completed agreement{data.pending === 1 ? "" : "s"} awaiting
              store creation.
            </p>
          )}

          {data.agreements.length === 0 ? (
            <p className="rounded-2xl border border-navy-200 bg-white p-8 text-center text-sm text-navy-500">
              No completed agreements yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-navy-200 bg-white">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Agreement</th>
                    <th scope="col" className="px-4 py-3">Restaurant</th>
                    <th scope="col" className="px-4 py-3">Owner</th>
                    <th scope="col" className="px-4 py-3">Sales agent</th>
                    <th scope="col" className="px-4 py-3">Store</th>
                    <th scope="col" className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agreements.map((a) => (
                    <tr key={a.id} className="border-b border-navy-100 last:border-b-0 hover:bg-navy-50">
                      <td className="px-4 py-3 font-mono text-xs text-navy-600">{a.id}</td>
                      <td className="px-4 py-3 font-medium text-navy-900">{a.restaurantName || "—"}</td>
                      <td className="px-4 py-3 text-navy-700">{a.ownerName || "—"}</td>
                      <td className="px-4 py-3 text-navy-700">{a.salesAgent || "—"}</td>
                      <td className="px-4 py-3">
                        {a.storeCreated ? (
                          <Link to={`/stores/${a.storeId}`}
                            className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-700 hover:underline">
                            <FiCheckCircle size={12} aria-hidden="true" /> {a.storeId}
                          </Link>
                        ) : (
                          <span className="text-xs text-navy-400">Not created</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.storeCreated ? (
                          <button type="button" disabled={retrying === a.id} onClick={() => retry(a.id)}
                            title="Re-notify the onboarding portal that a store exists"
                            className="text-xs font-semibold text-navy-500 hover:text-navy-800 disabled:opacity-50">
                            {retrying === a.id ? "Syncing…" : "Sync portal"}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setActive(a)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
                            Create store <FiArrowRight size={12} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {active && (
        <AgreementStoreDialog
          agreement={active}
          onClose={() => { setActive(null); load(); }}
          onCreated={load}
        />
      )}
    </div>
  );
};

export default Agreements;
