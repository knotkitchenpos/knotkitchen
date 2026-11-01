const Store = require("../models/storeModel");
const CsdAgreementLink = require("../models/csdAgreementLinkModel");
const { PlatformInvoice } = require("../models/platformSubscriptionModel");

/**
 * Taken: any Store row (a deleted one included: storeId is a unique index),
 * or a kept record of an erased store. A store record erased from the support
 * desk leaves its invoices (KK-<storeId>-0001...) and signed agreement behind
 * for the retention period; a new store with that ID would share their
 * numbers (owner, 2026-10-31).
 */
const storeIdTaken = async (storeId) =>
  Boolean(
    (await Store.exists({ storeId })) ||
      (await PlatformInvoice.exists({ storeId })) ||
      (await CsdAgreementLink.exists({ storeId })),
  );

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
    if (!(await storeIdTaken(storeId))) return storeId;
  }
  throw new Error("Unable to generate a unique Store ID. Please try again.");
};

module.exports = { generateUniqueStoreId, generateRandomStoreId, storeIdTaken };
