# Fix: auth/invalid-credential Error

The `auth/invalid-credential` error means **Twitter OAuth is not properly configured in Firebase**. Follow these steps to fix it:

## 🔧 Quick Fix Steps

### Step 1: Enable Twitter in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **dplug-687cf**
3. Navigate to **Authentication** → **Sign-in method**
4. Find **Twitter** in the list
5. Click on **Twitter** provider
6. **Enable** the provider (toggle switch)

### Step 2: Get Twitter API Credentials

1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Sign in and go to **Projects & Apps**
3. Select your app (or create a new one)
4. Go to **Keys and tokens** tab
5. Copy:
   - **API Key** (Consumer Key)
   - **API Key Secret** (Consumer Secret)

### Step 3: Add Twitter Credentials to Firebase

1. Back in Firebase Console → **Authentication** → **Sign-in method** → **Twitter**
2. Paste your **API Key** and **API Key Secret**
3. Click **Save**

### Step 4: Configure Twitter Callback URL

1. In Firebase Console, after saving Twitter credentials, you'll see a **Callback URL**
   - It looks like: `https://dplug-687cf.firebaseapp.com/__/auth/handler`
2. Copy this URL
3. Go back to [Twitter Developer Portal](https://developer.twitter.com/)
4. Go to your app → **User authentication settings**
5. Click **Set up** or **Edit**
6. Under **Callback URI / Redirect URL**, add:
   - `https://dplug-687cf.firebaseapp.com/__/auth/handler`
   - `http://localhost:5173` (for local development)
7. Save the settings

### Step 5: Verify Twitter App Settings

In Twitter Developer Portal, make sure:
- **App permissions**: Read (or Read and Write)
- **Type of App**: Web App
- **Callback URLs**: Include the Firebase callback URL
- **Website URL**: Your app URL (or `http://localhost:5173` for dev)

### Step 6: Restart Dev Server

After making changes:
```bash
# Stop the dev server (Ctrl+C)
# Then restart
npm run dev
```

## ✅ Verification Checklist

- [ ] Twitter provider is **Enabled** in Firebase Console
- [ ] Twitter **API Key** and **Secret** are added in Firebase
- [ ] Firebase callback URL is added to Twitter app
- [ ] Twitter app has correct permissions
- [ ] Dev server has been restarted

## 🐛 Still Not Working?

### Check Browser Console
Look for additional error messages that might give more clues.

### Verify Firebase Config
Make sure your `.env` file has all the correct values:
```env
VITE_FIREBASE_API_KEY=AIzaSyDibKpiPkR1L8vnPZvgRVcxfAr0Hu08NiI
VITE_FIREBASE_AUTH_DOMAIN=dplug-687cf.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=dplug-687cf
```

### Common Issues:
1. **Callback URL mismatch**: The URL in Twitter must exactly match Firebase's callback URL
2. **Wrong credentials**: Double-check API Key and Secret are correct
3. **App not saved**: Make sure you clicked "Save" in both Firebase and Twitter
4. **Cached credentials**: Try clearing browser cache or using incognito mode

## 📞 Need Help?

If it's still not working after following these steps:
1. Check the browser console for the exact error code
2. Verify all URLs match exactly (no trailing slashes, correct protocol)
3. Make sure Twitter app is in "Development" or "Production" mode (not suspended)
