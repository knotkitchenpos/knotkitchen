/**
 * Settings a store starts with on the day it is created (owner, 2026-10-28).
 * Only creation applies these. The schema defaults stay as they were, so a
 * store that never saved a value keeps behaving as it always has.
 *
 *   Order Type Toggles   Collection on; Delivery and Table orders off until
 *                        the owner turns them on (Settings → Order Toggles).
 *   Auto-Ready           "Mark orders Ready automatically" on.
 *   Auto E-Bill          on: the diner gets the bill on WhatsApp/SMS
 *                        (Settings → Device Configuration).
 */
const NEW_STORE_ORDER_TYPES = Object.freeze({ collection: true, delivery: false, table: false });
const NEW_STORE_AUTO_READY = true;
const NEW_STORE_POS_SETTINGS = Object.freeze({ autoEBill: true });

module.exports = { NEW_STORE_ORDER_TYPES, NEW_STORE_AUTO_READY, NEW_STORE_POS_SETTINGS };
