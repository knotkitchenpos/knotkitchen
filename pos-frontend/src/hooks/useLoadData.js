import { useDispatch, useSelector } from "react-redux";
import { getUserData } from "../https";
import { setActiveStoreId } from "../utils/storeSession";
import { useEffect, useState } from "react";
import { removeUser, setUser } from "../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";
import { isPublicPath } from "../utils/publicRoutes";
import { rememberReturnTo } from "../utils/returnTo";

const useLoadData = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // A till already signed in on this device opens at once and checks its
  // session in the background. Waiting for /api/user first left the app on
  // the loading screen for as long as a dead connection took to give up:
  // offline-first means the saved session is enough to open (owner, 2026-10-29).
  const signedIn = useSelector((state) => Boolean(state.user?.isAuth));
  const [isLoading, setIsLoading] = useState(!signedIn);

  useEffect(() => {
    let isMounted = true;

    // A guest page never had a session to load. Asking for one costs a
    // guaranteed 401, and the axios interceptor turns that 401 into a hard
    // redirect to /auth before this hook's own catch block can decide
    // otherwise — which is how a diner scanning a table QR ended up on the
    // staff login screen. Skip the call entirely.
    if (isPublicPath()) {
      setIsLoading(false);
      return;
    }

    const fetchUser = async () => {
      try {
        const res = await getUserData();
        if (res && res.data && res.data.data) {
          const { _id, name, address, email, phone, role, restaurantId, storeId } = res.data.data;
          // Bind the tab to whichever takeaway this session actually
          // belongs to. For a session that predates per-store cookies this
          // is what starts sending x-store-id, so the next token refresh
          // re-issues it under the namespaced name and the session becomes
          // isolated without anyone having to sign in again.
          setActiveStoreId(storeId);
          dispatch(setUser({ _id, name, address, email, phone, role, restaurantId, storeId }));

        }
      } catch (error) {
        // N006: only the server refusing the session signs the tab out, never a lost connection.
        if (![401, 403].includes(error?.response?.status)) return;
        dispatch(removeUser());
        // Back here after sign-in (knotkitchen.com's Order opens /settings/billing?device=...).
        if (!isPublicPath()) {
          rememberReturnTo();
          navigate("/auth");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchUser();

    return () => {
      isMounted = false;
    };
  }, [dispatch, navigate]);

  return isLoading;
};

export default useLoadData;
