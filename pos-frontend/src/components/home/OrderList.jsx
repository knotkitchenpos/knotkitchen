import React from "react";
import { FiCheckSquare, FiClock, FiArrowRight } from "react-icons/fi";
import { getAvatarName } from "../../utils/index";
import { useNavigate } from "react-router-dom";
import { isReady as ready } from "../../constants/orderStatus";

const OrderList = ({ key, order }) => {
  const isReady = ready(order.orderStatus);
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/orders")}
      className="w-full flex items-center gap-4 p-3.5 rounded-xl bg-surface-input border border-border hover:border-accent/40 hover:shadow-md transition-all text-left cursor-pointer"
    >
      <div className={`w-10 h-10 rounded-full ${isReady ? "bg-accent-green/15 text-accent-green" : "bg-accent/15 text-accent"} flex items-center justify-center font-bold text-sm`}>
        {getAvatarName(order.customerDetails?.name || 'Guest')}
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="font-semibold text-sm truncate">
          {order.customerDetails?.name || 'Guest'}
        </h1>
        <p className="text-content-muted text-xs">{(order.items?.length || 0)} Items</p>
      </div>

      <span className="flex items-center gap-1 text-accent font-semibold text-xs bg-accent/10 rounded-lg px-2.5 py-1">
        {order.table?.tableNo ? 'Table '+order.table.tableNo : (order.marketplace || 'Guest')}
      </span>

      {isReady ? (
        <span className="badge badge-ready">
          <FiCheckSquare size={12} /> Ready
        </span>
      ) : (
        <span className="badge badge-progress">
          <FiClock size={12} /> In Progress
        </span>
      )}

      <FiArrowRight className="text-content-muted flex-shrink-0" size={16} />
    </button>
  );
};

export default OrderList;