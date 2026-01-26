// Client-side function to trigger webhook sync when watchlist changes
// This calls the Vercel serverless function to update Helius webhook

const WEBHOOK_SYNC_URL = import.meta.env.VITE_WEBHOOK_SYNC_URL || '/api/webhook/sync';
const WEBHOOK_SYNC_SECRET = import.meta.env.VITE_WEBHOOK_SYNC_SECRET;

/**
 * Sync watched wallets to Helius webhook
 * Call this after adding/removing wallets from watchlist
 */
export async function syncWebhook(): Promise<void> {
  try {
    const response = await fetch(WEBHOOK_SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WEBHOOK_SYNC_SECRET && {
          'Authorization': `Bearer ${WEBHOOK_SYNC_SECRET}`,
        }),
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Webhook sync failed:', error);
      // Don't throw - this is a background operation
    } else {
      const data = await response.json();
      console.log('Webhook synced successfully:', data);
    }
  } catch (error) {
    console.error('Error syncing webhook:', error);
    // Don't throw - this is a background operation
  }
}
