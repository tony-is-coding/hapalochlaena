import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',

  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'cc_ee',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
  },

  oss: {
    endpoint: process.env.OSS_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.OSS_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.OSS_SECRET_KEY || 'minioadmin',
    bucket: process.env.OSS_BUCKET || 'cc-ee-sessions',
    region: process.env.OSS_REGION || 'us-east-1',
  },

  ccCore: {
    baseCwd: process.env.CC_CORE_BASE_CWD || '/tmp/cc_ee_sessions',
  },
}
