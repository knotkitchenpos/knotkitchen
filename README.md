# 🍽️ KnotKitchen

A full-featured **Restaurant POS System** built using the **MERN Stack** to streamline restaurant operations, enhance customer experience, and manage orders, payments, and inventory with ease.

## ✨ Features

- 🖥️ **POS Dashboard** - Overview of sales, orders, and performance metrics
- 📋 **Order Management** - Create, track, and update orders in real-time
- 🪑 **Table Management** - Assign, book, and manage restaurant tables
- 🍔 **Menu System** - Browse and add items to cart with quantity controls
- 💳 **Payment Processing** - Cash and online payments via Razorpay
- 🖨️ **Receipt Printing** - Print/download order receipts
- 🎨 **Theme Support** - Light mode, dark mode, and system default

## 🛠️ Tech Stack

**Frontend:**
- React (Vite)
- Redux Toolkit
- Tailwind CSS
- TanStack Query
- Framer Motion
- React Router
- Notistack
- React Icons

**Backend:**
- Node.js
- Express
- MongoDB (Mongoose)
- JWT Authentication
- Razorpay Integration

## 🚀 Getting Started

### Prerequisites
- Node.js (v16+)
- MongoDB

### Backend Setup

```bash
cd pos-backend
npm install
cp .env.example .env
# Update your environment variables in .env
npm run dev
```

### Frontend Setup

```bash
cd pos-frontend
npm install
cp .env.example .env
# Update your environment variables in .env
npm run dev
```

## 📁 Project Structure

```
Restaurant_POS_System/
├── pos-backend/          # Express + MongoDB backend
│   ├── config/           # Database configuration
│   ├── controllers/      # Route controllers
│   ├── middlewares/      # Auth middleware
│   ├── models/           # Mongoose models
│   └── routes/           # API routes
└── pos-frontend/         # React + Vite frontend
    └── src/
        ├── components/   # UI components
        ├── hooks/        # Custom hooks
        ├── pages/        # Page components
        ├── redux/        # Redux store & slices
        └── utils/        # Utility functions
```

## ⚙️ Environment Variables

### Backend (.env)
```
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:5000/api
VITE_RAZORPAY_KEY_ID=your_razorpay_key
```

---

Made with ❤️ by KnotKitchen