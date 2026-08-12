const mongoose = require("mongoose");
const config = require("../config/config");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const User = require("../models/userModel");
const Menu = require("../models/menuModel");
const bcrypt = require("bcrypt");

const seedDemoStores = async () => {
  try {
    console.log("Connecting to Database for seeding demo stores...");
    await mongoose.connect(config.databaseUrl || "mongodb://localhost:27017/pos-system");

    // Demo Store 1 Data
    const store1Data = {
      storeId: "483921",
      storeName: "Demo Takeaway 01",
      ownerName: "Demo Owner 01",
      ownerPhone: "9876543210",
    };

    // Demo Store 2 Data
    const store2Data = {
      storeId: "729154",
      storeName: "Demo Takeaway 02",
      ownerName: "Demo Owner 02",
      ownerPhone: "9876543211",
    };

    console.log("Seeding Store 1...");
    let store1 = await Store.findOne({ storeId: store1Data.storeId });
    if (!store1) {
      store1 = await Store.create(store1Data);
    }

    let user1 = await User.findOne({ phone: store1Data.ownerPhone });
    if (!user1) {
      const hashedPassword = await bcrypt.hash("password123", 10);
      user1 = await User.create({
        name: store1Data.ownerName,
        phone: store1Data.ownerPhone,
        address: "123 High Street, London",
        email: "demo01@knotkitchen.com",
        password: hashedPassword,
        storeId: store1Data.storeId,
        role: "Owner",
        isVerified: true,
      });
    }

    let restaurant1 = await Restaurant.findOne({ storeId: store1Data.storeId });
    if (!restaurant1) {
      restaurant1 = await Restaurant.create({
        name: store1Data.storeName,
        ownerId: user1._id,
        storeId: store1Data.storeId,
        currency: "GBP",
        address: { line1: "123 High Street", city: "London", country: "UK" },
        branding: { logo: "🍕", primaryColor: "#e63946" },
      });
    }

    store1.restaurantId = restaurant1._id;
    store1.ownerId = user1._id;
    await store1.save();

    // Menu 01 for Demo Takeaway 01
    await Menu.deleteMany({ restaurantId: restaurant1._id });
    await Menu.create({
      name: "Italian Pizza & Burgers",
      icon: "🍕",
      createdBy: user1._id,
      restaurantId: restaurant1._id,
      published: true,
      items: [
        {
          name: "Margherita Supreme Pizza",
          price: 12.99,
          category: "Pizzas",
          description: "Fresh mozzarella, San Marzano tomatoes, fresh basil, olive oil",
          isAvailable: true,
          isVegetarian: true,
        },
        {
          name: "Pepperoni Passion Pizza",
          price: 14.99,
          category: "Pizzas",
          description: "Loaded double pepperoni, mozzarella, signature tomato sauce",
          isAvailable: true,
        },
        {
          name: "Truffle Mushroom Burger",
          price: 11.50,
          category: "Burgers",
          description: "Aged beef patty, truffle aioli, wild mushrooms, swiss cheese",
          isAvailable: true,
        },
        {
          name: "Garlic Dough Balls",
          price: 5.99,
          category: "Sides",
          description: "Baked fresh dough balls served with garlic butter dip",
          isAvailable: true,
          isVegetarian: true,
        },
      ],
    });

    console.log("Seeding Store 2...");
    let store2 = await Store.findOne({ storeId: store2Data.storeId });
    if (!store2) {
      store2 = await Store.create(store2Data);
    }

    let user2 = await User.findOne({ phone: store2Data.ownerPhone });
    if (!user2) {
      const hashedPassword = await bcrypt.hash("password123", 10);
      user2 = await User.create({
        name: store2Data.ownerName,
        phone: store2Data.ownerPhone,
        address: "45 Station Road, Manchester",
        email: "demo02@knotkitchen.com",
        password: hashedPassword,
        storeId: store2Data.storeId,
        role: "Owner",
        isVerified: true,
      });
    }

    let restaurant2 = await Restaurant.findOne({ storeId: store2Data.storeId });
    if (!restaurant2) {
      restaurant2 = await Restaurant.create({
        name: store2Data.storeName,
        ownerId: user2._id,
        storeId: store2Data.storeId,
        currency: "GBP",
        address: { line1: "45 Station Road", city: "Manchester", country: "UK" },
        branding: { logo: "🍜", primaryColor: "#2a9d8f" },
      });
    }

    store2.restaurantId = restaurant2._id;
    store2.ownerId = user2._id;
    await store2.save();

    // Menu 02 for Demo Takeaway 02
    await Menu.deleteMany({ restaurantId: restaurant2._id });
    await Menu.create({
      name: "Asian Street Food & Sushi",
      icon: "🍜",
      createdBy: user2._id,
      restaurantId: restaurant2._id,
      published: true,
      items: [
        {
          name: "Chicken Tonkotsu Ramen",
          price: 13.50,
          category: "Ramen & Noodles",
          description: "Rich pork broth, ajitama egg, bamboo shoots, tender chicken chashu",
          isAvailable: true,
        },
        {
          name: "Pad Thai Noodles",
          price: 12.00,
          category: "Ramen & Noodles",
          description: "Stir-fried rice noodles with king prawns, crushed peanuts, bean sprouts",
          isAvailable: true,
        },
        {
          name: "Salmon Nigiri Set (6pcs)",
          price: 10.99,
          category: "Sushi",
          description: "Fresh Scottish salmon on seasoned sushi rice",
          isAvailable: true,
        },
        {
          name: "Steamed Pork Gyoza",
          price: 6.50,
          category: "Starters",
          description: "Handmade dumplings served with soy vinegar dipping sauce",
          isAvailable: true,
        },
      ],
    });

    console.log("Successfully seeded 2 demo takeaway stores with separated menus!");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding demo stores:", err);
    process.exit(1);
  }
};

seedDemoStores();
