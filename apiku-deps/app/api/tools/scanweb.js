/**
 * Website Vulnerability Check API
 *
 * GET /tools/vuln-check?domain=zyvor.my.id&type=basic
 *
 * result:
 * - JSON response dengan hasil pemeriksaan keamanan
 */

import axios from "axios"
import dns from "dns/promises"
import logger from "../../src/utils/logger.js"
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

export default {
  name: "Website Vulnerability Check",
  description: "Check website security vulnerabilities for a domain",
  category: "Tools",
  methods: ["GET"],
  params: ["domain"],

  paramsSchema: {
    domain: {
      type: "string",
      required: true,
      pattern: "^(?!-)[A-Za-z0-9-]+([\\-\\.]{1}[a-z0-9]+)*\\.[A-Za-z]{2,}$"
    },
    scan_type: {
      type: "string",
      enum: ["basic", "full", "ssl", "headers", "cms", "ports"],
      default: "basic"
    },
    timeout: {
      type: "number",
      min: 1000,
      max: 30000,
      default: 10000
    }
  },

  async run(req, res) {
    try {
      const { 
        domain, 
        scan_type = "basic", 
        timeout = 10000 
      } = req.query || {}
      
      const scanTypes = scan_type.split(',')

      if (!domain) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'domain' wajib diisi",
          example: "/tools/vuln-check?domain=example.com",
          example2: "/tools/vuln-check?domain=api.zyvor.my.id"
        })
      }

      // Validasi format domain dengan regex yang lebih fleksibel
      const domainRegex = /^(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.)+[A-Za-z]{2,}$/
      const simpleDomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/
      
      // Cek beberapa format domain
      let isValidDomain = false
      
      // Cek format standar
      if (domainRegex.test(domain)) {
        isValidDomain = true
      }
      // Cek format dengan subdomain yang lebih kompleks
      else if (simpleDomainRegex.test(domain)) {
        isValidDomain = true
      }
      // Cek apakah mengandung path atau protokol
      else if (domain.includes('/') || domain.includes('http')) {
        return res.status(400).json({
          status: false,
          message: "Hanya masukkan domain tanpa protokol atau path",
          example: "zyvor.my.id",
          example2: "api.zyvor.my.id",
          received: domain
        })
      }

      if (!isValidDomain) {
        // Coba bersihkan domain dari whitespace
        const cleanedDomain = domain.trim().toLowerCase()
        
        // Validasi akhir dengan regex yang lebih sederhana
        const finalCheck = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(cleanedDomain)
        
        if (!finalCheck) {
          return res.status(400).json({
            status: false,
            message: "Format domain tidak valid",
            valid_examples: [
              "example.com",
              "api.example.com",
              "sub.domain.co.id",
              "zyvor.my.id"
            ],
            validation_tips: [
              "Hanya huruf, angka, dan tanda hubung (-)",
              "Tidak boleh diawali atau diakhiri dengan tanda hubung",
              "Minimal 2 bagian dipisahkan titik",
              "TLD minimal 2 karakter"
            ]
          })
        }
        
        // Gunakan domain yang sudah dibersihkan
        domain = cleanedDomain
      }

      logger.info(
        `[VULN-CHECK] Scanning started | domain=${domain} | type=${scan_type} | ip=${req.ip}`
      )

      // Normalize domain - hajut www jika ada
      const normalizedDomain = this.normalizeDomain(domain)
      
      // Hasil pemeriksaan
      const results = {
        domain: normalizedDomain,
        original_domain: domain,
        scan_timestamp: new Date().toISOString(),
        scan_type: scanTypes,
        timeout: parseInt(timeout),
        checks: {}
      }

      // 1. CHECK DNS DAN AVAILABILITY
      try {
        results.checks.dns = await this.checkDNS(normalizedDomain)
      } catch (dnsError) {
        results.checks.dns = {
          error: dnsError.message,
          status: "failed",
          suggestion: "Periksa apakah domain sudah terdaftar dan DNS-nya aktif"
        }
      }

      // 2. CHECK SSL/TLS
      if (this.shouldCheck('ssl', scanTypes)) {
        try {
          results.checks.ssl = await this.checkSSL(normalizedDomain, timeout)
        } catch (sslError) {
          results.checks.ssl = {
            error: sslError.message,
            status: "failed"
          }
        }
      }

      // 3. CHECK SECURITY HEADERS
      if (this.shouldCheck('headers', scanTypes)) {
        try {
          results.checks.headers = await this.checkSecurityHeaders(normalizedDomain, timeout)
        } catch (headerError) {
          results.checks.headers = {
            error: headerError.message,
            status: "failed"
          }
        }
      }

      // 4. CHECK CMS DETECTION
      if (this.shouldCheck('cms', scanTypes)) {
        try {
          results.checks.cms = await this.checkCMS(normalizedDomain, timeout)
        } catch (cmsError) {
          results.checks.cms = {
            error: cmsError.message,
            status: "failed"
          }
        }
      }

      // 5. CHECK OPEN PORTS (jika diminta)
      if (this.shouldCheck('ports', scanTypes)) {
        try {
          results.checks.ports = await this.checkCommonPorts(normalizedDomain)
        } catch (portError) {
          results.checks.ports = {
            error: portError.message,
            status: "failed",
            note: "Port scanning memerlukan izin khusus dan mungkin diblokir"
          }
        }
      }

      // 6. GENERATE SCORE DAN REKOMENDASI
      results.score = this.calculateSecurityScore(results.checks)
      results.recommendations = this.generateRecommendations(results.checks)
      results.overall_status = this.getOverallStatus(results.score)

      logger.info(
        `[VULN-CHECK] Scan completed | domain=${normalizedDomain} | score=${results.score}`
      )

      return res.json({
        status: true,
        message: "Vulnerability scan completed successfully",
        scan_id: `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        data: results
      })

    } catch (err) {
      logger.error(
        `[VULN-CHECK] Error | domain=${req.query?.domain || 'unknown'} | error=${err.message}`
      )
      
      // Berikan error message yang lebih informatif
      let errorMessage = err.message || "Failed to perform vulnerability check"
      let statusCode = 500
      
      if (err.code === 'ENOTFOUND') {
        errorMessage = `Domain tidak ditemukan: ${req.query.domain}`
        statusCode = 400
      } else if (err.code === 'ECONNREFUSED') {
        errorMessage = `Tidak dapat terhubung ke domain: ${req.query.domain}`
        statusCode = 400
      } else if (err.code === 'ETIMEDOUT') {
        errorMessage = `Timeout saat menghubungi domain: ${req.query.domain}`
        statusCode = 408
      }
      
      return res.status(statusCode).json({
        status: false,
        message: errorMessage,
        suggestion: [
          "Pastikan domain sudah aktif dan dapat diakses",
          "Coba tanpa 'www.' jika menggunakan subdomain",
          "Periksa koneksi internet Anda",
          "Jika domain Anda sendiri, pastikan server sedang berjalan"
        ],
        debug: process.env.NODE_ENV === 'development' ? {
          error: err.message,
          code: err.code,
          stack: err.stack
        } : undefined
      })
    }
  },

  // HELPER METHODS

  normalizeDomain(domain) {
    // Hapus protokol jika ada
    domain = domain.replace(/^(https?:\/\/)/, '')
    // Hapus www. di awal
    domain = domain.replace(/^www\./, '')
    // Hapus trailing slash
    domain = domain.replace(/\/$/, '')
    // Convert ke lowercase
    domain = domain.toLowerCase()
    // Hapus spasi
    domain = domain.trim()
    
    return domain
  },

  shouldCheck(checkType, scanTypes) {
    if (scanTypes.includes('full')) return true
    if (scanTypes.includes('basic') && ['ssl', 'headers'].includes(checkType)) return true
    return scanTypes.includes(checkType)
  },

  async checkDNS(domain) {
    try {
      const startTime = Date.now()
      
      // Cek A record (IPv4)
      const addresses = await dns.resolve4(domain).catch(() => [])
      
      // Cek AAAA record (IPv6)
      const ipv6 = await dns.resolve6(domain).catch(() => [])
      
      // Cek MX record
      const mx = await dns.resolveMx(domain).catch(() => [])
      
      // Cek TXT record
      const txt = await dns.resolveTxt(domain).catch(() => [])
      
      // Cek CNAME record
      const cname = await dns.resolveCname(domain).catch(() => [])
      
      // Cek NS record
      const ns = await dns.resolveNs(domain).catch(() => [])
      
      const txtFlat = txt.flat()
      
      return {
        has_ipv4: addresses.length > 0,
        has_ipv6: ipv6.length > 0,
        ip_addresses: addresses.slice(0, 5), // Batasi output
        mx_records: mx.map(m => ({ exchange: m.exchange, priority: m.priority })),
        txt_records_count: txtFlat.length,
        txt_records_preview: txtFlat.slice(0, 3),
        cname_exists: cname.length > 0,
        cname_records: cname,
        ns_records: ns,
        spf_record: txtFlat.some(record => record.includes('v=spf1')),
        dmarc_record: txtFlat.some(record => 
          record.includes('v=DMARC1') || record.toLowerCase().includes('dmarc')
        ),
        dkim_record: txtFlat.some(record => record.includes('v=DKIM1') || record.includes('dkim=')),
        response_time_ms: Date.now() - startTime,
        status: "completed",
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return { 
        error: error.message,
        code: error.code,
        status: "failed" 
      }
    }
  },

  async checkSSL(domain, timeout = 10000) {
    try {
      const httpsAgent = new (require('https').Agent)({
        rejectUnauthorized: false,
        timeout: timeout
      })

      const response = await axios.get(`https://${domain}`, {
        httpsAgent,
        timeout: timeout,
        maxRedirects: 5,
        validateStatus: () => true // Terima semua status code
      })

      const socket = response.request.res?.socket
      if (!socket) {
        throw new Error('Tidak dapat mendapatkan informasi SSL')
      }

      const cert = socket.getPeerCertificate()
      const validTo = new Date(cert.valid_to)
      const validFrom = new Date(cert.valid_from)
      const now = new Date()
      
      const daysLeft = Math.ceil((validTo - now) / (1000 * 60 * 60 * 24))
      const totalDays = Math.ceil((validTo - validFrom) / (1000 * 60 * 60 * 24))
      const daysUsed = totalDays - daysLeft
      const expiryPercentage = (daysUsed / totalDays) * 100

      // Analisis cipher strength
      const cipher = socket.getCipher()
      const isCipherStrong = this.isStrongCipher(cipher.name)

      // Grade calculation
      let grade = 'A'
      if (daysLeft <= 0) grade = 'F'
      else if (daysLeft <= 7) grade = 'D'
      else if (daysLeft <= 30) grade = 'C'
      else if (!isCipherStrong) grade = 'B'

      return {
        is_https: true,
        certificate_issuer: cert.issuer?.O || cert.issuer?.CN || 'Unknown',
        certificate_subject: cert.subject?.CN || 'Unknown',
        certificate_valid_from: cert.valid_from,
        certificate_valid_to: cert.valid_to,
        certificate_days_left: daysLeft,
        certificate_expiry_percentage: Math.round(expiryPercentage),
        certificate_is_expired: daysLeft <= 0,
        protocol: socket.getProtocol(),
        cipher: {
          name: cipher.name,
          version: cipher.version,
          is_strong: isCipherStrong
        },
        tls_version: socket.getTlsVersion(),
        grade: grade,
        redirect_count: response.request._redirectable?._redirectCount || 0,
        final_url: response.request.res.responseUrl || `https://${domain}`,
        http_status: response.status,
        status: "completed"
      }
    } catch (error) {
      // Coba HTTP jika HTTPS gagal
      try {
        await axios.get(`http://${domain}`, {
          timeout: timeout / 2,
          maxRedirects: 3,
          validateStatus: () => true
        })
        
        return {
          is_https: false,
          warning: "Website menggunakan HTTP, bukan HTTPS. Semua data dikirim plaintext!",
          security_risk: "HIGH",
          grade: 'F',
          recommendation: "Segera implementasikan SSL/TLS certificate",
          status: "completed"
        }
      } catch (httpError) {
        return {
          error: `Cannot connect to domain: ${error.message}`,
          status: "failed"
        }
      }
    }
  },

  isStrongCipher(cipherName) {
    // Cipher yang dianggap lemah
    const weakCiphers = [
      'RC4', 'DES', 'MD5', 'SHA1', 'NULL', 'EXPORT', 'ANON',
      'TLS_RSA_WITH_', 'SSL_RSA_WITH_', '_CBC_'
    ]
    
    return !weakCiphers.some(weak => cipherName.includes(weak))
  },

  async checkSecurityHeaders(domain, timeout) {
    try {
      const response = await axios.get(`https://${domain}`, {
        timeout: timeout,
        maxRedirects: 5,
        validateStatus: null,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecurityScanner/1.0)'
        }
      })

      const headers = response.headers
      
      // Daftar security headers yang penting
      const securityHeaders = {
        'Strict-Transport-Security': {
          value: headers['strict-transport-security'],
          description: 'Memaksa koneksi HTTPS',
          required: true
        },
        'Content-Security-Policy': {
          value: headers['content-security-policy'],
          description: 'Mencegah XSS dan injection attacks',
          required: true
        },
        'X-Frame-Options': {
          value: headers['x-frame-options'],
          description: 'Mencegah clickjacking',
          required: true
        },
        'X-Content-Type-Options': {
          value: headers['x-content-type-options'],
          description: 'Mencegah MIME sniffing',
          required: true
        },
        'Referrer-Policy': {
          value: headers['referrer-policy'],
          description: 'Mengontrol informasi referrer',
          required: false
        },
        'Permissions-Policy': {
          value: headers['permissions-policy'] || headers['feature-policy'],
          description: 'Mengontrol fitur browser',
          required: false
        },
        'X-XSS-Protection': {
          value: headers['x-xss-protection'],
          description: 'Proteksi XSS untuk browser lama',
          required: false
        }
      }

      // Analisis
      const analysis = {
        present: [],
        missing: [],
        weak: [],
        score: 0,
        max_score: 0
      }

      Object.entries(securityHeaders).forEach(([header, info]) => {
        analysis.max_score += info.required ? 2 : 1
        
        if (!info.value) {
          analysis.missing.push({
            header,
            description: info.description,
            severity: info.required ? 'HIGH' : 'MEDIUM'
          })
          if (info.required) analysis.score += 0
        } else {
          const isStrong = this.isHeaderStrong(header, info.value)
          analysis.present.push({
            header,
            value: info.value.length > 100 ? info.value.substring(0, 100) + '...' : info.value,
            is_strong: isStrong,
            description: info.description
          })
          
          if (isStrong) {
            analysis.score += info.required ? 2 : 1
          } else {
            analysis.score += info.required ? 1 : 0.5
            analysis.weak.push(header)
          }
        }
      })

      const headerScore = analysis.max_score > 0 
        ? Math.round((analysis.score / analysis.max_score) * 100) 
        : 0

      return {
        headers_found: Object.keys(headers).length,
        security_headers: securityHeaders,
        analysis: analysis,
        score: headerScore,
        grade: this.scoreToGrade(headerScore),
        server: headers.server || headers['x-powered-by'] || 'Unknown',
        powered_by: headers['x-powered-by'] || 'Not specified',
        cache_control: headers['cache-control'],
        status: "completed"
      }
    } catch (error) {
      return { 
        error: error.message, 
        status: "failed" 
      }
    }
  },

  isHeaderStrong(header, value) {
    const checks = {
      'Strict-Transport-Security': (val) => 
        val.includes('max-age=') && parseInt(val.match(/max-age=(\d+)/)?.[1] || 0) >= 31536000,
      'Content-Security-Policy': (val) => 
        !val.includes('unsafe-inline') && !val.includes('unsafe-eval'),
      'X-Frame-Options': (val) => 
        ['DENY', 'SAMEORIGIN'].includes(val.toUpperCase()),
      'X-Content-Type-Options': (val) => 
        val.toLowerCase() === 'nosniff',
      'X-XSS-Protection': (val) => 
        val === '1; mode=block'
    }

    const check = checks[header]
    return check ? check(value) : true
  },

  scoreToGrade(score) {
    if (score >= 90) return 'A'
    if (score >= 75) return 'B'
    if (score >= 60) return 'C'
    if (score >= 40) return 'D'
    return 'F'
  },

  async checkCMS(domain, timeout) {
    try {
      const response = await axios.get(`https://${domain}`, {
        timeout: timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CMSDetector/1.0)'
        },
        validateStatus: null
      })

      const html = response.data
      const headers = response.headers
      
      const cmsPatterns = [
        {
          name: 'WordPress',
          patterns: [
            /wp-content/i,
            /wp-includes/i,
            /wordpress/i,
            /\/wp-json\//i
          ],
          headers: ['x-powered-by', 'x-generator'],
          files: ['/wp-login.php', '/wp-admin/']
        },
        {
          name: 'Joomla',
          patterns: [
            /joomla/i,
            /\/media\/jui\//i,
            /\/media\/system\//i,
            /\/components\//i
          ],
          headers: ['x-powered-by'],
          files: ['/administrator/']
        },
        {
          name: 'Drupal',
          patterns: [
            /drupal/i,
            /sites\/default\//i,
            /\/core\//i
          ],
          headers: ['x-generator'],
          files: ['/user/login']
        },
        {
          name: 'Laravel',
          patterns: [
            /laravel/i,
            /csrf-token/i
          ],
          headers: ['x-powered-by']
        },
        {
          name: 'Express',
          patterns: [
            /express/i
          ],
          headers: ['x-powered-by']
        }
      ]

      const detected = []
      
      for (const cms of cmsPatterns) {
        let confidence = 0
        const indicators = []
        
        // Check patterns in HTML
        for (const pattern of cms.patterns) {
          if (pattern.test(html)) {
            confidence += 25
            indicators.push(`Pattern: ${pattern.toString()}`)
          }
        }
        
        // Check headers
        for (const header of cms.headers || []) {
          if (headers[header] && headers[header].toLowerCase().includes(cms.name.toLowerCase())) {
            confidence += 50
            indicators.push(`Header ${header}: ${headers[header]}`)
          }
        }
        
        // Check common files (optional async check)
        if (confidence >= 25 && cms.files) {
          // Simple check without async for performance
          for (const file of cms.files.slice(0, 2)) {
            if (html.includes(file)) {
              confidence += 25
              indicators.push(`File reference: ${file}`)
              break
            }
          }
        }
        
        if (confidence >= 25) {
          detected.push({
            name: cms.name,
            confidence: `${confidence}%`,
            confidence_level: confidence >= 75 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW',
            indicators: indicators.slice(0, 3)
          })
        }
      }

      // Check server technology
      const serverTech = headers['server'] || headers['x-powered-by'] || 'Unknown'
      
      // Check if it's a static site
      const isStaticSite = html.length < 10000 && 
                          !detected.length && 
                          (html.includes('.css') || html.includes('.js')) &&
                          !html.includes('<?php') && 
                          !html.includes('.aspx') &&
                          !html.includes('.jsp')

      return {
        detected_cms: detected.length > 0 ? detected : null,
        server_technology: serverTech,
        is_static_site: isStaticSite,
        page_size_bytes: html.length,
        headers_analyzed: Object.keys(headers).filter(h => 
          h.includes('powered') || h.includes('generator') || h.includes('server')
        ),
        status: "completed"
      }
    } catch (error) {
      return { 
        error: error.message, 
        status: "failed" 
      }
    }
  },

  async checkCommonPorts(domain) {
    // Simulasi port checking (implementasi nyata memerlukan socket programming)
    // Untuk API ini, kita berikan informasi dasar saja
    const commonPorts = [
      { port: 80, service: 'HTTP', secure: false, risk: 'MEDIUM' },
      { port: 443, service: 'HTTPS', secure: true, risk: 'LOW' },
      { port: 22, service: 'SSH', secure: true, risk: 'MEDIUM' },
      { port: 21, service: 'FTP', secure: false, risk: 'HIGH' },
      { port: 25, service: 'SMTP', secure: false, risk: 'MEDIUM' },
      { port: 3306, service: 'MySQL', secure: false, risk: 'HIGH' },
      { port: 3389, service: 'RDP', secure: false, risk: 'HIGH' },
      { port: 8080, service: 'HTTP-Alt', secure: false, risk: 'MEDIUM' }
    ]

    return {
      note: "Port scanning hanya simulasi. Untuk scanning nyata diperlukan izin khusus.",
      common_ports: commonPorts,
      recommendation: [
        "Pastikan hanya port yang diperlukan saja yang terbuka",
        "Gunakan firewall untuk membatasi akses",
        "Non-essential ports harus ditutup",
        "Gunakan VPN untuk akses administrative ports"
      ],
      status: "simulated"
    }
  },

  calculateSecurityScore(checks) {
    let score = 0
    let maxPossible = 0

    // SSL Score (0-40 points)
    if (checks.ssl && checks.ssl.grade) {
      maxPossible += 40
      const sslGrades = { 'A': 40, 'B': 30, 'C': 20, 'D': 10, 'F': 0 }
      score += sslGrades[checks.ssl.grade] || 0
    }

    // Headers Score (0-35 points)
    if (checks.headers && checks.headers.score) {
      maxPossible += 35
      score += Math.round(checks.headers.score * 0.35)
    }

    // DNS Score (0-15 points)
    if (checks.dns && !checks.dns.error) {
      maxPossible += 15
      let dnsScore = 5 // Base score
      if (checks.dns.has_ipv4) dnsScore += 3
      if (checks.dns.spf_record) dnsScore += 2
      if (checks.dns.dmarc_record) dnsScore += 2
      if (checks.dns.dkim_record) dnsScore += 1
      if (checks.dns.has_ipv6) dnsScore += 2
      score += Math.min(dnsScore, 15)
    }

    // CMS Score (0-10 points)
    if (checks.cms && !checks.cms.error) {
      maxPossible += 10
      // Jika tidak terdeteksi CMS atau static site, lebih aman
      if (!checks.cms.detected_cms || checks.cms.is_static_site) {
        score += 10
      } else {
        // CMS terdeteksi, beri score berdasarkan confidence
        const highRiskCMS = ['WordPress', 'Joomla', 'Drupal'] // CMS populer = target serangan
        const hasHighRiskCMS = checks.cms.detected_cms.some(cms => 
          highRiskCMS.includes(cms.name) && cms.confidence_level === 'HIGH'
        )
        score += hasHighRiskCMS ? 3 : 7
      }
    }

    return maxPossible > 0 ? Math.round((score / maxPossible) * 100) : 0
  },

  getOverallStatus(score) {
    if (score >= 90) return 'SECURE'
    if (score >= 75) return 'GOOD'
    if (score >= 60) return 'FAIR'
    if (score >= 40) return 'WEAK'
    return 'CRITICAL'
  },

  generateRecommendations(checks) {
    const recommendations = []
    
    // SSL Recommendations
    if (checks.ssl) {
      if (!checks.ssl.is_https) {
        recommendations.push({
          priority: "CRITICAL",
          category: "SSL/TLS",
          issue: "Website tidak menggunakan HTTPS",
          recommendation: "Install SSL/TLS certificate segera",
          impact: "Semua data dikirim plaintext - sangat rentan interception",
          action: "Dapatkan certificate gratis dari Let's Encrypt"
        })
      } else if (checks.ssl.grade === 'F' || checks.ssl.certificate_is_expired) {
        recommendations.push({
          priority: "HIGH",
          category: "SSL/TLS",
          issue: "SSL Certificate expired atau tidak valid",
          recommendation: "Renew SSL certificate",
          impact: "Browser akan memperingatkan pengunjung",
          action: "Perbarui certificate di hosting control panel"
        })
      } else if (!checks.ssl.cipher?.is_strong) {
        recommendations.push({
          priority: "MEDIUM",
          category: "SSL/TLS",
          issue: "Menggunakan cipher yang lemah",
          recommendation: "Update cipher suites di server",
          impact: "Rentan terhadap cryptographic attacks",
          action: "Gunakan cipher suites yang kuat seperti TLS 1.3"
        })
      }
    }

    // Headers Recommendations
    if (checks.headers && checks.headers.analysis) {
      const missingRequired = checks.headers.analysis.missing.filter(
        m => m.severity === 'HIGH'
      )
      
      if (missingRequired.length > 0) {
        recommendations.push({
          priority: "HIGH",
          category: "Security Headers",
          issue: `Missing critical security headers: ${missingRequired.map(m => m.header).join(', ')}`,
          recommendation: "Implement security headers immediately",
          impact: "Rentan terhadap berbagai web attacks",
          action: "Konfigurasi headers di web server (Apache/Nginx) atau aplikasi"
        })
      }
      
      if (checks.headers.analysis.weak.length > 0) {
        recommendations.push({
          priority: "MEDIUM",
          category: "Security Headers",
          issue: `Weak security headers configuration: ${checks.headers.analysis.weak.join(', ')}`,
          recommendation: "Strengthen header values",
          impact: "Reduced protection against attacks",
          action: "Update header values sesuai best practices"
        })
      }
    }

    // DNS Recommendations
    if (checks.dns && !checks.dns.error) {
      if (!checks.dns.spf_record) {
        recommendations.push({
          priority: "MEDIUM",
          category: "DNS",
          issue: "SPF record tidak ditemukan",
          recommendation: "Add SPF record for email authentication",
          impact: "Email spoofing mungkin terjadi",
          action: `Add TXT record: "v=spf1 include:_spf.example.com ~all"`
        })
      }
      
      if (!checks.dns.dmarc_record) {
        recommendations.push({
          priority: "LOW",
          category: "DNS",
          issue: "DMARC record tidak ditemukan",
          recommendation: "Add DMARC record for email security",
          impact: "Limited email authentication",
          action: `Add TXT record: "v=DMARC1; p=none; rua=mailto:admin@${checks.domain}"`
        })
      }
    }

    // CMS Recommendations
    if (checks.cms && checks.cms.detected_cms) {
      recommendations.push({
        priority: "HIGH",
        category: "CMS",
        issue: `Detected ${checks.cms.detected_cms.map(c => `${c.name} (${c.confidence_level})`).join(', ')}`,
        recommendation: "Keep CMS and plugins updated",
        impact: "Outdated CMS is #1 target for attackers",
        action: "Enable auto-updates, remove unused plugins/themes"
      })
    }

    // Sort by priority
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return recommendations
  }
}