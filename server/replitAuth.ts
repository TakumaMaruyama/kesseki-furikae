import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => {
    cb(null, user);
  });
  
  passport.deserializeUser((user: any, cb) => {
    // Restore user from session
    if (user && user.claims) {
      cb(null, user);
    } else {
      cb(null, false);
    }
  });

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

// Optional authentication - populates user info if available, but doesn't block
export const optionalAuth: RequestHandler = async (req, res, next) => {
  const session = req.session as any;
  const sessionDuration = 24 * 60 * 60 * 1000; // 24 hours

  // Check for local session user first (email/password login)
  const localUserId = session?.localUserId;
  const localLoginTime = session?.localUserLoginTime;
  
  if (localUserId && localLoginTime && (Date.now() - localLoginTime < sessionDuration)) {
    (req as any).localUserId = localUserId;
  }

  // Always proceed to next
  return next();
};

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const session = req.session as any;
  const sessionDuration = 24 * 60 * 60 * 1000; // 24 hours

  // Check for local session user first (email/password login)
  const localUserId = session?.localUserId;
  const localLoginTime = session?.localUserLoginTime;
  
  if (localUserId && localLoginTime && (Date.now() - localLoginTime < sessionDuration)) {
    // Local auth is valid - store userId for route handlers
    (req as any).localUserId = localUserId;
    return next();
  }

  // Fall back to Replit Auth (Google)
  const user = req.user as any;

  // User must exist with claims for Replit Auth
  if (!user || !user.claims) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // If expires_at is not set, provide a safe default (1 week from now)
  if (!user.expires_at) {
    user.expires_at = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    return next();
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < user.expires_at) {
    return next();
  }

  // Token has expired, try to refresh it
  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};
