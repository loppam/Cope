# Cross-Platform Push Notifications

This app supports push notifications on **all platforms** including Safari/iOS using a unified system that automatically selects the best method for each browser.

## How It Works

### Client-Side (Automatic Detection)

The app automatically detects the browser and uses the appropriate push method:

1. **Safari/iOS**: Uses **Web Push API** (iOS 16.4+)
2. **Chrome/Firefox/Edge**: Uses **Firebase Cloud Messaging (FCM)**
3. **Fallback**: If FCM fails, automatically tries Web Push API

### Implementation

- **`requestPermissionAndGetPushToken()`**: Unified function that returns `{ token, platform }`
  - Safari/iOS → Web Push subscription (JSON object)
  - Other browsers → FCM token (string)
- **Service Worker**: Handles both FCM and Web Push notifications
- **Backend**: Automatically detects token type and sends via appropriate method

## Setup Requirements

### 1. VAPID Keys

You need both **public** and **private** VAPID keys:

```bash
# Install web-push globally (if not already installed)
npm install -g web-push

# Generate VAPID keys
web-push generate-vapid-keys
```

This will output:

- **Public Key**: Use for `VITE_FIREBASE_VAPID_KEY` (client-side)
- **Private Key**: Use for `FIREBASE_VAPID_PRIVATE_KEY` (server-side only)

### 2. Environment Variables

Add to your `.env` and Vercel environment:

```env
# Client-side (public key)
VITE_FIREBASE_VAPID_KEY=your_vapid_public_key_here

# Server-side (private key - keep secret!)
FIREBASE_VAPID_PRIVATE_KEY=your_vapid_private_key_here
```

### 3. Firebase Console

1. Go to Firebase Console → Project Settings → Cloud Messaging
2. Add your VAPID public key under "Web configuration"
3. This is used for FCM (Chrome/Firefox/Edge)

## How It's Used

### User Flow

1. User clicks "Enable Push Notifications" in Profile
2. Browser requests notification permission
3. App automatically:
   - Detects browser type
   - Subscribes via FCM (Chrome/Firefox) or Web Push (Safari/iOS)
   - Stores token/subscription with platform identifier
4. Backend sends notifications via appropriate method

### Backend Sending

The backend automatically:

- Detects if token is FCM (string) or Web Push (JSON subscription)
- Sends via Firebase Admin SDK (FCM) or web-push library (Web Push)
- Handles invalid/expired tokens automatically

## Browser Support

| Browser                  | Method   | iOS Version Required |
| ------------------------ | -------- | -------------------- |
| Chrome (Desktop/Mobile)  | FCM      | N/A                  |
| Firefox (Desktop/Mobile) | FCM      | N/A                  |
| Edge (Desktop/Mobile)    | FCM      | N/A                  |
| Safari (Desktop)         | Web Push | macOS 13+            |
| Safari (iOS)             | Web Push | iOS 16.4+            |

## Troubleshooting

### "Push notifications not supported"

- **Safari iOS < 16.4**: Web Push requires iOS 16.4+
- **No Service Worker**: Ensure PWA is installed/working
- **VAPID keys missing**: Check environment variables

### Notifications not received

1. Check browser notification permissions
2. Verify VAPID keys are set correctly
3. Check service worker is registered
4. Check browser console for errors

### Safari-specific issues

- Must be iOS 16.4+ for Web Push support
- User must grant notification permission
- App should be added to home screen (PWA) for best experience

## Technical Details

### Token Storage

- **FCM tokens**: Stored as strings
- **Web Push subscriptions**: Stored as JSON strings
- Both stored in `users/{uid}/pushTokens/{hash}` with `platform` field

### Service Worker

- Handles FCM via Firebase Messaging SDK
- Handles Web Push via native `push` event listener
- Unified `notificationclick` handler for both

### Backend

- `api/push/send.ts`: Sends to both FCM and Web Push
- `api/webhook/transaction.ts`: Uses same cross-platform logic
- Automatically removes invalid/expired tokens
