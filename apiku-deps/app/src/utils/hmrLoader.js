import chokidar from "chokidar";
import path from "path";
import { EventEmitter } from "events";
import { pathToFileURL } from "url";
import fs from "fs";
import logger from "./logger.js";

// ========================================================================
// HotModuleReloader — Generic engine for auto-loading & watching modules
// ========================================================================

class HotModuleReloader extends EventEmitter {
  registry = new Map();
  fileMapping = new Map();
  isProd;
  globalLogger = null;
  configs;
  modules;

  constructor(...args) {
    super();
    this.isProd = process.env.NODE_ENV === "production";

    let configs = [];
    let logger = null;

    if (typeof args[args.length - 1] === "function") {
      logger = args.pop();
    }
    configs = args;
    this.globalLogger = logger;
    this.configs = configs;

    this.modules = new Proxy({}, {
      get: (target, key) => this.registry.get(key),
      has: (target, key) => this.registry.has(key),
      ownKeys: () => Array.from(this.registry.keys()),
      getOwnPropertyDescriptor: (target, key) => {
        if (this.registry.has(key)) {
          return { enumerable: true, configurable: true, value: this.registry.get(key) };
        }
      }
    });

    this.load = this._init();
  }

  _defaultLogger(time, type, message) {
    if (this.isProd) return;
    const colors = { info: "\x1B[36m", warn: "\x1B[33m", error: "\x1B[31m", reset: "\x1B[0m" };
    console.log(`[${time}] ${colors[type] || ""}[HMR] ${message}${colors.reset}`);
  }

  async _init() {
    for (const config of this.configs) {
      const { watchDir, ignoreFiles = [], logger } = config;
      if (!watchDir) continue;

      const resolvedDir = path.resolve(watchDir);
      const log = logger || this.globalLogger || this._defaultLogger.bind(this);
      const time = new Date().toLocaleTimeString();

      await this._scanAndLoadSync(resolvedDir, ignoreFiles, log, time, resolvedDir);

      if (!this.isProd) {
        chokidar.watch(resolvedDir, {
          ignored: (file) => ignoreFiles.some(pattern => file.includes(pattern)),
          persistent: true,
          ignoreInitial: true
        }).on("all", async (event, filePath) => {
          const resolvedPath = path.resolve(filePath);
          if (!filePath.endsWith(".js") && !filePath.endsWith(".ts")) return;

          const currentTime = new Date().toLocaleTimeString();

          if (event === "add" || event === "change") {
            await this._loadModule(resolvedPath, log, currentTime, event, resolvedDir);
          } else if (event === "unlink") {
            this._removeModule(resolvedPath, log, currentTime, resolvedDir);
            this.emit("unlink", resolvedPath);
          }
        });
      }
    }

    if (this.isProd) {
      console.log("\x1B[32m[HMR] Production Mode: All modules loaded.\x1B[0m");
    } else {
      const log = this.configs[0]?.logger || this.globalLogger || this._defaultLogger.bind(this);
      const time = new Date().toLocaleTimeString();
      log(time, "info", `Scan complete. Registry: ${this.registry.size} modules loaded.`);
    }
    this.emit("ready");
  }

