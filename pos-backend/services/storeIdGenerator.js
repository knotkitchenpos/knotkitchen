const Store = require("../models/storeModel");

const generateRandomStoreId = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

const generateUniqueStoreId = async (maxRetries = 20) => {
  for (let i = 0; i < maxRetries; i += 1) {
    const storeId = generateRandomStoreId();
    const exists = await Store.exists({ storeId, isDeleted: { $ne: true } });
    if (!exists) return storeId;
  }
  throw new Error("Unable to generate a unique Store ID. Please try again.");
};

module.exports = { generateUniqueStoreId, generateRandomStoreId };
