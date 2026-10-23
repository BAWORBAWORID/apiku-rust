import { faker } from "@faker-js/faker"
import logger from "../../src/utils/logger.js"

// Generate fake data function
async function generateFakeData(type, count) {
  let data
  
  switch (type) {
    case "person":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        name: faker.person.fullName(),
        email: faker.internet.email(),
        avatar: faker.image.avatar(),
        phone: faker.phone.number(),
        birthDate: faker.date.past(),
        gender: faker.person.sex(),
        jobTitle: faker.person.jobTitle(),
        bio: faker.person.bio(),
        address: {
          street: faker.location.streetAddress(),
          city: faker.location.city(),
          state: faker.location.state(),
          country: faker.location.country(),
          zipCode: faker.location.zipCode(),
          coordinates: {
            latitude: faker.location.latitude(),
            longitude: faker.location.longitude()
          }
        }
      }))
      break
      
    case "company":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        name: faker.company.name(),
        catchPhrase: faker.company.catchPhrase(),
        buzzPhrase: faker.company.buzzPhrase(),
        // faker.company.suffix() dihapus di @faker-js/faker v10
        suffix: faker.helpers.arrayElement([
          "Inc", "LLC", "Ltd", "Corp", "GmbH", "S.A.", "Group", "Holdings", "Partners"
        ]),
        address: {
          street: faker.location.streetAddress(),
          city: faker.location.city(),
          country: faker.location.country(),
          zipCode: faker.location.zipCode()
        },
        website: faker.internet.url(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
        industry: faker.commerce.department(),
        employees: faker.number.int({ min: 1, max: 10000 })
      }))
      break
      
    case "product":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        name: faker.commerce.productName(),
        price: faker.commerce.price({ min: 1000, max: 1000000, dec: 0 }),
        priceFormatted: faker.commerce.price({ min: 1000, max: 1000000, dec: 0, symbol: 'Rp' }),
        category: faker.commerce.department(),
        description: faker.commerce.productDescription(),
        material: faker.commerce.productMaterial(),
        color: faker.color.human(),
        image: faker.image.urlLoremFlickr({ category: 'product' }),
        inStock: faker.datatype.boolean(),
        rating: faker.number.float({ min: 1, max: 5, precision: 0.1 }),
        createdAt: faker.date.past()
      }))
      break
      
    case "address":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        street: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state(),
        country: faker.location.country(),
        zipCode: faker.location.zipCode(),
        coordinates: {
          latitude: faker.location.latitude(),
          longitude: faker.location.longitude()
        },
        timezone: faker.location.timeZone(),
        buildingNumber: faker.location.buildingNumber(),
        secondaryAddress: faker.location.secondaryAddress()
      }))
      break
      
    case "internet":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        email: faker.internet.email(),
        username: faker.internet.username(),
        displayName: faker.internet.displayName(),
        password: faker.internet.password({ length: 12 }),
        avatar: faker.image.avatar(),
        url: faker.internet.url(),
        ip: faker.internet.ip(),
        ipv6: faker.internet.ipv6(),
        macAddress: faker.internet.mac(),
        userAgent: faker.internet.userAgent(),
        emoji: faker.internet.emoji()
      }))
      break
      
    case "finance":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        accountNumber: faker.finance.accountNumber(),
        accountName: faker.finance.accountName(),
        amount: faker.finance.amount({ min: 1000, max: 10000000 }),
        currency: faker.finance.currencyCode(),
        currencyName: faker.finance.currencyName(),
        creditCardNumber: faker.finance.creditCardNumber(),
        creditCardIssuer: faker.finance.creditCardIssuer(),
        pin: faker.finance.pin(),
        routingNumber: faker.finance.routingNumber(),
        bitcoinAddress: faker.finance.bitcoinAddress(),
        ethereumAddress: faker.finance.ethereumAddress(),
        transactionType: faker.finance.transactionType()
      }))
      break
      
    case "vehicle":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        manufacturer: faker.vehicle.manufacturer(),
        model: faker.vehicle.model(),
        type: faker.vehicle.type(),
        fuel: faker.vehicle.fuel(),
        color: faker.vehicle.color(),
        vin: faker.vehicle.vin(),
        // faker.vehicle.licensePlate() dihapus di v10; vrm() adalah
        // padanan terdekat (nomor registrasi kendaraan).
        licensePlate: faker.vehicle.vrm(),
        year: faker.date.past({ years: 30 }).getFullYear(),
        mileage: faker.number.int({ min: 0, max: 300000 }),
        price: faker.commerce.price({ min: 50000000, max: 1000000000, dec: 0 })
      }))
      break
      
    case "lorem":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        word: faker.lorem.word(),
        words: faker.lorem.words({ min: 3, max: 10 }),
        sentence: faker.lorem.sentence(),
        sentences: faker.lorem.sentences({ min: 2, max: 5 }),
        paragraph: faker.lorem.paragraph(),
        paragraphs: faker.lorem.paragraphs({ min: 2, max: 5 }),
        slug: faker.lorem.slug(),
        text: faker.lorem.text()
      }))
      break
      
    case "date":
      data = Array.from({ length: Number(count) }, () => ({
        id: faker.string.uuid(),
        past: faker.date.past(),
        future: faker.date.future(),
        recent: faker.date.recent(),
        soon: faker.date.soon(),
        month: faker.date.month(),
        weekday: faker.date.weekday(),
        birthdate: faker.date.birthdate({ min: 18, max: 65, mode: 'age' }),
        iso: faker.date.anytime().toISOString(),
        timestamp: faker.date.anytime().getTime()
      }))
      break
      
    default:
      throw new Error("Invalid type for fake data generation.")
  }
  
  return data
}

