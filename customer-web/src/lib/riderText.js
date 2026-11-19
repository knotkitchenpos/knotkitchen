/**
 * The store's own rider, as the customer sees them (Knot Eats order page and
 * a store website's tracking page): a first name and what they are doing.
 * `rider` is the API's { name, stage } or null.
 */
export function riderText(rider) {
  if (!rider?.name) return "";
  const n = rider.name;
  if (rider.stage === "assigned") return `${n} will deliver your order`;
  if (rider.stage === "accepted") return `${n} is picking up your order`;
  if (rider.stage === "on_the_way") return `${n} is on the way with your order`;
  if (rider.stage === "arrived") return `${n} has arrived`;
  if (rider.stage === "delivered") return `Delivered by ${n}`;
  return "";
}
