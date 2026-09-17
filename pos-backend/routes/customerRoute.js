const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const { upsertCustomer, listCustomers, getCustomer, updateCustomer, customerOrders } = require("../controllers/customerController");

router.route("/").get(isVerifiedUser, requirePermission("CUSTOMER_VIEW"), listCustomers);
router.route("/").post(isVerifiedUser, requirePermission("CUSTOMER_CREATE"), upsertCustomer);
router.route("/:id").get(isVerifiedUser, requirePermission("CUSTOMER_VIEW"), getCustomer);
router.route("/:id").put(isVerifiedUser, requirePermission("CUSTOMER_CREATE"), updateCustomer);
router.route("/:id/orders").get(isVerifiedUser, requirePermission("CUSTOMER_VIEW"), customerOrders);

module.exports = router;