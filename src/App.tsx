import { RouterProvider } from 'react-router';
import { router } from '@/routes';
import { Toaster } from 'sonner';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { OfflineIndicator } from '@/components/pwa/OfflineIndicator';
import { AuthProvider } from '@/contexts/AuthContext';

export default function App() {
  return (
    <AuthProvider>
      <OfflineIndicator />
      <RouterProvider router={router} />
      <Toaster 
        position="top-center"
        toastOptions={{
          style: {
            background: '#0F4A38',
            color: '#fff',
            border: '1px solid rgba(11, 110, 79, 0.3)',
          },
        }}
      />
      <InstallPrompt />
    </AuthProvider>
  );
}
