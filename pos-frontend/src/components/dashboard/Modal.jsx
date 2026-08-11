import React, { useState } from "react";
import { motion } from "framer-motion";
import { IoMdClose } from "react-icons/io";
import { useMutation } from "@tanstack/react-query";
import { addTable } from "../../https";
import { enqueueSnackbar } from "notistack";

const Modal = ({ setIsTableModalOpen }) => {
  const [tableData, setTableData] = useState({
    tableNo: "",
    seats: "",
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setTableData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    tableMutation.mutate(tableData);
  };

  const handleCloseModal = () => {
    setIsTableModalOpen(false);
  };

  const tableMutation = useMutation({
    mutationFn: (reqData) => addTable(reqData),
    onSuccess: (res) => {
      setIsTableModalOpen(false);
      const { data } = res;
      enqueueSnackbar(data.message, { variant: "success" });
    },
    onError: (error) => {
      const { data } = error.response;
      enqueueSnackbar(data.message, { variant: "error" });
    },
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={handleCloseModal}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-secondary rounded-2xl shadow-2xl w-full max-w-sm mx-4 border border-border overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-border">
          <h2 className="font-display text-lg text-content font-semibold">
            Add Table
          </h2>
          <button
            onClick={handleCloseModal}
            className="p-2 rounded-lg text-content-muted hover:text-accent-red hover:bg-surface-tertiary transition-all"
          >
            <IoMdClose size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-content-muted mb-2 text-sm font-medium">
              Table Number
            </label>
            <div className="input-container">
              <input
                type="number"
                name="tableNo"
                value={tableData.tableNo}
                onChange={handleInputChange}
                className="input-field"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-content-muted mb-2 text-sm font-medium">
              Number of Seats
            </label>
            <div className="input-container">
              <input
                type="number"
                name="seats"
                value={tableData.seats}
                onChange={handleInputChange}
                className="input-field"
                required
              />
            </div>
          </div>

          <button type="submit" className="btn-primary w-full mt-6">
            Add Table
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default Modal;