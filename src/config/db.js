require('dotenv').config();
const { Sequelize } = require('sequelize');

const isTest = process.env.NODE_ENV === 'test';
const dialect = isTest ? 'sqlite' : process.env.DB_DIALECT || 'sqlite';

let sequelize;
if (dialect === 'sqlite') {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: isTest ? ':memory:' : process.env.DB_STORAGE || './uniserve.sqlite',
    logging: false,
  });
} else if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect,
    logging: false,
    dialectOptions: process.env.DB_SSL === 'true' ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  });
} else {
  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || undefined,
    dialect,
    logging: false,
  });
}

module.exports = sequelize;
