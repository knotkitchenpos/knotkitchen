// Light / dark / follow the phone.
export const applyTheme = () => {
  const pref = localStorage.getItem("kkb.theme") || "system";
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
};
