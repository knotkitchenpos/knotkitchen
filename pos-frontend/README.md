# 🍽️ KnotKitchen - Frontend

The frontend application for **KnotKitchen** - a full-featured Restaurant POS System built with React, Redux Toolkit, Tailwind CSS, and TanStack Query.

## ✨ Features

- 🎨 **Theme Support** - Light mode, dark mode, and system default
- 📋 **Order Management** - Create, track, and update orders in real-time
- 🪑 **Table Management** - Assign, book, and manage restaurant tables
- 🍔 **Menu System** - Browse and add items to cart with quantity controls
- 💳 **Payment Processing** - Cash and online payments via Razorpay
- 🖨️ **Receipt Printing** - Print/download order receipts
- 📱 **Installable POS** - Install from a supported mobile browser as a standalone PWA

## 🚀 Getting Started

```bash
npm install
npm run dev
```

### Mobile and tablet installation

Deploy the frontend over HTTPS and set `VITE_BACKEND_URL` to the public HTTPS URL
of the POS backend. On Android Chrome, open the deployed POS, sign in, then use
**Install app** / **Add to home screen**. The app will open in standalone mode
and share the same responsive POS interface.

`localhost` in the frontend configuration refers to the phone/tablet itself;
it will not reach a backend running on your development computer.

### Android APK

This project includes Capacitor configuration for a true APK. Install Android
Studio (including Android SDK and platform tools), configure Java 17+, then run:

```bash
npm install
npm run android:apk       # debug APK for device testing
npm run android:open      # build/sign the APK from Android Studio
```
The debug APK is generated at
`android/app/build/outputs/apk/debug/app-debug.apk`. For a distributable APK,
open the Android project, configure a release keystore, and use **Build →
Generate Signed Bundle/APK** in Android Studio. The generated Android project
is checked into this repository so future `cap sync` commands do not recreate
it.

### Download the APK from GitHub

Every push that changes the native app (`android/`, `capacitor.config.ts`,
`package.json`) starts the **Build Android APK** workflow. Release-signed builds
from `main` are published to the
[android-latest release](https://github.com/knotkitchenpos/knotkitchen/releases/tag/android-latest):
install `KnotKitchen-POS.apk` from there once, and the app then updates itself
(it asks "Install" when a newer build is out). Release signing needs the key
secrets, created once with `bash android/setup-release-signing.sh`. Each run
also keeps a `knotkitchen-pos-debug-apk` artifact for testing. Debug builds are
signed with a different key and never update themselves; a till running one
must uninstall it once before installing `KnotKitchen-POS.apk`.

The APK still needs the backend to be reachable through `VITE_BACKEND_URL`; it
cannot use `localhost` for a PC backend. Use HTTPS for both the deployed POS and
API, set `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` on the backend, and add
the deployed POS URL to `FRONTEND_URLS`. The current development machine does
not have Android SDK/Gradle/ADB configured, so APK compilation requires Android
Studio (including SDK/platform tools) and Java 17+ to be installed first.

## ⚙️ Environment Variables

Create a `.env` file in the root directory:

```
VITE_BACKEND_URL=https://pos-api.example.com
VITE_RAZORPAY_KEY_ID=your_razorpay_key
```

## 🛠️ Tech Stack

- React (Vite)
- Redux Toolkit
- Tailwind CSS
- TanStack Query
- Framer Motion
- React Router
- Notistack
- React Icons

---

Made with ❤️ by KnotKitchen