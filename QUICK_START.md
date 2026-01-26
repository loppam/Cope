# Quick Start: Firebase & Twitter OAuth

## 🚀 Quick Setup Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing
3. Enable **Authentication** → **Twitter** provider
4. Get your Firebase config from **Project Settings** → **Your apps** → **Web app**

### 3. Set Up Twitter Developer Account
1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new app
3. Get **API Key** and **API Key Secret**
4. Add Firebase callback URL to Twitter app's **Callback URI** list

### 4. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your Firebase credentials:

```bash
cp .env.example .env
```

Then edit `.env` with your Firebase config values.

### 5. Link Twitter to Firebase
1. In Firebase Console → **Authentication** → **Sign-in method** → **Twitter**
2. Paste your Twitter **API Key** and **API Key Secret**
3. Copy the Firebase callback URL
4. Add it to Twitter app's callback URLs

### 6. Test It!
```bash
npm run dev
```

Navigate to `/auth/x-connect` and click "Connect with X"

## 📚 Full Documentation

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) for detailed instructions.

## 🔑 Required Environment Variables

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## ✅ What's Included

- ✅ Firebase client SDK setup
- ✅ Twitter OAuth integration
- ✅ Authentication context (`useAuth()` hook)
- ✅ User profile management in Firestore
- ✅ Protected routes ready
- ✅ Error handling with toast notifications

## 🎯 Next Steps

1. Complete Firebase and Twitter setup (see FIREBASE_SETUP.md)
2. Add environment variables to `.env`
3. Test authentication flow
4. Set up Firebase Admin SDK for backend (if needed)
