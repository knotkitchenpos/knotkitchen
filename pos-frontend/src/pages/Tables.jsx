import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import TableCard from "../components/tables/TableCard";
import GuestCountModal from "../components/tables/GuestCountModal";
import SessionDetailModal from "../components/tables/SessionDetailModal";
import TableSettleModal from "../components/tables/TableSettleModal";
import TablePickerModal from "../components/tables/TablePickerModal";
import { sendTableEBill } from "../utils/sendTableEBill";
import SecurityPinModal from "../components/common/SecurityPinModal";
import PrintTableQRModal from "../components/tables/PrintTableQRModal";
import { checkActionAuthorization } from "../utils/security";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTables,
  seatTableBooking,
  cancelTableBooking,
  addTable,
  updateTable,
  deleteTable,
  getTableById,
  getTableSessionById,
  moveTableSession,
  mergeTableSessions,
  recordTableSessionPayment,
  cancelTableSessionItem,
  releaseTable,
  getOrCreateTableQr,
} from "../https";
import { enqueueSnackbar } from "notistack";
// NOTE: `FiQrCode` does not exist in the `react-icons/fi` set — it was a
// bad copy-paste (probably meant `FaQrcode` from `fa`). Rather than pull
// in another icon package for a single glyph we render a small inline
// QR-style SVG locally (`IconQr` below) — this keeps the bundle lean
// and the previous unrelated build failure resolved.
import { FiGrid, FiPlus, FiTrash2, FiEdit2, FiLayers } from "react-icons/fi";
import { QRCodeCanvas } from "qrcode.react";
import { setOrderType } from "../redux/slices/orderTypeSlice";
import { updateTable as updateTableAction, setSessionId } from "../redux/slices/customerSlice";
import { readStoreScoped, writeStoreScoped } from "../utils/storeSession";
import { localDay } from "../utils";

