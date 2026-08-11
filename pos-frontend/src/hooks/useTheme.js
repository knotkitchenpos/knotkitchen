import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setThemeMode } from "../redux/slices/themeSlice";

export const useTheme = () => {
  const dispatch = useDispatch();
  const mode = useSelector((state) => state.theme.mode);

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      if (mode === "system") {
        root.classList.remove("light", "dark");
        root.classList.add(mediaQuery.matches ? "dark" : "light");
      } else {
        root.classList.remove("light", "dark");
        root.classList.add(mode);
      }
    };

    applyTheme();

    if (mode === "system") {
      const onChange = () => applyTheme();
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }
  }, [mode]);

  const setTheme = (newMode) => {
    dispatch(setThemeMode(newMode));
  };

  return { mode, setTheme };
};