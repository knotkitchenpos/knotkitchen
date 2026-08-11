import React, { useEffect, useRef, useState } from "react";
import { RiDeleteBin2Fill } from "react-icons/ri";
import { FiMessageSquare } from "react-icons/fi";
import { useDispatch, useSelector } from "react-redux";
import { removeItem, updateQuantity } from "../../redux/slices/cartSlice";
import { enqueueSnackbar } from "notistack";

const CartInfo = () => {
  const cartData = useSelector((state) => state.cart);
  const scrolLRef = useRef();
  const dispatch = useDispatch();
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [activeNoteItem, setActiveNoteItem] = useState(null);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    if (scrolLRef.current) {
      scrolLRef.current.scrollTo({
        top: scrolLRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [cartData]);

  const handleRemove = (itemId) => {
    dispatch(removeItem(itemId));
    enqueueSnackbar("Item removed from cart!", { variant: "info" });
  };

  const handleIncrement = (item) => {
    dispatch(updateQuantity({ id: item.id, quantity: (item.quantity || 0) + 1 }));
  };

  const handleDecrement = (item) => {
    if ((item.quantity || 0) <= 1) {
      dispatch(removeItem(item.id));
      enqueueSnackbar("Item removed from cart!", { variant: "info" });
      return;
    }
    dispatch(updateQuantity({ id: item.id, quantity: (item.quantity || 0) - 1 }));
  };

  const openNoteModal = (item) => {
    setActiveNoteItem(item);
    setNoteText(item.note || "");
    setNoteModalOpen(true);
  };

  const saveNote = () => {
    if (!noteText.trim()) {
      enqueueSnackbar("Please enter a note!", { variant: "warning" });
      return;
    }
    // Dispatch an update to add note to the cart item
    dispatch({
      type: "cart/updateItemNote",
      payload: { id: activeNoteItem.id, note: noteText.trim() },
    });
    enqueueSnackbar("Note added successfully!", { variant: "success" });
    setNoteModalOpen(false);
    setActiveNoteItem(null);
    setNoteText("");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-content">Order Items</h3>
        <span className="text-xs text-content-muted">{cartData.length} items</span>
      </div>
      <div
        className="mt-2 overflow-y-auto scrollbar-hide max-h-[300px] space-y-3"
        ref={scrolLRef}
      >
        {cartData.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 mx-auto bg-surface-tertiary rounded-xl flex items-center justify-center mb-3">
              <FiMessageSquare size={22} className="text-content-muted" />
            </div>
            <p className="text-content-muted text-sm">Your cart is empty.</p>
            <p className="text-content-muted text-xs mt-1">Start adding items!</p>
          </div>
        ) : (
          cartData.map((item) => {
            return (
              <div
                key={item.id}
                className="bg-surface-input rounded-xl px-4 py-3 border border-border"
              >
                <div className="flex items-center justify-between">
                  <h1 className="text-content font-semibold text-sm truncate pr-2">
                    {item.name}
                  </h1>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="flex items-center gap-1 bg-surface-secondary border border-border rounded-lg px-1.5 py-0.5">
                      <button
                        onClick={() => handleDecrement(item)}
                        title="Decrease quantity"
                        className="text-content-muted hover:text-accent-red font-bold text-sm leading-none px-1 transition-colors"
                      >
                        &minus;
                      </button>
                      <span className="text-content font-semibold text-xs min-w-[16px] text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleIncrement(item)}
                        title="Increase quantity"
                        className="text-content-muted hover:text-accent-green font-bold text-sm leading-none px-1 transition-colors"
                      >
                        &#43;
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRemove(item.id)}
                      title="Remove item"
                      className="text-content-muted hover:text-accent-red transition-colors p-1.5 rounded-lg hover:bg-accent-red/10"
                    >
                      <RiDeleteBin2Fill size={18} />
                    </button>
                    <button
                      onClick={() => openNoteModal(item)}
                      title="Add note"
                      className={`p-1.5 rounded-lg transition-colors ${
                        item.note
                          ? "text-accent bg-accent/10"
                          : "text-content-muted hover:text-accent hover:bg-accent/10"
                      }`}
                    >
                      <FiMessageSquare size={18} />
                    </button>
                  </div>
                  <div className="text-right">
                    {item.note && (
                      <p className="text-[10px] text-content-muted mb-0.5 max-w-[150px] truncate flex items-center gap-1">
                        <FiMessageSquare size={10} className="flex-shrink-0" />
                        {item.note}
                      </p>
                    )}
                    <p className="text-content font-bold text-sm">₹{item.price}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Note Modal */}
      {noteModalOpen && activeNoteItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface-secondary rounded-2xl p-6 shadow-2xl border border-border w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-xl font-bold">Add Note</h3>
              <button
                onClick={() => {
                  setNoteModalOpen(false);
                  setActiveNoteItem(null);
                  setNoteText("");
                }}
                className="p-2 rounded-full hover:bg-surface-tertiary text-2xl leading-none text-content-muted"
              >
                &times;
              </button>
            </div>
            <p className="text-sm text-content-muted mb-2">
              Add a special note for <span className="font-semibold text-content">{activeNoteItem.name}</span>
            </p>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={4}
              placeholder="e.g. Less spicy, extra cheese..."
              className="w-full bg-surface-input border border-border rounded-lg p-3 text-sm focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setNoteModalOpen(false);
                  setActiveNoteItem(null);
                  setNoteText("");
                }}
                className="flex-1 py-2.5 rounded-lg border border-border text-content font-semibold hover:bg-surface-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveNote}
                className="flex-1 py-2.5 rounded-lg bg-accent text-white font-semibold hover:opacity-90 transition-opacity"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CartInfo;