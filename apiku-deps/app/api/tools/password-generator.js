import crypto from 'crypto';

class PasswordGenerator {
    constructor() {
        this.charSets = {
            lowercase: 'abcdefghijklmnopqrstuvwxyz',
            uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            numbers: '0123456789',
            symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
        };
        
        this.similarChars = 'il1Lo0O';
    }

    generatePassword(options = {}) {
        const {
            length = 12,
            includeLowercase = true,
            includeUppercase = true,
            includeNumbers = true,
            includeSymbols = true,
            excludeSimilar = false,
            customChars = ''
        } = options;

        // Validasi parameter
        if (length < 4 || length > 128) {
            throw new Error('Password length must be between 4 and 128 characters');
        }

        // Build character pool
        let charPool = '';
        
        if (includeLowercase) charPool += this.charSets.lowercase;
        if (includeUppercase) charPool += this.charSets.uppercase;
        if (includeNumbers) charPool += this.charSets.numbers;
        if (includeSymbols) charPool += this.charSets.symbols;
        if (customChars) charPool += customChars;

        // Validate at least one character set is selected
        if (charPool.length === 0) {
            throw new Error('At least one character type must be selected');
        }

        // Remove similar characters if requested
        if (excludeSimilar) {
            charPool = charPool.split('').filter(char => 
                !this.similarChars.includes(char)
            ).join('');
        }

        // Generate password using cryptographically secure random
        let password = '';
        const randomBytes = crypto.randomBytes(length * 2);
        
        for (let i = 0; i < length; i++) {
            const randomIndex = randomBytes[i] % charPool.length;
            password += charPool[randomIndex];
        }

        // Ensure at least one of each selected character type is included
        if (includeLowercase && !/[a-z]/.test(password)) {
            const randomLower = this.charSets.lowercase[
                crypto.randomBytes(1)[0] % this.charSets.lowercase.length
            ];
            const replaceIndex = crypto.randomBytes(1)[0] % length;
            password = password.substring(0, replaceIndex) + randomLower + 
                      password.substring(replaceIndex + 1);
        }

        if (includeUppercase && !/[A-Z]/.test(password)) {
            const randomUpper = this.charSets.uppercase[
                crypto.randomBytes(1)[0] % this.charSets.uppercase.length
            ];
            const replaceIndex = crypto.randomBytes(1)[0] % length;
            password = password.substring(0, replaceIndex) + randomUpper + 
                      password.substring(replaceIndex + 1);
        }

        if (includeNumbers && !/[0-9]/.test(password)) {
            const randomNumber = this.charSets.numbers[
                crypto.randomBytes(1)[0] % this.charSets.numbers.length
            ];
            const replaceIndex = crypto.randomBytes(1)[0] % length;
            password = password.substring(0, replaceIndex) + randomNumber + 
                      password.substring(replaceIndex + 1);
        }

        if (includeSymbols && !/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
            const randomSymbol = this.charSets.symbols[
                crypto.randomBytes(1)[0] % this.charSets.symbols.length
            ];
            const replaceIndex = crypto.randomBytes(1)[0] % length;
            password = password.substring(0, replaceIndex) + randomSymbol + 
                      password.substring(replaceIndex + 1);
        }

        return password;
    }

    calculateEntropy(password) {
        if (!password) return 0;
        
        // Determine character set size
        let charsetSize = 0;
        if (/[a-z]/.test(password)) charsetSize += 26;
        if (/[A-Z]/.test(password)) charsetSize += 26;
        if (/[0-9]/.test(password)) charsetSize += 10;
        if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32; // Approximate symbol count
        
        if (charsetSize === 0) return 0;
        
        // Entropy = log2(charsetSize^length)
        return Math.log2(Math.pow(charsetSize, password.length));
    }

    getPasswordStrength(password) {
        const entropy = this.calculateEntropy(password);
        
        if (entropy < 28) return 'Very Weak';
        if (entropy < 36) return 'Weak';
        if (entropy < 60) return 'Good';
        if (entropy < 80) return 'Strong';
        return 'Very Strong';
    }

    generateMultiple(count = 5, options = {}) {
        const passwords = [];
        for (let i = 0; i < count; i++) {
            passwords.push(this.generatePassword(options));
        }
        return passwords;
    }
}

