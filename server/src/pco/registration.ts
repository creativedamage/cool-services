/**
 * Sundays' Planning Center app registration — the ProDeck approach.
 *
 * Register ONE **Public** OAuth application at https://api.planningcenteronline.com/oauth/applications
 * (any Planning Center organization where you're an Organization Administrator works, including
 * one you create just for this). Name it "Sundays", type **Public** (no secret), and add
 * every redirect URI below. Then paste its Client ID into BUILT_IN_CLIENT_ID.
 *
 * The Client ID is not a secret: a public app has none, and PKCE proves each sign-in is genuine.
 * Once it's here, everyone who installs Sundays just clicks "Sign in with Planning Center".
 */
export const BUILT_IN_CLIENT_ID = "e7343566b677dacdb16bddea2d86dbbced0228a82cef10ca135b7c4f78d84f35";

/**
 * Fixed loopback ports the Mac app listens on (127.0.0.1 only). Planning Center only returns to
 * redirect URIs registered on the app, so these can't be random; three in case one is busy.
 * (Never 3000/3001.)
 */
export const DESKTOP_PORTS = [47123, 47124, 47125];

/** Paste all of these into the OAuth application's Redirect URIs. */
export const REDIRECT_URIS = [
  ...DESKTOP_PORTS.map((p) => `http://127.0.0.1:${p}/api/auth/callback`),
  "http://127.0.0.1:5173/api/auth/callback", // optional: only for developing in a browser with `npm run dev`
];
