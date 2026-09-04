import { useDispatch } from "react-redux";
import { getUserData } from "../https";
import { setActiveStoreId } from "../utils/storeSession";
import { useEffect, useState } from "react";
import { removeUser, setUser } from "../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";
import { isPublicPath } from "../utils/publicRoutes";

const useLoadData = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

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
        dispatch(removeUser());
        if (!isPublicPath()) navigate("/auth");
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
