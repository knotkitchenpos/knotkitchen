import React from "react";
import { FaCheckDouble } from "react-icons/fa";
import { FaCircle, FaLongArrowAltRight } from "react-icons/fa";
import { FiClock } from "react-icons/fi";
import { formatDateAndTime, getAvatarName } from "../../utils/index";

const OrderCard = ({ order }) => {
  const isReady = order.orderStatus === "Ready";
  const isCompleted = order.orderStatus === "Completed";
  const isPending = order.orderStatus === "Pending";

  const statusBadge = isCompleted ? (
    <span className="badge badge-completed">
      <FaCheckDouble /> Completed
    </span>
  ) : isReady ? (
    <span className="badge badge-ready">
      <FaCheckDouble /> Ready
    </span>
  ) : isPending ? (
    <span className="badge badge-pending">
      <FiClock /> Pending
    </span>
  ) : (
    <span className="badge badge-progress">
      <FaCircle /> In Progress
    </span>
  );

  return (
    <div className="card p-4 sm:p-5 hover:!translate-y-0 cursor-pointer group">
      <div className="flex items-center gap-4">
        <div
          className={`${
            isReady ? "bg-accent-green" : isPending ? "bg-accent-amber" : "bg-gradient-brand"
          } w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm`}
        >
          {getAvatarName(order.customerDetails?.name || 'Guest')}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold truncate">{order.customerDetails?.name || 'Guest'}</h1>
          <p className="text-content-muted text-xs">
            #{Math.floor(new Date(order.orderDate).getTime())} / Dine in
          </p>
        </div>
        {statusBadge}
      </div>

      <div className="flex items-center justify-between mt-4 text-xs text-content-muted">
        <span className="flex items-center gap-1">
          <FaLongArrowAltRight /> {order.table?.tableNo ? 'Table '+order.table.tableNo : (order.marketplace || 'Guest')}
        </span>
        <span>{(order.items?.length || 0)} Items</span>
        <span className="flex items-center gap-1">
          <FiClock size={12} />
          {formatDateAndTime(order.orderDate)}
        </span>
      </div>

      <hr className="my-3 border-border" />

      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Total</span>
        <span className="font-display text-lg font-bold gradient-text">
          ₹{order.bills.totalWithTax.toFixed(2)}
        </span>
      </div>
    </div>
  );
};

export default OrderCard;