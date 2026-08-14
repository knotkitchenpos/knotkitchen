import { useDispatch } from "react-redux";
import { getUserData } from "../https";
import { useEffect, useState } from "react";
import { removeUser, setUser } from "../redux/slices/userSlice";
import { useNavigate } from "react-router-dom";

const useLoadData = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchUser = async () => {
      try {
        const res = await getUserData();
        if (res && res.data && res.data.data) {
          const { _id, name, address, email, phone, role } = res.data.data;
          dispatch(setUser({ _id, name, address, email, phone, role }));
        }
      } catch (error) {
        dispatch(removeUser());
        if (
          window.location.pathname !== "/auth" &&
          !window.location.pathname.startsWith("/order") &&
          !window.location.pathname.startsWith("/pay") &&
          !window.location.pathname.startsWith("/store")
        ) {
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
