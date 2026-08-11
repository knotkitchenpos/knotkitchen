import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiX } from "react-icons/fi";

const Modal = ({ isOpen, onClose, title, children }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-[60] p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-secondary rounded-2xl shadow-2xl w-full max-w-lg mx-4 border border-border overflow-hidden"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-border">
              <h2 className="font-display text-lg text-content font-semibold">{title}</h2>
              <button
                className="p-2 rounded-lg text-content-muted hover:text-content hover:bg-surface-tertiary transition-all"
                onClick={onClose}
              >
                <FiX size={18} />
              </button>
            </div>
            <div className="p-6">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Modal;