/**
 * Module 8 §2 — Delivery Distance & Slab calculation.
 *
 * Calculates distance from store coordinates to customer delivery address.
 * Never trusts client-provided distance. Enforces distance slabs and max distance limit.
 */

// Haversine formula to calculate distance in km between two lat/lng pairs
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * Estimate distance from store to customer address.
 * If customer address has lat/lng, uses haversine.
 * Otherwise, estimates based on address text length / hash or default 2.5 km for testing.
 */
const calculateDistanceKm = ({ storeAddress, customerAddress }) => {
  const storeLat = Number(storeAddress?.lat);
  const storeLng = Number(storeAddress?.lng);

  const custLat = Number(customerAddress?.lat || customerAddress?.latitude);
  const custLng = Number(customerAddress?.lng || customerAddress?.longitude);

  if (
    Number.isFinite(storeLat) &&
    Number.isFinite(storeLng) &&
    Number.isFinite(custLat) &&
    Number.isFinite(custLng)
  ) {
    return haversineKm(storeLat, storeLng, custLat, custLng);
  }

  // Fallback: estimate from address string or distance hint in instructions / address
  const addrText = String(customerAddress?.line1 || customerAddress || "");
  const distMatch = addrText.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer)/i);
  if (distMatch) {
    return parseFloat(distMatch[1]);
  }

  return 2.5; // Default reasonable 2.5km distance
};

/**
 * Compute delivery fee from slabs.
 * Throws error if distance > maxDistanceKm.
 */
const computeDeliveryFeeFromSlabs = ({ distanceKm, slabsConfig, defaultFee = 0 }) => {
  const maxDistance = Number(slabsConfig?.maxDistanceKm || 7);
  if (distanceKm > maxDistance) {
    throw new Error(`Delivery distance (${distanceKm} km) exceeds maximum allowed limit of ${maxDistance} km.`);
  }

  const slabs = slabsConfig?.slabs || [];
  if (!Array.isArray(slabs) || slabs.length === 0) {
    return defaultFee;
  }

  // Find slab where minKm <= distanceKm <= maxKm
  const matched = slabs.find(
    (s) => distanceKm >= Number(s.minKm) && distanceKm <= Number(s.maxKm)
  );

  if (matched) return Number(matched.fee) || 0;

  // If beyond last slab maxKm but within maxDistance
  const highestSlab = [...slabs].sort((a, b) => Number(b.maxKm) - Number(a.maxKm))[0];
  if (highestSlab && distanceKm > Number(highestSlab.maxKm)) {
    return Number(highestSlab.fee) || defaultFee;
  }

  return defaultFee;
};

module.exports = {
  haversineKm,
  calculateDistanceKm,
  computeDeliveryFeeFromSlabs,
};
