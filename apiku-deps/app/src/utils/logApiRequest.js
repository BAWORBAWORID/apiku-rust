/**
 * @license
 * Copyright (C) 2026 BAWORBAWORID
 * https://github.com/BAWORBAWORID
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Expand compressed IPv6 address (handle :: compression)
 * e.g., 2a06:98c0:3600::103 -> 2a06:98c0:3600:0000:0000:0000:0000:0103
 */
function expandIPv6(ip) {
  if (!ip.includes('::')) return ip;
  const [left, right] = ip.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const missing = 8 - leftParts.length - rightParts.length;
  const zeros = Array(missing).fill('0000');
  return [...leftParts, ...zeros, ...rightParts].map(p => p.padStart(4, '0')).join(':');
}

import logger from "./logger.js";

/**
 * Logs API request method, path, status code, and response time.
 * Uses res.on('finish') instead of overriding res.send/json/end
 * to avoid cascading method overrides with other middleware.
 */
const logApiRequest = (req, res, next) => {
  if (req.path === '/' || req.path === '/__health' || req.path === '/status' || req.path === '/configuration' || req.path === '/system-stats' || req.path === '/visitors') return next();

  const startTime = Date.now();

  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const forwarded = req.headers['x-forwarded-for'];
    let ip = forwarded ? forwarded.split(',')[0].trim() : (req.ip || req.socket?.remoteAddress || 'unknown');
    // Convert IPv6 to readable format, prefer IPv4
    if (ip.includes(':')) {
      // Try to extract IPv4 from IPv6 mapped address (::ffff:1.2.3.4)
      const ipv4Match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
      if (ipv4Match) {
        ip = ipv4Match[1];
      } else {
        // Pure IPv6 - expand and show first 4 groups
        const expanded = expandIPv6(ip);
        const parts = expanded.split(':');
        if (parts.length >= 4) {
          ip = parts.slice(0, 4).join(':') + '::';
        } else {
          ip = 'IPv6';
        }
      }
    }
    logger.info(`${req.method} ${req.path} [${res.statusCode}] (${responseTime}ms) ${ip}`);
  });

  next();
};

export default logApiRequest;