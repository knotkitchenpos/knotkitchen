import { createSlice } from "@reduxjs/toolkit";

const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem("knotkitchen-theme");
    if (saved && ["light", "dark", "system"].includes(saved)) {
      return saved;
    }
  } catch (e) {
    // ignore
  }
  return "system";
};

const initialState = {
  mode: getInitialTheme(),
};

const themeSlice = createSlice({
  name: "theme",
  initialState,
  reducers: {
    setThemeMode: (state, action) => {
      state.mode = action.payload;
      try {
        localStorage.setItem("knotkitchen-theme", action.payload);
      } catch (e) {
        // ignore
      }
    },
  },
});

export const { setThemeMode } = themeSlice.actions;
export default themeSlice.reducer;