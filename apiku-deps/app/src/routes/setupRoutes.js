import express from 'express'
import adminAuth from '../middleware/adminAuth.js'
import logger from '../utils/logger.js'
import { getConfig, reloadConfig } from '../utils/configCache.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import rateLimiter from '../middleware/rateLimiter.js'
import { isConnected } from '../utils/apiStatsDb.js'

export default function setupRoutes(app, endpoints, deps) {
  const {
    allEndpoints,
    TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY,
    CONFIG_FILE,
    ADMIN_USERS_FILE,
    loadApiKeys,
    saveApiKeys,
    uploadDir,
    upload
  } = deps

  // Turnstile config endpoint (public, no auth)
  app.get('/admin/api/turnstile-config', (req, res) => {
    res.json({ success: true, siteKey: TURNSTILE_SITE_KEY })
  })

  // Admin Login (no auth required, but requires Turnstile verification)
  app.post('/admin/api/login', express.json(), async (req, res) => {
    try {
      const { username, password, turnstile_token } = req.body
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' })
      }

      if (!turnstile_token) {
        return res.status(400).json({ success: false, error: 'Security verification (Captcha) required' })
      }

      try {
        const verifyResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: TURNSTILE_SECRET_KEY,
            response: turnstile_token,
            remoteip: req.ip
          })
        })
        const verifyData = await verifyResp.json()
        if (!verifyData.success) {
          logger.warn(`[TURNSTILE] Verification failed | ip=${req.ip} | errors=${JSON.stringify(verifyData['error-codes'])}`)
          return res.status(403).json({ success: false, error: 'Security verification failed. Please try again.' })
        }
      } catch (verifyErr) {
        logger.error(`[TURNSTILE] Verification error: ${verifyErr.message}`)
        return res.status(500).json({ success: false, error: 'Security verification error. Please try again.' })
      }

      const usersData = JSON.parse(fs.readFileSync(ADMIN_USERS_FILE, 'utf8'))
      const user = usersData.users.find(u => u.username === username)
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' })
      }
      const valid = await bcrypt.compare(password, user.password)
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' })
      }
      req.session.adminLoggedIn = true
      req.session.adminUser = username
      req.session.adminRole = user.role
      res.json({ success: true, message: 'Login successful', user: { username, role: user.role } })
    } catch (err) {
      res.status(500).json({ success: false, error: 'Login failed: ' + err.message })
    }
  })

  // Admin - Check current session (returns user info if logged in)
  app.get('/admin/api/me', (req, res) => {
    if (req.session && req.session.adminLoggedIn === true) {
      return res.json({
        success: true,
        user: {
          username: req.session.adminUser,
          role: req.session.adminRole
        }
      })
    }
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    })
  })

  // Admin Logout
  app.post('/admin/api/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Logout failed' })
      }
      res.clearCookie("apiku.sid")
      res.json({ success: true, message: 'Logged out' })
    })
  })

  // Admin - Get endpoints (protected)
  app.get('/admin/api/endpoints', adminAuth, (req, res) => {
    try {
      const config = getConfig()
      const endpointsWithStatus = allEndpoints.map(ep => ({
        ...ep,
        status: (config.endpointsStatus && config.endpointsStatus[ep.route]) || 'online'
      }))
      res.json({ success: true, endpoints: endpointsWithStatus, total: endpointsWithStatus.length })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Update endpoint status (protected)
  app.put('/admin/api/endpoints/status', adminAuth, express.json(), (req, res) => {
    try {
      if (req.session.adminRole !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only superadmin can change endpoint status' })
      }
      const { route, status } = req.body
      if (!route || !status) return res.status(400).json({ success: false, error: 'route and status required' })
      const validStatuses = ['online', 'offline', 'maintenance', 'premium', 'vip']
      if (!validStatuses.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status. Must be: ' + validStatuses.join(', ') })

      const config = { ...getConfig() }
      if (!config.endpointsStatus) config.endpointsStatus = {}

      config.endpointsStatus[route] = status

      fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 4), () => {
        reloadConfig()
      })
      res.json({ success: true, message: `Endpoint ${route} set to ${status}` })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Get API keys (protected)
  app.get('/admin/api/keys', adminAuth, (req, res) => {
    try {
      const keysData = loadApiKeys()
      const maskedKeys = keysData.keys.map(k => ({
        ...k,
        key: k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4),
        _key: k.key
      }))
      res.json({ success: true, keys: maskedKeys, total: keysData.keys.length })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Generate new API key (with package presets)
  app.post('/admin/api/keys', adminAuth, express.json(), (req, res) => {
    try {
      const { name, customKey, package: pkg, rateLimit, allowedEndpoints, allowedStatuses } = req.body
      if (!name) return res.status(400).json({ success: false, error: 'Key name required' })

      const keysData = loadApiKeys()
      let newKey
      if (customKey && typeof customKey === 'string' && customKey.trim().length >= 3) {
        const trimmed = customKey.trim()
        if (keysData.keys.some(k => k.key === trimmed)) {
          return res.status(400).json({ success: false, error: 'Custom key already exists' })
        }
        newKey = trimmed
      } else {
        newKey = 'ac_live_' + crypto.randomBytes(24).toString('hex')
      }

      let expiresDate = null
      let pkgType = 'premium'
      let pkgRateLimit = null

      if (pkg && typeof pkg === 'object' && pkg.type) {
        pkgType = pkg.type
        if (pkg.expired && typeof pkg.expired === 'string') {
          expiresDate = pkg.expired
        }
        const defaultLimits = {
          user: { maxPerDay: 100, maxPerMinute: 20 },
          premium: { maxPerDay: 500, maxPerMinute: 75 },
          vip: { maxPerDay: 0, maxPerMinute: 100 }
        }
        pkgRateLimit = defaultLimits[pkgType] || defaultLimits.premium
      } else if (pkg && typeof pkg === 'string') {
        const days = { '3': 3, '7': 7, '14': 14, '30': 30 }[pkg]
        if (days) {
          expiresDate = new Date(Date.now() + days * 86400000).toISOString()
        }
        pkgType = 'premium'
        pkgRateLimit = { maxPerDay: 500, maxPerMinute: 75 }
      }

      const defaults = {
        rateLimit: rateLimit || pkgRateLimit || {
          maxPerDay: 1500,
          maxPerMinute: 100
        }
      }

      const keyEntry = {
        key: newKey,
        name: name,
        createdAt: new Date().toISOString(),
        lastUsed: null,
        usageCount: 0,
        enabled: true,
        role: pkgType,
        allowedEndpoints: Array.isArray(allowedEndpoints) && allowedEndpoints.length ? allowedEndpoints : null,
        allowedStatuses: Array.isArray(allowedStatuses) && allowedStatuses.length ? allowedStatuses : null,
        rateLimit: defaults.rateLimit,
        dailyUsage: { date: '', count: 0 },
        minuteUsage: { timestamp: 0, count: 0 },
        expiresAt: expiresDate,
        package: pkg ? { type: pkgType, expired: expiresDate } : null
      }

      keysData.keys.push(keyEntry)
      saveApiKeys(keysData)
      res.json({ success: true, key: keyEntry, message: customKey ? 'Custom API key created' : 'API key generated' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Update API key (protected, with expiration renewal)
  app.put('/admin/api/keys/:key', adminAuth, express.json(), (req, res) => {
    try {
      const { key } = req.params
      const { name, enabled, rateLimit, expiresAt, package: pkg, allowedEndpoints, allowedStatuses } = req.body
      const keysData = loadApiKeys()
      const keyEntry = keysData.keys.find(k => k.key === key)
      if (!keyEntry) return res.status(404).json({ success: false, error: 'Key not found' })

      if (name !== undefined) keyEntry.name = name
      if (enabled !== undefined) keyEntry.enabled = enabled
      if (rateLimit !== undefined) {
        keyEntry.rateLimit = {
          ...keyEntry.rateLimit,
          ...rateLimit
        }
      }

      if (allowedEndpoints !== undefined) {
        keyEntry.allowedEndpoints = Array.isArray(allowedEndpoints) && allowedEndpoints.length ? allowedEndpoints : null
      }
      if (allowedStatuses !== undefined) {
        keyEntry.allowedStatuses = Array.isArray(allowedStatuses) && allowedStatuses.length ? allowedStatuses : null
      }

      if (expiresAt !== undefined) {
        keyEntry.expiresAt = expiresAt || null
      }

      if (pkg && typeof pkg === 'object' && pkg.type) {
        keyEntry.role = pkg.type
        keyEntry.package = { type: pkg.type, expired: pkg.expired || null }
        if (pkg.expired && typeof pkg.expired === 'string') {
          keyEntry.expiresAt = pkg.expired
        }
        if (keyEntry.enabled === false && keyEntry.expiresAt && new Date(keyEntry.expiresAt) > new Date()) {
          keyEntry.enabled = true
        }
      } else if (pkg && typeof pkg === 'string') {
        const days = { '3': 3, '7': 7, '14': 14, '30': 30 }[pkg]
        if (days) {
          keyEntry.expiresAt = new Date(Date.now() + days * 86400000).toISOString()
          keyEntry.package = pkg
          keyEntry.role = 'premium'
        }
        if (keyEntry.enabled === false && keyEntry.expiresAt && new Date(keyEntry.expiresAt) > new Date()) {
          keyEntry.enabled = true
        }
      }

      saveApiKeys(keysData)
      res.json({ success: true, message: 'Key updated' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Delete API key (protected)
  app.delete('/admin/api/keys/:key', adminAuth, (req, res) => {
    try {
      const { key } = req.params
      const keysData = loadApiKeys()
      const idx = keysData.keys.findIndex(k => k.key === key)
      if (idx === -1) return res.status(404).json({ success: false, error: 'Key not found' })

      keysData.keys.splice(idx, 1)
      saveApiKeys(keysData)
      res.json({ success: true, message: 'Key deleted' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Get settings (protected)
  app.get('/admin/api/settings', adminAuth, (req, res) => {
    try {
      const config = getConfig()
      const dbConnected = isConnected()
      const totalEndpoints = allEndpoints.length
      res.json({
        success: true,
        config,
        totalEndpoints,
        dbStatus: {
          connected: dbConnected,
          type: 'JSON',
          file: 'api-stats.json',
          message: dbConnected ? 'Stats database terhubung' : 'Stats database tidak tersedia'
        }
      })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Update settings (protected)
  app.put('/admin/api/settings', adminAuth, express.json(), (req, res) => {
    try {
      const { config } = req.body
      if (!config) return res.status(400).json({ success: false, error: 'Config object required' })

      const existing = { ...getConfig() }
      const merged = { ...existing, ...config }
      fs.writeFile(CONFIG_FILE, JSON.stringify(merged, null, 4), () => {
        reloadConfig()
      })
      res.json({ success: true, message: 'Settings saved' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ==================== ADMIN USER MANAGEMENT API ====================

  // Admin - Get all users (protected)
  app.get('/admin/api/users', adminAuth, (req, res) => {
    try {
      const usersData = JSON.parse(fs.readFileSync(ADMIN_USERS_FILE, 'utf8'))
      const safeUsers = usersData.users.map(u => ({
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      }))
      res.json({ success: true, users: safeUsers, total: safeUsers.length })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Create new user (protected)
  app.post('/admin/api/users', adminAuth, express.json(), async (req, res) => {
    try {
      const { username, password, role } = req.body
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' })
      }
      if (username.length < 3) {
        return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' })
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' })
      }

      const requestedRole = role || 'admin'
      if (requestedRole === 'superadmin' && req.session.adminRole !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only superadmin can create superadmin users' })
      }

      const usersData = JSON.parse(fs.readFileSync(ADMIN_USERS_FILE, 'utf8'))

      if (usersData.users.find(u => u.username === username)) {
        return res.status(409).json({ success: false, error: 'Username already exists' })
      }

      const hashedPassword = await bcrypt.hash(password, 10)
      const newUser = {
        username,
        password: hashedPassword,
        role: requestedRole,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      usersData.users.push(newUser)
      fs.writeFileSync(ADMIN_USERS_FILE, JSON.stringify(usersData, null, 2))

      res.json({
        success: true,
        message: 'User created successfully',
        user: { username, role: newUser.role, createdAt: newUser.createdAt }
      })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Update user (protected)
  app.put('/admin/api/users/:username', adminAuth, express.json(), async (req, res) => {
    try {
      const { username } = req.params
      const { password, role } = req.body

      const usersData = JSON.parse(fs.readFileSync(ADMIN_USERS_FILE, 'utf8'))
      const user = usersData.users.find(u => u.username === username)

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      if (user.role === 'superadmin' && req.session.adminRole !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only superadmin can edit superadmin users' })
      }

      if (password) {
        if (password.length < 6) {
          return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' })
        }
        user.password = await bcrypt.hash(password, 10)
      }
      if (role) {
        if (role === 'superadmin' && req.session.adminRole !== 'superadmin') {
          return res.status(403).json({ success: false, error: 'Only superadmin can assign superadmin role' })
        }
        if (req.session.adminUser === username) {
          return res.status(400).json({ success: false, error: 'Tidak bisa mengubah role sendiri' })
        }
        user.role = role
      }
      user.updatedAt = new Date().toISOString()

      fs.writeFileSync(ADMIN_USERS_FILE, JSON.stringify(usersData, null, 2))
      res.json({ success: true, message: 'User updated successfully' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Delete user (protected)
  app.delete('/admin/api/users/:username', adminAuth, (req, res) => {
    try {
      const { username } = req.params

      if (req.session.adminUser === username) {
        return res.status(400).json({ success: false, error: 'Cannot delete your own account' })
      }

      const usersData = JSON.parse(fs.readFileSync(ADMIN_USERS_FILE, 'utf8'))
      const idx = usersData.users.findIndex(u => u.username === username)

      if (idx === -1) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      if (usersData.users[idx].role === 'superadmin' && req.session.adminRole !== 'superadmin') {
        return res.status(403).json({ success: false, error: 'Only superadmin can delete superadmin users' })
      }

      if (usersData.users[idx].role === 'superadmin') {
        const superadminCount = usersData.users.filter(u => u.role === 'superadmin').length
        if (superadminCount <= 1) {
          return res.status(400).json({ success: false, error: 'Cannot delete the last superadmin account' })
        }
      }

      usersData.users.splice(idx, 1)
      fs.writeFileSync(ADMIN_USERS_FILE, JSON.stringify(usersData, null, 2))
      res.json({ success: true, message: 'User deleted successfully' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ==================== ENDPOINT METADATA MANAGEMENT ====================

  // Admin - Update endpoint metadata (name, description, category, params)
  app.put('/admin/api/endpoints/:route(*)', adminAuth, express.json(), (req, res) => {
    try {
      const route = '/' + req.params.route
      const { name, description, category, params } = req.body

      const config = { ...getConfig() }
      if (!config.endpointsMeta) config.endpointsMeta = {}
      if (!config.endpointsMeta[route]) config.endpointsMeta[route] = {}

      if (name !== undefined) config.endpointsMeta[route].name = name
      if (description !== undefined) config.endpointsMeta[route].description = description
      if (category !== undefined) config.endpointsMeta[route].category = category
      if (params !== undefined) config.endpointsMeta[route].params = params

      fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 4), () => {
        reloadConfig()
      })
      res.json({ success: true, message: 'Endpoint metadata updated' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Delete endpoint from configuration
  app.delete('/admin/api/endpoints/:route(*)', adminAuth, (req, res) => {
    try {
      const route = '/' + req.params.route
      const config = { ...getConfig() }

      if (config.endpointsStatus && config.endpointsStatus[route]) {
        delete config.endpointsStatus[route]
      }
      if (config.endpointsMeta && config.endpointsMeta[route]) {
        delete config.endpointsMeta[route]
      }

      fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 4), () => {
        reloadConfig()
      })
      res.json({ success: true, message: `Endpoint ${route} removed from tracking` })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ==================== IP MANAGEMENT ====================

  // Admin - Get banned & whitelist IPs
  app.get('/admin/api/ips', adminAuth, (req, res) => {
    try {
      const bannedPath = path.join(process.cwd(), 'data', 'banned-ips.json')
      const whitelistPath = path.join(process.cwd(), 'data', 'whitelist-ips.json')

      let banned = []
      if (fs.existsSync(bannedPath)) {
        const raw = JSON.parse(fs.readFileSync(bannedPath, 'utf8'))
        banned = Array.isArray(raw) ? raw : raw.ips ? Object.keys(raw.ips) : []
      }

      let whitelistIPs = []
      if (fs.existsSync(whitelistPath)) {
        const raw = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'))
        whitelistIPs = raw.ips ? Object.keys(raw.ips) : Array.isArray(raw) ? raw : []
      }

      res.json({
        success: true,
        banned: { count: banned.length, ips: banned },
        whitelist: { count: whitelistIPs.length, ips: whitelistIPs }
      })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Unban IP
  app.post('/admin/api/ips/unban', adminAuth, express.json(), (req, res) => {
    try {
      const { ip } = req.body
      if (!ip) return res.status(400).json({ success: false, error: 'IP address required' })

      const bannedPath = path.join(process.cwd(), 'data', 'banned-ips.json')
      if (!fs.existsSync(bannedPath)) {
        return res.json({ success: true, message: 'No banned IPs file found' })
      }

      const raw = JSON.parse(fs.readFileSync(bannedPath, 'utf8'))

      if (Array.isArray(raw)) {
        const filtered = raw.filter(b => b !== ip)
        if (filtered.length === raw.length) {
          return res.json({ success: true, message: 'IP not found in ban list' })
        }
        fs.writeFileSync(bannedPath, JSON.stringify(filtered, null, 2))
      } else if (raw.ips) {
        if (!raw.ips[ip]) {
          return res.json({ success: true, message: 'IP not found in ban list' })
        }
        delete raw.ips[ip]
        fs.writeFileSync(bannedPath, JSON.stringify(raw, null, 2))
      } else {
        return res.status(500).json({ success: false, error: 'Unknown banned IPs format' })
      }

      res.json({ success: true, message: `IP ${ip} unbanned successfully` })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Manually ban IP
  app.post('/admin/api/ips/ban', adminAuth, express.json(), (req, res) => {
    try {
      const { ip, reason } = req.body
      if (!ip) return res.status(400).json({ success: false, error: 'IP address required' })

      const bannedPath = path.join(process.cwd(), 'data', 'banned-ips.json')
      let raw = { ips: {} }
      if (fs.existsSync(bannedPath)) {
        raw = JSON.parse(fs.readFileSync(bannedPath, 'utf8'))
        if (Array.isArray(raw)) {
          const obj = { ips: {} }
          raw.forEach(ipAddr => { obj.ips[ipAddr] = { bannedAt: new Date().toISOString(), reason: 'Migrated' } })
          raw = obj
        }
      }
      if (!raw.ips) raw.ips = {}

      raw.ips[ip] = {
        bannedAt: new Date().toISOString(),
        reason: reason || 'Manually banned via dashboard',
        until: null,
      }
      fs.writeFileSync(bannedPath, JSON.stringify(raw, null, 2))
      res.json({ success: true, message: `IP ${ip} banned successfully` })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Add to whitelist
  app.post('/admin/api/ips/whitelist', adminAuth, express.json(), (req, res) => {
    try {
      const { ip } = req.body
      if (!ip) return res.status(400).json({ success: false, error: 'IP address required' })

      const whitelistPath = path.join(process.cwd(), 'data', 'whitelist-ips.json')

      let whitelistData = { ips: {} }
      if (fs.existsSync(whitelistPath)) {
        const raw = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'))
        if (raw.ips) {
          whitelistData = raw
        } else if (Array.isArray(raw)) {
          raw.forEach(ipAddr => {
            whitelistData.ips[ipAddr] = { addedAt: new Date().toISOString(), reason: 'Migrated' }
          })
        }
      }

      if (whitelistData.ips[ip]) {
        return res.json({ success: true, message: 'IP already in whitelist' })
      }

      whitelistData.ips[ip] = {
        addedAt: new Date().toISOString(),
        reason: 'Added via dashboard'
      }
      fs.writeFileSync(whitelistPath, JSON.stringify(whitelistData, null, 2))
      res.json({ success: true, message: `IP ${ip} added to whitelist` })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ==================== NOTIFICATION FEED API ====================

  app.get('/admin/api/notifications/feed', adminAuth, (req, res) => {
    try {
      const feedPath = path.join(process.cwd(), 'data', 'notifications-feed.json')
      if (!fs.existsSync(feedPath)) {
        return res.json({ success: true, notifications: [], total: 0 })
      }
      const stats = fs.statSync(feedPath)
      if (stats.size > 2 * 1024 * 1024) {
        fs.writeFileSync(feedPath, '[]')
        return res.json({ success: true, notifications: [], total: 0, reset: true })
      }
      const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'))
      const limit = Math.min(parseInt(req.query.limit) || 100, 200)
      res.json({ success: true, notifications: feed.slice(0, limit), total: feed.length })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Clear notification feed
  app.delete('/admin/api/notifications/feed', adminAuth, (req, res) => {
    try {
      const feedPath = path.join(process.cwd(), 'data', 'notifications-feed.json')
      fs.writeFileSync(feedPath, JSON.stringify([], null, 2))
      res.json({ success: true, message: 'Notification feed cleared' })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Get rate limiter live stats
  app.get('/admin/api/requests/stats', adminAuth, async (req, res) => {
    try {
      const requestsPath = path.join(process.cwd(), 'data', 'requests-data.json')
      if (!fs.existsSync(requestsPath)) {
        return res.json({ success: true, totalIPs: 0, totalRequests: 0, totalViolations: 0, ips: [] })
      }
      const requestsData = JSON.parse(fs.readFileSync(requestsPath, 'utf8'))

      let totalRequests = 0
      let totalViolations = 0
      const ips = Object.entries(requestsData).map(([ip, data]) => {
        totalRequests += data.totalRequests || 0
        totalViolations += data.violations || 0
        return {
          ip,
          count: data.count || 0,
          totalRequests: data.totalRequests || 0,
          violations: data.violations || 0,
          lastPath: data.lastPath || '-',
          lastRequest: data.lastRequest || null
        }
      }).sort((a, b) => b.totalRequests - a.totalRequests).slice(0, 20)

      res.json({
        success: true,
        totalIPs: Object.keys(requestsData).length,
        totalRequests,
        totalViolations,
        ips
      })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // Admin - Remove from whitelist
  app.delete('/admin/api/ips/whitelist/:ip', adminAuth, (req, res) => {
    try {
      const ip = req.params.ip
      const whitelistPath = path.join(process.cwd(), 'data', 'whitelist-ips.json')

      if (!fs.existsSync(whitelistPath)) {
        return res.json({ success: true, message: 'No whitelist file found' })
      }

      const raw = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'))

      if (!raw.ips || !raw.ips[ip]) {
        return res.json({ success: true, message: 'IP not found in whitelist' })
      }

      delete raw.ips[ip]
      fs.writeFileSync(whitelistPath, JSON.stringify(raw, null, 2))
      res.json({ success: true, message: `IP ${ip} removed from whitelist` })
    } catch (err) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  app.post("/admin/unban", express.json(), rateLimiter.adminUnbanHandler)

  app.get("/files/:filename", async (req, res) => {
    let basename = path.basename(req.params.filename)
    const baseWithoutExt = path.parse(basename).name
    let filePath = path.resolve(path.join(uploadDir, basename))
    if (!filePath.startsWith(uploadDir) || !fs.existsSync(filePath)) {
      const found = fs.readdirSync(uploadDir).find(f => f.startsWith(baseWithoutExt))
      if (found) {
        basename = found
        filePath = path.resolve(path.join(uploadDir, basename))
      }
    }
    if (filePath.startsWith(uploadDir) && fs.existsSync(filePath)) {
      const ext = path.extname(basename).toLowerCase()
      const mimeMap = {
        ".txt": "text/plain", ".json": "application/json", ".html": "text/html",
        ".css": "text/css", ".js": "application/javascript", ".xml": "application/xml",
        ".csv": "text/csv", ".log": "text/plain", ".md": "text/markdown",
        ".yml": "text/plain", ".yaml": "text/plain", ".svg": "image/svg+xml",
        ".bin": "text/plain"
      }
      if (mimeMap[ext]) res.setHeader("Content-Type", mimeMap[ext])
      res.setHeader("Content-Disposition", "inline")
      return res.sendFile(filePath)
    }

    try {
      const { getFileById } = await import("../../api/tools/upload-v3.js")
      const entry = getFileById(basename)
      if (!entry) {
        return res.status(404).json({ message: "File not found or expired" })
      }

      for (const cdn of entry.urls) {
        try {
          const response = await fetch(cdn.url, { signal: AbortSignal.timeout(10000) })
          if (response.ok) {
            const ext = path.extname(basename).toLowerCase()
            const mimeMap = {
              ".txt": "text/plain", ".json": "application/json", ".html": "text/html",
              ".css": "text/css", ".js": "application/javascript", ".xml": "application/xml",
              ".csv": "text/csv", ".log": "text/plain", ".md": "text/markdown",
              ".yml": "text/plain", ".yaml": "text/plain", ".svg": "image/svg+xml",
              ".bin": "text/plain"
            }
            if (mimeMap[ext]) res.setHeader("Content-Type", mimeMap[ext])
            res.setHeader("Content-Disposition", "inline")
            res.setHeader("Cache-Control", "public, max-age=3600")
            res.setHeader("X-Served-By", cdn.cdn || "unknown")
            const buffer = Buffer.from(await response.arrayBuffer())
            return res.send(buffer)
          }
        } catch (e) {
          logger.warn(`[UPLOADV3-SERVE] CDN ${cdn.cdn} failed for ${basename}: ${e.message}`)
        }
      }

      return res.status(502).json({ message: "All CDNs unreachable" })
    } catch (e) {
      return res.status(500).json({ message: e.message })
    }
  })

  // Upload V3 — serve file by ID with CDN fallback
  app.get("/api/tools/upload-v3/:id", async (req, res) => {
    try {
      const { getFileById } = await import("../../api/tools/upload-v3.js")
      const entry = getFileById(req.params.id)
      if (!entry) {
        return res.status(404).json({ status: false, message: "File not found or expired" })
      }

      for (const cdn of entry.urls) {
        try {
          const response = await fetch(cdn.url, { signal: AbortSignal.timeout(10000) })
          if (response.ok) {
            const contentType = response.headers.get("content-type")
            if (contentType) res.setHeader("Content-Type", contentType)
            res.setHeader("Cache-Control", "public, max-age=3600")
            res.setHeader("X-Served-By", cdn.cdn || "unknown")
            const buffer = Buffer.from(await response.arrayBuffer())
            return res.send(buffer)
          }
        } catch (e) {
          logger.warn(`[UPLOADV3-SERVE] CDN ${cdn.cdn} failed for ${req.params.id}: ${e.message}`)
        }
      }

      return res.status(502).json({ status: false, message: "All CDNs unreachable" })
    } catch (e) {
      return res.status(500).json({ status: false, message: e.message })
    }
  })

  // TEST HMR — hapus nanti
  app.get('/admin/api/_hmr', (req, res) => res.json({ status: 'HMR_WORKS', version: 'v2' }))

  app.use((req, res, next) => {
    if (req.accepts('html')) {
      res.status(404).sendFile(path.join(process.cwd(), 'public', '404.html'))
    } else {
      res.status(404).json({ success: false, error: 'Not Found' })
    }
  })

  app.use((err, req, res, next) => {
    logger.warn(`Error: ${err.message}`)
    if (req.accepts('html')) {
      res.status(500).sendFile(path.join(process.cwd(), 'public', '500.html'))
    } else {
      res.status(500).json({ success: false, error: 'Internal Server Error' })
    }
  })
}