  async _scanAndLoadSync(dir, ignoreFiles, log, time, watchDir) {
    if (!fs.existsSync(dir)) return;

    const scan = async (currentDir) => {
      const entries = fs.readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          await scan(fullPath);
        } else if (stat.isFile() && (entry.endsWith(".js") || entry.endsWith(".ts"))) {
          if (ignoreFiles.some(pattern => fullPath.includes(pattern))) continue;
          await this._loadModule(path.resolve(fullPath), log, time, "add", watchDir);
        }
      }
    };

    await scan(dir);
  }

  _getModuleKey(filePath, watchDir) {
    if (watchDir) {
      return path.relative(watchDir, filePath)
        .replace(/\\\\/g, "/")
        .replace(/\.(js|ts)$/, "");
    }
    return path.basename(filePath, path.extname(filePath));
  }

  async _loadModule(filePath, log, time, event, watchDir, isRetry = false) {
    try {
      if (this.fileMapping.has(filePath)) {
        this._removeModule(filePath, log, time, true);
      }

      // Beri sedikit jeda agar OS selesai menulis file (mencegah ERR_MODULE_NOT_FOUND saat save cepat)
      if (!this.isProd) {
        await new Promise(r => setTimeout(r, 10));
      }

      const fileUrl = pathToFileURL(filePath).href;
      const cacheBuster = this.isProd ? "" : `?update=${Date.now()}`;
      const mod = await import(`${fileUrl}${cacheBuster}`);

      const moduleKey = this._getModuleKey(filePath, watchDir);
      const exportedNames = new Set();

      for (const [key, value] of Object.entries(mod)) {
        const registryKey = key === "default" ? moduleKey : key;
        this.registry.set(registryKey, value);
        exportedNames.add(registryKey);
      }

      this.fileMapping.set(filePath, exportedNames);
      this.emit(event, filePath, mod);

      if (!this.isProd && event === 'change' && !isRetry) {
        log(time, "info", `Synced (${event}): ${moduleKey}`);
      } else if (!this.isProd && isRetry) {
        log(time, "info", `Recovered & Synced (${event}): ${moduleKey}`);
      }
    } catch (error) {
      if (!isRetry && !this.isProd) {
        // Coba lagi setelah 500ms jika gagal (antisipasi file lock atau belum selesai ditulis sepenuhnya)
        setTimeout(() => {
          this._loadModule(filePath, log, new Date().toLocaleTimeString(), event, watchDir, true);
        }, 500);
      } else {
        log(time, "error", `Failed to load: ${this._getModuleKey(filePath, watchDir)} - ${error.message}`);
      }
    }
  }

  _removeModule(filePath, log, time, silent = false) {
    const names = this.fileMapping.get(filePath);
    if (names) {
      for (const name of names) {
        this.registry.delete(name);
      }
      this.fileMapping.delete(filePath);
      if (!silent && !this.isProd) {
        log(time, "warn", `Removed: ${path.basename(filePath)}`);
      }
    }
  }

  get(keys = []) {
    const result = {};
    for (const key of keys) {
      result[key] = this.registry.get(key);
    }
    return result;
  }
}

// ========================================================================
// setupHmrLoader — Express integration layer
// ========================================================================

