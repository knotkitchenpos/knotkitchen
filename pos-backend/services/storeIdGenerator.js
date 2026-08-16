const Store = require("../models/storeModel");

const generateRandomStoreId = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

const generateUniqueStoreId = async (maxRetries = 20) => {
  // Some command-line flows and isolated controller tests construct a
  // restaurant before Mongo is connected. Do not make authentication wait for
  // Mongoose's 10-second operation buffer in that case; the restaurant's
  // unique storeId index remains the authoritative collision guard once the
  // document is persisted.
  if (Store.db?.readyState !== 1) return generateRandomStoreId();

  for (let i = 0; i < maxRetries; i += 1) {
    const storeId = generateRandomStoreId();
    const exists = await Store.exists({ storeId, isDeleted: { $ne: true } });
    if (!exists) return storeId;
  }
  throw new Error("Unable to generate a unique Store ID. Please try again.");
};

module.exports = { generateUniqueStoreId, generateRandomStoreId };
