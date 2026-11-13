import React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MdLogout, MdDevices } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { dateGB, time12 } from "../../utils";
import { partnersApi, errorMessage } from "../api";

/** "Chrome on Android" from a user agent, roughly. */
const deviceOf = (ua = "") => {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
};

const Account = ({ me }) => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: sessions = [], refetch } = useQuery({
    queryKey: ["partner-sessions"],
    queryFn: () => partnersApi.sessions().then((r) => r.data.data),
  });
  const revokeOthers = useMutation({
    mutationFn: () => partnersApi.revokeOtherSessions(),
    onSuccess: (res) => {
      enqueueSnackbar(`Signed out of ${res.data.data.signedOut} other device(s).`, { variant: "success", important: true });
      refetch();
    },
    onError: (err) => enqueueSnackbar(errorMessage(err), { variant: "error" }),
  });
  const signOut = async () => {
    await partnersApi.logout().catch(() => {});
    qc.clear();
    navigate("/login", { replace: true });
  };

  return (
    <div className="space-y-5 max-w-[760px]">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Account</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Your Partners sign-in and where it is used.</p>
      </div>

      <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
        <dl className="grid sm:grid-cols-3 gap-4 text-[13px]">
          <div>
            <dt className="text-[#94A3B8] font-bold">Owner</dt>
            <dd className="font-extrabold text-[15px]">{me?.name || "—"}</dd>
          </div>
          <div>
            <dt className="text-[#94A3B8] font-bold">Phone</dt>
            <dd className="font-bold">{me?.phone || "—"}</dd>
          </div>
          <div>
            <dt className="text-[#94A3B8] font-bold">Stores linked</dt>
            <dd className="font-bold">{(me?.stores || []).length}</dd>
          </div>
        </dl>
        <p className="mt-4 text-[12.5px] text-[#64748B]">
          You sign in here with any linked store&apos;s Owner login. Passwords are each store&apos;s own: change one in that store&apos;s POS, then confirm it on the Stores page.
        </p>
      </section>

      <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-[15px] font-extrabold flex items-center gap-2">
            <MdDevices size={19} /> Signed-in devices
          </h2>
          <button
            type="button"
            onClick={() => revokeOthers.mutate()}
            disabled={revokeOthers.isPending || sessions.filter((s) => !s.current).length === 0}
            className="h-9 px-3.5 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#334155] hover:bg-[#F8FAFC] disabled:opacity-40"
          >
            Sign out other devices
          </button>
        </div>
        <ul className="divide-y divide-[#F1F5F9]">
          {sessions.map((s) => (
            <li key={s.id} className="py-3 flex items-center gap-3 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block font-bold truncate">
                  {deviceOf(s.userAgent)}
                  {s.current && <span className="ml-2 text-[11px] font-extrabold text-[#15803D] bg-[#DCFCE7] rounded-full px-2 py-0.5">This device</span>}
                </span>
                <span className="block text-[12px] text-[#94A3B8]">
                  Signed in {dateGB(s.createdAt)} · last active {dateGB(s.lastActiveAt)}, {time12(s.lastActiveAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <button type="button" onClick={signOut} className="h-12 px-5 rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold inline-flex items-center gap-2">
        <MdLogout size={18} /> Sign out
      </button>
    </div>
  );
};

export default Account;