export default function setupHmrLoader(app, apiDir, options = {}) {
  const { configFile, reloadConfig: reloadConfigFn } = options;
  return new Promise((resolve) => {
    const apiRoot = path.resolve(apiDir);
    const srcRoot = path.resolve(path.join(process.cwd(), "src"));
    const allEndpoints = [];
    let hmr;

    const configLogger = (time, type, msg) => {
      if (type === "error") logger.error(`[HMR] ${msg}`);
      if (type === "info") logger.info(`[HMR] ${msg}`);
    };

    hmr = new HotModuleReloader(
      {
        watchDir: apiDir,
        ignoreFiles: [],
        logger: configLogger
      },
      {
        // Watch src/ ONLY for middleware, utils, function — NOT app/ or rateLimiter (engine files with side effects)
        watchDir: srcRoot,
        ignoreFiles: ['app/index.js', 'middleware/rateLimiter.js', 'function/chrome', 'routes/setupRoutes.js'],
        logger: configLogger
      }
    );

    function isApiFile(filePath) {
      return filePath.startsWith(apiRoot + path.sep);
    }

    function isSrcFile(filePath) {
      return filePath.startsWith(srcRoot + path.sep);
    }

    function getRelativePath(filePath) {
      return path.relative(apiRoot, filePath)
        .replace(/\\\\/g, "/")
        .replace(/\.(js|ts)$/, "");
    }

    function getModuleKey(filePath) {
      return getRelativePath(filePath);
    }

    function removeRouteLayers(routePath) {
      const stack = app._router?.stack;
      if (!stack) return;
      for (let i = stack.length - 1; i >= 0; i--) {
        const layer = stack[i];
        if (layer.route && layer.route.path === routePath) {
          stack.splice(i, 1);
        }
      }
    }

    function getInsertIndex(stack) {
      let lastRouteIdx = -1;
      for (let i = 0; i < stack.length; i++) {
        if (stack[i].route) lastRouteIdx = i;
      }
      return lastRouteIdx + 1;
    }

    function getEndpointData(relativePath, mod) {
      const baseName = path.basename(relativePath);
      return {
        name: mod.name || baseName,
        description: mod.description || "",
        category: mod.category || "General",
        route: `/api/${relativePath}`,
        methods: mod.methods || ["GET"],
        params: mod.params || [],
        paramsSchema: mod.paramsSchema || {}
      };
    }

    function registerRoute(filePath) {
      const relativePath = getRelativePath(filePath);
      const moduleKey = getModuleKey(filePath);
      
      const routesToRegister = [`/api/${relativePath}`];
      if (relativePath.startsWith('v1/')) {
        routesToRegister.push(`/${relativePath}`);
      }

      const mod = hmr.registry.get(moduleKey);
      if (!mod || !mod.run) return;

      const methods = mod.methods || ["GET"];
      const stack = app._router?.stack;
      if (!stack) return;

      for (const routePath of routesToRegister) {
        removeRouteLayers(routePath);
        const insertAt = getInsertIndex(stack);

        for (const method of methods) {
          const beforeLen = stack.length;
          app[method.toLowerCase()](routePath, (req, res) => {
            const currentMod = hmr.registry.get(moduleKey);
            if (currentMod && currentMod.run) {
              return currentMod.run(req, res);
            }
            res.status(500).json({
              success: false,
              message: `Module '${moduleKey}' not found`
            });
          });
          const newLayers = stack.splice(beforeLen);
          stack.splice(insertAt, 0, ...newLayers);
        }
      }

      const epData = getEndpointData(relativePath, mod);
      const mainRoute = `/api/${relativePath}`;
      const existingIdx = allEndpoints.findIndex(e => e.route === mainRoute);
      if (existingIdx >= 0) {
        allEndpoints[existingIdx] = epData;
      } else {
        allEndpoints.push(epData);
      }
    }

    function unregisterRoute(filePath) {
      const relativePath = getRelativePath(filePath);
      const routesToUnregister = [`/api/${relativePath}`];
      if (relativePath.startsWith('v1/')) {
        routesToUnregister.push(`/${relativePath}`);
      }

      for (const routePath of routesToUnregister) {
        removeRouteLayers(routePath);
      }

      const mainRoute = `/api/${relativePath}`;
      const idx = allEndpoints.findIndex(e => e.route === mainRoute);
      if (idx >= 0) {
        allEndpoints.splice(idx, 1);
        logger.info(`endpoint removed: ${mainRoute}`);
      }
    }

    hmr.on("add", (filePath) => {
      if (isApiFile(filePath)) {
        registerRoute(filePath);
        const mainRoute = `/api/${getRelativePath(filePath)}`;
        logger.info(`endpoint added: ${mainRoute}`);
        if (configFile && reloadConfigFn) {
          try {
            const raw = fs.readFileSync(configFile, "utf8");
            const config = JSON.parse(raw);
            if (!config.endpointsStatus) config.endpointsStatus = {};
            if (!config.endpointsStatus[mainRoute]) {
              config.endpointsStatus[mainRoute] = "online";
              fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
              reloadConfigFn();
            }
          } catch {}
        }
      }
    });

    hmr.on("change", (filePath) => {
      if (isApiFile(filePath)) {
        registerRoute(filePath);
        const mainRoute = `/api/${getRelativePath(filePath)}`;
        logger.info(`endpoint changed: ${mainRoute}`);
      } else if (isSrcFile(filePath)) {
        const relPath = path.relative(srcRoot, filePath);
        logger.info(`[HMR] src changed (registry updated, restart may be needed): ${relPath}`);
      }
    });

    hmr.on("unlink", (filePath) => {
       if (isApiFile(filePath)) {
         const route = `/api/${getRelativePath(filePath)}`;
         unregisterRoute(filePath);
         if (configFile && reloadConfigFn) {
           try {
             const raw = fs.readFileSync(configFile, "utf8");
             const config = JSON.parse(raw);
             let changed = false;
             if (config.endpointsStatus && config.endpointsStatus[route]) {
               delete config.endpointsStatus[route];
               changed = true;
             }
             if (config.endpointsMeta && config.endpointsMeta[route]) {
               delete config.endpointsMeta[route];
               changed = true;
             }
             if (changed) {
               fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
               reloadConfigFn();
               logger.info(`[HMR] Endpoint removed from config: ${route}`);
             }
           } catch (err) {
             logger.error(`[HMR] Failed to update config on endpoint delete: ${err.message}`);
           }
         }
       }
     });

    hmr.on("ready", () => {
      resolve(allEndpoints);
    });
  });
}
