const mongoose = require("mongoose");
const config = require("./config");


const backfillStoreIds = async () => {
  try {
    const Store = mongoose.model("Store");
    const Restaurant = mongoose.model("Restaurant");

    const generate6DigitId = async () => {
      let storeId;
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 1000) {
        attempts++;
        storeId = String(Math.floor(100000 + Math.random() * 900000));
        const existingStore = await Store.findOne({ storeId });
        const existingRest = await Restaurant.findOne({ storeId });
        if (!existingStore && !existingRest) {
          isUnique = true;
        }
      }
      return storeId;
    };

    const stores = await Store.find({});
    for (const store of stores) {
      if (!store.storeId || !/^\d{6}$/.test(String(store.storeId))) {
        const newId = await generate6DigitId();
        store.storeId = newId;
        await store.save();
        console.log(`[Migration] Backfilled Store ${store.storeName} with 6-digit Store ID: ${newId}`);
      }
    }

    const restaurants = await Restaurant.find({});
    for (const rest of restaurants) {
      if (!rest.storeId || !/^\d{6}$/.test(String(rest.storeId))) {
        const linkedStore = await Store.findOne({ restaurantId: rest._id });
        if (linkedStore && linkedStore.storeId && /^\d{6}$/.test(String(linkedStore.storeId))) {
          rest.storeId = linkedStore.storeId;
        } else {
          const newId = await generate6DigitId();
          rest.storeId = newId;
        }
        await rest.save();
        console.log(`[Migration] Backfilled Restaurant ${rest.name} with 6-digit Store ID: ${rest.storeId}`);
      }
    }
  } catch (err) {
    console.error("[Migration Error]", err.message);
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.databaseURI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    require("../models/storeModel");
    require("../models/restaurantModel");
    await backfillStoreIds();
  } catch (error) {
    console.log(`❌ Database connection failed: ${error.message}`);
    process.exit();
  }
};

module.exports = connectDB;
