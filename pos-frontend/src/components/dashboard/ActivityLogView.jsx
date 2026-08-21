import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivityLogs } from "../../https";

const ActivityLogView = () => {
  const [page, setPage] = useState(1);
  const [date, setDate] = useState("");
  const [phone, setPhone] = useState("");
  const [action, setAction] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);

  const { data: logRes, isLoading, refetch } = useQuery({
    queryKey: ["activity-logs", page, date, phone, action],
    queryFn: () => getActivityLogs({ page, limit: 30, date, phone, action }),
  });

  const logs = logRes?.data?.data || [];
  const pagination = logRes?.data?.pagination || { total: 0, pages: 1 };

  const formatVal = (v) => {
    if (v === null || v === undefined || v === "") return "(empty)";
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  };

  return (
    <div className="space-y-5">
      {/* Header & Filters */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-[16px] font-extrabold text-[#0F172A]">Activity Log & Audit Trail</h4>
          <p className="text-[12px] text-[#94A3B8]">Immutable append-only record of all protected and sensitive store changes.</p>
        </div>

        {/* Filter controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Filter by Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setPage(1); }}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Filter by Phone</label>
            <input
              type="text"
              placeholder="e.g. 9876543210"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPage(1); }}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Filter by Action</label>
            <input
              placeholder="e.g. Delivery Charge, Staff, PIN"
              value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); }}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
        </div>

        {(date || phone || action) && (
          <div className="flex justify-end">
            <button
              onClick={() => { setDate(""); setPhone(""); setAction(""); setPage(1); }}
              className="text-xs font-bold text-[#5B42F3] hover:underline"
            >
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Logs Table / List */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        {isLoading ? (
          <div className="p-8 text-center text-[#94A3B8]">Loading activity log…</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-[#94A3B8]">No activity log records found matching your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[#94A3B8] text-[11.5px] font-bold uppercase">
                  <th className="pb-3 px-2">Date & Time</th>
                  <th className="pb-3 px-2">User / Role</th>
                  <th className="pb-3 px-2">Phone</th>
                  <th className="pb-3 px-2">Action</th>
                  <th className="pb-3 px-2">What Changed</th>
                  <th className="pb-3 px-2 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {logs.map((log) => (
                  <tr key={log._id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-3 px-2 whitespace-nowrap">
                      <p className="font-bold text-[#0F172A]">{log.dateFormatted || new Date(log.createdAt).toLocaleDateString()}</p>
                      <p className="text-[11px] text-[#94A3B8]">{log.timeFormatted || new Date(log.createdAt).toLocaleTimeString()}</p>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                        log.role === "Owner" || log.role === "owner"
                          ? "bg-[#F5F3FF] text-[#5B42F3]"
                          : "bg-[#F1F5F9] text-[#475569]"
                      }`}>
                        {log.role || "Staff"}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-mono text-[#334155]">{log.phone || "N/A"}</td>
                    <td className="py-3 px-2 font-extrabold text-[#0F172A]">{log.action}</td>
                    <td className="py-3 px-2 text-[#475569] max-w-xs truncate">{log.description || log.resource}</td>
                    <td className="py-3 px-2 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="px-3 py-1 rounded-xl border border-[#E2E8F0] text-[#5B42F3] font-bold text-[12px] hover:bg-[#EEF0FE]"
                      >
                        View Diff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-[#E2E8F0] text-xs font-bold text-[#475569]">
            <span>Page {pagination.page} of {pagination.pages} ({pagination.total} records)</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-xl border border-[#E2E8F0] disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= pagination.pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-xl border border-[#E2E8F0] disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Detail Drawer / Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h3 className="text-base font-extrabold text-[#0F172A]">{selectedLog.action}</h3>
                <p className="text-xs text-[#94A3B8]">{selectedLog.dateFormatted} at {selectedLog.timeFormatted}</p>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-[#94A3B8] text-xl font-bold hover:text-[#475569]"
              >
                ×
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p><strong className="text-[#334155]">User Phone:</strong> {selectedLog.phone || "N/A"}</p>
              <p><strong className="text-[#334155]">User Role:</strong> {selectedLog.role || "Staff"}</p>
              <p><strong className="text-[#334155]">Resource / Entity:</strong> {selectedLog.resource || selectedLog.entityType}</p>
              <p><strong className="text-[#334155]">Description:</strong> {selectedLog.description}</p>
            </div>

            {/* Old vs New Value Diff */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2">
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] space-y-1">
                <p className="font-extrabold text-[#DC2626] uppercase text-[11px]">Previous Value</p>
                <pre className="font-mono text-[11px] text-[#991B1B] overflow-x-auto whitespace-pre-wrap break-all">
                  {formatVal(selectedLog.previousValue)}
                </pre>
              </div>
              <div className="p-3 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] space-y-1">
                <p className="font-extrabold text-[#16A34A] uppercase text-[11px]">New Value</p>
                <pre className="font-mono text-[11px] text-[#065F46] overflow-x-auto whitespace-pre-wrap break-all">
                  {formatVal(selectedLog.newValue)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-5 py-2 rounded-xl bg-[#5B42F3] text-white font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityLogView;