// Main function
function generatePasswordAPI(params) {
    const generator = new PasswordGenerator();
    
    try {
        const password = generator.generatePassword({
            length: parseInt(params.length) || 12,
            includeLowercase: params.includeLowercase === 'true' || params.includeLowercase === true,
            includeUppercase: params.includeUppercase === 'true' || params.includeUppercase === true,
            includeNumbers: params.includeNumbers === 'true' || params.includeNumbers === true,
            includeSymbols: params.includeSymbols === 'true' || params.includeSymbols === true,
            excludeSimilar: params.excludeSimilar === 'true' || params.excludeSimilar === false,
            customChars: params.customChars || ''
        });

        const entropy = generator.calculateEntropy(password);
        const strength = generator.getPasswordStrength(password);

        return {
            success: true,
            password: password,
            length: password.length,
            entropy: Math.round(entropy * 100) / 100,
            strength: strength,
            character_types: {
                lowercase: /[a-z]/.test(password),
                uppercase: /[A-Z]/.test(password),
                numbers: /[0-9]/.test(password),
                symbols: /[^a-zA-Z0-9]/.test(password)
            }
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// API Module Export
export default {
    name: "Password Generator API",
    description: "Generate secure random passwords with configurable options",
    category: "Tools",
    methods: ["GET"],

    params: ["length", "includeLowercase", "includeUppercase", 
             "includeNumbers", "includeSymbols", "excludeSimilar", "customChars", "count"],

    paramsSchema: {
        length: {
            type: "number",
            required: false,
            default: 12,
            min: 4,
            max: 128,
            description: "Password length"
        },
        includeLowercase: {
            type: "boolean",
            required: false,
            default: true,
            description: "Include lowercase letters (a-z)"
        },
        includeUppercase: {
            type: "boolean",
            required: false,
            default: true,
            description: "Include uppercase letters (A-Z)"
        },
        includeNumbers: {
            type: "boolean",
            required: false,
            default: true,
            description: "Include numbers (0-9)"
        },
        includeSymbols: {
            type: "boolean",
            required: false,
            default: true,
            description: "Include symbols (!@#$%^&* etc)"
        },
        excludeSimilar: {
            type: "boolean",
            required: false,
            default: false,
            description: "Exclude similar characters (i, l, 1, L, o, 0, O)"
        },
        customChars: {
            type: "string",
            required: false,
            description: "Additional custom characters to include"
        },
        count: {
            type: "number",
            required: false,
            default: 1,
            min: 1,
            max: 50,
            description: "Number of passwords to generate"
        }
    },

    async run(req, res) {
        try {
            const params = req.query;
            
            // Parse count parameter
            const count = parseInt(params.count) || 1;
            
            if (count > 50) {
                return res.status(400).json({
                    success: false,
                    error: "Maximum count is 50 passwords"
                });
            }

            const generator = new PasswordGenerator();
            
            if (count === 1) {
                // Single password
                const result = generatePasswordAPI(params);
                
                if (!result.success) {
                    return res.status(400).json(result);
                }
                
                return res.json({
                    data: result
                });
            } else {
                // Multiple passwords
                const passwords = generator.generateMultiple(count, {
                    length: parseInt(params.length) || 12,
                    includeLowercase: params.includeLowercase === 'true' || params.includeLowercase === true,
                    includeUppercase: params.includeUppercase === 'true' || params.includeUppercase === true,
                    includeNumbers: params.includeNumbers === 'true' || params.includeNumbers === true,
                    includeSymbols: params.includeSymbols === 'true' || params.includeSymbols === true,
                    excludeSimilar: params.excludeSimilar === 'true' || params.excludeSimilar === false,
                    customChars: params.customChars || ''
                });

                const results = passwords.map(password => {
                    const entropy = generator.calculateEntropy(password);
                    const strength = generator.getPasswordStrength(password);
                    
                    return {
                        password: password,
                        length: password.length,
                        entropy: Math.round(entropy * 100) / 100,
                        strength: strength
                    };
                });

                return res.json({
                    success: true,
                    count: count,
                    passwords: results,
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error("[PASSWORD GENERATOR ERROR]:", error);
            
            return res.status(500).json({
                success: false,
                error: "Internal server error",
                message: error.message
            });
        }
    }
};

// Alternative simple function for direct use
export function generateSimplePassword(
    length = 12,
    includeLowercase = true,
    includeUppercase = true,
    includeNumbers = true,
    includeSymbols = true
) {
    const generator = new PasswordGenerator();
    return generator.generatePassword({
        length,
        includeLowercase,
        includeUppercase,
        includeNumbers,
        includeSymbols
    });
}

// Usage examples in comments
/*
// Example 1: Simple password
const password1 = generateSimplePassword(12, true, true, true, true);

// Example 2: Using the full API
const result = generatePasswordAPI({
    length: 16,
    includeLowercase: true,
    includeUppercase: true,
    includeNumbers: true,
    includeSymbols: false,
    excludeSimilar: true
});

// Example 3: Multiple passwords
const generator = new PasswordGenerator();
const passwords = generator.generateMultiple(5, {
    length: 12,
    includeSymbols: false
});
*/