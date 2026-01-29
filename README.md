# COPE - Social Trading App

A modern Progressive Web App (PWA) for cryptocurrency trading and wallet management.

## 🚀 Features

- **Progressive Web App** - Installable, offline-capable, and fast
- **Modern UI** - Built with React, TypeScript, and Tailwind CSS
- **Wallet Management** - Connect, import, and manage cryptocurrency wallets
- **Trading Interface** - Trade cryptocurrencies with an intuitive interface
- **Wallet Scanner** - Scan and analyze wallet addresses
- **Portfolio Tracking** - Monitor positions and performance
- **Offline Support** - Works offline with service worker caching

## 📋 Prerequisites

- Node.js 18+
- npm or yarn

## 🛠️ Installation

```bash
# Install dependencies
npm install

# Generate PWA icons (required for production)
# First, create a 512x512px icon, then:
npm install -D sharp
npm run generate-icons path/to/your/icon.png

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📁 Project Structure

```
cope/
├── public/                 # Static assets
│   ├── icons/             # PWA icons (generate before production)
│   ├── manifest.json      # Web app manifest
│   ├── sw.js             # Service worker (auto-generated)
│   └── robots.txt         # SEO robots file
├── src/
│   ├── App.tsx            # Root application component
│   ├── routes.tsx         # Application routes configuration
│   ├── main.tsx           # Application entry point
│   ├── components/        # Reusable UI components
│   │   ├── pwa/          # PWA-specific components
│   │   └── ui/           # UI component library (shadcn/ui)
│   ├── pages/             # Page/screen components
│   │   ├── onboarding/    # Onboarding flow pages
│   │   ├── scanner/       # Scanner feature pages
│   │   └── cope/          # COPE feature pages
│   ├── layouts/           # Layout components
│   ├── lib/               # Utilities and helpers
│   │   ├── pwa.ts         # PWA functionality
│   │   └── utils.ts       # General utilities
│   └── styles/            # Global styles
├── scripts/               # Build and utility scripts
├── vite.config.ts         # Vite configuration
├── tsconfig.json          # TypeScript configuration
└── package.json           # Dependencies and scripts
```

## 🔧 Configuration

### PWA Configuration

See [PWA_SETUP.md](./PWA_SETUP.md) for detailed PWA setup and configuration.

### Firebase Auth on Mobile (redirect / Safari)

For X/Twitter sign-in with redirect on mobile (and to fix init.json 404 / iframe errors), see [FIREBASE_AUTH_MOBILE.md](./FIREBASE_AUTH_MOBILE.md).

### Firestore rules and webhooks (Alerts)

Security rules (RLS) and how notifications reach the Alerts page: see [docs/WEBHOOKS_AND_ALERTS.md](./docs/WEBHOOKS_AND_ALERTS.md). Deploy Firestore rules with `firebase deploy --only firestore:rules`.

### Environment Variables

Create a `.env` file in the root directory for environment-specific configuration:

```env
VITE_API_URL=your_api_url
VITE_APP_NAME=COPE
```

## 📱 PWA Features

- ✅ Installable on mobile and desktop
- ✅ Offline support with service worker
- ✅ App shortcuts for quick access
- ✅ Push notification support (ready)
- ✅ Background sync (ready)
- ✅ Responsive design
- ✅ Fast loading with caching

## 🧪 Development

```bash
# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## 📦 Build

The production build includes:

- Optimized and minified code
- Service worker for offline support
- PWA manifest
- All required icons

```bash
npm run build
```

Output will be in the `dist/` directory.

## 🎨 Styling

The app uses:

- **Tailwind CSS** for utility-first styling
- **Custom theme** in `src/styles/theme.css`
- **Responsive design** for mobile and desktop

## 🔐 Security

- Content Security Policy ready
- HTTPS required for PWA features
- Secure service worker implementation

## 📚 Documentation

- [PWA Setup Guide](./PWA_SETUP.md) - Complete PWA configuration
- [Icon Generation](./public/icons/README.md) - How to generate PWA icons
- [Guidelines](./guidelines/Guidelines.md) - Development guidelines

## 🤝 Contributing

1. Follow the code style and guidelines
2. Ensure PWA features continue to work
3. Test on multiple devices and browsers
4. Update documentation as needed

## 📄 License

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for license information.

## 🐛 Troubleshooting

### PWA not working

- Ensure you're using HTTPS (or localhost)
- Check browser console for service worker errors
- Verify manifest.json is valid

### Icons not showing

- Generate icons using `npm run generate-icons`
- Verify all icon files exist in `public/icons/`
- Check manifest.json icon paths

### Build errors

- Clear `node_modules` and reinstall
- Check TypeScript errors
- Verify all dependencies are installed

## 🚀 Deployment

1. Generate production icons
2. Build the app: `npm run build`
3. Deploy the `dist/` directory to a web server with HTTPS
4. Ensure service worker and manifest are accessible
5. Test PWA features on real devices

## 📞 Support

For issues and questions, please refer to the project documentation or create an issue.

---

Built with ❤️ using React, TypeScript, Vite, and Tailwind CSS