export default {
  name: "Fake Data Generator",
  description: "Generate various types of fake data for development and testing",
  category: "Tools",
  methods: ["GET", "POST"],
  
  params: ["type", "count", "locale", "seed"],
  
  paramsSchema: {
    type: {
      type: "string",
      required: true,
      enum: [
        "person",
        "company",
        "product",
        "address",
        "internet",
        "finance",
        "vehicle",
        "lorem",
        "date"
      ],
      description: "Type of fake data to generate",
      example: "person"
    },
    count: {
      type: "number",
      required: false,
      default: 1,
      min: 1,
      max: 1000,
      description: "Number of data entries to generate",
      example: 10
    },
    locale: {
      type: "string",
      required: false,
      enum: ["en", "id_ID", "es", "fr", "de", "ja", "ko", "zh_CN"],
      default: "en",
      description: "Locale for localized data",
      example: "id_ID"
    },
    seed: {
      type: "number",
      required: false,
      description: "Seed for reproducible results",
      example: 12345
    }
  },
  
  async run(req, res) {
    try {
      // Get parameters based on HTTP method
      let type, count, locale, seed
      
      if (req.method === 'GET') {
        type = req.query.type
        count = req.query.count || 1
        locale = req.query.locale || "en"
        seed = req.query.seed
      } else {
        type = req.body?.type
        count = req.body?.count || 1
        locale = req.body?.locale || "en"
        seed = req.body?.seed
      }
      
      // Validation
      if (!type) {
        return res.status(400).json({
          status: false,
          message: "Parameter 'type' is required",
          availableTypes: [
            "person",
            "company", 
            "product",
            "address",
            "internet",
            "finance",
            "vehicle",
            "lorem",
            "date"
          ]
        })
      }
      
      const validTypes = [
        "person",
        "company", 
        "product",
        "address",
        "internet",
        "finance",
        "vehicle",
        "lorem",
        "date"
      ]
      
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          status: false,
          message: `Invalid type '${type}'`,
          availableTypes: validTypes
        })
      }
      
      const countNum = parseInt(count)
      if (isNaN(countNum) || countNum < 1 || countNum > 1000) {
        return res.status(400).json({
          status: false,
          message: "Count must be a number between 1 and 1000"
        })
      }
      
      // Set locale if provided
      if (locale && locale !== "en") {
        try {
          const localeModule = await import(`@faker-js/faker/locale/${locale.replace('_', '-')}`)
          // Note: In actual implementation, you'd need to reinitialize faker with locale
          // This is simplified for example
        } catch (e) {
          logger.warn(`[FAKE-DATA] Locale ${locale} not available, using English`)
        }
      }
      
      // Set seed for reproducibility
      if (seed) {
        faker.seed(parseInt(seed))
      }
      
      logger.info(`[FAKE-DATA] Generating ${countNum} ${type} records | locale: ${locale}`)
      
      // Generate data
      const data = await generateFakeData(type, countNum)
      
      // Log success
      logger.info(`[FAKE-DATA] Generated ${data.length} ${type} records`)
      
      return res.json({
        status: true,
        result: {
          type: type,
          count: data.length,
          locale: locale,
          seed: seed || null,
          generated_at: new Date().toISOString(),
          data: data
        }
      })
      
    } catch (error) {
      logger.error(`[FAKE-DATA] Error: ${error.message}`)
      
      return res.status(500).json({
        status: false,
        message: error.message || "Failed to generate fake data",
        suggestion: "Check if the type parameter is valid and count is between 1-1000"
      })
    }
  }
}