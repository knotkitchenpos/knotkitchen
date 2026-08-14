const mongoose = require("mongoose");
const config = require("../config/config");
const Restaurant = require("../models/restaurantModel");
const Store = require("../models/storeModel");
const User = require("../models/userModel");

const generateUniqueStoreId = async () => {
  let attempts = 0;
  while (attempts < 100) {
    const storeId = Math.floor(100000 + Math.random() * 900000).toString();
    const existingStore = await Store.findOne({ storeId });
    const existingRestaurant = await Restaurant.findOne({ storeId });
    if (!existingStore && !existingRestaurant) return storeId;
    attempts++;
  }
  throw new Error("Failed to generate unique Store ID");
};

const backfill = async () => {
  try {
    const dbUri = config.dbUrl || process.env.MONGO_URI || "mongodb://localhost:27017/pos-db";
    await mongoose.connect(dbUri);
    console.log("Connected to MongoDB for Store ID backfill...");

    const restaurants = await Restaurant.find({ isDeleted: { $ne: true } });
    console.log(`Found ${restaurants.length} restaurants.`);

    for (const restaurant of restaurants) {
      let storeId = restaurant.storeId;
      if (!storeId || !/^\d{6}$/.test(String(storeId).trim())) {
        storeId = await generateUniqueStoreId();
        restaurant.storeId = storeId;
        await restaurant.save();
        console.log(`Assigned Store ID ${storeId} to Restaurant: ${restaurant.name} (${restaurant._id})`);
      }

      // Check or sync Store model doc
      let store = await Store.findOne({ restaurantId: restaurant._id });
      if (!store) {
        let ownerUser = null;
        if (restaurant.ownerId) {
          ownerUser = await User.findById(restaurant.ownerId);
        }
        if (!ownerUser) {
          ownerUser = await User.findOne({ restaurantId: restaurant._id });
        }

        store = await Store.create({
          storeId,
          storeName: restaurant.name,
          ownerName: ownerUser ? ownerUser.name : restaurant.name + " Owner",
          ownerPhone: ownerUser ? ownerUser.phone : restaurant.phone || "9876543210",
          restaurantId: restaurant._id,
          status: restaurant.isActive ? "active" : "suspended",
        });
        console.log(`Created Store document for ${restaurant.name} with Store ID ${storeId}`);
      } else if (store.storeId !== storeId) {
        store.storeId = storeId;
        await store.save();
        console.log(`Updated Store document for ${restaurant.name} to Store ID ${storeId}`);
      }

      // Ensure Owner user has storeId set
      if (restaurant.ownerId) {
        await User.updateOne({ _id: restaurant.ownerId }, { $set: { storeId } });
      }
      await User.updateMany({ restaurantId: restaurant._id }, { $set: { storeId } });
    }

    console.log("Backfill completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
};

backfill();
