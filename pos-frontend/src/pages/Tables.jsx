import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import TableCard from "../components/tables/TableCard";
import GuestCountModal from "../components/tables/GuestCountModal";
import SessionDetailModal from "../components/tables/SessionDetailModal";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTables, addTable, deleteTable, getTableById, getTableSessionById } from "../https";
import { enqueueSnackbar } from "notistack";
import { FiGrid, FiPlus, FiTrash2 } from "react-icons/fi";
import { setOrderType } from "../redux/slices/orderTypeSlice";
import { updateTable as updateTableAction, setSessionId } from "../redux/slices/customerSlice";

const Tables = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [tableNo, setTableNo] = useState("");
  const [seats, setSeats] = useState(4);
  const [guestCountTable, setGuestCountTable] = useState(null);
  const [sessionTable, setSessionTable] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  useEffect(() => {
    document.title = "KnotKitchen | Tables";
  }, []);

  const { data: resData, isError } = useQuery({
    queryKey: ["tables"],
    queryFn: async () => {
      return await getTables();
    },
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  if (isError) {
    enqueueSnackbar("Something went wrong!", { variant: "error" });
  }

  const addTableMutation = useMutation({
    mutationFn: addTable,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Table added successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      setIsAddModalOpen(false);
      setTableNo("");
      setSeats(4);
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to add table.", { variant: "error" });
    },
  });

  const deleteTableMutation = useMutation({
    mutationFn: deleteTable,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Table deleted!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to delete table.", { variant: "error" });
    },
  });

  const handleAddTable = (e) => {
    e.preventDefault();
    if (!tableNo.trim()) {
      enqueueSnackbar("Please enter a table number!", { variant: "warning" });
      return;
    }
    addTableMutation.mutate({ tableNo: Number(tableNo), seats: Number(seats) || 4 });
  };

  const handleDeleteTable = (id, name) => {
    if (window.confirm(`Are you sure you want to remove Table ${name}?`)) {
      deleteTableMutation.mutate(id);
    }
  };

  const getSessionIdFromTable = (table) =>
    table?.session?._id || table?.activeSessionId || null;

  const isOccupied = (table) =>
    ["Booked", "occupied", "OCCUPIED", "Processing"].includes(table.status) ||
    (Number(table.currentOccupancy) > 0 &&
      (Boolean(getSessionIdFromTable(table)) ||
        Number(table.currentOccupancy) >= Number(table.capacity)));

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
    const shaped = {
      ...table,
      id: table._id,
      name: table.tableNumber,
      capacity: Number(table.capacity) || Number(table.seats) || 4,
      currentOccupancy: Number(table.currentOccupancy) || 0,
    };
    if (isOccupied(table)) {
      openSessionDetail(shaped);
      return;
    }
    setGuestCountTable(shaped);
  };

  const handleConfirmGuestCount = async (guests, table) => {
    try {
      const res = await getTableById(table._id);
      const fullTable = res?.data?.data || table;
      const capacity = Number(fullTable.capacity) || Number(fullTable.seats) || 4;
      if (Number(guests) > capacity) {
        enqueueSnackbar(
          `Table ${fullTable.tableNumber} has a maximum capacity of ${capacity} customers.`,
          { variant: "error" }
        );
        return;
      }
      dispatch(updateTableAction({ table: { ...fullTable, tableId: fullTable._id, tableNo: fullTable.tableNumber } }));
      dispatch(setOrderType("Table Service"));
      setGuestCountTable(null);
      navigate("/menu");
    } catch (error) {
      enqueueSnackbar("Failed to load table details.", { variant: "error" });
    }
  };

  const tables = resData?.data?.data || [];
  const isBookedStatus = (t) =>
    ["Booked", "occupied", "OCCUPIED"].includes(t.status) ||
    (Number(t.currentOccupancy) > 0 && Number(t.currentOccupancy) >= Number(t.capacity));
  const availableCount = tables.filter((t) => !isBookedStatus(t)).length;
  const bookedCount = tables.filter((t) => isBookedStatus(t)).length;

  const filteredTables = tables.filter(
    (table) => status === "all" || isBookedStatus(table)
  );

  return (
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col min-h-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Tables</h1>
            <p className="text-content-muted text-sm">
              Tap an available table to start an order
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats */}
            <div className="px-4 py-2 rounded-xl bg-accent-green/10 text-accent-green text-sm font-semibold">
              {availableCount} Available
            </div>
            <div className="px-4 py-2 rounded-xl bg-accent-amber/10 text-accent-amber text-sm font-semibold">
              {bookedCount} Booked
            </div>
            {/* Add Table */}
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary !py-2.5 !px-4 text-sm flex items-center gap-2"
            >
              <FiPlus size={16} /> Add Table
            </button>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setStatus("all")}
            className={`menu-category-pill ${status === "all" ? "active" : ""}`}
          >
            All Tables
          </button>
          <button
            onClick={() => setStatus("booked")}
            className={`menu-category-pill ${status === "booked" ? "active" : ""}`}
          >
            Booked
          </button>
        </div>

        {/* Tables Grid */}
        {filteredTables.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-6">
            {filteredTables.map((table) => (
              <div key={table._id} className="relative group">
                <button
                  onClick={() => handleDeleteTable(table._id, table.tableNumber)}
                  disabled={deleteTableMutation.isPending}
                  className="absolute -top-2 -right-2 z-10 p-2 rounded-full bg-accent-red text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 disabled:opacity-50"
                  title={`Delete Table ${table.tableNumber}`}
                >
                  <FiTrash2 size={14} />
                </button>
                <TableCard
                  id={table._id}
                  name={table.tableNumber}
                  status={table.status}
                  initials={table?.currentOrderId?.customerDetails?.name}
                  seats={table.capacity}
                  occupancy={table.currentOccupancy}
                  activeSessionId={table.activeSessionId}
                  session={table.session}
                  onClick={() => handleTableClick(table)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto bg-surface-tertiary rounded-2xl flex items-center justify-center mb-4">
              <FiGrid size={28} className="text-content-muted" />
            </div>
            <p className="text-content-muted font-semibold">No tables found</p>
            <p className="text-content-muted text-sm mt-1">Add a table to get started</p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary mt-4 !py-2.5 !px-4 text-sm"
            >
              <FiPlus size={16} /> Add Table
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
                tableNo: sessionTable.tableNumber || sessionTable.name,
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

      {/* Add Table Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-md border border-border">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-content text-xl font-semibold font-display">Add Table</h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-content-muted hover:text-accent-red text-2xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddTable} className="space-y-6">
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Table Number
                </label>
                <input
                  type="number"
                  min="1"
                  value={tableNo}
                  onChange={(e) => setTableNo(e.target.value)}
                  placeholder="e.g. 5"
                  className="w-full bg-surface-input border border-border rounded-xl p-3.5 text-content focus:outline-none focus:border-accent"
                  required
                />
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Seats
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                  className="w-full bg-surface-input border border-border rounded-xl p-3.5 text-content focus:outline-none focus:border-accent"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={addTableMutation.isPending}
                className="btn-primary w-full !py-3 text-base disabled:opacity-50"
              >
                {addTableMutation.isPending ? "Adding..." : "Add Table"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tables;