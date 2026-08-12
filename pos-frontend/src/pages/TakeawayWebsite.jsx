import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const TakeawayWebsite = () => {
  const { storeId } = useParams();
  const [storeInfo, setStoreInfo] = useState(null);
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState("All");
  const [cart, setCart] = useState([]);

  useEffect(() => {
    const fetchStoreData = async () => {
      try {
        setLoading(true);
        setError(null);
        const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
        
        const storeRes = await axios.get(`${backendUrl}/api/public/store/${storeId}`);
        if (storeRes.data && storeRes.data.success) {
          setStoreInfo(storeRes.data.data);
        }

        const menuRes = await axios.get(`${backendUrl}/api/public/store/${storeId}/menu`);
        if (menuRes.data && menuRes.data.success) {
          setMenus(menuRes.data.data);
        }
      } catch (err) {
        console.error("Failed to load store website:", err);
        setError(err.response?.data?.message || "Failed to load restaurant menu.");
      } finally {
        setLoading(false);
      }
    };

    if (storeId) {
      fetchStoreData();
    }
  }, [storeId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-400 font-medium">Loading Takeaway Website...</p>
      </div>
    );
  }

  if (error || !storeInfo) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
          <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">!</div>
          <h2 className="text-2xl font-bold mb-2">Store Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error || "Invalid Store ID provided."}</p>
          <a href="/" className="inline-block bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-6 py-2.5 rounded-xl transition-all">
            Return to POS
          </a>
        </div>
      </div>
    );
  }

  // Extract all categories & items
  const allItems = menus.flatMap((m) => m.items || []);
  const categories = ["All", ...new Set(allItems.map((item) => item.category).filter(Boolean))];
  const filteredItems = activeCategory === "All" ? allItems : allItems.filter((i) => i.category === activeCategory);

  const addToCart = (item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.name === item.name);
      if (existing) {
        return prev.map((c) => (c.name === item.name ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const removeFromCart = (itemName) => {
    setCart((prev) =>
      prev
        .map((c) => (c.name === itemName ? { ...c, quantity: c.quantity - 1 } : c))
        .filter((c) => c.quantity > 0)
    );
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Header Banner */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 backdrop-blur-md bg-opacity-90">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl p-2 bg-slate-800 rounded-xl border border-slate-700">
              {storeInfo.branding?.logo || "🍽️"}
            </span>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">{storeInfo.storeName}</h1>
              <p className="text-xs text-slate-400">Store ID: #{storeInfo.storeId} • Online Takeaway</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-full">
              Open for Takeaway
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border-b border-slate-800 py-10 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-2">
            Welcome to {storeInfo.storeName}
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto text-sm">
            Order fresh takeaway directly from our online store menu.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Menu Section */}
        <div className="lg:col-span-2 space-y-6">
          {/* Categories */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
                  activeCategory === cat
                    ? "bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20"
                    : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Items Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredItems.map((item, idx) => (
              <div
                key={idx}
                className="bg-slate-900 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-bold text-white text-base">{item.name}</h3>
                    <span className="font-extrabold text-amber-400 text-base">
                      £{item.price?.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2 mb-4">
                    {item.description || "Freshly cooked to order with high quality ingredients."}
                  </p>
                </div>
                <button
                  onClick={() => addToCart(item)}
                  className="w-full bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-amber-400 border border-slate-700 hover:border-amber-500 font-semibold py-2 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5"
                >
                  + Add to Order
                </button>
              </div>
            ))}
            {filteredItems.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-500 text-sm">
                No items available in this category.
              </div>
            )}
          </div>
        </div>

        {/* Cart / Order Summary Sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sticky top-24 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center justify-between">
              <span>Your Takeaway Order</span>
              <span className="text-xs bg-slate-800 text-amber-400 px-2.5 py-1 rounded-full border border-slate-700">
                {cart.reduce((sum, i) => sum + i.quantity, 0)} Items
              </span>
            </h3>

            {cart.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">
                Your basket is empty. Select items from the menu to add to your order.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {cart.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-xs border-b border-slate-800/60 pb-3">
                      <div>
                        <p className="font-semibold text-white">{item.name}</p>
                        <p className="text-slate-400">£{item.price?.toFixed(2)} each</p>
                      </div>
                      <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg p-1">
                        <button
                          onClick={() => removeFromCart(item.name)}
                          className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-white font-bold"
                        >
                          -
                        </button>
                        <span className="font-bold text-amber-400 px-1">{item.quantity}</span>
                        <button
                          onClick={() => addToCart(item)}
                          className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-white font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-800 pt-4 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-400 text-xs">
                    <span>Subtotal</span>
                    <span>£{cartTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 text-xs">
                    <span>Takeaway Fee</span>
                    <span className="text-emerald-400 font-medium">Free</span>
                  </div>
                  <div className="flex justify-between font-bold text-white text-base pt-2 border-t border-slate-800">
                    <span>Total</span>
                    <span className="text-amber-400">£{cartTotal.toFixed(2)}</span>
                  </div>
                </div>

                <button
                  onClick={() => alert(`Order placed for ${storeInfo.storeName}! Total: £${cartTotal.toFixed(2)}`)}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-3 rounded-xl text-sm transition-all shadow-lg shadow-amber-500/20"
                >
                  Place Takeaway Order
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default TakeawayWebsite;