const IconQr = ({ size = 13 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M20 14v3M14 20h3M20 20v-3" />
  </svg>
);

// No default floors or areas. The list used to be seeded with Ground Floor,
// Rooftop, VIP Area and friends, which every store had to look at whether or
// not they meant anything to it — and none of them could be removed. Areas now
// come only from what the operator creates, plus whatever their existing
// tables already sit in.

const Tables = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const user = useSelector((s) => s.user);

  const [selectedArea, setSelectedArea] = useState("all");
  // Persist operator-created floors/areas across reloads so a manager can
  // create "Executive Lounge" once and every biller sees it. LocalStorage
  // is fine for now — the true source of truth for an area is that at
  // least one table lives in it. Empty custom areas are convenience only.
  const [customAreas, setCustomAreas] = useState(() => {
    const parsed = readStoreScoped("kk_custom_areas", []);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string" && s.trim()) : [];
  });
  // Scoped to the ACTIVE STORE, same reason as the custom groups in
  // ManageMenu: one store's areas must not appear in another's.
  useEffect(() => {
    writeStoreScoped("kk_custom_areas", customAreas);
  }, [customAreas]);
  const [status, setStatus] = useState("all");

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [qrModalTable, setQrModalTable] = useState(null);
  const [settleTarget, setSettleTarget] = useState(null);
  const [qrFetching, setQrFetching] = useState(false);

  /**
   * The URL a table's QR code should carry.
   *
   * ALWAYS the server's, never one built from this browser's address bar.
   * The short QR host is deployment configuration (QR_PUBLIC_URL), and the
   * till is served from a different hostname entirely -- so composing
   * `window.location.origin + "/t/" + token` printed the POS's own hostname
   * onto every card, which is what kept the long link alive long after the
   * short one went live. The API rebuilds this from the token on every read.
   *
   * The origin is still the fallback, for the moment before the fetch lands
   * and for a deployment with no short host configured.
   */
  const qrLinkFor = (table) =>
    table?.qrCode || (table?.qrToken ? `${window.location.origin}/t/${table.qrToken}` : "");
  const [printModalTable, setPrintModalTable] = useState(null);
  const [isAreaModalOpen, setIsAreaModalOpen] = useState(false);
  const [newAreaInput, setNewAreaInput] = useState("");

  // How long a table rests after its bill is settled before it can be seated
  // again. Lives on the restaurant, not the browser, so every till agrees.


  // Add/Edit Form State
  const [displayId, setDisplayId] = useState("");
  const [area, setArea] = useState("Ground Floor");
  const [capacity, setCapacity] = useState(4);
  const [isEnabled, setIsEnabled] = useState(true);

  // Flow / Session Modals
  const [guestCountTable, setGuestCountTable] = useState(null);
  const [sessionTable, setSessionTable] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [, setSessionLoading] = useState(false);
  // Move the party to a free table / merge another table's tab into this one.
  const [picker, setPicker] = useState(null); // "move" | "merge"

  // Security PIN Modal
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  useEffect(() => {
    document.title = "KnotKitchen | Manage Tables";
  }, []);

  /*
   * Whenever the QR modal opens we ALWAYS make sure the table has a modern
   * secure TableQR entity behind it, by hitting `/api/table-qr/table/:tableId`.
   *
   * Why: the legacy `table.qrToken` stored on the Table document is a
   * 32-hex value produced by `crypto.randomBytes(16).toString("hex")`.
   * The `resolveTableScope` middleware — which every public QR endpoint
   * (`/api/qr/table/:token`) uses — only accepts 64-hex tokens minted
   * from the TableQR collection. So a QR code rendered from
   * `table.qrToken` alone would render, but scanning/opening it would
   * always come back "Invalid QR code." (§Security model).
   *
   * The backend endpoint returns the ACTIVE 64-hex token AND back-fills
   * `table.qrToken` + `table.qrCode` on the Table doc, so subsequent
   * renders show the correct URL immediately.
   */
  useEffect(() => {
    if (!qrModalTable?._id) return;
    // Deliberately NO "we already have a token, skip the fetch" shortcut.
    //
    // The printed URL is host + token, and the host is deployment config. The
    // cached `table.qrCode` on the row is whatever it was when the QR was
    // minted, so skipping the fetch printed the old hostname for every table
    // that already had a token -- which was all of them -- long after the
    // short link host went live. The server rebuilds the URL from the token
    // on every read, so asking it is the only way to be right.
    let cancelled = false;
    setQrFetching(true);
    getOrCreateTableQr(qrModalTable._id)
      .then((res) => {
        if (cancelled) return;
        const qr = res?.data?.data;
        if (!qr?.token) return;
        setQrModalTable((prev) =>
          prev ? { ...prev, qrToken: qr.token, qrCode: qr.qrUrl } : prev,
        );
        queryClient.invalidateQueries({ queryKey: ["tables"] });
      })
      .catch((err) => {
        const upgrade = err?.response?.data?.code === "PLAN_UPGRADE_REQUIRED";
        // No QR Table Ordering add-on: no QR at all, rather than an old one diners cannot use.
        if (upgrade && !cancelled) setQrModalTable(null);
        enqueueSnackbar(
          err?.response?.data?.message || "Failed to load QR for this table.",
          { variant: upgrade ? "warning" : "error" },
        );
      })
      .finally(() => {
        if (!cancelled) setQrFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrModalTable?._id]);

  const { data: resData, isError } = useQuery({
    queryKey: ["tables"],
    queryFn: async () => await getTables(),
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    // A settled table comes back to service on a server sweep, and the
    // cleaning countdown on each card is only as fresh as the last fetch.
    // Without this the floor view sat on a stale board until someone
    // reloaded the page. Matches the server sweep interval.
    refetchInterval: 20000,
  });

  if (isError) {
    enqueueSnackbar("Failed to load tables!", { variant: "error" });
  }

  const tables = resData?.data?.data || [];

  // Derive unique floor/area names from server tables + custom created areas
  const allAreas = Array.from(
    new Set([
      ...customAreas,
      ...tables.map((t) => t.area || t.floor || t.zone).filter(Boolean),
    ])
  );

  const executeProtected = (actionFn) => {
    const auth = checkActionAuthorization(user, { isOwnerOnly: false });
    if (auth.status === "REQUIRE_PIN") {
      setPendingAction(() => actionFn);
      setPinModalOpen(true);
      return;
    }
    actionFn();
  };

  /**
   * Settle a table and let it go.
   *
   * The server marks the session PAID, then CLOSED, then frees the table
   * immediately -- there is no cleaning wait. Because the closed session no
   * longer counts as active,
   * the next customer to scan the same QR gets a fresh order page -- the QR
   * itself never changes.
   */
  const closeSessionModal = () => {
    setPicker(null);
    setSessionTable(null);
    setSessionData(null);
    queryClient.invalidateQueries({ queryKey: ["tables"] });
  };
  const moveMutation = useMutation({
    mutationFn: ({ sessionId, tableId }) => moveTableSession(sessionId, tableId),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Party moved.", { variant: "success" });
      closeSessionModal();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not move the party.", { variant: "error" }),
  });
  const mergeMutation = useMutation({
    mutationFn: ({ sessionId, fromSessionId }) => mergeTableSessions(sessionId, fromSessionId),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Tables merged.", { variant: "success" });
      closeSessionModal();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not merge the tables.", { variant: "error" }),
  });

  const settleMutation = useMutation({
    mutationFn: ({ sessionId, method, amount, splits, tip, buyer }) =>
      recordTableSessionPayment(sessionId, {
        method,
        amount,
        splits,
        tip,
        buyer,
        // A double-tap on a slow connection must not take payment twice.
        idempotencyKey: `settle-${sessionId}-${method}-${amount}`,
      }),
    onSuccess: (res, vars) => {
      enqueueSnackbar(res?.data?.message || "Paid. The table is available again.", {
        variant: "success",
      });
      // Reported separately from the payment on purpose -- see the helper.
      if (vars?.sendEBill && vars?.phone) {
        sendTableEBill({ sessionId: vars.sessionId, phone: vars.phone, notify: enqueueSnackbar });
      }
      setSettleTarget(null);
      setSessionTable(null);
      setSessionData(null);
      queryClient.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Could not complete this table.", {
        variant: "error",
      }),
  });

  /**
   * Pull one dish off a live table order.
   *
   * A table order was write-only once placed: if the kitchen ran out of
   * something the only way to remove it was to void the whole session. The
   * cancellation lands on the session, the kitchen order and the bill, and
   * the diner sees it on their own QR page on the next poll.
   */
  const cancelItemMut = useMutation({
    mutationFn: ({ sessionId, itemId, reason }) =>
      cancelTableSessionItem(sessionId, itemId, { reason }),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Item cancelled.", { variant: "success" });
      // Show the operator the recalculated bill straight away.
      if (res?.data?.data) setSessionData(res.data.data);
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Could not cancel that item.", {
        variant: "error",
      }),
  });

  const handleCancelSessionItem = (item) => {
    const sessionId = sessionData?._id;
    if (!sessionId || !item?._id) return;
    if (!window.confirm(`Cancel "${item.name}" from this table's order?`)) return;
    const reason = (window.prompt("Reason (optional) — the customer will see this:", "") || "").trim();
    cancelItemMut.mutate({ sessionId, itemId: item._id, reason });
  };

  /**
   * Put a stranded table back into service.
   *
   * A party that cancels everything leaves the session at a zero total, which
   * disables "Complete Order & Take Payment" -- so the table could not be
   * settled, and there was no other control anywhere that would free it. The
   * server refuses while a live order is still on the table, so this cannot
   * be used to clear a table mid-meal.
   */
  const releaseMut = useMutation({
    mutationFn: (tableId) => releaseTable(tableId),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Table released.", { variant: "success" });
      setSessionTable(null);
      setSessionData(null);
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Could not release that table.", {
        variant: "error",
      }),
  });

  /**
   * A table pre-booked from the website. "Guests arrived" releases the hold so
   * their order can start; "Cancel pre-booking" frees the table for anyone.
   */
  const bookingMut = useMutation({
    mutationFn: ({ action, id }) => (action === "seat" ? seatTableBooking(id) : cancelTableBooking(id)),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Booking updated.", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["table-bookings"] });
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Could not update that booking.", { variant: "error" }),
  });

  const handleBookingAction = (action, booking, label) => {
    const question =
      action === "seat"
        ? `${booking.name}'s party has arrived at ${label}? The table is released for their order.`
        : `Cancel the pre-booking for ${booking.name} at ${booking.timeLabel}? ${label} becomes available again.`;
    if (!window.confirm(question)) return;
    bookingMut.mutate({ action, id: booking._id });
  };

  const handleReleaseTable = () => {
    const tableId = sessionTable?._id || sessionTable?.id;
    if (!tableId) return;
    const label = sessionTable?.name || sessionTable?.tableNumber;
    if (!window.confirm(`Release Table ${label}? It becomes available for the next customer.`)) return;
    releaseMut.mutate(tableId);
  };

  const addTableMutation = useMutation({
    mutationFn: addTable,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Table added successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      setIsAddModalOpen(false);
      resetForm();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to add table.", { variant: "error" });
    },
  });

  const updateTableMutation = useMutation({
    mutationFn: updateTable,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Table updated!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      setEditingTable(null);
      resetForm();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to update table.", { variant: "error" });
    },
  });

  const deleteTableMutation = useMutation({
    mutationFn: deleteTable,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Table deleted!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Cannot delete table with active session.", { variant: "error" });
    },
  });

  const resetForm = () => {
    setDisplayId("");
    setArea(allAreas[0] || "Ground Floor");
    setCapacity(4);
    setIsEnabled(true);
  };

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (!displayId.trim()) {
      enqueueSnackbar("Please enter a Display Table ID (e.g. GF-T1)!", { variant: "warning" });
      return;
    }
    executeProtected(() => {
      addTableMutation.mutate({
        displayId: displayId.trim(),
        tableName: displayId.trim(),
        area,
        floor: area,
        capacity: Number(capacity) || 4,
        isEnabled,
      });
    });
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editingTable) return;
    executeProtected(() => {
      updateTableMutation.mutate({
        tableId: editingTable._id,
        displayId: displayId.trim(),
        tableName: displayId.trim(),
        area,
        floor: area,
        capacity: Number(capacity) || 4,
        isEnabled,
      });
    });
  };

  const handleDeleteTable = (table) => {
    const isOccupied = ["Booked", "occupied", "OCCUPIED", "Processing"].includes(table.status) || table.session;
    if (isOccupied) {
      enqueueSnackbar(`Cannot delete Table ${table.displayId || table.tableNumber}: Table has an active order/session!`, { variant: "error" });
      return;
    }

    if (window.confirm(`Are you sure you want to remove Table ${table.displayId || table.tableNumber}?`)) {
      executeProtected(() => {
        deleteTableMutation.mutate(table._id);
      });
    }
  };

  const openEditModal = (table) => {
    setEditingTable(table);
    setDisplayId(table.displayId || table.tableName || `Table-${table.tableNumber}`);
    setArea(table.area || table.floor || "Ground Floor");
    setCapacity(table.capacity || 4);
    setIsEnabled(table.isEnabled !== false);
  };

  const getSessionIdFromTable = (table) => table?.session?._id || table?.activeSessionId || null;

  const isOccupied = (table) =>
    ["Booked", "occupied", "OCCUPIED", "Processing"].includes(table.status) ||
    (Number(table.currentOccupancy) > 0 &&
      (Boolean(getSessionIdFromTable(table)) || Number(table.currentOccupancy) >= Number(table.capacity)));

  const openSessionDetail = async (table) => {
    setSessionLoading(true);
    setSessionTable(table);
    try {
      const sessionId = getSessionIdFromTable(table);
      if (sessionId) {
        const res = await getTableSessionById(sessionId);
        setSessionData(res?.data?.data || null);
      } else {
        const res = await getTableById(table._id);
        const t = res?.data?.data || table;
        const nestedSessionId = getSessionIdFromTable(t);
        if (nestedSessionId) {
          const sres = await getTableSessionById(nestedSessionId);
          setSessionData(sres?.data?.data || null);
        } else {
          setSessionData(null);
        }
      }
    } catch (error) {
      enqueueSnackbar("Failed to load table session.", { variant: "error" });
    } finally {
      setSessionLoading(false);
    }
  };

  const handleTableClick = (table) => {
    if (table.isEnabled === false) {
      enqueueSnackbar("This table is currently disabled.", { variant: "warning" });
      return;
    }
    const shaped = {
      ...table,
      id: table._id,
      name: table.displayId || table.tableName || table.tableNumber,
      capacity: Number(table.capacity) || 4,
      currentOccupancy: Number(table.currentOccupancy) || 0,
    };
    if (isOccupied(table)) {
      openSessionDetail(shaped);
      return;
    }
    if (table.status === "reserved" && table.booking) {
      enqueueSnackbar(
        `${shaped.name} is pre-booked for ${table.booking.name} at ${table.booking.timeLabel}. Mark the guests arrived or cancel the pre-booking first.`,
        { variant: "warning" },
      );
      return;
    }
    setGuestCountTable(shaped);
  };

  const handleConfirmGuestCount = async (guests, table) => {
    try {
      const res = await getTableById(table._id);
      const fullTable = res?.data?.data || table;
      const cap = Number(fullTable.capacity) || 4;
      if (Number(guests) > cap) {
        enqueueSnackbar(
          `Table ${fullTable.displayId || fullTable.tableNumber} has a maximum capacity of ${cap} customers.`,
          { variant: "error" }
        );
        return;
      }
      dispatch(updateTableAction({ table: { ...fullTable, tableId: fullTable._id, tableNo: fullTable.displayId || fullTable.tableNumber } }));
      dispatch(setOrderType("Table Service"));
      setGuestCountTable(null);
      navigate("/menu");
    } catch (error) {
      enqueueSnackbar("Failed to load table details.", { variant: "error" });
    }
  };

  // Filters
  const filteredTables = tables.filter((t) => {
    const areaMatch = selectedArea === "all" || (t.area || t.floor || t.zone) === selectedArea;
    const isBooked = isOccupied(t);
    const statusMatch = status === "all" || (status === "booked" ? isBooked : !isBooked);
    return areaMatch && statusMatch;
  });

  const availableCount = tables.filter((t) => !isOccupied(t) && t.isEnabled !== false).length;
  const bookedCount = tables.filter((t) => isOccupied(t)).length;

  return (
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col min-h-full space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[#0F172A]">Manage Tables</h1>
            <p className="text-[#64748B] text-sm">
              Organize tables by floor/area, customize IDs (e.g. GF-T1), set capacity & generate QR codes.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-[#DCFCE7] text-[#15803D] text-xs font-bold">
              {availableCount} Available
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-[#FEF3C7] text-[#B45309] text-xs font-bold">
              {bookedCount} Booked
            </div>
            <button
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502] flex items-center gap-2"
            >
              <FiPlus size={16} /> Add Table
            </button>
          </div>
        </div>

        {/* Floor / Area Tabs */}
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[#475569]">
              <FiLayers size={16} className="text-[#C2410C]" />
              <span>Floors & Areas</span>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsAreaModalOpen(true)}
                className="text-xs font-bold text-[#C2410C] hover:underline flex items-center gap-1"
              >
                + Add Custom Area
              </button>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setSelectedArea("all")}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-colors shrink-0 ${
                selectedArea === "all"
                  ? "bg-[#FD5302] text-white shadow-sm"
                  : "bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              All Floors & Areas ({tables.length})
            </button>
            {allAreas.map((a) => {
              const count = tables.filter((t) => (t.area || t.floor || t.zone) === a).length;
              const isActive = selectedArea === a;
              // Every area the operator can see is one they made, so the only
              // thing that should stop a delete is tables still sitting in it.
              // The old rule also required membership of the local
              // customAreas list, so an area created on another device — or
              // before that list existed — could never be removed.
              const canDelete = count === 0;
              return (
                <div
                  key={a}
                  className={`inline-flex items-stretch rounded-xl overflow-hidden shrink-0 ${
                    isActive
                      ? "bg-[#FD5302] text-white shadow-sm"
                      : "bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B]"
                  }`}
                >
                  <button
                    onClick={() => setSelectedArea(a)}
                    className={`px-4 py-2 text-xs font-extrabold transition-colors ${
                      isActive ? "" : "hover:text-[#0F172A]"
                    }`}
                  >
                    {a} ({count})
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      title={`Delete "${a}"`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!window.confirm(`Remove floor/area "${a}"? Tables can be added again later.`)) return;
                        setCustomAreas((prev) => prev.filter((x) => x !== a));
                        if (selectedArea === a) setSelectedArea("all");
                        enqueueSnackbar(`Area "${a}" removed.`, { variant: "success" });
                      }}
                      className={`px-2.5 text-[13px] font-extrabold border-l ${
                        isActive
                          ? "border-white/30 text-white/85 hover:bg-white/10"
                          : "border-[#E2E8F0] text-[#94A3B8] hover:text-[#DC2626] hover:bg-white"
                      }`}
                      aria-label={`Delete area ${a}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex gap-2 text-xs font-bold">
          <button
            onClick={() => setStatus("all")}
            className={`px-4 py-2 rounded-xl transition-colors ${
              status === "all" ? "bg-[#0F172A] text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"
            }`}
          >
            All Statuses
          </button>
          <button
            onClick={() => setStatus("booked")}
            className={`px-4 py-2 rounded-xl transition-colors ${
              status === "booked" ? "bg-[#0F172A] text-white" : "bg-white border border-[#E2E8F0] text-[#64748B]"
            }`}
          >
            Booked / Occupied ({bookedCount})
          </button>
        </div>

        {/* Tables Grid */}
        {filteredTables.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredTables.map((table) => (
              <div key={table._id} className="relative group">
                {/* Table Control Overlays */}
                {/* Hidden-until-hover ONLY where a pointer can hover. A phone or
                    tablet has no hover state, so these controls were simply
                    invisible there -- QR, Edit and Delete were unreachable. */}
                <div className="absolute top-2 right-2 z-20 flex gap-1.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:justify-end [@media(hover:none)]:mb-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setQrModalTable(table);
                    }}
                    className="p-1.5 [@media(hover:none)]:p-2 rounded-lg bg-white border border-[#E2E8F0] text-[#C2410C] shadow-md hover:scale-105"
                    title="View QR Code"
                  >
                    <IconQr size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(table);
                    }}
                    className="p-1.5 [@media(hover:none)]:p-2 rounded-lg bg-white border border-[#E2E8F0] text-[#0F172A] shadow-md hover:scale-105"
                    title="Edit Table"
                  >
                    <FiEdit2 size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTable(table);
                    }}
                    className="p-1.5 [@media(hover:none)]:p-2 rounded-lg bg-[#DC2626] text-white shadow-md hover:scale-105"
                    title="Delete Table"
                  >
                    <FiTrash2 size={13} />
                  </button>
                </div>

                <TableCard
                  id={table._id}
                  name={table.displayId || table.tableName || `Table-${table.tableNumber}`}
                  status={table.status}
                  initials={table?.currentOrderId?.customerDetails?.name}
                  seats={table.capacity}
                  occupancy={table.currentOccupancy}
                  availableAt={table.availableAt}
                  activeSessionId={table.activeSessionId}
                  session={table.session}
                  onClick={() => handleTableClick(table)}
                />
                {table.booking ? (
                  <div
                    className={`mt-2 rounded-xl border px-3 py-2 text-left ${
                      table.booking.blocking ? "border-[#FDBA74] bg-[#FFF7ED]" : "border-[#E2E8F0] bg-white"
                    }`}
                  >
                    <p className="text-[11px] font-bold text-[#C2410C] truncate">
                      {table.booking.blocking ? "Reserved" : "Pre-booked"} · {table.booking.timeLabel}
                      {table.booking.bookingDate !== localDay()
                        ? ` · ${table.booking.bookingDate}`
                        : ""}
                    </p>
                    <p className="text-[11px] text-[#0F172A] truncate">
                      {table.booking.name} · {table.booking.guestCount} guests · {table.booking.phone}
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        type="button"
                        disabled={bookingMut.isPending}
                        onClick={() =>
                          handleBookingAction("seat", table.booking, table.displayId || table.tableName || `Table ${table.tableNumber}`)
                        }
                        className="flex-1 py-1 rounded-lg bg-[#22C55E] text-white text-[11px] font-bold disabled:opacity-50"
                      >
                        Guests arrived
                      </button>
                      <button
                        type="button"
                        disabled={bookingMut.isPending}
                        onClick={() =>
                          handleBookingAction("cancel", table.booking, table.displayId || table.tableName || `Table ${table.tableNumber}`)
                        }
                        className="flex-1 py-1 rounded-lg border border-[#FECACA] text-[#DC2626] text-[11px] font-bold disabled:opacity-50"
                      >
                        Cancel pre-booking
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-[#E2E8F0]">
            <div className="w-14 h-14 mx-auto bg-[#F1F5F9] rounded-2xl flex items-center justify-center mb-3 text-[#94A3B8]">
              <FiGrid size={24} />
            </div>
            <p className="text-[#0F172A] font-bold text-sm">No tables found</p>
            <p className="text-[#94A3B8] text-xs mt-1">Add a table for area: <strong>{selectedArea}</strong></p>
            <button
              onClick={() => {
                resetForm();
                if (selectedArea !== "all") setArea(selectedArea);
                setIsAddModalOpen(true);
              }}
              className="mt-4 px-4 py-2 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502]"
            >
              + Add Table
            </button>
          </div>
        )}
      </div>

      {/* Guest Count Modal (Flow 1: Table First) */}
      {guestCountTable && (
        <GuestCountModal
          table={guestCountTable}
          onClose={() => setGuestCountTable(null)}
          onConfirm={(count) => handleConfirmGuestCount(count, guestCountTable)}
        />
      )}

      {/* Session Detail Modal (click occupied table) */}
      {sessionTable && (
        <SessionDetailModal
          table={sessionTable}
          session={sessionData}
          onComplete={() => setSettleTarget({ table: sessionTable, session: sessionData })}
          onMove={() => setPicker("move")}
          onMerge={() => setPicker("merge")}
          onCancelItem={handleCancelSessionItem}
          cancelBusy={cancelItemMut.isPending}
          onRelease={handleReleaseTable}
          releaseBusy={releaseMut.isPending}
          onClose={() => {
            setSessionTable(null);
            setSessionData(null);
          }}
          onAddItem={() => {
            const activeSessionId = getSessionIdFromTable(sessionTable) || sessionData?._id;
            dispatch(updateTableAction({
              table: {
                ...sessionTable,
                tableId: sessionTable._id || sessionTable.id,
                tableNo: sessionTable.displayId || sessionTable.tableNumber || sessionTable.name,
                occupancy: sessionTable.currentOccupancy || sessionData?.customerCount || 0,
                activeSessionId,
              },
            }));
            dispatch(setOrderType("Table Service"));
            if (activeSessionId) dispatch(setSessionId(activeSessionId));
            setSessionTable(null);
            setSessionData(null);
            navigate("/menu");
          }}
        />
      )}

      {/* Add / Edit Table Modal */}
      {(isAddModalOpen || editingTable) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md border border-[#E2E8F0] space-y-4">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-3">
              <h3 className="text-[#0F172A] text-base font-extrabold">
                {editingTable ? `Edit Table ${editingTable.displayId || editingTable.tableNumber}` : "Add New Table"}
              </h3>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setEditingTable(null);
                }}
                className="text-[#94A3B8] hover:text-[#475569] text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={editingTable ? handleEditSubmit : handleAddSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#475569] mb-1">
                  Display Table ID / Name (e.g. GF-T1, VIP-01, Garden-3)
                </label>
                <input
                  type="text"
                  value={displayId}
                  onChange={(e) => setDisplayId(e.target.value)}
                  placeholder="e.g. GF-T1"
                  className="w-full h-11 px-3 rounded-xl border border-[#E2E8F0] font-bold text-sm text-[#0F172A] focus:outline-none focus:border-[#FD5302]"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-[#475569] mb-1">
                  Floor / Area
                </label>
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-[#E2E8F0] font-bold text-sm text-[#0F172A] focus:outline-none focus:border-[#FD5302]"
                >
                  {allAreas.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-[#475569] mb-1">
                  Seating Capacity (Max Customers)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-[#E2E8F0] font-bold text-sm text-[#0F172A] focus:outline-none focus:border-[#FD5302]"
                  required
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                <span className="font-bold text-[#475569]">Enable Table for Ordering</span>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="w-5 h-5 accent-[#FD5302]"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setEditingTable(null);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-[#E2E8F0] font-bold text-[#475569]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addTableMutation.isPending || updateTableMutation.isPending}
                  className="px-5 py-2.5 rounded-xl bg-[#FD5302] text-white font-bold hover:bg-[#D64502] disabled:opacity-50"
                >
                  {editingTable ? "Save Changes" : "Create Table"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom Area Modal */}
      {isAreaModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm border border-[#E2E8F0] space-y-4">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-3">
              <h3 className="text-[#0F172A] text-base font-extrabold">Add Custom Floor / Area</h3>
              <button
                onClick={() => setIsAreaModalOpen(false)}
                className="text-[#94A3B8] text-xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <label className="block font-bold text-[#475569]">Floor/Area Name</label>
              <input
                type="text"
                value={newAreaInput}
                onChange={(e) => setNewAreaInput(e.target.value)}
                placeholder="e.g. Executive Lounge"
                className="w-full h-11 px-3 rounded-xl border border-[#E2E8F0] font-bold text-sm"
              />
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsAreaModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] font-bold text-[#475569]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (newAreaInput.trim()) {
                      setCustomAreas([...customAreas, newAreaInput.trim()]);
                      setSelectedArea(newAreaInput.trim());
                      setNewAreaInput("");
                      setIsAreaModalOpen(false);
                      enqueueSnackbar(`Area "${newAreaInput.trim()}" created!`, { variant: "success" });
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#FD5302] text-white font-bold"
                >
                  Add Area
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {qrModalTable && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm border border-[#E2E8F0] text-center space-y-4">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-2">
              <h3 className="text-[#0F172A] text-base font-extrabold">
                Table QR — {qrModalTable.displayId || qrModalTable.tableName || qrModalTable.tableNumber}
              </h3>
              <button
                onClick={() => setQrModalTable(null)}
                className="text-[#94A3B8] text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-[#E2E8F0] space-y-3">
              <p className="text-xs font-bold text-[#475569]">Area: {qrModalTable.area || qrModalTable.floor}</p>
              <p className="text-xs text-[#94A3B8]">Token: <code className="font-mono text-[#C2410C]">{qrModalTable.qrToken ? qrModalTable.qrToken.slice(0, 16) + "…" : "N/A"}</code></p>

              {/* Scannable QR rendered locally (no external API).
                  We always render the modern /t/:token URL so scanning
                  the printed code hits the secure resolveTableScope
                  middleware and never fails with "Invalid QR code." */}
              <div className="flex justify-center">
                <div className="p-3 bg-white rounded-xl border border-[#E2E8F0] shadow-sm">
                  {qrFetching ? (
                    <div className="w-[180px] h-[180px] flex items-center justify-center text-[11px] text-[#C2410C] font-bold text-center px-3">
                      Generating secure QR…
                    </div>
                  ) : qrModalTable.qrToken ? (
                    <QRCodeCanvas
                      value={qrLinkFor(qrModalTable)}
                      size={180}
                      level="H"
                      includeMargin
                      aria-label="Table QR code"
                    />
                  ) : (
                    <div className="w-[180px] h-[180px] flex items-center justify-center text-[11px] text-[#94A3B8] font-bold text-center px-3">
                      No QR token yet. Regenerate QR for this table to enable scanning.
                    </div>
                  )}
                </div>
              </div>

              <div className="p-3 bg-white rounded-xl border border-[#E2E8F0] break-all text-[11px] font-mono text-[#334155]">
                {qrLinkFor(qrModalTable) || "QR will appear once generated."}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  const url = qrLinkFor(qrModalTable);
                  if (!url) {
                    enqueueSnackbar("QR is not ready yet — please wait.", { variant: "warning" });
                    return;
                  }
                  navigator.clipboard.writeText(url);
                  enqueueSnackbar("QR Link copied to clipboard!", { variant: "success" });
                }}
                className="flex-1 py-2.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-xs font-bold"
              >
                Copy Link
              </button>
              <button
                onClick={() => {
                  setPrintModalTable(qrModalTable);
                  setQrModalTable(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold"
              >
                🖨️ Print QR Card
              </button>
            </div>
          </div>
        </div>
      )}

      <PrintTableQRModal
        isOpen={Boolean(printModalTable)}
        onClose={() => setPrintModalTable(null)}
        table={printModalTable}
      />

      {settleTarget && (
        <TableSettleModal
          table={settleTarget.table}
          session={settleTarget.session}
          busy={settleMutation.isPending}
          onClose={() => setSettleTarget(null)}
          onConfirm={({ method, amount, splits, tip, buyer, sendEBill: alsoEBill, phone }) =>
            settleMutation.mutate({
              sessionId: settleTarget.session?._id,
              method,
              amount,
              splits,
              tip,
              buyer,
              sendEBill: alsoEBill,
              phone,
            })
          }
        />
      )}

      {picker && sessionTable && (
        <TablePickerModal
          title={picker === "move" ? "Move the party to…" : "Merge which table into this one?"}
          hint={
            picker === "move"
              ? "Their order and bill follow them. Only free tables are listed."
              : "That table's items and guests join this bill and its table is freed."
          }
          busy={moveMutation.isPending || mergeMutation.isPending}
          tables={tables.filter((t) =>
            String(t._id) === String(sessionTable._id)
              ? false
              : picker === "move"
              ? !t.session && t.status !== "reserved" && t.isEnabled !== false
              : Boolean(t.session),
          )}
          onClose={() => setPicker(null)}
          onPick={(t) => {
            const sessionId = getSessionIdFromTable(sessionTable) || sessionData?._id;
            if (!sessionId) return;
            if (picker === "move") moveMutation.mutate({ sessionId, tableId: t._id });
            else mergeMutation.mutate({ sessionId, fromSessionId: t.session._id });
          }}
        />
      )}

      <SecurityPinModal
        isOpen={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          setPinModalOpen(false);
          if (pendingAction) pendingAction();
          setPendingAction(null);
        }}
      />
    </div>
  );
};

export default Tables;
