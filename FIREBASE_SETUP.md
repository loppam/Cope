# Firebase & Twitter OAuth Setup Guide

This guide will walk you through setting up Firebase Authentication with Twitter OAuth for the COPE app.

## 📋 Prerequisites

- Firebase account
- Twitter Developer account
- Node.js installed

## 🔥 Step 1: Firebase Setup

### 1.1 Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard:
   - Enter project name: `cope-app` (or your preferred name)
   - Enable Google Analytics (optional)
   - Create project

### 1.2 Enable Authentication

1. In Firebase Console, go to **Authentication** → **Get started**
2. Click on **Sign-in method** tab
3. Click on **Twitter** provider
4. **Enable** Twitter sign-in
5. You'll need Twitter API credentials (see Step 2)

### 1.3 Get Firebase Configuration

1. In Firebase Console, go to **Project Settings** (gear icon)
2. Scroll down to **Your apps** section
3. Click **Web** icon (`</>`)
4. Register app with nickname: `COPE Web App`
5. Copy the Firebase configuration object

### 1.4 Add Firebase Config to Environment

Create a `.env` file in the project root:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Optional: Firebase Emulator (for development)
VITE_USE_FIREBASE_EMULATOR=false
```

**⚠️ Important:** Add `.env` to `.gitignore` (already included)

## 🐦 Step 2: Twitter Developer Setup

### 2.1 Create Twitter Developer Account

1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Sign in with your Twitter account
3. Apply for a developer account (if needed)
4. Create a new project and app

### 2.2 Create Twitter App

1. In Twitter Developer Portal, go to **Projects & Apps**
2. Click **Create App** or **+ Add App**
3. Fill in app details:
   - **App name**: COPE App
   - **App environment**: Development (or Production)
   - **App permissions**: Read and Write (or Read only if you only need profile)
4. Click **Create**

### 2.3 Get Twitter API Credentials

1. In your Twitter App settings, go to **Keys and tokens** tab
2. Copy the following:
   - **API Key** (Consumer Key)
   - **API Key Secret** (Consumer Secret)
3. **Generate** Access Token and Secret (if needed for additional permissions)

### 2.4 Configure Twitter OAuth Settings

1. In Twitter App settings, go to **User authentication settings**
2. Click **Set up**
3. Configure:
   - **App permissions**: Read and Write (or Read only)
   - **Type of App**: Web App
   - **Callback URI / Redirect URL**: 
     - Development: `http://localhost:5173` (or your dev port)
     - Production: `https://yourdomain.com`
   - **Website URL**: Your app URL
   - **App info**: Fill in required fields
4. Click **Save**

### 2.5 Add Twitter Credentials to Firebase

1. Go back to Firebase Console → **Authentication** → **Sign-in method**
2. Click on **Twitter** provider
3. Paste your Twitter **API Key** and **API Key Secret**
4. Copy the **Callback URL** from Firebase (looks like: `https://your-project.firebaseapp.com/__/auth/handler`)
5. Go back to Twitter Developer Portal
6. Add the Firebase callback URL to your Twitter app's **Callback URI / Redirect URL** list
7. Save both Firebase and Twitter settings

## 📦 Step 3: Install Dependencies

Run the following command to install Firebase packages:

```bash
npm install firebase
```

Or if using yarn:

```bash
yarn add firebase
```

## 🔧 Step 4: Firebase Admin SDK Setup (Backend)

Since you mentioned using Firebase Admin, you'll need to set up a backend service. Here's the setup:

### 4.1 Install Firebase Admin SDK

In your backend project:

```bash
npm install firebase-admin
```

### 4.2 Get Service Account Key

1. In Firebase Console, go to **Project Settings** → **Service accounts**
2. Click **Generate new private key**
3. Download the JSON file (keep this secure!)
4. Save it as `serviceAccountKey.json` in your backend project

### 4.3 Initialize Firebase Admin

Create a file `firebase-admin.js` in your backend:

```javascript
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
```

### 4.4 Backend API Endpoint Example

Create an endpoint to verify tokens and get user data:

```javascript
const admin = require('./firebase-admin');
const express = require('express');
const router = express.Router();

// Verify ID token and get user data
router.post('/verify-token', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    // Verify the ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const userData = userDoc.data();
    
    res.json({ user: userData });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
```

## 🚀 Step 5: Test the Setup

### 5.1 Start Development Server

```bash
npm run dev
```

### 5.2 Test Twitter Sign-In

1. Navigate to `/auth/x-connect`
2. Click "Connect with X" button
3. You should see Twitter OAuth popup
4. Authorize the app
5. You should be redirected to wallet setup

### 5.3 Verify in Firebase Console

1. Go to Firebase Console → **Authentication** → **Users**
2. You should see the user who signed in
3. Check **Firestore Database** → `users` collection
4. Verify user profile was created

## 🔒 Step 6: Security Rules

### 6.1 Firestore Security Rules

Update your Firestore security rules in Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Add other rules as needed
  }
}
```

### 6.2 Storage Security Rules (if using)

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 📝 Step 7: Environment Variables Checklist

Make sure your `.env` file has all required variables:

```env
# Firebase
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123

# Optional
VITE_USE_FIREBASE_EMULATOR=false
```

## 🐛 Troubleshooting

### Twitter OAuth Not Working

1. **Check callback URLs**: Ensure Firebase callback URL is added to Twitter app
2. **Verify credentials**: Double-check API Key and Secret in Firebase
3. **Check app permissions**: Twitter app must have correct permissions
4. **Browser console**: Check for CORS or network errors

### Firebase Not Initializing

1. **Check environment variables**: Ensure all `VITE_` variables are set
2. **Restart dev server**: After changing `.env`, restart the server
3. **Check Firebase config**: Verify all values are correct

### User Profile Not Saving

1. **Check Firestore rules**: Ensure write permissions are correct
2. **Check network tab**: Look for Firestore write errors
3. **Verify Firestore is enabled**: Enable Firestore in Firebase Console

## 📚 Additional Resources

- [Firebase Authentication Docs](https://firebase.google.com/docs/auth)
- [Twitter OAuth 2.0 Guide](https://developer.twitter.com/en/docs/authentication/oauth-2-0)
- [Firebase Admin SDK Docs](https://firebase.google.com/docs/admin/setup)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

## ✅ Setup Complete!

Once all steps are completed, your app should have:
- ✅ Firebase Authentication configured
- ✅ Twitter OAuth working
- ✅ User profiles saved to Firestore
- ✅ Authentication context available throughout the app

You can now use the `useAuth()` hook in any component to access user data and authentication methods.
