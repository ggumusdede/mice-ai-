// Prints a fresh VAPID key pair for Web Push (§15) in .env format:
//   npm run vapid:generate -w apps/api   →  VAPID_PUBLIC_KEY=… / VAPID_PRIVATE_KEY=…
// Generate ONCE per deployment and keep the private key secret: rotating it invalidates every browser subscription.
import { generateVAPIDKeys } from 'web-push';

const k = generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:ops@your-agency.example');
