const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const { csdOnly } = require("../middlewares/csdOnly");
const { upsertCustomer, listCustomers, getCustomer, updateCustomer, customerOrders } = require("../controllers/customerController");

/**
 * The customer list is closed to the store: neither the owner nor any staff
 * member can list, open, edit or read the order history of a customer. A
 * list of everyone who ever ordered, with phone numbers, is exactly what
 * walks out of the door with a departing employee. KnotKitchen support (a
 * CSD session) is the only caller let through; the full details and the CSV
 * export live in the CSD console (/api/csd/restaurants/:storeId/customers).
 *
 * Orders still record the customer (addOrder upserts them itself), so
 * nothing about taking an order depends on these routes.
 */
const closed = csdOnly("Customers");

router.route("/").get(isVerifiedUser, closed, requirePermission("CUSTOMER_VIEW"), listCustomers);
router.route("/").post(isVerifiedUser, closed, requirePermission("CUSTOMER_CREATE"), upsertCustomer);
router.route("/:id").get(isVerifiedUser, closed, requirePermission("CUSTOMER_VIEW"), getCustomer);
router.route("/:id").put(isVerifiedUser, closed, requirePermission("CUSTOMER_CREATE"), updateCustomer);
router.route("/:id/orders").get(isVerifiedUser, closed, requirePermission("CUSTOMER_VIEW"), customerOrders);

module.exports = router;
