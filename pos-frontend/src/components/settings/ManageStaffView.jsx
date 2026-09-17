import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { addStaffMember, deleteStaffMember, getStaffMembers } from "../../https";

/* ---------- Module 7 §8 & §9: Manage Staff ---------- */
const ManageStaffView = () => {
  const qc = useQueryClient();
  const user = useSelector((s) => s.user);
  const isOwner = user?.role === "Owner" || user?.role === "owner";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const { data: staffRes, isLoading } = useQuery({ queryKey: ["staff-members"], queryFn: getStaffMembers, enabled: isOwner });
  const staffList = staffRes?.data?.data || [];

  const addMutation = useMutation({
    mutationFn: addStaffMember,
    onSuccess: () => {
      enqueueSnackbar("Staff member added successfully!", { variant: "success" });
      setName("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["staff-members"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add staff", { variant: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteStaffMember,
    onSuccess: () => {
      enqueueSnackbar("Staff member deleted!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["staff-members"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to delete", { variant: "error" }),
  });

  if (!isOwner) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 text-[13px] text-[#DC2626] font-bold">
        🔒 Action Restricted: Only the Store Owner can manage staff members and permissions. Staff PIN verification is not sufficient for this operation.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Add Staff */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Add Staff Member</h4>
          <p className="text-[12px] text-[#94A3B8]">Staff members sign in with the Store ID and their registered phone number.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Staff Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Staff Phone Number (10 digits)</label>
            <input
              type="tel"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => addMutation.mutate({ name, phone })}
            disabled={addMutation.isPending}
            className="h-[40px] px-5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            {addMutation.isPending ? "Adding…" : "Add Staff Member"}
          </button>
        </div>
      </div>

      {/* Staff List */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-3">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">Staff Members ({staffList.length})</h4>
        {isLoading ? (
          <p className="text-[13px] text-[#94A3B8]">Loading staff list…</p>
        ) : staffList.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">No staff members registered yet.</p>
        ) : (
          <div className="space-y-2">
            {staffList.map((s) => (
              <div key={s._id} className="flex items-center justify-between p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[13px]">
                <div>
                  <p className="font-extrabold text-[#0F172A]">{s.name}</p>
                  <p className="text-[11.5px] text-[#64748B]">Phone: {s.phone} · Role: {s.role}</p>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(s._id)}
                  disabled={deleteMutation.isPending}
                  className="h-8 px-3 rounded-lg border border-[#FECACA] text-[#DC2626] font-bold text-[12px] hover:bg-[#FEF2F2]"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManageStaffView;
