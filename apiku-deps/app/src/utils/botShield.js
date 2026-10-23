/**
 * Bot Shield & Anti-Spam Probe Blocker Middleware
 * Prevents scanner bots from hitting invalid/probe endpoints (.env, phpmyadmin, malformed paths)
 * and keeps api-stats logs 100% clean without affecting existing rate limits.
 */

import logger from "./logger.js";

const SUSPICIOUS_PATTERNS = [
  /\.env($|\/|\?)/i,
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/phpmyadmin/i,
  /\/config\.php/i,
  /^\/tools\/spam-otp/i, // block non-api 404 spam-otp probing
  /['"]$/ // malformed trailing quotes like /api/downloader/allinone'
];

export function botShieldMiddleware() {
  return (req, res, next) => {
    const path = req.path || "";
    
    // Check if path matches known scanner/probe patterns
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(path)) {
        req._skipStats = true; // prevent recording in api-stats.json
        logger.warn(`[BotShield] Blocked suspicious probe: ${req.method} ${path} from ${req.ip || req.socket?.remoteAddress}`);
        return res.status(403).json({
          status: false,
          error: "Access Denied: Malformed request or suspicious probing detected by API Shield."
        });
      }
    }

    next();
  };
}

export default botShieldMiddleware;
