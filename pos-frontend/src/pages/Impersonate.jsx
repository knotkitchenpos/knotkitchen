import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { enqueueSnackbar } from "notistack";
import { impersonateWithSupportToken } from "../https";
import { setUser } from "../redux/slices/userSlice";
import { setActiveStoreId } from "../utils/storeSession";
import KnotLogo from "../components/shared/KnotLogo";

/**
 * /impersonate?token=... — one-shot CSD → POS handoff landing.
 *
 * The token is minted by CSD's createPosSession and travels only in the URL,
 * so this page consumes it on mount and immediately redirects. If it works,
 * the POS session cookie is set and the user is on / logged in as the
 * store's Owner. If it fails, we surface why and offer a way to the normal
 * sign-in screen instead of blanking out.
 */
const Impersonate = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("Missing support token.");
      return;
    }
    (async () => {
      try {
        const res = await impersonateWithSupportToken(token);
        const data = res.data?.data;
        if (!data?.user) throw new Error("Malformed response.");
        const { _id, name, address, email, phone, role, restaurantId, storeId } = data.user;
        // Same tab binding as a normal sign-in, so "Open POS" from CSD
        // lands on the right takeaway even when other takeaways (or the
        // owner's own account) are signed in in other tabs.
        setActiveStoreId(storeId);
        dispatch(setUser({ _id, name, address, email, phone, role, restaurantId, storeId }));
        enqueueSnackbar(
          `Signed in as ${name || role} · CSD support session${
            data.supportContext?.issuedBy ? ` (${data.supportContext.issuedBy})` : ""
          }`,
          { variant: "success" }
        );
        // Strip the token from the URL history so a back button doesn't leak it.
        navigate("/", { replace: true });
      } catch (err) {
        setError(
          err?.response?.data?.message ||
            err?.message ||
            "Could not open the POS with this support token."
        );
      }
    })();
  }, [params, dispatch, navigate]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#080F1F] p-4">
      <div className="max-w-md text-center">
        <div className="mb-6"><KnotLogo size="xl" showSubtitle={false} dark /></div>
        {!error ? (
          <p className="text-white/80 text-sm">Opening POS…</p>
        ) : (
          <>
            <p className="text-red-300 text-sm font-semibold">{error}</p>
            <button
              type="button"
              onClick={() => navigate("/auth", { replace: true })}
              className="mt-4 rounded-xl bg-white/10 border border-white/20 px-5 py-2.5 text-sm text-white hover:bg-white/20"
            >
              Go to sign-in
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default Impersonate;
