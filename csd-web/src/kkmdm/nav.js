// KKMDM's pages navigate with go("/devices/<id>"); in CSD that is /mdm/devices/<id>
// through CSD's router (set by the KKMDM shell).
let navigateFn = null;
export const setNavigate = (fn) => {
  navigateFn = fn;
};
export const go = (path) => {
  const to = `/mdm${path.startsWith("/") ? path : `/${path}`}`;
  if (navigateFn) navigateFn(to);
  else window.location.assign(to);
};
