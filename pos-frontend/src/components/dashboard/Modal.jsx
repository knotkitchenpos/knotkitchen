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
      className="fixed inset-0 bg-[#0F172A]/60 flex items-center justify-center z-[100] p-4"
      onClick={handleCloseModal}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 border border-[#CBD5E1] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-[#E2E8F0]">
          <h2 className="font-display text-lg text-[#0F172A] font-extrabold">
            Add Table
          </h2>
          <button
            onClick={handleCloseModal}
            className="p-2 rounded-lg text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-all"
          >
            <IoMdClose size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[#475569] mb-2 text-sm font-bold">
              Table Number
            </label>
            <div className="input-container">
              <input
                type="number"
                name="tableNo"
                value={tableData.tableNo}
                onChange={handleInputChange}
              className="w-full h-[46px] px-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[#0F172A] focus:outline-none focus:border-[#FD5302]"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-[#475569] mb-2 text-sm font-bold">
              Number of Seats
            </label>
            <div className="input-container">
              <input
                type="number"
                name="seats"
                value={tableData.seats}
                onChange={handleInputChange}
              className="w-full h-[46px] px-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[#0F172A] focus:outline-none focus:border-[#FD5302]"
                required
              />
            </div>
          </div>

          <button type="submit" className="w-full h-[46px] mt-6 rounded-xl bg-[#FD5302] text-white font-bold hover:bg-[#D64502] transition-colors">
            Add Table
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default Modal;