const express = require("express");
const router = express.Router();
const {
  getPublicStoreInfo,
  getPublicStoreMenu,
} = require("../controllers/publicStoreController");

router.get("/store/:storeId", getPublicStoreInfo);
router.get("/store/:storeId/menu", getPublicStoreMenu);

module.exports = router;
