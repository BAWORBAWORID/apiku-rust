import { getConfig } from '../utils/configCache.js';

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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

export default function setupResponseFormatter(app) {
  app.use((req, res, next) => {
    const originalJson = res.json;

    res.json = function (data) {
      if (req.path.startsWith('/v1/') || req.path.startsWith('/v3/')) {
        return originalJson.call(this, data);
      }
      if (data && typeof data === "object") {
        const statusCode = res.statusCode || 200;
        const responseData = { ...data };

        if (statusCode >= 200 && statusCode < 300) {
          responseData.timestamp = new Date().toISOString();
          const config = getConfig();
          responseData.attribution = config.attribution || "@zyvorapi";
        }

        return originalJson.call(this, responseData);
      }

      return originalJson.call(this, data);
    };

    next();
  });
}
