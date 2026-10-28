import React, { useCallback, useState } from "react";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { getStockAvailability } from "../https";
import { shortfallText, stockShortfalls } from "../utils/inventory";
import ConfirmDialog from "../components/dashboard/manageMenu/ConfirmDialog";

/**
 * "Only 1 Pizza Dough in stock. Do you want to continue?"
 *
 * Before a dish goes into the cart (or its quantity goes up), check it against
 * what is left on the shelf. When the cart would use up an item its recipe
 * needs, ask first; Continue rings it up anyway (the sale stands, and the
 * shelf stops at 0 on the server). The stock is kept from the last fetch, so
 * the check works offline too; `inventory:stock` refreshes it after every
 * sale and stock entry (hooks/useRealtimeSync).
 *
 *   const { guardStock, stockDialog } = useStockGuard();
 *   guardStock(menuItemId, 1, () => dispatch(addItems(...)));
 *   ...
 *   {stockDialog}
 */
const useStockGuard = () => {
  const cart = useSelector((s) => s.cart);
  const { data: stock } = useQuery({
    queryKey: ["stock-availability"],
    queryFn: async () => (await getStockAvailability()).data?.data,
    staleTime: 60_000,
    retry: false,
  });
  const [ask, setAsk] = useState(null);

  const guardStock = useCallback(
    (menuItemId, quantity, proceed) => {
      const short = stockShortfalls(cart, { menuItemId, quantity }, stock);
      if (!short.length) return proceed();
      setAsk({
        title: short.map(shortfallText).join(" "),
        message: "Do you want to continue?",
        confirmLabel: "Continue",
        tone: short.some((i) => i.stockQuantity <= 0) ? "danger" : undefined,
        onConfirm: proceed,
      });
      return undefined;
    },
    [cart, stock],
  );

  return { guardStock, stockDialog: <ConfirmDialog state={ask} onClose={() => setAsk(null)} /> };
};

export default useStockGuard;
